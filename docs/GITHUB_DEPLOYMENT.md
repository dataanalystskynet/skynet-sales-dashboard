# GitHub Pages deployment guide

The dashboard is a static site (no build step). GitHub Pages serves it; Supabase does the data, auth and security.

> **Important – data privacy.** On the free GitHub plan Pages requires a **public** repository. That is fine because the repo only contains code, the publishable key and synthetic sample data. **Never commit real booking reports** – `.gitignore` already blocks `*.xlsx` except `sample-data/`. Business data lives only in Supabase behind RLS.

## 1. Create the repository

1. github.com → **New repository** → name `skynet-sales-dashboard` → Public (or Private with GitHub Pro/Team/Enterprise) → *Create*.

## 2. Upload the files

**Option A – browser (no tools):**
1. Unzip `skynet-sales-dashboard.zip`.
2. In the new repo click **Add file → Upload files**.
3. Drag the *contents* of the folder (index.html, `.nojekyll`, `assets/`, `css/`, `js/`, `vendor/`, `database/`, `docs/`, `supabase/`, `sample-data/`, `README.md`, `.gitignore`) into the page → **Commit changes**.
   *Tip:* hidden files like `.nojekyll` may not be dragged on macOS – create it with **Add file → Create new file**, name `.nojekyll`, leave empty, commit.

**Option B – git:**
```bash
cd skynet-sales-dashboard
git init && git add . && git commit -m "SKYNET sales dashboard"
git branch -M main
git remote add origin https://github.com/<github-user>/skynet-sales-dashboard.git
git push -u origin main
```

## 3. Turn on GitHub Pages

Repo → **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main**, folder **/ (root)** → *Save*.
After 1–2 minutes the site is live at `https://<github-user>.github.io/skynet-sales-dashboard/`.

Routing uses `#/page` hashes, so refreshes and deep links work on Pages without any 404 tricks.

## 4. Point Supabase at the site

Supabase → **Authentication → URL Configuration** → set **Site URL** and add the **Redirect URLs** listed in `docs/SUPABASE_SETUP.md` §2 using your Pages URL. (If you deployed the Edge Function with `ALLOWED_ORIGINS`, use `https://<github-user>.github.io`.)

## 5. Test

1. Open the Pages URL → login screen with the SKYNET logo.
2. Log in with the first admin (see Supabase guide §4).
3. *Excel Data Import* → upload the booking report.
4. Open each dashboard page, change filters, export to Excel.
5. Try *Forgot password* – the e-mail link must return to your Pages URL.

`https://<github-user>.github.io/skynet-sales-dashboard/?demo=1` always opens the offline sandbox (synthetic data) – handy for training.

## 6. Updating

Edit / upload changed files and commit – Pages redeploys automatically. If a release includes changed SQL files, run them again in the Supabase SQL Editor (they are re-runnable).

## Custom domain (optional)

Settings → Pages → *Custom domain* (e.g. `sales.skynetexpress.in`) → add the CNAME record at your DNS provider → tick *Enforce HTTPS* → update Supabase Site URL / Redirect URLs.

## Other hosts

Any static host works the same way (Netlify, Vercel, Cloudflare Pages, an IIS/Apache/Nginx folder): upload the folder, no build command, publish directory = root.
