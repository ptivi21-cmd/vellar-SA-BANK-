import fs from 'node:fs/promises';
// Работа только в GitHub Actions. Токен не передаётся браузеру и не записывается в data/.
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !token) throw new Error('Нет настроек GitHub Actions.');
const api = `https://api.github.com/repos/${repository}`;
const approved = 'sa-wall-approved';
const valid = value => typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= 280 && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
async function request(path, method = 'GET', body) {
  const result = await fetch(api + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  if (!result.ok) throw new Error(`GitHub API: ${result.status}`);
  return result.status === 204 ? null : result.json();
}
function message(issue) {
  try { const body = JSON.parse(issue.body); return body.type === 'sa-wall' && valid(body.message) ? body.message.trim() : null; }
  catch { return null; }
}
function hasApproval(issue) { return (issue.labels || []).some(l => l.name === approved); }
let event = {};
if (process.env.GITHUB_EVENT_PATH) event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;
if (issue && (issue.title?.startsWith('[СТЕНА SA]') || hasApproval(issue))) {
  // Любое редактирование содержания снимает одобрение; новая версия требует повторной проверки.
  if (event.action === 'edited' && hasApproval(issue)) await request(`/issues/${issue.number}/labels/${approved}`, 'DELETE');
  const text = message(issue);
  if (issue.state === 'open' && !text) {
    await request(`/issues/${issue.number}/comments`, 'POST', { body: 'Стена SA: сообщение отклонено. Требуется JSON с type: "sa-wall" и message от 1 до 280 символов без HTML и управляющих символов. Используйте форму на сайте.' });
    await request(`/issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'not_planned' });
  } else if (issue.state === 'open' && event.action === 'opened') {
    const recent = await request('/issues?state=all&sort=created&direction=desc&per_page=100');
    const recentByAuthor = recent.find(i => i.number !== issue.number && i.user?.login === issue.user?.login && i.title?.startsWith('[СТЕНА SA]') && Date.parse(i.created_at) < Date.parse(issue.created_at) && Date.parse(issue.created_at) - Date.parse(i.created_at) < 600000);
    if (recentByAuthor) {
      await request(`/issues/${issue.number}/comments`, 'POST', { body: 'Стена SA: не более одного сообщения за 10 минут. Публикация отклонена.' });
      await request(`/issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'not_planned' });
    }
  }
}
// Только открытые записи с меткой, которую может выставить модератор репозитория.
const entries = [];
for (let page = 1; page <= 5; page++) {
  const list = await request(`/issues?state=open&labels=${approved}&sort=created&direction=desc&per_page=100&page=${page}`);
  entries.push(...list); if (list.length < 100) break;
}
const accepted = [];
const lastByAuthor = new Map();
for (const i of entries.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
  const text = message(i), author = i.user?.login, time = Date.parse(i.created_at);
  if (i.pull_request || !text || !/^[A-Za-z0-9-]{1,39}$/.test(author || '') || !Number.isFinite(time)) continue;
  if (lastByAuthor.has(author) && time - lastByAuthor.get(author) < 600000) continue;
  lastByAuthor.set(author, time);
  accepted.push({ author, message: text, createdAt: i.created_at, issueUrl: `https://github.com/${repository}/issues/${i.number}` });
}
const messages = accepted.reverse().slice(0, 50);
await fs.writeFile(new URL('../data/wall.json', import.meta.url), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), messages }, null, 2) + '\n');
console.log(`Опубликовано прошедших модерацию сообщений: ${messages.length}.`);
