// Ειδοποιήσεις (push) στο προσωπικό για νέες / ακυρωμένες κρατήσεις.
// Καλείται μόνο από τη βάση (trigger στον πίνακα reservations) με μυστικό κλειδί στο header x-hook-secret.
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

    const { kind, record: r, actor } = await req.json();
    if (!r || !['new', 'cancel'].includes(kind)) return new Response('ignored');

    const subs = await rpc('push_targets', { p_kind: kind, p_exclude: actor || null });
    if (!subs.length) return Response.json({ sent: 0 });

    const tables: { id: number; name: string }[] = (r.table_ids || []).length ? await rpc('push_table_names', { p_ids: r.table_ids }) : [];
    const tnames = tables.map(t => t.name).join(' + ');
    const time = String(r.res_time || '').slice(0, 5);
    const title = (kind === 'new' ? 'Νέα κράτηση · ' : 'Ακύρωση κράτησης · ') + dayLabel(r.res_date) + ' ' + time;
    const lines = [
      r.name + ' · ' + r.party_size + ' άτομα',
      (tnames ? 'Τραπέζι ' + tnames : 'Χωρίς τραπέζι') + (r.phone ? ' · ' + r.phone : ''),
      r.notes ? '📝 ' + r.notes : null,
      kind === 'new' && r.created_by ? 'από ' + r.created_by : null
    ].filter(Boolean);
    const data = {
      title, body: lines.join('\n'), tag: 'res-' + r.id + '-' + kind, kind,
      url: './?date=' + r.res_date + '&res=' + r.id
    };

    const vapid = { publicKey: cfg.vapid_public, privateKey: cfg.vapid_private, subject: cfg.vapid_subject };
    const gone: string[] = [];
    let sent = 0;
    const codes: number[] = [];
    await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        const res = await sendPush(s, data, vapid, 6 * 3600);
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
