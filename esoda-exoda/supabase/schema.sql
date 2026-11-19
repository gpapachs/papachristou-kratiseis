-- ============================================================
--  ΕΣΟΔΑ–ΕΞΟΔΑ (myDATA) — Supabase schema
--  Single source of truth: AADE myDATA.
--  fin_income_docs  = εκροές  (RequestTransmittedDocs)
--  fin_expense_docs = εισροές (RequestDocs)
--  Financial data is NOT anon-readable: read requires an
--  authenticated session; only the Edge Function (service_role)
--  writes.
-- ============================================================

-- ---------- income (εκροές) ----------
create table if not exists public.fin_income_docs (
  mark              text primary key,
  uid               text,
  issue_date        date,
  series            text,
  aa                text,
  inv_type          text,                 -- myDATA invoiceType (e.g. 11.1, 11.2, 1.1). 8.6 = order slip, excluded from revenue
  net               numeric(14,2) default 0,
  vat               numeric(14,2) default 0,
  gross             numeric(14,2) default 0,
  counterparty_vat  text,                 -- customer ΑΦΜ (often empty for retail)
  synced_at         timestamptz not null default now()
);
create index if not exists fin_income_docs_issue_date_idx on public.fin_income_docs (issue_date);
create index if not exists fin_income_docs_inv_type_idx   on public.fin_income_docs (inv_type);

-- ---------- expenses (εισροές) ----------
create table if not exists public.fin_expense_docs (
  mark          text primary key,
  uid           text,
  issue_date    date,
  series        text,
  aa            text,
  inv_type      text,
  net           numeric(14,2) default 0,
  vat           numeric(14,2) default 0,
  gross         numeric(14,2) default 0,
  supplier_vat  text,                     -- issuer ΑΦΜ (ο προμηθευτής)
  supplier_name text,                     -- resolved from AADE registry (cached)
  synced_at     timestamptz not null default now()
);
create index if not exists fin_expense_docs_issue_date_idx   on public.fin_expense_docs (issue_date);
create index if not exists fin_expense_docs_supplier_vat_idx on public.fin_expense_docs (supplier_vat);

-- ---------- supplier name cache (ΑΦΜ → επωνυμία) ----------
create table if not exists public.fin_suppliers (
  vat        text primary key,
  name       text,
  updated_at timestamptz not null default now()
);

-- ---------- incremental sync state (per side) ----------
create table if not exists public.fin_sync_state (
  side       text primary key,            -- 'income' | 'expense'
  last_mark  bigint not null default 0,
  last_run   timestamptz,
  last_added integer default 0,
  last_total integer default 0,
  last_error text
);
insert into public.fin_sync_state (side) values ('income'), ('expense')
  on conflict (side) do nothing;

-- ============================================================
--  Row Level Security
--  - anon: NO access (financial data stays private)
--  - authenticated: read-only (single business; any logged-in
--    user of this app may read)
--  - writes: only via Edge Function using the service_role key,
--    which bypasses RLS
-- ============================================================
alter table public.fin_income_docs  enable row level security;
alter table public.fin_expense_docs enable row level security;
alter table public.fin_suppliers    enable row level security;
alter table public.fin_sync_state   enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='fin_income_docs' and policyname='income_read') then
    create policy income_read  on public.fin_income_docs  for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='fin_expense_docs' and policyname='expense_read') then
    create policy expense_read on public.fin_expense_docs for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='fin_suppliers' and policyname='suppliers_read') then
    create policy suppliers_read on public.fin_suppliers  for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='fin_sync_state' and policyname='sync_read') then
    create policy sync_read on public.fin_sync_state for select to authenticated using (true);
  end if;
end $$;

-- ============================================================
--  Convenience views for the dashboard
--  Revenue excludes invoiceType 8.6 (Δελτίο Παραγγελίας
--  Εστίασης) to avoid double-counting the sale.
-- ============================================================
create or replace view public.v_fin_income with (security_invoker = true) as
  select * from public.fin_income_docs where coalesce(inv_type,'') <> '8.6';

-- Monthly ΕΣΟΔΑ–ΕΞΟΔΑ–ΦΠΑ summary
create or replace view public.v_fin_monthly with (security_invoker = true) as
  select
    to_char(d.issue_date, 'YYYY-MM')                as ym,
    sum(case when d.side='income'  then d.net  else 0 end) as income_net,
    sum(case when d.side='income'  then d.vat  else 0 end) as income_vat,
    sum(case when d.side='expense' then d.net  else 0 end) as expense_net,
    sum(case when d.side='expense' then d.vat  else 0 end) as expense_vat
  from (
    select issue_date, net, vat, 'income'::text  as side from public.v_fin_income
    union all
    select issue_date, net, vat, 'expense'::text as side from public.fin_expense_docs
  ) d
  where d.issue_date is not null
  group by 1
  order by 1;
