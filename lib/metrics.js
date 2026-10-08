import { CONFIG as C } from '../config.js';
export const DAY = 86400000;
export const PERIODS = [
  ['24Ч', 1], ['7Д', 7], ['30Д', 30], ['3М', 90], ['6М', 180], ['С начала года', 'ytd'], ['1Г', 365], ['Всё время', 'all']
];
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function cleanHistory(history) {
  const seen = new Set();
  return (Array.isArray(history) ? history : []).filter(p => {
    const t = Date.parse(p.t);
    if (!Number.isFinite(t) || t > Date.now() + 60000 || seen.has(p.t)) return false;
    seen.add(p.t); return true;
  }).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
export function pointTime(p, key = 'totalUsd') {
  return Date.parse(key === 'totalUsd' ? p.portfolioAt || p.t : p.marketAt || p.t);
}
export const field = (p, key) => key === 'totalUsd' ? (p.complete === true ? p.totalUsd : null) : p.market?.[key];
export function nearest(history, target, tolerance = C.endpointToleranceMs, key = 'totalUsd') {
  const points = history.filter(p => finite(field(p, key)) && Math.abs(pointTime(p, key) - target) <= tolerance);
  return points.sort((a, b) => Math.abs(pointTime(a, key) - target) - Math.abs(pointTime(b, key) - target))[0] || null;
}
export function change(history, days, key = 'totalUsd', endPoint = null) {
  const valid = cleanHistory(history).filter(p => finite(field(p, key)));
  const end = endPoint || valid.at(-1);
  if (!end || !finite(field(end, key))) return null;
  const endTime = pointTime(end, key);
  let start;
  if (days === 'all') start = valid[0];
  else {
    const target = days === 'ytd' ? Date.UTC(new Date(endTime).getUTCFullYear(), 0, 1) : endTime - days * DAY;
    start = nearest(valid, target, C.endpointToleranceMs, key);
  }
  if (!start || pointTime(start, key) >= endTime || field(start, key) <= 0) return null;
  const a = field(start, key), b = field(end, key);
  return { pct: (b / a - 1) * 100, absolute: b - a, start: a, end: b,
    from: new Date(pointTime(start, key)).toISOString(), to: new Date(endTime).toISOString() };
}
export function observedRisk(history, key = 'totalUsd') {
  const points = cleanHistory(history).filter(p => finite(field(p, key)) && field(p, key) >= 0);
  if (!points.length) return null;
  let ath = points[0], peak = points[0], trough = null, drawPeak = null, dd = 0;
  for (const p of points) {
    if (field(p, key) > field(ath, key)) ath = p;
    if (field(p, key) > field(peak, key)) peak = p;
    if (field(peak, key) > 0) {
      const d = (field(p, key) / field(peak, key) - 1) * 100;
      if (d < dd) { dd = d; trough = p; drawPeak = peak; }
    }
  }
  const recovery = trough ? points.find(p => pointTime(p, key) > pointTime(trough, key) && field(p, key) >= field(drawPeak, key)) : null;
  const latest = points.at(-1);
  return { ath: field(ath, key), athAt: new Date(pointTime(ath, key)).toISOString(),
    distance: field(ath, key) > 0 ? (field(latest, key) / field(ath, key) - 1) * 100 : null,
    dd: points.length > 1 && field(ath, key) > 0 ? dd : null,
    peak: drawPeak ? field(drawPeak, key) : null, trough: trough ? field(trough, key) : null,
    from: drawPeak ? new Date(pointTime(drawPeak, key)).toISOString() : null,
    to: trough ? new Date(pointTime(trough, key)).toISOString() : null,
    recovery: recovery ? new Date(pointTime(recovery, key)).toISOString() : null,
    asOf: new Date(pointTime(latest, key)).toISOString(), first: points[0].t };
}
export function dailySeries(history, key = 'totalUsd', days = 365) {
  const valid = cleanHistory(history).filter(p => finite(field(p, key)));
  const end = valid.at(-1);
  if (!end) return [];
  const result = [];
  for (let d = days; d >= 0; d--) {
    const p = nearest(valid, pointTime(end, key) - d * DAY, C.endpointToleranceMs, key);
    if (!p || field(p, key) <= 0) return [];
    result.push(p);
  }
  return result;
}
export function navVolatility(history) {
  // Только волатильность наблюдаемой стоимости, НЕ доходности стратегии.
  const points = dailySeries(history, 'totalUsd', 365);
  if (points.length !== 366) return null;
  const returns = points.slice(1).map((p, i) => Math.log(p.totalUsd / points[i].totalUsd));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1));
  return { daily: sd * 100, monthly: sd * Math.sqrt(30) * 100, annual: sd * Math.sqrt(365) * 100,
    from: points[0].t, to: points.at(-1).t };
}
export function cagr(history) {
  const points = cleanHistory(history);
  const c = change(points, 'all');
  if (!c) return null;
  const years = (Date.parse(c.to) - Date.parse(c.from)) / (365 * DAY);
  if (years < 1 || c.end <= 0) return null;
  return { value: ((c.end / c.start) ** (1 / years) - 1) * 100, ...c };
}
export function calendarReturns(history) {
  const valid = cleanHistory(history).filter(p => finite(field(p, 'totalUsd')));
  if (!valid.length) return [];
  const firstYear = new Date(pointTime(valid[0])).getUTCFullYear();
  const lastYear = new Date(pointTime(valid.at(-1))).getUTCFullYear();
  const result = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const start = nearest(valid, Date.UTC(y, 0, 1));
    const end = y === lastYear ? valid.at(-1) : nearest(valid, Date.UTC(y + 1, 0, 1));
    result.push({ year: y, current: y === lastYear,
      result: start && end && start.totalUsd > 0 ? { pct: (end.totalUsd / start.totalUsd - 1) * 100, absolute: end.totalUsd - start.totalUsd, from: start.t, to: end.t } : null });
  }
  return result;
}
const clamp = n => Math.max(0, Math.min(100, n));
function percentile(values, inverse = false) {
  const last = values.at(-1);
  const less = values.filter(v => v < last).length;
  const equal = values.filter(v => v === last).length;
  const rank = 100 * (less + equal / 2) / values.length;
  return inverse ? 100 - rank : rank;
}
export function fearGreed(history, at = Date.now()) {
  // Собственная открытая методика SA, не индекс Alternative.me.
  const h = cleanHistory(history).filter(p => Date.parse(p.t) <= at);
  const eligible = h.filter(p => ['price', 'cap', 'liquidity'].every(k => finite(p.market?.[k]) && p.market[k] > 0)
    && ['volume24', 'tx24', 'buys', 'sells'].every(k => finite(p.market?.[k]) && p.market[k] >= 0));
  const end = eligible.at(-1);
  if (!end || at - pointTime(end, 'price') > 2 * 3600000) return null;
  const daily = [];
  for (let d = 30; d >= 0; d--) {
    const p = nearest(eligible, pointTime(end, 'price') - d * DAY, 2 * 3600000, 'price');
    if (!p || !p.pairAddress || p.pairAddress !== end.pairAddress) return null;
    daily.push(p.market);
  }
  const priceMoves = daily.slice(1).map((m, i) => Math.log(m.price / daily[i].price));
  const capMoves = daily.slice(1).map((m, i) => Math.log(m.cap / daily[i].cap));
  const last = daily.at(-1), orders = last.buys + last.sells;
  if (!orders || daily.every(m => m.volume24 === 0)) return null;
  const components = {
    momentum: percentile(priceMoves), capitalization: percentile(capMoves),
    volume: percentile(daily.map(m => m.volume24)), liquidity: percentile(daily.map(m => m.liquidity / m.cap)),
    volatility: percentile(priceMoves.map(Math.abs), true), activity: percentile(daily.map(m => m.tx24)),
    pressure: clamp(last.buys / orders * 100)
  };
  const weights = { momentum: .20, capitalization: .15, volume: .15, liquidity: .15, volatility: .15, activity: .10, pressure: .10 };
  const value = Math.round(Object.entries(components).reduce((s, [k, v]) => s + v * weights[k], 0));
  const state = value <= 24 ? 'КРАЙНИЙ СТРАХ' : value <= 44 ? 'СТРАХ' : value <= 55 ? 'НЕЙТРАЛЬНО' : value <= 75 ? 'ЖАДНОСТЬ' : 'КРАЙНЯЯ ЖАДНОСТЬ';
  return { value, state, asOf: end.marketAt, components, days: 30 };
}
export function lineSegments(history, key, maxGap = C.maxHistoryGapMs) {
  const segments = []; let current = [], previous = null;
  for (const p of cleanHistory(history)) {
    const value = field(p, key), t = pointTime(p, key);
    if (!finite(value) || (previous !== null && t - previous > maxGap)) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (finite(value)) current.push({ t, value });
    previous = t;
  }
  if (current.length) segments.push(current);
  return segments;
}
