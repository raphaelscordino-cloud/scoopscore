/**
 * ScoopScore Price Scraper
 * ─────────────────────────────────────────────────────────────
 * Hits NZ Muscle's public Shopify JSON API (/products.json)
 * and any other configured retailers, then writes a clean
 * products.json that the website reads at load time.
 *
 * Run manually:  node scraper.js
 * Run daily:     add to cron (see README) or use GitHub Actions
 * ─────────────────────────────────────────────────────────────
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── CONFIG ────────────────────────────────────────────────────
const OUT_FILE = path.join(__dirname, 'data', 'products.json');
const LOG_FILE = path.join(__dirname, 'data', 'scrape.log');

// Retailers with public Shopify JSON endpoints
const RETAILERS = [
  {
    id:       'nzmuscle',
    name:     'NZ Muscle',
    baseUrl:  'nzmuscle.co.nz',
    url:      'https://nzmuscle.co.nz/products.json',
    currency: 'NZD',
    // Categories we care about — maps Shopify product_type → our category
    categoryMap: {
      'Whey Protein':          'protein',
      'Isolate Protein':       'protein',
      'Plant Based Protein':   'protein',
      'Mass Gainer':           'protein',
      'Protein Blend':         'protein',
      'Casein Protein':        'protein',
      'Creatine':              'creatine',
      'Creatine Monohydrate':  'creatine',
      'Pre-Workout':           'preworkout',
      'Pre Workout':           'preworkout',
      'Fat Burner':            'fatburner',
      'Weight Loss':           'fatburner',
      'BCAA':                  'bcaa',
      'BCAAs':                 'bcaa',
      'EAA':                   'bcaa',
      'Amino Acids':           'bcaa',
    }
  }
  // Add more retailers here as you grow, e.g.:
  // { id: 'sprintfit', name: 'Sprint Fit', baseUrl: 'sprintfit.co.nz', url: 'https://www.sprintfit.co.nz/products.json', currency: 'NZD', categoryMap: {...} }
];

// Supplement-relevant keywords — skip clothing, equipment etc.
const SUPP_KEYWORDS = [
  'protein', 'creatine', 'pre-workout', 'pre workout', 'bcaa', 'eaa',
  'amino', 'fat burner', 'oxyshred', 'whey', 'isolate', 'casein',
  'mass gainer', 'weight loss', 'thermogenic', 'caffeine', 'glutamine',
  'collagen', 'vitamin', 'omega', 'magnesium', 'zinc', 'electrolyte',
  'pump', 'nitric oxide', 'carnitine', 'cla', 'greens'
];

const SUPP_EXCLUDE = [
  'shaker', 'bottle', 'bag', 'shirt', 't-shirt', 'shorts', 'legging',
  'singlet', 'rack', 'bench', 'dumbbell', 'barbell', 'kettlebell',
  'resistance band', 'skipping', 'mat', 'glove', 'belt', 'wrap',
  'treadmill', 'rower', 'boxing', 'flooring', 'ice bath'
];

// ─── UTILITIES ─────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function fetchJSON(url, page = 1) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${url}?limit=250&page=${page}`;
    https.get(fullUrl, {
      headers: {
        'User-Agent': 'ScoopScore/1.0 (price comparison tool; contact@scoopscore.co.nz)'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error for ${fullUrl}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Pause between requests — be polite to retailers
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CATEGORY DETECTION ────────────────────────────────────────
function detectCategory(product, categoryMap) {
  // 1. Check product_type against our map
  const pt = (product.product_type || '').toLowerCase();
  for (const [key, cat] of Object.entries(categoryMap)) {
    if (pt.includes(key.toLowerCase())) return cat;
  }

  // 2. Check tags
  const tags = (product.tags || []).map(t => t.toLowerCase()).join(' ');
  if (tags.includes('protein') || tags.includes('whey') || tags.includes('casein') || tags.includes('isolate')) return 'protein';
  if (tags.includes('creatine')) return 'creatine';
  if (tags.includes('pre-workout') || tags.includes('pre workout')) return 'preworkout';
  if (tags.includes('fat burner') || tags.includes('weight loss') || tags.includes('thermogenic')) return 'fatburner';
  if (tags.includes('bcaa') || tags.includes('eaa') || tags.includes('amino')) return 'bcaa';

  // 3. Scan title
  const title = product.title.toLowerCase();
  if (title.includes('whey') || title.includes('protein') || title.includes('isolate') || title.includes('casein') || title.includes('mass gainer')) return 'protein';
  if (title.includes('creatine')) return 'creatine';
  if (title.includes('pre-workout') || title.includes('pre workout') || title.includes('preworkout')) return 'preworkout';
  if (title.includes('oxyshred') || title.includes('fat burn') || title.includes('thermogenic') || title.includes('shred')) return 'fatburner';
  if (title.includes('bcaa') || title.includes('amino') || title.includes('eaa')) return 'bcaa';

  return null; // not a supplement we track
}

function isSupplementProduct(product) {
  const text = `${product.title} ${product.product_type} ${(product.tags || []).join(' ')}`.toLowerCase();
  const isSupp = SUPP_KEYWORDS.some(kw => text.includes(kw));
  const isExcluded = SUPP_EXCLUDE.some(kw => text.includes(kw));
  return isSupp && !isExcluded;
}

// ─── EXTRACT CLEAN PRODUCT DATA ────────────────────────────────
function extractProduct(raw, retailer) {
  const category = detectCategory(raw, retailer.categoryMap);
  if (!category) return null;
  if (!isSupplementProduct(raw)) return null;
  if (!raw.variants || raw.variants.length === 0) return null;

  // Get available variants only
  const variants = raw.variants.filter(v => v.available !== false);
  if (variants.length === 0) return null;

  // Lowest price across variants
  const prices = variants
    .map(v => parseFloat(v.price))
    .filter(p => !isNaN(p) && p > 0);
  if (prices.length === 0) return null;

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Build variant list for size/flavour options
  const variantList = variants.map(v => ({
    id:      v.id,
    title:   v.title,        // e.g. "Chocolate / 1Kg"
    price:   parseFloat(v.price),
    sku:     v.sku || '',
    available: v.available !== false
  }));

  return {
    id:          `${retailer.id}_${raw.id}`,
    sourceId:    raw.id,
    retailer:    retailer.id,
    retailerName: retailer.name,
    brand:       raw.vendor || 'Unknown',
    name:        raw.title,
    category,
    description: raw.body_html
      ? raw.body_html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
      : '',
    tags:        (raw.tags || []).slice(0, 8),
    priceFrom:   minPrice,
    priceTo:     maxPrice > minPrice ? maxPrice : null,
    currency:    retailer.currency,
    variants:    variantList,
    url:         `https://${retailer.baseUrl}/products/${raw.handle}`,
    imageUrl:    raw.images && raw.images[0] ? raw.images[0].src : null,
    updatedAt:   new Date().toISOString(),
    // Price history — we'll track this over time
    priceHistory: []
  };
}

// ─── MERGE WITH EXISTING DATA (preserve price history) ─────────
function mergeWithExisting(newProducts, existingProducts) {
  const existingMap = {};
  for (const p of existingProducts) {
    existingMap[p.id] = p;
  }

  return newProducts.map(newP => {
    const existing = existingMap[newP.id];
    if (!existing) return newP;

    // Append to price history if price changed
    const history = existing.priceHistory || [];
    const lastEntry = history[history.length - 1];
    const priceChanged = !lastEntry || lastEntry.price !== newP.priceFrom;

    if (priceChanged && lastEntry) {
      history.push({
        price: newP.priceFrom,
        date:  new Date().toISOString().split('T')[0]
      });
      // Keep last 90 days of history
      while (history.length > 90) history.shift();
    }

    return {
      ...newP,
      priceHistory: history
    };
  });
}

// ─── SCRAPE ONE RETAILER ────────────────────────────────────────
async function scrapeRetailer(retailer) {
  log(`Scraping ${retailer.name}...`);
  const products = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      log(`  Page ${page}...`);
      const data = await fetchJSON(retailer.url, page);

      if (!data.products || data.products.length === 0) {
        hasMore = false;
        break;
      }

      for (const raw of data.products) {
        const product = extractProduct(raw, retailer);
        if (product) products.push(product);
      }

      // Shopify returns max 250 per page
      hasMore = data.products.length === 250;
      page++;

      // Polite delay between pages
      if (hasMore) await sleep(500);

    } catch (err) {
      log(`  ERROR on page ${page}: ${err.message}`);
      hasMore = false;
    }
  }

  log(`  Found ${products.length} supplement products from ${retailer.name}`);
  return products;
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  log('=== ScoopScore scrape started ===');

  // Load existing data to preserve price history
  let existingProducts = [];
  if (fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      existingProducts = existing.products || [];
      log(`Loaded ${existingProducts.length} existing products`);
    } catch (e) {
      log(`Could not load existing data: ${e.message}`);
    }
  }

  // Scrape all retailers
  const allNew = [];
  for (const retailer of RETAILERS) {
    const products = await scrapeRetailer(retailer);
    allNew.push(...products);
    await sleep(1000); // pause between retailers
  }

  // Merge (preserve history)
  const merged = mergeWithExisting(allNew, existingProducts);

  // Sort by category then price
  merged.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.priceFrom - b.priceFrom;
  });

  // Write output
  const output = {
    meta: {
      updatedAt:    new Date().toISOString(),
      totalProducts: merged.length,
      retailers:    RETAILERS.map(r => r.name),
      categories: {
        protein:    merged.filter(p => p.category === 'protein').length,
        creatine:   merged.filter(p => p.category === 'creatine').length,
        preworkout: merged.filter(p => p.category === 'preworkout').length,
        fatburner:  merged.filter(p => p.category === 'fatburner').length,
        bcaa:       merged.filter(p => p.category === 'bcaa').length,
      }
    },
    products: merged
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  log(`✓ Wrote ${merged.length} products to ${OUT_FILE}`);
  log(`  protein: ${output.meta.categories.protein}`);
  log(`  creatine: ${output.meta.categories.creatine}`);
  log(`  preworkout: ${output.meta.categories.preworkout}`);
  log(`  fatburner: ${output.meta.categories.fatburner}`);
  log(`  bcaa: ${output.meta.categories.bcaa}`);
  log('=== Scrape complete ===');
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
