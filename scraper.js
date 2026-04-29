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

// ─── XPLOSIV SCRAPER (Magento — JS-rendered, parse HTML product cards) ─────
async function scrapeXplosiv() {
  log('Scraping Xplosiv (Magento HTML)...');
  const products = [];
  const seen = new Set();

  // Real Xplosiv URL structure confirmed from their live navigation
  const categories = [
    { slug: 'protein-powder.html',        cat: 'protein'      },
    { slug: 'protein-bars-snacks.html',   cat: 'proteinbars'  },
    { slug: 'ready-to-drink.html',        cat: 'rtd'          },
    { slug: 'creatine.html',              cat: 'creatine'     },
    { slug: 'pre-workout.html',           cat: 'preworkout'   },
    { slug: 'fat-burners.html',           cat: 'fatburner'    },
    { slug: 'amino-acids.html',           cat: 'bcaa'         },
    { slug: 'vitamins-health.html',       cat: 'vitamins'     },
    { slug: 'accessories.html',           cat: 'accessories'  },
    { slug: 'clothing.html',              cat: 'clothing'     },
  ];

  for (const cat of categories) {
    try {
      await sleep(800);
      const url = `https://xplosiv.nz/${cat.slug}`;
      const html = await fetchPage(url);

      // Xplosiv Magento pages embed product data in JSON-LD on some pages
      // and also in meta tags. Try JSON-LD first.
      const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
      let found = 0;
      for (const match of jsonLdMatches) {
        try {
          const inner = match.replace(/<script[^>]*>/, '').replace('</script>', '');
          const json = JSON.parse(inner);
          const items = json['@type'] === 'ItemList'  ? (json.itemListElement || []) :
                        json['@type'] === 'Product'   ? [{ item: json }] : [];
          for (const item of items) {
            const p = item.item || item;
            if (!p.name || !p.offers) continue;
            const price = parseFloat(p.offers.price || p.offers.lowPrice || '0');
            if (!price) continue;
            const key = `xplosiv_${p.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found++;
            products.push({
              id:           `xplosiv_${(p.url||p.name).replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
              retailer:     'xplosiv',
              retailerName: 'Xplosiv',
              brand:        p.brand?.name || 'Xplosiv',
              name:         p.name,
              category:     cat.cat,
              description:  (p.description || '').slice(0, 280),
              priceFrom:    price,
              priceTo:      parseFloat(p.offers.highPrice || price) || price,
              currency:     'NZD',
              variants:     [{ id: 1, title: 'Default', price, available: true }],
              url:          p.url || url,
              imageUrl:     Array.isArray(p.image) ? p.image[0] : (p.image || null),
              updatedAt:    new Date().toISOString(),
              priceHistory: []
            });
          }
        } catch(e) { /* skip */ }
      }

      // Fallback: parse HTML product cards (class="product-item-info" or price data attrs)
      if (found === 0) {
        // Extract product name + price from HTML price spans and product name links
        const nameMatches = [...html.matchAll(/class="product-item-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
        const priceMatches = [...html.matchAll(/class="price">NZ\$?([\d,]+\.?\d*)</g)];
        for (let i = 0; i < nameMatches.length; i++) {
          const rawName = nameMatches[i][2].replace(/<[^>]+>/g, '').trim();
          const productUrl = nameMatches[i][1];
          const price = priceMatches[i] ? parseFloat(priceMatches[i][1].replace(',','')) : 0;
          if (!rawName || !price) continue;
          const key = `xplosiv_${rawName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          products.push({
            id:           `xplosiv_${rawName.replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
            retailer:     'xplosiv',
            retailerName: 'Xplosiv',
            brand:        'Unknown',
            name:         rawName,
            category:     cat.cat,
            description:  '',
            priceFrom:    price,
            priceTo:      price,
            currency:     'NZD',
            variants:     [{ id: 1, title: 'Default', price, available: true }],
            url:          productUrl || url,
            imageUrl:     null,
            updatedAt:    new Date().toISOString(),
            priceHistory: []
          });
        }
      }
      log(`  Xplosiv ${cat.slug}: ${found || 0} products`);
    } catch(e) {
      log(`  Xplosiv ${cat.slug} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Xplosiv`);
  return products;
}
// ─── SPRINT FIT SCRAPER (n2 ERP — HTML product cards) ──────────
// Sprint Fit uses n2 ERP by First Software — NOT Shopify/Magento.
// Products are server-rendered HTML. Category IDs confirmed from live nav.
async function scrapeSprintFit() {
  log('Scraping Sprint Fit (n2 ERP HTML)...');
  const products = [];
  const seen = new Set();

  // Real category IDs confirmed from https://www.sprintfit.co.nz/products/category/290/sports-supplements
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
    { id: 547,  slug: 'gut-health',               cat: 'vitamins'     },
    { id: 563,  slug: 'sleep-support',            cat: 'vitamins'     },
    { id: 15,   slug: 'accessories',              cat: 'accessories'  },
    { id: 76,   slug: 'shakers-water-bottles',    cat: 'accessories'  },
    { id: 285,  slug: 'gym-meal-bags',            cat: 'accessories'  },
    { id: 288,  slug: 'straps-wraps-rehab',       cat: 'accessories'  },
    { id: 525,  slug: 'apparel-clothing',         cat: 'clothing'     },
  ];

  for (const cat of categories) {
    try {
      await sleep(700);
      const url = `https://www.sprintfit.co.nz/products/category/${cat.id}/${cat.slug}?pgNmbr=1`;
      const html = await fetchPage(url);

      // Sprint Fit n2 ERP embeds JSON-LD Product schema for each item on listing pages
      const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
      let found = 0;

      for (const match of jsonLdMatches) {
        try {
          const inner = match.replace(/<script[^>]*>/, '').replace('</script>', '');
          const json = JSON.parse(inner);
          // Sprint Fit embeds individual Product objects per card
          const items = json['@type'] === 'ItemList' ? (json.itemListElement || []) :
                        json['@type'] === 'Product'  ? [{ item: json }] : [];
          for (const item of items) {
            const p = item.item || item;
            if (!p.name || !p.offers) continue;
            const price = parseFloat(p.offers.price || p.offers.lowPrice || '0');
            if (!price) continue;
            const key = `sf_${p.name}_${price}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found++;
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
              url:          p.url || url,
              imageUrl:     Array.isArray(p.image) ? p.image[0] : (p.image || null),
              updatedAt:    new Date().toISOString(),
              priceHistory: []
            });
          }
        } catch(e) { /* skip */ }
      }

      // Fallback: parse Sprint Fit HTML product cards directly
      if (found === 0) {
        // Product names appear in <a class="product-name"> or <strong> inside product cards
        const nameRx = /href="(https:\/\/www\.sprintfit\.co\.nz\/product\/[^"]+)"[^>]*>\s*<img[^>]*>\s*[\s\S]*?<strong>([\s\S]*?)<\/strong>/g;
        const priceRx = /\$(\d[\d,]*\.?\d*)/g;
        const nameMatches = [...html.matchAll(/<a href="(https:\/\/www\.sprintfit\.co\.nz\/product\/[^"]+)"[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]{10,200}?)<\/a>/g)];
        for (const m of nameMatches) {
          const rawName = m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
          if (!rawName || rawName.length < 4) continue;
          // Try to find a price near this match
          const excerpt = html.slice(Math.max(0, m.index - 100), m.index + 400);
          const pm = excerpt.match(/\$([\d,]+\.?\d*)/);
          const price = pm ? parseFloat(pm[1].replace(',','')) : 0;
          if (!price) continue;
          const key = `sf_${rawName}_${price}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found++;
          products.push({
            id:           `sprintfit_${rawName.replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
            retailer:     'sprintfit',
            retailerName: 'Sprint Fit',
            brand:        'Unknown',
            name:         rawName,
            category:     cat.cat,
            description:  '',
            priceFrom:    price,
            priceTo:      price,
            currency:     'NZD',
            variants:     [{ id: 1, title: 'Default', price, available: true }],
            url:          m[1],
            imageUrl:     null,
            updatedAt:    new Date().toISOString(),
            priceHistory: []
          });
        }
      }
      log(`  Sprint Fit cat/${cat.id}: ${found} products`);
    } catch(e) {
      log(`  Sprint Fit cat/${cat.id} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Sprint Fit`);
  return products;
}

// ─── ELITE SUPPLEMENTS SCRAPER (Shopify — password-protected products.json) ─
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

// ─── CHEMIST WAREHOUSE SCRAPER (custom platform) ────────────────
// chemistwarehouse.co.nz uses a custom .NET platform.
// They expose a JSON search API used by their category pages.
async function scrapeChemistWarehouse() {
  log('Scraping Chemist Warehouse NZ (custom JSON API)...');
  const products = [];
  const seen = new Set();

  // CW NZ uses /api/2.0/page/category/ endpoint that returns product JSON
  const categories = [
    { id: 'sports-nutrition',     cat: 'protein'     },
    { id: 'protein-powders',      cat: 'protein'     },
    { id: 'protein-bars-snacks',  cat: 'proteinbars' },
    { id: 'pre-workout',          cat: 'preworkout'  },
    { id: 'fat-burners',          cat: 'fatburner'   },
    { id: 'amino-acids',          cat: 'bcaa'        },
    { id: 'vitamins',             cat: 'vitamins'    },
    { id: 'minerals',             cat: 'vitamins'    },
    { id: 'creatine',             cat: 'creatine'    },
  ];

  for (const cat of categories) {
    try {
      await sleep(800);
      // Try their JSON search API first
      const apiUrl = `https://www.chemistwarehouse.co.nz/api/2.0/page/category?urlSemantics=${cat.id}&pageSize=48`;
      const raw = await fetchPage(apiUrl);
      let data;
      try { data = JSON.parse(raw); } catch(e) {
        // Fall back to JSON-LD on category HTML page
        const html = await fetchPage(`https://www.chemistwarehouse.co.nz/shop-online/1255/${cat.id}`);
        const matches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        for (const m of matches) {
          try {
            const inner = m.replace(/<script[^>]*>/, '').replace('</script>','');
            const json = JSON.parse(inner);
            if (json['@type']==='ItemList'||json['@type']==='Product') { data = json; break; }
          } catch(e2){}
        }
        if (!data) { log(`  Chemist Warehouse ${cat.id}: no data`); continue; }
      }

      // Handle both API response and JSON-LD formats
      const items = data.products || data.Items || data.itemListElement
        ? (data.products || data.Items || data.itemListElement || [])
        : (data['@type']==='Product' ? [data] : []);

      for (const item of items) {
        const p = item.item || item;
        const title = p.name || p.Name || p.title || '';
        if (!title) continue;
        const key = `cw_${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const price = parseFloat(
          p.price || p.Price || p.offers?.price || p.offers?.lowPrice || '0'
        );
        if (!price) continue;
        products.push({
          id:           `chemistwarehouse_${title.replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
          retailer:     'chemistwarehouse',
          retailerName: 'Chemist Warehouse',
          brand:        p.brand?.name || p.Brand || p.brand || 'Unknown',
          name:         title,
          category:     cat.cat,
          description:  (p.description || p.Description || '').replace(/<[^>]+>/g,'').slice(0,280),
          priceFrom:    price,
          priceTo:      parseFloat(p.offers?.highPrice || price) || price,
          currency:     'NZD',
          variants:     [{ id: 1, title: 'Default', price, available: true }],
          url:          p.url || p.URL || `https://www.chemistwarehouse.co.nz/shop-online/1255/${cat.id}`,
          imageUrl:     p.image || p.Image || null,
          updatedAt:    new Date().toISOString(),
          priceHistory: []
        });
      }
      log(`  Chemist Warehouse ${cat.id}: ${products.length} total so far`);
    } catch(e) {
      log(`  Chemist Warehouse ${cat.id} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Chemist Warehouse`);
  return products;
}
// ─── NUTRITION WAREHOUSE SCRAPER (custom platform — JSON-LD from collection pages) ──
async function scrapeNutritionWarehouse() {
  log('Scraping Nutrition Warehouse NZ...');
  const products = [];
  const seen = new Set();

  const categories = [
    { path: 'collections/protein-powder',  cat: 'protein'     },
    { path: 'collections/protein-bars',    cat: 'proteinbars' },
    { path: 'collections/creatine',        cat: 'creatine'    },
    { path: 'collections/pre-workout',     cat: 'preworkout'  },
    { path: 'collections/fat-burners',     cat: 'fatburner'   },
    { path: 'collections/amino-acids',     cat: 'bcaa'        },
    { path: 'collections/vitamins-minerals', cat: 'vitamins'  },
    { path: 'collections/rtd',             cat: 'rtd'         },
    { path: 'collections/accessories',     cat: 'accessories' },
    { path: 'collections/gym-wear',        cat: 'clothing'    },
    { path: 'collections/health-foods',    cat: 'gymfood'     },
  ];

  const suppKw = SUPP_KEYWORDS;
  const excluded = ['treadmill','barbell','dumbbell','kettlebell','power rack','squat rack','bench press','perfume','fragrance','skincare'];

  for (const cat of categories) {
    try {
      await sleep(700);
      const url = `https://www.nutritionwarehouse.co.nz/${cat.path}`;
      const pageData = await fetchPage(url);

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
            const key = `nw_${p.name}_${price}`;
            if (seen.has(key)) continue;
            seen.add(key);

            products.push({
              id:           `nutritionwarehouse_${(p.url||p.name).replace(/[^a-z0-9]/gi,'_').slice(0,60)}`,
              retailer:     'nutritionwarehouse',
              retailerName: 'Nutrition Warehouse',
              brand:        p.brand?.name || 'Unknown',
              name:         p.name,
              category:     cat.cat,
              description:  (p.description || '').slice(0, 280),
              priceFrom:    price,
              priceTo:      parseFloat(p.offers.highPrice || price) || price,
              currency:     'NZD',
              variants:     [{ id: 1, title: 'Default', price, available: true }],
              url:          p.url || `https://www.nutritionwarehouse.co.nz/${cat.path}`,
              imageUrl:     p.image || null,
              updatedAt:    new Date().toISOString(),
              priceHistory: []
            });
          }
        } catch(e) { /* skip malformed JSON-LD */ }
      }
    } catch(e) {
      log(`  Nutrition Warehouse category ${cat.path} error: ${e.message}`);
    }
  }

  log(`  Found ${products.length} products from Nutrition Warehouse`);
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

  // ── Chemist Warehouse NZ (custom JSON API) ──
  try {
    const cwProducts = await scrapeChemistWarehouse();
    allNew.push(...cwProducts);
    retailerStats['Chemist Warehouse'] = cwProducts.length;
  } catch(e) {
    log(`Chemist Warehouse scrape failed: ${e.message}`);
    retailerStats['Chemist Warehouse'] = 0;
  }
  await sleep(1500);

  // ── Nutrition Warehouse NZ (custom platform) ──
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
