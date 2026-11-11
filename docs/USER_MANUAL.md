# User manual – SKYNET Sales Intelligence

## Logging in
* Enter your registered **mobile number** (10 digits; +91, spaces and dashes are ignored) and password. Several users may share one e-mail address – the mobile number identifies each person. On the first login with a default / admin-set password you must choose your own password.
* Forgot your password? Ask the admin to use **Reset to default password** or **Set new password** in User Management.
* Tick **Remember me** to stay logged in after closing the browser (leave it unticked on shared computers).
* **Forgot password?** sends a secure reset link to your e-mail.
* You are logged out automatically after the inactivity time set by the administrator (a warning appears 1 minute before).

## The screen
* **Left menu** – hover to expand, move away to collapse; the pin keeps it open. On a phone use the ☰ button. You only see pages you have permission for.
* **Top bar** – page title, global date range, **Origin Hub** selector, notifications (recent imports and hold changes), theme (5 colour themes, dark/light), and your profile menu.
* **Filter bar** – Period, Customer name, Customer code, Salesperson, Destination country, Hold status → **Apply filters**. **Reset** returns to the last 30 days. Active filters show as chips; click × on a chip to remove one. Filters apply to every analysis page and work together.
* All numbers follow Indian formats: ₹1,00,000.00, DD-MM-YYYY, KG.

## Pages
**Executive Dashboard** – headline KPIs with growth against the previous period of the same length, latest business day vs previous working day, trends (switch Daily / Weekly / Monthly), top customers and salespersons (switch Revenue / Shipments / Weight), hold vs unhold, insights.

**Customer Analysis** – customer KPIs including new customers (first-ever booking inside the period) and returning customers. Click a bar or a table row to open the customer and see every AWB; **Export Excel** downloads the customer report.

**Sales Team Performance** – leaderboard, rankings, contribution %, growth %, daily & monthly trends, and **Target vs actual** for the month. Click a salesperson for their drill-down. Targets appear only when an administrator has set them.

**Country & Hub Analysis** – destination countries (from CONSIGNEE COUNTRY); click a country to filter everything by it. Pick a hub in *Origin hub analysis* to see its KPIs. Shipper state and city analysis at the bottom.

**Daily Sales & Shipment Report** – every AWB for the filters. Search by AWB / customer, filter by AWB state, sort any column, change rows per page.
* Click an **AWB number** to see all 74 Excel fields, financial breakdown and status history.
* **Put on hold / Release hold** (if permitted) – remarks are mandatory; the change is logged with old status, new status, user and date-time.
* **Export filtered data** (all matching rows, not just the page), **Date-wise reports** (customer bookings, revenue & weight per day, salesperson per day), **Print**, **Download AWB report**.

## Excel Data Import (admin / authorised users)
1. Drop the booking report (.xlsx/.xls/.csv).
2. Choose the sheet (*Worksheet* is picked automatically). The header row is detected and headings are cleaned (e.g. the line break in “ORIGIN HUB CODE”).
3. Check the column mapping. AWB NUMBER and CREATED DATE are required. Unmapped columns are still stored. Admins can **Save mapping** so future files with different headings map automatically.
4. Preview the first rows.
5. **Validate & check duplicates** – you see total rows, new AWBs, existing AWBs (to be updated), duplicate rows inside the file, failed rows and warnings. **Download issues** gives an Excel list with row numbers and reasons.
6. Confirm the billing currency (INR unless told otherwise), tick the confirmation and **Import**. Keep the tab open until it finishes.
7. The report shows inserted / updated / failed. Download the error report if needed.

Rules: existing AWBs are updated, new ones inserted, nothing is deleted. If an AWB appears twice in a file, the row with the latest CREATED DATE is used (tie → the lower row). Admins can **Roll back** an import from *Import history*.

## Administration
**User Management** – *Add user* with a **mobile number (login ID, unique)**, optional e-mail (may be shared), and the **default password** (set once in Application Settings → Default password), a custom password or an invitation e-mail. *Reset to default password* works per user or for all users at once. Role, user ID, **assigned hubs** (manager scope), **salesperson identity** (the SALESMAN NAME value(s) the user is – required for Sales users), **team salespersons** (manager), active/inactive and permissions. Each permission can stay on *Default* (role-based) or be overridden. Data scope = the most restrictive of Customer / Shipment / Salesperson visibility:
* *All* – everything; *Assigned* – assigned hubs + team salespersons + own; *Own* – only AWBs where SALESMAN NAME is the user’s identity.
Revenue / Weight visibility = *Deny* hides those numbers everywhere (shown as “Restricted”). Export users downloads non-sensitive details only – passwords are never stored or exported.

**Sales Target Management** – choose a month → *Add / edit target* → revenue (₹), AWB and/or weight (KG) target per salesperson. Blank = no target for that metric.

**Audit Logs** – searchable history of hold changes, imports, rollbacks, user, target and setting changes; exportable.

**Application Settings** – default password (stored only on the server), company name, auto-logout minutes, table page size, User-ID login on/off, import batch size, max upload size, billing currency and approved exchange rates, saved column mappings.

## My Profile
Change name, mobile, photo (PNG/JPG/WEBP up to 2 MB), e-mail (confirmation link required) and password (current password required). Your permissions are listed at the bottom.

## Role summary
| | Admin | Manager (default) | Sales (default) |
|---|---|---|---|
| Data scope | All | Assigned hubs + team | Own salesperson |
| Pages | All | All analysis pages | Dashboard, Customers, Sales, Shipments |
| Hold change | ✓ | ✓ | – |
| Excel import | ✓ | – | – |
| Export | ✓ | ✓ | ✓ (own data) |
| Users / Targets / Audit / Settings | ✓ | – | – |

Admins can change any of these per user at any time.
