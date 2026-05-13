# ScoopScore — NZ Supplement Price Tracker

Scrapes supplement prices from NZ retailers daily and serves them via a static website hosted on Vercel.

---

## How it works

```
scraper.js  →  data/products.json  →  git push  →  Vercel auto-deploys  →  index.html
```

1. `scraper.js` runs on your machine (scheduled via cron at 3am)
2. Fetches all products from each retailer's public `/products.json` endpoint
3. Filters and categorises supplements, preserves price history
4. Writes to `data/products.json`
5. Git commits and pushes — Vercel picks it up automatically
6. `index.html` fetches `data/products.json` on page load

No server, no cloud functions, no cost.

---

## Retailers tracked

| Store | Method | Free shipping |
|---|---|---|
| NZ Muscle | products.json | Always free |
| Sportsfuel | products.json | Free over $60 |
| Scorpion Supplements | products.json | Check site |
| ASN Online | products.json | Free over $100 |
| Supplement Solutions | products.json | Check site |
| Raisey's | products.json | Check site |
| BodyStrong | products.json | Check site |
| Bargain Chemist | products.json | Free shipping |
| Payless Supplements | products.json | Free shipping |
| Supplements NZ | products.json | Free shipping |
| Reactiv Supplements | products.json | Free NZ-wide |
| Eat Me Supplements | products.json | Check site |
| Kiwi Nutrition | products.json | Check site |
| Elite Supplements | products.json | Check site |
| Nutrition Warehouse | products.json | Free over $60 |

---

## Categories

`protein` · `proteinbars` · `rtd` · `creatine` · `preworkout` · `fatburner` · `bcaa` · `vitamins`

---

## Setup

### Prerequisites
- Node.js 18+ — https://nodejs.org
- Git with push access to your repo

### First run

```bash
# Clone your repo and go into it
git clone https://github.com/YOUR_USERNAME/scoopscore.git
cd scoopscore

# Run the scraper once manually to generate data/products.json
node scraper.js

# Commit the data and push (Vercel auto-deploys)
git add data/products.json data/scrape.log
git commit -m "initial price data"
git push
```

---

## Scheduling — Mac (cron)

This runs the scraper every day at 3am, commits, and pushes automatically.

### 1. Create the run script

Create a file called `run-scrape.sh` in your project folder:

```bash
#!/bin/bash
cd /path/to/your/scoopscore   # ← change this to your actual folder path

node scraper.js

git add data/products.json data/scrape.log
git diff --staged --quiet || git commit -m "chore: daily price update $(date +%Y-%m-%d)"
git push
```

Make it executable:

```bash
chmod +x run-scrape.sh
```

### 2. Add to cron

Open your crontab:

```bash
crontab -e
```

Add this line (replace the path):

```
0 3 * * * /path/to/your/scoopscore/run-scrape.sh >> /path/to/your/scoopscore/data/cron.log 2>&1
```

This runs at **3am every day**. To change the time, use https://crontab.guru.

### 3. Make sure your Mac doesn't sleep

Cron won't fire if your Mac is asleep. Two options:

**Option A — Keep it awake at 3am:**
System Settings → Battery → uncheck "Put hard disks to sleep when possible" and set "Prevent automatic sleeping" to Never (or just on Power Adapter).

**Option B — Use `caffeinate` in the script:**
Change the cron line to:

```
0 3 * * * caffeinate -i /path/to/your/scoopscore/run-scrape.sh >> /path/to/your/scoopscore/data/cron.log 2>&1
```

**Option C — Schedule your Mac to wake at 3am:**
System Settings → Battery → Schedule → tick "Wake for network access" or set a custom wake time.

### Verify it's working

```bash
# Check cron is registered
crontab -l

# After the first scheduled run, check the log
cat data/cron.log

# Check last scrape time
node -e "const d=require('./data/products.json'); console.log(d.meta.updatedAt, d.meta.totalProducts, 'products')"
```

---

## Scheduling — Windows (Task Scheduler)

```
1. Open Task Scheduler → Create Basic Task
2. Name: ScoopScore Scrape
3. Trigger: Daily at 3:00 AM
4. Action: Start a program
   Program: C:\path\to\node.exe  (find with: where node)
   Arguments: scraper.js
   Start in: C:\path\to\scoopscore\
5. Finish
```

Then create a separate task or add a script to git commit/push after.

---

## Scheduling — Linux (cron)

Same as Mac — `crontab -e` then:

```
0 3 * * * /path/to/scoopscore/run-scrape.sh >> /path/to/scoopscore/data/cron.log 2>&1
```

---

## Running manually anytime

```bash
node scraper.js
```

Takes about 2–3 minutes. Uses minimal bandwidth (~5MB total).

---

## Adding a retailer

In `scraper.js`, add a line to the `RETAILERS` array:

```javascript
{ id: 'storeid', name: 'Store Name', baseUrl: 'storename.co.nz', freeShipping: 'Free over $X' },
```

Any Shopify store exposes `/products.json` publicly. To check if a store is on Shopify: look for "Powered by Shopify" in their footer, or try visiting `storename.co.nz/products.json` directly — if it returns JSON, it works.

---

## File structure

```
scoopscore/
├── index.html              ← website
├── scraper.js              ← price scraper (run this)
├── run-scrape.sh           ← cron wrapper script (you create this)
├── package.json
├── data/
│   ├── products.json       ← generated by scraper (committed to git)
│   ├── scrape.log          ← scraper output log
│   └── cron.log            ← cron run log (add to .gitignore)
└── .github/
    └── workflows/
        └── daily-scrape.yml  ← (disabled — kept for reference only)
```

---

## Troubleshooting

**Scraper returns 0 products for a store**
The store is rate-limiting. The scraper retries automatically (up to 3x with backoff). If it still fails, wait a few hours and run again — the next day's scheduled run will catch it.

**Git push fails in cron**
Make sure your SSH key or credential helper is set up for the terminal environment (not just the GUI). Test with: `cd /your/project && git push` in a plain terminal (not VS Code).

**Mac doesn't run cron at 3am**
Check System Settings → Privacy & Security → Full Disk Access — add Terminal or your shell (`/bin/bash`, `/bin/zsh`) to the list. macOS sometimes blocks cron from accessing files otherwise.

**Check what was scraped**

```bash
node -e "
  const d = require('./data/products.json');
  const m = d.meta;
  console.log('Updated:', m.updatedAt);
  console.log('Total:', m.totalProducts);
  console.log('By retailer:', JSON.stringify(m.retailerStats, null, 2));
  console.log('By category:', JSON.stringify(m.categories, null, 2));
"
```
