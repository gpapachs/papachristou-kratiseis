// mydata-sync — pulls ΕΣΟΔΑ/ΕΞΟΔΑ + ΦΠΑ totals from AADE myDATA using the
// RequestVatInfo endpoint with GroupedPerDay=true: one call per year returns a
// per-day breakdown (no paging, no per-document volume). Buckets the Φ2 VAT
// codes into output/input net & VAT and stores one row per day in fin_vat_daily.
//   30x -> output net (έσοδα)    33x -> output VAT (ΦΠΑ εκροών)
//   36x -> input  net (έξοδα)    38x -> input  VAT (ΦΠΑ εισροών)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4";

const USER_ID = Deno.env.get("MYDATA_USER_ID") ?? "";
const KEY     = Deno.env.get("MYDATA_KEY") ?? "";
const ENV     = (Deno.env.get("MYDATA_ENV") ?? "prod").toLowerCase();
const START_YEAR = parseInt(Deno.env.get("MYDATA_START_YEAR") ?? "2021", 10);
const BASE = ENV === "test" ? "https://mydataapidev.aade.gr/myDATA/" : "https://mydatapi.aade.gr/myDATA/";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

const num = (s: any) => { const n = parseFloat(String(s)); return isFinite(n) ? n : 0; };
const dateOnly = (s: string) => (s && s.length >= 10 ? s.slice(0, 10) : null);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

// Pull one calendar year of per-day VAT totals, upsert into fin_vat_daily.
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
      const mm = String(k).match(/(\d{3})$/);  // matches VatNNN and VatUnclassifiedNNN
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
    // replace the year's rows so corrections/cancellations are reflected
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
  await supabase.from("fin_sync_state").update({
    last_run: new Date().toISOString(), last_added: days, last_total: count ?? 0, last_error: lastError,
  }).eq("side", "vat");
  return { years, days, total_days: count ?? 0, error: lastError, done: !lastError };
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

  const probe = url.searchParams.get("probe");
  if (probe) {
    const from = url.searchParams.get("from") || "01/01/2026";
    const to = url.searchParams.get("to") || "31/01/2026";
    const gpd = url.searchParams.get("gpd") || "true";
    const u = `${BASE}${probe}?dateFrom=${from}&dateTo=${to}&GroupedPerDay=${gpd}`;
    const raw = await httpGet(u);
    return json({ url: u, len: raw.length, body: raw.slice(0, 6000) });
  }

  // full=true → whole history from START_YEAR; otherwise refresh current + previous year
  let full = !!url.searchParams.get("full");
  if (req.method === "POST") { try { const b = await req.json(); if (b && b.full) full = true; } catch { /* no body */ } }
  const fromYear = full ? START_YEAR : new Date().getUTCFullYear() - 1;
  const result = await syncVat(fromYear);
  return json({ ok: true, ...result });
});
