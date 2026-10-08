# SA Public Portfolio

Static TON dApp inspired by the minimal editorial/secret-site feel of friday13.xyz.

## Free deployment

### GitHub Pages
1. Create a public GitHub repository, e.g. `sa-public-portfolio`.
2. Upload all files from this folder.
3. Edit `tonconnect-manifest.json` and replace `YOUR-GITHUB-USERNAME` with your GitHub username.
4. In GitHub: Settings → Pages → Deploy from branch → `main` / root.
5. Open the generated `https://USERNAME.github.io/sa-public-portfolio/`.

### Cloudflare Pages / Vercel
Upload the same static files. No backend is required for the basic version.

## What is included

- Fixed public wallet portfolio:
  `UQDpHoPi5JHFruwdiKHCGO68gVaW4lKN0arzTAoMWVDWrjuv`
- SA Jetton:
  `EQBW1ZPnrV2LujIKfwdctIy57c5-RFlkxAZDo9-CN5BtTWmC`
- TON Connect wallet connection.
- TON donation flow to the tracked wallet.
- Public TON / Jetton balances through TON API.
- SA market chart through GeckoTerminal's public API.
- Responsive dark / gold UI.
- No private keys, seed phrases, or wallet credentials are handled by the site.

## Important

TON API public access is rate-limited. For a larger audience, use a free/paid API key or a small caching backend.

The market chart requires an indexed liquidity pool. If no pool/history is found, the site intentionally shows no invented price.

Before publishing, replace the placeholder URLs in `tonconnect-manifest.json` with the real deployed URL.


## SA Wall

The latest version adds a community wall:
- wallet-connected profile
- nickname editing
- public messages
- public donation entries
- Supabase Realtime updates
- donation flow through TON Connect
- SA hero background artwork

The wall needs the one-time Supabase setup described in `SETUP_WALL.md`.
