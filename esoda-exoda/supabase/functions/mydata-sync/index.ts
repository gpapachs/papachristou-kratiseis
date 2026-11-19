// ============================================================
//  mydata-sync — Supabase Edge Function (Deno)
//  Pulls new documents from AADE myDATA into Supabase, incrementally
//  by `mark`. One source of truth for ΕΣΟΔΑ (RequestTransmittedDocs)
//  and ΕΞΟΔΑ (RequestDocs). Holds the AADE key as a secret; never
//  exposed to the browser.
//
//  Secrets (supabase secrets set ...):
//    MYDATA_USER_ID   aade-user-id
//    MYDATA_KEY       Ocp-Apim-Subscription-Key
//    MYDATA_ENV       "prod" (default) | "test"
//    RG_USER, RG_PASS AADE registry creds for ΑΦΜ→επωνυμία (optional)
//  Injected automatically by Supabase:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4";

const USER_ID = Deno.env.get("MYDATA_USER_ID") ?? "";
const KEY     = Deno.env.get("MYDATA_KEY") ?? "";
const ENV     = (Deno.env.get("MYDATA_ENV") ?? "prod").toLowerCase();
const RG_USER = Deno.env.get("RG_USER") ?? "";
const RG_PASS = Deno.env.get("RG_PASS") ?? "";
const BASE = ENV === "test"
  ? "https://mydataapidev.aade.gr/myDATA/"
  : "https://mydatapi.aade.gr/myDATA/";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

// pull a scalar field out of a parsed invoice object regardless of nesting
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
// first vatNumber under a given parent key (issuer/counterpart)
function partyVat(inv: any, parent: string): string {
  const p = inv?.[parent];
  if (!p) return "";
  return pick(p, "vatNumber");
}
const num = (s: string) => { const n = parseFloat(s); return isFinite(n) ? n : 0; };
const dateOnly = (s: string) => (s && s.length >= 10 ? s.slice(0, 10) : null);

async function httpGet(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "aade-user-id": USER_ID, "Ocp-Apim-Subscription-Key": KEY } });
  const body = await r.text();
  if (!r.ok) throw new Error(`myDATA ${r.status}: ${body.slice(0, 300)}`);
  return body;
}

// ---- AADE registry: ΑΦΜ -> επωνυμία (best effort, cached) ----
async function resolveAfm(vat: string): Promise<string> {
  if (!vat || !RG_USER || !RG_PASS) return "";
  const { data } = await supabase.from("fin_suppliers").select("name").eq("vat", vat).maybeSingle();
  if (data?.name) return data.name as string;
  try {
    const soap = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope" xmlns:ns1="http://rgwspublic2/RgWsPublic2Service" xmlns:ns2="http://rgwspublic2/RgWsPublic2">
 <env:Header>
  <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
   <wsse:UsernameToken>
    <wsse:Username>${RG_USER}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${RG_PASS}</wsse:Password>
   </wsse:UsernameToken>
  </wsse:Security>
 </env:Header>
 <env:Body><ns1:rgWsPublic2AfmMethod><ns1:INPUT_REC><ns2:afm_called_by></ns2:afm_called_by><ns2:afm_called_for>${vat}</ns2:afm_called_for></ns1:INPUT_REC></ns1:rgWsPublic2AfmMethod></env:Body>
</env:Envelope>`;
    const r = await fetch("https://www1.aade.gr/webtax2/wsgsis/RgWsPublic2/RgWsPublic2Service", {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: soap,
    });
    const txt = await r.text();
    const obj = parser.parse(txt);
    const name = pick(obj, "onomasia") || pick(obj, "commer_title") || "";
    if (name) await supabase.from("fin_suppliers").upsert({ vat, name, updated_at: new Date().toISOString() });
    return name;
  } catch { return ""; }
}

async function syncSide(side: "income" | "expense", maxPages = 60) {
  const endpoint = side === "expense" ? "RequestDocs" : "RequestTransmittedDocs";
  const table = side === "expense" ? "fin_expense_docs" : "fin_income_docs";

  const { data: st } = await supabase.from("fin_sync_state").select("last_mark").eq("side", side).maybeSingle();
  let cur = BigInt(st?.last_mark ?? 0);
  let added = 0, pages = 0, done = false, lastError = "";

  try {
    while (pages < maxPages) {
      pages++;
      const xml = await httpGet(`${BASE}${endpoint}?mark=${cur.toString()}`);
      const doc = parser.parse(xml);
      const invoices = findInvoices(doc);
      if (invoices.length === 0) { done = true; break; }

      let maxMark = cur;
      const rows: any[] = [];
      for (const inv of invoices) {
        const mk = pick(inv, "mark");
        if (!mk) continue;
        const row: any = {
          mark: mk,
          uid: pick(inv, "uid"),
          issue_date: dateOnly(pick(inv, "issueDate")),
          series: pick(inv, "series"),
          aa: pick(inv, "aa"),
          inv_type: pick(inv, "invoiceType"),
          net: num(pick(inv, "totalNetValue")),
          vat: num(pick(inv, "totalVatAmount")),
          gross: num(pick(inv, "totalGrossValue")),
        };
        if (side === "expense") {
          row.supplier_vat = partyVat(inv, "issuer") || pick(inv, "vatNumber");
          row.supplier_name = await resolveAfm(row.supplier_vat);
        } else {
          row.counterparty_vat = partyVat(inv, "counterpart");
        }
        rows.push(row);
        try { const n = BigInt(mk); if (n > maxMark) maxMark = n; } catch { /* non-numeric mark */ }
      }
      if (rows.length) {
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "mark", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        added += rows.length;
      }
      if (maxMark <= cur) { done = true; break; }
      cur = maxMark;
    }
  } catch (e) {
    lastError = String(e?.message ?? e);
  }

  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  await supabase.from("fin_sync_state").update({
    last_mark: Number(cur), last_run: new Date().toISOString(),
    last_added: added, last_total: count ?? 0, last_error: lastError,
  }).eq("side", side);

  return { side, added, pages, done, lastMark: cur.toString(), total: count ?? 0, error: lastError };
}

// locate <invoice> nodes in the parsed myDATA response
function findInvoices(doc: any): any[] {
  let out: any[] = [];
  const walk = (o: any) => {
    if (o == null || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (k === "invoice") {
        out = out.concat(Array.isArray(o[k]) ? o[k] : [o[k]]);
      } else if (typeof o[k] === "object") walk(o[k]);
    }
  };
  walk(doc);
  return out;
}

Deno.serve(async (req) => {
  // simple guard: require the function secret (Supabase sends the anon/service JWT; cron uses service key)
  if (!USER_ID || !KEY) {
    return new Response(JSON.stringify({ error: "myDATA credentials not configured" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const url = new URL(req.url);
  const only = url.searchParams.get("side"); // optional: "income" | "expense"
  const results: any[] = [];
  if (only !== "expense") results.push(await syncSide("income"));
  if (only !== "income")  results.push(await syncSide("expense"));
  return new Response(JSON.stringify({ ok: true, results }, null, 2), { headers: { "content-type": "application/json" } });
});
