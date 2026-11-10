# SKYNET EXPRESS INDIA PVT. LTD. – Sales & Business Intelligence Dashboard

A production-ready courier sales dashboard built on **HTML5 + CSS3 + vanilla JavaScript (ES modules)**, **Chart.js**, **SheetJS**, **Lucide icons** and **Supabase** (Postgres, Auth, Storage, Edge Functions, Row Level Security). It is a static site, so it runs on **GitHub Pages** without a build step.

> **Try it first (no setup):** open `index.html?demo=1` through any static server – a full in-browser sandbox with synthetic data, three demo logins and working import/export. You can even import your real booking report there; nothing leaves your browser.

---

## Features

| Area | What you get |
|---|---|
| **Executive Dashboard** | 10 animated 3D KPI cards, daily business summary (latest day vs previous working day), daily booking trend, sales & weight trend (daily / weekly / monthly), growth vs equal previous period, top 10 customers & salespersons, hold vs unhold donut, service mix, best day / month insights |
| **Customer Analysis** | Active / new / returning customers, top 20 by revenue / weight / AWB, revenue comparison vs previous period, top-5 booking trend, acquisition chart, revenue contribution, searchable table with drill-down to every AWB, Excel export |
| **Sales Team Performance** | Leaderboard with ranking, top 10 charts, daily & monthly trends, contribution %, growth %, targets vs actual with achievement & remaining, salesperson drill-down |
| **Country & Hub Analysis** | Top 15 destination countries (CONSIGNEE COUNTRY), contribution, trends, dynamic ORIGIN HUB CODE dropdown with hub KPIs, hub charts, shipper state & city analysis |
| **Daily Sales & Shipment Report** | Server-side paginated / sorted AWB register, AWB search, AWB-state filter, hold summary, full 74-field AWB detail drawer, hold/unhold with mandatory remarks, export filtered data, print, date-wise customer / weight / revenue reports |
| **Excel Import** | 12-step workflow: upload → sheet & header detection → heading normalisation → field mapping (saveable) → preview → validation → in-file duplicates → compare with DB → summary → confirm → batched UPSERT with progress → report + Excel error download; import history and **rollback** |
| **Users & permissions** | Admin / Manager / Sales roles, 18 granular permissions (pages, features, revenue & weight visibility, all / assigned / own data scope), salesperson & hub mapping, invitations, password reset |
| **Other** | Sales targets, My Profile (photo, e-mail, password), audit logs, application settings (session timeout, batch size, approved FX rates), 5 themes × dark/light, notifications, idle auto-logout, responsive (desktop-first, phone hamburger) |

Indian formats everywhere: dates **DD-MM-YYYY**, currency **₹1,00,000.00** (lakh/crore grouping), weights in **KG**.

## Security model (why the publishable key is safe in the browser)

* Every table has **RLS enabled**. The browser roles have **no direct access** to shipments, imports, audit logs or targets – a call to `/rest/v1/shipments` returns *permission denied*.
* All business data flows through **SECURITY DEFINER database functions** (`database/views.sql`) that, on every call, check: logged-in & active → page/feature permission → data scope (*all / assigned hubs+team / own salesperson*) → revenue & weight masking.
* Users cannot change their own role or permissions – `profiles` and `user_permissions` are read-only for the browser; changes go through `admin_update_user()` which checks `user_management`.
* Creating / deleting auth users needs the service role, so it runs in the **`admin-users` Edge Function** on Supabase’s servers. The service role key is **never** in this repository.
* Strict Content-Security-Policy, all dynamic text HTML-escaped, file-type/size validation on upload, idle session expiry, “Remember me” controls whether the session survives a browser restart.

## Folder structure

```
skynet-sales-dashboard/
├── index.html                 Login + app shell (hash routing → GitHub Pages friendly)
├── .nojekyll                  Tell GitHub Pages to serve files as-is
├── assets/images/             Official logo (+ transparent / white variants, favicon)
├── assets/fonts/              Archivo variable font (self-hosted)
├── css/  themes.css · style.css · responsive.css
├── js/
│   ├── config.js              Supabase URL + publishable key, app constants
│   ├── api.js · auth.js       Supabase client, RPC wrapper, login / reset / idle logout
│   ├── app.js                 Boot, shell, router, theme, notifications
│   ├── permissions.js         Permission catalogue + menu definitions (UI only)
│   ├── filters.js             Global filter system
│   ├── utils.js · ui.js · charts.js   Formatting, safe templating, tables, Chart.js helpers
│   ├── dashboard.js · customers.js · sales.js · country-hub.js · shipments.js
│   ├── excel-import.js · users.js · targets.js · profile.js · audit.js · settings.js
│   └── demo.js                In-browser sandbox (?demo=1) mirroring the database logic
├── vendor/                    Chart.js 4.4.4, supabase-js 2.45.4, Lucide 0.453, SheetJS fallback
├── database/
│   ├── schema.sql             Tables, constraints, indexes, triggers
│   ├── rls-policies.sql       Permission helpers, RLS policies, grants, avatar storage
│   ├── views.sql              Secure aggregation + import + admin functions (RPC)
│   └── seed-demo.sql          Optional synthetic test data
├── supabase/functions/admin-users/index.ts   Edge Function (create / delete / password / activate)
├── sample-data/sample_booking_report.xlsx    500 synthetic rows, same 74 columns, for import testing
└── docs/  SUPABASE_SETUP.md · GITHUB_DEPLOYMENT.md · USER_MANUAL.md · DATA_ANALYSIS.md
```

## Quick start

1. **Supabase** – follow [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) (run 3 SQL files, deploy 1 Edge Function, create the first admin).
2. **GitHub Pages** – follow [`docs/GITHUB_DEPLOYMENT.md`](docs/GITHUB_DEPLOYMENT.md).
3. Log in as admin → **Excel Data Import** → upload the booking report → dashboards fill automatically.

Local preview: `python3 -m http.server 8080` in this folder, then open `http://localhost:8080` (or `…/?demo=1`). Opening `index.html` directly from disk will not work because ES modules need http(s).

## Key business rules

* **AWB NUMBER** is unique (DB `UNIQUE` constraint). Import = UPSERT: new AWB → insert, existing AWB → update. Records missing from a new file are **never deleted**.
* Same AWB twice in one file → **latest CREATED DATE wins; on a tie the lower row wins**. Superseded rows appear in the error report as `DUPLICATE`.
* **Revenue = CUSTOMER GRAND TOTAL** (already includes GST – GST is never added again). Treated as INR; if the business owner confirms non-INR billing, choose the currency at import (approved rates in Settings) – originals are preserved.
* **SHIPMENT VALUE** (declared value in 14 currencies) is never summed as revenue.
* Blank salesman → “Unassigned”; blank grand total → ₹0 with a data-quality flag; unknown hold values → NO with a warning. Invalid dates fail the row and are listed in the downloadable error report – nothing is silently discarded.
* All KPIs/totals are calculated in the database over the full filtered set, never from the current table page.

See [`docs/DATA_ANALYSIS.md`](docs/DATA_ANALYSIS.md) for the column-by-column mapping.
