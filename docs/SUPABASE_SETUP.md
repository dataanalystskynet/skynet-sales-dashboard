# Supabase setup guide

Project: **Daily Sales Report** · ID `wuswlqaaojluzwxgtptm` · URL `https://wuswlqaaojluzwxgtptm.supabase.co`

The frontend already contains the project URL and the **publishable** key in `js/config.js`. You never need the service_role key in the app.

---

## 1. Run the SQL scripts (in this order)

Supabase Dashboard → **SQL Editor** → *New query* → paste the whole file → **Run**.

| # | File | What it does |
|---|---|---|
| 1 | `database/schema.sql` | Tables, UNIQUE(awb_number), indexes, triggers (profile auto-creation, updated_at) |
| 2 | `database/rls-policies.sql` | Permission helpers, RLS on every table, revokes direct table access, avatar storage bucket |
| 3 | `database/views.sql` | All secure RPC functions used by the app |
| 4 | `database/seed-demo.sql` | *Optional* – 3,000 synthetic AWBs (prefix `DEMO`) for a first look |

All scripts are re-runnable. After an app update, simply run the changed file again.

Check: **Table Editor** shows `shipments, profiles, user_permissions, sales_targets, import_logs, audit_logs, app_settings, exchange_rates, shipment_versions` – each with the RLS shield “enabled”.

## 2. Authentication settings

**Authentication → Sign In / Providers**
* Email provider: **enabled**.
* **Allow new users to sign up: OFF** (only admins create users – very important).
* Confirm email: ON (recommended).

**Authentication → URL Configuration**
* **Site URL**: your GitHub Pages URL, e.g. `https://<github-user>.github.io/skynet-sales-dashboard/`
* **Redirect URLs** – add:
  * `https://<github-user>.github.io/skynet-sales-dashboard/`
  * `https://<github-user>.github.io/skynet-sales-dashboard/**`
  * `http://localhost:8080/**` (local testing)

These are used by *Forgot password*, invitations and e-mail change links.

**Authentication → Sessions** (paid plans) – optionally set an inactivity timeout. The app also logs users out after the idle time configured in *Application Settings* (default 30 min).

**Authentication → Emails → SMTP** – for production, configure your company SMTP so invitations / reset e-mails come from your domain (the built-in sender is rate-limited).

## 3. Storage

`rls-policies.sql` already creates the public **avatars** bucket (2 MB, PNG/JPG/WEBP) with policies so each user can only write inside the folder named after their own user ID. Nothing else to do.

## 4. Create the first admin (secure way)

1. **Authentication → Users → Add user → Create new user** – enter your e-mail and a strong password, tick *Auto Confirm User*.
   The trigger creates a `profiles` row with role `sales` (safe default).
2. SQL Editor → run (replace the e-mail):
   ```sql
   update public.profiles
      set role = 'admin', full_name = 'Your Name', username = 'admin', is_active = true
    where email = 'you@company.com';
   ```
3. Open the site and log in with the e-mail (or user ID `admin`).

Only someone with access to the Supabase dashboard can do this, so nobody can make themselves admin from the browser.

## 5. Load the data

Log in as admin → **Excel Data Import** → upload `booking_report….xlsx` → follow the steps → *Import*. ~20,000 rows take about 1–2 minutes (batches of 500).

## 6. Deploy the `admin-users` Edge Function (for creating users from the app)

Needed for: *Add user*, *Delete user*, *Set new password*, and blocking login of deactivated users at the Auth level. (Editing roles/permissions/mapping works without it.)

Using the Supabase CLI (once):
```bash
npm install -g supabase          # or: brew install supabase/tap/supabase
supabase login
cd skynet-sales-dashboard
supabase link --project-ref wuswlqaaojluzwxgtptm
supabase functions deploy admin-users
# optional – lock CORS to your site:
supabase secrets set ALLOWED_ORIGINS=https://<github-user>.github.io
```
Without the CLI: Dashboard → **Edge Functions → Deploy a new function → Via editor**, name it `admin-users`, paste `supabase/functions/admin-users/index.ts`, Deploy.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase – do **not** add them to the repo.

## 7. Test login & permissions

1. Admin login → all 11 menu items visible.
2. *User Management → Add user* → create a **Sales** user, tick their *Salesperson identity* (pick their name from the list).
3. Log in as that user in a private window → only their own AWBs, customers and revenue appear.
4. Optional API test (proves server-side enforcement) – in the browser console while logged in as the sales user:
   ```js
   const { sb } = await import('./js/api.js');
   await sb().from('shipments').select('*').limit(1);   // -> error: permission denied
   await sb().rpc('admin_list_users');                    // -> error: Not authorised
   ```
5. Create a **Manager** with *Assigned hub* `BOM` → sees only BOM shipments (plus their team salespersons).

## 8. Backup & restore

**Automatic**: Supabase Pro and above keep daily backups (Dashboard → Database → Backups; PITR optional). Free plan has no automatic backups – use the manual method weekly.

**Manual full backup** (Postgres connection string from *Project Settings → Database*):
```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.wuswlqaaojluzwxgtptm.supabase.co:5432/postgres" \
  --schema=public --format=custom --file=skynet_backup_$(date +%d-%m-%Y).dump
```
or `supabase db dump --data-only -f data.sql` with the CLI.

**Restore** into a new/empty project: run the 3 SQL files, then
```bash
pg_restore --data-only --disable-triggers -d "postgresql://postgres:[PASSWORD]@db.<new-ref>.supabase.co:5432/postgres" skynet_backup_DD-MM-YYYY.dump
```
Auth users are stored in the `auth` schema – include `--schema=auth` in pg_dump if you migrate projects.

**Business-level safety nets in the app**
* Imports never delete data; every updated row’s previous version is stored in `shipment_versions`.
* *Excel Data Import → Import history → Roll back* (admin) undoes one import (deletes AWBs it inserted, restores the rows it changed, skips rows changed by a later import).
* Keep the original Excel files – re-importing them is idempotent (same AWBs are just updated).

## 9. Maintenance queries

```sql
-- Data quality overview
select count(*) total, count(*) filter (where salesperson_name is null) unassigned,
       count(*) filter (where 'GRAND_TOTAL_BLANK' = any(data_quality_flags)) blank_total
from shipments;

-- Purge version history older than 90 days (keeps rollback for recent imports)
delete from shipment_versions where created_at < now() - interval '90 days';

-- Remove demo seed
delete from shipments where awb_number like 'DEMO%';
delete from sales_targets where salesperson_name like 'Demo %';
```
