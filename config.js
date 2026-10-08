// Публичные настройки. Никогда не помещайте сюда приватные ключи или API-секреты.
export const CONFIG = Object.freeze({
  wallet: 'UQDpHoPi5JHFruwdiKHCGO68gVaW4lKN0arzTAoMWVDWrjuv',
  sa: 'EQBW1ZPnrV2LujIKfwdctIy57c5-RFlkxAZDo9-CN5BtTWmC',
  refreshMs: 60_000,
  requestTimeoutMs: 15_000,
  maxSourceSkewMs: 90_000,
  maxHistoryGapMs: 2 * 60 * 60 * 1000,
  endpointToleranceMs: 5 * 60 * 1000,
  // Например 'silent-ascend/sa-bank'. Нужно для общей стены и чтения истории из main.
  repository: '',
  branch: 'main',
  vellarUrl: '', // Только официальная HTTPS-ссылка; не подставляйте случайный чат.
  siteUrl: '', // https://owner.github.io/sa-bank/ — также заполните og:image в index.html.
  donationComment: 'SA BANK DONATION',
  api: {
    ton: 'https://tonapi.io/v2',
    dex: 'https://api.dexscreener.com/token-pairs/v1/ton',
    github: 'https://api.github.com'
  },
  images: {
    sa: 'assets/logo/SA-logo.png',
    bank: 'assets/logo/SA-BANK-logo.png',
    hero: 'assets/background/hero-main.webp',
    donation: 'assets/illustrations/donation-art.webp',
    wall: 'assets/illustrations/wall-art.webp'
  }
});
