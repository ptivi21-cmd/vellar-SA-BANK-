import { CONFIG as C } from './config.js';
import { collect, json, dataUrl, historyPoint, metric, sameAddress, NA } from './lib/data.js';
import { cleanHistory, change, observedRisk, navVolatility, cagr, calendarReturns, fearGreed, PERIODS, DAY } from './lib/metrics.js';
import { $, $$, el, date, format, link, card, paintMetrics, unavailableList, returnCell, cell, emptyRow, chart } from './lib/ui.js';
import { setupControls, loadWall, loadImages } from './lib/controls.js';
let latest = null, history = [], values = {}, busy = false, lastHistoryLoad = 0, lastVerification = null;
const selected = { portfolio: 30, cap: 30 };
const sourceHistory = () => new URL(dataUrl('history.json'), location.href).href;
const calculated = (v, asOf, extra = {}) => metric(v, asOf, sourceHistory(), true, extra);
const unavailable = reason => metric(null, null, null, false, { reason });
function createLayout() {
  const markets = [
    ['ЦЕНА SA', 'price', 'usd'], ['ЛИКВИДНОСТЬ ПУЛА', 'liquidity', 'usd'], ['ОБЪЁМ 24Ч · ПУЛ', 'volume24', 'usd'], ['ОБЪЁМ 7Д', 'volume7', 'usd'],
    ['ДЕРЖАТЕЛИ SA', 'holders'], ['СДЕЛКИ 24Ч · ПУЛ', 'tx24'], ['ИЗМЕНЕНИЕ ЦЕНЫ 24Ч', 'priceChange24', 'pct'], ['ЛИКВИДНОСТЬ / КАПИТАЛИЗАЦИЯ', 'liquidityRatio', 'pct']
  ];
  $('#market-metrics').append(...markets.map(args => card(...args)));
  const stats = [
    ['ТЕКУЩАЯ СТОИМОСТЬ', 'total', 'usd'], ['ИСТОРИЧЕСКИЙ МАКСИМУМ', 'ath', 'usd', 'Максимум только накопленной истории.'],
    ['ОТ ИСТОРИЧЕСКОГО МАКСИМУМА', 'athDistance', 'pct'], ['P&L ПОРТФЕЛЯ', 'pnl', 'usd'],
    ['ДОХОДНОСТЬ ЗА ГОД', 'annualPct', 'pct', 'Изменение стоимости, включая денежные потоки.'], ['С НАЧАЛА ГОДА', 'ytd', 'pct'],
    ['CAGR СТОИМОСТИ', 'cagr', 'pct', 'Не очищен от пополнений и выводов.'], ['МАКСИМАЛЬНАЯ ПРОСАДКА', 'drawdown', 'pct'],
    ['ДНЕВНАЯ ВОЛАТИЛЬНОСТЬ', 'volDaily', 'pct'], ['МЕСЯЧНАЯ ВОЛАТИЛЬНОСТЬ', 'volMonthly', 'pct'], ['ГОДОВАЯ ВОЛАТИЛЬНОСТЬ', 'volAnnual', 'pct'], ['КОЭФФИЦИЕНТ ШАРПА', 'sharpe'],
    ['ОПЕРАЦИИ В ВЫБОРКЕ', 'operationsCount'], ['ОБЪЁМ TON-ПЕРЕВОДОВ В ВЫБОРКЕ', 'operationVolume', 'ton'], ['КОЛИЧЕСТВО АКТИВОВ', 'count'], ['ДОЛЯ TON', 'tonShare', 'pct'],
    ['ДОЛЯ SA', 'saShare', 'pct'], ['ДОЛЯ ДРУГИХ АКТИВОВ', 'otherShare', 'pct'], ['ATH КАПИТАЛИЗАЦИИ SA', 'capAth', 'usd'], ['КАПИТАЛИЗАЦИЯ SA ОТ ATH', 'capAthDistance', 'pct']
  ];
  $('#statistics-grid').append(...stats.map(args => card(...args)));
  unavailableList('#buyback-metrics', ['Фактически выделенный капитал', 'Фактически использованный капитал', 'Количество приобретённых SA', 'Средняя стоимость покупки', 'Текущая стоимость позиции', 'P&L · USD / %', 'Доходность · USD / %', 'Количество операций', 'Первая / последняя операция', 'История и стоимость операций']);
  unavailableList('#vellar-metrics', ['Фактически выделенный капитал', 'Текущая стоимость', 'Фактическая доля', 'Изменение стоимости', 'Доходность · USD / %', 'P&L · USD / %', 'История стоимости']);
  for (const bar of $$('[data-periods]')) {
    const name = bar.dataset.periods;
    for (const [label, days] of [['24Ч', 1], ['7Д', 7], ['30Д', 30], ['3М', 90], ['6М', 180], ['1Г', 365], ['ВСЁ', 'all']]) {
      const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(days === selected[name]));
      b.addEventListener('click', () => { selected[name] = days; [...bar.children].forEach(c => c.setAttribute('aria-pressed', String(c === b))); renderCharts(); }); bar.append(b);
    }
  }
  $$('[data-history-link]').forEach(a => { a.href = sourceHistory(); a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}
function fullHistory() { return cleanHistory([...history, ...(latest ? [historyPoint(latest)] : [])]); }
function renderCharts() { const h = fullHistory(); chart('#portfolio-chart', h, 'totalUsd', selected.portfolio); chart('#cap-chart', h, 'cap', selected.cap); }
function persistMetric(key, m) {
  if (m?.value !== null && m?.value !== undefined) values[key] = m;
  else if (values[key]?.value !== null && values[key]?.value !== undefined) values[key] = { ...values[key], stale: true };
  else values[key] = m || unavailable(NA);
}
function renderSnapshot(snapshot) {
  latest = snapshot;
  const p = snapshot.portfolio, market = snapshot.market, h = fullHistory();
  const annual = change(h, 365), risk = observedRisk(h), capRisk = observedRisk(h, 'cap');
  const vol = navVolatility(h), growth = cagr(h), fg = fearGreed(h);
  const annualReason = 'НЕДОСТАТОЧНО ДАННЫХ ДЛЯ РАСЧЁТА';
  const total = p.total.value, at = p.total.asOf, others = p.assets.filter(a => a.id !== 'TON' && !sameAddress(a.id, C.sa));
  for (const key of ['total', 'ton', 'sa', 'count']) persistMetric(key, p[key]);
  for (const key of ['price', 'cap', 'liquidity', 'volume24', 'holders', 'tx24', 'priceChange24', 'liquidityRatio']) persistMetric(key, market[key]);
  persistMetric('others', metric(snapshot.sources.tokens.receivedAt && others.every(a => a.valueUsd !== null) ? others.reduce((sum, a) => sum + a.valueUsd, 0) : null, snapshot.sources.tokens.receivedAt, snapshot.sources.tokens.url, true));
  persistMetric('operationsCount', metric(snapshot.operations?.length ?? null, snapshot.sources.events.receivedAt, snapshot.sources.events.url, true));
  persistMetric('operationVolume', metric(snapshot.operations ? snapshot.operations.reduce((s, e) => s + e.transfers.filter(t => (t.incoming || t.outgoing) && t.amount !== null).reduce((v, t) => v + t.amount, 0), 0) : null, snapshot.sources.events.receivedAt, snapshot.sources.events.url, true));
  const currentEndpoint = h.at(-1);
  Object.assign(values, {
    annualPct: annual ? calculated(annual.pct, annual.to) : unavailable(annualReason), annualStart: annual ? calculated(annual.start, annual.from) : unavailable(annualReason),
    annualAbs: annual ? calculated(annual.absolute, annual.to) : unavailable(annualReason),
    targetHalf: metric(total === null ? null : total / 2, at, p.total.source, true),
    ath: calculated(risk?.ath, risk?.athAt), athDistance: calculated(risk?.distance, risk?.asOf), drawdown: calculated(risk?.dd, risk?.asOf),
    volDaily: calculated(vol?.daily, vol?.to), volMonthly: calculated(vol?.monthly, vol?.to), volAnnual: calculated(vol?.annual, vol?.to),
    cagr: calculated(growth?.value, growth?.to), ytd: calculated(change(h, 'ytd')?.pct, change(h, 'ytd')?.to),
    fear: calculated(fg?.value, fg?.asOf), capAth: calculated(capRisk?.ath, capRisk?.athAt), capAthDistance: calculated(capRisk?.distance, capRisk?.asOf),
    tonShare: calculated(total > 0 ? (p.assets.find(a => a.id === 'TON')?.valueUsd || 0) / total * 100 : null, at),
    saShare: calculated(total > 0 ? (p.assets.find(a => sameAddress(a.id, C.sa))?.valueUsd || 0) / total * 100 : null, at),
    otherShare: calculated(total > 0 ? others.reduce((s, a) => s + a.valueUsd, 0) / total * 100 : null, at),
    pnl: unavailable('НЕТ ПОДТВЕРЖДЁННОЙ СЕБЕСТОИМОСТИ'), sharpe: unavailable('НЕТ ОЧИЩЕННОЙ ДОХОДНОСТИ И СТАВКИ СРАВНЕНИЯ'),
    volume7: unavailable('НЕТ НЕПЕРЕСЕКАЮЩИХСЯ ДНЕВНЫХ ОБЪЁМОВ')
  });
  paintMetrics(values);
  $('#portfolio-coverage').textContent = p.complete ? `Оценка всех обнаруженных TON и jetton-активов · ${p.assets.filter(a => a.balance > 0).length} активов с ненулевым балансом.` : `Полная оценка недоступна. Известная оценённая часть: ${format(p.known.value, 'usd')}. Неоценённые активы не принимаются за ноль.`;
  $('#account-status').textContent = p.accountStatus === 'nonexist' ? 'TonAPI: адрес не инициализирован (nonexist).' : p.accountStatus ? `Состояние контракта: ${{ active: 'активен', uninit: 'не инициализирован', frozen: 'заморожен' }[p.accountStatus] || 'получено от API'}` : 'Состояние кошелька недоступно.';
  const warnings = [];
  if (p.accountStatus === 'nonexist') warnings.push('TonAPI сообщает: указанный кошелёк ещё не инициализирован. Возвращённый баланс отображается без подмены.');
  if (market.price.value === null) warnings.push('Достоверная рыночная котировка SA не получена. Капитализация и индекс не заменяются предположениями.');
  const failures = Object.values(snapshot.sources).filter(s => s.error).length;
  if (failures) warnings.push(`Недоступных источников: ${failures}. Сохранённые показатели отмечены временем последнего успешного получения.`);
  $('#data-warning').textContent = warnings.join(' '); $('#data-warning').hidden = !warnings.length;
  if (snapshot.sources.jetton.receivedAt) lastVerification = market.verification;
  const danger = $('#verification-warning'); danger.replaceChildren(); danger.hidden = lastVerification !== 'blacklist';
  if (!danger.hidden) danger.append(document.createTextNode('ВНИМАНИЕ: TonAPI классифицирует контракт SA меткой verification: blacklist. Это метка провайдера, а не самостоятельное заключение SA BANK. Проверьте контракт и риски перед переводом средств. '), link('Проверить ответ TonAPI ↗', snapshot.sources.jetton.url));
  $('#returns').replaceChildren(...PERIODS.map(([label, days]) => returnCell(label, change(h, days))));
  $('#cap-returns').replaceChildren(...[['24Ч', 1], ['7Д', 7], ['30Д', 30], ['1Г', 365]].map(([label, days]) => returnCell(label, change(h, days, 'cap'))));
  renderAssets(p); renderOperations(snapshot); renderSentiment(h, fg); renderStatistics(h, risk); renderSources(snapshot); renderCharts();
}
function renderAssets(p) {
  if (!p.assets.length) { emptyRow('#assets-table', 'Баланс активов недоступен.', 6); return; }
  $('#assets-table').replaceChildren(...p.assets.map(a => {
    const tr = el('tr'); const asset = cell('Актив', ''); asset.append(el('span', 'asset-name', a.symbol), el('small', '', a.name));
    if (a.verification === 'blacklist') asset.append(el('small', 'negative', 'Предупреждение TonAPI: blacklist'));
    const balance = cell('Количество', format(a.balance, a.id === 'TON' ? 'ton' : 'sa').replace(/ SA$/, a.id === 'TON' ? '' : ` ${a.symbol}`));
    balance.append(el('small', '', date(a.balanceAt)));
    const price = cell('Цена · USD', format(a.price, 'usd')); if (a.price !== null) price.append(el('small', '', `Получено: ${date(a.priceAt)}`));
    const value = cell('Стоимость · USD', format(a.valueUsd, 'usd')); value.append(el('small', '', a.valueUsd === null ? NA : 'РАССЧИТАНО'));
    const share = cell('Доля', p.total.value > 0 && a.valueUsd !== null ? format(a.valueUsd / p.total.value * 100, 'pct').replace('+', '') : '—');
    tr.append(asset, balance, price, value, share, cell('Источник', '', a.explorer ? link('ПРОВЕРИТЬ В БЛОКЧЕЙНЕ ↗', a.explorer) : el('span', 'fine', NA))); return tr;
  }));
}
function renderOperations(s) {
  const ops = s.operations;
  if (!ops?.length) emptyRow('#operations-table', ops === null ? 'История операций недоступна.' : 'В доступной выборке операций нет.', 5);
  else $('#operations-table').replaceChildren(...ops.map(e => {
    const tr = el('tr'), incoming = e.transfers.some(t => t.incoming), outgoing = e.transfers.some(t => t.outgoing);
    const direction = incoming && outgoing ? 'Смешанное событие' : incoming ? 'Входящая' : outgoing ? 'Исходящая' : 'Другая операция';
    const amount = e.transfers.filter(t => t.incoming || t.outgoing).map(t => `${t.incoming ? '+' : '−'}${format(t.amount, 'ton')}`).join(' / ') || '—';
    tr.append(cell('Дата · UTC', date(e.timestamp * 1000)), cell('Направление', direction), cell('Сумма TON', amount), cell('Назначение', e.purpose), cell('Проверка', '', e.url ? link('Открыть транзакцию ↗', e.url) : el('span', '', NA))); return tr;
  }));
  const donations = ops?.flatMap(e => e.transfers.filter(t => t.donation).map(t => ({ ...t, event: e })));
  $('#donation-list').replaceChildren();
  if (!donations?.length) $('#donation-list').append(el('p', 'fine', ops === null ? 'Данные пожертвований недоступны.' : 'В доступной выборке нет подтверждённых переводов с меткой пожертвования.'));
  else for (const d of donations) {
    const row = el('div', 'donation-item'), person = el('div'); person.append(el('span', 'label', 'ОТПРАВИТЕЛЬ'), el('code', '', d.sender));
    const when = el('div'); when.append(el('time', '', date(d.event.timestamp * 1000))); if (d.event.url) when.append(link('Открыть транзакцию ↗', d.event.url));
    row.append(person, el('strong', '', format(d.amount, 'ton')), when); $('#donation-list').append(row);
  }
}
function renderSentiment(h, fg) {
  $('#fear-state').textContent = fg?.state || NA;
  $('#fear-needle').hidden = !fg; if (fg) $('#fear-needle').style.left = `${fg.value}%`;
  const previous = fearGreed(h, Date.now() - DAY);
  $('#fear-change').textContent = fg && previous ? `Изменение за 24Ч: ${format(fg.value - previous.value)} пунктов.` : 'Нет подтверждённой истории для сравнения.';
  $('#fear-history').replaceChildren(...[['24Ч', 1], ['7Д', 7], ['30Д', 30], ['3М', 90]].map(([label, d]) => {
    const old = fearGreed(h, Date.now() - d * DAY), n = el('div'); n.append(el('span', '', `${label} назад`), el('b', '', old ? String(old.value) : 'НЕДОСТУПНО')); if (old) n.append(el('span', 'meta', date(old.asOf))); return n;
  }));
}
function renderStatistics(h, risk) {
  const details = [['Максимум перед просадкой', format(risk?.peak, 'usd')], ['Минимум', format(risk?.trough, 'usd')], ['Начало', risk?.from ? date(risk.from) : '—'], ['Дно просадки', risk?.to ? date(risk.to) : '—'], ['Восстановление', risk?.recovery ? date(risk.recovery) : 'Не зафиксировано'], ['Дата исторического максимума', risk?.athAt ? date(risk.athAt) : '—']];
  $('#drawdown-details').replaceChildren(...details.map(([label, value]) => { const n = el('div', 'drawdown-line'); n.append(el('span', '', label), el('strong', '', value)); return n; }));
  const years = calendarReturns(h); $('#calendar-returns').replaceChildren(...years.map(y => returnCell(`${y.year}${y.current ? ' · с начала года' : ''}`, y.result)));
  if (!years.length) $('#calendar-returns').append(el('p', 'fine', 'НЕДОСТАТОЧНО ДАННЫХ'));
}
function renderSources(s) {
  const names = { account: 'Кошелёк', tokens: 'Токены', rates: 'Курс TON', jetton: 'Контракт SA', pairs: 'Рынок SA', events: 'Операции' };
  $('#source-status').replaceChildren(...Object.entries(s.sources).map(([k, v]) => {
    const row = el('div', 'source-row'); row.append(el('span', '', names[k]), link(v.error || 'Открыть ответ API ↗', v.url), el('time', '', v.receivedAt ? `Получено: ${date(v.receivedAt)}` : 'НЕДОСТУПНО')); return row;
  }));
}
async function readHistory() {
  try { const data = await json(dataUrl('history.json')); if (Array.isArray(data.points)) history = cleanHistory(data.points); lastHistoryLoad = Date.now(); }
  catch { /* Последняя загруженная история остаётся; финансовые точки не синтезируются. */ }
}
async function refresh() {
  if (busy) return; busy = true; document.body.classList.add('loading'); $('#refresh').disabled = true; paintMetrics(values, true);
  $('#update-label').textContent = 'ОБНОВЛЯЕТСЯ · запрос к публичным API';
  try {
    if (Date.now() - lastHistoryLoad > 300000) await readHistory();
    const snapshot = await collect(); renderSnapshot(snapshot);
    const stamps = Object.values(snapshot.sources).map(s => s.receivedAt).filter(Boolean).sort();
    $('#update-label').textContent = stamps.length ? `Последний ответ API: ${date(stamps.at(-1))} · обновление каждые 60 с` : 'API недоступны · отображаются последние успешные значения с их временем';
  } catch { $('#update-label').textContent = 'Обновление не завершено · проверьте доступность источников'; paintMetrics(values); }
  finally { busy = false; document.body.classList.remove('loading'); $('#refresh').disabled = false; }
}
createLayout(); setupControls(); loadImages();
$('#refresh').addEventListener('click', refresh);
emptyRow('#assets-table', 'Ожидание данных блокчейна…', 6); emptyRow('#operations-table', 'Ожидание данных блокчейна…', 5);
renderCharts();
try { const cached = await json(dataUrl('latest.json')); if (cached.schemaVersion === 1 && cached.portfolio?.total && cached.market?.price && cached.sources) renderSnapshot(cached); } catch { /* Снимок ещё не сформирован. */ }
await refresh(); loadWall();
setInterval(() => { if (!document.hidden) refresh(); }, C.refreshMs);
setInterval(() => { if (!document.hidden) loadWall(); }, 300000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
