# SA Wall — one-time setup

The site itself can remain free/static on GitHub Pages, Cloudflare Pages or Vercel.
The community wall needs a small database. Supabase currently has a Free plan with
500 MB database, 50,000 MAU and 2 million Realtime messages, subject to its current
limits. Free projects can be paused after long inactivity.

## 1. Create Supabase
Create a free project at https://supabase.com/

## 2. Enable Anonymous Auth
Dashboard → Authentication → Providers → Anonymous → Enable.

## 3. Create tables
Open SQL Editor and run the complete `supabase.sql` file.

## 4. Add the public keys
Dashboard → Project Settings → API.
Copy:
- Project URL
- Publishable/anon key

Put them into `supabase-config.js`.

Never put a `service_role` key in the website.

## 5. Realtime
For instant wall updates, add `wall_posts` and `donations` to the Realtime publication if the project UI asks for it:
Database → Publications → `supabase_realtime`.

## 6. Deploy
Upload the whole folder to GitHub Pages / Cloudflare Pages / Vercel.

## Important identity note
TON Connect securely connects the wallet and never gives the site the user's private keys.
This MVP uses the connected address as the displayed wallet identity and lets the user choose
a nickname. For a production-grade anti-spoof identity, add TON Proof verification on a server/
Edge Function and only accept the wallet address after signature verification.

## Donation note
The current wall records a donation after the user's wallet confirms the transaction.
For a production-grade verified donation feed, add an indexer/webhook that independently
checks the transaction on TON before marking it as confirmed.
