// User accounts + cloud sync for the Trading Room.
//
// Uses Supabase (email + password auth, Postgres storage). Configured via
// window.TR_CONFIG in config.js; when not configured the site runs exactly
// as before - local-only, no login UI beyond a hint.
//
// What gets synced: the whole simulator state (portfolio, watchlist, trade
// history) plus the broker chat - i.e. the two localStorage keys below,
// stored as one JSON document per user in the `portfolios` table.
//
// Sync model: cloud wins on login/page-load; local edits push to the cloud
// debounced (~1.5s) by hooking localStorage.setItem for our keys.

(function () {
  'use strict';

  var KEYS = ['paper-trading-v1', 'trading-room-broker-chat-v1'];
  var APPLIED_FLAG = 'tr-cloud-applied';
  var cfg = window.TR_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  var sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  var user = null;
  var pushTimer = null;

  // ---------- state <-> document ----------
  function collect() {
    var doc = { v: 1 };
    KEYS.forEach(function (k) {
      try { doc[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { doc[k] = null; }
    });
    return doc;
  }
  function apply(doc) {
    KEYS.forEach(function (k) {
      if (doc && doc[k] != null) localStorage.setItem(k, JSON.stringify(doc[k]));
    });
  }
  function clearLocal() {
    KEYS.forEach(function (k) { localStorage.removeItem(k); });
  }
  // Key-order-independent serialization: Postgres jsonb reorders object keys,
  // so a plain JSON.stringify comparison would always see a difference.
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') {
      return '{' + Object.keys(x).sort().map(function (k) {
        return JSON.stringify(k) + ':' + stable(x[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(x);
  }

  // ---------- cloud ----------
  function pull() {
    return sb.from('portfolios').select('data').eq('user_id', user.id).maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data ? res.data.data : null;
      });
  }
  function push() {
    if (!user) return Promise.resolve();
    return sb.from('portfolios').upsert({
      user_id: user.id,
      data: collect(),
      updated_at: new Date().toISOString(),
    }).then(function (res) {
      setStatus(res.error ? 'שגיאת סנכרון' : null);
    });
  }
  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1500);
  }

  // Hook localStorage writes from the app so we don't have to touch its code.
  var origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSetItem.call(this, k, v);
    if (KEYS.indexOf(k) !== -1) schedulePush();
  };
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && user) { clearTimeout(pushTimer); push(); }
  });

  // ---------- UI ----------
  var css = [
    '#tr-user{display:inline-flex;align-items:center;gap:8px;background:transparent;border:1px solid rgba(255,255,255,0.12);',
    'color:#9b93b8;font-family:inherit;font-size:12px;padding:7px 14px;border-radius:10px;cursor:pointer;max-width:200px;overflow:hidden;white-space:nowrap;}',
    '#tr-user:hover{border-color:#22d3ee;color:#22d3ee;}',
    '#tr-user b{color:#f2effb;font-weight:600;overflow:hidden;text-overflow:ellipsis;}',
    '#tr-auth-ovl{position:fixed;inset:0;z-index:10000;background:rgba(6,4,14,0.72);display:none;align-items:center;justify-content:center;padding:16px;}',
    '#tr-auth-ovl.open{display:flex;}',
    '#tr-auth{direction:rtl;width:min(400px,100%);background:linear-gradient(180deg,#1d1540,#171030);border:1px solid rgba(255,255,255,0.12);',
    'border-radius:18px;padding:22px;color:#f2effb;font-family:Inter,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,0.6);}',
    '#tr-auth h3{font-size:17px;font-weight:700;margin-bottom:4px;}',
    '#tr-auth .sub{font-size:12px;color:#9b93b8;margin-bottom:16px;line-height:1.6;}',
    '#tr-auth .tabs{display:flex;gap:8px;margin-bottom:14px;}',
    '#tr-auth .tabs button{flex:1;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;',
    'color:#9b93b8;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;}',
    '#tr-auth .tabs button.on{background:rgba(124,58,237,0.25);border-color:#7c3aed;color:#f2effb;}',
    '#tr-auth input{width:100%;background:#120c22;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#f2effb;',
    'font-family:inherit;font-size:16px;padding:11px 13px;margin-bottom:10px;direction:ltr;text-align:left;}',
    '#tr-auth input:focus{outline:none;border-color:#7c3aed;}',
    '#tr-auth .go{width:100%;padding:12px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-weight:700;',
    'font-size:14px;color:#fff;background:linear-gradient(90deg,#7c3aed,#22d3ee);}',
    '#tr-auth .msg{font-size:12px;min-height:18px;margin-top:10px;line-height:1.6;}',
    '#tr-auth .msg.err{color:#f87171;} #tr-auth .msg.ok{color:#34d399;}',
    '#tr-auth .close{position:absolute;background:none;border:none;color:#9b93b8;font-size:17px;cursor:pointer;margin-top:-6px;}',
    '#tr-auth .out{width:100%;margin-top:10px;padding:10px;border-radius:10px;border:1px solid rgba(248,113,113,0.35);',
    'background:transparent;color:#f87171;font-family:inherit;font-size:13px;cursor:pointer;}',
    '#tr-sync{font-size:11px;color:#9b93b8;}',
  ].join('');

  var mode = 'login';

  function build() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var chip = document.createElement('button');
    chip.id = 'tr-user';
    var host = document.querySelector('header.top > div:last-child') || document.body;
    host.insertBefore(chip, host.firstChild);
    chip.addEventListener('click', function () { openModal(); });

    var ovl = document.createElement('div');
    ovl.id = 'tr-auth-ovl';
    ovl.innerHTML =
      '<div id="tr-auth">' +
        '<button class="close" aria-label="סגור">✕</button>' +
        '<h3 id="tr-auth-title">חשבון Trading Room</h3>' +
        '<div class="sub" id="tr-auth-sub">התחבר כדי שהתיק, המעקב וההיסטוריה יישמרו בענן ויעברו איתך בין מכשירים.</div>' +
        '<div class="tabs"><button id="tr-tab-login" class="on">התחברות</button><button id="tr-tab-signup">הרשמה</button></div>' +
        '<div id="tr-auth-form">' +
          '<input id="tr-email" type="email" placeholder="you@example.com" autocomplete="email">' +
          '<input id="tr-pass" type="password" placeholder="סיסמה (לפחות 6 תווים)" autocomplete="current-password">' +
          '<button class="go" id="tr-go">התחבר</button>' +
        '</div>' +
        '<div id="tr-auth-logged" style="display:none;">' +
          '<button class="out" id="tr-logout">התנתק מהחשבון</button>' +
        '</div>' +
        '<div class="msg" id="tr-msg"></div>' +
      '</div>';
    document.body.appendChild(ovl);

    ovl.addEventListener('click', function (e) { if (e.target === ovl) closeModal(); });
    ovl.querySelector('.close').addEventListener('click', closeModal);
    document.getElementById('tr-tab-login').addEventListener('click', function () { setMode('login'); });
    document.getElementById('tr-tab-signup').addEventListener('click', function () { setMode('signup'); });
    document.getElementById('tr-go').addEventListener('click', submit);
    document.getElementById('tr-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    document.getElementById('tr-logout').addEventListener('click', logout);

    renderChip();
  }

  function renderChip() {
    var chip = document.getElementById('tr-user');
    if (!chip) return;
    if (!configured) {
      chip.innerHTML = 'התחבר <span id="tr-sync">(לא מוגדר)</span>';
    } else if (user) {
      chip.innerHTML = '👤 <b>' + escapeHtml((user.email || '').split('@')[0]) + '</b> <span id="tr-sync">☁</span>';
      chip.title = 'מחובר כ-' + user.email + ' - התיק נשמר בענן';
    } else {
      chip.textContent = 'התחבר / הרשמה';
      chip.title = 'שמור את התיק שלך בענן';
    }
  }
  function setStatus(err) {
    var el = document.getElementById('tr-sync');
    if (el) el.textContent = err ? '⚠' : '☁';
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function openModal() {
    var ovl = document.getElementById('tr-auth-ovl');
    var form = document.getElementById('tr-auth-form');
    var logged = document.getElementById('tr-auth-logged');
    var tabs = document.querySelector('#tr-auth .tabs');
    msg('');
    if (!configured) {
      form.style.display = 'none'; tabs.style.display = 'none'; logged.style.display = 'none';
      document.getElementById('tr-auth-sub').textContent =
        'חשבונות עדיין לא הופעלו באתר הזה - צריך להגדיר פרויקט Supabase (ראה README בריפו). בינתיים הנתונים נשמרים מקומית בדפדפן.';
    } else if (user) {
      form.style.display = 'none'; tabs.style.display = 'none'; logged.style.display = 'block';
      document.getElementById('tr-auth-sub').textContent = 'מחובר כ-' + user.email + '. התיק מסתנכרן אוטומטית לענן.';
    } else {
      form.style.display = 'block'; tabs.style.display = 'flex'; logged.style.display = 'none';
      document.getElementById('tr-auth-sub').textContent = 'התחבר כדי שהתיק, המעקב וההיסטוריה יישמרו בענן ויעברו איתך בין מכשירים.';
    }
    ovl.classList.add('open');
  }
  function closeModal() { document.getElementById('tr-auth-ovl').classList.remove('open'); }
  function setMode(m) {
    mode = m;
    document.getElementById('tr-tab-login').classList.toggle('on', m === 'login');
    document.getElementById('tr-tab-signup').classList.toggle('on', m === 'signup');
    document.getElementById('tr-go').textContent = m === 'login' ? 'התחבר' : 'הירשם';
    document.getElementById('tr-pass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    msg('');
  }
  function msg(text, cls) {
    var el = document.getElementById('tr-msg');
    el.textContent = text || '';
    el.className = 'msg ' + (cls || '');
  }

  function submit() {
    var email = document.getElementById('tr-email').value.trim();
    var pass = document.getElementById('tr-pass').value;
    if (!email || pass.length < 6) return msg('הזן אימייל תקין וסיסמה של 6 תווים לפחות', 'err');
    msg('רק רגע...');
    var op = mode === 'login'
      ? sb.auth.signInWithPassword({ email: email, password: pass })
      : sb.auth.signUp({ email: email, password: pass });
    op.then(function (res) {
      if (res.error) {
        var t = res.error.message || '';
        if (/confirm/i.test(t)) return msg('האימייל עדיין לא אומת - בדוק את תיבת הדואר שלך', 'err');
        if (/Invalid login/i.test(t)) return msg('אימייל או סיסמה שגויים', 'err');
        if (/already registered/i.test(t)) return msg('האימייל כבר רשום - עבור להתחברות', 'err');
        return msg('שגיאה: ' + t, 'err');
      }
      if (mode === 'signup' && res.data && !res.data.session) {
        return msg('נשלח אליך מייל אימות - אשר אותו ואז התחבר כאן', 'ok');
      }
      onLogin(res.data.session ? res.data.session.user : res.data.user, true);
    });
  }

  function onLogin(u, fresh) {
    user = u;
    renderChip();
    pull().then(function (cloudDoc) {
      if (cloudDoc) {
        // Existing profile: the cloud copy is the source of truth.
        apply(cloudDoc);
        try { sessionStorage.setItem(APPLIED_FLAG, '1'); } catch (e) {}
        location.reload();
      } else {
        // First login on this account: seed the cloud with what's here.
        push().then(function () {
          if (fresh) { closeModal(); msg(''); }
        });
        closeModal();
      }
    }).catch(function () { setStatus('err'); closeModal(); });
  }

  function logout() {
    clearTimeout(pushTimer);
    push().then(function () {
      return sb.auth.signOut();
    }).then(function () {
      user = null;
      clearLocal(); // don't leave this user's portfolio on a shared device
      location.reload();
    });
  }

  // ---------- boot ----------
  function boot() {
    build();
    if (!configured) return;
    sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) return;
      user = session.user;
      renderChip();
      // Fresh page load while logged in: adopt the cloud copy unless we just did.
      var justApplied = false;
      try { justApplied = sessionStorage.getItem(APPLIED_FLAG) === '1'; sessionStorage.removeItem(APPLIED_FLAG); } catch (e) {}
      if (justApplied) return;
      pull().then(function (cloudDoc) {
        if (!cloudDoc) return push();
        if (stable(cloudDoc) !== stable(collect())) {
          apply(cloudDoc);
          try { sessionStorage.setItem(APPLIED_FLAG, '1'); } catch (e) {}
          location.reload();
        }
      }).catch(function () { setStatus('err'); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
