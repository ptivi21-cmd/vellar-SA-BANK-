import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../config.js';
import { rawAddress, sameAddress, units, normalize, normalizeEvents } from '../lib/data.js';
import { change, observedRisk, fearGreed, lineSegments, cagr, navVolatility, DAY } from '../lib/metrics.js';
import { nanoAmount, validMessage } from '../lib/controls.js';
// Искусственные значения ниже — ТОЛЬКО тестовые фикстуры, они не экспортируются в data/ и не отображаются на сайте.
function point(t, value) { return { t: new Date(t).toISOString(), portfolioAt: new Date(t).toISOString(), totalUsd: value, complete: value !== null }; }
const NOW = Date.now() - 1000;
function fixture() {
  const at = new Date().toISOString();
  const r = Object.fromEntries(['account', 'tokens', 'rates', 'jetton', 'pairs', 'events'].map(k => [k, { url: `https://example.test/${k}`, receivedAt: at, error: null, data: null }]));
  r.account.data = { balance: 0, status: 'nonexist' }; r.tokens.data = { balances: [] };
  r.rates.data = { rates: { TON: { prices: { USD: 2 } } } }; r.jetton.data = { holders_count: 4, verification: 'blacklist' };
  r.pairs.data = []; r.events.data = { events: [] }; return r;
}
test('Нормализация и CRC адреса TON', () => {
  assert.equal(rawAddress(C.wallet), '0:e91e83e2e491c5aeec1d88a1c218eebc815696e2528dd1aaf34c0a0c5950d6ae');
  assert.equal(rawAddress(C.sa), '0:56d593e7ad5d8bba320a7f075cb48cb9edce7e445964c40643a3df8237906d4d');
  assert.equal(sameAddress(C.sa, rawAddress(C.sa)), true);
  assert.equal(rawAddress(C.wallet.slice(0, -1) + 'x'), null);
  assert.equal(sameAddress('', ''), false);
});
test('Десятичная точность TON и валидация перевода', () => {
  assert.equal(nanoAmount('0,000000001'), '1'); assert.equal(nanoAmount('5'), '5000000000');
  for (const bad of ['0', '-1', '1e3', 'NaN', '1.0000000001', '<script>', '01', '1&text=evil']) assert.equal(nanoAmount(bad), null);
  assert.equal(units('1234567890', 9), 1.23456789); assert.equal(units('1', null), null);
});
test('Настоящий ноль не является отсутствующими данными', () => {
  const s = normalize(fixture()); assert.equal(s.portfolio.total.value, 0); assert.equal(s.portfolio.complete, true);
  assert.equal(s.market.price.value, null); assert.equal(s.market.cap.value, null); assert.equal(s.market.verification, 'blacklist');
});
test('FDV не подменяет market cap, нулевая цена не котировка', () => {
  const r = fixture(); r.pairs.data = [{ chainId: 'ton', baseToken: { address: C.sa }, priceUsd: '1', fdv: 100000, liquidity: { usd: 200 } }];
  const m = normalize(r).market; assert.equal(m.cap.value, null); assert.equal(m.fdv.value, 100000);
  r.pairs.data[0].priceUsd = '0'; assert.equal(normalize(r).market.price.value, null);
});
test('Совпадение тикера без совпадения контракта не принимается', () => {
  const r = fixture(); r.pairs.data = [{ chainId: 'ton', baseToken: { address: C.wallet, symbol: 'SA' }, priceUsd: '5', marketCap: 100, liquidity: { usd: 300 } }];
  assert.equal(normalize(r).market.price.value, null);
});
test('Неоценённый актив делает полную оценку недоступной', () => {
  const r = fixture(); r.tokens.data.balances = [{ balance: '1000000000', jetton: { address: C.sa, symbol: 'SA', decimals: 9 } }];
  const s = normalize(r); assert.equal(s.portfolio.complete, false); assert.equal(s.portfolio.total.value, null); assert.equal(s.portfolio.sa.value, 1);
});
test('Несинхронные баланс и котировка не объединяются', () => {
  const r = fixture(); r.account.data.balance = 1000000000; r.rates.receivedAt = new Date(Date.now() - 600000).toISOString();
  assert.equal(normalize(r).portfolio.total.value, null);
});
test('Доходность — сравнение реальных границ, без экстраполяции', () => {
  const h = [point(NOW - 365 * DAY, 100), point(NOW, 120)];
  assert.ok(Math.abs(change(h, 365).pct - 20) < 1e-9); assert.equal(change(h, 365).absolute, 20);
  assert.equal(change([point(NOW - 350 * DAY, 100), point(NOW, 120)], 365), null);
  assert.equal(change([point(NOW - DAY, 0), point(NOW, 120)], 1), null);
  assert.equal(change([point(NOW - DAY - 3600000, 100), point(NOW, 120)], 1), null);
});
test('Просадка использует максимум до минимума; дата восстановления', () => {
  const h = [100, 120, 60, 100, 120, 140].map((v, i) => point(NOW - (5 - i) * DAY, v));
  const r = observedRisk(h); assert.equal(r.dd, -50); assert.equal(r.peak, 120); assert.equal(r.trough, 60); assert.equal(r.ath, 140); assert.equal(r.recovery, h[4].t);
});
test('Нет искусственных линий через недоступные точки или длинные пропуски', () => {
  const h = [point(NOW - 4 * DAY, 1), point(NOW - 3 * DAY, 2), point(NOW - 1000, null), point(NOW, 4)];
  assert.equal(lineSegments(h, 'totalUsd').length, 3);
});
test('CAGR и волатильность не рассчитываются по короткой истории', () => {
  assert.equal(cagr([point(NOW - DAY, 10), point(NOW, 11)]), null);
  assert.equal(navVolatility([point(NOW - DAY, 10), point(NOW, 11)]), null);
  const h = Array.from({ length: 366 }, (_, i) => point(NOW - (365 - i) * DAY, 100));
  assert.equal(navVolatility(h).daily, 0); assert.equal(cagr(h).value, 0);
});
test('Donation — только успешный перевод с меткой и получателем', () => {
  const transfer = { type: 'TonTransfer', status: 'ok', TonTransfer: { sender: { address: C.sa }, recipient: { address: C.wallet }, amount: 1000000000, comment: C.donationComment } };
  const data = { events: [{ timestamp: 100, event_id: 'a'.repeat(64), in_progress: false, actions: [transfer] }] };
  assert.equal(normalizeEvents(data)[0].transfers[0].donation, true);
  transfer.TonTransfer.comment = 'Обычное пополнение'; assert.equal(normalizeEvents(data)[0].transfers[0].donation, false);
  transfer.status = 'failed'; assert.equal(normalizeEvents(data)[0].transfers.length, 0);
});
test('Защита стены: лимит Unicode, HTML и управляющие символы', () => {
  assert.equal(validMessage('Привет, SA!'), true); assert.equal(validMessage('😀'.repeat(280)), true);
  for (const bad of ['', ' ', '😀'.repeat(281), '<img onerror=alert(1)>', 'abc\u0000def']) assert.equal(validMessage(bad), false);
});
test('Fear & Greed требует полную историю одного пула', () => {
  assert.equal(fearGreed([]), null);
  const h = Array.from({ length: 31 }, (_, i) => ({ ...point(NOW - (30 - i) * DAY, 100), marketAt: new Date(NOW - (30 - i) * DAY).toISOString(), pairAddress: 'pool-test', market: { price: 1 + i / 100, cap: 100 + i, liquidity: 10, volume24: 5, tx24: 10, buys: 5, sells: 5 } }));
  const result = fearGreed(h, NOW + 1000); assert.ok(result.value >= 0 && result.value <= 100); assert.equal(result.days, 30);
  h[5].market.cap = null; assert.equal(fearGreed(h, NOW + 1000), null);
});
