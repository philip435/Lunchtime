# Lunchtime

Daily lunch menus for restaurants near Kungsträdgården, Stockholm. Menus are
scraped by GitHub Actions, archived as JSON in this repo, and served as a tiny
static site on GitHub Pages.

Currently tracked:

- **Grodan Operahuset** — <https://www.grodan.se/operahuset/>
- **Regeringsgatan 21** — <https://rg21.se/>

## How it works

```
┌──────────────┐   cron  ┌────────────────┐   commit   ┌──────────────┐
│ GitHub Action├────────▶│ Node scraper   ├───────────▶│ data/*.json  │
└──────────────┘         │  (selector +   │            └──────┬───────┘
                         │   Claude API)  │                   │
                         └────────────────┘                   ▼
                                                       ┌──────────────┐
                                                       │ GitHub Pages │
                                                       └──────────────┘
```

1. `.github/workflows/scrape.yml` runs Mon–Fri at 07:30 UTC (09:30 Stockholm).
2. `scraper/run.js` loads `data/restaurants.json`, fetches each site, and tries
   the restaurant-specific selector parser in `scraper/restaurants/*.js`.
3. If the selector parser returns nothing, the HTML is sent to Claude
   (`claude-haiku-4-5`) which extracts a structured menu. This is the
   resilience layer — site layouts change, Claude adapts.
4. Results are written to `data/<id>/latest.json` and archived to
   `data/<id>/history/YYYY-Www.json`. The commit is the audit log.
5. `.github/workflows/deploy.yml` publishes `site/` + `data/` to Pages on push.

## Local development

```bash
npm install
npm run scrape:grodan          # scrape just Grodan
FORCE_CLAUDE=1 npm run scrape  # skip selector parser, use Claude directly
```

Needs `ANTHROPIC_API_KEY` if the selector parser can't extract the menu.

Serve the site locally:

```bash
cd site && python3 -m http.server 8000
# Then open http://localhost:8000 — app.js fetches ../data/...
# (For local dev copy or symlink data/ into site/ so relative paths match Pages layout.)
```

## Adding a restaurant

1. Append an entry to `data/restaurants.json` (use a kebab-case `id`). The
   `url` may contain `{YEAR}`, `{MONTH}`, `{WEEK}` tokens (resolved against the
   current ISO week) for sites that publish per-week files like weekly PDFs.
2. Optionally create `scraper/restaurants/<id>.js` exporting `parse(html)`. If
   you skip this — or the source is a PDF — Claude handles extraction directly
   (costs ~cent per run). PDFs are sent to Claude as a document block.
3. Open a PR. The next scheduled run picks it up.

## Required GitHub setup

- Repo secret **`ANTHROPIC_API_KEY`** — needed for the Claude fallback.
- **Settings → Pages → Build and deployment → GitHub Actions** (not "Deploy from a branch").
- **Settings → Actions → General → Workflow permissions → Read and write** so
  the scrape job can commit menu updates.

## Data shape

`data/<id>/latest.json`:

```jsonc
{
  "restaurantId": "grodan-operahuset",
  "restaurantName": "Grodan Operahuset",
  "sourceUrl": "https://www.grodan.se/operahuset/",
  "scrapedAt": "2026-04-23T07:31:12.000Z",
  "extractedBy": "selector",       // or "claude"
  "weekNumber": 17,
  "year": 2026,
  "currency": "SEK",
  "priceNote": "Dagens lunch 165 kr inkl sallad, bröd och kaffe",
  "days": [
    {
      "day": "Måndag",
      "dishes": [
        { "name": "Stekt strömming", "description": null, "category": "Fisk", "price": null }
      ]
    }
  ]
}
```

## Cost

GitHub Actions + Pages: free for public repos. Claude Haiku 4.5: ~1¢ per
restaurant per run when it's used, and the selector parser handles most days
for free. With one restaurant on weekdays that's well under a dollar a month.
