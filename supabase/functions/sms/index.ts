// Αποστολή SMS στους πελάτες μέσω Apifon, με όνομα αποστολέα του καταστήματος.
// Κλήσεις:
//   από την εφαρμογή (με σύνδεση χρήστη):  { action: 'send', reservation_id, kind, text }
//                                          { action: 'balance' }            (διαχειριστής)
//                                          { action: 'test', phone, text }  (διαχειριστής)
//   από τη βάση (pg_cron, x-hook-secret):  { action: 'auto' }  → αυτόματες υπενθυμίσεις για αύριο
// Τα κλειδιά της Apifon είναι μυστικά της function: APIFON_TOKEN, APIFON_SECRET.

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APIFON_TOKEN = Deno.env.get('APIFON_TOKEN') || '';
const APIFON_SECRET = Deno.env.get('APIFON_SECRET') || '';
const SVC = { apikey: SRK, Authorization: 'Bearer ' + SRK, 'Content-Type': 'application/json' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---------- βάση (με service role) ---------- */
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(URL_ + '/rest/v1/' + path, { ...init, headers: { ...SVC, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error('db ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
const DEFAULTS: Record<string, any> = {
  shop_name: 'Ψητοπωλείο Παπαχρήστου', shop_phone: '',
  tpl_confirm: 'Γεια σας {ονομα}! Η κράτησή σας στο {καταστημα} για {ατομα} άτομα, {ημερα} {ημερομηνια} στις {ωρα}, επιβεβαιώθηκε. Για αλλαγές: {τηλεφωνο}.',
  tpl_reminder: 'Καλησπέρα {ονομα}! Σας θυμίζουμε την κράτησή σας στο {καταστημα} {ημερα} {ημερομηνια} στις {ωρα} για {ατομα} άτομα. Σας περιμένουμε!',
  tpl_cancel: 'Γεια σας {ονομα}. Η κράτησή σας στο {καταστημα} για {ημερα} {ημερομηνια} στις {ωρα} ακυρώθηκε. Για νέα κράτηση: {τηλεφωνο}.'
};
async function settings(): Promise<Record<string, any>> {
  const rows = await rest('res_settings?id=eq.1&select=data');
  const d = (rows && rows[0] && rows[0].data) || {};
  const out = { ...DEFAULTS, ...d };
  for (const k of Object.keys(DEFAULTS)) if (!out[k] && k.startsWith('tpl_')) out[k] = DEFAULTS[k];
  return out;
}
async function logSms(row: Record<string, unknown>) {
  try { await rest('sms_log', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } }); } catch (_) { /* */ }
}

/* ---------- ποιος καλεί ---------- */
async function caller(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.id) return null;
  const st = await rest('staff?user_id=eq.' + u.id + '&select=user_id,display_name,role,active');
  const s = st && st[0];
  return s && s.active ? s : null;
}

/* ---------- κείμενο / κωδικοποίηση ---------- */
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
export function isGsm(s: string) { for (const c of s) if (!GSM.includes(c) && !GSM_EXT.includes(c)) return false; return true; }
export function smsParts(s: string) {
  if (isGsm(s)) {
    let n = 0; for (const c of s) n += GSM_EXT.includes(c) ? 2 : 1;
    return { unicode: false, chars: n, parts: n <= 160 ? 1 : Math.ceil(n / 153) };
  }
  const n = [...s].length;
  return { unicode: true, chars: n, parts: n <= 70 ? 1 : Math.ceil(n / 67) };
}
const GR: Record<string, string> = {
  'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n',
  'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o'
};
export function greeklish(s: string) {
  const plain = s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/[«»“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '.');
  let out = '';
  const chars = [...plain];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], lo = c.toLowerCase(), up = c !== lo;
    const nx = (chars[i + 1] || '').toLowerCase();
    let t: string | undefined;
    if (lo === 'ο' && nx === 'υ') { t = 'ou'; i++; }
    else t = GR[lo];
    if (t == null) { out += c; continue; }
    if (up) {
      const nextUp = chars[i + 1] && chars[i + 1] !== chars[i + 1].toLowerCase();
      t = nextUp || t.length === 1 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1);
    }
    out += t;
  }
  return out;
}
export function intl(p: string | null | undefined) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('+')) d = d.slice(1);
  else if (d.length === 10 && /^[26]/.test(d)) d = '30' + d;
  if (!/^[1-9]\d{6,14}$/.test(d)) return '';
  if (d.startsWith('30') && !d.startsWith('306')) return '';   // ελληνικό σταθερό: δεν παίρνει SMS
  return d;
}

const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
function fill(tpl: string, r: any, st: any) {
  const [y, m, d] = String(r.res_date).split('-');
  const map: Record<string, string> = {
    'ονομα': String(r.name || '').trim().split(/\s+/)[0] || '',
    'ονοματεπωνυμο': String(r.name || '').trim(),
    'καταστημα': st.shop_name || '',
    'ατομα': String(r.party_size || ''),
    'ημερα': DAYS[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()],
    'ημερομηνια': d + '/' + m + '/' + y,
    'ωρα': String(r.res_time || '').slice(0, 5),
    'τηλεφωνο': st.shop_phone || ''
  };
  return String(tpl || '').replace(/\{([^}]+)\}/g, (all, k) => {
    const key = k.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return key in map ? map[key] : all;
  }).replace(/\s*[^.!?\n]*:\s*\.(?=\s|$)/g, '').trim();
}

/* ---------- Apifon ---------- */
async function apifon(path: string, body: string) {
  if (!APIFON_TOKEN || !APIFON_SECRET) throw new Error('Δεν έχουν μπει τα κλειδιά της Apifon (APIFON_TOKEN / APIFON_SECRET).');
  const date = new Date().toUTCString();   // π.χ. Tue, 27 Oct 2026 08:00:00 GMT
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APIFON_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('POST\n' + path + '\n' + body + '\n' + date)));
  let b = ''; for (const x of sig) b += String.fromCharCode(x);
  const r = await fetch('https://ars.apifon.com' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-ApifonWS-Date': date, Authorization: 'ApifonWS ' + APIFON_TOKEN + ':' + btoa(b) },
    body
  });
  const t = await r.text();
  let d: any = null; try { d = t ? JSON.parse(t) : null; } catch (_) { d = { raw: t }; }
  return { status: r.status, data: d };
}
function apifonError(status: number, d: any) {
  if (status === 401) return 'Η Apifon δεν δέχτηκε τα κλειδιά (401). Έλεγξε Token / API Key και ότι το token επιτρέπει όλες τις IP (*).';
  if (status === 402) return 'Δεν υπάρχει αρκετό υπόλοιπο στην Apifon.';
  const det = d && (d.error_details ? JSON.stringify(d.error_details) : d.result_info ? d.result_info.description : d.title || d.raw);
  return 'Apifon ' + status + (det ? ': ' + String(det).slice(0, 200) : '');
}

async function sendSms(phone: string, text: string, st: any, ref: string) {
  const number = intl(phone);
  if (!number) throw new Error('Το «' + phone + '» δεν είναι κινητό — δεν μπορεί να πάρει SMS.');
  const msg = st.sms_greeklish ? greeklish(text) : text;
  const info = smsParts(msg);
  const message: Record<string, unknown> = { text: msg, dc: info.unicode ? 2 : 0 };
  if (st.sms_sender) message.sender_id = String(st.sms_sender).trim();
  const body = JSON.stringify({ subscribers: [{ number }], message, reference_id: ref.slice(0, 250) });
  const { status, data } = await apifon('/services/api/v1/sms/send', body);
  const ok = status >= 200 && status < 300 && (!data || !data.result_info || +data.result_info.status_code < 300);
  const res = data && data.results && data.results[number] && data.results[number][0];
  return { ok, status, data, number, text: msg, parts: info.parts, unicode: info.unicode, message_id: res ? res.message_id : null, error: ok ? null : apifonError(status, data) };
}

/* ---------- κράτηση ---------- */
const FIELD: Record<string, string> = { confirm: 'confirm_sent_at', reminder: 'reminder_sent_at' };
async function sendForReservation(r: any, kind: string, text: string, st: any, by: string | null) {
  const out = await sendSms(r.phone, text, st, kind + ' #' + r.id);
  await logSms({ reservation_id: r.id, kind, phone: out.number, body: out.text, parts: out.parts, ok: out.ok, provider_id: out.message_id, error: out.error, sent_by: by });
  if (out.ok && FIELD[kind]) await rest('reservations?id=eq.' + r.id, { method: 'PATCH', body: JSON.stringify({ [FIELD[kind]]: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
  return out;
}

function athensNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24 };
}
function addDays(d: string, n: number) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

async function autoReminders() {
  const st = await settings();
  if (!st.sms_enabled || !st.sms_auto_reminder) return { skipped: 'off' };
  const now = athensNow();
  const from = Number.isFinite(+st.sms_reminder_hour) ? +st.sms_reminder_hour : 12;
  if (now.hour < from || now.hour >= 22) return { skipped: 'hour ' + now.hour };
  const tm = addDays(now.date, 1);
  const list = await rest('reservations?res_date=eq.' + tm + '&status=eq.confirmed&reminder_sent_at=is.null&phone=not.is.null&select=*');
  const recent = Date.now() - 6 * 3600e3;
  let sent = 0, failed = 0;
  for (const r of list || []) {
    // μόλις πήρε επιβεβαίωση (κράτηση της τελευταίας στιγμής): δεν στέλνουμε και υπενθύμιση
    if (r.confirm_sent_at && new Date(r.confirm_sent_at).getTime() > recent) continue;
    if (!intl(r.phone)) continue;
    try {
      const o = await sendForReservation(r, 'reminder', fill(st.tpl_reminder, r, st), st, 'αυτόματα');
      o.ok ? sent++ : failed++;
    } catch (_) { failed++; }
  }
  return { date: tm, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'auto') {
      const cfg = await rest('rpc/push_get_config', { method: 'POST', body: '{}' });
      if (!cfg || !cfg[0] || req.headers.get('x-hook-secret') !== cfg[0].hook_secret) return json({ error: 'forbidden' }, 403);
      return json(await autoReminders());
    }

    const me = await caller(req);
    if (!me) return json({ error: 'Χωρίς πρόσβαση' }, 401);
    const st = await settings();

    if (action === 'balance') {
      if (me.role !== 'admin') return json({ error: 'Μόνο ο διαχειριστής' }, 403);
      const { status, data } = await apifon('/services/api/v1/balance', '');
      if (status >= 300) return json({ error: apifonError(status, data) });
      return json({ ok: true, balance: data && data.balance, subscriptions: data && data.subscriptions });
    }

    if (action === 'test') {
      if (me.role !== 'admin') return json({ error: 'Μόνο ο διαχειριστής' }, 403);
      const out = await sendSms(body.phone, String(body.text || 'Δοκιμαστικό μήνυμα από ' + (st.shop_name || 'το κατάστημα')), st, 'test');
      await logSms({ kind: 'test', phone: out.number, body: out.text, parts: out.parts, ok: out.ok, provider_id: out.message_id, error: out.error, sent_by: me.display_name });
      return json(out.ok ? { ok: true, parts: out.parts, unicode: out.unicode } : { error: out.error, details: out.data });
    }

    if (action === 'send') {
      if (!st.sms_enabled) return json({ error: 'Τα SMS δεν είναι ενεργά (Ρυθμίσεις → Μηνύματα).' });
      const kind = String(body.kind || '');
      if (!['confirm', 'reminder', 'cancel'].includes(kind)) return json({ error: 'Άγνωστο είδος μηνύματος' }, 400);
      const rows = await rest('reservations?id=eq.' + Number(body.reservation_id) + '&select=*');
      const r = rows && rows[0];
      if (!r) return json({ error: 'Δεν βρέθηκε η κράτηση' }, 404);
      if (!r.phone) return json({ error: 'Η κράτηση δεν έχει κινητό' });
      const text = String(body.text || '').trim() || fill(st['tpl_' + kind], r, st);
      if (text.length > 900) return json({ error: 'Πολύ μεγάλο μήνυμα' }, 400);
      const out = await sendForReservation(r, kind, text, st, me.display_name);
      return json(out.ok ? { ok: true, parts: out.parts, unicode: out.unicode } : { error: out.error });
    }

    return json({ error: 'Άγνωστη ενέργεια' }, 400);
  } catch (e) {
    console.log('error', String(e));
    return json({ error: String((e as Error).message || e) });
  }
});
