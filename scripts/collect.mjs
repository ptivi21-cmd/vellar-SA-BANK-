import fs from 'node:fs/promises';
import { collect, historyPoint } from '../lib/data.js';
import { cleanHistory } from '../lib/metrics.js';
const path = new URL('../data/', import.meta.url);
await fs.mkdir(path, { recursive: true });
let existing = { schemaVersion: 1, points: [] };
try { existing = JSON.parse(await fs.readFile(new URL('history.json', path), 'utf8')); } catch { /* Первое наблюдение. */ }
const snapshot = await collect();
if (Object.values(snapshot.sources).every(s => s.error)) throw new Error('Все источники недоступны. Последний снимок не перезаписан.');
const point = historyPoint(snapshot);
const points = cleanHistory([...(existing.points || []), point]);
// Удалять или прореживать историю автоматически нельзя: это меняет ATH, просадку и ALL TIME.
// При росте репозитория настройте проверяемый архив, сохраняя исходные временные ряды.
await fs.writeFile(new URL('latest.json', path), JSON.stringify(snapshot, null, 2) + '\n');
await fs.writeFile(new URL('history.json', path), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), points }, null, 2) + '\n');
console.log(`Сохранено реальное наблюдение: ${snapshot.observedAt}; полная оценка: ${snapshot.portfolio.complete}; история: ${points.length} точек.`);
