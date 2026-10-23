/* Κάτοψη: ζωντανή προβολή διαθεσιμότητας + σχεδιαστής χώρων/τραπεζιών. */
(function () {
  'use strict';

  const SNAP = 10;
  const snap = v => Math.round(v / SNAP) * SNAP;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => 'd' + Math.random().toString(36).slice(2, 9);
  const clone = x => JSON.parse(JSON.stringify(x));
  const natural = (a, b) => String(a.name).localeCompare(String(b.name), 'el', { numeric: true });
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);

  const TABLE_PRESETS = [
    { key: 'sq2', label: 'Τραπέζι 2', shape: 'rect', seats: 2, w: 60, h: 60 },
    { key: 'sq4', label: 'Τραπέζι 4', shape: 'rect', seats: 4, w: 80, h: 80 },
    { key: 'rd4', label: 'Στρογγυλό 4', shape: 'round', seats: 4, w: 84, h: 84 },
    { key: 'rc6', label: 'Τραπέζι 6', shape: 'rect', seats: 6, w: 130, h: 80 },
    { key: 'rd6', label: 'Στρογγυλό 6', shape: 'round', seats: 6, w: 104, h: 104 },
    { key: 'rc8', label: 'Τραπέζι 8', shape: 'rect', seats: 8, w: 180, h: 80 },
    { key: 'rc12', label: 'Μεγάλο 12', shape: 'rect', seats: 12, w: 280, h: 90 }
  ];
  const DECOR = {
    wall:   { label: 'Τοίχος',        w: 300, h: 12 },
    window: { label: 'Παράθυρο',      w: 160, h: 10 },
    door:   { label: 'Πόρτα',         w: 80,  h: 80, square: true },
    bar:    { label: 'Μπαρ / Πάγκος', w: 240, h: 60, text: 'Μπαρ' },
    zone:   { label: 'Ζώνη / Χαλί',   w: 300, h: 200, text: 'Ζώνη', color: 'mint' },
    plant:  { label: 'Φυτό',          w: 44,  h: 44, square: true },
    label:  { label: 'Κείμενο',       w: 160, h: 30, text: 'Κείμενο' }
  };
  const ZONE_COLORS = { lav: 'Λιλά', peach: 'Ροδακινί', mint: 'Μέντα', sky: 'Γαλάζιο', rose: 'Ροζ', butter: 'Κίτρινο' };

  function defaultSize(seats) {
    if (seats <= 2) return { w: 60, h: 60 };
    if (seats <= 4) return { w: 80, h: 80 };
    if (seats <= 6) return { w: 130, h: 80 };
    if (seats <= 8) return { w: 180, h: 80 };
    return { w: 260, h: 90 };
  }

  /* ---------- Σχεδίαση (SVG ως κείμενο) ---------- */
  function chairsSvg(t) {
    const n = clamp(+t.seats || 0, 0, 20), w = +t.w || 80, h = +t.h || 80, out = [];
    if (!n) return '';
    if (t.shape === 'round') {
      const rx = w / 2 + 11, ry = h / 2 + 11;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        out.push(`<circle class="fp-chair" cx="${(Math.cos(a) * rx).toFixed(1)}" cy="${(Math.sin(a) * ry).toFixed(1)}" r="7"/>`);
      }
      return out.join('');
    }
    const horiz = w >= h, L = horiz ? w : h, T = horiz ? h : w;
    const ends = n >= 6 ? 2 : (n === 5 ? 1 : 0);
    const r = n - ends, a = Math.ceil(r / 2), b = Math.floor(r / 2);
    const place = (u, v) => out.push(horiz
      ? `<circle class="fp-chair" cx="${u.toFixed(1)}" cy="${v.toFixed(1)}" r="7"/>`
      : `<circle class="fp-chair" cx="${v.toFixed(1)}" cy="${u.toFixed(1)}" r="7"/>`);
    for (let i = 0; i < a; i++) place(-L / 2 + L * (i + 0.5) / a, -T / 2 - 11);
    for (let i = 0; i < b; i++) place(-L / 2 + L * (i + 0.5) / b, T / 2 + 11);
    if (ends >= 1) place(-L / 2 - 11, 0);
    if (ends >= 2) place(L / 2 + 11, 0);
    return out.join('');
  }

  function tableBody(t) {
    const w = +t.w || 80, h = +t.h || 80;
    return t.shape === 'round'
      ? `<ellipse class="fp-tbody" cx="0" cy="0" rx="${w / 2}" ry="${h / 2}"/>`
      : `<rect class="fp-tbody" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="12"/>`;
  }

  let TROT = 0;   // αντιστροφή περιστροφής για τα κείμενα όταν η κάτοψη είναι γυρισμένη (κινητό σε κάθετη θέση)
  const trot = (x, y) => TROT ? ` transform="rotate(${TROT}${x != null ? ' ' + x + ' ' + y : ''})"` : '';
  function tableSvg(t, cls, line2, key) {
    const w = +t.w || 80, h = +t.h || 80;
    const fs = clamp(Math.min(w, h) * 0.24, 12, 20);
    const maxChars = Math.max(4, Math.floor(w / 7.2));
    const l2 = line2 ? (line2.length > maxChars ? line2.slice(0, maxChars - 1) + '…' : line2) : '';
    return `<g class="fp-item fp-table ${cls || ''}" data-k="${key || 't:' + t.id}" transform="translate(${t.x} ${t.y})">` +
      `<g transform="rotate(${+t.rot || 0})">${chairsSvg(t)}${tableBody(t)}</g>` +
      `<g${trot()}><text class="l1" y="${l2 ? -fs * 0.38 : 0}" font-size="${fs}">${esc(t.name)}</text>` +
      (l2 ? `<text class="l2" y="${fs * 0.62}" font-size="${clamp(fs * 0.62, 10, 13)}">${esc(l2)}</text>` : '') +
      `</g></g>`;
  }

  function decorInner(d) {
    const w = +d.w, h = +d.h;
    switch (d.type) {
      case 'wall': return `<rect class="fp-wall" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3"/>`;
      case 'window': return `<rect class="fp-window" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3"/>`;
      case 'door': return `<path class="fp-door" d="M ${-w / 2} ${w / 2} L ${-w / 2} ${-w / 2} A ${w} ${w} 0 0 1 ${w / 2} ${w / 2} Z"/>` +
        `<line class="fp-door-leaf" x1="${-w / 2}" y1="${w / 2}" x2="${-w / 2}" y2="${-w / 2}"/>`;
      case 'plant': return `<circle class="fp-plant" r="${w / 2}"/>` +
        [0, 72, 144, 216, 288].map(a => `<ellipse class="fp-plant-in" cx="0" cy="${-w / 4}" rx="${w / 9}" ry="${w / 4.5}" transform="rotate(${a})"/>`).join('');
      case 'bar': return `<rect class="fp-bar" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="12"/>` +
        `<text class="fp-dtext"${(String(d.text || '').length * clamp(h * 0.32, 11, 20) * 0.62 < h - 8) ? trot() : ''} font-size="${clamp(h * 0.32, 11, 20)}">${esc(d.text)}</text>`;
      case 'zone': return `<rect class="fp-zone z-${esc(d.color || 'mint')}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="20"/>` +
        (TROT ? `<text class="fp-ztext" x="${-w / 2 + 24}" y="${h / 2 - 16}"${trot(-w / 2 + 24, h / 2 - 16)} font-size="15">${esc(d.text)}</text>`
              : `<text class="fp-ztext" x="${-w / 2 + 16}" y="${-h / 2 + 24}" font-size="15">${esc(d.text)}</text>`);
      case 'label': return `<rect class="fp-hit" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}"/>` +
        `<text class="fp-ltext"${trot()} font-size="${clamp(h * 0.7, 10, 60)}">${esc(d.text)}</text>`;
    }
    return '';
  }
  function decorSvg(d, editable) {
    return `<g class="fp-decor fp-d-${d.type}${editable ? ' fp-item' : ''}" ${editable ? `data-k="d:${d.id}"` : ''} transform="translate(${d.x} ${d.y}) rotate(${+d.rot || 0})">${decorInner(d)}</g>`;
  }

  function floorSvg(area, grid) {
    const W = area.width, H = area.height;
    return (grid ? `<defs><pattern id="fpgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" class="fp-gridline"/></pattern></defs>` : '') +
      `<rect class="fp-floor" x="0" y="0" width="${W}" height="${H}" rx="24"/>` +
      (grid ? `<rect x="0" y="0" width="${W}" height="${H}" rx="24" fill="url(#fpgrid)" pointer-events="none"/>` : '');
  }

  function decorLayers(area, editable) {
    const decor = area.decor || [];
    return decor.filter(d => d.type === 'zone').map(d => decorSvg(d, editable)).join('') +
      decor.filter(d => d.type !== 'zone').map(d => decorSvg(d, editable)).join('');
  }

  function iconSvg(inner, vb) {
    return `<svg class="fp-ico" viewBox="${vb || '-70 -70 140 140'}" width="38" height="38" aria-hidden="true">${inner}</svg>`;
  }

  /* Θέσεις για τραπέζια χωρίς συντεταγμένες */
  function overlaps(a, b, pad) {
    pad = pad || 0;
    return Math.abs(a.x - b.x) * 2 < (a.w + b.w) + pad * 2 && Math.abs(a.y - b.y) * 2 < (a.h + b.h) + pad * 2;
  }
  function freeSpot(area, others, w, h) {
    for (let y = 90; y <= area.height - h / 2; y += 20) {
      for (let x = 80; x <= area.width - w / 2; x += 20) {
        const c = { x, y, w: w + 24, h: h + 24 };
        if (!others.some(o => overlaps(c, { x: +o.x, y: +o.y, w: (+o.w || 80) + 24, h: (+o.h || 80) + 24 }))) return { x: snap(x), y: snap(y) };
      }
    }
    return { x: snap(area.width / 2), y: snap(area.height / 2) };
  }
  function ensureLayout(areas, tables) {
    for (const t of tables) {
      if (!t.shape) t.shape = 'rect';
      if (!(+t.w) || !(+t.h)) Object.assign(t, defaultSize(+t.seats || 4));
      t.rot = +t.rot || 0;
    }
    for (const a of areas) {
      a.width = +a.width || 1000; a.height = +a.height || 700;
      a.decor = Array.isArray(a.decor) ? a.decor : [];
      a.decor.forEach(d => { if (!d.id) d.id = uid(); });
      const mine = tables.filter(t => sameId(t.area_id, a.id));
      const placed = mine.filter(t => t.x != null && t.y != null);
      for (const t of mine.filter(t => t.x == null || t.y == null).sort(natural)) {
        const p = freeSpot(a, placed, +t.w, +t.h);
        t.x = p.x; t.y = p.y; placed.push(t);
        if (t.y + t.h / 2 + 40 > a.height) a.height = snap(t.y + t.h / 2 + 60);
      }
    }
  }

  /* ===================================================================== */
  window.FloorPlan = function (api) {
    const { S, L, h, svg, IC, toast, confirmBox } = api;

    /* ---------- Ζωντανή κάτοψη ---------- */
    function defaultTime(slots) {
      const step = S.settings.slot_minutes || 30;
      if (S.date === L.fmtDate(new Date())) {
        const n = new Date(); let m = n.getHours() * 60 + n.getMinutes(); if (m < 300) m += 1440;
        m = Math.floor(m / step) * step;
        if (slots.includes(m)) return m;
        const next = slots.find(s => s > m); if (next != null) return next;
      }
      return slots.find(s => s >= 20 * 60) ?? slots[0] ?? 20 * 60;
    }

    function tableState(t, T) {
      if (t.active === false) return { cls: 'inactive', line: 'ανενεργό' };
      const list = S.dayRes.filter(r => L.isActive(r) && (r.table_ids || []).map(Number).includes(Number(t.id)));
      const occ = list.find(r => { const s = L.svcMin(r.res_time); return T >= s && T < s + (r.duration_min || 120); });
      if (occ) return { cls: occ.status === 'seated' ? 'seated' : 'reserved', res: occ, line: occ.name.split(' ')[0] + ' · ' + occ.party_size };
      const soon = list.map(r => ({ r, s: L.svcMin(r.res_time) })).filter(x => x.s > T && x.s <= T + 90).sort((a, b) => a.s - b.s)[0];
      if (soon) return { cls: 'soon', soon: soon.r, line: 'από ' + L.fromMin(soon.s) };
      return { cls: 'free', line: t.seats + ' θέσεις' };
    }

    function renderLive(v) {
      if (!S.areas.length) {
        v.append(h('div', { class: 'empty' }, api.isAdmin() ? 'Δεν έχεις φτιάξει ακόμα κάτοψη.' : 'Ο διαχειριστής δεν έχει φτιάξει ακόμα κάτοψη.',
          api.isAdmin() ? h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => openEditor() }, 'Σχεδίασε τους χώρους σου')) : null));
        return;
      }
      const areas = clone(S.areas), tables = clone(S.tables);
      ensureLayout(areas, tables);
      if (!areas.some(a => sameId(a.id, S.floorArea))) S.floorArea = areas[0].id;
      const area = areas.find(a => sameId(a.id, S.floorArea));

      let slots = L.slotsFor(S.settings, S.date, S.closures);
      if (!slots.length) { slots = []; for (let m = 12 * 60; m <= 23 * 60 + 30; m += 30) slots.push(m); }
      if (S.floorTime == null || S.floorDate !== S.date) { S.floorDate = S.date; S.floorTime = defaultTime(slots); }
      const T = S.floorTime;
      const opts = slots.includes(T) ? slots : slots.concat([T]).sort((a, b) => a - b);

      const assignRes = S.assignId ? S.dayRes.find(r => r.id === S.assignId) : null;
      if (S.assignId && !assignRes) S.assignId = null;

      // εργαλειοθήκη
      const areaSeg = h('div', { class: 'seg' }, areas.map(a => h('button', { class: sameId(a.id, area.id) ? 'on' : '',
        onclick: () => { S.floorArea = a.id; api.renderView(); } }, a.name)));
      const timeSel = h('select', { class: 'input fp-time', 'aria-label': 'Ώρα', onchange: e => { S.floorTime = L.svcMin(e.target.value); api.renderView(); } },
        opts.map(m => h('option', { value: L.fromMin(m) }, L.fromMin(m))));
      timeSel.value = L.fromMin(T);
      const idx = opts.indexOf(T);
      v.append(h('div', { class: 'fp-toolbar' }, areaSeg,
        h('div', { class: 'fp-timebox' },
          h('button', { class: 'btn icon small', 'aria-label': 'Νωρίτερα', disabled: idx <= 0, onclick: () => { S.floorTime = opts[idx - 1]; api.renderView(); } }, svg(IC.left)),
          timeSel,
          h('button', { class: 'btn icon small', 'aria-label': 'Αργότερα', disabled: idx >= opts.length - 1, onclick: () => { S.floorTime = opts[idx + 1]; api.renderView(); } }, svg(IC.right)),
          S.date === L.fmtDate(new Date()) ? h('button', { class: 'btn small', onclick: () => { S.floorTime = defaultTime(slots); api.renderView(); } }, 'Τώρα') : null),
        h('button', { class: 'btn fp-join-btn' + (S.joinMode ? ' on' : ''), title: 'Ένωση τραπεζιών',
          onclick: () => { S.joinMode = !S.joinMode; S.joinSel = []; S.assignId = null; api.renderView(); } }, svg(IC.link), h('span', null, 'Ένωση')),
        h('div', { style: { flex: 1 } }),
        api.isAdmin() ? h('button', { class: 'btn fp-edit-btn', title: 'Επεξεργασία κάτοψης', onclick: () => openEditor(area.id) }, svg(IC.edit), h('span', null, 'Επεξεργασία κάτοψης')) : null));

      // κάτοψη
      const mine = tables.filter(t => sameId(t.area_id, area.id));
      const states = new Map(mine.map(t => [t.id, tableState(t, T)]));
      if (!Array.isArray(S.joinSel)) S.joinSel = [];
      S.joinSel = S.joinSel.filter(id => tables.some(t => Number(t.id) === id));
      if (S.joinMode) v.append(joinBar(tables, T));

      // ομάδες ενωμένων τραπεζιών: κρατήσεις με 2+ τραπέζια στον χώρο, την ώρα που βλέπουμε
      const groups = [];
      const seen = new Set();
      for (const t of mine) {
        const st = states.get(t.id), r = st.res || st.soon;
        if (!r || seen.has(r.id)) continue;
        const ids = (r.table_ids || []).map(Number);
        const members = mine.filter(x => ids.includes(Number(x.id)));
        if (members.length > 1) { seen.add(r.id); groups.push({ cls: st.cls, members }); }
      }
      if (S.joinMode && S.joinSel.length > 1) groups.push({ cls: 'picked', members: mine.filter(t => S.joinSel.includes(Number(t.id))) });
      const joinSvg = groups.map(g => mstEdges(g.members).map(([a, b]) =>
        `<line class="fp-join j-${g.cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`).join('')).join('');
      let canAssign = null;
      if (assignRes) {
        const s = L.svcMin(assignRes.res_time), d = assignRes.duration_min || 120;
        canAssign = new Set(mine.filter(t => t.active !== false && !L.tableConflict(S.dayRes, t.id, s, d, assignRes.id)).map(t => t.id));
      }
      const buildSvg = rot => {
        const W = area.width, H = area.height;
        TROT = rot ? -90 : 0;
        const inner = floorSvg(area, false) + decorLayers(area, false) + joinSvg +
          mine.map(t => {
            const st = states.get(t.id);
            let cls = st.cls;
            if (S.joinMode) cls += S.joinSel.includes(Number(t.id)) ? ' picked' : (st.cls === 'free' || st.cls === 'soon' ? ' can' : ' cannot');
            if (canAssign) cls += canAssign.has(t.id) ? ' can' : ' cannot';
            if (assignRes && (assignRes.table_ids || []).map(Number).includes(Number(t.id))) cls += ' picked';
            return tableSvg(t, cls, st.line);
          }).join('');
        TROT = 0;
        return rot
          ? `<svg class="fp-svg" viewBox="-20 -20 ${H + 40} ${W + 40}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${H} 0) rotate(90)">${inner}</g></svg>`
          : `<svg class="fp-svg" viewBox="-20 -20 ${W + 40} ${H + 40}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
      };
      const stage = h('div', { class: 'fp-stage' + (assignRes || S.joinMode ? ' assigning' : '') });
      stage.addEventListener('click', e => {
        const g = e.target.closest('[data-k]'); if (!g) return;
        const id = Number(g.dataset.k.slice(2));
        const t = tables.find(x => Number(x.id) === id); if (!t) return;
        onTableClick(t, states.get(t.id), T, assignRes);
      });

      // πλαϊνό
      const free = mine.filter(t => states.get(t.id).cls === 'free');
      const freeSeats = free.reduce((s, t) => s + (+t.seats || 0), 0);
      const busy = mine.filter(t => ['reserved', 'seated'].includes(states.get(t.id).cls));
      const pax = new Set(); busy.forEach(t => pax.add(states.get(t.id).res.id));
      const paxCount = [...pax].reduce((sum, id) => sum + ((S.dayRes.find(r => r.id === id) || {}).party_size || 0), 0);

      const unassigned = S.dayRes.filter(r => L.isActive(r) && (!(r.table_ids || []).length || r.id === S.assignId))
        .sort((a, b) => L.svcMin(a.res_time) - L.svcMin(b.res_time));

      const side = h('div', { class: 'fp-side' },
        h('div', { class: 'fp-card fp-sum' },
          h('div', { class: 'fp-sum-t' }, area.name + ' · ' + L.fromMin(T)),
          h('div', { class: 'fp-sum-row' },
            h('div', null, h('b', null, free.length), h('span', null, 'ελεύθερα')),
            h('div', null, h('b', null, freeSeats), h('span', null, 'ελεύθ. θέσεις')),
            h('div', null, h('b', null, paxCount), h('span', null, 'άτομα'))),
          h('div', { class: 'fp-legend' },
            ['free:Ελεύθερο', 'soon:Κρατημένο σε λίγο', 'reserved:Κρατημένο', 'seated:Κάθονται', 'inactive:Ανενεργό']
              .map(x => { const [c, l] = x.split(':'); return h('span', null, h('i', { class: 'lg-' + c }), l); }))),
        h('div', { class: 'fp-card' },
          h('div', { class: 'fp-sum-t' }, 'Χωρίς τραπέζι', h('span', { class: 'tag' }, ' (' + unassigned.filter(r => !(r.table_ids || []).length).length + ')')),
          assignRes
            ? h('div', { class: 'infobox', style: { margin: '6px 0 10px' } },
                h('b', null, assignRes.name + ' · ' + assignRes.party_size + ' άτ. · ' + L.fromMin(L.svcMin(assignRes.res_time))),
                h('div', null, 'Πάτα ένα ελεύθερο τραπέζι (με περίγραμμα). Για μεγάλη παρέα διάλεξε κι άλλα.'),
                h('div', { style: { marginTop: '8px', display: 'flex', gap: '6px' } },
                  h('button', { class: 'btn small', onclick: () => { S.assignId = null; api.renderView(); } }, 'Τέλος')))
            : h('p', { class: 'hint', style: { margin: '4px 0 8px' } }, unassigned.length ? 'Διάλεξε κράτηση και μετά πάτα τραπέζι για ανάθεση.' : 'Όλες οι κρατήσεις της ημέρας έχουν τραπέζι.'),
          h('div', { class: 'fp-unassigned' }, unassigned.map(r => h('button', {
            class: 'fp-res' + (r.id === S.assignId ? ' on' : ''),
            onclick: () => {
              S.assignId = r.id === S.assignId ? null : r.id;
              if (S.assignId) {
                S.floorTime = L.svcMin(r.res_time);
                if (r.area_pref && r.area_pref !== 'any' && areas.some(a => sameId(a.id, r.area_pref))) S.floorArea = Number(r.area_pref) || r.area_pref;
              }
              api.renderView();
            }
          }, h('b', null, L.fromMin(L.svcMin(r.res_time))), h('span', null, r.name), h('span', { class: 'pax' }, r.party_size + ' άτ.'))))));

      v.append(h('div', { class: 'fp-live' }, stage, side));
      fitStage(stage, area, buildSvg);
    }

    /* Ελάχιστο δέντρο σύνδεσης (κοντινότερα τραπέζια ενώνονται μεταξύ τους) */
    function mstEdges(list) {
      if (list.length < 2) return [];
      const inT = [list[0]], out = list.slice(1), edges = [];
      while (out.length) {
        let best = null;
        for (const a of inT) for (const b of out) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (!best || d < best.d) best = { a, b, d };
        }
        edges.push([best.a, best.b]); inT.push(best.b); out.splice(out.indexOf(best.b), 1);
      }
      return edges;
    }

    /* Μπάρα ένωσης: επιλεγμένα τραπέζια → νέα κράτηση ή ανάθεση σε υπάρχουσα */
    function joinBar(tables, T) {
      const sel = S.joinSel.map(id => tables.find(t => Number(t.id) === id)).filter(Boolean);
      const seats = sel.reduce((s, t) => s + (+t.seats || 0), 0);
      const opts = S.dayRes.filter(L.isActive).sort((a, b) => L.svcMin(a.res_time) - L.svcMin(b.res_time));
      const resSel = h('select', { class: 'input fp-join-res', disabled: sel.length < 1, onchange: async e => {
        const r = opts.find(x => String(x.id) === e.target.value); e.target.value = '';
        if (!r) return;
        const s0 = L.svcMin(r.res_time), d = r.duration_min || 120;
        const c = sel.map(t => ({ t, c: L.tableConflict(S.dayRes, t.id, s0, d, r.id) })).find(x => x.c);
        if (c) { toast('Το ' + c.t.name + ' είναι πιασμένο στις ' + L.fromMin(s0) + ' από ' + c.c.name, true); return; }
        if (!(await confirmBox('Ένωση τραπεζιών', 'Η κράτηση «' + r.name + '» (' + r.party_size + ' άτ., ' + L.fromMin(s0) + ') θα πάει στα τραπέζια ' + api.tableNames(S.joinSel) + ' (' + seats + ' θέσεις).', 'Ένωση'))) return;
        try {
          await S.store.patchReservation(r.id, { table_ids: S.joinSel.slice() });
          toast('Ενώθηκαν: ' + api.tableNames(S.joinSel) + ' → ' + r.name);
          S.joinMode = false; S.joinSel = []; await api.reload();
        } catch (err) { toast(err.message, true); }
      } }, h('option', { value: '' }, 'Σε υπάρχουσα κράτηση…'),
        opts.map(r => h('option', { value: r.id }, L.fromMin(L.svcMin(r.res_time)) + ' · ' + r.name + ' · ' + r.party_size + ' άτ.' + ((r.table_ids || []).length ? ' (' + api.tableNames(r.table_ids) + ')' : ''))));
      return h('div', { class: 'fp-joinbar' },
        h('div', { class: 'fp-join-info' },
          sel.length
            ? [h('b', null, sel.map(t => t.name).join(' + ')), h('span', null, seats + ' θέσεις')]
            : h('span', null, 'Πάτα τα τραπέζια που θέλεις να ενώσεις')),
        h('div', { class: 'fp-join-acts' },
          h('button', { class: 'btn small primary', disabled: sel.length < 1, onclick: () => {
            const ids = S.joinSel.slice();
            S.joinMode = false; S.joinSel = [];
            api.renderView();
            api.openResForm(null, { res_time: L.fromMin(T), table_ids: ids, party_size: Math.max(1, seats) });
          } }, svg(IC.plus), 'Νέα κράτηση'),
          resSel,
          h('button', { class: 'btn small', onclick: () => { S.joinMode = false; S.joinSel = []; api.renderView(); } }, 'Άκυρο')));
    }

    /* Η κάτοψη χωράει ολόκληρη στο διαθέσιμο πλάτος και ύψος· σε κάθετη οθόνη γυρίζει 90° αν έτσι βγαίνει μεγαλύτερη */
    function fitStage(stage, area, buildSvg) {
      const r = stage.getBoundingClientRect();
      const aw = Math.max(200, stage.clientWidth - 20);
      let ah = window.innerHeight - r.top + window.scrollY - 26;
      let scrollTo = null, topH = 0;
      if (ah < window.innerHeight * 0.5) {
        // χαμηλή οθόνη (π.χ. κινητό οριζόντια): η κάτοψη πιάνει όλο το ύψος και η σελίδα κυλάει μόνη της ώστε να φαίνεται ολόκληρη
        const tb = stage.parentElement.parentElement.querySelector('.fp-toolbar');
        const tbH = tb ? tb.getBoundingClientRect().height + 10 : 0;
        const top = document.querySelector('.topbar'); topH = top ? top.getBoundingClientRect().height : 0;
        ah = window.innerHeight - topH - tbH - 30;
        scrollTo = tb;
      }
      ah = Math.max(200, ah);
      const W = area.width + 40, H = area.height + 40;
      const s0 = Math.min(aw / W, ah / H), s1 = Math.min(aw / H, ah / W);
      const rot = s1 > s0 * 1.12;
      stage.innerHTML = buildSvg(rot);
      const svgEl = stage.querySelector('svg');
      const vw = rot ? H : W, vh = rot ? W : H, sc = Math.min(aw / vw, ah / vh);
      svgEl.style.width = Math.floor(vw * sc) + 'px';
      svgEl.style.height = Math.floor(vh * sc) + 'px';
      stage.classList.toggle('rotated', rot);
      if (scrollTo) requestAnimationFrame(() => window.scrollTo({ top: scrollTo.getBoundingClientRect().top + window.scrollY - topH - 6 }));
    }

    let rzT = null;
    window.addEventListener('resize', () => {
      clearTimeout(rzT);
      rzT = setTimeout(() => { if (S.view === 'floor' && !document.querySelector('.overlay, .fp-editor')) api.renderView(); }, 200);
    });

    async function onTableClick(t, st, T, assignRes) {
      if (S.joinMode) {
        const id = Number(t.id);
        if (S.joinSel.includes(id)) S.joinSel = S.joinSel.filter(x => x !== id);
        else if (t.active === false) { toast('Το τραπέζι είναι ανενεργό', true); return; }
        else if (st.res) { toast('Το ' + t.name + ' είναι πιασμένο από ' + st.res.name, true); return; }
        else S.joinSel = S.joinSel.concat([id]);
        api.renderView();
        return;
      }
      if (assignRes) {
        const s = L.svcMin(assignRes.res_time), d = assignRes.duration_min || 120;
        const ids = (assignRes.table_ids || []).map(Number);
        if (ids.includes(Number(t.id))) {
          try { await S.store.patchReservation(assignRes.id, { table_ids: ids.filter(x => x !== Number(t.id)) }); await api.reload(); } catch (e) { toast(e.message, true); }
          return;
        }
        if (t.active === false) { toast('Το τραπέζι είναι ανενεργό', true); return; }
        const c = L.tableConflict(S.dayRes, t.id, s, d, assignRes.id);
        if (c) { toast('Το ' + t.name + ' είναι πιασμένο από ' + c.name + ' (' + L.fromMin(L.svcMin(c.res_time)) + ')', true); return; }
        const next = ids.concat([Number(t.id)]);
        const seats = next.reduce((sum, id) => sum + ((S.tables.find(x => Number(x.id) === id) || {}).seats || 0), 0);
        try {
          await S.store.patchReservation(assignRes.id, { table_ids: next });
          if (seats >= assignRes.party_size) { S.assignId = null; toast('Ανατέθηκε: ' + api.tableNames(next)); }
          else toast('Θέσεις ' + seats + ' / ' + assignRes.party_size + ' — διάλεξε κι άλλο τραπέζι');
          await api.reload();
        } catch (e) { toast(e.message, true); }
        return;
      }
      if (st.res) return api.openResForm(st.res);
      if (t.active === false) { toast('Το τραπέζι είναι ανενεργό'); return; }
      api.openResForm(null, { res_time: L.fromMin(T), table_ids: [t.id], party_size: Math.min(+t.seats || 2, 2) });
    }

    /* ---------- Σχεδιαστής ---------- */
    function openEditor(startArea) {
      const E = {
        areas: clone(S.areas), tables: clone(S.tables), cur: null, sel: null, zoom: 1,
        hist: [], future: [], dirty: false, tmp: -1, pending: null
      };
      if (!E.areas.length) { E.areas.push({ id: E.tmp--, name: 'Σάλα', sort: 0, width: 1000, height: 700, decor: [] }); E.dirty = true; }
      E.tables.forEach(t => { if (!E.areas.some(a => sameId(a.id, t.area_id))) t.area_id = E.areas[0].id; });
      ensureLayout(E.areas, E.tables);
      E.cur = (E.areas.find(a => sameId(a.id, startArea || S.floorArea)) || E.areas[0]).id;

      const area = () => E.areas.find(a => a.id === E.cur);
      const areaTables = () => E.tables.filter(t => sameId(t.area_id, E.cur));
      const snapshot = () => JSON.stringify({ areas: E.areas, tables: E.tables, cur: E.cur });
      const checkpoint = () => { E.hist.push(snapshot()); if (E.hist.length > 80) E.hist.shift(); E.future = []; E.dirty = true; };
      const restore = str => { const o = JSON.parse(str); E.areas = o.areas; E.tables = o.tables; E.cur = E.areas.some(a => a.id === o.cur) ? o.cur : E.areas[0].id; E.sel = null; E.dirty = true; drawAll(); };
      const undo = () => { if (!E.hist.length) return; E.future.push(snapshot()); restore(E.hist.pop()); };
      const redo = () => { if (!E.future.length) return; E.hist.push(snapshot()); restore(E.future.pop()); };

      function getSel() {
        if (!E.sel) return null;
        const [k, id] = [E.sel.slice(0, 1), E.sel.slice(2)];
        if (k === 't') { const t = E.tables.find(x => String(x.id) === id); return t ? { kind: 'table', o: t } : null; }
        const d = (area().decor || []).find(x => x.id === id); return d ? { kind: 'decor', o: d } : null;
      }

      function nextName(areaId) {
        const a = E.areas.find(x => x.id === areaId) || {};
        const counts = {};
        E.tables.filter(t => sameId(t.area_id, areaId)).forEach(t => { const m = /^(\D*)\d+$/.exec(t.name || ''); if (m) counts[m[1]] = (counts[m[1]] || 0) + 1; });
        let prefix = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
        if (prefix == null) prefix = (a.name || 'Τ').trim().charAt(0).toUpperCase();
        let max = 0;
        E.tables.forEach(t => { const m = /^(\D*)(\d+)$/.exec(t.name || ''); if (m && m[1] === prefix) max = Math.max(max, +m[2]); });
        return prefix + (max + 1);
      }

      function addTable(p, at) {
        checkpoint();
        const a = area();
        const pos = at || freeSpot(a, areaTables(), p.w, p.h);
        const t = { id: E.tmp--, name: nextName(a.id), area_id: a.id, seats: p.seats, active: true, sort: 0, x: pos.x, y: pos.y, w: p.w, h: p.h, shape: p.shape, rot: 0 };
        E.tables.push(t); E.sel = 't:' + t.id; drawAll();
        return t;
      }
      function addDecor(type) {
        checkpoint();
        const a = area(), def = DECOR[type];
        const d = { id: uid(), type, x: snap(a.width / 2), y: snap(a.height / 2), w: def.w, h: def.h, rot: 0 };
        if (def.text) d.text = def.text;
        if (def.color) d.color = def.color;
        a.decor.push(d); E.sel = 'd:' + d.id; drawAll();
      }
      function deleteSel() {
        const s = getSel(); if (!s) return;
        checkpoint();
        if (s.kind === 'table') E.tables = E.tables.filter(t => t !== s.o);
        else area().decor = area().decor.filter(d => d !== s.o);
        E.sel = null; drawAll();
      }
      function duplicateSel() {
        const s = getSel(); if (!s) return;
        checkpoint();
        const c = clone(s.o); c.x = clamp(c.x + 30, 0, area().width); c.y = clamp(c.y + 30, 0, area().height);
        if (s.kind === 'table') { c.id = E.tmp--; c.name = nextName(E.cur); E.tables.push(c); E.sel = 't:' + c.id; }
        else { c.id = uid(); area().decor.push(c); E.sel = 'd:' + c.id; }
        drawAll();
      }

      /* --- DOM --- */
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.setAttribute('class', 'fp-svg fp-edit');
      const canvas = h('div', { class: 'fp-ecanvas' }, svgEl);
      const props = h('div', { class: 'fp-props' });
      const areaTabs = h('div', { class: 'seg fp-areatabs' });
      const saveBtn = h('button', { class: 'btn primary', onclick: save }, 'Αποθήκευση');
      const undoBtn = h('button', { class: 'btn icon', title: 'Αναίρεση (Ctrl+Z)', 'aria-label': 'Αναίρεση', onclick: undo }, svg(IC.undo));
      const redoBtn = h('button', { class: 'btn icon', title: 'Επανάληψη', 'aria-label': 'Επανάληψη', onclick: redo }, svg(IC.redo));

      const palette = h('div', { class: 'fp-palette' },
        h('div', { class: 'fp-pal-title' }, 'Τραπέζια'),
        TABLE_PRESETS.map(p => h('button', { class: 'fp-pal-btn', html: iconSvg(chairsSvg(p) + tableBody(p), p.w > 150 ? '-160 -80 320 160' : '-75 -75 150 150') + `<span>${esc(p.label)}</span>`, onclick: () => addTable(p) })),
        h('div', { class: 'fp-pal-title' }, 'Χώρος'),
        Object.keys(DECOR).map(k => {
          const d = Object.assign({ type: k, x: 0, y: 0 }, DECOR[k]);
          const sc = Math.max(d.w, d.h) * 0.62;
          if (d.type === 'label') d.text = 'Αα';
          if (d.type === 'bar') d.text = '';
          if (d.type === 'zone') d.text = '';
          return h('button', { class: 'fp-pal-btn', html: iconSvg(decorInner(d), `${-sc} ${-sc} ${sc * 2} ${sc * 2}`) + `<span>${esc(DECOR[k].label)}</span>`, onclick: () => addDecor(k) });
        }));

      const zoomLbl = h('span', { class: 'fp-zoomlbl' });
      const root = h('div', { class: 'fp-editor', role: 'dialog', 'aria-label': 'Σχεδιασμός κάτοψης' },
        h('div', { class: 'fp-ehead' },
          h('h2', null, 'Κάτοψη'),
          areaTabs,
          h('button', { class: 'btn small', onclick: addArea }, svg(IC.plus), 'Χώρος'),
          h('div', { style: { flex: 1 } }),
          h('div', { class: 'fp-zoom' },
            h('button', { class: 'btn icon small', 'aria-label': 'Σμίκρυνση', onclick: () => { E.zoom = clamp(E.zoom - 0.25, 0.5, 3); drawCanvas(); } }, '−'),
            zoomLbl,
            h('button', { class: 'btn icon small', 'aria-label': 'Μεγέθυνση', onclick: () => { E.zoom = clamp(E.zoom + 0.25, 0.5, 3); drawCanvas(); } }, '+')),
          undoBtn, redoBtn,
          h('button', { class: 'btn', onclick: tryClose }, 'Κλείσιμο'),
          saveBtn),
        h('div', { class: 'fp-ebody' }, palette, canvas, props));
      document.body.appendChild(root);
      document.body.style.overflow = 'hidden';

      function addArea() {
        checkpoint();
        const a = { id: E.tmp--, name: 'Νέος χώρος ' + (E.areas.length + 1), sort: E.areas.length, width: 1000, height: 700, decor: [] };
        E.areas.push(a); E.cur = a.id; E.sel = null; drawAll();
        setTimeout(() => { const i = props.querySelector('input'); if (i) { i.focus(); i.select(); } }, 30);
      }

      function drawTabs() {
        areaTabs.innerHTML = '';
        E.areas.forEach(a => areaTabs.append(h('button', { class: a.id === E.cur ? 'on' : '', onclick: () => { E.cur = a.id; E.sel = null; drawAll(); } }, a.name || '—')));
        undoBtn.disabled = !E.hist.length; redoBtn.disabled = !E.future.length;
      }

      function drawCanvas() {
        const a = area();
        svgEl.setAttribute('viewBox', `-20 -20 ${a.width + 40} ${a.height + 40}`);
        const mobile = window.innerWidth <= 900;
        const availW = Math.max(240, canvas.clientWidth - (mobile ? 20 : 32)), availH = Math.max(240, (mobile ? window.innerHeight * 0.62 : canvas.clientHeight) - 32);
        const fit = Math.min(availW / (a.width + 40), availH / (a.height + 40));
        svgEl.style.width = Math.round((a.width + 40) * fit * E.zoom) + 'px';
        zoomLbl.textContent = Math.round(E.zoom * 100) + '%';
        let s = floorSvg(a, true) + decorLayers(a, true) + areaTables().map(t => tableSvg(t, t.active === false ? 'inactive' : 'free', t.seats + ' θ.')).join('');
        const sel = getSel();
        if (sel) {
          const o = sel.o, w = +o.w, hh = DECOR[o.type] && DECOR[o.type].square ? +o.w : +o.h;
          const pad = sel.kind === 'table' ? 20 : 6;
          s += `<g transform="translate(${o.x} ${o.y}) rotate(${+o.rot || 0})">` +
            `<rect class="fp-sel" x="${-w / 2 - pad}" y="${-hh / 2 - pad}" width="${w + pad * 2}" height="${hh + pad * 2}" rx="10"/>` +
            `<circle class="fp-handle" data-k="h" cx="${w / 2 + pad}" cy="${hh / 2 + pad}" r="11"/>` +
            `</g>`;
        }
        svgEl.innerHTML = s;
      }

      function field(label, input, hint) { return h('label', { class: 'field' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null); }
      function numIn(val, min, max, on) {
        return h('input', { class: 'input', type: 'number', min, max, value: Math.round(val), oninput: e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) { on(clamp(v, min, max)); E.dirty = true; drawCanvas(); } } });
      }

      function drawProps() {
        props.innerHTML = '';
        const sel = getSel();
        const a = area();
        if (!sel) {
          const ts = areaTables();
          props.append(
            h('div', { class: 'fp-props-title' }, 'Χώρος'),
            field('Όνομα χώρου', h('input', { class: 'input', value: a.name, oninput: e => { a.name = e.target.value; E.dirty = true; drawTabs(); } })),
            h('div', { class: 'grid2' },
              field('Πλάτος', numIn(a.width, 300, 4000, v => { a.width = v; })),
              field('Μήκος', numIn(a.height, 200, 4000, v => { a.height = v; }))),
            h('p', { class: 'hint', style: { margin: 0 } }, 'Μονάδες ≈ εκατοστά (ένα 4άρι τραπέζι είναι 80×80).'),
            h('div', { class: 'fp-stats' }, h('div', null, h('b', null, ts.length), h('span', null, 'τραπέζια')), h('div', null, h('b', null, ts.reduce((s, t) => s + (+t.seats || 0), 0)), h('span', null, 'θέσεις'))));
          const cnt = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: 6 });
          const pre = h('select', { class: 'input' }, TABLE_PRESETS.map(p => h('option', { value: p.key }, p.label)));
          pre.value = 'sq4';
          props.append(h('div', { class: 'fp-props-title' }, 'Πολλά τραπέζια μαζί'),
            h('div', { class: 'grid2' }, field('Πόσα', cnt), field('Τύπος', pre)),
            h('button', { class: 'btn', onclick: () => {
              const p = TABLE_PRESETS.find(x => x.key === pre.value); const n = clamp(parseInt(cnt.value, 10) || 1, 1, 60);
              checkpoint();
              for (let i = 0; i < n; i++) {
                const pos = freeSpot(a, areaTables(), p.w, p.h);
                E.tables.push({ id: E.tmp--, name: nextName(a.id), area_id: a.id, seats: p.seats, active: true, sort: 0, x: pos.x, y: pos.y, w: p.w, h: p.h, shape: p.shape, rot: 0 });
              }
              drawAll(); toast('Προστέθηκαν ' + n + ' τραπέζια');
            } }, svg(IC.plus), 'Προσθήκη'),
            h('div', { class: 'fp-props-title' }, 'Οδηγίες'),
            h('ul', { class: 'fp-help' },
              h('li', null, 'Πάτα ένα στοιχείο από αριστερά για να μπει στην κάτοψη.'),
              h('li', null, 'Σύρε για μετακίνηση, τράβα τη στρογγυλή λαβή για μέγεθος.'),
              h('li', null, 'Delete: διαγραφή · Ctrl+D: αντίγραφο · Ctrl+Z: αναίρεση · βελάκια: μικρή μετακίνηση.')),
            h('button', { class: 'btn danger', style: { marginTop: '8px' }, onclick: async () => {
              const n = areaTables().length;
              if (!(await confirmBox('Διαγραφή χώρου', 'Διαγραφή του χώρου «' + a.name + '»' + (n ? ' και των ' + n + ' τραπεζιών του' : '') + ';', 'Διαγραφή', true))) return;
              checkpoint();
              E.tables = E.tables.filter(t => !sameId(t.area_id, a.id));
              E.areas = E.areas.filter(x => x !== a);
              if (!E.areas.length) E.areas.push({ id: E.tmp--, name: 'Σάλα', sort: 0, width: 1000, height: 700, decor: [] });
              E.cur = E.areas[0].id; E.sel = null; drawAll();
            } }, 'Διαγραφή χώρου'));
          return;
        }
        const o = sel.o;
        const rotRow = h('div', { class: 'fp-rot' },
          h('button', { class: 'btn small', onclick: () => { checkpoint(); o.rot = ((+o.rot || 0) - 45 + 360) % 360; drawAll(); } }, '↺ 45°'),
          h('button', { class: 'btn small', onclick: () => { checkpoint(); o.rot = ((+o.rot || 0) + 90) % 360; drawAll(); } }, '↻ 90°'),
          h('button', { class: 'btn small', onclick: () => { checkpoint(); o.rot = 0; drawAll(); } }, '0°'),
          h('span', { class: 'hint' }, (+o.rot || 0) + '°'));
        const actions = h('div', { class: 'row', style: { marginTop: '6px' } },
          h('button', { class: 'btn', onclick: duplicateSel }, 'Αντίγραφο'),
          h('button', { class: 'btn danger', onclick: deleteSel }, 'Διαγραφή'));

        if (sel.kind === 'table') {
          const shapeSeg = h('div', { class: 'seg' },
            [['rect', 'Τετράγωνο'], ['round', 'Στρογγυλό']].map(([k, l]) => h('button', { class: o.shape === k ? 'on' : '', onclick: () => { checkpoint(); o.shape = k; drawAll(); } }, l)));
          const areaSel = h('select', { class: 'input', onchange: e => {
            checkpoint();
            const target = E.areas.find(x => String(x.id) === e.target.value);
            const others = E.tables.filter(t => sameId(t.area_id, target.id));
            const p = freeSpot(target, others, +o.w, +o.h);
            o.area_id = target.id; o.x = p.x; o.y = p.y; E.cur = target.id; drawAll();
          } }, E.areas.map(x => h('option', { value: x.id }, x.name)));
          areaSel.value = String(o.area_id);
          props.append(
            h('div', { class: 'fp-props-title' }, 'Τραπέζι ' + o.name),
            h('div', { class: 'grid2' },
              field('Όνομα', h('input', { class: 'input', value: o.name, oninput: e => { o.name = e.target.value; E.dirty = true; drawCanvas(); } })),
              field('Θέσεις', numIn(o.seats, 1, 30, v => { o.seats = v; }))),
            field('Σχήμα', shapeSeg),
            h('div', { class: 'grid2' },
              field('Πλάτος', numIn(o.w, 30, 600, v => { o.w = v; })),
              field('Μήκος', numIn(o.h, 30, 600, v => { o.h = v; }))),
            field('Περιστροφή', rotRow),
            field('Χώρος', areaSel),
            h('label', { class: 'fp-check' }, h('input', { type: 'checkbox', checked: o.active !== false, onchange: e => { checkpoint(); o.active = e.target.checked; drawCanvas(); } }),
              h('span', null, 'Ενεργό ', h('span', { class: 'hint' }, '(αν το βγάλεις, δεν μπαίνουν κρατήσεις)'))),
            actions);
        } else {
          const def = DECOR[o.type];
          props.append(h('div', { class: 'fp-props-title' }, def.label));
          if ('text' in def) props.append(field('Κείμενο', h('input', { class: 'input', value: o.text || '', oninput: e => { o.text = e.target.value; E.dirty = true; drawCanvas(); } })));
          if (o.type === 'zone') props.append(field('Χρώμα', h('div', { class: 'fp-swatches' },
            Object.keys(ZONE_COLORS).map(c => h('button', { class: 'fp-sw z-' + c + (o.color === c ? ' on' : ''), title: ZONE_COLORS[c], 'aria-label': ZONE_COLORS[c], onclick: () => { checkpoint(); o.color = c; drawAll(); } })))));
          if (def.square) props.append(field('Μέγεθος', numIn(o.w, 20, 400, v => { o.w = v; o.h = v; })));
          else props.append(h('div', { class: 'grid2' },
            field('Πλάτος', numIn(o.w, 6, 4000, v => { o.w = v; })),
            field(o.type === 'label' ? 'Μέγεθος γραμμάτων' : 'Πάχος / Μήκος', numIn(o.h, 6, 4000, v => { o.h = v; }))));
          props.append(field('Περιστροφή', rotRow), actions);
        }
      }

      function drawAll() { drawTabs(); drawCanvas(); drawProps(); }

      // ιστορικό για αλλαγές από το πλαϊνό
      props.addEventListener('focusin', e => { if (e.target.matches('input,select')) E.pending = snapshot(); });
      props.addEventListener('change', e => {
        if (E.pending && e.target.matches('input[type=number],input:not([type]),input[type=text]')) {
          E.hist.push(E.pending); E.future = []; E.pending = snapshot(); drawTabs();
        }
      });

      /* --- Σύρσιμο --- */
      const toSvg = e => { const pt = svgEl.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svgEl.getScreenCTM().inverse()); };
      let drag = null;
      svgEl.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const g = e.target.closest('[data-k]');
        const p = toSvg(e);
        if (!g) { if (E.sel) { E.sel = null; drawCanvas(); drawProps(); } return; }
        const key = g.dataset.k;
        if (key === 'h') {
          const s = getSel(); if (!s) return;
          drag = { mode: 'resize', o: s.o, kind: s.kind, before: snapshot(), moved: false };
        } else {
          if (E.sel !== key) { E.sel = key; drawProps(); }
          const s = getSel(); if (!s) return;
          drag = { mode: 'move', o: s.o, off: { x: p.x - s.o.x, y: p.y - s.o.y }, before: snapshot(), moved: false };
          drawCanvas();
        }
        e.preventDefault();
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
        window.addEventListener('pointercancel', onUp, { once: true });
      });
      function onMove(e) {
        if (!drag) return;
        const p = toSvg(e), a = area(), o = drag.o;
        if (drag.mode === 'move') {
          const nx = clamp(snap(p.x - drag.off.x), 0, a.width), ny = clamp(snap(p.y - drag.off.y), 0, a.height);
          if (nx === o.x && ny === o.y) return;
          o.x = nx; o.y = ny;
        } else {
          const r = -(+o.rot || 0) * Math.PI / 180, dx = p.x - o.x, dy = p.y - o.y;
          const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
          const pad = drag.kind === 'table' ? 20 : 6;
          const min = drag.kind === 'table' ? 30 : 6;
          let w = Math.max(min, snap(Math.abs(lx) * 2 - pad * 2)), hh = Math.max(min, snap(Math.abs(ly) * 2 - pad * 2));
          if (DECOR[o.type] && DECOR[o.type].square) { w = hh = Math.max(20, Math.max(w, hh)); }
          if (w === +o.w && hh === +o.h) return;
          o.w = w; o.h = hh;
        }
        drag.moved = true; E.dirty = true; drawCanvas();
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        if (drag && drag.moved) { E.hist.push(drag.before); E.future = []; drawTabs(); drawProps(); }
        drag = null;
      }

      /* --- Πληκτρολόγιο --- */
      function onKey(e) {
        if (!document.body.contains(root)) return;
        if (document.querySelector('#modal-root .overlay')) return;
        const typing = e.target.matches && e.target.matches('input,textarea,select');
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
        if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
        if (typing) return;
        if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { if (E.sel) { e.preventDefault(); deleteSel(); } return; }
        if (e.key === 'Escape') { if (E.sel) { E.sel = null; drawCanvas(); drawProps(); } else tryClose(); return; }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[e.key] && E.sel) {
          e.preventDefault();
          const s = getSel(); if (!s) return;
          checkpoint();
          const step = e.shiftKey ? 1 : SNAP, a = area();
          s.o.x = clamp(s.o.x + arrows[e.key][0] * step, 0, a.width); s.o.y = clamp(s.o.y + arrows[e.key][1] * step, 0, a.height);
          drawCanvas(); drawTabs();
        }
      }
      document.addEventListener('keydown', onKey);
      const onResize = () => drawCanvas();
      window.addEventListener('resize', onResize);

      function close() {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        document.body.style.overflow = '';
        root.remove();
      }
      async function tryClose() {
        if (E.dirty && !(await confirmBox('Κλείσιμο', 'Υπάρχουν αλλαγές που δεν αποθηκεύτηκαν. Κλείσιμο χωρίς αποθήκευση;', 'Κλείσιμο χωρίς αποθήκευση', true))) return;
        close();
      }

      async function save() {
        const names = {};
        for (const t of E.tables) {
          const n = (t.name || '').trim();
          if (!n) { E.cur = t.area_id; E.sel = 't:' + t.id; drawAll(); toast('Υπάρχει τραπέζι χωρίς όνομα', true); return; }
          if (names[n]) { E.cur = t.area_id; E.sel = 't:' + t.id; drawAll(); toast('Το όνομα «' + n + '» υπάρχει δύο φορές', true); return; }
          names[n] = 1;
        }
        saveBtn.disabled = true; saveBtn.textContent = 'Αποθήκευση…';
        try {
          const st = S.store;
          for (const t of S.tables) if (!E.tables.some(x => x.id === t.id)) await st.deleteTable(t.id);
          const idMap = {};
          for (let i = 0; i < E.areas.length; i++) {
            const a = E.areas[i];
            const saved = await st.saveArea({ id: a.id > 0 ? a.id : null, name: (a.name || '').trim() || 'Χώρος', sort: i + 1, width: a.width, height: a.height, decor: a.decor });
            idMap[a.id] = saved.id;
          }
          const aIdx = id => E.areas.findIndex(a => a.id === id);
          const ordered = E.tables.slice().sort((x, y) => (aIdx(x.area_id) - aIdx(y.area_id)) || natural(x, y));
          const orig = new Map(S.tables.map(t => [t.id, t]));
          const KEYS = ['name', 'area_id', 'seats', 'active', 'sort', 'x', 'y', 'w', 'h', 'shape', 'rot'];
          for (let i = 0; i < ordered.length; i++) {
            const t = ordered[i];
            const row = { id: t.id > 0 ? t.id : null, name: t.name.trim(), area_id: idMap[t.area_id] != null ? idMap[t.area_id] : t.area_id,
              seats: +t.seats || 1, active: t.active !== false, sort: i + 1, x: Math.round(t.x), y: Math.round(t.y),
              w: Math.round(t.w), h: Math.round(t.h), shape: t.shape || 'rect', rot: +t.rot || 0 };
            const o = orig.get(t.id);
            if (!o || KEYS.some(k => String(o[k]) !== String(row[k]))) await st.saveTable(row);
          }
          for (const a of S.areas) if (!E.areas.some(x => x.id === a.id)) await st.deleteArea(a.id);
          E.dirty = false;
          S.floorArea = idMap[E.cur] || S.floorArea;
          await api.onSaved();
          toast('Η κάτοψη αποθηκεύτηκε');
          close();
        } catch (e) {
          toast('Σφάλμα αποθήκευσης: ' + e.message, true);
          saveBtn.disabled = false; saveBtn.textContent = 'Αποθήκευση';
        }
      }

      requestAnimationFrame(drawAll);
    }

    return { renderLive, openEditor };
  };
  window.FloorPlan.ensureLayout = ensureLayout;
})();
