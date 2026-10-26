-- =====================================================================
-- Κρατήσεις v1.7 — Ειδοποιήσεις (push) στο προσωπικό για νέες / ακυρωμένες κρατήσεις
-- Τρέχει μία φορά (δεν σβήνει τίποτα). Τα κλειδιά μπαίνουν χωριστά στον πίνακα private.push_config.
-- =====================================================================
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ρυθμίσεις αποστολής (ιδιωτικό σχήμα — δεν φαίνεται από την εφαρμογή)
create table if not exists private.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text not null,
  vapid_private text not null,
  vapid_subject text not null,
  hook_secret   text not null,
  fn_url        text not null
);

-- ποιος έφτιαξε / άλλαξε τελευταίος την κράτηση (για να μην ειδοποιείται ο ίδιος)
alter table public.reservations add column if not exists created_by_uid uuid default auth.uid();
alter table public.reservations add column if not exists updated_by_uid uuid;

-- συσκευές που θέλουν ειδοποιήσεις
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  kinds      text[] not null default '{new,cancel}',
  device     text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists p_own_read on public.push_subs;
create policy p_own_read on public.push_subs for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.push_subs from anon, authenticated;

-- εγγραφή / διαγραφή συσκευής (η ίδια συσκευή περνάει στον χρήστη που συνδέθηκε τελευταίος)
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_kinds text[], p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Χωρίς πρόσβαση'; end if;
  insert into public.push_subs(endpoint, user_id, p256dh, auth, kinds, device)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(p_kinds, '{new,cancel}'), p_device)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    kinds = excluded.kinds, device = excluded.device, created_at = now();
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- για την edge function (μόνο service_role)
create or replace function public.push_get_config()
returns table(vapid_public text, vapid_private text, vapid_subject text, hook_secret text) language sql security definer set search_path = '' as $$
  select c.vapid_public, c.vapid_private, c.vapid_subject, c.hook_secret from private.push_config c where c.id = 1;
$$;

create or replace function public.push_targets(p_kind text, p_exclude uuid)
returns table(endpoint text, p256dh text, auth text) language sql security definer set search_path = '' as $$
  select s.endpoint, s.p256dh, s.auth from public.push_subs s
  join public.staff st on st.user_id = s.user_id and st.active
  where p_kind = any(s.kinds) and (p_exclude is null or s.user_id <> p_exclude);
$$;

create or replace function public.push_table_names(p_ids bigint[])
returns table(id bigint, name text) language sql security definer set search_path = '' as $$
  select t.id, t.name from public.res_tables t where t.id = any(p_ids) order by array_position(p_ids, t.id);
$$;

create or replace function public.push_forget(p_endpoints text[])
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subs where endpoint = any(p_endpoints);
$$;

revoke all on function public.push_subscribe(text, text, text, text[], text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text[], text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
revoke all on function public.push_get_config() from public, anon, authenticated;
revoke all on function public.push_targets(text, uuid) from public, anon, authenticated;
revoke all on function public.push_table_names(bigint[]) from public, anon, authenticated;
revoke all on function public.push_forget(text[]) from public, anon, authenticated;
grant execute on function public.push_get_config() to service_role;
grant execute on function public.push_targets(text, uuid) to service_role;
grant execute on function public.push_table_names(bigint[]) to service_role;
grant execute on function public.push_forget(text[]) to service_role;

-- trigger: νέα κράτηση ή ακύρωση → κλήση της edge function (ασύγχρονα, δεν καθυστερεί την αποθήκευση)
create or replace function private.res_mark_updater() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_by_uid := auth.uid(); return new; end $$;
drop trigger if exists res_mark_updater on public.reservations;
create trigger res_mark_updater before update on public.reservations for each row execute function private.res_mark_updater();

create or replace function private.res_push() returns trigger language plpgsql security definer set search_path = '' as $$
declare c private.push_config; k text; who uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'cancelled' then return new; end if;
    k := 'new'; who := new.created_by_uid;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    k := 'cancel'; who := new.updated_by_uid;
  else
    return new;
  end if;
  select * into c from private.push_config where id = 1;
  if c.fn_url is null then return new; end if;
  perform net.http_post(
    url := c.fn_url,
    body := jsonb_build_object('kind', k, 'record', to_jsonb(new), 'actor', who),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', c.hook_secret),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  return new;   -- ποτέ μην εμποδίσεις την αποθήκευση κράτησης λόγω ειδοποίησης
end $$;
drop trigger if exists res_push on public.reservations;
create trigger res_push after insert or update of status on public.reservations for each row execute function private.res_push();
