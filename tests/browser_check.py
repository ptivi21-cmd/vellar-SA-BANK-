"""Дополнительные браузерные проверки. pip install -q playwright; playwright install chromium."""
import contextlib
import functools
import http.server
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
handler = functools.partial(QuietHandler, directory=str(ROOT.parent))
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
base = f'http://127.0.0.1:{server.server_port}/{ROOT.name}/'
result = {'base_path': '/' + ROOT.name + '/', 'viewports': [], 'errors': []}
out = ROOT / 'test-results'
out.mkdir(exist_ok=True)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 960}, device_scale_factor=1)
        page.on('pageerror', lambda error: result['errors'].append(str(error)))
        local_404 = []
        page.on('response', lambda r: local_404.append(r.url) if r.status == 404 and '127.0.0.1' in r.url else None)
        response = page.goto(base, wait_until='networkidle')
        assert response.status == 200
        page.wait_for_function("!document.body.classList.contains('loading')", timeout=30000)
        assert page.locator('html').get_attribute('lang') == 'ru'
        assert 'UQDpHoPi5JHFruwdiKHCGO68gVaW4lKN0arzTAoMWVDWrjuv' in page.locator('[data-address="wallet"]').first.inner_text()
        assert page.locator('[data-metric="ton"]').first.inner_text() != '—'
        assert page.locator('.legal').inner_text().startswith('SA BANK является информационным интерфейсом')
        page.screenshot(path=str(out / 'desktop.png'))
        page.locator('#dashboard').scroll_into_view_if_needed()
        page.screenshot(path=str(out / 'dashboard.png'))
        for width in [1440, 1024, 768, 390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.wait_for_timeout(150)
            overflow = page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
            result['viewports'].append({'width': width, 'horizontal_overflow': overflow})
            assert not overflow, f'Горизонтальное переполнение: {width}'
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('window.scrollTo(0,0)')
        page.wait_for_timeout(700)
        page.screenshot(path=str(out / 'mobile.png'))
        page.locator('#menu-toggle').click()
        assert page.locator('#menu-toggle').get_attribute('aria-expanded') == 'true'
        page.locator('#navigation a[href="#wall"]').click()
        assert page.locator('#menu-toggle').get_attribute('aria-expanded') == 'false'
        page.locator('#donation').scroll_into_view_if_needed()
        page.locator('[data-amount="5"]').click()
        assert 'amount=5000000000' in page.locator('#open-wallet').get_attribute('href')
        page.locator('#custom-amount').click()
        page.locator('#amount-input').fill('0,000000001')
        assert 'amount=1&' in page.locator('#open-wallet').get_attribute('href')
        page.locator('#amount-input').fill('-1')
        assert page.locator('#open-wallet').get_attribute('href') is None
        page.locator('#wall-message').fill('<script>alert(1)</script>')
        page.locator('#wall-form button').click()
        assert 'HTML' in page.locator('#wall-status').inner_text()
        # Отключение API: ранее полученный баланс остаётся явно устаревшим.
        page.route('https://tonapi.io/**', lambda route: route.abort())
        page.route('https://api.dexscreener.com/**', lambda route: route.abort())
        page.locator('#refresh').click()
        page.wait_for_function("!document.body.classList.contains('loading')")
        assert 'УСТАРЕЛО' in page.locator('[data-meta="ton"]').inner_text()
        assert page.locator('#verification-warning').is_visible()
        result['local_404'] = local_404
        assert not local_404
        assert not result['errors']
        result['status'] = 'passed'
        browser.close()
finally:
    server.shutdown()
    (out / 'browser-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
