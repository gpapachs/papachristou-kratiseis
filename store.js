/* Πρόσβαση στα δεδομένα: Supabase (κανονική λειτουργία) ή τοπική δοκιμαστική λειτουργία. */
(function () {
  'use strict';
  const STAFF_DOMAIN = 'staff.kratiseis.app';

  function supabaseStore(url, key) {
    const sb = window.supabase.createClient(url, key, { auth: { persistSession: true } });
    const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    return {
      demo: false,
      async getUser() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
      async signIn(username, password) {
        const u = String(username || '').trim();
        const email = u.includes('@') ? u : u.toLowerCase() + '@' + STAFF_DOMAIN;
        chk(await sb.auth.signInWithPassword({ email, password }));
      },
      async getMe() {
        const { data } = await sb.auth.getSession(); if (!data.session) return null;
        return chk(await sb.from('staff').select('*').eq('user_id', data.session.user.id).maybeSingle());
      },
      async changeMyPassword(password) { chk(await sb.auth.updateUser({ password })); },
      async listStaff() { return chk(await sb.from('staff').select('*').order('display_name')); },
      async createStaff(u) { return chk(await sb.rpc('admin_create_user', { p_username: u.username, p_password: u.password, p_display: u.display_name, p_role: u.role })); },
      async updateStaff(u) { chk(await sb.rpc('admin_update_user', { p_user: u.user_id, p_username: u.username, p_display: u.display_name, p_role: u.role, p_active: u.active })); },
      async setStaffPassword(id, password) { chk(await sb.rpc('admin_set_password', { p_user: id, p_password: password })); },
      async deleteStaff(id) { chk(await sb.rpc('admin_delete_user', { p_user: id })); },
      async signOut() { await sb.auth.signOut(); },

      async loadSettings() { const d = chk(await sb.from('res_settings').select('data').eq('id', 1).maybeSingle()); return d ? d.data : {}; },
      async saveSettings(data) { chk(await sb.from('res_settings').upsert({ id: 1, data })); },

      async listAreas() { return chk(await sb.from('res_areas').select('*').order('sort').order('id')); },
      async saveArea(a) {
        const row = { name: a.name, sort: a.sort, width: a.width, height: a.height, decor: a.decor || [] };
        if (a.id > 0) return chk(await sb.from('res_areas').update(row).eq('id', a.id).select().single());
        return chk(await sb.from('res_areas').insert(row).select().single());
      },
      async deleteArea(id) { chk(await sb.from('res_areas').delete().eq('id', id)); },

      async listTables() { return chk(await sb.from('res_tables').select('*').order('sort').order('id')); },
      async saveTable(t) {
        const row = { name: t.name, area_id: t.area_id, seats: t.seats, active: t.active, sort: t.sort,
          x: t.x, y: t.y, w: t.w, h: t.h, shape: t.shape, rot: t.rot };
        if (t.id > 0) return chk(await sb.from('res_tables').update(row).eq('id', t.id).select().single());
        return chk(await sb.from('res_tables').insert(row).select().single());
      },
      async deleteTable(id) { chk(await sb.from('res_tables').delete().eq('id', id)); },

      async listClosures() { return chk(await sb.from('res_closures').select('*').order('day')); },
      async addClosure(day, note) { chk(await sb.from('res_closures').upsert({ day, note })); },
      async deleteClosure(day) { chk(await sb.from('res_closures').delete().eq('day', day)); },

      async listReservations(from, to) {
        return chk(await sb.from('reservations').select('*').gte('res_date', from).lte('res_date', to)
          .order('res_date').order('res_time'));
      },
      async findByPhone(phone) {
        const digits = String(phone).replace(/\D/g, '').slice(-10);
        if (digits.length < 6) return [];
        return chk(await sb.from('reservations').select('*').ilike('phone', '%' + digits + '%')
          .order('res_date', { ascending: false }).limit(20));
      },
      async saveReservation(r) {
        const row = Object.assign({}, r); delete row.id; delete row.created_at; delete row.updated_at;
        if (r.id) return chk(await sb.from('reservations').update(row).eq('id', r.id).select().single());
        return chk(await sb.from('reservations').insert(row).select().single());
      },
      async patchReservation(id, fields) { return chk(await sb.from('reservations').update(fields).eq('id', id).select().single()); },
      async deleteReservation(id) { chk(await sb.from('reservations').delete().eq('id', id)); },

      /* SMS μέσω Apifon (edge function «sms») */
      async sms(action, payload) {
        const { data, error } = await sb.functions.invoke('sms', { body: Object.assign({ action }, payload || {}) });
        if (error) {
          let msg = error.message;
          try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
          throw new Error(msg);
        }
        if (data && data.error) throw new Error(data.error);
        return data;
      },
      async listSmsLog(limit) { return chk(await sb.from('sms_log').select('*').order('created_at', { ascending: false }).limit(limit || 50)); },

      /* εσωτερική συνομιλία προσωπικού */
      async chatList(room, limit) {
        const d = chk(await sb.from('chat_messages').select('*').eq('room', room).order('created_at', { ascending: false }).limit(limit || 150));
        return d.reverse();
      },
      async chatSend(room, body, resId) { return chk(await sb.from('chat_messages').insert({ room, body, res_id: resId || null }).select().single()); },
      async chatDelete(id) { chk(await sb.from('chat_messages').delete().eq('id', id)); },
      async chatUnread() { return chk(await sb.rpc('chat_unread')) || []; },
      async chatReads(room) { return chk(await sb.from('chat_reads').select('user_id,last_read_at').eq('room', room)); },
      async chatMarkRead(room) {
        const { data } = await sb.auth.getSession(); if (!data.session) return;
        chk(await sb.from('chat_reads').upsert({ user_id: data.session.user.id, room, last_read_at: new Date().toISOString() }));
      },

      /* ειδοποιήσεις push σε αυτή τη συσκευή */
      async pushSubscribe(sub, kinds, device) {
        const j = sub.toJSON();
        chk(await sb.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_kinds: kinds, p_device: device || null }));
      },
      async pushUnsubscribe(endpoint) { chk(await sb.rpc('push_unsubscribe', { p_endpoint: endpoint })); },
      async pushMine(endpoint) { return chk(await sb.from('push_subs').select('endpoint,kinds').eq('endpoint', endpoint).maybeSingle()); },

      subscribe(cb) {
        const ch = sb.channel('kratiseis');
        ['reservations', 'res_areas', 'res_tables', 'res_settings', 'res_closures', 'chat_messages', 'chat_reads'].forEach(table =>
          ch.on('postgres_changes', { event: '*', schema: 'public', table }, payload => cb(table, payload)));
        ch.subscribe();
        return () => sb.removeChannel(ch);
      }
    };
  }

  /* Δοκιμαστική λειτουργία: όλα αποθηκεύονται μόνο σε αυτόν τον browser. */
  function demoStore(defaults) {
    const KEY = 'kratiseis-demo-v2';
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) {
      const areas = [
        { id: 1, name: 'Σάλα', sort: 1, width: 1000, height: 660, decor: [
          { id: 'd1', type: 'zone', x: 190, y: 75, w: 320, h: 90, rot: 0, text: 'Ψησταριά', color: 'peach' },
          { id: 'd2', type: 'bar', x: 760, y: 75, w: 320, h: 64, rot: 0, text: 'Μπαρ · Ταμείο' },
          { id: 'd3', type: 'door', x: 500, y: 610, w: 80, h: 80, rot: 0 },
          { id: 'd4', type: 'plant', x: 50, y: 615, w: 44, h: 44, rot: 0 },
          { id: 'd5', type: 'plant', x: 950, y: 615, w: 44, h: 44, rot: 0 },
          { id: 'd6', type: 'window', x: 995, y: 380, w: 260, h: 10, rot: 90 },
          { id: 'd7', type: 'label', x: 500, y: 650, w: 140, h: 22, rot: 0, text: 'Είσοδος' }
        ] },
        { id: 2, name: 'Αυλή', sort: 2, width: 1000, height: 560, decor: [
          { id: 'd8', type: 'zone', x: 285, y: 290, w: 520, h: 460, rot: 0, text: 'Πέργκολα', color: 'mint' },
          { id: 'd9', type: 'plant', x: 620, y: 40, w: 40, h: 40, rot: 0 },
          { id: 'd10', type: 'plant', x: 760, y: 40, w: 40, h: 40, rot: 0 },
          { id: 'd11', type: 'plant', x: 900, y: 40, w: 40, h: 40, rot: 0 },
          { id: 'd12', type: 'wall', x: 500, y: 6, w: 1000, h: 12, rot: 0 }
        ] }
      ];
      const tables = []; let n = 0;
      const cols = [110, 280, 450, 620, 790], rows = [210, 320, 430, 540];
      rows.forEach((y, ri) => cols.forEach((x, ci) => {
        n++;
        const seats = n % 5 === 0 ? 6 : (n % 3 === 0 ? 2 : 4);
        const shape = seats === 2 ? 'round' : 'rect';
        const w = seats === 6 ? 130 : (seats === 2 ? 60 : 80), h = seats === 2 ? 60 : 80;
        tables.push({ id: n, name: 'Μ' + n, area_id: 1, seats, active: true, sort: n, x: x + (seats === 6 ? 20 : 0), y, w, h, shape, rot: 0 });
      }));
      const ecols = [110, 280, 450, 680, 860], erows = [150, 290, 430];
      let e = 0;
      erows.forEach(y => ecols.forEach(x => {
        e++;
        tables.push({ id: 100 + e, name: 'Ε' + e, area_id: 2, seats: 4, active: true, sort: 100 + e, x, y, w: 84, h: 84, shape: 'round', rot: 0 });
      }));
      const today = Logic.fmtDate(new Date());
      const tm = Logic.addDays(today, 1);
      const R = (id, d, t, p, nm, ph, tb, extra) => Object.assign({ id, res_date: d, res_time: t, duration_min: 120, party_size: p, name: nm, phone: ph, email: '', area_pref: 'any', table_ids: tb, status: 'confirmed', notes: '', confirm_sent_at: null, reminder_sent_at: null }, extra || {});
      db = {
        seq: 1000, settings: JSON.parse(JSON.stringify(defaults)), areas, tables, closures: [],
        reservations: [
          R(1, today, '19:00', 4, 'Γιώργος Νάκας', '6971234567', [1], { confirm_sent_at: new Date().toISOString() }),
          R(2, today, '20:30', 8, 'Μαρία Ζιάκα', '6944556677', [5, 10], { notes: 'Γενέθλια — τούρτα δική τους' }),
          R(3, today, '21:00', 2, 'Κώστας Μπάλλας', '6988112233', [3]),
          R(4, today, '21:30', 5, 'Ελένη Τσιρίγκα', '6932221100', [], { area_pref: '2' }),
          R(7, today, '20:00', 4, 'Θανάσης Ρήγας', '6940001122', [102]),
          R(8, today, '21:00', 3, 'Σοφία Καρρά', '6947773311', [107]),
          R(5, tm, '20:00', 6, 'Νίκος Παππάς', '6955443322', [10]),
          R(6, tm, '21:00', 3, 'Δήμητρα Λάππα', '6977001122', [])
        ]
      };
    }
    function initStaff() {
      if (db.staff) return;
      db.staff = [
        { user_id: 'u1', username: 'giorgos', display_name: 'Γιώργος', role: 'admin', active: true },
        { user_id: 'u2', username: 'maria', display_name: 'Μαρία', role: 'staff', active: true },
        { user_id: 'u3', username: 'kostas', display_name: 'Κώστας', role: 'staff', active: true }
      ];
      db.meId = 'u1';
    }
    function checkStaff(u, selfId) {
      const name = String(u.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(name)) throw new Error('Το όνομα χρήστη θέλει 3–30 λατινικούς χαρακτήρες, αριθμούς ή . _ -');
      if (!String(u.display_name || '').trim()) throw new Error('Συμπλήρωσε όνομα');
      if (db.staff.some(x => x.username === name && x.user_id !== selfId)) throw new Error('Το όνομα χρήστη «' + name + '» υπάρχει ήδη');
    }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
    const listeners = [];
    const emit = t => { save(); listeners.forEach(cb => cb(t)); };
    const clone = x => JSON.parse(JSON.stringify(x));
    return {
      demo: true,
      async getUser() { return { email: 'demo@demo' }; },
      async signIn() {}, async signOut() {},
      async getMe() { initStaff(); return clone(db.staff.find(u => u.user_id === db.meId) || db.staff[0]); },
      setDemoUser(id) { initStaff(); db.meId = id; save(); },
      async changeMyPassword(pw) { if (String(pw).length < 6) throw new Error('Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες'); },
      async listStaff() { initStaff(); return clone(db.staff).sort((a, b) => a.display_name.localeCompare(b.display_name, 'el')); },
      async createStaff(u) {
        initStaff(); checkStaff(u, null);
        if (String(u.password || '').length < 6) throw new Error('Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες');
        const row = { user_id: 'u' + (++db.seq), username: u.username.trim().toLowerCase(), display_name: u.display_name.trim(), role: u.role, active: true, created_at: new Date().toISOString() };
        db.staff.push(row); save(); return row.user_id;
      },
      async updateStaff(u) {
        initStaff(); checkStaff(u, u.user_id);
        if (u.user_id === db.meId && (u.role !== 'admin' || !u.active)) throw new Error('Δεν μπορείς να αφαιρέσεις τα δικαιώματα διαχειριστή από τον εαυτό σου');
        Object.assign(db.staff.find(x => x.user_id === u.user_id), { username: u.username.trim().toLowerCase(), display_name: u.display_name.trim(), role: u.role, active: u.active }); save();
      },
      async setStaffPassword(id, pw) { if (String(pw).length < 6) throw new Error('Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες'); },
      async deleteStaff(id) { if (id === db.meId) throw new Error('Δεν μπορείς να διαγράψεις τον εαυτό σου'); db.staff = db.staff.filter(x => x.user_id !== id); save(); },
      async loadSettings() { return clone(db.settings); },
      async saveSettings(d) { db.settings = clone(d); emit('res_settings'); },
      async listAreas() { return clone(db.areas).sort((a, b) => a.sort - b.sort || a.id - b.id); },
      async saveArea(a) {
        a = clone(a);
        if (a.id > 0) Object.assign(db.areas.find(x => x.id === a.id), a);
        else { a.id = ++db.seq; db.areas.push(a); }
        emit('res_areas'); return clone(a);
      },
      async deleteArea(id) { db.areas = db.areas.filter(a => a.id !== id); db.tables.forEach(t => { if (t.area_id === id) t.area_id = null; }); emit('res_areas'); },
      async listTables() { return clone(db.tables).sort((a, b) => a.sort - b.sort || a.id - b.id); },
      async saveTable(t) {
        t = clone(t);
        if (t.id > 0) Object.assign(db.tables.find(x => x.id === t.id), t);
        else { t.id = ++db.seq; db.tables.push(t); }
        emit('res_tables'); return clone(t);
      },
      async deleteTable(id) { db.tables = db.tables.filter(t => t.id !== id); emit('res_tables'); },
      async listClosures() { return clone(db.closures).sort((a, b) => a.day < b.day ? -1 : 1); },
      async addClosure(day, note) { db.closures = db.closures.filter(c => c.day !== day).concat([{ day, note }]); emit('res_closures'); },
      async deleteClosure(day) { db.closures = db.closures.filter(c => c.day !== day); emit('res_closures'); },
      async listReservations(from, to) {
        return clone(db.reservations.filter(r => r.res_date >= from && r.res_date <= to)
          .sort((a, b) => (a.res_date + Logic.svcMin(a.res_time)).localeCompare(b.res_date + Logic.svcMin(b.res_time))));
      },
      async findByPhone(phone) {
        const d = String(phone).replace(/\D/g, '').slice(-10);
        if (d.length < 6) return [];
        return clone(db.reservations.filter(r => String(r.phone || '').replace(/\D/g, '').includes(d))
          .sort((a, b) => a.res_date < b.res_date ? 1 : -1));
      },
      async saveReservation(r) {
        r = clone(r);
        if (r.id) Object.assign(db.reservations.find(x => x.id === r.id), r);
        else { r.id = ++db.seq; r.created_at = new Date().toISOString(); db.reservations.push(r); }
        emit('reservations'); return clone(r);
      },
      async patchReservation(id, f) { const r = db.reservations.find(x => x.id === id); Object.assign(r, f); emit('reservations'); return clone(r); },
      async deleteReservation(id) { db.reservations = db.reservations.filter(r => r.id !== id); emit('reservations'); },
      async sms(action, p) {
        await new Promise(r => setTimeout(r, 400));
        if (action === 'balance') return { ok: true, balance: '25.0', subscriptions: [] };
        const r = p && p.reservation_id ? db.reservations.find(x => x.id === p.reservation_id) : null;
        const f = { confirm: 'confirm_sent_at', reminder: 'reminder_sent_at' }[p && p.kind];
        if (r && f) { r[f] = new Date().toISOString(); emit('reservations'); }
        (db.smslog = db.smslog || []).unshift({ id: ++db.seq, reservation_id: r ? r.id : null, kind: p.kind || action, phone: r ? r.phone : p.phone, body: p.text, parts: 1, ok: true, sent_by: 'demo', created_at: new Date().toISOString() });
        save(); return { ok: true, parts: 1, demo: true };
      },
      async listSmsLog() { return clone(db.smslog || []); },
      async chatList(room) { return clone((db.chat || []).filter(m => m.room === room).slice(-150)); },
      async chatSend(room, body, resId) {
        const m = { id: ++db.seq, room, sender: db.meId, body, res_id: resId || null, created_at: new Date().toISOString() };
        (db.chat = db.chat || []).push(m); save(); listeners.forEach(cb => cb('chat_messages', { eventType: 'INSERT', new: clone(m) })); return clone(m);
      },
      async chatDelete(id) { db.chat = (db.chat || []).filter(m => m.id !== id); save(); listeners.forEach(cb => cb('chat_messages', { eventType: 'DELETE', old: { id } })); },
      async chatUnread() {
        const reads = db.chatReads || {}; const out = {};
        (db.chat || []).forEach(m => { const o = out[m.room] = out[m.room] || { room: m.room, unread: 0, last_at: m.created_at };
          o.last_at = m.created_at; if (m.sender !== db.meId && m.created_at > (reads[m.room] || '')) o.unread++; });
        return Object.values(out);
      },
      async chatMarkRead(room) { (db.chatReads = db.chatReads || {})[room] = new Date().toISOString(); save(); },
      async chatReads(room) { return (db.chatReads || {})[room] ? [{ user_id: db.meId, last_read_at: db.chatReads[room] }] : []; },
      async pushSubscribe(sub, kinds) { db.push = { endpoint: sub.endpoint, kinds }; save(); },
      async pushUnsubscribe() { delete db.push; save(); },
      async pushMine(endpoint) { return db.push && db.push.endpoint === endpoint ? clone(db.push) : null; },
      subscribe(cb) { listeners.push(cb); return () => {}; },
      reset() { localStorage.removeItem(KEY); }
    };
  }

  window.Store = { supabaseStore, demoStore };
})();
