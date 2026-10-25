/* Κρατήσεις — Ψητοπωλείο Παπαχρήστου */
(function () {
  'use strict';
  const VERSION = '1.6.0';
  const L = window.Logic;

  const DEFAULT_SETTINGS = {
    shop_name: 'Ψητοπωλείο Παπαχρήστου', shop_phone: '',
    slot_minutes: 30, duration_minutes: 120, max_covers_per_slot: 60, max_party_size: 20,
    hours: {
      1: [{ open: '18:00', close: '23:30' }], 2: [{ open: '18:00', close: '23:30' }],
      3: [{ open: '18:00', close: '23:30' }], 4: [{ open: '18:00', close: '23:30' }],
      5: [{ open: '13:00', close: '16:30' }, { open: '18:00', close: '00:00' }],
      6: [{ open: '13:00', close: '16:30' }, { open: '18:00', close: '00:00' }],
      0: [{ open: '13:00', close: '17:00' }]
    },
    tpl_confirm: 'Γεια σας {ονομα}! Η κράτησή σας στο {καταστημα} για {ατομα} άτομα, {ημερα} {ημερομηνια} στις {ωρα}, επιβεβαιώθηκε. Για αλλαγές: {τηλεφωνο}.',
    tpl_reminder: 'Καλησπέρα {ονομα}! Σας θυμίζουμε την κράτησή σας στο {καταστημα} {ημερα} {ημερομηνια} στις {ωρα} για {ατομα} άτομα. Σας περιμένουμε!',
    tpl_cancel: 'Γεια σας {ονομα}. Η κράτησή σας στο {καταστημα} για {ημερα} {ημερομηνια} στις {ωρα} ακυρώθηκε. Για νέα κράτηση: {τηλεφωνο}.'
  };

  const STATUS = {
    confirmed: 'Επιβεβαιωμένη', seated: 'Ήρθε', done: 'Έφυγε', cancelled: 'Ακυρώθηκε', noshow: 'Δεν ήρθε'
  };

  const S = {
    store: null, user: null, settings: DEFAULT_SETTINGS, tables: [], areas: [], closures: [],
    date: L.fmtDate(new Date()), view: 'list', filter: 'active', q: '',
    dayRes: [], upcoming: [], floorArea: null, floorTime: null, floorDate: null, assignId: null
  };
  let FP = null;

  /* ---------- Εγκατάσταση ως εφαρμογή ---------- */
  let installEvt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; const b = document.getElementById('install-btn'); if (b) b.classList.remove('hidden'); });
  window.addEventListener('appinstalled', () => { installEvt = null; const b = document.getElementById('install-btn'); if (b) b.classList.add('hidden'); toast('Η εφαρμογή εγκαταστάθηκε'); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  async function installApp() {
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; return; }
    const steps = isIOS()
      ? ['Άνοιξε τη σελίδα στο Safari.', 'Πάτα το κουμπί Κοινοποίηση (το τετράγωνο με το βελάκι).', 'Διάλεξε «Προσθήκη στην οθόνη Αφετηρίας» και μετά «Προσθήκη».']
      : ['Στο Chrome / Edge πάτα το μενού (⋮) πάνω δεξιά.', 'Διάλεξε «Εγκατάσταση εφαρμογής» ή «Προσθήκη στην αρχική οθόνη».', 'Το εικονίδιο «Κρατήσεις» θα εμφανιστεί στην οθόνη ή στην επιφάνεια εργασίας.'];
    openModal('Εγκατάσταση εφαρμογής', [
      isStandalone() ? h('div', { class: 'infobox' }, 'Η εφαρμογή είναι ήδη εγκατεστημένη σε αυτή τη συσκευή.') : null,
      h('ol', { class: 'fp-help', style: { fontSize: '15px', gap: '8px' } }, steps.map(t => h('li', null, t)))
    ]);
  }

  /* ---------- Χώροι ---------- */
  const natural = (a, b) => String(a.name).localeCompare(String(b.name), 'el', { numeric: true });
  function areaName(id) { const a = S.areas.find(x => String(x.id) === String(id)); return a ? a.name : ''; }
  function areaGroups() {
    const groups = S.areas.map(a => ({ id: a.id, name: a.name, tables: S.tables.filter(t => String(t.area_id) === String(a.id)) }));
    const orphan = S.tables.filter(t => !S.areas.some(a => String(a.id) === String(t.area_id)));
    if (orphan.length) groups.push({ id: null, name: 'Χωρίς χώρο', tables: orphan });
    groups.forEach(g => g.tables.sort(natural));
    return groups.filter(g => g.tables.length);
  }

  /* ---------- Βοηθητικά DOM ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const $ = s => document.querySelector(s);
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, err ? 4500 : 2200);
  }
  function svg(path) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = path; return s;
  }
  const IC = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'
  };

  /* ---------- Modal ---------- */
  function openModal(title, body, foot, opts) {
    opts = opts || {};
    const root = $('#modal-root');
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
    const onKey = e => { if (e.key === 'Escape' && ov === root.lastElementChild) close(); };
    const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov) close(); } },
      h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('h2', null, title),
          h('button', { class: 'btn ghost icon', 'aria-label': 'Κλείσιμο', onclick: close }, svg(IC.x))),
        h('div', { class: 'modal-body' }, body),
        foot ? h('div', { class: 'modal-foot' }, foot) : null));
    root.appendChild(ov);
    document.addEventListener('keydown', onKey);
    return close;
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(res => {
      let done = false;
      const fin = v => { if (!done) { done = true; res(v); } close(); };
      const close = openModal(title, h('p', { style: { margin: 0 } }, text), [
        h('button', { class: 'btn', onclick: () => fin(false) }, 'Πίσω'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => fin(true) }, okLabel || 'OK')
      ], { onClose: () => { if (!done) { done = true; res(false); } } });
    });
  }

  /* ---------- Εκκίνηση ---------- */
  async function boot() {
    const cfg = window.KRATISEIS_CONFIG || {};
    const wantDemo = /[?&]demo\b/.test(location.search);
    if (!wantDemo && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
      S.store = Store.supabaseStore(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } else if (wantDemo) {
      S.store = Store.demoStore(DEFAULT_SETTINGS);
    } else {
      return showSetup(!!(cfg.SUPABASE_URL && !window.supabase));
    }
    try { S.user = await S.store.getUser(); } catch (e) { S.user = null; }
    if (!S.user) return showLogin();
    startApp();
  }

  function showSetup(cdnFail) {
    const app = $('#app'); app.innerHTML = '';
    app.appendChild(h('div', { class: 'center' }, h('div', { class: 'login' },
      h('h1', null, 'Κρατήσεις'),
      cdnFail
        ? h('p', null, 'Δεν φόρτωσε η βιβλιοθήκη Supabase. Έλεγξε τη σύνδεση στο internet και ανανέωσε τη σελίδα.')
        : h('p', null, 'Η εφαρμογή δεν έχει συνδεθεί ακόμα με βάση. Συμπλήρωσε το config.js με τα στοιχεία του Supabase (δες README).'),
      h('a', { class: 'btn primary', href: '?demo' }, 'Άνοιγμα σε δοκιμαστική λειτουργία'),
      h('p', { class: 'hint' }, 'Στη δοκιμαστική λειτουργία τα δεδομένα μένουν μόνο σε αυτόν τον browser.'))));
  }

  function showLogin(err) {
    const app = $('#app'); app.innerHTML = '';
    const email = h('input', { class: 'input', type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, required: true, placeholder: 'π.χ. maria' });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const msg = h('div', { class: 'warnbox err' + (err ? '' : ' hidden') }, err || '');
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Σύνδεση');
    app.appendChild(h('div', { class: 'center' }, h('form', {
      class: 'login', onsubmit: async e => {
        e.preventDefault(); btn.disabled = true; msg.classList.add('hidden');
        try { await S.store.signIn(email.value.trim(), pass.value); S.user = await S.store.getUser(); startApp(); }
        catch (ex) { msg.textContent = 'Λάθος όνομα χρήστη ή κωδικός.'; msg.classList.remove('hidden'); btn.disabled = false; }
      }
    },
      h('h1', null, 'Κρατήσεις'),
      h('p', null, S.settings.shop_name),
      h('label', { class: 'field' }, 'Όνομα χρήστη', email),
      h('label', { class: 'field' }, 'Κωδικός', pass),
      msg, btn)));
    app.appendChild(h('div', { class: 'version' }, 'v' + VERSION));
    email.focus();
  }

  function showNoAccess() {
    const app = $('#app'); app.innerHTML = '';
    app.appendChild(h('div', { class: 'center' }, h('div', { class: 'login' },
      h('h1', null, 'Χωρίς πρόσβαση'),
      h('p', null, S.me ? 'Ο λογαριασμός σου έχει απενεργοποιηθεί. Μίλα με τον διαχειριστή.' : 'Αυτός ο λογαριασμός δεν είναι χρήστης της εφαρμογής. Μίλα με τον διαχειριστή.'),
      h('button', { class: 'btn primary', onclick: async () => { await S.store.signOut(); location.reload(); } }, 'Σύνδεση με άλλο λογαριασμό'))));
  }
  const isAdmin = () => !!(S.me && S.me.role === 'admin');

  let unsub = null;
  async function startApp() {
    try { S.me = await S.store.getMe(); } catch (e) { S.me = null; }
    if (!S.me || !S.me.active) return showNoAccess();
    try {
      const [st, tables, areas, closures] = await Promise.all([S.store.loadSettings(), S.store.listTables(), S.store.listAreas(), S.store.listClosures()]);
      S.settings = Object.assign({}, DEFAULT_SETTINGS, st || {});
      S.tables = tables; S.areas = areas; S.closures = closures;
    } catch (e) { toast('Σφάλμα φόρτωσης: ' + e.message, true); }
    Theme.setShopDefault(S.settings.theme, S.settings.theme_mode);
    FP = FloorPlan({
      S, L, h, svg, IC, toast, confirmBox, openResForm, tableNames, reload, renderView, isAdmin,
      onSaved: async () => { [S.areas, S.tables] = await Promise.all([S.store.listAreas(), S.store.listTables()]); await reload(); }
    });
    renderShell();
    await reload();
    if (/[?&]new=1/.test(location.search)) { history.replaceState(null, '', location.pathname + (S.store.demo ? '?demo' : '')); openResForm(null, {}); }
    if (unsub) unsub();
    unsub = S.store.subscribe(onRemoteChange);
    // ανανέωση "τώρα" γραμμής και ημερομηνίας κάθε λεπτό
    setInterval(() => { if (S.view === 'tables' || (S.view === 'floor' && !document.querySelector('.overlay'))) renderView(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
  }

  let rcTimer = null;
  function onRemoteChange(table) {
    clearTimeout(rcTimer);
    rcTimer = setTimeout(async () => {
      if (table === 'res_settings') { S.settings = Object.assign({}, DEFAULT_SETTINGS, await S.store.loadSettings()); Theme.setShopDefault(S.settings.theme, S.settings.theme_mode); }
      if (table === 'res_areas') S.areas = await S.store.listAreas();
      if (table === 'res_tables') S.tables = await S.store.listTables();
      if (table === 'res_closures') S.closures = await S.store.listClosures();
      reload();
    }, 250);
  }

  async function reload() {
    const today = L.fmtDate(new Date());
    try {
      const [day, up] = await Promise.all([
        S.store.listReservations(S.date, S.date),
        S.store.listReservations(today, L.addDays(today, 14))
      ]);
      S.dayRes = day; S.upcoming = up;
    } catch (e) { toast('Σφάλμα: ' + e.message, true); }
    renderHeader(); renderView();
  }

  /* ---------- Κέλυφος ---------- */
  function renderShell() {
    const app = $('#app'); app.innerHTML = '';
    const dateInput = h('input', { class: 'input date-input', type: 'date', id: 'date-input', value: S.date,
      onchange: e => { if (e.target.value) setDate(e.target.value); } });
    app.append(
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
        h('div', { class: 'brand' },
          h('div', { class: 'brand-mark' }, svg('<path d="M7 10h10M7 14h10M7 18h6" stroke="#fff"/>')),
          h('div', null, 'Κρατήσεις', h('small', null, S.settings.shop_name))),
        S.store.demo ? h('span', { class: 'demo-pill' }, 'Δοκιμή') : null,
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn' + (installEvt ? '' : ' hidden'), id: 'install-btn', onclick: installApp }, svg(IC.download), h('span', { class: 'hide-sm' }, 'Εγκατάσταση')),
        h('button', { class: 'btn primary', onclick: () => openResForm(null, {}) }, svg(IC.plus), 'Νέα κράτηση'),
        h('button', { class: 'btn icon', title: 'Ρυθμίσεις', 'aria-label': 'Ρυθμίσεις', onclick: openSettings }, svg(IC.gear)),
        h('button', { class: 'btn user-btn', title: 'Ο λογαριασμός μου', 'aria-label': 'Ο λογαριασμός μου', onclick: openAccount },
          h('span', { class: 'avatar' + (isAdmin() ? ' admin' : '') }, initials(S.me.display_name)), h('span', { class: 'hide-sm' }, S.me.display_name)))),
      h('div', { class: 'datebar' },
        h('h1', { id: 'date-title' }),
        h('button', { class: 'btn icon', 'aria-label': 'Προηγούμενη μέρα', onclick: () => setDate(L.addDays(S.date, -1)) }, svg(IC.left)),
        h('button', { class: 'btn', onclick: () => setDate(L.fmtDate(new Date())) }, 'Σήμερα'),
        h('button', { class: 'btn icon', 'aria-label': 'Επόμενη μέρα', onclick: () => setDate(L.addDays(S.date, 1)) }, svg(IC.right)),
        dateInput,
        h('button', { class: 'btn ghost print-btn', onclick: () => { S.view = 'list'; renderTabs(); renderView(); setTimeout(() => window.print(), 50); } }, svg(IC.print), 'Εκτύπωση')),
      h('div', { class: 'closed-banner hidden', id: 'closed' }),
      h('div', { class: 'summary', id: 'summary' }),
      h('nav', { class: 'tabs', id: 'tabs' }),
      h('main', { class: 'main', id: 'view' }),
      h('div', { class: 'version' }, 'v' + VERSION + ' · ' + S.me.display_name + ' (' + ROLE[S.me.role] + ')')
    );
  }

  function setDate(d) { S.date = d; S.assignId = null; S.joinSel = []; const di = $('#date-input'); if (di) di.value = d; reload(); }

  function renderHeader() {
    const today = L.fmtDate(new Date());
    const rel = S.date === today ? 'Σήμερα' : S.date === L.addDays(today, 1) ? 'Αύριο' : S.date === L.addDays(today, -1) ? 'Χθες' : null;
    const t = $('#date-title'); t.innerHTML = '';
    t.append(L.dayName(S.date) + ' ' + L.prettyDate(S.date));
    if (rel) t.append(h('small', null, rel));

    const cl = S.closures.find(c => c.day === S.date);
    const ps = L.periodsFor(S.settings, S.date, S.closures);
    const cb = $('#closed');
    cb.innerHTML = '';
    const sp = L.specialFor(S.settings, S.date);
    if (cl || !ps.length) {
      cb.classList.remove('hidden');
      cb.append(h('div', null, cl ? 'Κλειστά: ' + (cl.note || 'αργία') : 'Δεν υπάρχει ωράριο λειτουργίας αυτή τη μέρα.'));
    } else if (sp) {
      cb.classList.remove('hidden');
      cb.append(h('div', { class: 'special' }, '★ Ειδικό ωράριο: ' + L.periodsText(sp.periods) + (sp.note ? ' — ' + sp.note : '')));
    } else cb.classList.add('hidden');

    const act = S.dayRes.filter(L.isActive);
    const pax = act.reduce((s, r) => s + r.party_size, 0);
    const seated = S.dayRes.filter(r => r.status === 'seated').reduce((s, r) => s + r.party_size, 0);
    const step = S.settings.slot_minutes || 30;
    let peak = 0, peakAt = null;
    for (const m of L.slotsFor(S.settings, S.date, S.closures)) {
      const c = L.coversAt(S.dayRes, m); if (c > peak) { peak = c; peakAt = m; }
    }
    const sm = $('#summary'); sm.innerHTML = '';
    sm.append(
      stat(act.length, 'Κρατήσεις'),
      stat(pax, 'Άτομα'),
      stat(seated, 'Στο μαγαζί τώρα'),
      stat(peak ? peak + ' / ' + S.settings.max_covers_per_slot : '—', peakAt != null ? 'Αιχμή ' + L.fromMin(peakAt) : 'Αιχμή'));
    void step;
    renderTabs();
  }
  function stat(v, l) { return h('div', { class: 'stat' }, h('b', null, v), h('span', null, l)); }

  function pendingMessages() {
    const tm = L.addDays(L.fmtDate(new Date()), 1);
    const has = r => r.phone || r.email;
    const conf = S.upcoming.filter(r => L.isActive(r) && has(r) && !r.confirm_sent_at);
    const rem = S.upcoming.filter(r => r.res_date === tm && L.isActive(r) && has(r) && !r.reminder_sent_at);
    return { conf, rem, tm };
  }

  function renderTabs() {
    const n = pendingMessages(); const cnt = n.conf.length + n.rem.length;
    const tabs = $('#tabs'); tabs.innerHTML = '';
    const tab = (id, label, badge) => h('button', { class: 'tab' + (S.view === id ? ' on' : ''),
      onclick: () => { S.view = id; renderTabs(); renderView(); } }, label, badge ? h('span', { class: 'badge' }, badge) : null);
    tabs.append(tab('list', 'Λίστα'), tab('floor', 'Κάτοψη'), tab('tables', 'Χρονοδιάγραμμα'), tab('days', 'Ημέρες'), tab('msgs', 'Μηνύματα', cnt || null));
    const on = tabs.querySelector('.tab.on'); if (on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = Math.max(0, on.offsetLeft - 24);
  }

  function renderView() {
    const v = $('#view'); if (!v) return; v.innerHTML = '';
    document.body.classList.toggle('view-floor', S.view === 'floor');
    if (S.view === 'list') renderList(v);
    else if (S.view === 'tables') renderTimeline(v);
    else if (S.view === 'floor') FP.renderLive(v);
    else if (S.view === 'days') renderDays(v);
    else renderMessages(v);
  }

  /* ---------- Λίστα ---------- */
  function renderLoad(v) {
    const slots = L.slotsFor(S.settings, S.date, S.closures);
    if (!slots.length) return;
    const max = S.settings.max_covers_per_slot || 60;
    const bars = h('div', { class: 'load-bars' });
    for (const m of slots) {
      const c = L.coversAt(S.dayRes, m);
      const pct = Math.min(100, Math.round(c / max * 100));
      bars.append(h('button', { class: 'load-col', title: L.fromMin(m) + ' — ' + c + ' / ' + max + ' άτομα. Πάτα για νέα κράτηση.',
        onclick: () => openResForm(null, { res_time: L.fromMin(m) }) },
        h('div', { class: 'load-track' }, h('div', { class: 'load-fill' + (pct >= 100 ? ' full' : pct >= 75 ? ' mid' : ''), style: { height: Math.max(c ? 6 : 0, pct) + '%' } })),
        h('small', null, m % 60 === 0 ? L.fromMin(m) : '·')));
    }
    v.append(h('div', { class: 'load' }, h('div', { class: 'load-head' }, h('span', null, 'Άτομα στο μαγαζί ανά ώρα'), h('span', null, 'μέγιστο ' + max)), bars));
  }

  function renderList(v) {
    v.append(h('div', { class: 'print-only' }, h('h2', null, 'Κρατήσεις ' + L.dayName(S.date) + ' ' + L.grDate(S.date))));
    renderLoad(v);
    const fchip = (id, label) => h('button', { class: 'chip' + (S.filter === id ? ' on' : ''), onclick: () => { S.filter = id; renderView(); } }, label);
    const search = h('input', { class: 'input search', type: 'search', placeholder: 'Αναζήτηση όνομα / τηλέφωνο', value: S.q,
      oninput: e => { S.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(() => { renderView(); const s = document.querySelector('.search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 200); } });
    v.append(h('div', { class: 'filters' }, fchip('active', 'Ενεργές'), fchip('all', 'Όλες'), fchip('closed', 'Ακυρ./Δεν ήρθαν'), search));

    const q = S.q.trim().toLowerCase();
    let list = S.dayRes.filter(r =>
      S.filter === 'all' ? true : S.filter === 'active' ? r.status !== 'cancelled' && r.status !== 'noshow' : (r.status === 'cancelled' || r.status === 'noshow'));
    if (q) list = list.filter(r => (r.name || '').toLowerCase().includes(q) || String(r.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '¤'));
    list.sort((a, b) => L.svcMin(a.res_time) - L.svcMin(b.res_time));

    if (!list.length) {
      v.append(h('div', { class: 'empty' }, S.dayRes.length ? 'Καμία κράτηση με αυτό το φίλτρο.' : 'Δεν υπάρχουν κρατήσεις για αυτή τη μέρα.',
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => openResForm(null, {}) }, svg(IC.plus), 'Νέα κράτηση'))));
      return;
    }
    let cur = null, group = null;
    for (const r of list) {
      const t = L.fromMin(L.svcMin(r.res_time));
      if (t !== cur) { cur = t; group = h('div', { class: 'time-group' }); v.append(group); }
      group.append(resCard(r));
    }
  }

  function tableNames(ids) {
    return (ids || []).map(id => (S.tables.find(t => Number(t.id) === Number(id)) || { name: '#' + id }).name).join(' + ');
  }

  function resCard(r) {
    const tn = tableNames(r.table_ids);
    const acts = h('div', { class: 'acts' });
    const set = (status, extra) => async () => {
      try { await S.store.patchReservation(r.id, Object.assign({ status }, extra || {})); toast(STATUS[status]); reload(); }
      catch (e) { toast(e.message, true); }
    };
    if (r.status === 'confirmed') {
      acts.append(h('button', { class: 'btn small primary', onclick: set('seated') }, 'Ήρθε'));
      acts.append(h('button', { class: 'btn small', onclick: set('noshow') }, 'Δεν ήρθε'));
    } else if (r.status === 'seated') {
      acts.append(h('button', { class: 'btn small', onclick: set('done') }, 'Έφυγε'));
    } else {
      acts.append(h('button', { class: 'btn small', onclick: set('confirmed') }, 'Επαναφορά'));
    }
    if ((r.phone || r.email) && L.isActive(r)) acts.append(h('button', { class: 'btn small', title: 'Μήνυμα στον πελάτη', onclick: () => openNotify(r, r.confirm_sent_at ? 'reminder' : 'confirm') }, svg(IC.msg)));
    acts.append(h('button', { class: 'btn small', onclick: () => openResForm(r) }, 'Αλλαγή'));

    const sent = [];
    if (L.isActive(r) && (r.phone || r.email)) {
      sent.push(r.confirm_sent_at ? h('span', { class: 'tag ok' }, '✓ επιβεβαίωση') : h('span', { class: 'tag miss' }, 'χωρίς επιβεβαίωση'));
      if (r.reminder_sent_at) sent.push(h('span', { class: 'tag ok' }, '✓ υπενθύμιση'));
    }
    const end = L.fromMin(L.svcMin(r.res_time) + (r.duration_min || 120));
    return h('div', { class: 'card st-' + r.status },
      h('div', { class: 'time' }, L.fromMin(L.svcMin(r.res_time)), h('small', null, 'έως ' + end)),
      h('div', { class: 'who' },
        h('div', { class: 'name' }, r.name, h('span', { class: 'pax' }, r.party_size + ' άτ.'), h('span', { class: 'status ' + r.status }, STATUS[r.status])),
        h('div', { class: 'meta' },
          h('span', null, tn ? ((r.table_ids || []).length > 1 ? '⛓ Ενωμένα ' : 'Τραπ. ') + tn : h('b', { style: { color: 'var(--warn)' } }, 'Χωρίς τραπέζι' + (r.area_pref && r.area_pref !== 'any' && areaName(r.area_pref) ? ' (' + areaName(r.area_pref) + ')' : ''))),
          r.phone ? h('a', { href: 'tel:' + L.intlPhone(r.phone) }, r.phone) : null,
          sent),
        r.notes ? h('div', { class: 'note' }, r.notes) : null),
      acts);
  }

  /* ---------- Χρονοδιάγραμμα τραπεζιών ---------- */
  function renderTimeline(v) {
    const active = S.dayRes.filter(L.isActive).concat(S.dayRes.filter(r => r.status === 'done'));
    const unassigned = S.dayRes.filter(r => L.isActive(r) && !(r.table_ids || []).length);
    if (unassigned.length) {
      v.append(h('div', { class: 'unassigned' }, h('b', null, 'Χωρίς τραπέζι:'),
        unassigned.map(r => h('button', { class: 'chip', onclick: () => openResForm(r) }, L.fromMin(L.svcMin(r.res_time)) + ' ' + r.name + ' (' + r.party_size + ')'))));
    }
    const rng = L.timelineRange(S.settings, S.date, S.closures, active);
    const cols = (rng.hi - rng.lo) / rng.step;
    const colW = 46;
    const px = m => (m - rng.lo) / rng.step * colW;

    const tl = h('div', { class: 'tl' });
    const head = h('div', { class: 'tl-head' }, h('div', { class: 'tl-name' }, 'Τραπ.'));
    const hc = h('div', { class: 'tl-cells' });
    for (let i = 0; i < cols; i++) {
      const m = rng.lo + i * rng.step;
      hc.append(h('div', { class: 'tl-hour' + (m % 60 ? ' half' : '') }, m % 60 ? '' : L.fromMin(m)));
    }
    head.append(hc); tl.append(head);

    for (const g of areaGroups()) {
      const list = g.tables;
      tl.append(h('div', { class: 'tl-area' }, h('span', null, g.name + ' · ' + list.filter(t => t.active !== false).length + ' τραπέζια')));
      for (const t of list) {
        const cells = h('div', { class: 'tl-cells', style: { width: cols * colW + 'px' } });
        for (let i = 0; i < cols; i++) cells.append(h('div', { class: 'tl-slot' + ((rng.lo + i * rng.step) % 60 ? ' half' : '') }));
        if (t.active !== false) {
          cells.addEventListener('click', e => {
            if (e.target.closest('.tl-block')) return;
            const rect = cells.getBoundingClientRect();
            const m = rng.lo + Math.floor((e.clientX - rect.left) / colW) * rng.step;
            openResForm(null, { res_time: L.fromMin(m), table_ids: [t.id], party_size: Math.min(t.seats, 2) });
          });
        }
        for (const r of active.filter(r => (r.table_ids || []).map(Number).includes(Number(t.id)))) {
          const s = L.svcMin(r.res_time), d = r.duration_min || 120;
          cells.append(h('button', { class: 'tl-block ' + r.status, style: { left: px(s) + 2 + 'px', width: Math.max(colW - 4, d / rng.step * colW - 4) + 'px' },
            title: r.name + ' · ' + r.party_size + ' άτ. · ' + L.fromMin(s) + '–' + L.fromMin(s + d) + (r.notes ? '\n' + r.notes : ''),
            onclick: () => openResForm(r) }, r.name, h('small', null, L.fromMin(s) + ' · ' + r.party_size + ' άτ.' +
              ((r.table_ids || []).length > 1 ? ' · ⛓ ' + tableNames((r.table_ids || []).filter(x => Number(x) !== Number(t.id))) : ''))));
        }
        tl.append(h('div', { class: 'tl-row' + (t.active === false ? ' inactive' : '') },
          h('div', { class: 'tl-name' }, t.name, h('small', null, t.seats + ' θέσ.')), cells));
      }
    }
    if (S.date === L.fmtDate(new Date())) {
      const now = new Date(); let m = now.getHours() * 60 + now.getMinutes(); if (m < 300) m += 1440;
      if (m >= rng.lo && m <= rng.hi) tl.append(h('div', { class: 'tl-now', style: { left: 78 + px(m) + 'px' } }));
    }
    const wrap = h('div', { class: 'tl-wrap' }, tl);
    v.append(h('p', { class: 'hint', style: { margin: '0 0 8px' } }, 'Πάτα σε κενό σημείο για νέα κράτηση σε εκείνο το τραπέζι και ώρα.'), wrap);
    // κύλιση κοντά στην τρέχουσα ώρα / πρώτη κράτηση
    requestAnimationFrame(() => {
      const first = active.length ? Math.min(...active.map(r => L.svcMin(r.res_time))) : null;
      let target = first;
      if (S.date === L.fmtDate(new Date())) { const n = new Date(); let m = n.getHours() * 60 + n.getMinutes(); if (m < 300) m += 1440; target = m - 60; }
      if (target != null) wrap.scrollLeft = Math.max(0, px(target) - 20);
    });
  }

  /* ---------- Σύνολα ανά ημέρα ---------- */
  async function renderDays(v) {
    const span = S.daysSpan || 14;
    if (!S.daysFrom) S.daysFrom = L.fmtDate(new Date());
    const from = S.daysFrom, to = L.addDays(from, span - 1);
    const head = h('div', { class: 'days-head' },
      h('div', { class: 'seg' }, [[7, 'Εβδομάδα'], [14, '2 εβδομάδες'], [31, 'Μήνας']].map(([n, l]) =>
        h('button', { class: span === n ? 'on' : '', onclick: () => { S.daysSpan = n; renderView(); } }, l))),
      h('div', { class: 'fp-timebox' },
        h('button', { class: 'btn icon small', 'aria-label': 'Προηγούμενες', onclick: () => { S.daysFrom = L.addDays(from, -span); renderView(); } }, svg(IC.left)),
        h('span', { class: 'days-range' }, L.prettyDate(from) + ' – ' + L.prettyDate(to)),
        h('button', { class: 'btn icon small', 'aria-label': 'Επόμενες', onclick: () => { S.daysFrom = L.addDays(from, span); renderView(); } }, svg(IC.right)),
        h('button', { class: 'btn small', onclick: () => { S.daysFrom = L.fmtDate(new Date()); renderView(); } }, 'Από σήμερα')));
    v.append(head);
    const box = h('div', null, h('p', { class: 'hint' }, 'Φόρτωση…'));
    v.append(box);
    let list = [];
    try { list = await S.store.listReservations(from, to); } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'warnbox err' }, e.message)); return; }
    if (S.view !== 'days' || S.daysFrom !== from || (S.daysSpan || 14) !== span) return;   // άλλαξε στο μεταξύ
    box.innerHTML = '';

    const days = [];
    for (let i = 0; i < span; i++) {
      const d = L.addDays(from, i);
      const rs = list.filter(r => r.res_date === d);
      const act = rs.filter(r => r.status !== 'cancelled' && r.status !== 'noshow');
      const lunch = act.filter(r => L.svcMin(r.res_time) < 17 * 60);
      const ps = L.periodsFor(S.settings, d, S.closures);
      let peak = 0; for (const m of L.slotsFor(S.settings, d, S.closures)) peak = Math.max(peak, L.coversAt(act, m));
      days.push({
        d, res: act.length, pax: act.reduce((s, r) => s + r.party_size, 0),
        lunchPax: lunch.reduce((s, r) => s + r.party_size, 0), lunchRes: lunch.length,
        cancelled: rs.length - act.length, noTable: act.filter(r => !(r.table_ids || []).length).length,
        peak, closed: !ps.length, special: !!L.specialFor(S.settings, d)
      });
    }
    const tot = days.reduce((a, x) => ({ res: a.res + x.res, pax: a.pax + x.pax, can: a.can + x.cancelled }), { res: 0, pax: 0, can: 0 });
    const open = days.filter(x => !x.closed).length || 1;
    const best = days.slice().sort((a, b) => b.pax - a.pax)[0];
    box.append(h('div', { class: 'summary days-sum' },
      stat(tot.res, 'Κρατήσεις'), stat(tot.pax, 'Άτομα'),
      stat((tot.pax / open).toFixed(1).replace('.', ','), 'Άτομα / ανοιχτή μέρα'),
      stat(best && best.pax ? L.dayName(best.d).slice(0, 3) + ' ' + L.prettyDate(best.d) : '—', best && best.pax ? 'Πιο γεμάτη · ' + best.pax + ' άτ.' : 'Πιο γεμάτη')));

    const max = Math.max(10, ...days.map(x => x.pax));
    const today = L.fmtDate(new Date());
    const chart = h('div', { class: 'days-chart' + (span > 14 ? ' dense' : '') }, days.map(x => h('button', {
      class: 'day-col' + (x.d === today ? ' today' : '') + (x.closed ? ' closed' : '') + (x.d === S.date ? ' sel' : ''),
      title: L.dayName(x.d) + ' ' + L.grDate(x.d) + '\n' + x.res + ' κρατήσεις · ' + x.pax + ' άτομα' + (x.lunchPax ? '\nΜεσημέρι ' + x.lunchPax + ' · Βράδυ ' + (x.pax - x.lunchPax) : '') + (x.cancelled ? '\nΑκυρώσεις/δεν ήρθαν: ' + x.cancelled : '') + '\nΠάτα για τη λίστα της ημέρας',
      onclick: () => { S.view = 'list'; setDate(x.d); }
    },
      h('span', { class: 'day-num' }, x.pax || ''),
      h('div', { class: 'day-track' },
        h('div', { class: 'day-fill eve', style: { height: ((x.pax - x.lunchPax) / max * 100) + '%' } }),
        h('div', { class: 'day-fill lunch', style: { height: (x.lunchPax / max * 100) + '%' } })),
      h('small', { class: 'day-name' }, x.closed ? 'κλ.' : L.dayName(x.d).slice(0, 2) + (x.special ? '★' : '')),
      h('small', { class: 'day-date' }, x.d.slice(8) + '/' + x.d.slice(5, 7)))));
    box.append(h('div', { class: 'load days-card' },
      h('div', { class: 'load-head' }, h('span', null, 'Άτομα ανά ημέρα'),
        h('span', { class: 'days-legend' }, h('i', { class: 'lg-lunch' }), 'Μεσημέρι', h('i', { class: 'lg-eve' }), 'Βράδυ')),
      chart));

    // πίνακας
    const rows = days.filter(x => x.res || x.cancelled || x.closed || x.special);
    box.append(h('div', { class: 'days-table' },
      h('div', { class: 'dt-row dt-head' }, h('span', null, 'Ημέρα'), h('span', null, 'Κρατ.'), h('span', null, 'Άτομα'), h('span', { class: 'hide-sm' }, 'Μεσημ. / Βράδυ'), h('span', { class: 'hide-sm' }, 'Αιχμή'), h('span', null, '')),
      rows.length ? rows.map(x => h('button', { class: 'dt-row' + (x.d === today ? ' today' : ''), onclick: () => { S.view = 'list'; setDate(x.d); } },
        h('span', null, h('b', null, L.dayName(x.d).slice(0, 3) + ' ' + L.grDate(x.d).slice(0, 5)), x.closed ? h('span', { class: 'sp-tag closed' }, 'Κλειστά') : x.special ? h('span', { class: 'sp-tag open' }, '★') : null),
        h('span', null, x.res),
        h('span', null, h('b', null, x.pax)),
        h('span', { class: 'hide-sm' }, x.lunchPax + ' / ' + (x.pax - x.lunchPax)),
        h('span', { class: 'hide-sm' + (x.peak > (S.settings.max_covers_per_slot || 1e9) ? ' over' : '') }, x.peak ? x.peak + '/' + S.settings.max_covers_per_slot : '—'),
        h('span', { class: 'dt-flags' }, x.noTable ? h('span', { class: 'tag miss' }, x.noTable + ' χωρίς τραπ.') : null, x.cancelled ? h('span', { class: 'tag' }, x.cancelled + ' ακυρ.') : null)))
        : h('div', { class: 'empty', style: { padding: '24px' } }, 'Καμία κράτηση σε αυτό το διάστημα.')));
  }

  /* ---------- Μηνύματα ---------- */
  function renderMessages(v) {
    const { conf, rem, tm } = pendingMessages();
    v.append(h('div', { class: 'infobox' }, 'Τα μηνύματα ανοίγουν στο SMS / Viber / WhatsApp / email της συσκευής, έτοιμα για αποστολή. Μετά την αποστολή σημειώνονται εδώ ως σταλμένα.'));
    const sec = (title, list, kind, empty) => {
      v.append(h('h3', { style: { margin: '20px 0 8px', fontSize: '16px' } }, title, ' ', h('span', { class: 'tag' }, '(' + list.length + ')')));
      if (!list.length) { v.append(h('div', { class: 'empty', style: { padding: '20px' } }, empty)); return; }
      for (const r of list) {
        v.append(h('div', { class: 'card st-' + r.status },
          h('div', { class: 'time' }, L.fromMin(L.svcMin(r.res_time)), h('small', null, L.dayName(r.res_date).slice(0, 3) + ' ' + L.prettyDate(r.res_date))),
          h('div', { class: 'who' }, h('div', { class: 'name' }, r.name, h('span', { class: 'pax' }, r.party_size + ' άτ.')),
            h('div', { class: 'meta' }, h('span', null, r.phone || r.email))),
          h('div', { class: 'acts' }, h('button', { class: 'btn small primary', onclick: () => openNotify(r, kind) }, svg(IC.msg), kind === 'confirm' ? 'Επιβεβαίωση' : 'Υπενθύμιση'))));
      }
    };
    sec('Υπενθύμιση για αύριο, ' + L.dayName(tm) + ' ' + L.prettyDate(tm), rem, 'reminder', 'Όλες οι υπενθυμίσεις για αύριο έχουν σταλεί.');
    sec('Δεν έχει σταλεί επιβεβαίωση (επόμενες 14 μέρες)', conf, 'confirm', 'Όλες οι επιβεβαιώσεις έχουν σταλεί.');
  }

  function openNotify(r, kind, after) {
    const KIND = { confirm: ['Επιβεβαίωση', 'tpl_confirm', 'confirm_sent_at'], reminder: ['Υπενθύμιση', 'tpl_reminder', 'reminder_sent_at'], cancel: ['Ακύρωση', 'tpl_cancel', null] };
    let k = kind;
    const ta = h('textarea', { class: 'input', rows: 5 });
    const fill = () => { ta.value = L.fillTemplate(S.settings[KIND[k][1]], r, S.settings); };
    fill();
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => {
      seg.innerHTML = '';
      for (const id of ['confirm', 'reminder', 'cancel']) seg.append(h('button', { class: k === id ? 'on' : '', onclick: () => { k = id; fill(); drawSeg(); } }, KIND[id][0]));
    };
    drawSeg();
    const num = L.intlPhone(r.phone);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // αντιγραφή αμέσως μέσα στο πάτημα (χωρίς αναμονή), ώστε η συσκευή να επιτρέψει μετά το άνοιγμα της εφαρμογής
    const copyNow = () => {
      let ok = false;
      try { ta.focus(); ta.select(); ok = document.execCommand('copy'); } catch (e) {}
      try { if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {}); ok = true; } catch (e) {}
      try { ta.setSelectionRange(0, 0); ta.blur(); } catch (e) {}
      return ok;
    };
    // οι σύνδεσμοι είναι πραγματικά <a href>, ώστε το άνοιγμα να γίνεται απευθείας από το πάτημα
    const link = (label, cls, hrefFn, extra) => {
      const a = h('a', Object.assign({ class: 'btn ' + (cls || ''), rel: 'noopener' }, extra || {}), label);
      a._href = hrefFn; return a;
    };
    const links = [];
    if (num) {
      links.push(link([svg(IC.msg), 'Viber'], 'ch-viber', () => 'viber://forward?text=' + encodeURIComponent(ta.value), {
        title: 'Ανοίγει το Viber με έτοιμο το μήνυμα — διαλέγεις τον πελάτη από τις επαφές',
        onclick: () => { copyNow(); toast('Διάλεξε τον πελάτη στο Viber και πάτα αποστολή'); }
      }));
      links.push(link('Viber στον αριθμό', 'ch-viber2', () => 'viber://chat?number=' + encodeURIComponent(num) + '&draft=' + encodeURIComponent(ta.value), {
        title: 'Ανοίγει συνομιλία με τον αριθμό του πελάτη (και αν δεν είναι στις επαφές)',
        onclick: () => { copyNow(); toast('Αν το μήνυμα δεν μπει μόνο του: πάτημα παρατεταμένα → Επικόλληση'); }
      }));
      links.push(link('WhatsApp', '', () => 'https://wa.me/' + num.replace('+', '') + '?text=' + encodeURIComponent(ta.value), { target: '_blank' }));
      links.push(link('SMS', '', () => 'sms:' + num + (isIOS ? '&' : '?') + 'body=' + encodeURIComponent(ta.value)));
    }
    if (r.email) links.push(link('Email', '', () => 'mailto:' + r.email + '?subject=' + encodeURIComponent(KIND[k][0] + ' κράτησης — ' + S.settings.shop_name) + '&body=' + encodeURIComponent(ta.value)));
    const syncLinks = () => links.forEach(a => { a.href = a._href(); });
    syncLinks();
    ta.addEventListener('input', syncLinks);
    seg.addEventListener('click', () => setTimeout(syncLinks, 0));
    const ch = h('div', { class: 'channels' }, links,
      h('button', { class: 'btn', onclick: () => { const ok = copyNow(); toast(ok ? 'Αντιγράφηκε' : 'Δεν έγινε αντιγραφή — επίλεξε το κείμενο χειροκίνητα', !ok); } }, 'Αντιγραφή'));
    const markBtn = h('button', { class: 'btn primary', onclick: async () => {
      const field = KIND[k][2];
      if (field) { try { await S.store.patchReservation(r.id, { [field]: new Date().toISOString() }); toast('Σημειώθηκε ως σταλμένο'); reload(); } catch (e) { toast(e.message, true); } }
      close(); if (after) after();
    } }, 'Στάλθηκε ✓');
    const close = openModal('Μήνυμα σε ' + r.name, [
      seg, ta,
      h('div', { class: 'hint' }, num
        ? h('span', null, h('b', null, 'Viber:'), ' ανοίγει με έτοιμο το μήνυμα και διαλέγεις τον πελάτη. ', h('b', null, 'Viber στον αριθμό:'), ' ανοίγει κατευθείαν τη συνομιλία με τον πελάτη, ακόμα κι αν δεν τον έχεις στις επαφές. Αν το μήνυμα δεν μπει μόνο του, κάνε Επικόλληση (έχει ήδη αντιγραφεί). Στο PC χρειάζεται εγκατεστημένο το Viber Desktop.')
        : 'Δεν υπάρχει κινητό — μόνο email.'),
      ch
    ], [h('button', { class: 'btn left', onclick: () => { close(); if (after) after(); } }, 'Αργότερα'), markBtn]);
  }

  /* ---------- Φόρμα κράτησης ---------- */
  const dayCache = {};
  async function resForDate(d) {
    if (d === S.date) return S.dayRes;
    if (!dayCache[d] || Date.now() - dayCache[d].t > 15000) dayCache[d] = { t: Date.now(), list: await S.store.listReservations(d, d) };
    return dayCache[d].list;
  }

  function openResForm(existing, preset) {
    const isNew = !existing;
    const r = Object.assign({
      res_date: S.date, res_time: '', duration_min: S.settings.duration_minutes || 120, party_size: 2,
      name: '', phone: '', email: '', area_pref: 'any', table_ids: [], status: 'confirmed', notes: ''
    }, existing ? JSON.parse(JSON.stringify(existing)) : {}, preset || {});
    r.res_time = r.res_time ? L.fromMin(L.toMin(r.res_time)) : '';
    r.table_ids = (r.table_ids || []).map(Number);
    if (isNew && !r.res_time) {
      const slots = L.slotsFor(S.settings, r.res_date, S.closures);
      const now = new Date(); let nm = now.getHours() * 60 + now.getMinutes(); if (nm < 300) nm += 1440;
      const pick = r.res_date === L.fmtDate(now) ? slots.find(m => m >= nm) : null;
      r.res_time = L.fromMin(pick != null ? pick : (slots.find(m => m >= 20 * 60) || slots[0] || 20 * 60));
    }

    let dayList = [];
    const fDate = h('input', { class: 'input', type: 'date', value: r.res_date });
    const fTime = h('select', { class: 'input' });
    const fDur = h('select', { class: 'input' }, [60, 90, 120, 150, 180, 240].map(m => h('option', { value: m }, (m / 60).toString().replace('.', ',') + ' ώρ.')));
    fDur.value = String(r.duration_min);
    if (fDur.value !== String(r.duration_min)) { fDur.append(h('option', { value: r.duration_min }, r.duration_min + ' λ.')); fDur.value = String(r.duration_min); }
    const fName = h('input', { class: 'input', value: r.name, autocomplete: 'off', placeholder: 'Ονοματεπώνυμο' });
    const fPhone = h('input', { class: 'input', type: 'tel', value: r.phone || '', placeholder: '69…', autocomplete: 'off' });
    const fEmail = h('input', { class: 'input', type: 'email', value: r.email || '', placeholder: 'προαιρετικό' });
    const fNotes = h('textarea', { class: 'input', rows: 2, placeholder: 'π.χ. καρεκλάκι μωρού, γενέθλια, αλλεργίες' }, r.notes || '');
    const fStatus = h('select', { class: 'input' }, Object.keys(STATUS).map(s => h('option', { value: s }, STATUS[s])));
    fStatus.value = r.status;
    const hist = h('div', { class: 'history hidden' });
    const warnBox = h('div', { class: 'warnbox hidden' });
    const tablesBox = h('div', { class: 'tables-pick' });
    const capInfo = h('span', { class: 'hint' });

    // άτομα
    const paxWrap = h('div', { class: 'pax-pick' });
    const paxOther = h('input', { class: 'input pax-num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, placeholder: '9+', 'aria-label': 'Άτομα (περισσότερα από 8)' });
    const paxBtns = [];
    const setPax = (n, fromInput) => {
      n = Math.max(1, Math.min(300, n | 0));
      r.party_size = n;
      paxBtns.forEach((b, i) => b.classList.toggle('on', n === i + 1));
      paxOther.classList.toggle('on', n > 8);
      if (!fromInput) paxOther.value = n > 8 ? String(n) : '';
      refresh();
    };
    for (let i = 1; i <= 8; i++) paxBtns.push(h('button', { type: 'button', onclick: () => setPax(i) }, i));
    const drawPax = () => {
      paxWrap.innerHTML = '';
      paxWrap.append(...paxBtns, paxOther,
        h('div', { class: 'pax-step' },
          h('button', { type: 'button', 'aria-label': 'Ένα άτομο λιγότερο', onclick: () => setPax(r.party_size - 1) }, '−'),
          h('button', { type: 'button', 'aria-label': 'Ένα άτομο περισσότερο', onclick: () => setPax(r.party_size + 1) }, '+')));
      paxBtns.forEach((b, i) => b.classList.toggle('on', r.party_size === i + 1));
      paxOther.classList.toggle('on', r.party_size > 8);
      paxOther.value = r.party_size > 8 ? String(r.party_size) : '';
    };
    // γράφεις ελεύθερα (π.χ. 12, 25): η τιμή δεν σβήνεται όσο πληκτρολογείς
    paxOther.addEventListener('input', () => {
      paxOther.value = paxOther.value.replace(/\D/g, '');
      const n = parseInt(paxOther.value, 10);
      if (n > 0) setPax(n, true);
    });
    paxOther.addEventListener('blur', () => { if (!paxOther.value && r.party_size > 8) paxOther.value = String(r.party_size); });

    // περιοχή
    const areaSeg = h('div', { class: 'seg' });
    const drawArea = () => {
      areaSeg.innerHTML = '';
      const opts = [{ id: 'any', name: 'Οπουδήποτε' }].concat(S.areas.map(a => ({ id: String(a.id), name: a.name })));
      if (!opts.some(o => o.id === String(r.area_pref))) r.area_pref = 'any';
      for (const a of opts) areaSeg.append(h('button', { type: 'button', class: String(r.area_pref) === a.id ? 'on' : '', onclick: () => { r.area_pref = a.id; drawArea(); } }, a.name));
    };

    function fillTimes() {
      const slots = L.slotsFor(S.settings, r.res_date, S.closures);
      const cur = L.svcMin(r.res_time);
      const all = slots.slice();
      if (cur != null && !all.includes(cur)) all.push(cur);
      if (!all.length) for (let m = 12 * 60; m <= 23 * 60 + 30; m += 30) all.push(m);
      all.sort((a, b) => a - b);
      fTime.innerHTML = '';
      const max = S.settings.max_covers_per_slot || 0;
      for (const m of all) {
        const c = L.coversAt(dayList, m, r.id);
        const out = !slots.includes(m);
        fTime.append(h('option', { value: L.fromMin(m) }, L.fromMin(m) + '   (' + c + (max ? '/' + max : '') + ' άτ.)' + (out ? ' — εκτός ωραρίου' : '')));
      }
      fTime.value = r.res_time;
    }

    function drawTables() {
      tablesBox.innerHTML = '';
      const start = L.svcMin(r.res_time), dur = r.duration_min;
      for (const g of areaGroups()) {
        const list = g.tables.filter(t => t.active !== false || r.table_ids.includes(Number(t.id)));
        if (!list.length) continue;
        const chips = h('div', { class: 'chips' });
        for (const t of list) {
          const c = L.tableConflict(dayList, t.id, start, dur, r.id);
          const on = r.table_ids.includes(Number(t.id));
          chips.append(h('button', { type: 'button', class: 'tchip' + (on ? ' on' : '') + (c ? ' busy' : ''),
            title: c ? 'Πιασμένο: ' + c.name + ' ' + L.fromMin(L.svcMin(c.res_time)) : t.seats + ' θέσεις',
            onclick: () => {
              r.table_ids = on ? r.table_ids.filter(x => x !== Number(t.id)) : r.table_ids.concat([Number(t.id)]);
              drawTables(); showWarnings();
            } }, t.name, h('small', null, c ? c.name.split(' ')[0] : t.seats + ' θ.')));
        }
        tablesBox.append(h('div', null, h('div', { class: 'area-label' }, g.name), chips));
      }
      const seats = r.table_ids.reduce((s, id) => s + ((S.tables.find(t => Number(t.id) === id) || {}).seats || 0), 0);
      capInfo.textContent = r.table_ids.length > 1 ? '⛓ Ενωμένα: ' + tableNames(r.table_ids) + ' · ' + seats + ' θέσεις'
        : r.table_ids.length ? 'Επιλεγμένο: ' + tableNames(r.table_ids) + ' · ' + seats + ' θέσεις'
        : 'Κανένα τραπέζι — πάτα όσα θέλεις να ενώσεις ή «Αυτόματη ανάθεση»';
    }

    function showWarnings() {
      const { errors, warnings } = L.validate(collect(), { settings: S.settings, closures: S.closures, tables: S.tables, reservations: dayList });
      const all = errors.concat(warnings);
      warnBox.innerHTML = '';
      if (all.length) { warnBox.className = 'warnbox'; warnBox.append(h('ul', null, all.map(w => h('li', null, w)))); }
      else warnBox.className = 'warnbox hidden';
    }

    async function refresh(full) {
      if (full) { try { dayList = await resForDate(r.res_date); } catch (e) { dayList = []; } fillTimes(); }
      drawTables(); showWarnings();
    }

    function collect() {
      return {
        id: r.id, res_date: fDate.value, res_time: fTime.value || r.res_time, duration_min: Number(fDur.value),
        party_size: r.party_size, name: fName.value.trim(), phone: fPhone.value.trim() || null, email: fEmail.value.trim() || null,
        area_pref: r.area_pref, table_ids: r.table_ids, status: fStatus.value, notes: fNotes.value.trim() || null
      };
    }

    fDate.addEventListener('change', () => { if (fDate.value) { r.res_date = fDate.value; refresh(true); } });
    fTime.addEventListener('change', () => { r.res_time = fTime.value; refresh(); });
    fDur.addEventListener('change', () => { r.duration_min = Number(fDur.value); refresh(); });
    fStatus.addEventListener('change', showWarnings);
    fName.addEventListener('input', showWarnings);

    let phT = null;
    fPhone.addEventListener('input', () => {
      clearTimeout(phT);
      phT = setTimeout(async () => {
        const digits = fPhone.value.replace(/\D/g, '');
        if (digits.length < 10) { hist.classList.add('hidden'); return; }
        let past = [];
        try { past = (await S.store.findByPhone(digits)).filter(x => x.id !== r.id); } catch (e) {}
        if (!past.length) { hist.className = 'history'; hist.textContent = 'Νέος πελάτης.'; return; }
        const ns = past.filter(x => x.status === 'noshow').length;
        const last = past[0];
        hist.className = 'history'; hist.innerHTML = '';
        hist.append(h('span', null, h('b', null, last.name), ' · ', past.length + ' προηγ. κρατήσεις, τελευταία ' + L.grDate(last.res_date),
          ns ? h('span', { style: { color: 'var(--bad)', fontWeight: 700 } }, ' · ' + ns + ' φορές δεν ήρθε') : null,
          (past.find(x => x.notes) ? h('div', null, 'Σημείωση: ' + past.find(x => x.notes).notes) : null)));
        if (!fName.value.trim()) { fName.value = last.name; showWarnings(); }
        if (!fEmail.value.trim() && last.email) fEmail.value = last.email;
      }, 350);
    });

    const autoBtn = h('button', { type: 'button', class: 'btn small', onclick: () => {
      const ids = L.suggestTables(S.tables, dayList, r.party_size, L.svcMin(r.res_time), r.duration_min, r.area_pref, r.id);
      if (!ids.length) { toast('Δεν βρέθηκαν ελεύθερα τραπέζια για ' + r.party_size + ' άτομα', true); return; }
      r.table_ids = ids.map(Number); drawTables(); showWarnings();
    } }, 'Αυτόματη ανάθεση');

    const saveBtn = h('button', { class: 'btn primary', onclick: save }, isNew ? 'Αποθήκευση' : 'Αποθήκευση αλλαγών');
    async function save() {
      const data = collect();
      const { errors, warnings } = L.validate(data, { settings: S.settings, closures: S.closures, tables: S.tables, reservations: dayList });
      if (errors.length) { showWarnings(); return; }
      if (warnings.length && !(await confirmBox('Προσοχή', warnings.join(' '), 'Αποθήκευση παρόλα αυτά'))) return;
      saveBtn.disabled = true;
      const wasActive = existing && L.isActive(existing);
      try {
        if (isNew) data.created_by = S.me ? S.me.display_name : null;
        // αν άλλαξε μέρα/ώρα, η επιβεβαίωση/υπενθύμιση πρέπει να ξανασταλεί
        if (!isNew && (existing.res_date !== data.res_date || L.toMin(existing.res_time) !== L.toMin(data.res_time))) {
          data.confirm_sent_at = null; data.reminder_sent_at = null;
        }
        const saved = await S.store.saveReservation(data);
        delete dayCache[data.res_date];
        close(); toast(isNew ? 'Η κράτηση αποθηκεύτηκε' : 'Αποθηκεύτηκε');
        if (data.res_date !== S.date) setDate(data.res_date); else reload();
        if ((saved.phone || saved.email)) {
          if (isNew || (data.confirm_sent_at === null && L.isActive(saved))) openNotify(saved, 'confirm');
          else if (wasActive && saved.status === 'cancelled') openNotify(saved, 'cancel');
        }
      } catch (e) { saveBtn.disabled = false; toast('Σφάλμα: ' + e.message, true); }
    }

    const foot = [
      !isNew && r.status !== 'cancelled' ? h('button', { class: 'btn danger left', onclick: async () => {
        if (!(await confirmBox('Ακύρωση κράτησης', 'Να ακυρωθεί η κράτηση του/της ' + r.name + ';', 'Ακύρωση κράτησης', true))) return;
        try {
          const saved = await S.store.patchReservation(r.id, { status: 'cancelled' });
          close(); toast('Ακυρώθηκε'); reload();
          if (saved.phone || saved.email) openNotify(saved, 'cancel');
        } catch (e) { toast(e.message, true); }
      } }, 'Ακύρωση κράτησης') : null,
      !isNew && r.status === 'cancelled' ? h('button', { class: 'btn danger left', onclick: async () => {
        if (!(await confirmBox('Διαγραφή', 'Οριστική διαγραφή της κράτησης; Δεν αναιρείται.', 'Διαγραφή', true))) return;
        try { await S.store.deleteReservation(r.id); close(); toast('Διαγράφηκε'); reload(); } catch (e) { toast(e.message, true); }
      } }, 'Διαγραφή') : null,
      h('button', { class: 'btn', onclick: () => close() }, 'Κλείσιμο'),
      saveBtn
    ];

    drawPax(); drawArea();
    const close = openModal(isNew ? 'Νέα κράτηση' : 'Κράτηση · ' + r.name, [
      h('div', { class: 'grid3' },
        h('label', { class: 'field' }, 'Ημερομηνία', fDate),
        h('label', { class: 'field' }, 'Ώρα', fTime),
        h('label', { class: 'field' }, 'Διάρκεια', fDur)),
      h('div', { class: 'field' }, h('span', { class: 'field', style: { fontSize: '13px' } }, 'Άτομα'), paxWrap),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Τηλέφωνο', fPhone),
        h('label', { class: 'field' }, 'Όνομα', fName)),
      hist,
      h('div', { class: 'section-title' }, h('span', null, 'Τραπέζι'), h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center', textTransform: 'none', letterSpacing: 0 } }, areaSeg, autoBtn)),
      tablesBox, capInfo,
      h('label', { class: 'field' }, 'Σημειώσεις', fNotes),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Email', fEmail),
        isNew ? h('span') : h('label', { class: 'field' }, 'Κατάσταση', fStatus)),
      warnBox
    ], foot, { wide: true });
    refresh(true);
    setTimeout(() => (isNew ? fPhone : fName).focus(), 30);
  }

  /* ---------- Ρυθμίσεις ---------- */
  function openSettings() {
    const st = JSON.parse(JSON.stringify(S.settings));
    let tab = isAdmin() ? 'general' : 'look';
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const seg = h('div', { class: 'seg', style: { flexWrap: 'wrap' } });
    const tabs = isAdmin()
      ? { general: 'Γενικά', look: 'Εμφάνιση', users: 'Χρήστες', hours: 'Ωράριο', closures: 'Ειδικές μέρες', tables: 'Χώροι & τραπέζια', msgs: 'Μηνύματα' }
      : { look: 'Εμφάνιση' };
    const drawSeg = () => { seg.innerHTML = ''; for (const k in tabs) seg.append(h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; drawSeg(); draw(); } }, tabs[k])); };
    const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    body.append(seg, content);

    const num = (key, label, hint) => {
      const i = h('input', { class: 'input', type: 'number', min: 1, value: st[key], oninput: e => { st[key] = parseInt(e.target.value, 10) || 0; } });
      return h('label', { class: 'field' }, label, i, hint ? h('span', { class: 'hint' }, hint) : null);
    };
    const txt = (key, label) => h('label', { class: 'field' }, label, h('input', { class: 'input', value: st[key] || '', oninput: e => { st[key] = e.target.value; } }));

    async function saveSettings() {
      try { await S.store.saveSettings(st); S.settings = Object.assign({}, DEFAULT_SETTINGS, st); toast('Οι ρυθμίσεις αποθηκεύτηκαν'); renderShell(); reload(); }
      catch (e) { toast(e.message, true); }
    }

    function draw() {
      content.innerHTML = '';
      if (tab === 'general') {
        content.append(
          h('div', { class: 'grid2' }, txt('shop_name', 'Όνομα καταστήματος'), txt('shop_phone', 'Τηλέφωνο καταστήματος (μπαίνει στα μηνύματα)')),
          h('div', { class: 'grid2' },
            num('max_covers_per_slot', 'Μέγιστα άτομα ταυτόχρονα', 'Πάνω από αυτό εμφανίζεται προειδοποίηση.'),
            num('duration_minutes', 'Προεπιλεγμένη διάρκεια (λεπτά)', 'Πόση ώρα «κρατάει» το τραπέζι μια κράτηση.')),
          h('div', { class: 'grid2' },
            h('label', { class: 'field' }, 'Βήμα ωρών κράτησης', (() => {
              const s = h('select', { class: 'input', onchange: e => { st.slot_minutes = Number(e.target.value); } }, [15, 30, 60].map(m => h('option', { value: m }, m + ' λεπτά')));
              s.value = String(st.slot_minutes); return s;
            })()),
            num('max_party_size', 'Προειδοποίηση για παρέες πάνω από', 'άτομα')),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
            h('button', { class: 'btn', onclick: installApp }, svg(IC.download), 'Εγκατάσταση ως εφαρμογή'),
            h('button', { class: 'btn primary', onclick: saveSettings }, 'Αποθήκευση')));
      }
      if (tab === 'hours') {
        const order = [1, 2, 3, 4, 5, 6, 0];
        st.hours = st.hours || {};
        for (const d of order) {
          const key = String(d);
          const periods = st.hours[key] = st.hours[key] || [];
          const pWrap = h('div', { class: 'periods' });
          const drawP = () => {
            pWrap.innerHTML = '';
            periods.forEach((p, i) => pWrap.append(h('div', { class: 'period' },
              h('input', { class: 'input', type: 'time', value: p.open, onchange: e => { p.open = e.target.value; } }), '–',
              h('input', { class: 'input', type: 'time', value: p.close, onchange: e => { p.close = e.target.value; } }),
              h('button', { class: 'btn ghost small', 'aria-label': 'Αφαίρεση', onclick: () => { periods.splice(i, 1); drawP(); } }, svg(IC.x)))));
            if (periods.length < 3) pWrap.append(h('div', null, h('button', { class: 'btn small', onclick: () => { periods.push({ open: periods.length ? '18:00' : '13:00', close: periods.length ? '23:30' : '17:00' }); drawP(); } }, '+ βάρδια')));
            if (!periods.length) pWrap.prepend(h('span', { class: 'tag miss' }, 'Κλειστά'));
          };
          drawP();
          content.append(h('div', { class: 'hours-row' }, h('b', null, L.DAY_NAMES[d]), h('span'), pWrap));
        }
        content.append(h('p', { class: 'hint', style: { margin: 0 } }, 'Κλείσιμο 00:00 ή μετά τα μεσάνυχτα (π.χ. 01:00) σημαίνει την επόμενη μέρα. Τελευταία κράτηση: ένα «βήμα» πριν το κλείσιμο.'),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onclick: saveSettings }, 'Αποθήκευση ωραρίου')));
      }
      if (tab === 'closures') {
        const today = L.fmtDate(new Date());
        st.special_hours = st.special_hours || {};
        // νέα ειδική μέρα
        let kind = 'special';
        const d = h('input', { class: 'input', type: 'date', min: today });
        const n = h('input', { class: 'input', placeholder: 'π.χ. Πάσχα, γιορτή, εκδήλωση' });
        const periods = [{ open: '12:00', close: '17:00' }, { open: '19:00', close: '00:00' }];
        const kindSeg = h('div', { class: 'seg' });
        const pWrap = h('div', { class: 'periods' });
        const weekly = h('div', { class: 'hint' });
        const drawKind = () => {
          kindSeg.innerHTML = '';
          [['special', '★ Ειδικό ωράριο'], ['closed', 'Κλειστά']].forEach(([k, l]) => kindSeg.append(h('button', { class: kind === k ? 'on' : '', onclick: () => { kind = k; drawKind(); } }, l)));
          pWrap.style.display = kind === 'special' ? '' : 'none';
        };
        const drawP = () => {
          pWrap.innerHTML = '';
          periods.forEach((p, i) => pWrap.append(h('div', { class: 'period' },
            h('input', { class: 'input', type: 'time', value: p.open, onchange: e => { p.open = e.target.value; } }), '–',
            h('input', { class: 'input', type: 'time', value: p.close, onchange: e => { p.close = e.target.value; } }),
            periods.length > 1 ? h('button', { class: 'btn ghost small', 'aria-label': 'Αφαίρεση', onclick: () => { periods.splice(i, 1); drawP(); } }, svg(IC.x)) : null)));
          if (periods.length < 3) pWrap.append(h('div', null, h('button', { class: 'btn small', onclick: () => { periods.push({ open: '18:00', close: '23:30' }); drawP(); } }, '+ βάρδια')));
        };
        const showWeekly = () => {
          if (!d.value) { weekly.textContent = ''; return; }
          const wk = (st.hours || {})[String(L.weekday(d.value))] || [];
          weekly.textContent = 'Κανονικά ' + L.dayName(d.value) + ': ' + (wk.length ? L.periodsText(wk) : 'κλειστά');
          if (wk.length && !d._touched) { periods.splice(0, periods.length, ...wk.map(p => ({ open: p.open, close: p.close }))); drawP(); }
        };
        d.addEventListener('change', showWeekly);
        drawKind(); drawP();
        const addBtn = h('button', { class: 'btn primary', onclick: async () => {
          if (!d.value) { toast('Διάλεξε ημερομηνία', true); return; }
          addBtn.disabled = true;
          try {
            if (kind === 'closed') {
              if (st.special_hours[d.value]) { delete st.special_hours[d.value]; await S.store.saveSettings(st); }
              await S.store.addClosure(d.value, n.value.trim() || null);
            } else {
              const ps = periods.filter(p => p.open && p.close);
              if (!ps.length) { toast('Βάλε τουλάχιστον μία βάρδια', true); addBtn.disabled = false; return; }
              if (S.closures.some(c => c.day === d.value)) await S.store.deleteClosure(d.value);
              // καθάρισμα παλιών ειδικών ημερών (πάνω από 60 μέρες πριν)
              const old = L.addDays(today, -60);
              Object.keys(st.special_hours).forEach(k => { if (k < old) delete st.special_hours[k]; });
              st.special_hours[d.value] = { periods: ps.map(p => ({ open: p.open, close: p.close })), note: n.value.trim() || null };
              await S.store.saveSettings(st);
            }
            S.settings = Object.assign({}, DEFAULT_SETTINGS, st);
            S.closures = await S.store.listClosures();
            toast('Αποθηκεύτηκε: ' + L.dayName(d.value) + ' ' + L.grDate(d.value));
            draw(); reload();
          } catch (e) { toast(e.message, true); addBtn.disabled = false; }
        } }, svg(IC.plus), 'Προσθήκη');
        content.append(
          h('p', { class: 'hint', style: { margin: 0 } }, 'Για συγκεκριμένες ημερομηνίες που διαφέρουν από το κανονικό ωράριο: γιορτές, εκδηλώσεις, άδειες. Εκείνη τη μέρα ισχύει μόνο αυτό.'),
          h('div', { class: 'special-form' },
            h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Ημερομηνία', d, weekly), h('div', { class: 'field' }, h('span', null, 'Τι ισχύει'), kindSeg)),
            pWrap,
            h('label', { class: 'field' }, 'Σημείωση', n),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, addBtn)));

        // λίστα επόμενων ειδικών ημερών
        const items = [];
        S.closures.filter(c => c.day >= today).forEach(c => items.push({ day: c.day, closed: true, note: c.note }));
        Object.keys(st.special_hours).filter(k => k >= today && !S.closures.some(c => c.day === k))
          .forEach(k => items.push({ day: k, closed: false, note: st.special_hours[k].note, periods: st.special_hours[k].periods }));
        items.sort((a, b) => a.day < b.day ? -1 : 1);
        content.append(h('div', { class: 'section-title', style: { marginTop: '6px' } }, 'Επόμενες ειδικές μέρες'));
        if (!items.length) content.append(h('p', { class: 'hint', style: { margin: 0 } }, 'Δεν υπάρχουν. Όλες οι μέρες ακολουθούν το κανονικό ωράριο.'));
        for (const it of items) content.append(h('div', { class: 'list-line' },
          h('span', { class: 'sp-tag ' + (it.closed ? 'closed' : 'open') }, it.closed ? 'Κλειστά' : '★ Ειδικό'),
          h('span', null, h('b', null, L.dayName(it.day) + ' ' + L.grDate(it.day)),
            it.closed ? '' : ' · ' + L.periodsText(it.periods), it.note ? h('span', { class: 'hint' }, ' — ' + it.note) : null),
          h('button', { class: 'btn small danger', onclick: async () => {
            try {
              if (it.closed) await S.store.deleteClosure(it.day);
              else { delete st.special_hours[it.day]; await S.store.saveSettings(st); S.settings = Object.assign({}, DEFAULT_SETTINGS, st); }
              S.closures = await S.store.listClosures(); draw(); reload();
            } catch (e) { toast(e.message, true); }
          } }, 'Αφαίρεση')));
      }
      if (tab === 'tables') {
        const groups = S.areas.map(a => ({ a, ts: S.tables.filter(t => String(t.area_id) === String(a.id)) }));
        content.append(
          h('div', { class: 'infobox' }, 'Σχεδίασε τους χώρους σου (σάλα, αυλή, βεράντα…), βάλε τα τραπέζια στη θέση τους, πρόσθεσε μπαρ, πόρτες, τοίχους και φυτά. Η αυτόματη ανάθεση ενώνει τα τραπέζια που είναι κοντά στην κάτοψη.'),
          groups.length ? h('div', null, groups.map(g => h('div', { class: 'list-line' },
            h('span', null, h('b', null, g.a.name), ' — ' + g.ts.length + ' τραπέζια, ' + g.ts.reduce((s, t) => s + (+t.seats || 0), 0) + ' θέσεις')))) :
            h('p', { class: 'hint' }, 'Δεν υπάρχουν ακόμα χώροι.'),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
            h('button', { class: 'btn primary', onclick: () => { closeSettings(); FP.openEditor(); } }, svg(IC.edit), 'Άνοιγμα σχεδιαστή κάτοψης')));
      }
      if (tab === 'look') {
        const r = Theme.resolved();
        const grid = h('div', { class: 'theme-grid' }, Theme.THEMES.map(t => {
          const dark = Theme.isDark(r.mode);
          const [c1, c2] = dark ? t.dark : t.light;
          return h('button', { class: 'theme-card' + (r.theme === t.id ? ' on' : ''), onclick: () => { Theme.setLocal({ theme: t.id }); draw(); } },
            h('div', { class: 'theme-sw', style: { background: 'linear-gradient(135deg,' + c1 + ',' + c2 + ')' } },
              r.theme === t.id ? h('span', { class: 'theme-check' }, svg(IC.check)) : null),
            h('div', { class: 'theme-dots' }, [c1, c2].map(c => h('i', { style: { background: 'color-mix(in srgb,' + c + ' 22%, var(--surface))' } })),
              h('i', { style: { background: c1 } })),
            h('span', null, t.name));
        }));
        const modeSeg = h('div', { class: 'seg' }, [['auto', 'Αυτόματο'], ['light', 'Φωτεινό'], ['dark', 'Σκοτεινό']].map(([k, l]) =>
          h('button', { class: r.mode === k ? 'on' : '', onclick: () => { Theme.setLocal({ mode: k }); draw(); } }, l)));
        content.append(
          h('div', { class: 'section-title' }, 'Χρωματικό θέμα'), grid,
          h('div', { class: 'section-title', style: { marginTop: '6px' } }, 'Φωτεινότητα'), modeSeg,
          h('p', { class: 'hint', style: { margin: 0 } }, '«Αυτόματο» ακολουθεί τη ρύθμιση της συσκευής (μέρα/νύχτα). Η επιλογή ισχύει για αυτή τη συσκευή.'),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '4px' } },
            h('button', { class: 'btn', style: { flex: '0 0 auto', marginRight: 'auto' }, onclick: installApp }, svg(IC.download), 'Εγκατάσταση ως εφαρμογή'),
            r.local ? h('button', { class: 'btn', style: { flex: '0 0 auto' }, onclick: () => { Theme.clearLocal(); draw(); } }, 'Επαναφορά στην προεπιλογή καταστήματος') : null,
            !isAdmin() ? null : h('button', { class: 'btn primary', style: { flex: '0 0 auto' }, onclick: async () => {
              st.theme = r.theme; st.theme_mode = r.mode;
              try { await S.store.saveSettings(st); S.settings = Object.assign({}, DEFAULT_SETTINGS, st); Theme.setShopDefault(st.theme, st.theme_mode); toast('Ορίστηκε για όλες τις συσκευές'); draw(); }
              catch (e) { toast(e.message, true); }
            } }, 'Ορισμός για όλες τις συσκευές')));
      }
      if (tab === 'users') renderUsers(content);
      if (tab === 'msgs') {
        const sample = { name: 'Γιώργος Παπαδόπουλος', party_size: 4, res_date: L.addDays(L.fmtDate(new Date()), 1), res_time: '21:00' };
        const tpl = (key, label) => {
          const prev = h('div', { class: 'history' });
          const upd = () => { prev.textContent = L.fillTemplate(st[key], sample, st); };
          const ta = h('textarea', { class: 'input', rows: 3, oninput: e => { st[key] = e.target.value; upd(); } }, st[key] || '');
          upd();
          return h('label', { class: 'field' }, label, ta, prev);
        };
        content.append(
          h('p', { class: 'hint', style: { margin: 0 } }, 'Πεδία: ', ['{ονομα}', '{ονοματεπωνυμο}', '{καταστημα}', '{ατομα}', '{ημερα}', '{ημερομηνια}', '{ωρα}', '{τηλεφωνο}'].map(x => [h('code', null, x), ' '])),
          tpl('tpl_confirm', 'Επιβεβαίωση'), tpl('tpl_reminder', 'Υπενθύμιση (την προηγούμενη μέρα)'), tpl('tpl_cancel', 'Ακύρωση'),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onclick: saveSettings }, 'Αποθήκευση μηνυμάτων')));
      }
    }
    drawSeg(); draw();
    const closeSettings = openModal('Ρυθμίσεις', body, null, { wide: true });
  }

  /* ---------- Χρήστες ---------- */
  const ROLE = { admin: 'Διαχειριστής', staff: 'Προσωπικό' };
  function initials(n) { return String(n || '?').trim().split(/\s+/).map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase(); }
  const GR = { 'α': 'a', 'ά': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'έ': 'e', 'ζ': 'z', 'η': 'i', 'ή': 'i', 'θ': 'th', 'ι': 'i', 'ί': 'i', 'ϊ': 'i', 'ΐ': 'i',
    'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'ό': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'ύ': 'y', 'ϋ': 'y', 'ΰ': 'y',
    'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o', 'ώ': 'o' };
  function toUsername(name) {
    const parts = String(name || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
      .map(w => w.replace(/ου/g, 'ou').split('').map(c => GR[c] != null ? GR[c] : c).join('').replace(/[^a-z0-9]/g, ''));
    return (parts[0] || '') + (parts[1] ? '.' + parts[1].charAt(0) : '');
  }
  function genPassword() {
    const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789'; let p = '';
    for (let i = 0; i < 4; i++) p += a[Math.floor(Math.random() * a.length)];
    for (let i = 0; i < 3; i++) p += d[Math.floor(Math.random() * d.length)];
    return p;
  }
  function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

  function showCredentials(title, u, password) {
    const text = 'Κρατήσεις — ' + S.settings.shop_name + '\nΔιεύθυνση: ' + appUrl() + '\nΌνομα χρήστη: ' + u.username + '\nΚωδικός: ' + password;
    openModal(title, [
      h('div', { class: 'cred' },
        h('div', null, h('span', null, 'Όνομα χρήστη'), h('b', null, u.username)),
        h('div', null, h('span', null, 'Κωδικός'), h('b', null, password)),
        h('div', null, h('span', null, 'Διεύθυνση'), h('b', { style: { fontSize: '13px', wordBreak: 'break-all' } }, appUrl()))),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Στείλε τα στοιχεία στον/στην ' + u.display_name + '. Μπορεί να αλλάξει τον κωδικό από το εικονίδιό του πάνω δεξιά.'),
      h('div', { class: 'channels' },
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Αντιγράφηκε'); } catch (e) { toast('Δεν έγινε αντιγραφή', true); } } }, 'Αντιγραφή'),
        h('a', { class: 'btn', href: 'viber://forward?text=' + encodeURIComponent(text) }, 'Viber'),
        h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        h('a', { class: 'btn', href: 'sms:?&body=' + encodeURIComponent(text) }, 'SMS'))
    ]);
  }

  async function renderUsers(content) {
    content.append(h('p', { class: 'hint', style: { margin: 0 } }, 'Φόρτωση…'));
    let list = [];
    try { list = await S.store.listStaff(); } catch (e) { content.innerHTML = ''; content.append(h('div', { class: 'warnbox err' }, e.message)); return; }
    content.innerHTML = '';
    const refresh = () => { content.innerHTML = ''; renderUsers(content); };
    content.append(
      h('div', { class: 'row', style: { alignItems: 'center' } },
        h('p', { class: 'hint', style: { margin: 0, flex: '1 1 260px' } }, 'Ο Διαχειριστής βλέπει και αλλάζει τα πάντα. Το Προσωπικό κάνει κρατήσεις και βλέπει κάτοψη/μηνύματα, αλλά όχι ρυθμίσεις και χρήστες.'),
        h('button', { class: 'btn primary', style: { flex: '0 0 auto' }, onclick: () => openUserForm(null, refresh) }, svg(IC.plus), 'Νέος χρήστης')),
      h('div', { class: 'users' }, list.map(u => h('div', { class: 'user-row' + (u.active ? '' : ' off') },
        h('span', { class: 'avatar' + (u.role === 'admin' ? ' admin' : '') }, initials(u.display_name)),
        h('div', { class: 'user-info' },
          h('b', null, u.display_name, S.me && u.user_id === S.me.user_id ? h('span', { class: 'tag' }, ' (εσύ)') : null),
          h('span', null, '@' + u.username)),
        h('span', { class: 'status ' + (u.role === 'admin' ? 'seated' : 'confirmed') }, ROLE[u.role]),
        u.active ? null : h('span', { class: 'status cancelled' }, 'Ανενεργός'),
        h('div', { class: 'acts' },
          h('button', { class: 'btn small', onclick: () => openPasswordForm(u) }, 'Κωδικός'),
          h('button', { class: 'btn small', onclick: () => openUserForm(u, refresh) }, 'Αλλαγή'))))));
  }

  function openUserForm(u, after) {
    const isNew = !u;
    const d = Object.assign({ username: '', display_name: '', role: 'staff', active: true }, u || {});
    let userTouched = !isNew;
    const fName = h('input', { class: 'input', value: d.display_name, placeholder: 'π.χ. Μαρία Παπαδοπούλου' });
    const fUser = h('input', { class: 'input', value: d.username, autocapitalize: 'none', autocorrect: 'off', spellcheck: false, placeholder: 'π.χ. maria' });
    const fPass = h('input', { class: 'input', value: isNew ? genPassword() : '', autocomplete: 'new-password' });
    fName.addEventListener('input', () => { if (!userTouched) fUser.value = toUsername(fName.value); });
    fUser.addEventListener('input', () => { userTouched = true; fUser.value = fUser.value.toLowerCase().replace(/\s/g, ''); });
    const roleSeg = h('div', { class: 'seg' });
    const drawRole = () => { roleSeg.innerHTML = ''; ['staff', 'admin'].forEach(r => roleSeg.append(h('button', { type: 'button', class: d.role === r ? 'on' : '', onclick: () => { d.role = r; drawRole(); } }, ROLE[r]))); };
    drawRole();
    const fActive = h('input', { type: 'checkbox', checked: d.active });
    const err = h('div', { class: 'warnbox err hidden' });
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      err.classList.add('hidden'); saveBtn.disabled = true;
      const row = Object.assign({}, d, { display_name: fName.value.trim(), username: fUser.value.trim().toLowerCase(), active: fActive.checked });
      try {
        if (isNew) {
          await S.store.createStaff(Object.assign(row, { password: fPass.value }));
          close(); after && after(); toast('Ο χρήστης δημιουργήθηκε');
          showCredentials('Νέος χρήστης: ' + row.display_name, row, fPass.value);
        } else {
          await S.store.updateStaff(row);
          if (S.me && row.user_id === S.me.user_id) { S.me = Object.assign(S.me, row); renderShell(); renderHeader(); renderView(); }
          close(); after && after(); toast('Αποθηκεύτηκε');
        }
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); saveBtn.disabled = false; }
    } }, isNew ? 'Δημιουργία' : 'Αποθήκευση');
    const close = openModal(isNew ? 'Νέος χρήστης' : 'Χρήστης · ' + d.display_name, [
      h('label', { class: 'field' }, 'Όνομα (όπως θα φαίνεται)', fName),
      h('label', { class: 'field' }, 'Όνομα χρήστη (για τη σύνδεση)', fUser, h('span', { class: 'hint' }, 'Λατινικά μικρά, αριθμοί, . _ - (3–30 χαρακτήρες)')),
      isNew ? h('label', { class: 'field' }, 'Κωδικός', h('div', { class: 'row' }, fPass,
        h('button', { type: 'button', class: 'btn', style: { flex: '0 0 auto' }, onclick: () => { fPass.value = genPassword(); } }, 'Νέος τυχαίος')),
        h('span', { class: 'hint' }, 'Τουλάχιστον 6 χαρακτήρες. Μπορεί να τον αλλάξει μετά ο ίδιος.')) : null,
      h('div', { class: 'field' }, h('span', null, 'Ρόλος'), roleSeg),
      isNew ? null : h('label', { class: 'fp-check' }, fActive, h('span', null, 'Ενεργός ', h('span', { class: 'hint' }, '(αν τον απενεργοποιήσεις, δεν μπορεί να μπει)'))),
      err
    ], [
      isNew ? null : h('button', { class: 'btn danger left', onclick: async () => {
        if (!(await confirmBox('Διαγραφή χρήστη', 'Οριστική διαγραφή του/της ' + d.display_name + '; Οι κρατήσεις που έχει περάσει μένουν.', 'Διαγραφή', true))) return;
        try { await S.store.deleteStaff(d.user_id); close(); after && after(); toast('Διαγράφηκε'); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
      } }, 'Διαγραφή'),
      h('button', { class: 'btn', onclick: () => close() }, 'Άκυρο'),
      saveBtn
    ]);
    setTimeout(() => fName.focus(), 30);
  }

  function openPasswordForm(u) {
    const f = h('input', { class: 'input', value: genPassword(), autocomplete: 'new-password' });
    const err = h('div', { class: 'warnbox err hidden' });
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true; err.classList.add('hidden');
      try { await S.store.setStaffPassword(u.user_id, f.value); close(); showCredentials('Νέος κωδικός: ' + u.display_name, u, f.value); }
      catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
    } }, 'Αλλαγή κωδικού');
    const close = openModal('Κωδικός · ' + u.display_name, [
      h('label', { class: 'field' }, 'Νέος κωδικός', h('div', { class: 'row' }, f,
        h('button', { type: 'button', class: 'btn', style: { flex: '0 0 auto' }, onclick: () => { f.value = genPassword(); } }, 'Νέος τυχαίος'))),
      err
    ], [h('button', { class: 'btn', onclick: () => close() }, 'Άκυρο'), btn]);
  }

  function openAccount() {
    const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'νέος κωδικός' });
    const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'ξανά τον νέο κωδικό' });
    const err = h('div', { class: 'warnbox err hidden' });
    const close = openModal('Ο λογαριασμός μου', [
      h('div', { class: 'user-row', style: { border: 0, padding: 0 } },
        h('span', { class: 'avatar big' + (isAdmin() ? ' admin' : '') }, initials(S.me.display_name)),
        h('div', { class: 'user-info' }, h('b', { style: { fontSize: '18px' } }, S.me.display_name), h('span', null, '@' + S.me.username + ' · ' + ROLE[S.me.role]))),
      h('div', { class: 'section-title' }, 'Αλλαγή κωδικού'),
      h('div', { class: 'grid2' }, p1, p2),
      err,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: async () => {
        err.classList.add('hidden');
        if (p1.value.length < 6) { err.textContent = 'Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες.'; err.classList.remove('hidden'); return; }
        if (p1.value !== p2.value) { err.textContent = 'Οι δύο κωδικοί δεν ταιριάζουν.'; err.classList.remove('hidden'); return; }
        try { await S.store.changeMyPassword(p1.value); p1.value = p2.value = ''; toast('Ο κωδικός άλλαξε'); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
      } }, 'Αλλαγή κωδικού')),
      S.store.demo ? h('div', { class: 'infobox' }, 'Δοκιμαστική λειτουργία — δες πώς φαίνεται η εφαρμογή για:',
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => { S.store.setDemoUser('u1'); location.reload(); } }, 'Διαχειριστή'),
          h('button', { class: 'btn small', onclick: () => { S.store.setDemoUser('u2'); location.reload(); } }, 'Προσωπικό'))) : null
    ], [
      h('button', { class: 'btn danger left', onclick: async () => {
        if (S.store.demo) { toast('Στη δοκιμαστική λειτουργία δεν υπάρχει αποσύνδεση'); return; }
        if (await confirmBox('Αποσύνδεση', 'Να γίνει αποσύνδεση από αυτή τη συσκευή;', 'Αποσύνδεση')) { await S.store.signOut(); location.reload(); }
      } }, svg(IC.out), 'Αποσύνδεση'),
      h('button', { class: 'btn', onclick: () => close() }, 'Κλείσιμο')
    ]);
  }

  boot();
})();
