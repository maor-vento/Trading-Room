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
- Everything persists in the browser's localStorage - per device, no backend
  database.
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

## Going to real money later

This page is a simulator only. Real-money trading means connecting a broker
or exchange (e.g. an exchange spot API with real keys, or a regulated
broker), which brings API-key security, order types, regulation and real
risk of loss. Recommended path: trade here for a few months, track the
equity curve, and only then decide - with money you can afford to lose.
