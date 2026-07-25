// Floating AI broker chat widget for the Trading Room.
//
// Drop-in on ANY page of the site:
//   <script src="/broker-widget.js" defer></script>
//
// Renders a floating button (bottom-left, RTL site) that opens a chat panel.
// Talks to the /.netlify/functions/broker function. Chat history is shared
// across all pages via localStorage.
//
// Pages that have live portfolio data can expose it before this script runs:
//   window.brokerContext = function () { return {...snapshot...}; };
// Pages without it get a generic context and the broker still works.

(function () {
  'use strict';

  var BROKER_URL = '/.netlify/functions/broker';
  var STORE_KEY = 'trading-room-broker-chat-v1';
  var MAX_STORED = 40;

  var chat = load();
  var busy = false;
  var open = false;

  // Modern AI sparkles mark + a small "AI" tag on the floating button.
  var FAB_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M10 2.5l1.7 5.3 5.3 1.7-5.3 1.7L10 16.5l-1.7-5.3L3 9.5l5.3-1.7L10 2.5z" fill="#fff"/>' +
      '<path d="M18 12.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" fill="#fff" opacity="0.9"/>' +
      '<path d="M17.5 2.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" fill="#fff" opacity="0.75"/>' +
    '</svg>' +
    '<span class="ai">AI</span>';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
  }
  function save() {
    if (chat.length > MAX_STORED) chat.splice(0, chat.length - MAX_STORED);
    localStorage.setItem(STORE_KEY, JSON.stringify(chat));
  }

  // ---------- styles ----------
  var css = [
    '#bw-fab{position:fixed;bottom:22px;right:22px;z-index:9998;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;',
    'background:linear-gradient(135deg,#7c3aed,#22d3ee);color:#fff;display:flex;align-items:center;justify-content:center;',
    'box-shadow:0 8px 24px rgba(124,58,237,0.5);transition:transform .15s;animation:bw-glow 3s ease-in-out infinite;}',
    '#bw-fab:hover{transform:scale(1.07);}',
    '#bw-fab svg{width:28px;height:28px;}',
    '#bw-fab .x{font-size:24px;line-height:1;}',
    '#bw-fab .ai{position:absolute;top:-4px;left:-4px;background:#0b0716;color:#22d3ee;border:1px solid #22d3ee;',
    'font-family:ui-monospace,monospace;font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 6px;border-radius:999px;}',
    '@keyframes bw-glow{0%,100%{box-shadow:0 8px 24px rgba(124,58,237,0.5);}50%{box-shadow:0 8px 32px rgba(34,211,238,0.65);}}',
    '@media (prefers-reduced-motion: reduce){#bw-fab{animation:none;}}',
    '#bw-panel{position:fixed;bottom:94px;right:22px;z-index:9999;width:min(380px,calc(100vw - 32px));',
    'height:min(560px,calc(100vh - 120px));height:min(560px,calc(100dvh - 120px));',
    'display:none;flex-direction:column;direction:rtl;overflow:hidden;border-radius:18px;border:1px solid rgba(255,255,255,0.1);',
    'background:linear-gradient(180deg,#1d1540,#171030);color:#f2effb;font-family:Inter,system-ui,sans-serif;',
    'box-shadow:0 18px 50px rgba(0,0,0,0.55);}',
    '#bw-panel.open{display:flex;}',
    '#bw-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);}',
    '#bw-head .t{font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '#bw-head .t small{display:block;flex-basis:100%;font-weight:400;font-size:11px;color:#9b93b8;margin-top:2px;}',
    '#bw-head .badge{font-family:ui-monospace,monospace;font-size:10px;font-weight:700;color:#06121a;',
    'background:linear-gradient(90deg,#a78bfa,#22d3ee);padding:3px 8px;border-radius:6px;letter-spacing:.5px;}',
    '#bw-close{background:none;border:none;color:#9b93b8;font-size:18px;cursor:pointer;padding:4px 8px;}',
    '#bw-close:hover{color:#f2effb;}',
    '#bw-msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:14px;}',
    '.bw-msg{max-width:88%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.7;white-space:pre-wrap;}',
    '.bw-msg.user{align-self:flex-end;background:rgba(124,58,237,0.25);border:1px solid rgba(124,58,237,0.4);border-bottom-right-radius:4px;}',
    '.bw-msg.broker{align-self:flex-start;background:#120c22;border:1px solid rgba(255,255,255,0.08);border-bottom-left-radius:4px;}',
    '.bw-msg.err{border-color:rgba(248,113,113,0.4);color:#f87171;}',
    '.bw-msg.typing{color:#9b93b8;}',
    '.bw-msg .who{display:block;font-size:10px;font-weight:700;color:#22d3ee;letter-spacing:.5px;margin-bottom:4px;}',
    '#bw-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;}',
    '#bw-chips button{background:transparent;border:1px solid rgba(255,255,255,0.1);color:#9b93b8;font-family:inherit;font-size:11px;',
    'padding:5px 10px;border-radius:999px;cursor:pointer;}',
    '#bw-chips button:hover{border-color:#22d3ee;color:#22d3ee;}',
    '#bw-inrow{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgba(255,255,255,0.08);}',
    '#bw-input{flex:1;background:#120c22;border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#f2effb;',
    'font-family:inherit;font-size:13px;padding:10px 13px;}',
    '#bw-input:focus{outline:none;border-color:#7c3aed;}',
    '#bw-send{background:linear-gradient(90deg,#7c3aed,#22d3ee);border:none;border-radius:12px;color:#fff;font-family:inherit;',
    'font-weight:700;font-size:13px;padding:0 16px;cursor:pointer;}',
    '#bw-send:disabled{opacity:.4;cursor:not-allowed;}',
    // Mobile: full-screen bottom sheet so nothing is clipped by the URL bar
    // or the keyboard; dvh tracks the visible viewport as they move. Must be
    // last in the sheet so it wins over the base rules above.
    '@media (max-width:600px){',
    '#bw-panel{top:0;right:0;bottom:0;left:0;width:100%;height:100%;height:100dvh;max-height:none;border-radius:0;border:none;}',
    '#bw-fab.bw-hidden{display:none;}',
    '#bw-input{font-size:16px;}',  // >=16px stops iOS from auto-zooming the page on focus
    '}',
  ].join('');

  // ---------- DOM ----------
  function build() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var fab = document.createElement('button');
    fab.id = 'bw-fab';
    fab.setAttribute('aria-label', 'פתח צאט עם ברוקר ה-AI');
    fab.innerHTML = FAB_ICON;

    var panel = document.createElement('div');
    panel.id = 'bw-panel';
    panel.innerHTML =
      '<div id="bw-head">' +
        '<div class="t">הברוקר שלי <span class="badge">AI</span><small>עוזר מסחר מבוסס בינה מלאכותית (Claude) - רואה את התיק שלך בזמן אמת</small></div>' +
        '<button id="bw-close" aria-label="סגור">✕</button>' +
      '</div>' +
      '<div id="bw-msgs"></div>' +
      '<div id="bw-chips">' +
        '<button>מה כדאי לסחור עכשיו?</button>' +
        '<button>נתח את התיק שלי</button>' +
        '<button>בנה לי תוכנית מסחר</button>' +
      '</div>' +
      '<div id="bw-inrow">' +
        '<input id="bw-input" type="text" placeholder="שאל את הברוקר..." maxlength="2000">' +
        '<button id="bw-send">שלח</button>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.addEventListener('click', toggle);
    panel.querySelector('#bw-close').addEventListener('click', toggle);
    panel.querySelector('#bw-send').addEventListener('click', function () {
      send(panel.querySelector('#bw-input').value);
    });
    panel.querySelector('#bw-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') send(this.value);
    });
    panel.querySelector('#bw-chips').addEventListener('click', function (e) {
      if (e.target.tagName === 'BUTTON') send(e.target.textContent);
    });
  }

  function toggle() {
    open = !open;
    var panel = document.getElementById('bw-panel');
    var fab = document.getElementById('bw-fab');
    panel.classList.toggle('open', open);
    fab.innerHTML = open ? '<span class="x">✕</span>' : FAB_ICON;
    // On phones the panel is full-screen - hide the floating button under it
    // so only the header close button remains.
    fab.classList.toggle('bw-hidden', open && window.matchMedia('(max-width:600px)').matches);
    if (open) {
      render();
      panel.querySelector('#bw-input').focus();
    }
  }

  function render() {
    var box = document.getElementById('bw-msgs');
    if (!box) return;
    box.innerHTML = '';
    if (!chat.length) {
      box.appendChild(brokerBubble(
        'היי, אני ברוקר ה-AI שלך - עוזר חכם מבוסס Claude, לא בן אדם. אני רואה את התיק ואת מחירי השוק בזמן אמת: שאל אותי מה כדאי לסחור, בקש ניתוח של התיק, או נבנה יחד תוכנית מסחר. זכור שאני כלי אימון - לא ייעוץ השקעות מורשה.', false));
    }
    chat.forEach(function (m) {
      if (m.role === 'user') {
        var el = document.createElement('div');
        el.className = 'bw-msg user';
        el.textContent = m.content;
        box.appendChild(el);
      } else {
        box.appendChild(brokerBubble(m.content, m.err));
      }
    });
    if (busy) {
      var t = document.createElement('div');
      t.className = 'bw-msg broker typing';
      t.textContent = 'הברוקר חושב...';
      box.appendChild(t);
    }
    box.scrollTop = box.scrollHeight;
  }

  function brokerBubble(text, isErr) {
    var el = document.createElement('div');
    el.className = 'bw-msg broker' + (isErr ? ' err' : '');
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = '✦ הברוקר · AI';
    var body = document.createElement('span');
    body.textContent = text;
    el.appendChild(who);
    el.appendChild(body);
    return el;
  }

  function getContext() {
    if (typeof window.brokerContext === 'function') {
      try { return window.brokerContext(); } catch (e) { /* fall through */ }
    }
    return { description: 'No live portfolio data on this page' };
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    chat.push({ role: 'user', content: text });
    save();
    busy = true;
    var input = document.getElementById('bw-input');
    var sendBtn = document.getElementById('bw-send');
    input.value = '';
    sendBtn.disabled = true;
    render();

    fetch(BROKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chat.filter(function (m) { return !m.err; })
          .map(function (m) { return { role: m.role, content: m.content }; }),
        context: getContext(),
      }),
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (res.ok && res.data.reply) {
          chat.push({ role: 'assistant', content: res.data.reply });
        } else {
          chat.push({ role: 'assistant', err: true, content: res.data.error || 'שגיאה זמנית - נסה שוב' });
        }
      })
      .catch(function () {
        chat.push({ role: 'assistant', err: true, content: 'הברוקר לא זמין כרגע - בדוק את החיבור ונסה שוב.' });
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        save();
        render();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
