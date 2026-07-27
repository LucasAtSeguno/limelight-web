#!/usr/bin/env node
/**
 * Limelight update script
 * Fetches review data from Shopify App Store and commits limelight-data.json to GitHub.
 * Runs via GitHub Actions on a schedule or on demand.
 * No external dependencies required — uses Node.js built-in fetch.
 */

const APPS = [
  { id: 'seguno',                   name: 'Seguno Email Marketing', url: 'https://apps.shopify.com/seguno/reviews' },
  { id: 'bulk-discount-generator', name: 'Bulk Discount Code Bot', url: 'https://apps.shopify.com/bulk-discount-generator/reviews' },
  { id: 'canva-connect',           name: 'Canva Connect',          url: 'https://apps.shopify.com/canva-connect/reviews' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ── Fetch helpers ── */
async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  if (!html || html.length < 500) throw new Error(`Response too short for ${url}`);
  return html;
}

function splitReviewBlocks(html) {
  const parts = html.split(/(?=<div\s+data-merchant-review=""\s+data-review-content-id=")/);
  return parts.filter(p => /^<div\s+data-merchant-review=""/.test(p));
}

function decodeEntities(str) {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/* ── Parse one app page ── */
function parsePage(html) {
  // Overall rating
  const ratingMatch = html.match(/aria-label="(\d\.\d) out of 5 stars"/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  // Total reviews
  let total = null;
  for (const m of html.matchAll(/<h2[^>]*>([\s\S]{0,400}?)<\/h2>/g)) {
    const stripped = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const n = stripped.match(/Reviews\s*\(([\d,]+)\)/);
    if (n) { total = parseInt(n[1].replace(/,/g, '')); break; }
  }

  // Star counts — use href param to handle zero-count tiers Shopify omits
  const stars = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const m of html.matchAll(/aria-label="([\d,]+) total reviews"[^>]*href="[^"]*ratings%5B%5D=(\d)"/g)) {
    const star = parseInt(m[2]);
    if (star >= 1 && star <= 5) stars[star] = parseInt(m[1].replace(/,/g, ''));
  }

  return { rating, total, stars };
}

/* ── Parse snippets from newest-sorted page ── */
function parseSnippets(html) {
  const snippets = [];
  const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/;

  for (const rawBlock of splitReviewBlocks(html)) {
    if (snippets.length >= 3) break;
    const block = rawBlock.replace(/<svg[\s\S]*?<\/svg>/g, '');
    const replyIdx = block.indexOf('data-merchant-review-reply');
    const reviewPart = replyIdx > -1 ? block.slice(0, replyIdx) : block;

    const pMatch = reviewPart.match(/<p[^>]*>([\s\S]+?)<\/p>/);
    if (!pMatch) continue;
    const text = pMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 220);
    if (text.length < 20) continue;

    const titles = [...reviewPart.matchAll(/title="([^"]{2,80})"/g)].map(m => m[1]);
    const store = decodeEntities(titles.find(t => t !== 'Copy link to review') || 'Unknown');
    const dateMatch = reviewPart.match(datePattern);
    const starMatch = reviewPart.match(/aria-label="(\d) out of 5 stars"/);

    snippets.push({
      text,
      meta: `${store} · ${dateMatch ? dateMatch[0] : ''}`,
      stars: starMatch ? parseInt(starMatch[1]) : null,
    });
  }

  return snippets;
}

/* ── Parse unreplied reviews (5 pages, newest first) ── */
async function fetchUnreplied(app) {
  const unreplied = [];
  const slug = app.url.replace('https://apps.shopify.com/', '').replace('/reviews', '');
  const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/;
  const CUTOFF = new Date('2026-01-01');

  for (let page = 1; page <= 5; page++) {
    let html;
    try { html = await fetchHtml(`${app.url}?sort_by=newest&page=${page}`); } catch(e) { break; }

    for (const rawBlock of splitReviewBlocks(html)) {
      const block = rawBlock.replace(/<svg[\s\S]*?<\/svg>/g, '');
      const idMatch = rawBlock.match(/data-review-content-id="(\d+)"/);
      if (!idMatch) continue;
      const reviewId = idMatch[1];

      const replyIdx = block.indexOf('data-merchant-review-reply');
      if (replyIdx > -1 && /id="review-reply-\d+"/.test(block.slice(replyIdx))) continue;

      const reviewPart = replyIdx > -1 ? block.slice(0, replyIdx) : block;
      const pMatch = reviewPart.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (!pMatch) continue;

      const rawText = pMatch[1].replace(/<[^>]+>/g, '').trim();
      const text = rawText.slice(0, 300);
      const ratingOnly = rawText.length === 0;

      const titles = [...reviewPart.matchAll(/title="([^"]{2,80})"/g)].map(m => m[1]);
      const store = decodeEntities(titles.find(t => t !== 'Copy link to review') || 'Unknown');
      const dateMatch = reviewPart.match(datePattern);
      const starMatch = reviewPart.match(/aria-label="(\d) out of 5 stars"/);

      if (dateMatch && new Date(dateMatch[0]) < CUTOFF) continue;

      unreplied.push({
        reviewId,
        store,
        date: dateMatch ? dateMatch[0] : '',
        stars: starMatch ? parseInt(starMatch[1]) : null,
        text,
        ratingOnly,
        url: `https://apps.shopify.com/reviews/${reviewId}`,
      });
    }

    await new Promise(r => setTimeout(r, 150));
  }

  return unreplied;
}

/* ── Fetch all data for all apps ── */
async function fetchAllData() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const label = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const checkedAt = today.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

  const snapApps = {};
  const unrepliedResults = {};

  for (const app of APPS) {
    console.log(`Fetching ${app.name}…`);

    // Fetch main page and newest-sorted page in parallel
    const [mainHtml, newestHtml] = await Promise.all([
      fetchHtml(app.url),
      fetchHtml(`${app.url}?sort_by=newest`),
    ]);

    const { rating, total, stars } = parsePage(mainHtml);
    const snippets = parseSnippets(newestHtml);
    snapApps[app.id] = { rating, total, stars, snippets };

    console.log(`  ${app.name}: ${total} reviews, ${rating}★`);

    // Unreplied
    console.log(`  Checking unreplied for ${app.name}…`);
    unrepliedResults[app.id] = await fetchUnreplied(app);
    console.log(`  ${app.name}: ${unrepliedResults[app.id].length} unreplied`);
  }

  return {
    snapshot: { date: dateStr, label, apps: snapApps },
    unreplied: { checkedAt, results: unrepliedResults },
  };
}

/* ── Load existing data from GitHub ── */
async function loadExistingData(token, repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/limelight-data.json`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return { file: null, sha: null, data: null };
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const file = await res.json();
  const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  return { sha: file.sha, data };
}

/* ── Commit updated data to GitHub ── */
async function commitData(token, repo, data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = {
    message: `Update review data — ${new Date().toISOString().slice(0, 10)} [skip netlify]`,
    content,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/limelight-data.json`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub commit failed: ${res.status} — ${err.message}`);
  }
  return res.json();
}

/* ── Main ── */
async function main() {
  const token = process.env.PERSONAL_ACCESS_TOKEN;
  const repo  = process.env.GITHUB_REPO;

  if (!token || !repo) {
    throw new Error('PERSONAL_ACCESS_TOKEN and GITHUB_REPO environment variables are required');
  }

  console.log('Loading existing data…');
  const { sha, data: existing } = await loadExistingData(token, repo);

  console.log('Fetching fresh review data…');
  const { snapshot, unreplied } = await fetchAllData();

  // Merge new snapshot into existing history
  const snapshots = existing?.snapshots?.snapshots || [];
  const existingIdx = snapshots.findIndex(s => s.date === snapshot.date);
  if (existingIdx !== -1) {
    snapshots[existingIdx] = snapshot;
    console.log(`Updated existing snapshot for ${snapshot.date}`);
  } else {
    snapshots.push(snapshot);
    console.log(`Added new snapshot for ${snapshot.date}`);
  }

  const newData = {
    snapshots: { snapshots },
    unreplied,
  };

  console.log('Committing to GitHub…');
  await commitData(token, repo, newData, sha);
  console.log('Done! Dashboard will redeploy shortly.');
}

main().catch(err => {
  console.error('Update failed:', err.message);
  process.exit(1);
});
