// Daily stock picks with reasons, for the "recommended today" card.
//
// Pulls today's movers from Yahoo's predefined screeners (day gainers +
// most actives), filters out junk, then asks Claude to pick the most
// interesting ones for a practicing trader and explain WHY in Hebrew,
// grounded only in the screener numbers. If the AI key is missing or the
// call fails, falls back to rule-based Hebrew reasons - the card never
// comes back empty because of the AI.
//
// Zero npm dependencies. Response is CDN-cached for an hour, so the AI
// runs at most about once an hour per edge - negligible cost.
//
// Env (optional): ANTHROPIC_API_KEY - same key the broker uses.

const Y = 'https://query1.finance.yahoo.com';
const YH = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };
const PICKS = 5;

exports.handler = async () => {
  try {
    const candidates = await fetchCandidates();
    if (!candidates.length) return json(502, { error: 'no market data' });
    let items = null;
    if (process.env.ANTHROPIC_API_KEY) {
      items = await aiPick(candidates).catch((e) => {
        console.error('ai pick failed, falling back:', e.message);
        return null;
      });
    }
    if (!items) items = autoPick(candidates);
    return json(200, { items, source: process.env.ANTHROPIC_API_KEY && items.ai !== false ? 'ai' : 'auto' }, 3600);
  } catch (err) {
    console.error('recommend error:', err);
    return json(502, { error: 'recommendation source unavailable' });
  }
};

async function screener(id) {
  const url = Y + '/v1/finance/screener/predefined/saved?scrIds=' + id + '&count=25';
  const r = await fetch(url, { headers: YH });
  if (!r.ok) throw new Error(id + ' http ' + r.status);
  const data = await r.json();
  return (data.finance && data.finance.result && data.finance.result[0] &&
    data.finance.result[0].quotes) || [];
}

async function fetchCandidates() {
  const [gainers, actives] = await Promise.all([
    screener('day_gainers').catch(() => []),
    screener('most_actives').catch(() => []),
  ]);
  const seen = {};
  const out = [];
  gainers.concat(actives).forEach((q) => {
    if (!q.symbol || seen[q.symbol]) return;
    seen[q.symbol] = true;
    const price = q.regularMarketPrice;
    const mcap = q.marketCap || 0;
    if (!price || price < 3 || mcap < 2e9) return; // skip penny/micro-cap noise
    out.push({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: price,
      changePct: q.regularMarketChangePercent || 0,
      volume: q.regularMarketVolume || 0,
      avgVolume: q.averageDailyVolume3Month || 0,
      marketCapB: Math.round(mcap / 1e8) / 10,
      fromGainers: gainers.some((g) => g.symbol === q.symbol),
    });
  });
  return out.slice(0, 20);
}

function volumeRatio(c) {
  return c.avgVolume ? c.volume / c.avgVolume : 1;
}

function autoPick(candidates) {
  // No AI: rank by a simple blend of daily move and unusual volume.
  const ranked = candidates.slice().sort(function (a, b) {
    return (Math.abs(b.changePct) + volumeRatio(b) * 2) - (Math.abs(a.changePct) + volumeRatio(a) * 2);
  }).slice(0, PICKS);
  return ranked.map(function (c) {
    const bits = [];
    bits.push((c.changePct >= 0 ? 'עלייה של ' : 'ירידה של ') + Math.abs(c.changePct).toFixed(1) + '% היום');
    const vr = volumeRatio(c);
    if (vr > 1.5) bits.push('מחזור פי ' + vr.toFixed(1) + ' מהממוצע - עניין חריג');
    bits.push('שווי שוק ' + c.marketCapB + ' מיליארד דולר');
    return { symbol: c.symbol, name: c.name, price: c.price, changePct: c.changePct, reason: bits.join(' · ') };
  });
}

async function aiPick(candidates) {
  const table = candidates.map(function (c) {
    return c.symbol + ' | ' + c.name + ' | $' + c.price + ' | ' + c.changePct.toFixed(2) + '% today | volume x' +
      volumeRatio(c).toFixed(1) + ' vs 3mo avg | mcap $' + c.marketCapB + 'B' + (c.fromGainers ? ' | top-gainer' : ' | most-active');
  }).join('\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1500,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              picks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    symbol: { type: 'string' },
                    reason: { type: 'string' },
                  },
                  required: ['symbol', 'reason'],
                  additionalProperties: false,
                },
              },
            },
            required: ['picks'],
            additionalProperties: false,
          },
        },
      },
      system: 'אתה עוזר בסימולטור מסחר לימודי. מתוך טבלת המניות הזזות של היום, בחר בדיוק ' + PICKS +
        ' המעניינות ביותר לסוחר מתאמן. לכל אחת כתוב נימוק קצר בעברית (עד 18 מילים) שמסביר למה היא בולטת - ' +
        'התבסס אך ורק על הנתונים שבטבלה (גודל התנועה, מחזור חריג יחסית לממוצע, שווי שוק) בשילוב ידע כללי על החברה. ' +
        'העדף תמהיל: גם תנועות חזקות וגם חברות גדולות ומוכרות. אל תבטיח רווח ואל תשתמש במקף ארוך.',
      messages: [{ role: 'user', content: table }],
    }),
  });
  if (!r.ok) throw new Error('anthropic http ' + r.status);
  const data = await r.json();
  if (data.stop_reason === 'refusal') throw new Error('refusal');
  let text = '';
  for (const block of data.content || []) if (block.type === 'text') text += block.text;
  const parsed = JSON.parse(text);
  const bySym = {};
  candidates.forEach(function (c) { bySym[c.symbol] = c; });
  const items = (parsed.picks || [])
    .filter(function (p) { return bySym[p.symbol]; })
    .slice(0, PICKS)
    .map(function (p) {
      const c = bySym[p.symbol];
      return { symbol: c.symbol, name: c.name, price: c.price, changePct: c.changePct, reason: p.reason };
    });
  if (!items.length) throw new Error('empty ai picks');
  return items;
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
