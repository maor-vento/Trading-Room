// Stock market data proxy for the Trading Room simulator.
//
// The browser cannot call Yahoo Finance directly (CORS), so this function
// relays three kinds of requests. Zero npm dependencies - built-in fetch.
//
//   GET ?search=jfrog                 -> [{symbol, name, exchange, type}]
//   GET ?symbols=FROG,CRM             -> { FROG: {price, changePct, currency, name}, ... }
//   GET ?history=FROG&interval=60m&range=1mo -> { closes: [...] }
//
// Data is delayed/last-trade from Yahoo's public endpoints; good enough for
// paper trading. No API key required.

const Y = 'https://query1.finance.yahoo.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };
const OK_INTERVALS = { '15m': 1, '60m': 1, '1d': 1 };
const OK_RANGES = { '1d': 1, '5d': 1, '1mo': 1, '3mo': 1, '6mo': 1, '1y': 1 };
const MAX_SYMBOLS = 20;

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  try {
    if (q.search) return json(200, await search(q.search), 3600);
    if (q.symbols) return json(200, await quotes(q.symbols), 10);
    if (q.history) return json(200, await history(q.history, q.interval, q.range), 60);
    return json(400, { error: 'missing search/symbols/history param' });
  } catch (err) {
    console.error('quotes error:', err);
    return json(502, { error: 'stock data source unavailable' });
  }
};

async function search(query) {
  const url = Y + '/v1/finance/search?quotesCount=8&newsCount=0&q=' + encodeURIComponent(query.slice(0, 40));
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error('search http ' + r.status);
  const data = await r.json();
  return (data.quotes || [])
    .filter((x) => (x.quoteType === 'EQUITY' || x.quoteType === 'ETF') && x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.quoteType,
    }));
}

async function quoteOne(symbol) {
  const url = Y + '/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=5d';
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  const data = await r.json();
  const res = data.chart && data.chart.result && data.chart.result[0];
  if (!res || !res.meta || res.meta.regularMarketPrice == null) return null;
  const m = res.meta;
  const prev = m.chartPreviousClose || m.previousClose;
  return {
    price: m.regularMarketPrice,
    changePct: prev ? ((m.regularMarketPrice / prev) - 1) * 100 : 0,
    currency: m.currency || 'USD',
    name: m.shortName || m.longName || symbol,
  };
}

async function quotes(list) {
  const symbols = String(list).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX_SYMBOLS);
  const results = await Promise.all(symbols.map((s) => quoteOne(s).catch(() => null)));
  const out = {};
  symbols.forEach((s, i) => { if (results[i]) out[s] = results[i]; });
  return out;
}

async function history(symbol, interval, range) {
  interval = OK_INTERVALS[interval] ? interval : '1d';
  range = OK_RANGES[range] ? range : '1mo';
  const url = Y + '/v8/finance/chart/' + encodeURIComponent(String(symbol).toUpperCase()) +
    '?interval=' + interval + '&range=' + range;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error('history http ' + r.status);
  const data = await r.json();
  const res = data.chart && data.chart.result && data.chart.result[0];
  const closes = ((res && res.indicators && res.indicators.quote && res.indicators.quote[0] &&
    res.indicators.quote[0].close) || []).filter((v) => v != null);
  return { closes };
}

function json(statusCode, obj, maxAge) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? 'public, max-age=' + maxAge : 'no-store',
    },
    body: JSON.stringify(obj),
  };
}
