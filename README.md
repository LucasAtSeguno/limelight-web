# Limelight — Hosted Review Dashboard

A hosted web dashboard for monitoring Shopify App Store reviews across multiple apps. Displays star ratings, week-over-week changes, recent review snippets, and unreplied reviews. Automatically updated via GitHub Actions and deployed on Netlify.

---

## How it works

1. A GitHub Actions workflow runs on a schedule (and on demand) and fetches review data from the Shopify App Store
2. The parsed data is committed to `limelight-data.json` in this repo
3. Netlify detects the commit and redeploys the dashboard automatically
4. Team members open the dashboard URL and see up-to-date review data

The dashboard also has an **Update** button that triggers the workflow on demand and reloads the data once it completes.

---

## Tracked apps

- Seguno Email Marketing
- Bulk Discount Code Bot
- Canva Connect

---

## Repo structure

```
├── index.html                          # The dashboard
├── limelight-data.json                 # Review data (auto-updated by workflow)
├── update.js                           # Fetch/parse/commit script (runs in GitHub Actions)
├── netlify.toml                        # Netlify configuration
├── package.json
├── .github/workflows/update.yml        # Scheduled + on-demand GitHub Actions workflow
└── netlify/functions/trigger-update.js # Serverless function for the Update button
```

---

## Setup

### Prerequisites
- A GitHub account
- A Netlify account

### Steps

**1. Push this repo to GitHub**
Create a new repository and push the contents of this folder, including the hidden `.github` directory.

**2. Generate a GitHub personal access token**
Go to `github.com/settings/tokens` and create a token with `repo` scope. Save it — you'll use it in steps 3 and 6.

**3. Add GitHub Actions secrets**
In the repo: Settings → Secrets and variables → Actions → New repository secret

| Secret name | Value |
|---|---|
| `PERSONAL_ACCESS_TOKEN` | Your GitHub personal access token |
| `NETLIFY_HOOK_URL` | Your Netlify build hook URL (generated in step 5) |

**4. Connect repo to Netlify**
In Netlify: Add new site → Import an existing project → select this repo
- Build command: *(leave blank)*
- Publish directory: `.`

**5. Create a Netlify build hook**
In Netlify: Site configuration → Build & deploy → Build hooks → Add build hook
Name it "GitHub Actions" and copy the URL → add it as `NETLIFY_HOOK_URL` in step 3.

**6. Add Netlify environment variables**
In Netlify: Site configuration → Environment variables

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | Your GitHub personal access token (same as step 2) |
| `GITHUB_REPO` | Your repo in `username/repo-name` format |

**7. Deploy**
Push any small change to trigger the first Netlify deploy. The dashboard will be live at your Netlify URL.

---

## Configuration

### Changing the update schedule
Edit `.github/workflows/update.yml`. The cron expression controls when the workflow runs:

```yaml
schedule:
  - cron: '0 14,20 * * 1-5'  # 9am and 3pm Eastern, weekdays
```

Cron format: `minute hour day month weekday`. Use [crontab.guru](https://crontab.guru) to build expressions. All times are UTC.

### Adding or removing tracked apps
Edit the `APPS` array near the top of `update.js`:

```js
const APPS = [
  { id: 'seguno',                   name: 'Seguno Email Marketing', url: 'https://apps.shopify.com/seguno/reviews' },
  { id: 'bulk-discount-generator', name: 'Bulk Discount Code Bot', url: 'https://apps.shopify.com/bulk-discount-generator/reviews' },
  { id: 'canva-connect',           name: 'Canva Connect',          url: 'https://apps.shopify.com/canva-connect/reviews' },
];
```

Also update the `APPS` array in `index.html` to match.

### Adjusting the unreplied review cutoff date
In `update.js`, find this line inside `fetchUnreplied`:

```js
const CUTOFF = new Date('2026-01-01');
```

Replace with your desired cutoff date in `YYYY-MM-DD` format.

---

## Notes

- `limelight-data.json` is committed automatically by the workflow — do not edit it manually
- The GitHub personal access token should be rotated periodically (GitHub recommends annually)
- All review data displayed is publicly available on the Shopify App Store
#limelight-web
