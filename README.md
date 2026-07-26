# Trading Room - paper trading simulator

A self-contained, no-build static site for practicing trading with virtual
money against real live market prices, with an AI broker to consult with.

## What it does

- Live crypto prices from the public Binance API every 5 seconds, plus
  real stock quotes (NASDAQ/NYSE, e.g. FROG, CRM) via a Yahoo Finance proxy
  function (`netlify/functions/quotes.js`) - no API keys needed.
- Personal watchlist: search-add any Binance USDT pair or any US stock by
  ticker or company name; a 'recommended today' card surfaces the top crypto
  movers of the last 24h.
- Virtual portfolio starting at $100,000: market buy/sell with a realistic
  0.1% fee per trade, average-cost accounting, realized + unrealized P&L.
- Price chart (15m / 1h / 4h / 1d) for both asset classes.
- Trade history log.
- **AI broker chat** - a Claude-powered trading mentor that sees the live
  portfolio + market snapshot and gives concrete, risk-aware trade ideas.
  Runs through a Netlify Function (`netlify/functions/broker.js`) so the API
  key stays server-side. Chat history persists locally like the rest.
- **User accounts** (optional, via Supabase) - email + password sign-up;
  the portfolio, watchlist, history and broker chat sync to the cloud and
  follow the user across devices. Without Supabase configured the site runs
  local-only (localStorage, per device).
- Hebrew RTL UI, dark purple-to-cyan theme.

## Run locally

Just open `index.html` in a browser, or:

```
npx serve .
```

(The broker chat needs the Netlify Function, so locally use `netlify dev`
with `ANTHROPIC_API_KEY` in the environment if you want it working.)

## Deploy to Netlify

1. Netlify → Add new site → Import an existing project → pick this repo.
2. Leave the build settings as detected (`netlify.toml` is at the repo root:
   no build command, publish `.`, functions in `netlify/functions`).
3. Add the environment variable in Site configuration → Environment variables:

```
ANTHROPIC_API_KEY = sk-ant-...   (from console.anthropic.com)
```

4. Deploy. The broker function has zero npm dependencies (it calls the
   Anthropic API with Node's built-in fetch), so there is no install step.

Without the key the site still works fully - only the broker chat replies
with a configuration error.

## User accounts (cloud-saved portfolios)

Accounts are powered by Supabase (the free tier is plenty). Until it is
configured the site runs local-only, and the login button explains that
accounts are not enabled yet.

Setup (~5 minutes):

1. Create a free project at supabase.com (any name and region).
2. In the project: SQL Editor → New query → run:

```sql
create table public.portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.portfolios enable row level security;
create policy "own row" on public.portfolios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

2b. For the competitors leaderboard (every signed-in user can view everyone's
   portfolio), also run:

```sql
alter table public.portfolios add column if not exists display_name text;
create policy "authenticated read all" on public.portfolios
  for select to authenticated using (true);
```

3. Authentication → Sign In / Up: the Email provider is on by default.
   Optional: turn OFF "Confirm email" so friends can skip the
   verification-mail step.
4. Project Settings → API (or "API Keys"): copy the Project URL and the
   `anon` `public` key into `config.js` in this repo, commit, push.

Users then sign up with email + password. Each user's data is protected by
row level security (a user can only read/write their own row), and the anon
key is safe to expose in the browser.

## Going to real money later

This page is a simulator only. Real-money trading means connecting a broker
or exchange (e.g. an exchange spot API with real keys, or a regulated
broker), which brings API-key security, order types, regulation and real
risk of loss. Recommended path: trade here for a few months, track the
equity curve, and only then decide - with money you can afford to lose.
