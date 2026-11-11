-- =====================================================================
--  SKYNET EXPRESS INDIA PVT. LTD. – Sales & BI Dashboard
--  FILE 1 / 4 : schema.sql   (tables, constraints, indexes, triggers)
--  Run order : schema.sql -> rls-policies.sql -> views.sql -> (optional) seed-demo.sql
--  Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE everywhere.
-- =====================================================================

create extension if not exists pgcrypto;

-- Guard: stop with a clear message if OLD tables from an earlier attempt exist
do $$
declare bad text := '';
begin
  if to_regclass('public.audit_logs') is not null and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='audit_logs' and column_name='record_type') then bad := bad || ' audit_logs'; end if;
  if to_regclass('public.shipments') is not null and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='shipments' and column_name='raw_excel_data') then bad := bad || ' shipments'; end if;
  if to_regclass('public.profiles') is not null and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='profiles' and column_name='salesperson_names') then bad := bad || ' profiles'; end if;
  if to_regclass('public.import_logs') is not null and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='import_logs' and column_name='errors') then bad := bad || ' import_logs'; end if;
  if bad <> '' then
    raise exception 'OLD tables found from an earlier setup:%. Run database/00-reset.sql first, then schema.sql -> rls-policies.sql -> views.sql.', bad;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. PROFILES  (1 row per Supabase Auth user)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           text unique,                       -- optional "User ID" for login
  full_name          text not null default '',
  email              text,
  mobile             text,
  role               text not null default 'sales' check (role in ('admin','manager','sales')),
  assigned_hubs      text[] not null default '{}',      -- e.g. {DEL,BOM}  (manager hub scope)
  salesperson_names  text[] not null default '{}',      -- SALESMAN NAME value(s) this user IS
  team_salespersons  text[] not null default '{}',      -- salespersons a manager supervises
  avatar_url         text,
  is_active          boolean not null default true,
  preferences        jsonb not null default '{}'::jsonb, -- theme / mode etc.
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint username_format check (username is null or username ~ '^[a-z0-9._-]{3,40}$')
);

-- Login by mobile number: one mobile = one user (several users may share an e-mail)
create or replace function public.mobile_key(m text) returns text
language sql immutable set search_path = public as $$
  select nullif(right(regexp_replace(coalesce(m,''), '\D', '', 'g'), 10), '') $$;
-- Salesperson names compared without case / extra spaces ("abhilash " = "ABHILASH")
create or replace function public.sp_key(x text) returns text
language sql immutable set search_path = public as $$
  select nullif(upper(btrim(regexp_replace(coalesce(x,''), '\s+', ' ', 'g'))), '') $$;
create unique index if not exists profiles_mobile_key_uq on public.profiles (public.mobile_key(mobile))
  where public.mobile_key(mobile) is not null;

-- ---------------------------------------------------------------------
-- 2. USER PERMISSIONS  (overrides on top of role defaults)
-- ---------------------------------------------------------------------
create table if not exists public.user_permissions (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  permission_key    text not null,
  permission_value  text not null,
  updated_by        uuid references public.profiles(id) on delete set null,
  updated_at        timestamptz not null default now(),
  unique (user_id, permission_key),
  constraint perm_key_chk check (permission_key in (
    'page_executive','page_customers','page_sales','page_country','page_hub','page_shipments',
    'excel_import','excel_export','revenue_visibility','weight_visibility',
    'customer_visibility','shipment_visibility','salesperson_visibility',
    'user_management','target_management','audit_logs','hold_change','app_settings')),
  constraint perm_val_chk check (permission_value in ('view','hide','allow','deny','all','assigned','own'))
);

-- ---------------------------------------------------------------------
-- 3. IMPORT LOGS
-- ---------------------------------------------------------------------
create table if not exists public.import_logs (
  id                 bigint generated always as identity primary key,
  file_name          text not null,
  sheet_name         text,
  total_rows         integer not null default 0,
  new_records        integer not null default 0,
  updated_records    integer not null default 0,
  duplicate_records  integer not null default 0,   -- duplicate AWB rows inside the file
  failed_records     integer not null default 0,
  uploaded_by        uuid references public.profiles(id) on delete set null,
  uploaded_by_name   text,
  uploaded_at        timestamptz not null default now(),
  finished_at        timestamptz,
  status             text not null default 'running'
                     check (status in ('running','completed','partial','failed','rolled_back')),
  billing_currency   text not null default 'INR',
  errors             jsonb not null default '[]'::jsonb,   -- failed rows + reasons (capped)
  meta               jsonb not null default '{}'::jsonb,   -- header mapping, unmapped columns ...
  notes              text
);

-- ---------------------------------------------------------------------
-- 4. SHIPMENTS  (AWB NUMBER is the unique business key)
-- ---------------------------------------------------------------------
create table if not exists public.shipments (
  id                        bigint generated by default as identity primary key,
  awb_number                text not null,
  booking_date              date not null,                 -- Excel: CREATED DATE
  customer_name             text,
  customer_code             text,
  customer_type             text,
  shipper_city              text,
  shipper_state             text,
  shipper_country           text,
  destination_country       text,                          -- Excel: CONSIGNEE COUNTRY
  destination_city          text,
  service_name              text,
  vendor_name               text,
  product_name              text,
  awb_state                 text,
  entry_type                text,
  pcs                       integer,
  actual_weight             numeric(12,3),
  volumetric_weight         numeric(12,3),
  chargeable_weight         numeric(12,3) not null default 0,   -- CHARGEABLE WT.(KG.)
  shipment_value            numeric(16,2),                 -- declared value (NOT revenue)
  shipment_currency         text,                          -- currency of declared value
  customer_freight          numeric(14,2),
  customer_other_charges    numeric(14,2),
  sales_fsc_percent         numeric(8,3),
  customer_taxable_amount   numeric(14,2),
  customer_cgst             numeric(14,2),
  customer_sgst             numeric(14,2),
  customer_igst             numeric(14,2),
  customer_grand_total      numeric(14,2) not null default 0,   -- revenue in INR
  grand_total_original      numeric(14,2),                 -- as billed, before FX
  billing_currency          text not null default 'INR',
  fx_rate_to_inr            numeric(14,6) not null default 1,
  salesperson_name          text,                          -- NULL = Unassigned
  origin_hub_code           text,                          -- Excel: "ORIGIN HUB CODE\n"
  is_hold                   boolean not null default false,-- Excel: IS HOLD?
  hold_remarks              text,
  data_quality_flags        text[] not null default '{}',  -- e.g. {GRAND_TOTAL_BLANK,SALESMAN_BLANK}
  raw_excel_data            jsonb not null default '{}'::jsonb, -- ALL 74 original columns
  first_import_id           bigint references public.import_logs(id) on delete set null,
  last_import_id            bigint references public.import_logs(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint shipments_awb_unique unique (awb_number),
  constraint awb_not_blank check (length(trim(awb_number)) > 0),
  constraint weight_non_negative check (chargeable_weight >= 0)
);

create index if not exists idx_ship_booking_date   on public.shipments (booking_date);
create index if not exists idx_ship_awb_pattern    on public.shipments (awb_number text_pattern_ops);
create index if not exists idx_ship_customer_code  on public.shipments (customer_code);
create index if not exists idx_ship_customer_name  on public.shipments (customer_name);
create index if not exists idx_ship_salesperson    on public.shipments (salesperson_name);
create index if not exists idx_ship_origin_hub     on public.shipments (origin_hub_code);
create index if not exists idx_ship_dest_country   on public.shipments (destination_country);
create index if not exists idx_ship_is_hold        on public.shipments (is_hold);
create index if not exists idx_ship_awb_state      on public.shipments (awb_state);
create index if not exists idx_ship_date_hub       on public.shipments (booking_date, origin_hub_code);
create index if not exists idx_ship_date_sales     on public.shipments (booking_date, salesperson_name);
create index if not exists idx_ship_last_import    on public.shipments (last_import_id);

-- ---------------------------------------------------------------------
-- 5. SHIPMENT VERSIONS  (before-image of every row an import updates
--    -> used by import_rollback() as the recovery strategy)
-- ---------------------------------------------------------------------
create table if not exists public.shipment_versions (
  id           bigint generated always as identity primary key,
  import_id    bigint not null references public.import_logs(id) on delete cascade,
  awb_number   text not null,
  old_row      jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_versions_import on public.shipment_versions (import_id, awb_number);

-- ---------------------------------------------------------------------
-- 6. SALES TARGETS  (no default target is ever assumed)
-- ---------------------------------------------------------------------
create table if not exists public.sales_targets (
  id                bigint generated always as identity primary key,
  salesperson_name  text not null,
  target_month      date not null check (extract(day from target_month) = 1),
  revenue_target    numeric(16,2) check (revenue_target is null or revenue_target >= 0),
  awb_target        integer       check (awb_target is null or awb_target >= 0),
  weight_target     numeric(14,3) check (weight_target is null or weight_target >= 0),
  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (salesperson_name, target_month)
);

-- ---------------------------------------------------------------------
-- 7. AUDIT LOGS
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete set null,
  user_name    text,
  action       text not null,          -- HOLD_STATUS_CHANGE, IMPORT, USER_UPDATE ...
  record_type  text,                   -- shipment / user / target / import / setting
  record_id    text,                   -- AWB number, user id ...
  old_value    jsonb,
  new_value    jsonb,
  remarks      text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_record  on public.audit_logs (record_type, record_id);
create index if not exists idx_audit_action  on public.audit_logs (action);

-- ---------------------------------------------------------------------
-- 8. APP SETTINGS  +  EXCHANGE RATES
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.exchange_rates (
  currency        text primary key check (currency ~ '^[A-Z]{3}$'),
  rate_to_inr     numeric(14,6) not null check (rate_to_inr > 0),
  effective_date  date not null default current_date,
  approved_by     text,
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

insert into public.app_settings(key, value) values
  ('company_name',            '"SKYNET EXPRESS INDIA PVT. LTD."'),
  ('billing_currency',        '"INR"'),
  ('session_timeout_minutes', '30'),
  ('default_page_size',       '25'),
  ('allow_username_login',    'true'),
  ('import_batch_size',       '500'),
  ('field_mappings',          '{}')
on conflict (key) do nothing;

insert into public.exchange_rates(currency, rate_to_inr, approved_by)
values ('INR', 1, 'system') on conflict (currency) do nothing;

-- ---------------------------------------------------------------------
-- 9. TRIGGERS
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();
drop trigger if exists trg_shipments_updated on public.shipments;
create trigger trg_shipments_updated before update on public.shipments
  for each row execute function public.tg_set_updated_at();
drop trigger if exists trg_targets_updated on public.sales_targets;
create trigger trg_targets_updated before update on public.sales_targets
  for each row execute function public.tg_set_updated_at();

-- New auth user -> profile row.  Role comes ONLY from app_metadata
-- (which only the service role / admin Edge Function can set), never
-- from user-editable user_metadata. Default role = sales with no
-- salesperson mapping => sees no data until an admin maps them.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(new.raw_app_meta_data->>'role', 'sales');
begin
  if v_role not in ('admin','manager','sales') then v_role := 'sales'; end if;
  insert into public.profiles (id, email, full_name, role, username)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
          v_role,
          nullif(lower(new.raw_app_meta_data->>'username'),''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile e-mail in sync after a confirmed e-mail change
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();
