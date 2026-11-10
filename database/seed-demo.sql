-- =====================================================================
--  SKYNET EXPRESS – FILE 4 / 4 : seed-demo.sql   (OPTIONAL)
--  Synthetic test data ONLY (fake customers / salespersons, AWB prefix DEMO).
--  Real business data must be loaded through the app's Excel Import page.
--  Remove demo data any time with:
--      delete from public.shipments where awb_number like 'DEMO%';
--      delete from public.sales_targets where salesperson_name like 'Demo %';
-- =====================================================================

insert into public.shipments (
  awb_number, booking_date, customer_name, customer_code, shipper_city, shipper_state, shipper_country,
  destination_country, service_name, awb_state, entry_type, pcs, actual_weight, volumetric_weight,
  chargeable_weight, customer_freight, customer_taxable_amount, customer_igst, customer_grand_total,
  salesperson_name, origin_hub_code, is_hold, raw_excel_data)
select
  'DEMO' || lpad(g::text, 7, '0'),
  current_date - ((g * 7919) % 60),
  'Demo Customer ' || lpad(((g * 31) % 120 + 1)::text, 3, '0'),
  'DC' || lpad(((g * 31) % 120 + 1)::text, 4, '0'),
  (array['LUDHIANA','NEW DELHI','JALANDHAR','MUMBAI','AMRITSAR','BENGALURU','CHANDIGARH','PUNE'])[(g % 8) + 1],
  (array['PUNJAB','DELHI','PUNJAB','MAHARASHTRA','PUNJAB','KARNATAKA','CHANDIGARH','MAHARASHTRA'])[(g % 8) + 1],
  'INDIA',
  (array['AUSTRALIA','CANADA','UNITED KINGDOM','UNITED STATES OF AMERICA','NEW ZEALAND','UNITED ARAB EMIRATES',
         'GERMANY','ITALY','SINGAPORE','CANADA','AUSTRALIA','UNITED KINGDOM'])[(g * 7 % 12) + 1],
  (array['SKYNET SAVER','SKYNET PREMIUM DDU','SKYNET CANADA YYZ','EUROPE ECO','SKYNET EX DXB PREMIUM'])[(g % 5) + 1],
  (array['DELIVERED','DELIVERED','DELIVERED','INTRANSIT','ENTRY','MANIFEST','DELIVERED','INTRANSIT'])[(g % 8) + 1],
  (array['API','PORTAL','SOFTWARE'])[(g % 3) + 1],
  1 + (g % 3),
  w.wt * 0.92, w.wt * 0.97, w.wt,
  round(w.wt * w.rate, 2), round(w.wt * w.rate, 2), round(w.wt * w.rate * 0.18, 2),
  round(w.wt * w.rate * 1.18, 2),
  case when g % 37 = 0 then null
       else 'Demo ' || (array['Aarav','Bhavna','Chetan','Divya','Eshan','Farah','Gagan','Heena'])[(g * 13 % 8) + 1] end,
  case when g % 10 < 8 then 'DEL' when g % 10 = 8 then 'BOM' else 'BLR' end,
  (g % 53 = 0),
  jsonb_build_object('AWB NUMBER', 'DEMO' || lpad(g::text, 7, '0'), 'SOURCE', 'seed-demo.sql')
from generate_series(1, 3000) g
cross join lateral (select (ceil(((g * 2654435761::bigint) % 4000) / 100.0) + 0.5)::numeric as wt,
                           (300 + (g % 9) * 25)::numeric as rate) w
on conflict (awb_number) do nothing;

insert into public.sales_targets (salesperson_name, target_month, revenue_target, awb_target, weight_target, notes)
select 'Demo ' || n, date_trunc('month', current_date)::date, 2500000, 400, 6000, 'Demo target'
from unnest(array['Aarav','Bhavna','Chetan','Divya']) n
on conflict (salesperson_name, target_month) do nothing;
