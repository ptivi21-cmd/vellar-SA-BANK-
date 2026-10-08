import { NA } from './data.js';
import { lineSegments, DAY } from './metrics.js';
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export function el(tag, className = '', text = '') {
  const n = document.createElement(tag); if (className) n.className = className; if (text !== '') n.textContent = text; return n;
}
export const date = value => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) + ' UTC' : 'Время неизвестно';
export function format(value, type = 'number') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  if (type === 'usd' || type === 'signedUsd') return (type === 'signedUsd' && v > 0 ? '+' : '') + new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < .01 && v !== 0 ? 8 : 2 }).format(v);
  if (type === 'pct') return (v > 0 ? '+' : '') + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v) + '%';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: type === 'ton' ? 9 : type === 'sa' ? 6 : 2 }).format(v) + (type === 'ton' ? ' TON' : type === 'sa' ? ' SA' : '');
}
export function link(label, href, className = 'text-link') {
  const a = el('a', className, label);
  try { const u = new URL(href); if (u.protocol !== 'https:') return el('span', 'fine', label); a.href = u.href; }
  catch { return el('span', 'fine', label); }
  a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
export function card(label, key, type = 'number', note = '') {
  const a = el('article', 'panel stats-card'); a.append(el('span', 'label', label));
  const v = el('strong', 'stat-value', '—'); v.dataset.metric = key; v.dataset.format = type;
  const meta = el('span', 'meta'); meta.dataset.meta = key;
  a.append(v, meta); if (note) a.append(el('p', 'fine', note)); return a;
}
export function paintMetrics(metrics, updating = false) {
  for (const n of $$('[data-metric]')) {
    const m = metrics[n.dataset.metric];
    n.textContent = format(m?.value, n.dataset.format);
    n.dataset.status = m?.status || 'UNAVAILABLE';
    n.title = m?.value !== null && m?.value !== undefined ? `${m.status === 'CALCULATED' ? 'Рассчитано' : 'Данные API'} · ${date(m.asOf)}${m.stale ? ' · Устаревшие данные' : ''}${m.source ? ' · ' + m.source : ''}` : m?.reason || NA;
  }
  for (const n of $$('[data-meta]')) {
    const m = metrics[n.dataset.meta]; n.replaceChildren();
    if (m?.value === null || m?.value === undefined) { n.textContent = updating ? 'ОБНОВЛЯЕТСЯ…' : m?.reason || NA; continue; }
    const old = m.stale || Date.now() - Date.parse(m.asOf) > 2 * 60000;
    n.append(document.createTextNode(`${m.status === 'CALCULATED' ? '◇ РАССЧИТАНО' : old ? '● ПОСЛЕДНИЕ ДАННЫЕ' : '● АКТУАЛЬНО'}${old ? ' · УСТАРЕЛО' : ''}${updating ? ' · ОБНОВЛЯЕТСЯ' : ''}`));
    n.append(el('br'), document.createTextNode(`${date(m.asOf)} · `));
    if (m.source) n.append(link('Источник ↗', m.source, '')); else n.append(document.createTextNode('По подтверждённой истории'));
  }
}
export function unavailableList(target, labels, text = 'НЕ ПОДТВЕРЖДЕНО') {
  $(target).replaceChildren(...labels.map(label => { const row = el('div'); row.append(el('span', '', label), el('b', '', text)); return row; }));
}
export function returnCell(label, result, reason = 'НЕДОСТАТОЧНО ДАННЫХ') {
  const n = el('div', 'return-cell'); n.append(el('span', 'label', label));
  n.append(el('strong', result ? result.pct >= 0 ? 'positive' : 'negative' : '', result ? format(result.pct, 'pct') : '—'));
  n.append(el('span', 'fine', result ? format(result.absolute, 'signedUsd') : reason));
  if (result) { n.append(el('time', '', `◇ РАССЧИТАНО · ${date(result.from)} → ${date(result.to)}`)); }
  return n;
}
export function emptyRow(target, message, columns) {
  const td = el('td', 'empty-cell', message); td.colSpan = columns; const tr = el('tr'); tr.append(td); $(target).replaceChildren(tr);
}
export function cell(label, text, child = null) {
  const td = el('td', '', text); td.dataset.label = label; if (child) td.append(child); return td;
}
let toastTimer;
export function toast(text) { const n = $('#toast'); n.textContent = text; n.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { n.hidden = true; }, 4000); }
function svgNode(tag, attrs = {}, text) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text !== undefined) n.textContent = text; return n;
}
export function chart(target, history, key, days = 30) {
  const container = $(target); container.replaceChildren();
  const end = history.length ? Date.parse(history.at(-1).t) : Date.now();
  const selected = history.filter(p => days === 'all' || Date.parse(p.t) >= end - days * DAY);
  const segments = lineSegments(selected, key); const all = segments.flat();
  if (!all.length) {
    const empty = el('div', 'chart-empty', 'ДАННЫЕ НЕДОСТУПНЫ');
    empty.append(el('p', '', 'График появится после накопления достоверных наблюдений. История не создаётся искусственно.')); container.append(empty); return;
  }
  const W = 900, H = 250, L = 68, R = 16, T = 32, B = 30;
  const loT = Math.min(...all.map(p => p.t)), hiT = Math.max(...all.map(p => p.t));
  const loV = Math.min(...all.map(p => p.value)), hiV = Math.max(...all.map(p => p.value));
  const range = hiV - loV || Math.max(1, Math.abs(hiV) * .1);
  const low = Math.max(0, loV - range * .12), high = hiV + range * .12;
  const x = t => hiT === loT ? W / 2 : L + (t - loT) / (hiT - loT) * (W - L - R);
  const y = v => T + (high - v) / (high - low || 1) * (H - T - B);
  const svg = svgNode('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', tabindex: '0', 'aria-label': 'История в USD. Стрелки влево и вправо — просмотр точек.' });
  for (let i = 0; i < 4; i++) {
    const v = low + (high - low) * i / 3, yy = y(v);
    svg.append(svgNode('line', { x1: L, x2: W - R, y1: yy, y2: yy, stroke: '#2c252b', 'stroke-dasharray': '3 5' }));
    svg.append(svgNode('text', { x: L - 10, y: yy + 4, fill: '#9b8b94', 'font-size': 10, 'text-anchor': 'end' }, new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(v)));
  }
  for (const segment of segments) {
    if (segment.length > 1) svg.append(svgNode('polyline', { points: segment.map(p => `${x(p.t)},${y(p.value)}`).join(' '), fill: 'none', stroke: '#c44654', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
    for (const p of segment) if (all.length < 80 || segment.length === 1) svg.append(svgNode('circle', { cx: x(p.t), cy: y(p.value), r: 2.5, fill: '#ce6871' }));
  }
  for (const [t, anchor] of [[loT, 'start'], [hiT, 'end']]) svg.append(svgNode('text', { x: x(t), y: H - 7, fill: '#9b8b94', 'font-size': 10, 'text-anchor': anchor }, new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t)));
  if (all.length === 1) svg.append(svgNode('text', { x: W / 2, y: 20, 'text-anchor': 'middle', fill: '#bca5af', 'font-size': 11 }, 'Одно наблюдение — динамика ещё не сформирована'));
  const cursor = svgNode('line', { x1: 0, x2: 0, y1: T, y2: H - B, stroke: '#c2ad95', opacity: 0 }); svg.append(cursor);
  const tip = el('div', 'chart-tip'); tip.hidden = true; tip.setAttribute('role', 'status');
  let index = all.length - 1;
  function show(i) {
    index = Math.max(0, Math.min(all.length - 1, i)); const p = all[index], prev = all[index - 1];
    const delta = prev && p.t - prev.t <= 2 * 3600000 ? p.value - prev.value : null;
    tip.replaceChildren(el('div', '', date(p.t)), el('div', '', format(p.value, 'usd')), el('div', '', delta === null ? 'Нет сопоставимой предыдущей точки' : `К предыдущей точке: ${format(delta, 'signedUsd')}`));
    tip.hidden = false; cursor.setAttribute('x1', x(p.t)); cursor.setAttribute('x2', x(p.t)); cursor.setAttribute('opacity', 1);
  }
  svg.addEventListener('pointermove', event => { const box = svg.getBoundingClientRect(), mx = (event.clientX - box.left) / box.width * W; let best = 0; all.forEach((p, i) => { if (Math.abs(x(p.t) - mx) < Math.abs(x(all[best].t) - mx)) best = i; }); show(best); });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cursor.setAttribute('opacity', 0); });
  svg.addEventListener('focus', () => show(index));
  svg.addEventListener('blur', () => { tip.hidden = true; cursor.setAttribute('opacity', 0); });
  svg.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); show(index + (e.key === 'ArrowRight' ? 1 : -1)); } });
  container.append(svg, tip);
}
