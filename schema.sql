-- =====================================================================
--  Κρατήσεις — Ψητοπωλείο Παπαχρήστου
--  Τρέξε ΟΛΟ αυτό το αρχείο μία φορά στο Supabase → SQL Editor → Run.
--  Είναι ασφαλές να ξανατρέξει (δεν σβήνει δεδομένα).
-- =====================================================================

-- ---------- Τραπέζια ----------
create table if not exists public.res_tables (
  id          bigint generated always as identity primary key,
  name        text    not null,              -- π.χ. "Μ1", "Ε12"
  area        text    not null default 'mesa' check (area in ('mesa','exo')),
  seats       int     not null default 4 check (seats > 0),
  active      boolean not null default true,
  sort        int     not null default 0
);

-- ---------- Ρυθμίσεις (μία γραμμή, id = 1) ----------
create table if not exists public.res_settings (
  id    int primary key default 1 check (id = 1),
  data  jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.res_settings (id, data) values (1, '{
  "shop_name": "Ψητοπωλείο Παπαχρήστου",
  "shop_phone": "",
  "slot_minutes": 30,
  "duration_minutes": 120,
  "max_covers_per_slot": 60,
  "max_party_size": 20,
  "hours": {
    "1": [{"open":"18:00","close":"23:30"}],
    "2": [{"open":"18:00","close":"23:30"}],
    "3": [{"open":"18:00","close":"23:30"}],
    "4": [{"open":"18:00","close":"23:30"}],
    "5": [{"open":"13:00","close":"16:30"},{"open":"18:00","close":"00:00"}],
    "6": [{"open":"13:00","close":"16:30"},{"open":"18:00","close":"00:00"}],
    "0": [{"open":"13:00","close":"17:00"}]
  },
  "tpl_confirm": "Γεια σας {ονομα}! Η κράτησή σας στο {καταστημα} για {ατομα} άτομα, {ημερα} {ημερομηνια} στις {ωρα}, επιβεβαιώθηκε. Για αλλαγές: {τηλεφωνο}.",
  "tpl_reminder": "Καλησπέρα {ονομα}! Σας θυμίζουμε την κράτησή σας στο {καταστημα} {ημερα} {ημερομηνια} στις {ωρα} για {ατομα} άτομα. Σας περιμένουμε!",
  "tpl_cancel": "Γεια σας {ονομα}. Η κράτησή σας στο {καταστημα} για {ημερα} {ημερομηνια} στις {ωρα} ακυρώθηκε. Για νέα κράτηση: {τηλεφωνο}."
}'::jsonb)
on conflict (id) do nothing;

-- ---------- Κλειστές ημέρες / αργίες ----------
create table if not exists public.res_closures (
  day   date primary key,
  note  text
);

-- ---------- Κρατήσεις ----------
create table if not exists public.reservations (
  id               bigint generated always as identity primary key,
  res_date         date    not null,
  res_time         time    not null,
  duration_min     int     not null default 120,
  party_size       int     not null check (party_size > 0),
  name             text    not null,
  phone            text,
  email            text,
  area_pref        text    not null default 'any' check (area_pref in ('any','mesa','exo')),
  table_ids        bigint[] not null default '{}',
  status           text    not null default 'confirmed'
                   check (status in ('confirmed','seated','done','cancelled','noshow')),
  notes            text,
  confirm_sent_at  timestamptz,
  reminder_sent_at timestamptz,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now()
);

create index if not exists reservations_date_idx  on public.reservations (res_date, res_time);
create index if not exists reservations_phone_idx on public.reservations (phone);

create or replace function public.res_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists reservations_touch on public.reservations;
create trigger reservations_touch before update on public.reservations
  for each row execute function public.res_touch();

-- ---------- v1.2: Χώροι & κάτοψη ----------
create table if not exists public.res_areas (
  id      bigint generated always as identity primary key,
  name    text not null,
  sort    int  not null default 0,
  width   int  not null default 1000,
  height  int  not null default 700,
  decor   jsonb not null default '[]'::jsonb   -- τοίχοι, μπαρ, πόρτες, φυτά, ζώνες, κείμενα
);

alter table public.res_tables add column if not exists area_id bigint references public.res_areas(id) on delete set null;
alter table public.res_tables add column if not exists x     int;
alter table public.res_tables add column if not exists y     int;
alter table public.res_tables add column if not exists w     int  not null default 80;
alter table public.res_tables add column if not exists h     int  not null default 80;
alter table public.res_tables add column if not exists shape text not null default 'rect';
alter table public.res_tables add column if not exists rot   int  not null default 0;
alter table public.res_tables drop constraint if exists res_tables_area_check;
alter table public.reservations drop constraint if exists reservations_area_pref_check;
create index if not exists res_tables_area_idx on public.res_tables (area_id);

-- Αρχικοί χώροι "Μέσα"/"Έξω" (μόνο αν δεν υπάρχει κανένας) και αντιστοίχιση παλιών τραπεζιών
insert into public.res_areas (name, sort)
select v.name, v.sort from (values ('Μέσα', 1), ('Έξω', 2)) as v(name, sort)
where not exists (select 1 from public.res_areas);

update public.res_tables t set area_id = a.id
from public.res_areas a
where t.area_id is null
  and ((t.area = 'mesa' and a.name = 'Μέσα') or (t.area = 'exo' and a.name = 'Έξω'));

update public.reservations r set area_pref = a.id::text
from public.res_areas a
where (r.area_pref = 'mesa' and a.name = 'Μέσα') or (r.area_pref = 'exo' and a.name = 'Έξω');

-- ---------- v1.4: Χρήστες & ρόλοι ----------
-- Σύνδεση με όνομα χρήστη: εσωτερικά γίνεται email <όνομα>@staff.kratiseis.app (δεν στέλνεται ποτέ email).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique,
  display_name text not null,
  role         text not null default 'staff' check (role in ('admin','staff')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and active and role = 'admin');
$$;

-- εσωτερική: φτιάχνει λογαριασμό στο Supabase Auth + γραμμή στο staff
create or replace function public._staff_create(p_username text, p_password text, p_display text, p_role text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_user  text := lower(trim(p_username));
  v_email text;
  v_id    uuid := gen_random_uuid();
begin
  if v_user !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Το όνομα χρήστη θέλει 3–30 λατινικούς χαρακτήρες, αριθμούς ή . _ -';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες'; end if;
  if coalesce(trim(p_display), '') = '' then raise exception 'Συμπλήρωσε όνομα'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'Άγνωστος ρόλος'; end if;
  v_email := v_user || '@staff.kratiseis.app';
  if exists (select 1 from public.staff where username = v_user) or exists (select 1 from auth.users where email = v_email) then
    raise exception 'Το όνομα χρήστη «%» υπάρχει ήδη', v_user;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', trim(p_display)),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now());

  insert into public.staff (user_id, username, display_name, role) values (v_id, v_user, trim(p_display), p_role);
  return v_id;
end $$;

-- πρώτος διαχειριστής: τρέχει ΜΟΝΟ από το SQL Editor (βλ. τέλος αρχείου)
create or replace function public.admin_bootstrap(p_username text, p_password text, p_display text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.staff where role = 'admin') then
    raise exception 'Υπάρχει ήδη διαχειριστής — πρόσθεσε χρήστες μέσα από την εφαρμογή';
  end if;
  return public._staff_create(p_username, p_password, p_display, 'admin');
end $$;

create or replace function public.admin_create_user(p_username text, p_password text, p_display text, p_role text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Μόνο ο διαχειριστής μπορεί να προσθέσει χρήστες'; end if;
  return public._staff_create(p_username, p_password, p_display, p_role);
end $$;

create or replace function public.admin_update_user(p_user uuid, p_username text, p_display text, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_user text := lower(trim(p_username)); v_email text;
begin
  if not public.is_admin() then raise exception 'Μόνο ο διαχειριστής μπορεί να αλλάξει χρήστες'; end if;
  if v_user !~ '^[a-z0-9._-]{3,30}$' then raise exception 'Το όνομα χρήστη θέλει 3–30 λατινικούς χαρακτήρες, αριθμούς ή . _ -'; end if;
  if coalesce(trim(p_display), '') = '' then raise exception 'Συμπλήρωσε όνομα'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'Άγνωστος ρόλος'; end if;
  if exists (select 1 from public.staff where username = v_user and user_id <> p_user) then
    raise exception 'Το όνομα χρήστη «%» υπάρχει ήδη', v_user;
  end if;
  if p_user = auth.uid() and (p_role <> 'admin' or not p_active) then
    raise exception 'Δεν μπορείς να αφαιρέσεις τα δικαιώματα διαχειριστή από τον εαυτό σου';
  end if;
  update public.staff set username = v_user, display_name = trim(p_display), role = p_role, active = p_active where user_id = p_user;
  if not found then raise exception 'Ο χρήστης δεν βρέθηκε'; end if;
  v_email := v_user || '@staff.kratiseis.app';
  update auth.users set email = v_email, updated_at = now(),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', trim(p_display))
    where id = p_user and email is distinct from v_email and email like '%@staff.kratiseis.app';
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email)
    where user_id = p_user and provider = 'email';
  -- όταν απενεργοποιείται, κλείνουν οι ανοιχτές συνδέσεις του
  if not p_active then
    begin
      delete from auth.refresh_tokens where user_id = p_user::text;
    exception when undefined_table then null;
    end;
  end if;
end $$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then raise exception 'Μόνο ο διαχειριστής μπορεί να αλλάξει κωδικούς'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Ο χρήστης δεν βρέθηκε'; end if;
end $$;

create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Μόνο ο διαχειριστής μπορεί να διαγράψει χρήστες'; end if;
  if p_user = auth.uid() then raise exception 'Δεν μπορείς να διαγράψεις τον εαυτό σου'; end if;
  delete from auth.users where id = p_user;
end $$;

-- δικαιώματα εκτέλεσης
revoke all on function public._staff_create(text, text, text, text) from public;
revoke all on function public.admin_bootstrap(text, text, text) from public;
revoke all on function public.admin_create_user(text, text, text, text) from public;
revoke all on function public.admin_update_user(uuid, text, text, text, boolean) from public;
revoke all on function public.admin_set_password(uuid, text) from public;
revoke all on function public.admin_delete_user(uuid) from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
do $$ begin
  execute 'revoke all on function public.admin_create_user(text, text, text, text), public.admin_update_user(uuid, text, text, text, boolean), public.admin_set_password(uuid, text), public.admin_delete_user(uuid), public.is_staff(), public.is_admin() from anon';
exception when undefined_object then null;
end $$;
do $$ begin
  execute 'revoke all on function public._staff_create(text, text, text, text) from anon, authenticated';
  execute 'revoke all on function public.admin_bootstrap(text, text, text) from anon, authenticated';
  execute 'grant execute on function public.admin_create_user(text, text, text, text) to authenticated';
  execute 'grant execute on function public.admin_update_user(uuid, text, text, text, boolean) to authenticated';
  execute 'grant execute on function public.admin_set_password(uuid, text) to authenticated';
  execute 'grant execute on function public.admin_delete_user(uuid) to authenticated';
  execute 'grant execute on function public.is_staff() to authenticated';
  execute 'grant execute on function public.is_admin() to authenticated';
exception when undefined_object then null;
end $$;

-- ---------- Ασφάλεια ----------
-- Προσωπικό: βλέπει τα πάντα, γράφει κρατήσεις.  Διαχειριστής: γράφει και ρυθμίσεις, χώρους, τραπέζια, αργίες.
alter table public.res_areas     enable row level security;
alter table public.res_tables    enable row level security;
alter table public.res_settings  enable row level security;
alter table public.res_closures  enable row level security;
alter table public.reservations  enable row level security;
alter table public.staff         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['res_areas','res_tables','res_settings','res_closures','reservations','staff'] loop
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('drop policy if exists p_read on public.%I', t);
    execute format('drop policy if exists p_write on public.%I', t);
    execute format('drop policy if exists p_update on public.%I', t);
    execute format('drop policy if exists p_delete on public.%I', t);
    execute format('create policy p_read on public.%I for select to authenticated using ((select public.is_staff()))', t);
  end loop;
  foreach t in array array['res_areas','res_tables','res_settings','res_closures'] loop
    execute format('create policy p_write on public.%I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy p_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy p_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
  execute 'create policy p_write on public.reservations for insert to authenticated with check ((select public.is_staff()))';
  execute 'create policy p_update on public.reservations for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))';
  execute 'create policy p_delete on public.reservations for delete to authenticated using ((select public.is_staff()))';
end $$;

-- Πρόσβαση μέσω API μόνο για συνδεδεμένους (οι κανόνες από πάνω αποφασίζουν τι βλέπει ο καθένας)
do $$ begin
  execute 'grant usage on schema public to authenticated';
  execute 'grant select, insert, update, delete on public.res_areas, public.res_tables, public.res_settings, public.res_closures, public.reservations to authenticated';
  execute 'grant select on public.staff to authenticated';
  execute 'grant usage, select on all sequences in schema public to authenticated';
  execute 'revoke all on public.res_areas, public.res_tables, public.res_settings, public.res_closures, public.reservations, public.staff from anon';
exception when undefined_object then null;
end $$;

-- ---------- Ζωντανός συγχρονισμός (ταμεία + κινητά) ----------
do $$
declare t text;
begin
  foreach t in array array['res_areas','res_tables','res_settings','res_closures','reservations'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Αρχικά τραπέζια (μόνο αν δεν υπάρχει κανένα) ----------
-- 20 στον χώρο "Μέσα" (Μ1–Μ20) και 15 στον χώρο "Έξω" (Ε1–Ε15).
-- Τις θέσεις τους στην κάτοψη τις ορίζεις από την εφαρμογή (Κάτοψη → Επεξεργασία).
insert into public.res_tables (name, area, area_id, seats, sort)
select 'Μ' || g, 'mesa', (select id from public.res_areas where name = 'Μέσα' limit 1), 4, g
from generate_series(1,20) g
where not exists (select 1 from public.res_tables);
insert into public.res_tables (name, area, area_id, seats, sort)
select 'Ε' || g, 'exo', (select id from public.res_areas where name = 'Έξω' limit 1), 4, 100 + g
from generate_series(1,15) g
where (select count(*) from public.res_tables) = 20
  and not exists (select 1 from public.res_tables where name = 'Ε1');

-- =====================================================================
--  ΠΡΩΤΟΣ ΔΙΑΧΕΙΡΙΣΤΗΣ (μία φορά, μετά το παραπάνω):
--  άλλαξε όνομα χρήστη / κωδικό / όνομα και τρέξε ΜΟΝΟ αυτή τη γραμμή (χωρίς τα -- μπροστά):
--
--  select public.admin_bootstrap('giorgos', 'ΒΑΛΕ-ΕΔΩ-ΚΩΔΙΚΟ', 'Γιώργος');
--
--  Τους υπόλοιπους χρήστες τους φτιάχνεις μέσα από την εφαρμογή: Ρυθμίσεις → Χρήστες.
-- =====================================================================
