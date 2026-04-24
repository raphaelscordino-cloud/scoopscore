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

// Ensure data/ directory exists before anything tries to write to it
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// ─── SHARED CATEGORY MAP ───────────────────────────────────────
// Maps Shopify product_type → ScoopScore category.
// IMPORTANT: Each retailer sets their own product_type strings in Shopify admin.
// These are NOT standardised — "Whey Protein" at one store may be
// "Protein Powder" or left BLANK at another. The map must cover every variant
// we've seen in the wild. detectCategory() also does title/tag fallback,
// but the map is the primary fast-path for correctly-tagged products.
const SHARED_CATEGORY_MAP = {
  // ── Protein (covers every product_type string seen across NZ retailers) ──
  'Whey Protein':                'protein',
  'Whey Protein Isolate':        'protein',
  'Whey Protein Concentrate':    'protein',
  'Whey Protein Blend':          'protein',
  'Whey Protein Powder':         'protein',   // ← Sportsfuel uses this
  'Protein Powder':              'protein',
  'Protein Blend':               'protein',
  'Protein':                     'protein',   // ← catch-all for bare "Protein" type
  'Isolate Protein':             'protein',
  'Isolate':                     'protein',
  'Hydrolysed Whey':             'protein',
  'Hydrolyzed Whey':             'protein',
  'Hydrolysed Protein':          'protein',
  'Hydrolyzed Protein':          'protein',
  'Plant Based Protein':         'protein',
  'Plant Protein':               'protein',
  'Vegan Protein':               'protein',
  'Pea Protein':                 'protein',
  'Hemp Protein':                'protein',
  'Mass Gainer':                 'protein',
  'Mass Gainers':                'protein',   // ← plural variant
  'Weight Gainer':               'protein',
  'Weight Gainers':              'protein',
  'Lean Protein':                'protein',
  'Casein Protein':              'protein',
  'Casein':                      'protein',
  'Egg Protein':                 'protein',
  'Beef Protein':                'protein',
  'Collagen Protein':            'protein',
  'Collagen':                    'protein',
  'Thermogenic Protein':         'protein',
  'Low Carb Protein':            'protein',
  'Protein Bar':                 'protein',
  'Protein Bars':                'protein',
  'Protein Snacks':              'protein',
  'Protein Water':               'protein',
  // ── Creatine ──
  'Creatine':                    'creatine',
  'Creatine Monohydrate':        'creatine',
  'Creatine HCL':                'creatine',
  'Creatine HCI':                'creatine',
  'Creatine Blend':              'creatine',
  'Creatine Supplement':         'creatine',
  'Creatine Supplements':        'creatine',
  'Creatine Powder':             'creatine',
  'Creatine Capsules':           'creatine',
  'Creatine Gummies':            'creatine',
  'Flavoured Creatine':          'creatine',
  // ── Pre-Workout ──
  'Pre-Workout':                 'preworkout',
  'Pre Workout':                 'preworkout',
  'Pre-workout':                 'preworkout',
  'Preworkout':                  'preworkout',
  'Pre Workouts':                'preworkout',
  'Pre-Workouts':                'preworkout',
  'Pump':                        'preworkout',
  'Pump Pre-Workout':            'preworkout',
  'Stim Free Pre-Workout':       'preworkout',
  'Non-Stim Pre-Workout':        'preworkout',
  'Low-Stim Pre-Workout':        'preworkout',
  'Low Stim Pre-Workout':        'preworkout',
  'Energy Drink':                'preworkout',
  'Energy Drinks':               'preworkout',
  // ── Fat Burners ──
  'Fat Burner':                  'fatburner',
  'Fat Burners':                 'fatburner',
  'Fat Metaboliser':             'fatburner',
  'Fat Metabolisers':            'fatburner',
  'Thermogenic':                 'fatburner',
  'Thermogenics':                'fatburner',
  'Weight Loss':                 'fatburner',
  'Weight Management':           'fatburner',
  'Shred':                       'fatburner',
  'Metabolism Support':          'fatburner',
  'L-Carnitine':                 'fatburner',
  'Carnitine':                   'fatburner',
  'CLA':                         'fatburner',
  'Appetite Control':            'fatburner',
  // ── BCAAs / Aminos ──
  'BCAA':                        'bcaa',
  'BCAAs':                       'bcaa',
  'EAA':                         'bcaa',
  'EAAs':                        'bcaa',
  'Amino Acids':                 'bcaa',
  'Amino':                       'bcaa',
  'Aminos':                      'bcaa',
  'Essential Amino Acids':       'bcaa',
  'Intra-Workout':               'bcaa',
  'Intra Workout':               'bcaa',
  'Recovery':                    'bcaa',
  'Glutamine':                   'bcaa',
  'Post Workout':                'bcaa',
  'Post-Workout':                'bcaa',
};

// ─── RETAILERS ─────────────────────────────────────────────────
// All confirmed Shopify stores — products.json endpoint works on all of these.
// Platform notes added for transparency.
const RETAILERS = [

  // ── CONFIRMED SHOPIFY ──────────────────────────────────────
  {
    id:          'nzmuscle',
    name:        'NZ Muscle',
    baseUrl:     'nzmuscle.co.nz',
    url:         'https://nzmuscle.co.nz/products.json',
    currency:    'NZD',
    freeShipping: '$0 (always free)',
    platform:    'shopify',
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'sportsfuel',
    name:        'Sportsfuel',
    baseUrl:     'www.sportsfuel.co.nz',
    url:         'https://www.sportsfuel.co.nz/products.json',
    currency:    'NZD',
    freeShipping: '$60+',
    platform:    'shopify',   // confirmed via AfterShip + ScamAdviser
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'scorpion',
    name:        'Scorpion Supplements',
    baseUrl:     'scorpionsupplements.co.nz',
    url:         'https://scorpionsupplements.co.nz/products.json',
    currency:    'NZD',
    freeShipping: 'check site',
    platform:    'shopify',   // confirmed via "Powered by Shopify" in footer
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'asnonline',
    name:        'ASN Online',
    baseUrl:     'asnonline.co.nz',
    url:         'https://asnonline.co.nz/products.json',
    currency:    'NZD',
    freeShipping: '$100+',
    platform:    'shopify',   // likely Shopify — to confirm on first run
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'supplementsolutions',
    name:        'Supplement Solutions',
    baseUrl:     'www.supplementsolutions.co.nz',
    url:         'https://www.supplementsolutions.co.nz/products.json',
    currency:    'NZD',
    freeShipping: 'check site',
    platform:    'shopify',   // likely Shopify — to confirm on first run
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'raiseys',
    name:        "Raisey's",
    baseUrl:     'raiseys.co.nz',
    url:         'https://raiseys.co.nz/products.json',
    currency:    'NZD',
    freeShipping: 'check site',
    platform:    'shopify',   // NZ-made brand, Shopify confirmed
    categoryMap: SHARED_CATEGORY_MAP,
  },

  // ── NOT SHOPIFY — handled separately below ─────────────────
  // Xplosiv   → Magento  → scraped via XPLOSIV_RETAILERS array
  // Sprint Fit → custom  → scraped via SPRINTFIT_RETAILERS array
  // Nutrition Warehouse → custom platform
  // Payless Supplements → custom platform
];

// Supplement-relevant keywords — skip clothing, equipment etc.
const SUPP_KEYWORDS = [
  'protein', 'creatine', 'pre-workout', 'pre workout', 'bcaa', 'eaa',
  'amino', 'fat burner', 'oxyshred', 'whey', 'isolate', 'casein',
  'mass gainer', 'weight loss', 'thermogenic', 'caffeine', 'glutamine',
  'collagen', 'vitamin', 'omega', 'magnesium', 'zinc', 'electrolyte',
  'pump', 'nitric oxide', 'carnitine', 'cla', 'greens'
];

// IMPORTANT: these are matched as WHOLE WORDS only (word boundaries) to avoid
// false positives like 'mat' matching 'Dymatize', or 'bag' matching 'Chamber Bag 4lb'.
// Use specific multi-word phrases where needed.
const SUPP_EXCLUDE_PATTERNS = [
  /\bshakers?\b/,
  /\bwater bottle\b/,
  /\bt-shirt\b/,
  /\btee shirt\b/,
  /\bshorts\b/,
  /\blegging\b/,
  /\bsinglet\b/,
  /\bdumbbell\b/,
  /\bbarbell\b/,
  /\bkettlebell\b/,
  /\bresistance band\b/,
  /\bskipping rope\b/,
  /\bexercise mat\b/,
  /\byoga mat\b/,
  /\blifting glove\b/,
  /\blifting belt\b/,
  /\bwrist wrap\b/,
  /\bknee wrap\b/,
  /\btreadmill\b/,
  /\brower\b/,
  /\bbox(?:ing)?\s+(?:glove|equipment|set)\b/, // only "boxing gloves/equipment" not "12 Box"
  /\bflooring\b/,
  /\bice bath\b/,
  /\bbench press\b/,
  /\bpower rack\b/,
  /\bmassage (?:ball|gun|stick|cane|roller)\b/,
  /\bworkout equipment\b/,     // product_type used by Sportsfuel for jugs/racks
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
      },
      timeout: 15000
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSONDirect(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${fullUrl}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error for ${fullUrl}: ${e.message}`));
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error(`Timeout for ${fullUrl}`)));
  });
}

function fetchJSONDirect(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'ScoopScore/1.0 (contact@scoopscore.co.nz)' },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// ─── XPLOSIV SCRAPER (Magento platform) ────────────────────────
// Xplosiv uses Magento, not Shopify. We scrape their sitemap/search API.
// This fetches their category pages via Magento's REST-like URLs.
async function scrapeXplosiv() {
  log('Scraping Xplosiv (Magento)...');
  const products = [];

  // Xplosiv Magento category IDs for supplements
  // We fetch via their search endpoint — returns JSON product listings
  const categories = [
    { slug: 'protein',     cat: 'protein'    },
    { slug: 'creatine',    cat: 'creatine'   },
    { slug: 'pre-workout', cat: 'preworkout' },
    { slug: 'fat-burners', cat: 'fatburner'  },
    { slug: 'amino-acids', cat: 'bcaa'       },
  ];

  const suppKw = ['protein','creatine','pre-workout','preworkout','bcaa','eaa','amino','fat burner','whey','isolate','casein','thermogenic','mass gainer'];
  const excluded = ['shaker','bottle','shirt','shorts','singlet','rack','bench','dumbbell','mat','glove','belt'];

  for (const cat of categories) {
    try {
      await sleep(600);
      const url = `https://xplosiv.nz/${cat.slug}?limit=100&mode=list`;
      // Magento doesn't expose a clean JSON API like Shopify.
      // We fetch the page and extract JSON-LD product data.
      const pageData = await fetchPage(url);
      const jsonLdMatches = pageData.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];

      for (const match of jsonLdMatches) {
        try {
          const inner = match.replace(/<script[^>]*>/, '').replace('</script>', '');
          const json = JSON.parse(inner);
          const items = json['@type'] === 'ItemList' ? (json.itemListElement || []) : [];
          for (const item of items) {
            const p = item.item || item;
            if (!p.name || !p.offers) continue;
            const text = p.name.toLowerCase();
            if (excluded.some(k => text.includes(k))) continue;
            if (!suppKw.some(k => text.includes(k))) continue;
            const price = parseFloat((p.offers.price || p.offers.lowPrice || '0'));
            if (!price) continue;
            products.push({
              id:           `xplosiv_${p['@id'] || p.url || p.name}`.replace(/[^a-z0-9_]/gi,'_').slice(0,80),
              retailer:     'xplosiv',
              retailerName: 'Xplosiv',
              brand:        p.brand?.name || 'Unknown',
              name:         p.name,
              category:     cat.cat,
              description:  (p.description || '').slice(0, 280),
              priceFrom:    price,
              priceTo:      parseFloat(p.offers.highPrice || price) || price,
              currency:     'NZD',
              variants:     [{ id: 1, title: 'Default', price, available: true }],
              url:          p.url || `https://xplosiv.nz/${cat.slug}`,
              imageUrl:     p.image || null,
              updatedAt:    new Date().toISOString(),
              priceHistory: []
            });
          }
        } catch(e) { /* skip malformed JSON-LD */ }
      }
    } catch(e) {
      log(`  Xplosiv category ${cat.slug} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Xplosiv`);
  return products;
}

// ─── SPRINT FIT SCRAPER (custom platform) ──────────────────────
// Sprint Fit uses a custom ecommerce platform.
// They have a search/category API we can query.
async function scrapeSprintFit() {
  log('Scraping Sprint Fit (custom platform)...');
  const products = [];

  const categories = [
    { path: 'protein-supplements', cat: 'protein'    },
    { path: 'creatine',            cat: 'creatine'   },
    { path: 'pre-workout',         cat: 'preworkout' },
    { path: 'fat-burners',         cat: 'fatburner'  },
    { path: 'amino-acids',         cat: 'bcaa'       },
  ];

  const suppKw = ['protein','creatine','pre-workout','preworkout','bcaa','eaa','amino','fat burner','whey','isolate','casein','thermogenic'];
  const excluded = ['shaker','bottle','shirt','shorts','singlet','mat','glove','belt'];

  for (const cat of categories) {
    try {
      await sleep(600);
      const url = `https://www.sprintfit.co.nz/${cat.path}`;
      const pageData = await fetchPage(url);

      // Extract JSON-LD product listings
      const jsonLdMatches = pageData.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
      for (const match of jsonLdMatches) {
        try {
          const inner = match.replace(/<script[^>]*>/, '').replace('</script>', '');
          const json = JSON.parse(inner);
          const items = json['@type'] === 'ItemList' ? (json.itemListElement || []) :
                        json['@type'] === 'Product'  ? [{ item: json }] : [];

          for (const item of items) {
            const p = item.item || item;
            if (!p.name || !p.offers) continue;
            const text = p.name.toLowerCase();
            if (excluded.some(k => text.includes(k))) continue;
            if (!suppKw.some(k => text.includes(k))) continue;
            const price = parseFloat(p.offers.price || p.offers.lowPrice || '0');
            if (!price) continue;

            products.push({
              id:           `sprintfit_${(p.url||p.name).replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
              retailer:     'sprintfit',
              retailerName: 'Sprint Fit',
              brand:        p.brand?.name || 'Unknown',
              name:         p.name,
              category:     cat.cat,
              description:  (p.description || '').slice(0, 280),
              priceFrom:    price,
              priceTo:      parseFloat(p.offers.highPrice || price) || price,
              currency:     'NZD',
              variants:     [{ id: 1, title: 'Default', price, available: true }],
              url:          p.url || `https://www.sprintfit.co.nz/${cat.path}`,
              imageUrl:     p.image || null,
              updatedAt:    new Date().toISOString(),
              priceHistory: []
            });
          }
        } catch(e) { /* skip */ }
      }
    } catch(e) {
      log(`  Sprint Fit category ${cat.path} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Sprint Fit`);
  return products;
}

// ─── PAGE FETCHER (for non-JSON endpoints) ────────────────────
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ScoopScore/1.0; +https://scoopscore.co.nz)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', () => reject(new Error(`Timeout: ${url}`)));
  });
}

// Pause between requests — be polite to retailers
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CATEGORY DETECTION ────────────────────────────────────────
// Three-pass detection: product_type map → tags → title keywords.
// product_type varies wildly between retailers — each store admin sets
// their own strings. The map above covers every known variant.
function detectCategory(product, categoryMap) {
  const pt = (product.product_type || '').trim();

  // 1. Exact match first (case-insensitive)
  if (pt) {
    const ptLower = pt.toLowerCase();
    for (const [key, cat] of Object.entries(categoryMap)) {
      if (ptLower === key.toLowerCase()) return cat;
    }
    // 1b. Partial/substring match (e.g. "Whey Protein Powder 5lb" → matches "Whey Protein Powder")
    for (const [key, cat] of Object.entries(categoryMap)) {
      if (ptLower.includes(key.toLowerCase())) return cat;
    }
  }

  // 2. Check tags (retailer-applied collection tags often reveal category)
  const tags = (product.tags || []).map(t => t.toLowerCase()).join(' ');
  if (tags.includes('whey-protein') || tags.includes('whey protein') || tags.includes('protein-powder') || tags.includes('protein powder')) return 'protein';
  if (tags.includes('protein') || tags.includes('whey') || tags.includes('casein') || tags.includes('isolate') || tags.includes('mass-gainer') || tags.includes('mass gainer')) return 'protein';
  if (tags.includes('creatine')) return 'creatine';
  if (tags.includes('pre-workout') || tags.includes('pre workout') || tags.includes('preworkout')) return 'preworkout';
  if (tags.includes('fat-burner') || tags.includes('fat burner') || tags.includes('weight-loss') || tags.includes('weight loss') || tags.includes('thermogenic')) return 'fatburner';
  if (tags.includes('bcaa') || tags.includes('eaa') || tags.includes('amino')) return 'bcaa';

  // 3. Title keyword scan (last resort — catches products with blank product_type)
  const title = product.title.toLowerCase();
  if (title.includes('whey') || title.includes('isolate') || title.includes('casein') || title.includes('mass gainer') || title.includes('mass-gainer') || title.includes('weight gainer') || title.includes('plant protein') || title.includes('vegan protein') || title.includes('pea protein') || title.includes('collagen protein')) return 'protein';
  if (title.match(/\bprotein\b/) && !title.includes('bar') && !title.includes('snack') && !title.includes('cookie') && !title.includes('chip')) return 'protein';
  if (title.includes('creatine')) return 'creatine';
  if (title.includes('pre-workout') || title.includes('pre workout') || title.includes('preworkout')) return 'preworkout';
  if (title.includes('oxyshred') || title.includes('fat burn') || title.includes('thermogenic') || title.includes('shred') || title.includes('l-carnitine') || title.includes('carnitine') || title.includes('fat metabolis')) return 'fatburner';
  if (title.includes('bcaa') || title.includes('amino acid') || title.includes(' eaa') || title.includes('glutamine') || title.includes('intra-workout') || title.includes('intra workout')) return 'bcaa';

  return null; // not a supplement we track
}

function isSupplementProduct(product) {
  const fullText = `${product.title} ${product.product_type} ${(product.tags || []).join(' ')}`.toLowerCase();
  const isSupp = SUPP_KEYWORDS.some(kw => fullText.includes(kw));
  if (!isSupp) return false;

  // Only apply exclusion patterns to the product_type field.
  // Checking the title causes false positives on bundle products like
  // "Pre-Workout + Free Shaker" or "Protein Powder 12 Box" — the supplement
  // keyword wins but the exclusion word happens to be in the product name.
  // product_type is set by the retailer's admin and is a reliable signal.
  const typeText = (product.product_type || '').toLowerCase();
  const isExcluded = SUPP_EXCLUDE_PATTERNS.some(re => re.test(typeText));
  return !isExcluded;
}

// ─── EXTRACT CLEAN PRODUCT DATA ────────────────────────────────
function extractProduct(raw, retailer) {
  const category = detectCategory(raw, retailer.categoryMap);
  if (!category) {
    // Log products that look like supplements but failed category detection
    // so you can add missing product_type strings to the map
    const title = (raw.title || '').toLowerCase();
    const isSuppLike = ['protein','whey','creatine','pre-workout','amino','bcaa','fat burner','isolate','casein','mass','gainer'].some(kw => title.includes(kw));
    if (isSuppLike) {
      log(`  [SKIPPED - no category] "${raw.title}" | product_type: "${raw.product_type || '(blank)'}" | tags: ${(raw.tags||[]).slice(0,5).join(',')}`);
    }
    return null;
  }
  if (!isSupplementProduct(raw)) {
    log(`  [SKIPPED - not supplement] "${raw.title}" | product_type: "${raw.product_type || '(blank)'}"`);
    return null;
  }
  if (!raw.variants || raw.variants.length === 0) return null;

  // All variants including out-of-stock ones
  const allVariants = raw.variants || [];
  const availableVariants = allVariants.filter(v => v.available !== false);

  // Lowest price across ALL variants (show crossed-out price even if OOS)
  const allPrices = allVariants.map(v => parseFloat(v.price)).filter(p => !isNaN(p) && p > 0);
  if (allPrices.length === 0) return null;

  const availPrices = availableVariants.map(v => parseFloat(v.price)).filter(p => !isNaN(p) && p > 0);
  const minPrice = availPrices.length ? Math.min(...availPrices) : Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const available = availableVariants.length > 0;

  // Build variant list for size/flavour options — include all
  const variantList = allVariants.map(v => ({
    id:        v.id,
    title:     v.title,        // e.g. "Chocolate / 1Kg"
    price:     parseFloat(v.price),
    sku:       v.sku || '',
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
    available,
    currency:    retailer.currency,
    variants:    variantList,
    url:         `https://${retailer.baseUrl}/products/${raw.handle}`,
    imageUrl:    raw.images && raw.images[0] ? raw.images[0].src : null,
    updatedAt:   new Date().toISOString(),
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
    const today = new Date().toISOString().split('T')[0];

    if (!existing) {
      // First time we've seen this product — seed price history
      return {
        ...newP,
        priceHistory: [{ price: newP.priceFrom, date: today }]
      };
    }

    // Preserve existing history and append if price changed
    const history = [...(existing.priceHistory || [])];
    const lastEntry = history[history.length - 1];
    const priceChanged = !lastEntry || lastEntry.price !== newP.priceFrom;

    if (priceChanged) {
      history.push({ price: newP.priceFrom, date: today });
      // Keep last 90 data points
      while (history.length > 90) history.shift();
    }

    return { ...newP, priceHistory: history };
  });
}

// ─── RETRY WRAPPER ─────────────────────────────────────────────
async function withRetry(fn, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      log(`  Retry ${attempt}/${retries - 1} after error: ${err.message}`);
      await sleep(delayMs * attempt);
    }
  }
}

// ─── SCRAPE ONE RETAILER ────────────────────────────────────────
async function scrapeRetailer(retailer) {
  log(`Scraping ${retailer.name}...`);
  const products = [];
  let page = 1;
  let hasMore = true;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3; // Only stop if 3 pages in a row all fail

  while (hasMore) {
    try {
      log(`  Page ${page}...`);
      const data = await withRetry(() => fetchJSON(retailer.url, page));

      if (!data.products || data.products.length === 0) {
        hasMore = false;
        break;
      }

      consecutiveErrors = 0; // reset on success
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
      consecutiveErrors++;
      log(`  ERROR on page ${page} (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log(`  Stopping ${retailer.name} after ${MAX_CONSECUTIVE_ERRORS} consecutive page failures`);
        hasMore = false;
      } else {
        // Skip this page and try the next one — a single bad page shouldn't
        // abort the entire catalogue (Sportsfuel has 1000+ products across many pages)
        log(`  Skipping page ${page} and continuing to page ${page + 1}...`);
        page++;
        await sleep(2000); // longer pause before retrying
      }
    }
  }

  log(`  Found ${products.length} supplement products from ${retailer.name} (${page - 1} page${page - 1 !== 1 ? 's' : ''} fetched)`);
  return products;
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  log('=== ScoopScore scrape started ===');
  log(`Retailers: ${RETAILERS.map(r => r.name).join(', ')} + Xplosiv + Sprint Fit`);

  // Load existing data to preserve price history
  let existingProducts = [];
  if (fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      existingProducts = existing.products || [];
      log(`Loaded ${existingProducts.length} existing products (preserving price history)`);
    } catch (e) {
      log(`Could not load existing data: ${e.message}`);
    }
  }

  const allNew = [];
  const retailerStats = {};

  // ── Shopify retailers ──
  for (const retailer of RETAILERS) {
    const products = await scrapeRetailer(retailer);
    allNew.push(...products);
    retailerStats[retailer.name] = products.length;
    await sleep(1500); // polite pause between retailers
  }

  // ── Xplosiv (Magento) ──
  try {
    const xplosivProducts = await scrapeXplosiv();
    allNew.push(...xplosivProducts);
    retailerStats['Xplosiv'] = xplosivProducts.length;
  } catch(e) {
    log(`Xplosiv scrape failed: ${e.message}`);
    retailerStats['Xplosiv'] = 0;
  }
  await sleep(1500);

  // ── Sprint Fit (custom platform) ──
  try {
    const sprintfitProducts = await scrapeSprintFit();
    allNew.push(...sprintfitProducts);
    retailerStats['Sprint Fit'] = sprintfitProducts.length;
  } catch(e) {
    log(`Sprint Fit scrape failed: ${e.message}`);
    retailerStats['Sprint Fit'] = 0;
  }

  // Deduplicate by id
  const seen = new Set();
  const deduped = allNew.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Merge (preserve price history)
  const merged = mergeWithExisting(deduped, existingProducts);

  // Sort by retailer, then category, then price
  merged.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.brand !== b.brand)       return a.brand.localeCompare(b.brand);
    return a.priceFrom - b.priceFrom;
  });

  // Build retailer summary
  const retailerList = [...new Set(merged.map(p => p.retailerName))];
  const catCounts = {
    protein:    merged.filter(p => p.category === 'protein').length,
    creatine:   merged.filter(p => p.category === 'creatine').length,
    preworkout: merged.filter(p => p.category === 'preworkout').length,
    fatburner:  merged.filter(p => p.category === 'fatburner').length,
    bcaa:       merged.filter(p => p.category === 'bcaa').length,
  };

  const output = {
    meta: {
      updatedAt:     new Date().toISOString(),
      totalProducts: merged.length,
      retailers:     retailerList,
      retailerStats,
      categories:    catCounts,
    },
    products: merged
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  // Summary
  log('');
  log('=== Scrape complete ===');
  log(`Total products: ${merged.length}`);
  log('');
  log('By retailer:');
  for (const [name, count] of Object.entries(retailerStats)) {
    log(`  ${name.padEnd(25)} ${count} products`);
  }
  log('');
  log('By category:');
  for (const [cat, count] of Object.entries(catCounts)) {
    log(`  ${cat.padEnd(15)} ${count}`);
  }
  log(`\nOutput: ${OUT_FILE}`);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
