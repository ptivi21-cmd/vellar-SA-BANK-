import { CONFIG as C } from '../config.js';
import { dataUrl, json } from './data.js';
import { $, $$, el, link, date, toast } from './ui.js';
export function nanoAmount(input) {
  const text = String(input).trim().replace(',', '.');
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,9})?$/.test(text)) return null;
  const [whole, part = ''] = text.split('.');
  const nano = BigInt(whole) * 1000000000n + BigInt(part.padEnd(9, '0'));
  return nano > 0n ? nano.toString() : null;
}
export function validMessage(text) {
  return typeof text === 'string' && text.trim().length > 0 && [...text.trim()].length <= 280
    && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text);
}
export function setupControls() {
  $('#year').textContent = new Date().getUTCFullYear();
  $$('[data-address]').forEach(n => { n.textContent = C[n.dataset.address]; });
  $$('[data-explorer]').forEach(n => { n.href = `https://tonviewer.com/${C[n.dataset.explorer]}`; n.target = '_blank'; n.rel = 'noopener noreferrer'; });
  $$('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(C[button.dataset.copy]); toast('Адрес скопирован'); }
    catch { toast('Не удалось скопировать. Выделите и скопируйте адрес вручную.'); }
  }));
  $('#menu-toggle').addEventListener('click', () => {
    const open = $('#navigation').classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', String(open)); $('#menu-toggle').setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });
  function closeMenu() { $('#navigation').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); $('#menu-toggle').setAttribute('aria-label', 'Открыть меню'); }
  $$('#navigation a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  if (/^https:\/\//i.test(C.vellarUrl)) { $('#vellar-link').href = C.vellarUrl; $('#vellar-link').target = '_blank'; $('#vellar-link').rel = 'noopener noreferrer'; $('#vellar-link').hidden = false; $('#vellar-missing').hidden = true; }
  function updateDonation() {
    const amount = nanoAmount($('#amount-input').value); const a = $('#open-wallet');
    $('#amount-error').textContent = amount ? '' : 'Введите положительную сумму TON: не более 9 знаков до и после запятой.';
    a.setAttribute('aria-disabled', String(!amount));
    if (amount) a.href = `ton://transfer/${C.wallet}?amount=${amount}&text=${encodeURIComponent(C.donationComment)}`;
    else a.removeAttribute('href');
  }
  $$('[data-amount]').forEach(b => b.addEventListener('click', () => {
    $$('.donation-amounts button').forEach(n => { n.classList.toggle('selected', n === b); n.setAttribute('aria-pressed', String(n === b)); });
    $('#amount-input').value = b.dataset.amount; $('#amount-label').hidden = true; updateDonation();
  }));
  $('#custom-amount').addEventListener('click', () => {
    $$('.donation-amounts button').forEach(n => { n.classList.toggle('selected', n === $('#custom-amount')); n.setAttribute('aria-pressed', String(n === $('#custom-amount'))); });
    $('#amount-label').hidden = false; $('#amount-input').focus();
  });
  $('#amount-input').addEventListener('input', updateDonation);
  $('#open-wallet').addEventListener('click', e => { if (!nanoAmount($('#amount-input').value)) e.preventDefault(); });
  updateDonation();
  $('#wall-message').addEventListener('input', () => { const length = [...$('#wall-message').value.trim()].length; $('#wall-counter').textContent = `${length} / 280`; $('#wall-counter').classList.toggle('negative', length > 280); });
  $('#wall-form').addEventListener('submit', event => {
    event.preventDefault(); const text = $('#wall-message').value.trim();
    if (!validMessage(text)) { $('#wall-status').textContent = 'От 1 до 280 символов. HTML, угловые скобки и управляющие символы не допускаются.'; return; }
    if (!/^[\w.-]+\/[\w.-]+$/.test(C.repository)) { $('#wall-status').textContent = 'Публикация ещё не подключена: владелец должен указать GitHub-репозиторий в config.js.'; return; }
    let last = 0; try { last = Number(localStorage.getItem('sa-wall-last-attempt') || 0); } catch { /* Публикация не зависит от localStorage. */ }
    if (Date.now() - last < 600000) { $('#wall-status').textContent = 'Не более одного сообщения за 10 минут. Пожалуйста, подождите.'; return; }
    const body = JSON.stringify({ type: 'sa-wall', message: text }, null, 2);
    const url = `https://github.com/${C.repository}/issues/new?title=${encodeURIComponent('[СТЕНА SA] Сообщение сообществу')}&body=${encodeURIComponent(body)}`;
    try { localStorage.setItem('sa-wall-last-attempt', String(Date.now())); } catch { /* Основная защита — Actions и модерация. */ }
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    $('#wall-status').replaceChildren(document.createTextNode('Завершите отправку на GitHub. Затем сообщение должно пройти модерацию. '), link('Открыть форму GitHub ↗', url));
  });
}
export async function loadWall() {
  try {
    const data = await json(dataUrl('wall.json'));
    if (!Array.isArray(data.messages)) throw new Error('schema');
    const valid = data.messages.filter(m => validMessage(m.message) && typeof m.author === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(m.author) && Number.isFinite(Date.parse(m.createdAt)));
    $('#wall-messages').replaceChildren();
    if (!valid.length) $('#wall-messages').append(el('div', 'panel fine', 'Пока нет опубликованных сообщений. Здесь появятся записи, прошедшие модерацию.'));
    for (const m of valid.slice(0, 50)) {
      const n = el('article', 'message'), heading = el('div', 'message-heading');
      heading.append(el('span', 'avatar', m.author.slice(0, 1).toUpperCase()), link(m.author, `https://github.com/${encodeURIComponent(m.author)}`, ''), el('time', '', date(m.createdAt)));
      n.append(heading, el('p', '', m.message));
      if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(m.issueUrl || '')) n.append(link('Обсуждение на GitHub ↗', m.issueUrl));
      $('#wall-messages').append(n);
    }
    if (data.generatedAt) $('#wall-messages').append(el('span', 'fine', `Обновление стены: ${date(data.generatedAt)}`));
  } catch {
    if (!$('#wall-messages').children.length) $('#wall-messages').append(el('div', 'panel fine', 'Стена временно недоступна. Попробуйте позже.'));
  }
  if (!C.repository) $('#wall-status').textContent = 'Для публикации владелец сайта должен настроить GitHub-репозиторий и модерацию.';
}
export async function loadImages() {
  let available = [];
  try { available = (await json('assets/manifest.json')).available || []; } catch { /* Резервное CSS-оформление. */ }
  for (const name of available) {
    if (!(name in C.images)) continue;
    const path = C.images[name]; if (!path.startsWith('assets/') || path.includes('..')) continue;
    const image = new Image(); image.src = path;
    try { await image.decode(); } catch { continue; }
    $$(`[data-art="${name}"]`).forEach(n => { n.src = path; n.hidden = false; if (name === 'bank') { const fallback = n.parentNode.querySelector('.brand-fallback'); if (fallback) fallback.hidden = true; } });
    if (name === 'hero') { $('#top').style.backgroundImage = `url("${path}")`; $('#top').classList.add('has-art'); }
    if (name === 'donation') $('.donation-art').style.backgroundImage = `url("${path}")`;
    if (name === 'wall') { $('.wall-banner').style.backgroundImage = `url("${path}")`; $('.wall-banner').hidden = false; }
  }
  if (!available.includes('hero')) {
    const notice = el('span', 'fine', 'Резервное оформление · официальный artwork ещё не подключён');
    $('.hero-content').append(notice);
  }
}
