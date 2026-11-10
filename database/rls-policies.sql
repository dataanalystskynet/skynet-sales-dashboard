-- =====================================================================
--  SKYNET EXPRESS – FILE 2 / 4 : rls-policies.sql
--  Permission helpers + Row Level Security + table privileges + storage
--
--  SECURITY MODEL (server-side, cannot be bypassed from the browser):
--   * Every table has RLS enabled.
--   * The browser roles (anon / authenticated) get NO direct privileges on
--     shipments, import, audit, targets or version tables. All business data
--     is read/written ONLY through SECURITY DEFINER functions (views.sql) that
--     check the caller's role, permissions and data scope on every call.
--     Calling /rest/v1/shipments directly therefore returns "permission denied".
--   * RLS policies are still defined as a second layer of defence.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role default permissions. Admin = super admin, always full access.
-- ---------------------------------------------------------------------
create or replace function public.default_permission(p_role text, p_key text)
returns text language sql immutable as $$
  select case
    when p_role = 'admin' then
      case when p_key in ('customer_visibility','shipment_visibility','salesperson_visibility') then 'all'
           when p_key like 'page\_%' then 'view' else 'allow' end
    when p_role = 'manager' then
      case when p_key in ('customer_visibility','shipment_visibility','salesperson_visibility') then 'assigned'
           when p_key like 'page\_%' then 'view'
           when p_key in ('excel_export','revenue_visibility','weight_visibility','hold_change') then 'allow'
           else 'deny' end
    when p_role = 'sales' then
      case when p_key in ('customer_visibility','shipment_visibility','salesperson_visibility') then 'own'
           when p_key in ('page_executive','page_customers','page_sales','page_shipments') then 'view'
           when p_key like 'page\_%' then 'hide'
           when p_key in ('excel_export','revenue_visibility','weight_visibility') then 'allow'
           else 'deny' end
    else case when p_key like 'page\_%' then 'hide'
              when p_key like '%visibility' and p_key not in ('revenue_visibility','weight_visibility') then 'own'
              else 'deny' end
  end
$$;

create or replace function public.permission_keys() returns text[]
language sql immutable as $$
  select array['page_executive','page_customers','page_sales','page_country','page_hub','page_shipments',
               'excel_import','excel_export','revenue_visibility','weight_visibility',
               'customer_visibility','shipment_visibility','salesperson_visibility',
               'user_management','target_management','audit_logs','hold_change','app_settings']
$$;

-- Effective permission of the CURRENT user (NULL if not logged in / inactive)
create or replace function public.get_perm(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select case when p.role = 'admin' then public.default_permission('admin', p_key)
              else coalesce(up.permission_value, public.default_permission(p.role, p_key)) end
  from public.profiles p
  left join public.user_permissions up on up.user_id = p.id and up.permission_key = p_key
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.perm_allows(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.get_perm(p_key) in ('allow','view','all','assigned','own'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

-- Effective data scope = MOST restrictive of the three visibility permissions
-- ('all' > 'assigned' > 'own'). Returns 'none' when not logged in / inactive.
create or replace function public.data_scope() returns text
language plpgsql stable security definer set search_path = public as $$
declare v int := 3; k text; val text;
begin
  if not public.is_active_user() then return 'none'; end if;
  if public.is_admin() then return 'all'; end if;
  foreach k in array array['shipment_visibility','customer_visibility','salesperson_visibility'] loop
    val := public.get_perm(k);
    v := least(v, case val when 'all' then 3 when 'assigned' then 2 when 'own' then 1 else 0 end);
  end loop;
  return case v when 3 then 'all' when 2 then 'assigned' when 1 then 'own' else 'none' end;
end $$;

-- Row-level visibility test for one shipment (used by RLS policies + detail RPC)
create or replace function public.can_see_shipment(p_salesperson text, p_hub text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; sc text;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.is_active then return false; end if;
  sc := public.data_scope();
  if sc = 'all' then return true; end if;
  if sc = 'assigned' then
    return (p_hub is not null and p_hub = any(p.assigned_hubs))
        or (p_salesperson is not null and (p_salesperson = any(p.team_salespersons)
                                        or p_salesperson = any(p.salesperson_names)));
  end if;
  if sc = 'own' then
    return p_salesperson is not null and p_salesperson = any(p.salesperson_names);
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------
-- ENABLE RLS ON EVERY TABLE
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.user_permissions  enable row level security;
alter table public.shipments         enable row level security;
alter table public.shipment_versions enable row level security;
alter table public.sales_targets     enable row level security;
alter table public.import_logs       enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.app_settings      enable row level security;
alter table public.exchange_rates    enable row level security;

-- profiles: read own row; admins / user managers read all. Writes only via RPC.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.perm_allows('user_management'));

-- user_permissions: read own; admin read all. Writes only via RPC.
drop policy if exists perms_select on public.user_permissions;
create policy perms_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.perm_allows('user_management'));

-- shipments: defence-in-depth policy (direct table access is also revoked below)
drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments for select to authenticated
  using (public.can_see_shipment(salesperson_name, origin_hub_code));
drop policy if exists shipments_write on public.shipments;
create policy shipments_write on public.shipments for all to authenticated
  using (public.perm_allows('excel_import')) with check (public.perm_allows('excel_import'));

drop policy if exists versions_admin on public.shipment_versions;
create policy versions_admin on public.shipment_versions for select to authenticated
  using (public.is_admin());

drop policy if exists targets_select on public.sales_targets;
create policy targets_select on public.sales_targets for select to authenticated
  using (public.perm_allows('target_management') or public.data_scope() = 'all'
         or salesperson_name = any(coalesce((select salesperson_names || team_salespersons from public.profiles where id = auth.uid()), '{}'::text[])));
drop policy if exists targets_write on public.sales_targets;
create policy targets_write on public.sales_targets for all to authenticated
  using (public.perm_allows('target_management')) with check (public.perm_allows('target_management'));

drop policy if exists import_logs_select on public.import_logs;
create policy import_logs_select on public.import_logs for select to authenticated
  using (uploaded_by = auth.uid() or public.is_admin() or public.perm_allows('audit_logs'));

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.perm_allows('audit_logs'));

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated
  using (public.is_active_user());
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated
  using (public.is_admin() or public.perm_allows('app_settings'))
  with check (public.is_admin() or public.perm_allows('app_settings'));

drop policy if exists fx_select on public.exchange_rates;
create policy fx_select on public.exchange_rates for select to authenticated
  using (public.is_active_user());
drop policy if exists fx_write on public.exchange_rates;
create policy fx_write on public.exchange_rates for all to authenticated
  using (public.is_admin() or public.perm_allows('app_settings'))
  with check (public.is_admin() or public.perm_allows('app_settings'));

-- ---------------------------------------------------------------------
-- TABLE PRIVILEGES – lock everything down, then open the minimum.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles, public.user_permissions,
               public.app_settings, public.exchange_rates to authenticated;
-- (shipments, shipment_versions, sales_targets, import_logs, audit_logs:
--  NO direct grants – only via SECURITY DEFINER functions in views.sql)

-- Make sure future tables are not auto-exposed by Supabase defaults
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------
-- STORAGE: avatars bucket (public read, each user writes own folder)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 2097152,
       allowed_mime_types = array['image/png','image/jpeg','image/webp'];

    execute 'drop policy if exists "avatar_read" on storage.objects';
    execute $p$create policy "avatar_read" on storage.objects for select
              using (bucket_id = 'avatars')$p$;
    execute 'drop policy if exists "avatar_insert_own" on storage.objects';
    execute $p$create policy "avatar_insert_own" on storage.objects for insert to authenticated
              with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists "avatar_update_own" on storage.objects';
    execute $p$create policy "avatar_update_own" on storage.objects for update to authenticated
              using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists "avatar_delete_own" on storage.objects';
    execute $p$create policy "avatar_delete_own" on storage.objects for delete to authenticated
              using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
