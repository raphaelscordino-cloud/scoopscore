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
  // ── Protein Powder ──
  'Whey Protein':                'protein',
  'Whey Protein Isolate':        'protein',
  'Whey Protein Concentrate':    'protein',
  'Whey Protein Blend':          'protein',
  'Whey Protein Powder':         'protein',
  'Protein Powder':              'protein',
  'Protein Blend':               'protein',
  'Protein':                     'protein',
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
  'Mass Gainers':                'protein',
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
  // ── Protein Bars & Snacks ──
  'Protein Bar':                 'proteinbars',
  'Protein Bars':                'proteinbars',
  'Protein Snacks':              'proteinbars',
  'Protein Snack':               'proteinbars',
  'Protein Cookie':              'proteinbars',
  'Protein Cookies':             'proteinbars',
  'Protein Chips':               'proteinbars',
  'Protein Wafer':               'proteinbars',
  'Protein Spread':              'proteinbars',
  'High Protein Snack':          'proteinbars',
  'Snack Bar':                   'proteinbars',
  'Nutrition Bar':               'proteinbars',
  'Energy Bar':                  'proteinbars',
  // ── RTD / Ready To Drink ──
  'RTD':                         'rtd',
  'Ready To Drink':              'rtd',
  'Ready-To-Drink':              'rtd',
  'Protein Water':               'rtd',
  'Protein Shake':               'rtd',
  'Protein Drink':               'rtd',
  'Energy Drink':                'rtd',
  'Energy Drinks':               'rtd',
  'Sports Drink':                'rtd',
  'Sports Drinks':               'rtd',
  'Hydration Drink':             'rtd',
  'Electrolyte Drink':           'rtd',
  'Recovery Drink':              'rtd',
  'Pre-Workout Drink':           'rtd',
  'Canned Protein':              'rtd',
  'Iced Coffee Protein':         'rtd',
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
  // ── Vitamins & Health ──
  'Vitamins':                    'vitamins',
  'Vitamin':                     'vitamins',
  'Vitamins & Minerals':         'vitamins',
  'Multivitamin':                'vitamins',
  'Multivitamins':               'vitamins',
  'Omega-3':                     'vitamins',
  'Omega 3':                     'vitamins',
  'Fish Oil':                    'vitamins',
  'Magnesium':                   'vitamins',
  'Zinc':                        'vitamins',
  'Vitamin D':                   'vitamins',
  'Vitamin C':                   'vitamins',
  'Vitamin B':                   'vitamins',
  'B Vitamins':                  'vitamins',
  'Electrolytes':                'vitamins',
  'Electrolyte':                 'vitamins',
  'Greens':                      'vitamins',
  'Greens Powder':               'vitamins',
  'Super Greens':                'vitamins',
  'Superfood':                   'vitamins',
  'Superfoods':                  'vitamins',
  'Immunity':                    'vitamins',
  'Sleep Aid':                   'vitamins',
  'Sleep Aids':                  'vitamins',
  'Melatonin':                   'vitamins',
  'Probiotics':                  'vitamins',
  'Probiotic':                   'vitamins',
  'General Health':              'vitamins',
  'Health Supplements':          'vitamins',
  'Health & Wellness':           'vitamins',
  'Nootropic':                   'vitamins',
  'Nootropics':                  'vitamins',
  'Testosterone Booster':        'vitamins',
  'Test Booster':                'vitamins',
  // ── Gym Food / Nutrition ──
  'Healthy Snacks':              'gymfood',
  'Healthy Food':                'gymfood',
  'Meal Replacement':            'gymfood',
  'Meal Replacements':           'gymfood',
  'Oats':                        'gymfood',
  'Peanut Butter':               'gymfood',
  'Nut Butter':                  'gymfood',
  'Nut Butters':                 'gymfood',
  'Jerky':                       'gymfood',
  'Beef Jerky':                  'gymfood',
  'Rice Cakes':                  'gymfood',
  'Granola':                     'gymfood',
  'Carbohydrates':               'gymfood',
  'Carb Powder':                 'gymfood',
  'Carb Supplement':             'gymfood',
  // ── Gym Accessories ──
  'Shaker':                      'accessories',
  'Shakers':                     'accessories',
  'Shaker Bottle':               'accessories',
  'Shaker Cup':                  'accessories',
  'Blender Bottle':              'accessories',
  'Water Bottle':                'accessories',
  'Gym Bag':                     'accessories',
  'Gym Bags':                    'accessories',
  'Lifting Straps':              'accessories',
  'Lifting Belt':                'accessories',
  'Weightlifting Belt':          'accessories',
  'Gym Gloves':                  'accessories',
  'Lifting Gloves':              'accessories',
  'Wrist Wraps':                 'accessories',
  'Knee Sleeves':                'accessories',
  'Elbow Sleeves':               'accessories',
  'Resistance Bands':            'accessories',
  'Resistance Band':             'accessories',
  'Foam Roller':                 'accessories',
  'Massage Ball':                'accessories',
  'Jump Rope':                   'accessories',
  'Skipping Rope':               'accessories',
  'Gym Accessories':             'accessories',
  'Accessories':                 'accessories',
  'Gym Equipment':               'accessories',
  'Pill Organiser':              'accessories',
  'Pill Container':              'accessories',
  'Supplement Container':        'accessories',
  'Measuring Cup':               'accessories',
  // ── Gym Clothing ──
  'Gym Wear':                    'clothing',
  'Gym Clothing':                'clothing',
  'Activewear':                  'clothing',
  'Active Wear':                 'clothing',
  'Sports Apparel':              'clothing',
  'Apparel':                     'clothing',
  'T-Shirt':                     'clothing',
  'Tee':                         'clothing',
  'Shorts':                      'clothing',
  'Leggings':                    'clothing',
  'Singlet':                     'clothing',
  'Sports Bra':                  'clothing',
  'Hoodie':                      'clothing',
  'Tank Top':                    'clothing',
  'Compression':                 'clothing',
  'Compression Wear':            'clothing',
  'Socks':                       'clothing',
  'Gym Socks':                   'clothing',
  'Cap':                         'clothing',
  'Hat':                         'clothing',
  'Beanie':                      'clothing',
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

  {
    id:          'bodystrong',
    name:        'BodyStrong',
    baseUrl:     'bodystrong.co.nz',
    url:         'https://bodystrong.co.nz/products.json',
    currency:    'NZD',
    freeShipping: 'check site',
    platform:    'shopify',
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'bargainchemist',
    name:        'Bargain Chemist',
    baseUrl:     'www.bargainchemist.co.nz',
    url:         'https://www.bargainchemist.co.nz/products.json',
    currency:    'NZD',
    freeShipping: 'Free shipping',
    platform:    'shopify',   // confirmed Shopify via /collections/ URL structure
    categoryMap: SHARED_CATEGORY_MAP,
  },
  {
    id:          'payless',
    name:        'Payless Supplements',
    baseUrl:     'paylesssupplements.co.nz',
    url:         'https://paylesssupplements.co.nz/products.json',
    currency:    'NZD',
    freeShipping: 'Free shipping',
    platform:    'shopify',   // confirmed Shopify — /collections/ URLs work
    categoryMap: SHARED_CATEGORY_MAP,
  },

  // ── NOT SHOPIFY — handled separately below ─────────────────
  // Xplosiv            → Magento (JS-rendered) → scrapeXplosiv() — HTML parse
  // Sprint Fit         → n2 ERP (HTML render)  → scrapeSprintFit() — HTML parse
  // Elite Supplements  → Shopify password lock  → scrapeEliteSupplements() — HTML parse
  // Chemist Warehouse  → custom platform / 403  → scrapeChemistWarehouse() — category API
  // Nutrition Warehouse → custom platform       → scrapeNutritionWarehouse() — HTML/JSON-LD
];

// Gym-relevant keywords — anything matching these passes the first gate.
// This is intentionally broad — detectCategory() does the precise bucketing.
const SUPP_KEYWORDS = [
  // Supplements
  'protein', 'creatine', 'pre-workout', 'pre workout', 'preworkout',
  'bcaa', 'eaa', 'amino', 'fat burner', 'oxyshred', 'whey', 'isolate',
  'casein', 'mass gainer', 'weight loss', 'thermogenic', 'caffeine',
  'glutamine', 'collagen', 'vitamin', 'omega', 'magnesium', 'zinc',
  'electrolyte', 'pump', 'nitric oxide', 'carnitine', 'cla', 'greens',
  'nootropic', 'testosterone', 'melatonin', 'probiotic', 'superfood',
  // RTD / drinks
  'rtd', 'ready to drink', 'protein water', 'protein shake', 'protein drink',
  'energy drink', 'sports drink', 'hydration drink', 'recovery drink',
  // Bars & snacks
  'protein bar', 'protein cookie', 'protein chip', 'protein snack',
  'protein wafer', 'nutrition bar', 'meal replacement', 'peanut butter',
  'nut butter', 'beef jerky', 'jerky', 'rice cake', 'healthy snack',
  // Accessories
  'shaker', 'blender bottle', 'gym bag', 'lifting strap', 'lifting belt',
  'gym glove', 'wrist wrap', 'knee sleeve', 'elbow sleeve', 'foam roller',
  'resistance band', 'jump rope', 'skipping rope', 'massage ball',
  'pill organiser', 'pill container', 'supplement container',
  // Gym clothing
  'activewear', 'gym wear', 'singlet', 'compression', 'sports bra',
  'gym short', 'gym legging', 'gym hoodie', 'gym tank', 'gym sock',
];

// Only exclude things that are clearly NOT gym-related and have no place
// in a gym store — heavy gym machines, full gym furniture, cosmetics etc.
// Shakers, bottles, clothing — these are now INCLUDED under accessories/clothing.
const SUPP_EXCLUDE_PATTERNS = [
  /\btreadmill\b/,
  /\brower\b/,
  /\bstationary bike\b/,
  /\bspin bike\b/,
  /\bbench press\b/,
  /\bpower rack\b/,
  /\bsquat rack\b/,
  /\bdumbbell\b/,
  /\bbarbell\b/,
  /\bkettlebell\b/,
  /\bweight plate\b/,
  /\bflooring\b/,
  /\bgym flooring\b/,
  /\bice bath\b/,
  /\bcold plunge\b/,
  /\bperfume\b/,
  /\bfragrance\b/,
  /\bskincare\b/,
  /\bmakeup\b/,
  /\bhair care\b/,
  /\bbook\b/,
  /\bworkout equipment\b/,  // Sportsfuel uses this for large equipment
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

// ─── XPLOSIV SCRAPER (Magento — sitemap XML approach) ──────────
// Xplosiv is 100% JS-rendered — no product data in HTML.
// Their sitemap lists every product URL; we fetch individual product pages
// which DO serve JSON-LD for single products (confirmed by search results).
async function scrapeXplosiv() {
  log('Scraping Xplosiv (sitemap)...');
  const products = [];
  const seen = new Set();

  // Category slug → our internal category
  const slugToCat = {
    'protein-powder':     'protein',
    'protein-bars':       'proteinbars',
    'snacks-drinks':      'proteinbars',
    'ready-to-drink':     'rtd',
    'pre-workout':        'preworkout',
    'weight-loss':        'fatburner',
    'growth-recovery':    'bcaa',
    'creatine':           'creatine',
    'aminos':             'bcaa',
    'health-wellbeing':   'vitamins',
    'accessories':        'accessories',
    'clothing':           'clothing',
  };

  try {
    // Fetch their product sitemap
    const sitemapIndex = await fetchPage('https://xplosiv.nz/sitemap.xml');
    // Find the product sitemap URL
    const productSitemapMatch = sitemapIndex.match(/https:\/\/xplosiv\.nz\/[^<]*product[^<]*.xml/i)
      || sitemapIndex.match(/https:\/\/xplosiv\.nz\/sitemap[^<]*\.xml/gi) || [];

    const productSitemapUrl = productSitemapMatch[0] ||
      (productSitemapMatch.length > 1 ? productSitemapMatch[1] : null) ||
      'https://xplosiv.nz/sitemap/categories/1/products.xml';

    log(`  Xplosiv: loading product sitemap: ${productSitemapUrl}`);
    const sitemapXml = await fetchPage(productSitemapUrl);

    // Extract all product URLs from the sitemap
    const urlMatches = [...sitemapXml.matchAll(/<loc>(https:\/\/xplosiv\.nz\/[^<]+\.html)<\/loc>/g)];
    log(`  Xplosiv: found ${urlMatches.length} product URLs in sitemap`);

    // Limit to 300 products to avoid hammering the server
    const productUrls = urlMatches.slice(0, 300).map(m => m[1]);

    for (const productUrl of productUrls) {
      try {
        await sleep(300);
        const html = await fetchPage(productUrl);

        // Infer category from URL path
        let cat = 'protein';
        for (const [slug, c] of Object.entries(slugToCat)) {
          if (productUrl.includes(`/${slug}/`) || productUrl.includes(`/${slug}.html`)) {
            cat = c; break;
          }
        }

        // Single product pages DO serve JSON-LD
        const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (!ldMatch) continue;
        const json = JSON.parse(ldMatch[1]);
        if (json['@type'] !== 'Product' || !json.name || !json.offers) continue;

        const price = parseFloat(json.offers.price || json.offers.lowPrice || '0');
        if (!price) continue;
        const key = `xplosiv_${json.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        products.push({
          id:           `xplosiv_${productUrl.split('/').pop().replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
          retailer:     'xplosiv',
          retailerName: 'Xplosiv',
          brand:        json.brand?.name || 'Unknown',
          name:         json.name,
          category:     cat,
          description:  (json.description || '').slice(0, 280),
          priceFrom:    price,
          priceTo:      parseFloat(json.offers.highPrice || price) || price,
          currency:     'NZD',
          variants:     [{ id: 1, title: 'Default', price, available: true }],
          url:          productUrl,
          imageUrl:     Array.isArray(json.image) ? json.image[0] : (json.image || null),
          updatedAt:    new Date().toISOString(),
          priceHistory: []
        });
      } catch(e) { /* skip individual product errors */ }
    }
  } catch(e) {
    log(`  Xplosiv sitemap error: ${e.message}`);
  }

  log(`  Found ${products.length} products from Xplosiv`);
  return products;
}
// ─── SPRINT FIT SCRAPER (n2 ERP — confirmed HTML patterns) ────────
// Sprint Fit uses n2 ERP. Their category pages render products server-side.
// Pattern confirmed from live page: product links href + <strong>NAME SIZE</strong> + $PRICE
async function scrapeSprintFit() {
  log('Scraping Sprint Fit (n2 ERP HTML)...');
  const products = [];
  const seen = new Set();

  // Real category IDs confirmed from live nav fetch
  const categories = [
    { id: 321,  slug: 'protein-powder',           cat: 'protein'      },
    { id: 322,  slug: 'protein-bars',             cat: 'proteinbars'  },
    { id: 564,  slug: 'ready-to-drink-protein',   cat: 'rtd'          },
    { id: 555,  slug: 'energy-drinks',            cat: 'rtd'          },
    { id: 315,  slug: 'creatine',                 cat: 'creatine'     },
    { id: 316,  slug: 'pre-workout',              cat: 'preworkout'   },
    { id: 358,  slug: 'weightloss',               cat: 'fatburner'    },
    { id: 302,  slug: 'amino-acids-bcaas',        cat: 'bcaa'         },
    { id: 353,  slug: 'hydration-and-endurance',  cat: 'bcaa'         },
    { id: 317,  slug: 'testosterone-booster',     cat: 'vitamins'     },
    { id: 71,   slug: 'vitamins',                 cat: 'vitamins'     },
    { id: 286,  slug: 'super-greens-superfoods',  cat: 'vitamins'     },
    { id: 15,   slug: 'accessories',              cat: 'accessories'  },
    { id: 76,   slug: 'shakers-water-bottles',    cat: 'accessories'  },
    { id: 285,  slug: 'gym-meal-bags',            cat: 'accessories'  },
    { id: 525,  slug: 'apparel-clothing',         cat: 'clothing'     },
  ];

  for (const cat of categories) {
    // Sprint Fit paginates — scrape up to 5 pages per category
    for (let page = 1; page <= 5; page++) {
      try {
        await sleep(600);
        const url = `https://www.sprintfit.co.nz/products/category/${cat.id}/${cat.slug}?pgNmbr=${page}`;
        const html = await fetchPage(url);

        // Pattern from live page: product link → brand in one div, name+size in <strong>
        // href="https://www.sprintfit.co.nz/product/NNN/slug"
        // Followed by BRAND text then <strong>PRODUCT NAME\n  SIZE</strong>
        // Followed by $XX.XX (optionally $OLD.XX\n$NEW.XX for sale)

        // Extract product blocks: each product card has a distinctive href pattern
        const productBlockRx = /href="(https:\/\/www\.sprintfit\.co\.nz\/product\/\d+\/[^"]+)"[\s\S]{0,600}?<strong>([\s\S]{5,200}?)<\/strong>[\s\S]{0,300}?\$([\d,]+\.?\d*)/g;
        let match;
        let found = 0;

        while ((match = productBlockRx.exec(html)) !== null) {
          const productUrl = match[1];
          const rawName = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          const price = parseFloat(match[3].replace(',', ''));

          if (!rawName || rawName.length < 3 || !price || price > 2000) continue;
          const key = `sf_${productUrl}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found++;

          // Extract brand from URL slug (first word usually)
          const urlSlug = productUrl.split('/').pop() || '';
          const brand = rawName.split(' ')[0] || 'Unknown';

          products.push({
            id:           `sprintfit_${productUrl.split('/product/')[1]?.replace(/[^a-z0-9]/gi,'_').slice(0,60) || rawName.replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
            retailer:     'sprintfit',
            retailerName: 'Sprint Fit',
            brand,
            name:         rawName,
            category:     cat.cat,
            description:  '',
            priceFrom:    price,
            priceTo:      price,
            currency:     'NZD',
            variants:     [{ id: 1, title: 'Default', price, available: true }],
            url:          productUrl,
            imageUrl:     null,
            updatedAt:    new Date().toISOString(),
            priceHistory: []
          });
        }

        log(`  Sprint Fit cat/${cat.id} page ${page}: ${found} products`);
        // Stop paginating if no products found on this page
        if (found === 0) break;
      } catch(e) {
        log(`  Sprint Fit cat/${cat.id} p${page} error: ${e.message}`);
        break;
      }
    }
  }

  log(`  Found ${products.length} products from Sprint Fit`);
  return products;
}

// ─── NUTRITION WAREHOUSE SCRAPER (sitemap + product page JSON-LD) ──
// nutritionwarehouse.co.nz is a fully JS-rendered Vue app.
// Their product pages DO serve JSON-LD for individual products.
// Strategy: fetch sitemap → get product URLs → fetch each for JSON-LD.
async function scrapeNutritionWarehouse() {
  log('Scraping Nutrition Warehouse NZ (sitemap)...');
  const products = [];
  const seen = new Set();

  // Map URL path segments to our internal categories
  const slugToCat = {
    'protein-powder':        'protein',
    'protein-bars':          'proteinbars',
    'protein-cookies':       'proteinbars',
    'protein-water':         'rtd',
    'creatine':              'creatine',
    'pre-workout':           'preworkout',
    'fat-burner':            'fatburner',
    'weight-loss':           'fatburner',
    'amino-acids':           'bcaa',
    'bcaa':                  'bcaa',
    'vitamins':              'vitamins',
    'minerals':              'vitamins',
    'greens':                'vitamins',
    'gym-accessories':       'accessories',
    'shakers':               'accessories',
    'gym-clothing':          'clothing',
    'apparel':               'clothing',
    'protein':               'protein',
    'mass-gainer':           'protein',
    'weight-gainer':         'protein',
    'casein':                'protein',
    'meal-replacement':      'gymfood',
    'healthy-food':          'gymfood',
  };

  try {
    // Step 1: fetch sitemap index
    const sitemapIndex = await fetchPage('https://www.nutritionwarehouse.co.nz/sitemap.xml');
    // Find the products sitemap — NW Shopify-style sitemaps have /sitemap_products_1.xml
    const productSitemapMatches = [...sitemapIndex.matchAll(/https:\/\/www\.nutritionwarehouse\.co\.nz\/[^<]*(product|sitemap)[^<]*\.xml/gi)];
    let productSitemapUrl = productSitemapMatches.find(m => m[0].includes('product'))?.[0]
      || 'https://www.nutritionwarehouse.co.nz/sitemap_products_1.xml';

    log(`  NW: fetching product sitemap: ${productSitemapUrl}`);
    const sitemapXml = await fetchPage(productSitemapUrl);

    // Extract all /products/ URLs
    const urlMatches = [...sitemapXml.matchAll(/<loc>(https:\/\/www\.nutritionwarehouse\.co\.nz\/products\/[^<]+)<\/loc>/g)];
    log(`  NW: found ${urlMatches.length} product URLs`);

    // Cap at 400 to keep run time reasonable
    const productUrls = urlMatches.slice(0, 400).map(m => m[1]);

    for (const productUrl of productUrls) {
      try {
        await sleep(250);
        const html = await fetchPage(productUrl);

        // Infer category from URL
        let cat = 'protein'; // default
        for (const [slug, c] of Object.entries(slugToCat)) {
          if (productUrl.includes(slug)) { cat = c; break; }
        }

        // Look for JSON-LD Product schema
        const ldMatches = [...(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))];
        let pushed = false;
        for (const m of ldMatches) {
          try {
            const json = JSON.parse(m[1]);
            if (json['@type'] !== 'Product' || !json.name) continue;
            const price = parseFloat(json.offers?.price || json.offers?.lowPrice || '0');
            if (!price) continue;
            const key = `nw_${json.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            products.push({
              id:           `nutritionwarehouse_${productUrl.split('/products/')[1]?.replace(/[^a-z0-9]/gi,'_').slice(0,60) || json.name.replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
              retailer:     'nutritionwarehouse',
              retailerName: 'Nutrition Warehouse',
              brand:        json.brand?.name || 'Unknown',
              name:         json.name,
              category:     cat,
              description:  (json.description || '').replace(/<[^>]+>/g,'').slice(0,280),
              priceFrom:    price,
              priceTo:      parseFloat(json.offers?.highPrice || price) || price,
              currency:     'NZD',
              variants:     [{ id: 1, title: 'Default', price, available: true }],
              url:          productUrl,
              imageUrl:     Array.isArray(json.image) ? json.image[0] : (json.image || null),
              updatedAt:    new Date().toISOString(),
              priceHistory: []
            });
            pushed = true;
            break;
          } catch(e2) { /* skip */ }
        }
      } catch(e) { /* skip individual product */ }
    }
  } catch(e) {
    log(`  Nutrition Warehouse sitemap error: ${e.message}`);
  }

  log(`  Found ${products.length} products from Nutrition Warehouse`);
  return products;
}
// products.json is locked. We scrape their collection HTML pages instead.
async function scrapeEliteSupplements() {
  log('Scraping Elite Supplements (Shopify HTML)...');
  const products = [];
  const seen = new Set();

  const collections = [
    { slug: 'protein',          cat: 'protein'     },
    { slug: 'protein-bars',     cat: 'proteinbars' },
    { slug: 'creatine',         cat: 'creatine'    },
    { slug: 'pre-workout',      cat: 'preworkout'  },
    { slug: 'fat-loss',         cat: 'fatburner'   },
    { slug: 'amino-acids',      cat: 'bcaa'        },
    { slug: 'vitamins-health',  cat: 'vitamins'    },
    { slug: 'accessories',      cat: 'accessories' },
  ];

  for (const col of collections) {
    try {
      await sleep(700);
      // Shopify collection pages expose products in a window.__INITIAL_STATE__ or JSON-LD
      const url = `https://elitesupplements.co.nz/collections/${col.slug}/products.json?limit=250`;
      const raw = await fetchPage(url);
      let parsed;
      try { parsed = JSON.parse(raw); } catch(e) {
        // Blocked — try HTML collection page JSON-LD fallback
        const html = await fetchPage(`https://elitesupplements.co.nz/collections/${col.slug}`);
        const matches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        for (const m of matches) {
          try {
            const inner = m.replace(/<script[^>]*>/, '').replace('</script>', '');
            const json = JSON.parse(inner);
            if (json['@type'] === 'ItemList') {
              parsed = { products: (json.itemListElement || []).map(i => i.item || i) };
              break;
            }
          } catch(e2) {}
        }
        if (!parsed) { log(`  Elite Supplements ${col.slug}: blocked`); continue; }
      }

      for (const p of (parsed.products || [])) {
        const title = p.title || p.name || '';
        if (!title) continue;
        const key = `es_${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const price = parseFloat(
          p.variants?.[0]?.price || p.offers?.price || p.offers?.lowPrice || '0'
        );
        if (!price) continue;
        products.push({
          id:           `elitesupplements_${(p.handle||title).replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
          retailer:     'elitesupplements',
          retailerName: 'Elite Supplements',
          brand:        p.vendor || p.brand?.name || 'Unknown',
          name:         title,
          category:     col.cat,
          description:  (p.body_html || p.description || '').replace(/<[^>]+>/g,'').slice(0,280),
          priceFrom:    price,
          priceTo:      Math.max(...(p.variants||[{price}]).map(v=>parseFloat(v.price)||price)),
          currency:     'NZD',
          variants:     (p.variants||[]).map((v,i)=>({id:i+1,title:v.title||'Default',price:parseFloat(v.price)||price,available:v.available!==false})),
          url:          `https://elitesupplements.co.nz/products/${p.handle||''}`,
          imageUrl:     p.images?.[0]?.src || null,
          updatedAt:    new Date().toISOString(),
          priceHistory: []
        });
      }
      log(`  Elite Supplements ${col.slug}: ${products.length} total so far`);
    } catch(e) {
      log(`  Elite Supplements ${col.slug} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Elite Supplements`);
  return products;
}

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

  // 1. Exact match on product_type (case-insensitive)
  if (pt) {
    const ptLower = pt.toLowerCase();
    for (const [key, cat] of Object.entries(categoryMap)) {
      if (ptLower === key.toLowerCase()) return cat;
    }
    // 1b. Substring match (e.g. "Whey Protein Powder 5lb" → "Whey Protein Powder")
    for (const [key, cat] of Object.entries(categoryMap)) {
      if (ptLower.includes(key.toLowerCase())) return cat;
    }
  }

  // 2. Tags
  const tags = (product.tags || []).map(t => t.toLowerCase()).join(' ');
  if (tags.includes('protein-bar') || tags.includes('protein bar') || tags.includes('protein-cookie') || tags.includes('protein-snack')) return 'proteinbars';
  if (tags.includes('rtd') || tags.includes('ready-to-drink') || tags.includes('protein-water') || tags.includes('protein water') || tags.includes('protein-drink') || tags.includes('energy-drink') || tags.includes('sports-drink')) return 'rtd';
  if (tags.includes('shaker') || tags.includes('gym-bag') || tags.includes('gym bag') || tags.includes('lifting-strap') || tags.includes('wrist-wrap') || tags.includes('accessories')) return 'accessories';
  if (tags.includes('activewear') || tags.includes('gym-wear') || tags.includes('clothing') || tags.includes('apparel') || tags.includes('singlet') || tags.includes('shorts') || tags.includes('legging')) return 'clothing';
  if (tags.includes('vitamin') || tags.includes('omega') || tags.includes('magnesium') || tags.includes('electrolyte') || tags.includes('greens') || tags.includes('probiotic') || tags.includes('nootropic')) return 'vitamins';
  if (tags.includes('meal-replacement') || tags.includes('meal replacement') || tags.includes('peanut-butter') || tags.includes('jerky') || tags.includes('healthy-snack') || tags.includes('carbohydrate')) return 'gymfood';
  if (tags.includes('whey-protein') || tags.includes('whey protein') || tags.includes('protein-powder') || tags.includes('protein powder')) return 'protein';
  if (tags.includes('protein') || tags.includes('whey') || tags.includes('casein') || tags.includes('isolate') || tags.includes('mass-gainer') || tags.includes('mass gainer')) return 'protein';
  if (tags.includes('creatine')) return 'creatine';
  if (tags.includes('pre-workout') || tags.includes('pre workout') || tags.includes('preworkout')) return 'preworkout';
  if (tags.includes('fat-burner') || tags.includes('fat burner') || tags.includes('weight-loss') || tags.includes('weight loss') || tags.includes('thermogenic')) return 'fatburner';
  if (tags.includes('bcaa') || tags.includes('eaa') || tags.includes('amino')) return 'bcaa';

  // 3. Title keyword scan (last resort)
  const title = product.title.toLowerCase();

  // Accessories — check before protein to avoid "Free Shaker" triggering protein
  if (title.match(/\bshaker\b/) || title.match(/\bblender bottle\b/) || title.match(/\bgym bag\b/) || title.match(/\blifting strap\b/) || title.match(/\bwrist wrap\b/) || title.match(/\bknee sleeve\b/) || title.match(/\bfoam roller\b/) || title.match(/\bresistance band\b/) || title.match(/\bjump rope\b/) || title.match(/\bskipping rope\b/)) return 'accessories';
  // RTD
  if (title.match(/\brtd\b/) || title.includes('ready to drink') || title.includes('ready-to-drink') || title.includes('protein water') || title.includes('protein drink') || title.match(/\benergy drink\b/) || title.match(/\bsports drink\b/)) return 'rtd';
  // Protein bars/snacks
  if (title.includes('protein bar') || title.includes('protein cookie') || title.includes('protein chip') || title.includes('protein wafer') || title.includes('protein snack') || title.includes('nutrition bar') || title.includes('protein spread')) return 'proteinbars';
  // Gym food
  if (title.includes('meal replacement') || title.includes('peanut butter') || title.includes('nut butter') || title.includes('beef jerky') || title.match(/\bjerky\b/) || title.includes('rice cake') || title.includes('granola') || title.includes('oats') || title.includes('carbohydrate') || title.match(/\bcarb powder\b/)) return 'gymfood';
  // Vitamins & health
  if (title.match(/\bvitamin\b/) || title.includes('omega-3') || title.includes('omega 3') || title.includes('fish oil') || title.match(/\bmagnesium\b/) || title.match(/\belectrolyte\b/) || title.includes('greens powder') || title.includes('super greens') || title.match(/\bprobiotic\b/) || title.match(/\bnootropic\b/) || title.includes('test booster') || title.includes('testosterone booster') || title.match(/\bmelatonin\b/) || title.includes('sleep aid') || title.match(/\bsuperfood\b/)) return 'vitamins';
  // Clothing
  if (title.match(/\bsinglet\b/) || title.match(/\blegging\b/) || title.match(/\bactivewear\b/) || title.includes('gym wear') || title.match(/\bsports bra\b/) || title.includes('compression wear')) return 'clothing';
  // Protein powder
  if (title.includes('whey') || title.includes('isolate') || title.includes('casein') || title.includes('mass gainer') || title.includes('mass-gainer') || title.includes('weight gainer') || title.includes('plant protein') || title.includes('vegan protein') || title.includes('pea protein') || title.includes('collagen protein')) return 'protein';
  if (title.match(/\bprotein\b/)) return 'protein';
  if (title.includes('creatine')) return 'creatine';
  if (title.includes('pre-workout') || title.includes('pre workout') || title.includes('preworkout')) return 'preworkout';
  if (title.includes('oxyshred') || title.includes('fat burn') || title.includes('thermogenic') || title.includes('shred') || title.includes('l-carnitine') || title.includes('carnitine') || title.includes('fat metabolis')) return 'fatburner';
  if (title.includes('bcaa') || title.includes('amino acid') || title.includes(' eaa') || title.includes('glutamine') || title.includes('intra-workout') || title.includes('intra workout')) return 'bcaa';

  return null;
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
  log(`Retailers: ${RETAILERS.map(r => r.name).join(', ')} + Xplosiv + Sprint Fit + Payless Supplements + GNC NZ + Nutrition Warehouse`);

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

  // ── Shopify retailers (includes Payless — confirmed Shopify) ──
  for (const retailer of RETAILERS) {
    const products = await scrapeRetailer(retailer);
    allNew.push(...products);
    retailerStats[retailer.name] = products.length;
    await sleep(1500);
  }

  // ── Xplosiv (Magento HTML) ──
  try {
    const xplosivProducts = await scrapeXplosiv();
    allNew.push(...xplosivProducts);
    retailerStats['Xplosiv'] = xplosivProducts.length;
  } catch(e) {
    log(`Xplosiv scrape failed: ${e.message}`);
    retailerStats['Xplosiv'] = 0;
  }
  await sleep(1500);

  // ── Sprint Fit (n2 ERP HTML) ──
  try {
    const sprintfitProducts = await scrapeSprintFit();
    allNew.push(...sprintfitProducts);
    retailerStats['Sprint Fit'] = sprintfitProducts.length;
  } catch(e) {
    log(`Sprint Fit scrape failed: ${e.message}`);
    retailerStats['Sprint Fit'] = 0;
  }
  await sleep(1500);

  // ── Elite Supplements (Shopify — HTML fallback) ──
  try {
    const eliteProducts = await scrapeEliteSupplements();
    allNew.push(...eliteProducts);
    retailerStats['Elite Supplements'] = eliteProducts.length;
  } catch(e) {
    log(`Elite Supplements scrape failed: ${e.message}`);
    retailerStats['Elite Supplements'] = 0;
  }
  await sleep(1500);

  // ── Nutrition Warehouse NZ (sitemap + product page JSON-LD) ──
  try {
    const nwProducts = await scrapeNutritionWarehouse();
    allNew.push(...nwProducts);
    retailerStats['Nutrition Warehouse'] = nwProducts.length;
  } catch(e) {
    log(`Nutrition Warehouse scrape failed: ${e.message}`);
    retailerStats['Nutrition Warehouse'] = 0;
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

  // Sort by category, then brand, then price
  merged.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.brand !== b.brand)       return a.brand.localeCompare(b.brand);
    return a.priceFrom - b.priceFrom;
  });

  // Build category counts for all 9 categories
  const ALL_CATS = ['protein','proteinbars','rtd','creatine','preworkout','fatburner','bcaa','vitamins','gymfood','accessories','clothing'];
  const catCounts = {};
  for (const c of ALL_CATS) catCounts[c] = merged.filter(p => p.category === c).length;

  const retailerList = [...new Set(merged.map(p => p.retailerName))];

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

  log('');
  log('=== Scrape complete ===');
  log(`Total products: ${merged.length}`);
  log('');
  log('By retailer:');
  for (const [name, count] of Object.entries(retailerStats)) {
    log(`  ${name.padEnd(28)} ${count} products`);
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
