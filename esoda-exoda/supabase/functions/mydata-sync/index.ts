// mydata-sync — two jobs against AADE myDATA:
//  (default)  VAT daily totals via RequestVatInfo (GroupedPerDay=true) — fast,
//             one call per year, stored in fin_vat_daily. Powers the headline cards.
//  (?mode=expenses) expense invoice DETAIL via RequestDocs, month by month with
//             continuation + checkpoint, supplier ΑΦΜ resolved to name via the
//             AADE registry (RgWsPublic2), stored in fin_expense_docs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4";

const USER_ID = Deno.env.get("MYDATA_USER_ID") ?? "";
const KEY     = Deno.env.get("MYDATA_KEY") ?? "";
const ENV     = (Deno.env.get("MYDATA_ENV") ?? "prod").toLowerCase();
const RG_USER = Deno.env.get("RG_USER") ?? "";
const RG_PASS = Deno.env.get("RG_PASS") ?? "";
const START_YEAR = parseInt(Deno.env.get("MYDATA_START_YEAR") ?? "2021", 10);
const BASE = ENV === "test" ? "https://mydataapidev.aade.gr/myDATA/" : "https://mydatapi.aade.gr/myDATA/";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

const num = (s: any) => { const n = parseFloat(String(s)); return isFinite(n) ? n : 0; };
const dateOnly = (s: string) => (s && s.length >= 10 ? s.slice(0, 10) : null);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const pad = (n: number) => String(n).padStart(2, "0");

let RUN_START = 0, LAST_CALL = 0;
const THROTTLE_MS = 900, BUDGET_MS = 130000;

function pick(obj: any, name: string): string {
  let found = "";
  const walk = (o: any) => {
    if (found || o == null || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (k === name && (typeof o[k] === "string" || typeof o[k] === "number")) { found = String(o[k]); return; }
      if (typeof o[k] === "object") walk(o[k]);
    }
  };
  walk(obj);
  return found;
}
function findTag(doc: any, name: string): any[] {
  let out: any[] = [];
  const walk = (o: any) => {
    if (o == null || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (k === name) out = out.concat(Array.isArray(o[k]) ? o[k] : [o[k]]);
      else if (typeof o[k] === "object") walk(o[k]);
    }
  };
  walk(doc);
  return out;
}
function partyVat(inv: any, parent: string): string { const p = inv?.[parent]; return p ? pick(p, "vatNumber") : ""; }

async function httpGet(url: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const since = Date.now() - LAST_CALL;
    if (since < THROTTLE_MS) await sleep(THROTTLE_MS - since);
    LAST_CALL = Date.now();
    const r = await fetch(url, { headers: { "aade-user-id": USER_ID, "Ocp-Apim-Subscription-Key": KEY } });
    const body = await r.text();
    if (r.status === 429) {
      const m = body.match(/(\d+)\s*second/i);
      const waitS = m ? parseInt(m[1], 10) : 30;
      if (RUN_START && (Date.now() - RUN_START) + waitS * 1000 > BUDGET_MS) {
        throw new Error(`myDATA 429 paused (retry later): wait ${waitS}s`);
      }
      await sleep((waitS + 2) * 1000);
      continue;
    }
    if (!r.ok) throw new Error(`myDATA ${r.status}: ${body.slice(0, 200)}`);
    return body;
  }
  throw new Error("myDATA 429: retries exhausted");
}

// ΑΦΜ -> επωνυμία via the AADE registry web service (cached in fin_suppliers).
async function resolveAfm(vat: string): Promise<string> {
  if (!vat) return "";
  const { data } = await supabase.from("fin_suppliers").select("name").eq("vat", vat).maybeSingle();
  if (data?.name) return data.name as string;
  if (!RG_USER || !RG_PASS) return "";
  try {
    const soap = `<?xml version="1.0" encoding="UTF-8"?>\n<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope" xmlns:ns1="http://rgwspublic2/RgWsPublic2Service" xmlns:ns2="http://rgwspublic2/RgWsPublic2">\n <env:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:UsernameToken><wsse:Username>${RG_USER}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${RG_PASS}</wsse:Password></wsse:UsernameToken></wsse:Security></env:Header>\n <env:Body><ns1:rgWsPublic2AfmMethod><ns1:INPUT_REC><ns2:afm_called_by></ns2:afm_called_by><ns2:afm_called_for>${vat}</ns2:afm_called_for></ns1:INPUT_REC></ns1:rgWsPublic2AfmMethod></env:Body>\n</env:Envelope>`;
    const r = await fetch("https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2", { method: "POST", headers: { "Content-Type": "application/soap+xml; charset=utf-8" }, body: soap });
    const obj = parser.parse(await r.text());
    const name = pick(obj, "onomasia") || pick(obj, "commer_title") || "";
    if (name) await supabase.from("fin_suppliers").upsert({ vat, name, updated_at: new Date().toISOString() });
    return name;
  } catch { return ""; }
}

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `01/${pad(m)}/${y}`, to: `${pad(last)}/${pad(m)}/${y}` };
}
function nextMonth(ym: string) { let [y, m] = ym.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${pad(m)}`; }
function curMonth() { const d = new Date(); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }

// ---------- VAT daily totals (fast) ----------
async function pullVatYear(year: number): Promise<number> {
  const u = `${BASE}RequestVatInfo?dateFrom=01/01/${year}&dateTo=31/12/${year}&GroupedPerDay=true`;
  const doc = parser.parse(await httpGet(u));
  const entries = findTag(doc, "VatInfo");
  const rows: any[] = [];
  for (const e of entries) {
    const d = dateOnly(pick(e, "IssueDate")); if (!d) continue;
    let out_net = 0, out_vat = 0, in_net = 0, in_vat = 0, other = 0;
    for (const k of Object.keys(e)) {
      if (k === "IssueDate" || k === "Mark" || k === "IsCancelled") continue;
      const mm = String(k).match(/(\d{3})$/);
      if (!mm) continue;
      const code = mm[1], v = num(e[k]);
      if (code.startsWith("30")) out_net += v;
      else if (code.startsWith("33")) out_vat += v;
      else if (code.startsWith("36")) in_net += v;
      else if (code.startsWith("38")) in_vat += v;
      else other += v;
    }
    rows.push({ d, out_net, out_vat, in_net, in_vat, other, updated_at: new Date().toISOString() });
  }
  if (rows.length) {
    await supabase.from("fin_vat_daily").delete().gte("d", `${year}-01-01`).lte("d", `${year}-12-31`);
    const { error } = await supabase.from("fin_vat_daily").upsert(rows, { onConflict: "d" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
async function syncVat(fromYear: number) {
  const current = new Date().getUTCFullYear();
  const start = Math.max(fromYear, START_YEAR);
  let days = 0, years: number[] = [], lastError = "";
  try {
    for (let y = start; y <= current; y++) {
      if (Date.now() - RUN_START > BUDGET_MS) break;
      days += await pullVatYear(y);
      years.push(y);
    }
  } catch (e) { lastError = String((e as any)?.message ?? e); }
  const { count } = await supabase.from("fin_vat_daily").select("*", { count: "exact", head: true });
  await supabase.from("fin_sync_state").update({ last_run: new Date().toISOString(), last_added: days, last_total: count ?? 0, last_error: lastError }).eq("side", "vat");
  return { mode: "vat", years, days, total_days: count ?? 0, error: lastError, done: !lastError };
}

// ---------- Expense invoice detail (with supplier names) ----------
async function pullExpenseMonth(ym: string, startNpk: string, startNrk: string): Promise<{ added: number; done: boolean }> {
  const { from, to } = monthBounds(ym);
  let npk = startNpk || "", nrk = startNrk || "", pages = 0, added = 0;
  do {
    if (Date.now() - RUN_START > BUDGET_MS) return { added, done: false };
    pages++;
    let u = `${BASE}RequestDocs?mark=0&dateFrom=${from}&dateTo=${to}`;
    if (npk) u += `&nextPartitionKey=${encodeURIComponent(npk)}&nextRowKey=${encodeURIComponent(nrk)}`;
    const doc = parser.parse(await httpGet(u));
    const invoices = findTag(doc, "invoice");
    const rows: any[] = [];
    for (const inv of invoices) {
      const mk = pick(inv, "mark"); if (!mk) continue;
      const supplier_vat = partyVat(inv, "issuer") || pick(inv, "vatNumber");
      rows.push({
        mark: mk, uid: pick(inv, "uid"), issue_date: dateOnly(pick(inv, "issueDate")),
        series: pick(inv, "series"), aa: pick(inv, "aa"), inv_type: pick(inv, "invoiceType"),
        net: num(pick(inv, "totalNetValue")), vat: num(pick(inv, "totalVatAmount")), gross: num(pick(inv, "totalGrossValue")),
        supplier_vat, supplier_name: await resolveAfm(supplier_vat),
      });
    }
    if (rows.length) {
      const { data: ins, error } = await supabase.from("fin_expense_docs").upsert(rows, { onConflict: "mark", ignoreDuplicates: true }).select("mark");
      if (error) throw new Error(error.message);
      added += ins?.length ?? 0;
    }
    npk = pick(doc, "nextPartitionKey"); nrk = pick(doc, "nextRowKey");
    await supabase.from("fin_sync_state").update({ cursor: ym, cursor_npk: npk || null, cursor_nrk: nrk || null }).eq("side", "expense");
  } while (npk && nrk && pages < 400);
  return { added, done: true };
}
async function syncExpenses(fromYear: number | null, monthsPerRun = 12) {
  const { data: st } = await supabase.from("fin_sync_state").select("cursor, cursor_npk, cursor_nrk").eq("side", "expense").maybeSingle();
  let cursor = (fromYear ? `${fromYear}-01` : (st?.cursor && /^\d{4}-\d{2}$/.test(st.cursor) ? st.cursor : `${START_YEAR}-01`));
  let startNpk = fromYear ? "" : (st?.cursor_npk || ""), startNrk = fromYear ? "" : (st?.cursor_nrk || "");
  const current = curMonth();
  let added = 0, processed = 0, lastMonth = cursor, lastError = "", caughtUp = false;
  try {
    while (processed < monthsPerRun) {
      if (Date.now() - RUN_START > BUDGET_MS) break;
      const res = await pullExpenseMonth(cursor, startNpk, startNrk);
      startNpk = ""; startNrk = "";
      added += res.added; lastMonth = cursor;
      if (!res.done) break;
      processed++;
      caughtUp = cursor >= current;
      const next = caughtUp ? current : nextMonth(cursor);
      await supabase.from("fin_sync_state").update({ cursor: next, cursor_npk: null, cursor_nrk: null }).eq("side", "expense");
      if (caughtUp) break;
      cursor = next;
    }
  } catch (e) { lastError = String((e as any)?.message ?? e); }
  const done = caughtUp && !lastError;
  const { count } = await supabase.from("fin_expense_docs").select("*", { count: "exact", head: true });
  await supabase.from("fin_sync_state").update({ last_run: new Date().toISOString(), last_added: added, last_total: count ?? 0, last_error: lastError }).eq("side", "expense");
  return { mode: "expenses", month: lastMonth, added, total: count ?? 0, error: lastError, done };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { ...cors, "content-type": "application/json" } });
  if (!USER_ID || !KEY) return json({ error: "myDATA credentials not configured" }, 500);
  RUN_START = Date.now();
  const url = new URL(req.url);

  let mode = url.searchParams.get("mode") || "";
  let full = !!url.searchParams.get("full");
  if (req.method === "POST") { try { const b = await req.json(); if (b && b.mode) mode = b.mode; if (b && b.full) full = true; } catch { /* no body */ } }

  if (mode === "expenses") {
    const result = await syncExpenses(full ? START_YEAR : null);
    return json({ ok: true, ...result });
  }
  // default: VAT daily totals
  const fromYear = full ? START_YEAR : new Date().getUTCFullYear() - 1;
  const result = await syncVat(fromYear);
  return json({ ok: true, ...result });
});
