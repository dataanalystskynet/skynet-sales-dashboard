-- =====================================================================
--  SKYNET EXPRESS – 00-reset.sql   (RUN ONLY WHEN NEEDED)
--  Removes OLD / half-created dashboard tables, functions and triggers
--  (e.g. from an earlier attempt) so schema.sql can build them cleanly.
--
--  !! WARNING: deletes ALL dashboard data in the public schema
--     (shipments, profiles, permissions, targets, logs, settings).
--     Supabase Auth users (Authentication -> Users) are NOT deleted.
--  After this run:  schema.sql -> rls-policies.sql -> views.sql
-- =====================================================================

-- 1. triggers on auth.users created by the dashboard
drop trigger if exists on_auth_user_created       on auth.users;
drop trigger if exists on_auth_user_email_changed on auth.users;

-- 2. dashboard tables (CASCADE also removes their policies, indexes, FKs)
drop table if exists public.shipment_versions cascade;
drop table if exists public.shipments         cascade;
drop table if exists public.sales_targets     cascade;
drop table if exists public.import_logs       cascade;
drop table if exists public.audit_logs        cascade;
drop table if exists public.user_permissions  cascade;
drop table if exists public.app_settings      cascade;
drop table if exists public.exchange_rates    cascade;
drop table if exists public.profiles          cascade;

-- 3. every function in the public schema (this project is dedicated to the
--    dashboard; functions that belong to extensions are skipped)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

-- 4. old views (if any were created earlier)
do $$
declare r record;
begin
  for r in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('drop view if exists public.%I cascade', r.table_name);
  end loop;
end $$;

select 'Reset done – now run schema.sql, then rls-policies.sql, then views.sql' as next_step;
