# ScoopScore — NZ Supplement Price Tracker

Scrapes supplement prices from NZ retailers daily and serves them on a clean comparison website.

---

## Retailers tracked

| Store | Platform | Free shipping | Status |
|---|---|---|---|
| NZ Muscle | Shopify | Always free | ✅ Active |
| Sportsfuel | Shopify | $60+ | ✅ Active |
| Scorpion Supplements | Shopify | Check site | ✅ Active |
| ASN Online | Shopify | $100+ | ✅ Active |
| Supplement Solutions | Shopify | Check site | ✅ Active |
| Raisey's | Shopify | Check site | ✅ Active |
| Xplosiv | Magento | $100+ | ✅ Active (JSON-LD scraper) |
| Sprint Fit | Custom | Check site | ✅ Active (JSON-LD scraper) |

**To add more stores:** Shopify stores take 5 minutes — just add a line to the `RETAILERS` array. Non-Shopify stores need a custom scraper function.

---

## How it works

```
scraper.js  →  data/products.json  →  index.html (reads on load)
```

1. **Shopify retailers** — hits `/products.json` endpoint, gets all products + prices in one API call per page
2. **Xplosiv (Magento)** — fetches category pages, extracts JSON-LD structured data embedded in HTML
3. **Sprint Fit (custom)** — same JSON-LD approach
4. All results written to `data/products.json` with price history preserved
5. `index.html` loads `data/products.json` on startup

---

## Setup

```bash
# 1. Clone your repo
git clone https://github.com/YOUR_USERNAME/scoopscore.git
cd scoopscore

# 2. Run scraper to generate data
node scraper.js

# 3. Check output
cat data/products.json | head -50

# 4. Commit and push
git add data/products.json data/scrape.log
git commit -m "initial price data"
git push
```

Vercel auto-deploys on every push.

---

## Daily automation

`.github/workflows/daily-scrape.yml` runs every day at 6am NZT automatically. To trigger manually: **Actions → Daily Price Scrape → Run workflow**

---

## Adding a Shopify store

```javascript
{
  id:          'storeid',
  name:        'Store Name',
  baseUrl:     'storename.co.nz',
  url:         'https://storename.co.nz/products.json',
  currency:    'NZD',
  freeShipping: '$100+',
  platform:    'shopify',
  categoryMap: SHARED_CATEGORY_MAP,  // reuses the shared map
}
```

Any Shopify store exposes `yourstore.com/products.json` publicly. To check if a store is Shopify, look for "Powered by Shopify" in their page footer, or check aftership.com/brands/storename.

---

## File structure

```
scoopscore/
├── index.html          ← website
├── scraper.js          ← price scraper
├── package.json
├── data/
│   ├── products.json   ← generated daily
│   └── scrape.log      ← scrape history
└── .github/
    └── workflows/
        └── daily-scrape.yml
```

Automatically scrapes supplement prices from NZ retailers daily and
serves them on a clean comparison website.

---

## How it works

```
scraper.js  →  data/products.json  →  index.html (reads on load)
```

1. **scraper.js** hits NZ Muscle's public Shopify API (`/products.json`)
2. Filters to supplements only, extracts prices and variants
3. Writes everything to `data/products.json` (preserving price history)
4. **index.html** fetches `data/products.json` when it loads
5. If no local file exists, it falls back to hitting the Shopify API directly

---

## Setup

### Prerequisites
- Node.js 18+ (https://nodejs.org)
- Git + GitHub account
- Vercel account (https://vercel.com)

### First time setup

```bash
# 1. Clone your repo
git clone https://github.com/YOUR_USERNAME/scoopscore.git
cd scoopscore

# 2. Run the scraper manually to generate data/products.json
node scraper.js

# 3. Check what was scraped
cat data/products.json | head -100

# 4. Commit the data
git add data/products.json data/scrape.log
git commit -m "initial price data"
git push
```

Vercel will auto-deploy on every push.

---

## Daily automation (GitHub Actions)

The `.github/workflows/daily-scrape.yml` runs the scraper every day at
6am NZT. It:
1. Checks out your repo
2. Runs `node scraper.js`
3. Commits the updated `data/products.json` back to the repo
4. Vercel auto-deploys the updated data

**To enable:**
1. Push this repo to GitHub
2. Go to Settings → Actions → General → Allow all actions
3. That's it — it runs automatically every night

**To trigger manually:**
Go to Actions tab → "Daily Price Scrape" → "Run workflow"

---

## Adding more retailers

Open `scraper.js` and add entries to the `RETAILERS` array:

```javascript
{
  id:      'sprintfit',
  name:    'Sprint Fit',
  baseUrl: 'www.sprintfit.co.nz',
  url:     'https://www.sprintfit.co.nz/products.json',
  currency:'NZD',
  categoryMap: {
    'Pre-Workout': 'preworkout',
    'Protein':     'protein',
    // ... etc
  }
}
```

Any Shopify store exposes `yourstore.com/products.json` publicly.
Check if a store is on Shopify: look for "cdn.shopify.com" in their
page source.

**NZ stores on Shopify (confirmed):**
- nzmuscle.co.nz ✓
- sprintfit.co.nz ✓ (check their products.json)
- sportsfuel.co.nz ✓ (check their products.json)

---

## Price history

Every time `scraper.js` runs, it checks if the price changed since
last time. If it did, it appends to `priceHistory`:

```json
"priceHistory": [
  { "price": 59.99, "date": "2026-04-01" },
  { "price": 54.99, "date": "2026-04-08" },
  { "price": 49.99, "date": "2026-04-15" }
]
```

The website shows this as a bar chart in each product modal.

---

## File structure

```
scoopscore/
├── index.html          ← website (reads data/products.json)
├── scraper.js          ← price scraper (runs daily)
├── package.json
├── data/
│   ├── products.json   ← generated by scraper (committed to git)
│   └── scrape.log      ← scrape history log
└── .github/
    └── workflows/
        └── daily-scrape.yml  ← GitHub Actions automation
```

---

## Monetisation notes

Once you have traffic:
1. Sign up for NZ Muscle affiliate: email hello@nzmuscle.co.nz
2. Sprint Fit affiliate: check their website footer
3. Add `?ref=scoopscore` to outbound links once you have codes
4. You earn 5–10% commission on every sale you refer
