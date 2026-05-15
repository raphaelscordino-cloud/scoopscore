/**
 * ScoopScore Price Scraper v4
 * ─────────────────────────────────────────────────────────────
 * KEY CHANGES FROM v3:
 *
 * 1. REMOVED gymfood, accessories, clothing categories — products
 *    matching those keywords are excluded, not miscategorised.
 *
 * 2. RETRY WITH BACKOFF — 429/503 responses are retried up to 3 times
 *    with exponential backoff (2s → 4s → 8s) so rate-limited stores
 *    are fully scraped instead of returning 0 products.
 *
 * 3. SLOWER PACING — 1s between pages (was 400ms), 3s between retailer
 *    batches (was 1s), batch size reduced to 3 (was 5) to avoid
 *    triggering rate limits in the first place.
 *
 * Run manually:   node scraper.js
 * GitHub Actions: see .github/workflows/scrape.yml
 * ─────────────────────────────────────────────────────────────
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT_FILE = path.join(__dirname, 'data', 'products.json');
const LOG_FILE = path.join(__dirname, 'data', 'scrape.log');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// ─── HARD EXCLUSIONS ───────────────────────────────────────────
// Products matching any of these are skipped entirely.
// Includes gym equipment, cosmetics, AND the three dropped categories
// (accessories, clothing, gymfood) so they never appear in output.
const EXCLUDE_PATTERNS = [
  // Gym equipment
  /\btreadmill\b/, /\brower\b/, /\bstationary\s*bike\b/, /\bspin\s*bike\b/,
  /\bpower\s*rack\b/, /\bsquat\s*rack\b/, /\bdumbbell\b/, /\bbarbell\b/,
  /\bkettlebell\b/, /\bweight\s*plate\b/, /\bgym\s*flooring\b/,
  /\bcold\s*plunge\b/, /\bice\s*bath\b/,
  // Cosmetics / non-supplements
  /\bperfume\b/, /\bfragrance\b/, /\bskincare\b/, /\bmakeup\b/,
  /\bhair\s*care\b/, /\bhaircare\b/,
  /\bworkout\s*equipment\b/,
  /\bbook\b/, /\bebook\b/,
  /\bphone\s*case\b/, /\bwallet\b/, /\bsunglasses\b/,
  // Accessories (shakers, bags, belts, etc.)
  /\bshaker\s*bottle\b/, /\bshaker\s*cup\b/, /\bblender\s*bottle\b/, /\bwater\s*bottle\b/,
  /\bgym\s*bag\b/, /\blifting\s*strap\b/, /\blifting\s*belt\b/,
  /\bgym\s*glove\b/, /\bwrist\s*wrap\b/, /\bknee\s*sleeve\b/,
  /\bresistance\s*band\b/, /\bfoam\s*roller\b/,
  // Clothing
  /\bgym\s*wear\b/, /\bgym\s*clothing\b/, /\bactivewear\b/, /\bactive\s*wear\b/,
  /\bsinglet\b/, /\bleggings\b/, /\bsports\s*bra\b/, /\bcompression\s*wear\b/,
  // Gym food (meal replacements, snack foods, condiments)
  /\bmeal\s*replacement\b/, /\bpeanut\s*butter\b/, /\bnut\s*butter\b/,
  /\bbeef\s*jerky\b/, /\brice\s*cake\b/, /\bgranola\b/, /\bovernight\s*oats\b/,
  // Generic pharmacy / chemist vitamins — not gym goods
  /\bvitamin\s*c\b/, /\bvitamin\s*b12\b/, /\bvitamin\s*b\s*complex\b/,
  /\bzinc\s*(tablet|lozenge|capsule)\b/,
  /\biron\s*(supplement|tablet)\b/,
  /\bfolate\b/, /\bfolic\s*acid\b/,
  /\bcalcium\s*(supplement|tablet)\b/,
  /\bimmunity\b/, /\bimmune\s*support\b/,
  /\bcold\s*(and|&)\s*flu\b/, /\bhayfever\b/, /\ballergy\b/,
  /\bprenatal\b/, /\bpregnancy\s*vitamin\b/,
  /\bkids?\s*vitamin\b/, /\bchildren.s\s*vitamin\b/,
  /\bcoenzyme\s*q10\b/, /\bcoq10\b/,
];

// ─── CATEGORY RULES ────────────────────────────────────────────
// Each rule has: keywords (matched against combined title+type+tags text),
// and the category it maps to.
// ORDER MATTERS — first match wins for deterministic assignment.
// More specific rules are listed first.

const CATEGORY_RULES = [
  // ── Protein Bars / Snacks (must come before generic 'protein') ──
  {
    cat: 'proteinbars',
    keywords: [
      'protein bar','protein bars','protein cookie','protein cookies',
      'protein chip','protein chips','protein wafer','protein spread',
      'protein snack','protein snacks','snack bar','nutrition bar',
      'high protein snack','energy bar',
    ],
  },

  // ── RTD (must come before generic 'protein' / 'energy') ──
  {
    cat: 'rtd',
    keywords: [
      'rtd','ready to drink','ready-to-drink','protein water',
      'protein shake','protein drink','energy drink','energy drinks',
      'sports drink','sports drinks','hydration drink',
      'electrolyte drink','recovery drink','canned protein',
    ],
  },

  // ── Creatine ──
  {
    cat: 'creatine',
    keywords: [
      'creatine monohydrate','creatine hcl','creatine blend',
      'creatine supplement','creatine powder','creatine capsules',
      'creatine gummies','flavoured creatine','creatine',
    ],
  },

  // ── Pre-workout ──
  {
    cat: 'preworkout',
    keywords: [
      'pre-workout','pre workout','preworkout','pre workouts',
      'stim free pre','non-stim pre','pump pre-workout',
      'pump pre workout','stimulant free pre',
    ],
  },

  // ── Fat Burners ──
  {
    cat: 'fatburner',
    keywords: [
      'fat burner','fat burners','fat metaboliser','fat metabolisers',
      'thermogenic','thermogenics','weight loss','weight management',
      'l-carnitine','l carnitine','carnitine','cla',
      'appetite control','metabolism support','oxyshred',
      'shred supplement','fat loss',
    ],
  },

  // ── BCAAs / Aminos ──
  {
    cat: 'bcaa',
    keywords: [
      'bcaa','bcaas','eaa','eaas','amino acids','amino acid',
      'essential amino','intra-workout','intra workout',
      'glutamine','post workout','post-workout','aminos',
    ],
  },

  // ── Protein (broad — intentionally last so specifics above win) ──
  {
    cat: 'protein',
    keywords: [
      'whey protein isolate','whey protein concentrate','whey protein blend',
      'whey protein powder','whey protein','hydrolysed whey','hydrolyzed whey',
      'hydrolysed protein','hydrolyzed protein',
      'plant based protein','plant protein','vegan protein',
      'pea protein','hemp protein','rice protein','soy protein',
      'mass gainer','mass gainers','weight gainer',
      'casein protein','casein','egg protein','beef protein',
      'collagen protein','thermogenic protein','lean protein',
      'low carb protein','protein powder','protein blend',
      'isolate protein','whey isolate','wpi','wpc',
      'protein', // catch-all for protein — listed last within this rule
    ],
  },
];

// ─── BROAD GYM SIGNALS ─────────────────────────────────────────
// Used as a FINAL safety-net: if none of the category rules matched,
// we check these signals to decide if the product should still be
// included under a best-guess category.
const GYM_SIGNALS = [
  'supplement','supplements','sports nutrition','sports supplement',
  'pre-workout','preworkout','creatine','protein','whey','casein',
  'bcaa','eaa','amino','glutamine','collagen','omega',
  'fat burner','thermogenic','carnitine','oxyshred','shred',
  'mass gainer','rtd','ready to drink','protein bar','protein cookie',
];

// ─── DETECTION LOGIC ───────────────────────────────────────────
/**
 * Build a single normalised search string from all available metadata.
 * The more data we include, the less likely we are to miss a product.
 */
function buildSearchText(title, productType, tags, description) {
  return [
    title || '',
    productType || '',
    Array.isArray(tags) ? tags.join(' ') : (tags || ''),
    (description || '').slice(0, 200),
  ].join(' ').toLowerCase();
}

/**
 * Detect category using multi-pass keyword matching.
 * Returns { cat, matched } or null if no match.
 */
function detectCategory(title, productType, tags, description) {
  const text = buildSearchText(title, productType, tags, description);

  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      // Use word-boundary where possible; fallback to includes for phrases
      const hasSpace = kw.includes(' ') || kw.includes('-');
      const matched  = hasSpace
        ? text.includes(kw)
        : new RegExp(`\\b${kw.replace(/[-]/g, '[-]')}\\b`).test(text);
      if (matched) return rule.cat;
    }
  }
  return null;
}

/**
 * Check if a product is gym-related even if we couldn't pin a category.
 * Checks title, product_type, AND tags.
 */
function isGymRelated(title, productType, tags, description) {
  const text = buildSearchText(title, productType, tags, description);
  if (EXCLUDE_PATTERNS.some(rx => rx.test(text))) return false;
  return GYM_SIGNALS.some(sig => text.includes(sig));
}

/**
 * Is this product explicitly excluded (equipment, cosmetics, etc.)?
 */
function isExcluded(title, productType, tags) {
  const text = buildSearchText(title, productType, tags, '');
  return EXCLUDE_PATTERNS.some(rx => rx.test(text));
}


// ── BRAND NORMALISATION ───────────────────────────────────────
const BRAND_ALIASES = {
  'mutant nutrition':'Mutant','mutant':'Mutant','mutant supplements':'Mutant',
  'optimum nutrition':'Optimum Nutrition','on':'Optimum Nutrition','optimum':'Optimum Nutrition',
  'bsn':'BSN',
  'dymatize':'Dymatize','dymatize nutrition':'Dymatize',
  'muscletech':'MuscleTech','muscle tech':'MuscleTech',
  'ghost':'Ghost','ghost lifestyle':'Ghost',
  'ehp labs':'EHP Labs','ehplabs':'EHP Labs',
  'myprotein':'Myprotein','my protein':'Myprotein',
  'macro mike':'Macro Mike','macromike':'Macro Mike',
  'faction labs':'Faction Labs','faction':'Faction Labs',
  'rule 1':'Rule 1','rule one':'Rule 1','r1 proteins':'Rule 1',
  "max's":"Max's",'maxs':"Max's",
  'emrald labs':'Emrald Labs','emrald':'Emrald Labs',
  'gen-tec':'Gen-Tec','gen tec':'Gen-Tec','gentec':'Gen-Tec',
  'musashi':'Musashi',
  'balance':'Balance','balance sports nutrition':'Balance',
  'cellucor':'Cellucor',
  'redcon1':'Redcon1','redcon 1':'Redcon1',
  'ryse':'Ryse','ryse supps':'Ryse',
  'atp science':'ATP Science',
  'isopure':'Isopure','the isopure company':'Isopure',
  'vpa':'VPA','vpa australia':'VPA',
  'bulk nutrients':'Bulk Nutrients',
  'true protein':'True Protein',
  'prana on':'Prana ON','prana':'Prana ON',
  'body science':'Body Science','bsc':'Body Science',
  'calocurb':'Calocurb',
  'science in sport':'Science in Sport','sis':'Science in Sport',
  'switch nutrition':'Switch Nutrition','switch':'Switch Nutrition',
  'nutrition warehouse':'Nutrition Warehouse',
  'nz muscle':'NZ Muscle',
  'xtend':'Xtend',
  'inspired nutraceuticals':'Inspired','inspired':'Inspired',
  'outbreak nutrition':'Outbreak','outbreak':'Outbreak',
  'staunch':'Staunch','staunch nation':'Staunch',
  'axe & sledge':'Axe & Sledge','axe and sledge':'Axe & Sledge',
  'gorilla mind':'Gorilla Mind',
  'cbum':'CBUM','cbum itholics':'CBUM',
};

function normalizeBrand(raw) {
  if (!raw || raw.trim() === '' || raw === 'Unknown') return 'Unknown';
  const key = raw.toLowerCase().trim();
  if (BRAND_ALIASES[key]) return BRAND_ALIASES[key];
  return raw.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── LOGGING ───────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

// ─── HTTP HELPERS ──────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'ScoopScore/3.0 price-comparison-bot (+https://scoopscore.co.nz)',
        ...headers
      },
      timeout: 20000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SHOPIFY GRAPHQL STOREFRONT API ────────────────────────────
const GQL_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          productType
          vendor
          tags
          description
          images(first: 1) { edges { node { url } } }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price { amount currencyCode }
                availableForSale
                sku
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchShopifyGraphQL(domain, cursor = null) {
  const body = JSON.stringify({
    query: GQL_QUERY,
    variables: { cursor }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: domain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      path: '/api/2024-01/graphql.json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Shopify-Storefront-Access-Token': 'anonymous',
        'User-Agent': 'ScoopScore/3.0 price-comparison-bot',
      },
      timeout: 25000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GQL HTTP ${res.statusCode} for ${domain}`));
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`GQL JSON parse error for ${domain}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`GQL timeout: ${domain}`)); });
    req.write(body);
    req.end();
  });
}

// ─── SHOPIFY products.json FALLBACK ────────────────────────────
async function fetchProductsJSON(baseUrl, page = 1) {
  const url = `https://${baseUrl}/products.json?limit=250&page=${page}`;
  const data = await httpGetWithRetry(url);
  if (data.trim().startsWith('<')) throw new Error('Got HTML instead of JSON');
  return JSON.parse(data);
}

// Retry wrapper — handles 429 / 503 with exponential backoff
async function httpGetWithRetry(url, headers = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await httpGet(url, headers);
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.includes('503');
      if (isRateLimit && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        log(`    ↻ Rate limited (${err.message.match(/\d{3}/)?.[0] || '?'}) — retrying in ${delay/1000}s (attempt ${attempt}/${maxRetries})`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

// ─── BUILD PRODUCT RECORD ──────────────────────────────────────
/**
 * Given raw product data and a retailer config, return a normalised
 * product record — or null if the product should be skipped.
 *
 * Skip conditions (as tight as possible):
 *   1. Hard-excluded (gym equipment, cosmetics, books)
 *   2. No purchasable price (all variants $0 / unparseable)
 *   3. Not gym-related at all (detectCategory returned null AND
 *      isGymRelated returned false)
 */
function buildProduct(retailer, rawTitle, handle, productType, vendor, tags, description, variants, imageUrl) {
  // Guard: hard exclusions first
  if (isExcluded(rawTitle, productType, tags)) return null;

  // Parse prices
  const allPrices = variants.map(v => parseFloat(v.price)).filter(p => !isNaN(p) && p > 0);
  if (allPrices.length === 0) return null; // no purchasable price

  // Category detection — uses title, type, tags, and first 200 chars of description
  let cat = detectCategory(rawTitle, productType, tags, description);

  // If no category matched, check gym signals before giving up
  if (!cat) {
    if (!isGymRelated(rawTitle, productType, tags, description)) return null; // truly irrelevant
    // Gym-related but uncategorised — use best-effort fallback
    cat = guessCategoryFromSignals(rawTitle, productType, tags);
  }

  // Final guard — if still no category, skip the product
  if (!cat) return null;

  const availVariants = variants.filter(v => v.available !== false);
  const minPrice = availVariants.length > 0
    ? Math.min(...availVariants.map(v => parseFloat(v.price)).filter(p => p > 0))
    : Math.min(...allPrices);

  return {
    id:           `${retailer.id}_${handle}`,
    retailer:     retailer.id,
    retailerName: retailer.name,
    brand:        normalizeBrand(vendor),
    name:         rawTitle,
    category:     cat,
    description:  (description || '').slice(0, 300),
    tags:         (Array.isArray(tags) ? tags : []).slice(0, 10),
    priceFrom:    parseFloat(minPrice.toFixed(2)),
    priceTo:      parseFloat(Math.max(...allPrices).toFixed(2)),
    available:    availVariants.length > 0,
    currency:     'NZD',
    variants,
    url:          `https://${retailer.baseUrl}/products/${handle}`,
    imageUrl:     imageUrl || null,
    updatedAt:    new Date().toISOString(),
    priceHistory: [],
  };
}

/**
 * Last-resort category guess for confirmed gym products that didn't
 * match any CATEGORY_RULES keyword. Checks broad signals in priority order.
 */
function guessCategoryFromSignals(title, productType, tags) {
  const text = buildSearchText(title, productType, tags, '');
  if (/creatine/.test(text))                                return 'creatine';
  if (/pre.?workout|preworkout/.test(text))                 return 'preworkout';
  if (/fat.?burn|thermogen|carnitine|shred/.test(text))     return 'fatburner';
  if (/bcaa|eaa|\bamino\b|glutamine/.test(text))            return 'bcaa';
  if (/protein.?bar|protein.?cookie|snack.?bar/.test(text)) return 'proteinbars';
  if (/ready.?to.?drink|rtd|energy.?drink/.test(text))      return 'rtd';
  if (/whey|isolate|casein|mass.?gain|plant.?protein|vegan.?protein|protein/.test(text)) return 'protein';
  return null; // can't categorise — will be excluded
}

// ─── SCRAPE ONE SHOPIFY STORE ───────────────────────────────────
async function scrapeShopifyStore(retailer) {
  log(`Scraping ${retailer.name}...`);
  const products = [];
  let skipped = 0;
  let cursor = null;
  let page = 0;

  // Try GraphQL first
  try {
    while (true) {
      page++;
      const result = await fetchShopifyGraphQL(retailer.baseUrl, cursor);

      if (result.errors || !result.data?.products) {
        throw new Error(result.errors?.[0]?.message || 'No product data in GQL response');
      }

      const { edges, pageInfo } = result.data.products;
      for (const { node } of edges) {
        const variants = node.variants.edges.map(({ node: v }) => ({
          id:        v.id,
          title:     v.title,
          price:     parseFloat(v.price.amount),
          sku:       v.sku || '',
          available: v.availableForSale,
        }));

        const desc   = node.description || '';
        const record = buildProduct(
          retailer,
          node.title,
          node.handle,
          node.productType,
          node.vendor,
          node.tags,
          desc,
          variants,
          node.images.edges[0]?.node.url || null,
        );

        if (record) products.push(record);
        else skipped++;
      }

      log(`  ${retailer.name} page ${page}: ${edges.length} fetched, ${skipped} skipped so far (GQL)`);
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
      await sleep(1000); // 1s between pages
    }

  } catch(gqlErr) {
    log(`  ${retailer.name} GQL failed (${gqlErr.message}), falling back to products.json...`);

    let jsonPage = 1;
    while (true) {
      try {
        const data  = await fetchProductsJSON(retailer.baseUrl, jsonPage);
        const batch = data.products || [];
        if (batch.length === 0) break;

        for (const raw of batch) {
          const desc = (raw.body_html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          const variants = (raw.variants || []).map(v => ({
            id:        v.id,
            title:     v.title,
            price:     parseFloat(v.price),
            sku:       v.sku || '',
            available: true, // products.json available flag is unreliable
          }));

          const record = buildProduct(
            retailer,
            raw.title,
            raw.handle || String(raw.id),
            raw.product_type,
            raw.vendor,
            raw.tags || [],
            desc,
            variants,
            raw.images?.[0]?.src || null,
          );

          if (record) products.push(record);
          else skipped++;
        }

        log(`  ${retailer.name} page ${jsonPage}: ${batch.length} fetched, ${skipped} skipped so far (JSON)`);
        if (batch.length < 250) break;
        jsonPage++;
        await sleep(1000); // 1s between pages to avoid rate limits
      } catch(jsonErr) {
        log(`  ${retailer.name} products.json page ${jsonPage} failed: ${jsonErr.message}`);
        break;
      }
    }
  }

  log(`  ${retailer.name}: ${products.length} products kept, ${skipped} skipped`);
  return products;
}

// ─── RETAILER LIST ─────────────────────────────────────────────
const RETAILERS = [
  { id: 'nzmuscle',            name: 'NZ Muscle',             baseUrl: 'nzmuscle.co.nz',                    freeShipping: 'Always free' },
  { id: 'sportsfuel',          name: 'Sportsfuel',            baseUrl: 'www.sportsfuel.co.nz',              freeShipping: 'Free over $60' },
  { id: 'scorpion',            name: 'Scorpion Supplements',  baseUrl: 'scorpionsupplements.co.nz',         freeShipping: 'Check site' },
  { id: 'asnonline',           name: 'ASN Online',            baseUrl: 'asnonline.co.nz',                   freeShipping: 'Free over $100' },
  { id: 'supplementsolutions', name: 'Supplement Solutions',  baseUrl: 'www.supplementsolutions.co.nz',     freeShipping: 'Check site' },
  { id: 'raiseys',             name: "Raisey's",              baseUrl: 'raiseys.co.nz',                     freeShipping: 'Check site' },
  { id: 'bodystrong',          name: 'BodyStrong',            baseUrl: 'bodystrong.co.nz',                  freeShipping: 'Check site' },
  { id: 'payless',             name: 'Payless Supplements',   baseUrl: 'paylesssupplements.co.nz',          freeShipping: 'Free shipping' },
  { id: 'supplementsnz',       name: 'Supplements NZ',        baseUrl: 'www.supplements.co.nz',             freeShipping: 'Free shipping' },
  { id: 'reactiv',             name: 'Reactiv Supplements',   baseUrl: 'www.reactivsupplements.co.nz',      freeShipping: 'Free NZ-wide' },
  { id: 'eatme',               name: 'Eat Me Supplements',    baseUrl: 'www.eatmesupplements.co.nz',        freeShipping: 'Check site' },
  { id: 'nutritionwarehouse',  name: 'Nutrition Warehouse',   baseUrl: 'www.nutritionwarehouse.co.nz',      freeShipping: 'Free over $60' },
  // Xplosiv and Sprint Fit are not Shopify and require Playwright (see README)
];

// ─── MERGE WITH EXISTING (preserve price history) ───────────────
function mergeWithExisting(newProducts, existing) {
  const existMap = {};
  for (const p of existing) existMap[p.id] = p;

  return newProducts.map(p => {
    const prev = existMap[p.id];
    if (!prev) return p;

    const history = prev.priceHistory || [];
    if (prev.priceFrom !== p.priceFrom) {
      history.push({ date: prev.updatedAt, price: prev.priceFrom });
      if (history.length > 30) history.shift();
    }
    return { ...p, priceHistory: history };
  });
}

// ─── MAIN ──────────────────────────────────────────────────────
async function main() {
  log('');
  log('═══════════════════════════════════════════');
  log('  ScoopScore Scraper v4 — Rate-Limit Safe  ');
  log('═══════════════════════════════════════════');
  log(`  Retailers: ${RETAILERS.length}`);
  log(`  Method: Shopify GraphQL → products.json fallback`);
  log(`  Categories: protein, proteinbars, rtd, creatine, preworkout, fatburner, bcaa`);
  log(`  Pacing: batch=3, page delay=1s, batch pause=3s, retry 429/503 x3`);
  log('');

  let existing = [];
  try {
    const raw = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    existing = raw.products || [];
    log(`  Loaded ${existing.length} existing products for price history`);
  } catch(e) { log('  No existing data — fresh start'); }

  const allProducts = [];
  const stats = {};
  const startTime = Date.now();

  const BATCH_SIZE = 3; // smaller batches = less simultaneous load on any one server
  for (let i = 0; i < RETAILERS.length; i += BATCH_SIZE) {
    const batch = RETAILERS.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(r => scrapeShopifyStore(r)));
    for (let j = 0; j < results.length; j++) {
      const retailer = batch[j];
      if (results[j].status === 'fulfilled') {
        const products = results[j].value;
        allProducts.push(...products);
        stats[retailer.name] = products.length;
      } else {
        log(`  ${retailer.name} FAILED: ${results[j].reason?.message}`);
        stats[retailer.name] = 0;
      }
    }
    if (i + BATCH_SIZE < RETAILERS.length) await sleep(3000); // 3s between batches
  }

  // Deduplicate by id (same product from multiple collections within one store)
  const seen = new Set();
  const deduped = allProducts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const merged = mergeWithExisting(deduped, existing);

  merged.sort((a, b) => {
    const ca = a.category || 'zzz';
    const cb = b.category || 'zzz';
    if (ca !== cb) return ca.localeCompare(cb);
    const ba = a.brand || '';
    const bb = b.brand || '';
    if (ba !== bb) return ba.localeCompare(bb);
    return (a.priceFrom || 0) - (b.priceFrom || 0);
  });

  const ALL_CATS = ['protein','proteinbars','rtd','creatine','preworkout','fatburner','bcaa'];
  const catCounts = {};
  for (const c of ALL_CATS) catCounts[c] = merged.filter(p => p.category === c).length;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const output = {
    meta: {
      updatedAt:     new Date().toISOString(),
      totalProducts: merged.length,
      retailers:     RETAILERS.map(r => r.name),
      retailerStats: stats,
      categories:    catCounts,
      scrapeMethod:  'shopify-graphql-v4',
      elapsed:       `${elapsed}s`,
    },
    products: merged,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output));
  log('');
  log('═══════════════════ RESULTS ═══════════════════');
  log(`  Total products: ${merged.length}`);
  log(`  Time: ${elapsed}s`);
  log('');
  log('  By retailer:');
  for (const [name, count] of Object.entries(stats)) {
    const bar = '█'.repeat(Math.min(30, Math.round(count / 10)));
    log(`    ${name.padEnd(26)} ${String(count).padStart(5)}  ${bar}`);
  }
  log('');
  log('  By category:');
  for (const [cat, count] of Object.entries(catCounts)) {
    log(`    ${cat.padEnd(15)} ${count}`);
  }
  log(`\n  Output: ${OUT_FILE}`);
  log('═══════════════════════════════════════════════');
}

main().catch(err => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
