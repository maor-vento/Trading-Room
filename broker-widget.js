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

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
  }
  function save() {
    if (chat.length > MAX_STORED) chat.splice(0, chat.length - MAX_STORED);
    localStorage.setItem(STORE_KEY, JSON.stringify(chat));
  }

  // ---------- styles ----------
  var css = [
    '#bw-fab{position:fixed;bottom:22px;left:22px;z-index:9998;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;',
    'background:linear-gradient(135deg,#7c3aed,#22d3ee);color:#fff;font-size:26px;display:flex;align-items:center;justify-content:center;',
    'box-shadow:0 8px 24px rgba(124,58,237,0.45);transition:transform .15s;}',
    '#bw-fab:hover{transform:scale(1.07);}',
    '#bw-panel{position:fixed;bottom:92px;left:22px;z-index:9999;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));',
    'display:none;flex-direction:column;direction:rtl;overflow:hidden;border-radius:18px;border:1px solid rgba(255,255,255,0.1);',
    'background:linear-gradient(180deg,#1d1540,#171030);color:#f2effb;font-family:Inter,system-ui,sans-serif;',
    'box-shadow:0 18px 50px rgba(0,0,0,0.55);}',
    '#bw-panel.open{display:flex;}',
    '#bw-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);}',
    '#bw-head .t{font-weight:700;font-size:15px;}',
    '#bw-head .t small{display:block;font-weight:400;font-size:11px;color:#9b93b8;margin-top:2px;}',
    '#bw-close{background:none;border:none;color:#9b93b8;font-size:18px;cursor:pointer;padding:4px 8px;}',
    '#bw-close:hover{color:#f2effb;}',
    '#bw-msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:14px;}',
    '.bw-msg{max-width:88%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.7;white-space:pre-wrap;}',
    '.bw-msg.user{align-self:flex-end;background:rgba(124,58,237,0.25);border:1px solid rgba(124,58,237,0.4);border-bottom-right-radius:4px;}',
    '.bw-msg.broker{align-self:flex-start;background:#120c22;border:1px solid rgba(255,255,255,0.08);border-bottom-left-radius:4px;}',
    '.bw-msg.err{border-color:rgba(248,113,113,0.4);color:#f87171;}',
    '.bw-msg.typing{color:#9b93b8;}',
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
  ].join('');

  // ---------- DOM ----------
  function build() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var fab = document.createElement('button');
    fab.id = 'bw-fab';
    fab.setAttribute('aria-label', 'פתח צאט עם הברוקר');
    fab.textContent = '💬';

    var panel = document.createElement('div');
    panel.id = 'bw-panel';
    panel.innerHTML =
      '<div id="bw-head">' +
        '<div class="t">הברוקר שלי<small>יועץ המסחר האישי שלך - רואה את התיק בזמן אמת</small></div>' +
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
    fab.textContent = open ? '✕' : '💬';
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
      var hello = document.createElement('div');
      hello.className = 'bw-msg broker';
      hello.textContent = 'היי, אני הברוקר שלך. אני רואה את התיק ואת מחירי השוק בזמן אמת - שאל אותי מה כדאי לסחור, בקש ניתוח של התיק, או נבנה יחד תוכנית מסחר.';
      box.appendChild(hello);
    }
    chat.forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'bw-msg ' + (m.role === 'user' ? 'user' : 'broker') + (m.err ? ' err' : '');
      el.textContent = m.content;
      box.appendChild(el);
    });
    if (busy) {
      var t = document.createElement('div');
      t.className = 'bw-msg broker typing';
      t.textContent = 'הברוקר חושב...';
      box.appendChild(t);
    }
    box.scrollTop = box.scrollHeight;
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
