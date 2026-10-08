import { CONFIG as C } from '../config.js';
export const NA = 'ДАННЫЕ НЕДОСТУПНЫ';
export function rawAddress(address) {
  if (typeof address !== 'string') return null;
  if (/^-?\d+:[0-9a-f]{64}$/i.test(address)) return address.toLowerCase();
  try {
    const bytes = Uint8Array.from(atob(address.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (bytes.length !== 36) return null;
    let crc = 0;
    for (const byte of bytes.slice(0, 34)) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
    if (bytes[34] !== (crc >> 8) || bytes[35] !== (crc & 255)) return null;
    if ((bytes[0] & 0x7f) !== 0x11 && (bytes[0] & 0x7f) !== 0x51) return null;
    return `${bytes[1] > 127 ? bytes[1] - 256 : bytes[1]}:${Array.from(bytes.slice(2, 34), n => n.toString(16).padStart(2, '0')).join('')}`;
  } catch { return null; }
}
export const sameAddress = (a, b) => !!rawAddress(a) && rawAddress(a) === rawAddress(b);
export const num = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
export const positive = x => num(x) > 0 ? num(x) : null;
export const nonnegative = x => num(x) !== null && num(x) >= 0 ? num(x) : null;
export function units(raw, decimals) {
  const d = num(decimals);
  if (d === null || !Number.isInteger(d) || d < 0 || d > 30 || !/^\d+$/.test(String(raw))) return null;
  return nonnegative(Number(raw) / 10 ** d);
}
export function metric(value, asOf, source, calculated = false, extra = {}) {
  return { value: num(value), asOf: asOf || null, source: source || null,
    status: num(value) === null ? 'UNAVAILABLE' : calculated ? 'CALCULATED' : 'REAL', ...extra };
}
export async function json(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), C.requestTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function resource(url) {
  try { const data = await json(url); return { url, receivedAt: new Date().toISOString(), data, error: null }; }
  catch (e) { return { url, receivedAt: null, data: null, error: e.name === 'AbortError' ? 'Время ожидания истекло' : 'Источник временно недоступен' }; }
}
export async function collect() {
  const w = encodeURIComponent(C.wallet), sa = encodeURIComponent(C.sa);
  const paths = {
    account: `${C.api.ton}/accounts/${w}`,
    tokens: `${C.api.ton}/accounts/${w}/jettons?currencies=usd`,
    rates: `${C.api.ton}/rates?tokens=ton&currencies=usd`,
    jetton: `${C.api.ton}/jettons/${sa}`,
    pairs: `${C.api.dex}/${sa}`,
    events: `${C.api.ton}/accounts/${w}/events?limit=100`
  };
  const results = await Promise.all(Object.entries(paths).map(async ([key, url]) => [key, await resource(url)]));
  return normalize(Object.fromEntries(results));
}
export function normalize(r) {
  const now = new Date().toISOString();
  const account = r.account.data, tokens = r.tokens.data, rates = r.rates.data;
  const meta = r.jetton.data;
  // Тикер не идентифицирует актив. Сравнение только по полному адресу master-контракта.
  const pairs = Array.isArray(r.pairs.data) ? r.pairs.data.filter(p =>
    p.chainId === 'ton' && sameAddress(p.baseToken?.address, C.sa) && positive(p.priceUsd) && positive(p.liquidity?.usd)
  ).sort((a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd)) : [];
  const pair = pairs[0]; // Один наиболее ликвидный пул, не сумма дублирующих рынков.
  const marketAt = r.pairs.receivedAt;
  const m = (v, calculated = false) => metric(v, marketAt, r.pairs.url, calculated);
  const price = positive(pair?.priceUsd);
  const cap = positive(pair?.marketCap); // FDV никогда не подменяет капитализацию.
  const market = {
    price: m(price), cap: m(cap), fdv: m(positive(pair?.fdv)),
    liquidity: m(positive(pair?.liquidity?.usd)), volume24: m(nonnegative(pair?.volume?.h24)),
    tx24: m(pair && num(pair.txns?.h24?.buys) !== null && num(pair.txns?.h24?.sells) !== null ? Number(pair.txns.h24.buys) + Number(pair.txns.h24.sells) : null, true),
    buys: m(nonnegative(pair?.txns?.h24?.buys)), sells: m(nonnegative(pair?.txns?.h24?.sells)),
    priceChange24: m(num(pair?.priceChange?.h24)),
    holders: metric(nonnegative(meta?.holders_count), r.jetton.receivedAt, r.jetton.url),
    supply: metric(units(meta?.total_supply, meta?.metadata?.decimals), r.jetton.receivedAt, r.jetton.url),
    liquidityRatio: m(cap && positive(pair?.liquidity?.usd) ? Number(pair.liquidity.usd) / cap * 100 : null, true),
    verification: meta?.verification || null, pairAddress: pair?.pairAddress || null,
    priceScope: 'Наиболее ликвидный доступный пул SA; объём и сделки относятся только к этому пулу.'
  };
  const assets = [];
  const tonBalance = units(account?.balance, 9);
  const tonPrice = positive(rates?.rates?.TON?.prices?.USD);
  if (tonBalance !== null) assets.push({ id: 'TON', symbol: 'TON', name: 'Toncoin', balance: tonBalance,
    rawBalance: account.balance, price: tonPrice, balanceAt: r.account.receivedAt, priceAt: r.rates.receivedAt,
    source: r.account.url, explorer: `https://tonviewer.com/${C.wallet}` });
  if (Array.isArray(tokens?.balances)) {
    for (const row of tokens.balances) {
      const b = units(row.balance, row.jetton?.decimals);
      if (b === 0) continue;
      const isSA = sameAddress(row.jetton?.address, C.sa);
      const tokenPrice = isSA ? price : positive(row.price?.prices?.USD);
      assets.push({ id: row.jetton?.address || '', symbol: String(row.jetton?.symbol || 'Токен').slice(0, 24),
        name: String(row.jetton?.name || 'Неизвестный актив').slice(0, 100), balance: b, rawBalance: row.balance,
        price: tokenPrice, balanceAt: r.tokens.receivedAt, priceAt: isSA ? marketAt : r.tokens.receivedAt,
        source: r.tokens.url, explorer: rawAddress(row.jetton?.address) ? `https://tonviewer.com/${encodeURIComponent(row.jetton.address)}` : null,
        verification: row.jetton?.verification || null });
    }
  }
  for (const a of assets) {
    a.skewMs = a.balanceAt && a.priceAt ? Math.abs(Date.parse(a.balanceAt) - Date.parse(a.priceAt)) : Infinity;
    a.valueUsd = a.balance === 0 ? 0 : a.balance !== null && a.price !== null && a.skewMs <= C.maxSourceSkewMs ? a.balance * a.price : null;
  }
  const complete = tonBalance !== null && Array.isArray(tokens?.balances) && assets.every(a => a.valueUsd !== null);
  const knownUsd = assets.reduce((s, a) => s + (a.valueUsd ?? 0), 0);
  const portfolioAt = r.account.receivedAt && r.tokens.receivedAt ? [r.account.receivedAt, r.tokens.receivedAt, ...assets.filter(a => a.balance > 0).map(a => a.priceAt)].filter(Boolean).sort()[0] : null;
  const allTimes = [r.account.receivedAt, r.tokens.receivedAt, ...assets.filter(a => a.balance > 0).map(a => a.priceAt)].filter(Boolean).map(Date.parse);
  const coherent = allTimes.length > 0 && Math.max(...allTimes) - Math.min(...allTimes) <= C.maxSourceSkewMs;
  const saAsset = assets.find(a => sameAddress(a.id, C.sa));
  const saBalance = Array.isArray(tokens?.balances) ? (saAsset ? saAsset.balance : 0) : null;
  const portfolio = {
    total: metric(complete && coherent ? knownUsd : null, portfolioAt, r.account.url, true),
    known: metric(tonBalance !== null || Array.isArray(tokens?.balances) ? knownUsd : null, portfolioAt, r.account.url, true),
    ton: metric(tonBalance, r.account.receivedAt, r.account.url),
    sa: metric(saBalance, r.tokens.receivedAt, r.tokens.url),
    count: metric(tonBalance !== null && Array.isArray(tokens?.balances) && assets.every(a => a.balance !== null) ? assets.filter(a => a.balance > 0).length : null, portfolioAt, r.tokens.url, true),
    complete: complete && coherent, assets, accountStatus: account?.status || null
  };
  const operations = normalizeEvents(r.events.data);
  return { schemaVersion: 1, observedAt: now, portfolio, market, operations,
    sources: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { url: v.url, receivedAt: v.receivedAt, error: v.error }])) };
}
export function normalizeEvents(data) {
  if (!Array.isArray(data?.events)) return null;
  return data.events.filter(e => !e.in_progress && Number.isFinite(e.timestamp)).map(e => {
    const transfers = (e.actions || []).filter(a => a.type === 'TonTransfer' && a.status === 'ok').map(a => {
      const t = a.TonTransfer;
      const incoming = sameAddress(t?.recipient?.address, C.wallet);
      const outgoing = sameAddress(t?.sender?.address, C.wallet);
      const bounced = t?.comment?.startsWith('bounced') || false;
      return { amount: units(t?.amount, 9), incoming, outgoing,
        sender: t?.sender?.address || null, recipient: t?.recipient?.address || null,
        comment: typeof t?.comment === 'string' ? t.comment : '',
        // Успешный перевод с явной публичной меткой. Простое пополнение не считается donation.
        donation: incoming && !outgoing && !bounced && units(t?.amount, 9) > 0 && t?.comment === C.donationComment };
    });
    const hash = /^[a-f0-9]{64}$/i.test(e.event_id || '') ? e.event_id : null;
    return { id: hash, timestamp: e.timestamp, transfers,
      actionCount: Array.isArray(e.actions) ? e.actions.length : 0,
      url: hash ? `https://tonviewer.com/transaction/${hash}` : null,
      purpose: transfers.some(t => t.donation) ? 'Пожертвование с публичной меткой' : 'НАЗНАЧЕНИЕ ОПЕРАЦИИ НЕ ОПРЕДЕЛЕНО' };
  });
}
export function historyPoint(snapshot) {
  return { t: snapshot.observedAt, portfolioAt: snapshot.portfolio.total.asOf,
    totalUsd: snapshot.portfolio.total.value, complete: snapshot.portfolio.complete,
    marketAt: snapshot.market.price.asOf,
    market: Object.fromEntries(['price', 'cap', 'liquidity', 'volume24', 'tx24', 'buys', 'sells'].map(k => [k, snapshot.market[k].value])),
    pairAddress: snapshot.market.pairAddress,
    sources: snapshot.sources };
}
export function dataUrl(name) {
  if (/^[\w.-]+\/[\w.-]+$/.test(C.repository)) return `https://raw.githubusercontent.com/${C.repository}/${encodeURIComponent(C.branch)}/data/${name}`;
  return `data/${name}`;
}
