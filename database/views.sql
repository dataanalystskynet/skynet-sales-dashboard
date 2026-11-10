-- =====================================================================
--  SKYNET EXPRESS – FILE 3 / 4 : views.sql
--  Secure aggregation functions (RPC) used by the dashboard.
--  Every function is SECURITY DEFINER and enforces:
--     active user  ->  page/feature permission  ->  data scope (all/assigned/own)
--     -> revenue / weight visibility masking
--  All totals are computed in the database over the FULL filtered data set,
--  never from the currently loaded table page.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Small helpers
-- ---------------------------------------------------------------------
create or replace function public.assert_active() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Not authorised: login required or account inactive' using errcode = '42501';
  end if;
end $$;

create or replace function public.assert_perm(p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_active();
  if not public.perm_allows(p_key) then
    raise exception 'Not authorised: missing permission %', p_key using errcode = '42501';
  end if;
end $$;

create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name,''), email, 'system') from public.profiles where id = auth.uid()
$$;

create or replace function public.yes_no(b boolean) returns text
language sql immutable as $$ select case when b then 'YES' else 'NO' end $$;

-- ---------------------------------------------------------------------
-- 1. scoped_shipments(filters)  – THE single gate for reading shipments
--    filters jsonb keys (all optional):
--      from, to (YYYY-MM-DD), hub, customer_name, customer_code,
--      salesperson ('__UNASSIGNED__' = blank), country, hold ('YES'/'NO'),
--      awb_state, service, search (AWB prefix / customer text)
-- ---------------------------------------------------------------------
create or replace function public.scoped_shipments(f jsonb default '{}'::jsonb)
returns table (
  awb_number text, booking_date date, customer_name text, customer_code text,
  shipper_city text, shipper_state text, destination_country text, service_name text,
  awb_state text, entry_type text, pcs integer, chargeable_weight numeric,
  revenue numeric, salesperson_name text, origin_hub_code text, is_hold boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  p public.profiles; sc text; v_all boolean := false;
  v_hubs text[] := '{}'; v_sales text[] := '{}';
  v_rev boolean; v_wt boolean;
  v_from date := nullif(f->>'from','')::date;
  v_to   date := nullif(f->>'to','')::date;
  v_hub text := nullif(f->>'hub',''); v_cname text := nullif(f->>'customer_name','');
  v_ccode text := nullif(f->>'customer_code',''); v_sp text := nullif(f->>'salesperson','');
  v_country text := nullif(f->>'country',''); v_hold text := upper(nullif(f->>'hold',''));
  v_state text := nullif(f->>'awb_state',''); v_service text := nullif(f->>'service','');
  v_search text := nullif(trim(coalesce(f->>'search','')),'');
begin
  select * into p from public.profiles pr where pr.id = auth.uid();
  if not found or not p.is_active then return; end if;
  sc := public.data_scope();
  if sc = 'all' then v_all := true;
  elsif sc = 'assigned' then v_hubs := p.assigned_hubs; v_sales := p.team_salespersons || p.salesperson_names;
  elsif sc = 'own' then v_sales := p.salesperson_names;
  else return; end if;
  v_rev := public.perm_allows('revenue_visibility');
  v_wt  := public.perm_allows('weight_visibility');
  if v_hold not in ('YES','NO') then v_hold := null; end if;
  if v_search is not null then v_search := replace(replace(replace(v_search,'\','\\'),'%','\%'),'_','\_'); end if;

  return query
  select s.awb_number, s.booking_date, s.customer_name, s.customer_code,
         s.shipper_city, s.shipper_state, s.destination_country, s.service_name,
         s.awb_state, s.entry_type, s.pcs,
         case when v_wt  then s.chargeable_weight end,
         case when v_rev then s.customer_grand_total end,
         s.salesperson_name, s.origin_hub_code, s.is_hold
  from public.shipments s
  where (v_all or s.origin_hub_code = any(v_hubs) or s.salesperson_name = any(v_sales))
    and (v_from is null or s.booking_date >= v_from)
    and (v_to   is null or s.booking_date <= v_to)
    and (v_hub is null or s.origin_hub_code = v_hub)
    and (v_cname is null or s.customer_name = v_cname)
    and (v_ccode is null or s.customer_code = v_ccode)
    and (v_sp is null or (v_sp = '__UNASSIGNED__' and s.salesperson_name is null) or s.salesperson_name = v_sp)
    and (v_country is null or s.destination_country = v_country)
    and (v_hold is null or s.is_hold = (v_hold = 'YES'))
    and (v_state is null or s.awb_state = v_state)
    and (v_service is null or s.service_name = v_service)
    and (v_search is null or s.awb_number ilike v_search || '%'
         or s.customer_name ilike '%' || v_search || '%' or s.customer_code ilike v_search || '%');
end $$;

-- Resolve date range + equivalent previous period
create or replace function public.resolve_range(f jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date := nullif(f->>'from','')::date; v_to date := nullif(f->>'to','')::date; d1 date; d2 date; n int;
begin
  if v_from is null or v_to is null then
    select min(booking_date), max(booking_date) into d1, d2 from public.scoped_shipments(f - 'from' - 'to');
    v_from := coalesce(v_from, d1, current_date); v_to := coalesce(v_to, d2, current_date);
  end if;
  if v_to < v_from then raise exception 'End date is before start date' using errcode = '22023'; end if;
  n := (v_to - v_from) + 1;
  return jsonb_build_object('from', v_from, 'to', v_to, 'days', n,
                            'prev_from', v_from - n, 'prev_to', v_from - 1);
end $$;

-- ---------------------------------------------------------------------
-- 2. Session context
-- ---------------------------------------------------------------------
create or replace function public.get_my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; perms jsonb := '{}'::jsonb; k text;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found' using errcode = '42501'; end if;
  if p.is_active then
    foreach k in array public.permission_keys() loop
      perms := perms || jsonb_build_object(k, public.get_perm(k));
    end loop;
  end if;
  return jsonb_build_object('profile', to_jsonb(p), 'permissions', perms,
                            'scope', public.data_scope(), 'server_time', now());
end $$;

create or replace function public.touch_last_login() returns void
language sql volatile security definer set search_path = public as $$
  update public.profiles set last_login_at = now() where id = auth.uid();
$$;

-- Username ("User ID") -> e-mail for login. Callable by anon.
create or replace function public.email_for_login(p_login text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_login is null or position('@' in p_login) > 0 then return p_login; end if;
  if coalesce((select value::text from public.app_settings where key = 'allow_username_login'),'true') <> 'true' then
    return null;
  end if;
  select email into v from public.profiles where username = lower(trim(p_login)) and is_active;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. Filter dropdown values (dynamic – nothing hard-coded)
-- ---------------------------------------------------------------------
create or replace function public.get_filter_options() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_active();
  with s as materialized (select * from public.scoped_shipments('{}'::jsonb))
  select jsonb_build_object(
    'hubs',        coalesce((select jsonb_agg(x order by x) from (select distinct origin_hub_code x from s where origin_hub_code is not null) t),'[]'),
    'salespersons',coalesce((select jsonb_agg(x order by x) from (select distinct salesperson_name x from s where salesperson_name is not null) t),'[]'),
    'has_unassigned', exists(select 1 from s where salesperson_name is null),
    'countries',   coalesce((select jsonb_agg(x order by x) from (select distinct destination_country x from s where destination_country is not null) t),'[]'),
    'awb_states',  coalesce((select jsonb_agg(x order by x) from (select distinct awb_state x from s where awb_state is not null) t),'[]'),
    'services',    coalesce((select jsonb_agg(x order by x) from (select distinct service_name x from s where service_name is not null) t),'[]'),
    'customers',   coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name) order by name)
                              from (select customer_code code, max(customer_name) name from s group by customer_code) t),'[]'),
    'min_date', (select min(booking_date) from s),
    'max_date', (select max(booking_date) from s)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 4. EXECUTIVE DASHBOARD
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; rf jsonb; cf jsonb; pf jsonb;
begin
  perform public.assert_perm('page_executive');
  rf := public.resolve_range(f);
  cf := f || jsonb_build_object('from', rf->>'from', 'to', rf->>'to');
  pf := f || jsonb_build_object('from', rf->>'prev_from', 'to', rf->>'prev_to');
  with s as materialized (select * from public.scoped_shipments(cf)),
       p as materialized (select * from public.scoped_shipments(pf)),
       c as (select customer_code code, max(customer_name) name, count(*) awb,
                    sum(chargeable_weight) wt, sum(revenue) rev from s group by customer_code),
       sp as (select coalesce(salesperson_name,'Unassigned') name, count(*) awb,
                     sum(chargeable_weight) wt, sum(revenue) rev from s group by 1)
  select jsonb_build_object(
    'range', rf,
    'flags', jsonb_build_object('revenue', public.perm_allows('revenue_visibility'),
                                'weight',  public.perm_allows('weight_visibility')),
    'kpi', (select jsonb_build_object(
        'awb', count(*), 'weight', sum(chargeable_weight), 'revenue', sum(revenue),
        'customers', count(distinct customer_code), 'salespersons', count(distinct salesperson_name),
        'hold', count(*) filter (where is_hold), 'unhold', count(*) filter (where not is_hold),
        'hold_weight', coalesce(sum(chargeable_weight) filter (where is_hold),0),
        'unhold_weight', coalesce(sum(chargeable_weight) filter (where not is_hold),0),
        'hold_revenue', coalesce(sum(revenue) filter (where is_hold),0),
        'unhold_revenue', coalesce(sum(revenue) filter (where not is_hold),0),
        'unassigned', count(*) filter (where salesperson_name is null),
        'zero_revenue', count(*) filter (where revenue = 0)) from s),
    'prev_kpi', (select jsonb_build_object('awb', count(*), 'weight', sum(chargeable_weight),
        'revenue', sum(revenue), 'customers', count(distinct customer_code)) from p),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'awb',awb,'wt',wt,'rev',rev) order by d)
        from (select booking_date d, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev from s group by 1) x),'[]'),
    'prev_daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'awb',awb,'wt',wt,'rev',rev) order by d)
        from (select booking_date d, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev from p group by 1) x),'[]'),
    'top_customers', jsonb_build_object(
        'by_revenue', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from c order by rev desc nulls last, awb desc limit 10) t),'[]'),
        'by_awb',     coalesce((select jsonb_agg(to_jsonb(t)) from (select * from c order by awb desc limit 10) t),'[]'),
        'by_weight',  coalesce((select jsonb_agg(to_jsonb(t)) from (select * from c order by wt desc nulls last, awb desc limit 10) t),'[]')),
    'top_sales', jsonb_build_object(
        'by_revenue', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from sp order by rev desc nulls last, awb desc limit 10) t),'[]'),
        'by_awb',     coalesce((select jsonb_agg(to_jsonb(t)) from (select * from sp order by awb desc limit 10) t),'[]'),
        'by_weight',  coalesce((select jsonb_agg(to_jsonb(t)) from (select * from sp order by wt desc nulls last, awb desc limit 10) t),'[]')),
    'services', coalesce((select jsonb_agg(to_jsonb(t)) from (select service_name name, count(*) awb, sum(revenue) rev
        from s group by 1 order by 2 desc limit 12) t),'[]'),
    'awb_states', coalesce((select jsonb_agg(to_jsonb(t)) from (select awb_state name, count(*) awb from s group by 1 order by 2 desc) t),'[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 5. CUSTOMER ANALYSIS
-- ---------------------------------------------------------------------
create or replace function public.get_customer_analysis(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; rf jsonb; cf jsonb; pf jsonb; v_from date;
begin
  perform public.assert_perm('page_customers');
  rf := public.resolve_range(f); v_from := (rf->>'from')::date;
  cf := f || jsonb_build_object('from', rf->>'from', 'to', rf->>'to');
  pf := f || jsonb_build_object('from', rf->>'prev_from', 'to', rf->>'prev_to');
  with s as materialized (select * from public.scoped_shipments(cf)),
       p as (select customer_code, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev
               from public.scoped_shipments(pf) group by 1),
       life as (select customer_code, min(booking_date) first_date
               from public.scoped_shipments(f - 'from' - 'to') group by 1),
       c as materialized (
         select s.customer_code code, max(s.customer_name) name, count(*) awb,
                sum(s.chargeable_weight) wt, sum(s.revenue) rev,
                min(s.booking_date) first_in_range, max(s.booking_date) last_in_range,
                count(distinct s.booking_date) active_days,
                max(p.awb) prev_awb, max(p.wt) prev_wt, max(p.rev) prev_rev,
                max(l.first_date) lifetime_first,
                (max(l.first_date) >= v_from) is_new
         from s left join p on p.customer_code = s.customer_code
                left join life l on l.customer_code = s.customer_code
         group by s.customer_code),
       top5 as (select code from c order by rev desc nulls last, awb desc limit 5)
  select jsonb_build_object(
    'range', rf,
    'flags', jsonb_build_object('revenue', public.perm_allows('revenue_visibility'),
                                'weight',  public.perm_allows('weight_visibility')),
    'kpi', (select jsonb_build_object('active', count(*), 'awb', sum(awb), 'weight', sum(wt),
              'revenue', sum(rev), 'avg_revenue', case when count(*) > 0 then sum(rev)/count(*) end,
              'new_customers', count(*) filter (where is_new), 'returning', count(*) filter (where not is_new),
              'prev_active', (select count(*) from p)) from c),
    'customers', coalesce((select jsonb_agg(to_jsonb(c) order by rev desc nulls last, awb desc) from c),'[]'),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'active',active,'new',nw,'awb',awb,'rev',rev) order by d) from (
        select s.booking_date d, count(distinct s.customer_code) active,
               count(distinct s.customer_code) filter (where l.first_date = s.booking_date) nw,
               count(*) awb, sum(s.revenue) rev
        from s left join life l on l.customer_code = s.customer_code group by 1) x),'[]'),
    'top5_daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'code',code,'name',name,'rev',rev,'awb',awb) order by d) from (
        select s.booking_date d, s.customer_code code, max(s.customer_name) name, sum(s.revenue) rev, count(*) awb
        from s where s.customer_code in (select code from top5) group by 1,2) x),'[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 6. SALES TEAM PERFORMANCE (+ targets vs actual)
-- ---------------------------------------------------------------------
create or replace function public.visible_salespersons() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if public.data_scope() = 'all' or public.perm_allows('target_management') then return null; end if; -- null = all
  return coalesce(p.salesperson_names,'{}') || coalesce(p.team_salespersons,'{}') ||
         coalesce((select array_agg(distinct salesperson_name) from public.scoped_shipments('{}'::jsonb)
                   where salesperson_name is not null), '{}');
end $$;

create or replace function public.get_sales_performance(f jsonb default '{}'::jsonb, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; rf jsonb; cf jsonb; pf jsonb; mf jsonb; v_month date; v_vis text[];
begin
  perform public.assert_perm('page_sales');
  rf := public.resolve_range(f);
  cf := f || jsonb_build_object('from', rf->>'from', 'to', rf->>'to');
  pf := f || jsonb_build_object('from', rf->>'prev_from', 'to', rf->>'prev_to');
  v_month := date_trunc('month', coalesce(p_month, (rf->>'to')::date))::date;
  mf := (f - 'from' - 'to') || jsonb_build_object('from', v_month, 'to', (v_month + interval '1 month - 1 day')::date);
  v_vis := public.visible_salespersons();
  with s as materialized (select * from public.scoped_shipments(cf)),
       p as (select coalesce(salesperson_name,'Unassigned') name, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev
               from public.scoped_shipments(pf) group by 1),
       sp as materialized (
         select coalesce(s.salesperson_name,'Unassigned') name, count(*) awb, sum(s.chargeable_weight) wt,
                sum(s.revenue) rev, count(distinct s.customer_code) customers,
                count(*) filter (where s.is_hold) hold
         from s group by 1),
       spx as (select sp.*, p.awb prev_awb, p.wt prev_wt, p.rev prev_rev from sp left join p on p.name = sp.name),
       top8 as (select name from sp order by rev desc nulls last, awb desc limit 8),
       ma as (select coalesce(salesperson_name,'Unassigned') name, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev
                from public.scoped_shipments(mf) group by 1)
  select jsonb_build_object(
    'range', rf, 'target_month', v_month,
    'flags', jsonb_build_object('revenue', public.perm_allows('revenue_visibility'),
                                'weight',  public.perm_allows('weight_visibility'),
                                'manage_targets', public.perm_allows('target_management')),
    'kpi', (select jsonb_build_object('salespersons', count(*) filter (where name <> 'Unassigned'),
              'revenue', sum(rev), 'awb', sum(awb), 'weight', sum(wt),
              'avg_revenue', case when count(*) filter (where name <> 'Unassigned') > 0
                                  then sum(rev) filter (where name <> 'Unassigned') / count(*) filter (where name <> 'Unassigned') end) from sp),
    'salespersons', coalesce((select jsonb_agg(to_jsonb(spx) order by rev desc nulls last, awb desc) from spx),'[]'),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'name',name,'rev',rev,'awb',awb,'wt',wt) order by d) from (
        select booking_date d, coalesce(salesperson_name,'Unassigned') name, sum(revenue) rev, count(*) awb, sum(chargeable_weight) wt
        from s where coalesce(salesperson_name,'Unassigned') in (select name from top8) group by 1,2) x),'[]'),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('m',m,'name',name,'rev',rev,'awb',awb,'wt',wt) order by m) from (
        select date_trunc('month', booking_date)::date m, coalesce(salesperson_name,'Unassigned') name,
               sum(revenue) rev, count(*) awb, sum(chargeable_weight) wt
        from public.scoped_shipments((f - 'from' - 'to') || jsonb_build_object('from', (date_trunc('month',(rf->>'to')::date) - interval '11 months')::date, 'to', rf->>'to'))
        group by 1,2) x),'[]'),
    'targets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.id, 'salesperson_name', t.salesperson_name, 'target_month', t.target_month,
          'revenue_target', case when public.perm_allows('revenue_visibility') then t.revenue_target end,
          'awb_target', t.awb_target,
          'weight_target', case when public.perm_allows('weight_visibility') then t.weight_target end,
          'actual_revenue', coalesce(ma.rev, case when public.perm_allows('revenue_visibility') then 0 end),
          'actual_awb', coalesce(ma.awb,0),
          'actual_weight', coalesce(ma.wt, case when public.perm_allows('weight_visibility') then 0 end))
          order by t.salesperson_name)
        from public.sales_targets t left join ma on ma.name = t.salesperson_name
        where t.target_month = v_month and (v_vis is null or t.salesperson_name = any(v_vis))),'[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 7. COUNTRY & HUB ANALYSIS
-- ---------------------------------------------------------------------
create or replace function public.get_country_hub(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; rf jsonb; cf jsonb;
begin
  perform public.assert_active();
  if not (public.perm_allows('page_country') or public.perm_allows('page_hub')) then
    raise exception 'Not authorised: missing permission page_country/page_hub' using errcode = '42501';
  end if;
  rf := public.resolve_range(f);
  cf := f || jsonb_build_object('from', rf->>'from', 'to', rf->>'to');
  with s as materialized (select * from public.scoped_shipments(cf)),
       co as materialized (select coalesce(destination_country,'(Blank)') name, count(*) awb, sum(chargeable_weight) wt,
                      sum(revenue) rev, count(distinct customer_code) customers from s group by 1),
       top5c as (select name from co order by awb desc limit 5),
       hb as (select coalesce(origin_hub_code,'(Blank)') hub, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev,
                     count(distinct customer_code) customers, count(*) filter (where is_hold) hold,
                     sum(chargeable_weight) filter (where is_hold) hold_wt from s group by 1)
  select jsonb_build_object(
    'range', rf,
    'flags', jsonb_build_object('revenue', public.perm_allows('revenue_visibility'),
                                'weight',  public.perm_allows('weight_visibility'),
                                'country', public.perm_allows('page_country'),
                                'hub',     public.perm_allows('page_hub')),
    'countries', coalesce((select jsonb_agg(to_jsonb(co) order by awb desc) from co),'[]'),
    'hubs', coalesce((select jsonb_agg(to_jsonb(hb) order by awb desc) from hb),'[]'),
    'states', coalesce((select jsonb_agg(to_jsonb(t) order by awb desc) from (
        select coalesce(shipper_state,'(Blank)') name, count(*) awb, sum(chargeable_weight) wt, sum(revenue) rev,
               count(distinct customer_code) customers from s group by 1) t),'[]'),
    'cities', coalesce((select jsonb_agg(to_jsonb(t) order by awb desc) from (
        select coalesce(shipper_city,'(Blank)') name, max(shipper_state) state, count(*) awb, sum(chargeable_weight) wt,
               sum(revenue) rev from s group by 1 order by 3 desc limit 30) t),'[]'),
    'country_daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'name',name,'awb',awb,'rev',rev) order by d) from (
        select booking_date d, coalesce(destination_country,'(Blank)') name, count(*) awb, sum(revenue) rev
        from s where coalesce(destination_country,'(Blank)') in (select name from top5c) group by 1,2) x),'[]'),
    'hub_daily', coalesce((select jsonb_agg(jsonb_build_object('d',d,'hub',hub,'awb',awb,'rev',rev,'wt',wt) order by d) from (
        select booking_date d, coalesce(origin_hub_code,'(Blank)') hub, count(*) awb, sum(revenue) rev, sum(chargeable_weight) wt
        from s group by 1,2) x),'[]'),
    'hub_top_customers', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select hub, code, name, awb, rev from (
          select coalesce(origin_hub_code,'(Blank)') hub, customer_code code, max(customer_name) name, count(*) awb, sum(revenue) rev,
                 row_number() over (partition by coalesce(origin_hub_code,'(Blank)') order by count(*) desc) rn
          from s group by 1,2) z where rn <= 5) t),'[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 8. SHIPMENT REPORT – server-side pagination / sorting
-- ---------------------------------------------------------------------
create or replace function public.get_shipments(f jsonb default '{}'::jsonb, p_page int default 1,
  p_size int default 25, p_sort text default 'booking_date', p_dir text default 'desc')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_sort text; v_dir text; v_size int;
begin
  perform public.assert_active();
  if not (public.perm_allows('page_shipments') or public.perm_allows('page_customers') or public.perm_allows('page_sales')) then
    raise exception 'Not authorised: missing permission page_shipments' using errcode = '42501';
  end if;
  v_sort := case when p_sort in ('awb_number','booking_date','customer_name','customer_code','shipper_city','shipper_state',
                   'destination_country','chargeable_weight','revenue','salesperson_name','origin_hub_code','is_hold',
                   'awb_state','service_name','pcs') then p_sort else 'booking_date' end;
  v_dir  := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_size := least(greatest(coalesce(p_size,25),1), case when public.perm_allows('excel_export') then 5000 else 200 end);
  p_page := greatest(coalesce(p_page,1),1);
  execute format($q$
    with s as materialized (select * from public.scoped_shipments($1))
    select jsonb_build_object(
      'total', (select count(*) from s),
      'summary', (select jsonb_build_object('weight', sum(chargeable_weight), 'revenue', sum(revenue),
                    'hold', count(*) filter (where is_hold), 'unhold', count(*) filter (where not is_hold),
                    'hold_weight', sum(chargeable_weight) filter (where is_hold),
                    'unhold_weight', sum(chargeable_weight) filter (where not is_hold),
                    'hold_revenue', sum(revenue) filter (where is_hold),
                    'unhold_revenue', sum(revenue) filter (where not is_hold)) from s),
      'page', $3, 'size', $2,
      'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (
                 select * from s order by %I %s nulls last, awb_number limit $2 offset ($3 - 1) * $2) t), '[]'))
  $q$, v_sort, v_dir) using f, v_size, p_page into r;
  return r || jsonb_build_object('flags', jsonb_build_object(
     'revenue', public.perm_allows('revenue_visibility'), 'weight', public.perm_allows('weight_visibility'),
     'export', public.perm_allows('excel_export'), 'hold_change', public.perm_allows('hold_change')));
end $$;

-- Date-wise reports: p_type = 'date' | 'customer' | 'salesperson'
create or replace function public.get_datewise_report(f jsonb default '{}'::jsonb, p_type text default 'date')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_perm('page_shipments');
  if p_type = 'customer' then
    select coalesce(jsonb_agg(to_jsonb(t) order by d, rev desc nulls last),'[]') into r from (
      select booking_date d, customer_code code, max(customer_name) name, count(*) awb,
             sum(chargeable_weight) wt, sum(revenue) rev from public.scoped_shipments(f) group by 1,2) t;
  elsif p_type = 'salesperson' then
    select coalesce(jsonb_agg(to_jsonb(t) order by d, rev desc nulls last),'[]') into r from (
      select booking_date d, coalesce(salesperson_name,'Unassigned') name, count(*) awb,
             sum(chargeable_weight) wt, sum(revenue) rev from public.scoped_shipments(f) group by 1,2) t;
  else
    select coalesce(jsonb_agg(to_jsonb(t) order by d),'[]') into r from (
      select booking_date d, count(*) awb, count(distinct customer_code) customers, sum(chargeable_weight) wt,
             sum(revenue) rev, count(*) filter (where is_hold) hold from public.scoped_shipments(f) group by 1) t;
  end if;
  return r;
end $$;

-- Full AWB detail incl. all 74 original Excel columns (masked as per permissions)
create or replace function public.get_shipment_detail(p_awb text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.shipments; raw jsonb; j jsonb; v_rev boolean; v_wt boolean;
begin
  perform public.assert_active();
  select * into v from public.shipments where awb_number = trim(p_awb);
  if not found or not public.can_see_shipment(v.salesperson_name, v.origin_hub_code) then
    raise exception 'AWB not found or not authorised' using errcode = 'P0002';
  end if;
  v_rev := public.perm_allows('revenue_visibility'); v_wt := public.perm_allows('weight_visibility');
  raw := v.raw_excel_data; j := to_jsonb(v) - 'raw_excel_data';
  if not v_rev then
    raw := raw - coalesce((select array_agg(k) from jsonb_object_keys(raw) k
                           where k ~* '(TOTAL|FREIGHT|GST|TAXABLE|RATE|AMOUNT|FSC|CHARGE)'),'{}');
    j := j - array['customer_freight','customer_other_charges','sales_fsc_percent','customer_taxable_amount',
                   'customer_cgst','customer_sgst','customer_igst','customer_grand_total','grand_total_original'];
  end if;
  if not v_wt then
    raw := raw - coalesce((select array_agg(k) from jsonb_object_keys(raw) k where k ~* '(WEIGHT|WT\.)'),'{}');
    j := j - array['actual_weight','volumetric_weight','chargeable_weight'];
  end if;
  return jsonb_build_object('shipment', j, 'raw', raw,
    'can_change_hold', public.perm_allows('hold_change'),
    'history', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
        select action, user_name, old_value, new_value, remarks, created_at from public.audit_logs
        where record_type = 'shipment' and record_id = v.awb_number order by created_at desc limit 50) a),'[]'));
end $$;

-- ---------------------------------------------------------------------
-- 9. HOLD / UNHOLD (audited)
-- ---------------------------------------------------------------------
create or replace function public.set_hold_status(p_awb text, p_hold boolean, p_remarks text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.shipments;
begin
  perform public.assert_perm('hold_change');
  if p_remarks is null or length(trim(p_remarks)) < 3 then
    raise exception 'Remarks are required (min 3 characters)' using errcode = '22023';
  end if;
  select * into v from public.shipments where awb_number = trim(p_awb) for update;
  if not found or not public.can_see_shipment(v.salesperson_name, v.origin_hub_code) then
    raise exception 'AWB not found or not authorised' using errcode = 'P0002';
  end if;
  if v.is_hold = p_hold then
    return jsonb_build_object('changed', false, 'is_hold', public.yes_no(p_hold));
  end if;
  update public.shipments set is_hold = p_hold, hold_remarks = left(trim(p_remarks), 500),
         raw_excel_data = raw_excel_data || jsonb_build_object('IS HOLD?', public.yes_no(p_hold))
   where id = v.id;
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, old_value, new_value, remarks)
  values (auth.uid(), public.my_name(), 'HOLD_STATUS_CHANGE', 'shipment', v.awb_number,
          jsonb_build_object('is_hold', public.yes_no(v.is_hold)),
          jsonb_build_object('is_hold', public.yes_no(p_hold)), left(trim(p_remarks), 500));
  return jsonb_build_object('changed', true, 'is_hold', public.yes_no(p_hold));
end $$;

-- ---------------------------------------------------------------------
-- 10. EXCEL IMPORT (batched UPSERT with versioning + rollback)
-- ---------------------------------------------------------------------
create or replace function public.import_begin(p_file text, p_sheet text, p_total int, p_meta jsonb default '{}'::jsonb,
  p_billing_currency text default 'INR') returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.assert_perm('excel_import');
  insert into public.import_logs(file_name, sheet_name, total_rows, uploaded_by, uploaded_by_name, meta, billing_currency)
  values (left(p_file,255), left(p_sheet,100), coalesce(p_total,0), auth.uid(), public.my_name(),
          coalesce(p_meta,'{}'), coalesce(p_billing_currency,'INR'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.import_check_existing(p_awbs text[]) returns text[]
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_perm('excel_import');
  if coalesce(array_length(p_awbs,1),0) > 20000 then
    raise exception 'Too many AWBs in one check (max 20000)' using errcode = '22023';
  end if;
  return coalesce((select array_agg(awb_number) from public.shipments where awb_number = any(p_awbs)), '{}');
end $$;

create or replace function public.import_batch(p_import_id bigint, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_ins int := 0; v_upd int := 0; v_name text := public.my_name();
begin
  perform public.assert_perm('excel_import');
  perform 1 from public.import_logs where id = p_import_id and uploaded_by = auth.uid() and status = 'running';
  if not found then raise exception 'Import % is not running or not yours', p_import_id using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Batch must be a JSON array of max 2000 rows' using errcode = '22023';
  end if;

  perform set_config('client_min_messages','warning',true);
  drop table if exists _imp;
  create temp table _imp on commit drop as
  select distinct on (trim(x.awb_number)) x.*
  from jsonb_populate_recordset(null::public.shipments, p_rows) x
  where nullif(trim(x.awb_number),'') is not null
  order by trim(x.awb_number);
  update _imp set awb_number = trim(awb_number) where awb_number is distinct from trim(awb_number);  -- WHERE needed: Supabase API blocks UPDATE without WHERE (safeupdate)

  -- before-images for rollback
  insert into public.shipment_versions(import_id, awb_number, old_row)
  select p_import_id, s.awb_number, to_jsonb(s) from public.shipments s join _imp i on i.awb_number = s.awb_number;

  -- audit hold status changes caused by the import
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, old_value, new_value, remarks)
  select auth.uid(), v_name, 'HOLD_STATUS_CHANGE', 'shipment', s.awb_number,
         jsonb_build_object('is_hold', public.yes_no(s.is_hold)),
         jsonb_build_object('is_hold', public.yes_no(coalesce(i.is_hold,false))),
         'Changed by Excel import #' || p_import_id
  from public.shipments s join _imp i on i.awb_number = s.awb_number
  where s.is_hold is distinct from coalesce(i.is_hold,false);

  with up as (
    insert into public.shipments as t (
      awb_number, booking_date, customer_name, customer_code, customer_type, shipper_city, shipper_state,
      shipper_country, destination_country, destination_city, service_name, vendor_name, product_name,
      awb_state, entry_type, pcs, actual_weight, volumetric_weight, chargeable_weight, shipment_value,
      shipment_currency, customer_freight, customer_other_charges, sales_fsc_percent, customer_taxable_amount,
      customer_cgst, customer_sgst, customer_igst, customer_grand_total, grand_total_original, billing_currency,
      fx_rate_to_inr, salesperson_name, origin_hub_code, is_hold, data_quality_flags, raw_excel_data,
      first_import_id, last_import_id)
    select trim(awb_number), booking_date, customer_name, customer_code, customer_type, shipper_city, shipper_state,
      shipper_country, destination_country, destination_city, service_name, vendor_name, product_name,
      awb_state, entry_type, pcs, actual_weight, volumetric_weight, coalesce(chargeable_weight,0), shipment_value,
      shipment_currency, customer_freight, customer_other_charges, sales_fsc_percent, customer_taxable_amount,
      customer_cgst, customer_sgst, customer_igst, coalesce(customer_grand_total,0), grand_total_original,
      coalesce(billing_currency,'INR'), coalesce(fx_rate_to_inr,1), nullif(trim(salesperson_name),''),
      nullif(trim(origin_hub_code),''), coalesce(is_hold,false), coalesce(data_quality_flags,'{}'),
      coalesce(raw_excel_data,'{}'), p_import_id, p_import_id
    from _imp
    on conflict (awb_number) do update set
      booking_date = excluded.booking_date, customer_name = excluded.customer_name,
      customer_code = excluded.customer_code, customer_type = excluded.customer_type,
      shipper_city = excluded.shipper_city, shipper_state = excluded.shipper_state,
      shipper_country = excluded.shipper_country, destination_country = excluded.destination_country,
      destination_city = excluded.destination_city, service_name = excluded.service_name,
      vendor_name = excluded.vendor_name, product_name = excluded.product_name, awb_state = excluded.awb_state,
      entry_type = excluded.entry_type, pcs = excluded.pcs, actual_weight = excluded.actual_weight,
      volumetric_weight = excluded.volumetric_weight, chargeable_weight = excluded.chargeable_weight,
      shipment_value = excluded.shipment_value, shipment_currency = excluded.shipment_currency,
      customer_freight = excluded.customer_freight, customer_other_charges = excluded.customer_other_charges,
      sales_fsc_percent = excluded.sales_fsc_percent, customer_taxable_amount = excluded.customer_taxable_amount,
      customer_cgst = excluded.customer_cgst, customer_sgst = excluded.customer_sgst,
      customer_igst = excluded.customer_igst, customer_grand_total = excluded.customer_grand_total,
      grand_total_original = excluded.grand_total_original, billing_currency = excluded.billing_currency,
      fx_rate_to_inr = excluded.fx_rate_to_inr, salesperson_name = excluded.salesperson_name,
      origin_hub_code = excluded.origin_hub_code,
      hold_remarks = case when t.is_hold is distinct from excluded.is_hold
                          then 'Excel import #' || p_import_id else t.hold_remarks end,
      is_hold = excluded.is_hold, data_quality_flags = excluded.data_quality_flags,
      raw_excel_data = excluded.raw_excel_data, last_import_id = excluded.last_import_id
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  update public.import_logs set new_records = new_records + v_ins, updated_records = updated_records + v_upd
   where id = p_import_id;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd);
end $$;

create or replace function public.import_finish(p_import_id bigint, p_status text, p_stats jsonb, p_errors jsonb default '[]'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.import_logs;
begin
  perform public.assert_perm('excel_import');
  update public.import_logs set
    status = case when p_status in ('completed','partial','failed') then p_status else 'completed' end,
    finished_at = now(),
    total_rows = coalesce((p_stats->>'total_rows')::int, total_rows),
    duplicate_records = coalesce((p_stats->>'duplicate_records')::int, 0),
    failed_records = coalesce((p_stats->>'failed_records')::int, 0),
    errors = case when jsonb_typeof(p_errors) = 'array'
                  then (select coalesce(jsonb_agg(e),'[]') from (select e from jsonb_array_elements(p_errors) e limit 5000) z)
                  else '[]' end,
    meta = meta || coalesce(p_stats,'{}')
  where id = p_import_id and uploaded_by = auth.uid() and status = 'running'
  returning * into v;
  if not found then raise exception 'Import % not found / not running', p_import_id; end if;
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, new_value, remarks)
  values (auth.uid(), public.my_name(), 'EXCEL_IMPORT', 'import', v.id::text,
          jsonb_build_object('file', v.file_name, 'total', v.total_rows, 'new', v.new_records, 'updated', v.updated_records,
                             'duplicates', v.duplicate_records, 'failed', v.failed_records, 'status', v.status),
          'Excel import ' || v.status);
  return to_jsonb(v) - 'errors';
end $$;

-- Recovery: undo an import. Rows inserted by it are deleted, rows it updated
-- are restored from their before-image. Rows changed by a LATER import are
-- skipped (reported) so newer data is never overwritten.
create or replace function public.import_rollback(p_import_id bigint, p_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v public.import_logs; v_del int := 0; v_res int := 0; v_skip int := 0;
begin
  perform public.assert_active();
  if not public.is_admin() then raise exception 'Only ADMIN can roll back imports' using errcode = '42501'; end if;
  select * into v from public.import_logs where id = p_import_id for update;
  if not found or v.status = 'rolled_back'
     or (v.status = 'running' and v.uploaded_at > now() - interval '2 hours') then
    raise exception 'Import % cannot be rolled back (status: %)', p_import_id, coalesce(v.status,'missing');
  end if;

  delete from public.shipments s
   where s.last_import_id = p_import_id and s.first_import_id = p_import_id
     and not exists (select 1 from public.shipment_versions sv where sv.import_id = p_import_id and sv.awb_number = s.awb_number);
  get diagnostics v_del = row_count;

  update public.shipments t set
    booking_date = o.booking_date, customer_name = o.customer_name, customer_code = o.customer_code,
    customer_type = o.customer_type, shipper_city = o.shipper_city, shipper_state = o.shipper_state,
    shipper_country = o.shipper_country, destination_country = o.destination_country,
    destination_city = o.destination_city, service_name = o.service_name, vendor_name = o.vendor_name,
    product_name = o.product_name, awb_state = o.awb_state, entry_type = o.entry_type, pcs = o.pcs,
    actual_weight = o.actual_weight, volumetric_weight = o.volumetric_weight, chargeable_weight = o.chargeable_weight,
    shipment_value = o.shipment_value, shipment_currency = o.shipment_currency, customer_freight = o.customer_freight,
    customer_other_charges = o.customer_other_charges, sales_fsc_percent = o.sales_fsc_percent,
    customer_taxable_amount = o.customer_taxable_amount, customer_cgst = o.customer_cgst,
    customer_sgst = o.customer_sgst, customer_igst = o.customer_igst, customer_grand_total = o.customer_grand_total,
    grand_total_original = o.grand_total_original, billing_currency = o.billing_currency,
    fx_rate_to_inr = o.fx_rate_to_inr, salesperson_name = o.salesperson_name, origin_hub_code = o.origin_hub_code,
    is_hold = o.is_hold, hold_remarks = o.hold_remarks, data_quality_flags = o.data_quality_flags,
    raw_excel_data = o.raw_excel_data, last_import_id = o.last_import_id
  from (select (jsonb_populate_record(null::public.shipments, sv.old_row)).*
          from public.shipment_versions sv where sv.import_id = p_import_id) o
  where t.awb_number = o.awb_number and t.last_import_id = p_import_id;
  get diagnostics v_res = row_count;

  v_skip := greatest(v.new_records + v.updated_records - v_del - v_res, 0);
  update public.import_logs set status = 'rolled_back',
         notes = coalesce(notes || E'\n','') || format('Rolled back by %s on %s: %s deleted, %s restored, %s skipped (changed by later import). %s',
                 public.my_name(), to_char(now() at time zone 'Asia/Kolkata','DD-MM-YYYY HH24:MI'), v_del, v_res, v_skip, coalesce(p_reason,''))
   where id = p_import_id;
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, new_value, remarks)
  values (auth.uid(), public.my_name(), 'IMPORT_ROLLBACK', 'import', p_import_id::text,
          jsonb_build_object('deleted', v_del, 'restored', v_res, 'skipped', v_skip), p_reason);
  return jsonb_build_object('deleted', v_del, 'restored', v_res, 'skipped', v_skip);
end $$;

create or replace function public.get_import_logs(p_page int default 1, p_size int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_all boolean;
begin
  perform public.assert_active();
  if not (public.perm_allows('excel_import') or public.perm_allows('audit_logs')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  v_all := public.is_admin() or public.perm_allows('audit_logs');
  select jsonb_build_object(
    'total', (select count(*) from public.import_logs where v_all or uploaded_by = auth.uid()),
    'rows', coalesce((select jsonb_agg(to_jsonb(t) - 'errors' || jsonb_build_object('error_count', jsonb_array_length(t.errors))
                        order by t.id desc)
             from (select * from public.import_logs where v_all or uploaded_by = auth.uid()
                   order by id desc limit least(p_size,100) offset (greatest(p_page,1)-1)*least(p_size,100)) t),'[]'))
  into r;
  return r;
end $$;

create or replace function public.get_import_errors(p_import_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_active();
  select errors into r from public.import_logs
   where id = p_import_id and (uploaded_by = auth.uid() or public.is_admin() or public.perm_allows('audit_logs'));
  return coalesce(r,'[]');
end $$;

-- ---------------------------------------------------------------------
-- 11. USER MANAGEMENT (profile + permissions). Creating / deleting auth
--     users needs the service role -> Edge Function "admin-users".
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_perm('user_management');
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('permission_overrides',
            coalesce((select jsonb_object_agg(permission_key, permission_value) from public.user_permissions u where u.user_id = p.id),'{}'))
          order by p.role, p.full_name) from public.profiles p),'[]');
end $$;

create or replace function public.admin_update_user(p_id uuid, p jsonb, p_perms jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o public.profiles; n public.profiles; k text; val text;
begin
  perform public.assert_perm('user_management');
  select * into o from public.profiles where id = p_id for update;
  if not found then raise exception 'User not found'; end if;
  if not public.is_admin() and (o.role = 'admin' or p->>'role' = 'admin') then
    raise exception 'Only ADMIN can modify admin accounts' using errcode = '42501';
  end if;
  if p_id = auth.uid() and ((p ? 'role' and p->>'role' <> o.role) or (p ? 'is_active' and not (p->>'is_active')::boolean)) then
    raise exception 'You cannot change your own role or deactivate yourself' using errcode = '42501';
  end if;
  if p ? 'role' and p->>'role' not in ('admin','manager','sales') then raise exception 'Invalid role'; end if;

  update public.profiles set
    full_name         = coalesce(left(p->>'full_name',120), full_name),
    username          = case when p ? 'username' then nullif(lower(trim(p->>'username')),'') else username end,
    mobile            = case when p ? 'mobile' then left(p->>'mobile',20) else mobile end,
    role              = coalesce(p->>'role', role),
    assigned_hubs     = case when p ? 'assigned_hubs' then array(select jsonb_array_elements_text(p->'assigned_hubs')) else assigned_hubs end,
    salesperson_names = case when p ? 'salesperson_names' then array(select jsonb_array_elements_text(p->'salesperson_names')) else salesperson_names end,
    team_salespersons = case when p ? 'team_salespersons' then array(select jsonb_array_elements_text(p->'team_salespersons')) else team_salespersons end,
    is_active         = coalesce((p->>'is_active')::boolean, is_active)
  where id = p_id returning * into n;

  if p_perms is not null and jsonb_typeof(p_perms) = 'object' then
    for k, val in select key, value #>> '{}' from jsonb_each(p_perms) loop
      if not (k = any(public.permission_keys())) then continue; end if;
      if val is null or val = 'default' or val = public.default_permission(n.role, k) then
        delete from public.user_permissions where user_id = p_id and permission_key = k;
      else
        insert into public.user_permissions(user_id, permission_key, permission_value, updated_by)
        values (p_id, k, val, auth.uid())
        on conflict (user_id, permission_key) do update set permission_value = excluded.permission_value,
               updated_by = excluded.updated_by, updated_at = now();
      end if;
    end loop;
  end if;

  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, old_value, new_value, remarks)
  values (auth.uid(), public.my_name(), 'USER_UPDATE', 'user', p_id::text,
          to_jsonb(o) - 'preferences', (to_jsonb(n) - 'preferences') || jsonb_build_object('permissions', p_perms), null);
  return to_jsonb(n);
end $$;

create or replace function public.get_salesperson_names() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_active();
  if not (public.perm_allows('user_management') or public.perm_allows('target_management')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'salespersons', coalesce((select jsonb_agg(x order by x) from (select distinct salesperson_name x from public.shipments where salesperson_name is not null) t),'[]'),
    'hubs', coalesce((select jsonb_agg(x order by x) from (select distinct origin_hub_code x from public.shipments where origin_hub_code is not null) t),'[]'));
end $$;

create or replace function public.update_my_profile(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n public.profiles;
begin
  perform public.assert_active();
  update public.profiles set
    full_name   = coalesce(nullif(left(trim(p->>'full_name'),120),''), full_name),
    mobile      = case when p ? 'mobile' then left(p->>'mobile',20) else mobile end,
    avatar_url  = case when p ? 'avatar_url' then left(p->>'avatar_url',500) else avatar_url end,
    preferences = case when p ? 'preferences' then preferences || (p->'preferences') else preferences end
  where id = auth.uid() returning * into n;
  return to_jsonb(n);
end $$;

-- ---------------------------------------------------------------------
-- 12. SALES TARGETS
-- ---------------------------------------------------------------------
create or replace function public.get_targets(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_perm('page_sales');
  r := public.get_sales_performance(jsonb_build_object('from', date_trunc('month',p_month)::date,
          'to', (date_trunc('month',p_month) + interval '1 month - 1 day')::date), p_month);
  return jsonb_build_object('month', r->'target_month', 'targets', r->'targets', 'flags', r->'flags',
                            'salespersons', r->'salespersons');
end $$;

create or replace function public.upsert_target(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t public.sales_targets; o jsonb;
begin
  perform public.assert_perm('target_management');
  if nullif(trim(p->>'salesperson_name'),'') is null then raise exception 'Salesperson is required'; end if;
  select to_jsonb(x) into o from public.sales_targets x
   where salesperson_name = trim(p->>'salesperson_name') and target_month = date_trunc('month',(p->>'target_month')::date)::date;
  insert into public.sales_targets(salesperson_name, target_month, revenue_target, awb_target, weight_target, notes, created_by)
  values (trim(p->>'salesperson_name'), date_trunc('month',(p->>'target_month')::date)::date,
          nullif(p->>'revenue_target','')::numeric, nullif(p->>'awb_target','')::int,
          nullif(p->>'weight_target','')::numeric, p->>'notes', auth.uid())
  on conflict (salesperson_name, target_month) do update set revenue_target = excluded.revenue_target,
     awb_target = excluded.awb_target, weight_target = excluded.weight_target, notes = excluded.notes
  returning * into t;
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, old_value, new_value)
  values (auth.uid(), public.my_name(), 'TARGET_SAVE', 'target', t.id::text, o, to_jsonb(t));
  return to_jsonb(t);
end $$;

create or replace function public.delete_target(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare o jsonb;
begin
  perform public.assert_perm('target_management');
  delete from public.sales_targets where id = p_id returning to_jsonb(sales_targets.*) into o;
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, old_value)
  values (auth.uid(), public.my_name(), 'TARGET_DELETE', 'target', p_id::text, o);
end $$;

-- ---------------------------------------------------------------------
-- 13. AUDIT LOGS, NOTIFICATIONS, SETTINGS
-- ---------------------------------------------------------------------
create or replace function public.get_audit_logs(p_page int default 1, p_size int default 25,
  p_action text default null, p_search text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_perm('audit_logs');
  p_size := least(greatest(coalesce(p_size,25),1),5000);
  with a as (select * from public.audit_logs l
     where (p_action is null or p_action = '' or l.action = p_action)
       and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to + 1)
       and (p_search is null or p_search = '' or l.record_id ilike '%'||p_search||'%' or l.user_name ilike '%'||p_search||'%'
            or l.remarks ilike '%'||p_search||'%'))
  select jsonb_build_object('total', (select count(*) from a),
    'actions', (select coalesce(jsonb_agg(distinct action),'[]') from public.audit_logs),
    'rows', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from
      (select * from a order by created_at desc limit p_size offset (greatest(p_page,1)-1)*p_size) t),'[]'))
  into r;
  return r;
end $$;

create or replace function public.get_notifications() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_active();
  return jsonb_build_object(
    'imports', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select id, file_name, status, new_records, updated_records, failed_records, uploaded_by_name, uploaded_at
        from public.import_logs where uploaded_at > now() - interval '14 days' order by id desc limit 6) t),'[]'),
    'holds', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select a.record_id awb, a.new_value->>'is_hold' is_hold, a.user_name, a.remarks, a.created_at
        from public.audit_logs a join public.shipments s on s.awb_number = a.record_id
        where a.action = 'HOLD_STATUS_CHANGE' and a.created_at > now() - interval '7 days'
          and public.can_see_shipment(s.salesperson_name, s.origin_hub_code)
        order by a.created_at desc limit 8) t),'[]'));
end $$;

create or replace function public.set_setting(p_key text, p_value jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare o jsonb;
begin
  perform public.assert_active();
  if not (public.is_admin() or public.perm_allows('app_settings')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select value into o from public.app_settings where key = p_key;
  insert into public.app_settings(key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, old_value, new_value)
  values (auth.uid(), public.my_name(), 'SETTING_CHANGE', 'setting', p_key, o, p_value);
end $$;

create or replace function public.upsert_exchange_rate(p_currency text, p_rate numeric, p_approved_by text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_active();
  if not (public.is_admin() or public.perm_allows('app_settings')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  insert into public.exchange_rates(currency, rate_to_inr, approved_by, updated_by, effective_date)
  values (upper(p_currency), p_rate, p_approved_by, auth.uid(), current_date)
  on conflict (currency) do update set rate_to_inr = excluded.rate_to_inr, approved_by = excluded.approved_by,
     updated_by = excluded.updated_by, updated_at = now(), effective_date = current_date;
  insert into public.audit_logs(user_id, user_name, action, record_type, record_id, new_value)
  values (auth.uid(), public.my_name(), 'FX_RATE_CHANGE', 'setting', upper(p_currency),
          jsonb_build_object('rate_to_inr', p_rate, 'approved_by', p_approved_by));
end $$;

-- ---------------------------------------------------------------------
-- 14. FUNCTION PRIVILEGES
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.email_for_login(text) to anon;
alter default privileges in schema public revoke execute on functions from public, anon;
-- internal helpers not meant for direct use by the browser
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.handle_user_email_change() from authenticated;
