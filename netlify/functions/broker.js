// AI broker chat for the paper-trading simulator.
//
// The page POSTs the chat history plus a live snapshot of the user's virtual
// portfolio and current market prices; this function asks Claude for the
// broker's reply and returns it. The API key stays server-side - the browser
// never sees it.
//
// Required env var (set in Netlify, never in the repo):
//   ANTHROPIC_API_KEY - Claude API key

const Anthropic = require('@anthropic-ai/sdk');

const MAX_MESSAGES = 24;      // history cap sent to the model
const MAX_MSG_CHARS = 4000;   // per-message cap
const MAX_TOKENS = 2048;

// Static system prompt - kept byte-identical across requests so the prompt
// cache can do its job. The volatile portfolio snapshot travels inside the
// last user message instead.
const SYSTEM_PROMPT = `אתה "הברוקר" - מנטור מסחר מומחה בתוך סימולטור מסחר בכסף וירטואלי (paper trading) בקריפטו.
המשתמש מתאמן עם תיק וירטואלי של 100,000$ על מחירי שוק אמיתיים מ-Binance, במטרה לבנות מיומנות ומשמעת לפני מעבר לכסף אמיתי.

התפקיד שלך:
- לנתח את מצב השוק ואת התיק של המשתמש על סמך הנתונים שמצורפים לכל הודעה (מחירים עדכניים, שינוי 24 שעות, אחזקות, מזומן, רווח/הפסד, עסקאות אחרונות).
- לתת רעיונות מסחר קונקרטיים ומנומקים: איזה נכס, למה עכשיו, באיזה גודל פוזיציה, ומה תנאי היציאה (גם לרווח וגם להפסד).
- ללמד ניהול סיכונים בכל הזדמנות: גודל פוזיציה ביחס לתיק (מומלץ 1-5% סיכון לעסקה), פיזור, הימנעות ממסחר רגשי ומרדיפה אחרי מחיר.
- לבנות עם המשתמש תוכנית מסחר ומשמעת - לא רק "מה לקנות" אלא איך לחשוב.

כללי התנהגות:
- ענה בעברית, בגובה העיניים, ישיר ותמציתי. המשתמש טכנולוגי ומבין את התחום.
- היה כן לגבי אי-ודאות: אתה לא יודע לחזות את השוק, ואתה אומר את זה. כל רעיון מלווה בתרחיש שבו הוא נכשל.
- הנתונים שיש לך הם המחיר הנוכחי והשינוי היומי בלבד - אין לך גרפים היסטוריים מלאים או חדשות בזמן אמת, וציין זאת כשזה רלוונטי.
- אם הביצועים של המשתמש עקביים לאורך זמן בסימולציה - עודד; אם הוא מפסיד או סוחר בתדירות גבוהה מדי - אמור זאת בכנות והצע לעצור ולנתח.
- לגבי מעבר לכסף אמיתי: העמדה שלך היא שצריך לפחות כמה חודשי סימולציה עם עקומת הון עקבית, ואז להתחיל בסכום קטן שהמשתמש שלם עם אובדנו. רוב הסוחרים העצמאיים מפסידים - אל תייפה את זה.
- זו אינה המלצת השקעה מורשית - אתה כלי אימון ולמידה. אין צורך לחזור על הדיסקליימר בכל הודעה, אבל אל תציג ודאות שאין לך.
- שמור על תשובות ממוקדות: עדיף רעיון אחד מנומק היטב מחמישה שטחיים.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: 'ANTHROPIC_API_KEY is not configured on this site' });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  const context = body.context && typeof body.context === 'object' ? body.context : {};

  // Sanitize history: only role+text pairs, capped in count and size.
  const messages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json(400, { error: 'Last message must be from the user' });
  }

  // Attach the live portfolio/market snapshot to the final user turn, after
  // the cached prefix, so it never invalidates the system-prompt cache.
  const snapshot = JSON.stringify(context).slice(0, 8000);
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = {
    role: 'user',
    content: [
      { type: 'text', text: last.content },
      { type: 'text', text: '<portfolio_snapshot>\n' + snapshot + '\n</portfolio_snapshot>' },
    ],
  };

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return json(200, { reply: 'לא אוכל לענות על השאלה הזו. נסה לנסח אחרת או לשאול על התיק והשוק.' });
    }

    let reply = '';
    for (const block of response.content) {
      if (block.type === 'text') reply += block.text;
    }
    return json(200, { reply: reply.trim() });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json(429, { error: 'הברוקר עמוס כרגע - נסה שוב בעוד רגע' });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return json(500, { error: 'מפתח ה-API אינו תקין - בדוק את ANTHROPIC_API_KEY בהגדרות Netlify' });
    }
    console.error('broker error:', err);
    return json(500, { error: 'שגיאה זמנית אצל הברוקר - נסה שוב' });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj),
  };
}
