// Ειδοποιήσεις (push) στο προσωπικό: νέες / ακυρωμένες / αλλαγμένες κρατήσεις, «σε 30′ έρχεται» και μηνύματα συνομιλίας.
// Καλείται μόνο από τη βάση (trigger / pg_cron) με μυστικό κλειδί στο header x-hook-secret.
import { sendPush } from './webpush.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(URL_ + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(fn + ': ' + r.status + ' ' + await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
function athensToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(d: string, n: number) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
function dayLabel(d: string) {
  const today = athensToday();
  if (d === today) return 'Σήμερα';
  if (d === addDays(today, 1)) return 'Αύριο';
  const dt = new Date(d + 'T12:00:00Z');
  return DAYS[dt.getUTCDay()] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    const cfg = (await rpc('push_get_config'))?.[0];
    if (!cfg) return new Response('no config', { status: 503 });
    if (req.headers.get('x-hook-secret') !== cfg.hook_secret) return new Response('forbidden', { status: 403 });

    const { kind, record: r, actor, old } = await req.json();
    if (!r || !['new', 'cancel', 'change', 'soon', 'chat'].includes(kind)) return new Response('ignored');

    let subs, data;
    if (kind === 'chat') {
      // μήνυμα συνομιλίας: σε όλους (room 'all') ή μόνο στον άλλον της ιδιωτικής συνομιλίας
      const users = r.room === 'all' ? null : String(r.room).split(':').slice(1);
      subs = await rpc('push_targets_users', { p_kind: 'chat', p_users: users, p_exclude: actor || null });
      if (!subs.length) return Response.json({ sent: 0 });
      const text = String(r.body || '');
      data = {
        title: '💬 ' + (r.room === 'all' ? 'Ομάδα · ' : '') + (r.sender_name || 'Μήνυμα'),
        body: text.length > 300 ? text.slice(0, 299) + '…' : text,
        tag: 'chat-' + r.room, kind: 'chat', room: r.room,
        url: './?chat=' + encodeURIComponent(r.room)
      };
    } else {
    subs = await rpc('push_targets', { p_kind: kind, p_exclude: actor || null });
    if (!subs.length) return Response.json({ sent: 0 });

    const allIds = [...new Set([...(r.table_ids || []), ...((old && old.table_ids) || [])].map(Number))];
    const tables: { id: number; name: string }[] = allIds.length ? await rpc('push_table_names', { p_ids: allIds }) : [];
    const names = (ids: number[]) => (ids || []).map(id => (tables.find(t => Number(t.id) === Number(id)) || { name: '#' + id }).name).join(' + ');
    const tnames = names(r.table_ids);
    const hhmm = (t: string) => String(t || '').slice(0, 5);
    const time = hhmm(r.res_time);
    const TITLE: Record<string, string> = { new: 'Νέα κράτηση · ', cancel: 'Ακύρωση κράτησης · ', change: 'Αλλαγή κράτησης · ', soon: 'Σε 30′ έρχεται · ' };
    const title = TITLE[kind] + (kind === 'soon' ? time + ' ' + r.name : dayLabel(r.res_date) + ' ' + time);
    const changes: string[] = [];
    if (kind === 'change' && old) {
      if (old.res_date !== r.res_date) changes.push('Μέρα: ' + dayLabel(old.res_date) + ' → ' + dayLabel(r.res_date));
      if (hhmm(old.res_time) !== time) changes.push('Ώρα: ' + hhmm(old.res_time) + ' → ' + time);
      if (Number(old.party_size) !== Number(r.party_size)) changes.push('Άτομα: ' + old.party_size + ' → ' + r.party_size);
      const ot = names(old.table_ids);
      if (ot !== tnames) changes.push('Τραπέζι: ' + (ot || 'χωρίς') + ' → ' + (tnames || 'χωρίς'));
    }
    const lines = [
      kind === 'soon' ? r.party_size + ' άτομα' : r.name + ' · ' + r.party_size + ' άτομα',
      ...changes.map(c => '✏️ ' + c),
      (tnames ? 'Τραπέζι ' + tnames : 'Χωρίς τραπέζι') + (r.phone ? ' · ' + r.phone : ''),
      r.notes ? '📝 ' + r.notes : null,
      kind === 'new' && r.created_by ? 'από ' + r.created_by : null
    ].filter(Boolean);
    data = {
      title, body: lines.join('\n'), tag: 'res-' + r.id + '-' + kind + (kind === 'change' ? '-' + Date.now() : ''), kind,
      url: './?date=' + r.res_date + '&res=' + r.id
    };
    }

    const vapid = { publicKey: cfg.vapid_public, privateKey: cfg.vapid_private, subject: cfg.vapid_subject };
    const gone: string[] = [];
    let sent = 0;
    const codes: number[] = [];
    await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        const res = await sendPush(s, data, vapid, kind === 'soon' ? 1800 : 6 * 3600);
        codes.push(res.status);
        if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
        else if (res.status < 300) sent++;
        else console.log('push', res.status, res.text.slice(0, 200));
      } catch (e) { console.log('push error', String(e)); }
    }));
    if (gone.length) await rpc('push_forget', { p_endpoints: gone });
    return Response.json({ sent, gone: gone.length, codes });
  } catch (e) {
    console.log('error', String(e));
    return new Response(String(e), { status: 500 });
  }
});
