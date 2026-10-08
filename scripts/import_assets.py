#!/usr/bin/env python3
"""Подключение оригиналов из папки или ZIP. Не загружает изображения из внешних сервисов."""
import argparse
import io
import json
from pathlib import Path
import zipfile
from PIL import Image, ImageChops, ImageOps
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Импорт официальных материалов SA BANK')
parser.add_argument('source', help='Папка с изображениями или ZIP-архив')
args = parser.parse_args()
source = Path(args.source)
ALIASES = {
    'sa': ['SA-logo.png', '67bd79dba971459a08bafbf0ae1c241c_7adcf54e-91b2-4202-a15c-c82750398a5d.png'],
    'bank': ['SA-BANK-logo.png', '2e5294689a5c82f6d36da2afb9b5b5b1_f844bcfd-a364-4f4c-9cbf-5f21b14d4c01.png'],
    'hero': ['hero-main.webp', 'f50cadcb19e262f4e5ae88bc36af1dc6_c3993bea-be90-4c60-8c3d-2401a6e2b4df.jpg'],
    'donation': ['donation-art.webp', 'af95c07499dde1f8ebf1ad2038bddaa6_7f65252a-a2bf-408f-880e-7e0201c61201.jpg'],
    'wall': ['wall-art.webp', '2d9e488fcdca97091ec7b1611b0f1a83_3f375ff4-ba88-409a-b60b-14c00a2f1f68.jpg'],
    'social': ['social-preview.jpg'],
}
DEST = {'sa': 'assets/logo/SA-logo.png', 'bank': 'assets/logo/SA-BANK-logo.png', 'hero': 'assets/background/hero-main.webp', 'donation': 'assets/illustrations/donation-art.webp', 'wall': 'assets/illustrations/wall-art.webp', 'social': 'assets/preview/social-preview.jpg'}
# ZIP не распаковывается: извлекаются только известные изображения, нет возможности path traversal.
if source.is_dir():
    files = {p.name: p.read_bytes() for p in source.rglob('*') if p.is_file() and p.name in sum(ALIASES.values(), [])}
else:
    with zipfile.ZipFile(source) as archive:
        files = {}
        for info in archive.infolist():
            name = Path(info.filename).name
            if name in sum(ALIASES.values(), []) and info.file_size <= 40_000_000:
                files[name] = archive.read(info)
available = []
manifest_path = ROOT / 'assets/manifest.json'
if manifest_path.exists():
    available = json.loads(manifest_path.read_text()).get('available', [])
for key, names in ALIASES.items():
    found = next((name for name in names if name in files), None)
    if not found:
        continue
    image = Image.open(io.BytesIO(files[found]))
    image.load()
    image = ImageOps.exif_transpose(image)
    if key in ('sa', 'bank'):
        # Удаляются лишь пустые внешние поля. Цвет, форма и пропорции знака не меняются.
        if image.mode == 'RGBA' and image.getextrema()[3][0] == 0:
            box = image.getchannel('A').getbbox()
        else:
            rgb = image.convert('RGB')
            background = Image.new('RGB', rgb.size, rgb.getpixel((0, 0)))
            diff = ImageChops.difference(rgb, background).convert('L').point(lambda x: 255 if x > 12 else 0)
            box = diff.getbbox()
        if box:
            image = image.crop(box)
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        image.save(ROOT / DEST[key], 'PNG')
        if key == 'sa':
            icon = ImageOps.pad(image.convert('RGBA'), (512, 512), color=(0, 0, 0, 0))
            icon.save(ROOT / 'assets/icons/favicon.png')
            print('favicon.png создан; замените href favicon.svg в index.html на favicon.png.')
    elif key == 'social':
        image.convert('RGB').save(ROOT / DEST[key], 'JPEG', quality=95)
    else:
        image.convert('RGB').save(ROOT / DEST[key], 'WEBP', quality=95, method=6)
    if key not in available:
        available.append(key)
    print(f'{found} → {DEST[key]}')
manifest_path.write_text(json.dumps({'available': available}, ensure_ascii=False, indent=2) + '\n')
print('Подключено:', ', '.join(available) or 'ничего; проверьте имена файлов')
print('SVG-оригиналы можно подключить вручную через config.js, сохранив соответствующий ключ в manifest.json.')
