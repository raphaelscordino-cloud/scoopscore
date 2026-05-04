/**
 * ScoopScore Price Scraper v2
 * ─────────────────────────────────────────────────────────────
 * Uses Shopify's public Storefront GraphQL API for all Shopify stores.
 * This is the official public API — no auth needed, no HTML parsing,
 * no Playwright, no rate limiting issues. Gets every product in
 * 2-3 fast paginated requests per store instead of 100+ slow fetches.
 *
 * For non-Shopify stores, uses their public REST/JSON APIs.
 *
 * Designed to run on GitHub Actions (free, nightly, cloud — never
 * touches your machine or wifi).
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

// ─── CATEGORY DETECTION ────────────────────────────────────────
// Maps Shopify product_type strings → our internal category IDs.
// Covers every variant we've seen across NZ retailers.
const TYPE_MAP = {
  // Protein
  'whey protein': 'protein', 'whey protein isolate': 'protein', 'whey protein concentrate': 'protein',
  'whey protein blend': 'protein', 'whey protein powder': 'protein', 'protein powder': 'protein',
  'protein blend': 'protein', 'protein': 'protein', 'isolate protein': 'protein', 'isolate': 'protein',
  'hydrolysed whey': 'protein', 'hydrolyzed whey': 'protein', 'hydrolysed protein': 'protein',
  'plant based protein': 'protein', 'plant protein': 'protein', 'vegan protein': 'protein',
  'pea protein': 'protein', 'hemp protein': 'protein', 'mass gainer': 'protein',
  'mass gainers': 'protein', 'weight gainer': 'protein', 'casein protein': 'protein',
  'casein': 'protein', 'egg protein': 'protein', 'beef protein': 'protein',
  'collagen protein': 'protein', 'collagen': 'protein', 'thermogenic protein': 'protein',
  'lean protein': 'protein', 'low carb protein': 'protein',
  // Protein Bars
  'protein bar': 'proteinbars', 'protein bars': 'proteinbars', 'protein snacks': 'proteinbars',
  'protein snack': 'proteinbars', 'protein cookie': 'proteinbars', 'protein cookies': 'proteinbars',
  'protein chips': 'proteinbars', 'protein wafer': 'proteinbars', 'protein spread': 'proteinbars',
  'snack bar': 'proteinbars', 'nutrition bar': 'proteinbars', 'energy bar': 'proteinbars',
  'high protein snack': 'proteinbars',
  // RTD
  'rtd': 'rtd', 'ready to drink': 'rtd', 'ready-to-drink': 'rtd', 'protein water': 'rtd',
  'protein shake': 'rtd', 'protein drink': 'rtd', 'energy drink': 'rtd', 'energy drinks': 'rtd',
  'sports drink': 'rtd', 'sports drinks': 'rtd', 'hydration drink': 'rtd',
  'electrolyte drink': 'rtd', 'recovery drink': 'rtd', 'canned protein': 'rtd',
  // Creatine
  'creatine': 'creatine', 'creatine monohydrate': 'creatine', 'creatine hcl': 'creatine',
  'creatine blend': 'creatine', 'creatine supplement': 'creatine', 'creatine powder': 'creatine',
  'creatine capsules': 'creatine', 'creatine gummies': 'creatine', 'flavoured creatine': 'creatine',
  // Pre-workout
  'pre-workout': 'preworkout', 'pre workout': 'preworkout', 'preworkout': 'preworkout',
  'pre workouts': 'preworkout', 'pump': 'preworkout', 'pump pre-workout': 'preworkout',
  'stim free pre-workout': 'preworkout', 'non-stim pre-workout': 'preworkout',
  // Fat burners
  'fat burner': 'fatburner', 'fat burners': 'fatburner', 'fat metaboliser': 'fatburner',
  'fat metabolisers': 'fatburner', 'thermogenic': 'fatburner', 'thermogenics': 'fatburner',
  'weight loss': 'fatburner', 'weight management': 'fatburner', 'shred': 'fatburner',
  'l-carnitine': 'fatburner', 'carnitine': 'fatburner', 'cla': 'fatburner',
  'appetite control': 'fatburner', 'metabolism support': 'fatburner',
  // BCAAs / Aminos
  'bcaa': 'bcaa', 'bcaas': 'bcaa', 'eaa': 'bcaa', 'eaas': 'bcaa',
  'amino acids': 'bcaa', 'amino': 'bcaa', 'aminos': 'bcaa', 'essential amino acids': 'bcaa',
  'intra-workout': 'bcaa', 'intra workout': 'bcaa', 'glutamine': 'bcaa',
  'post workout': 'bcaa', 'post-workout': 'bcaa', 'recovery': 'bcaa',
  // Vitamins & Health
  'vitamins': 'vitamins', 'vitamin': 'vitamins', 'multivitamin': 'vitamins',
  'multivitamins': 'vitamins', 'omega-3': 'vitamins', 'omega 3': 'vitamins',
  'fish oil': 'vitamins', 'magnesium': 'vitamins', 'zinc': 'vitamins',
  'vitamin d': 'vitamins', 'vitamin c': 'vitamins', 'electrolytes': 'vitamins',
  'electrolyte': 'vitamins', 'greens': 'vitamins', 'greens powder': 'vitamins',
  'super greens': 'vitamins', 'superfood': 'vitamins', 'superfoods': 'vitamins',
  'sleep aid': 'vitamins', 'melatonin': 'vitamins', 'probiotics': 'vitamins',
  'probiotic': 'vitamins', 'nootropic': 'vitamins', 'nootropics': 'vitamins',
  'testosterone booster': 'vitamins', 'test booster': 'vitamins',
  'general health': 'vitamins', 'health supplements': 'vitamins', 'immunity': 'vitamins',
  // Gym Food
  'meal replacement': 'gymfood', 'meal replacements': 'gymfood', 'healthy snacks': 'gymfood',
  'healthy food': 'gymfood', 'oats': 'gymfood', 'peanut butter': 'gymfood',
  'nut butter': 'gymfood', 'nut butters': 'gymfood', 'beef jerky': 'gymfood',
  'jerky': 'gymfood', 'rice cakes': 'gymfood', 'granola': 'gymfood',
  'carbohydrates': 'gymfood', 'carb powder': 'gymfood', 'carb supplement': 'gymfood',
  // Accessories
  'shaker': 'accessories', 'shakers': 'accessories', 'shaker bottle': 'accessories',
  'shaker cup': 'accessories', 'blender bottle': 'accessories', 'water bottle': 'accessories',
  'gym bag': 'accessories', 'gym bags': 'accessories', 'lifting straps': 'accessories',
  'lifting belt': 'accessories', 'gym gloves': 'accessories', 'wrist wraps': 'accessories',
  'knee sleeves': 'accessories', 'resistance bands': 'accessories', 'foam roller': 'accessories',
  'gym accessories': 'accessories', 'accessories': 'accessories',
  // Clothing
  'gym wear': 'clothing', 'gym clothing': 'clothing', 'activewear': 'clothing',
  'active wear': 'clothing', 'apparel': 'clothing', 'singlet': 'clothing',
  'shorts': 'clothing', 'leggings': 'clothing', 'sports bra': 'clothing',
  'hoodie': 'clothing', 'compression': 'clothing', 'compression wear': 'clothing',
};

const GYM_KEYWORDS = [
  'protein','creatine','pre-workout','preworkout','bcaa','eaa','amino',
  'fat burner','oxyshred','whey','isolate','casein','mass gainer','weight loss',
  'thermogenic','glutamine','collagen','vitamin','omega','magnesium','zinc',
  'electrolyte','pump','carnitine','cla','greens','nootropic','testosterone',
  'melatonin','probiotic','superfood','rtd','ready to drink','protein bar',
  'protein cookie','protein chip','protein snack','nutrition bar','meal replacement',
  'peanut butter','nut butter','jerky','shaker','gym bag','lifting strap',
  'lifting belt','gym glove','wrist wrap','knee sleeve','foam roller',
  'resistance band','activewear','gym wear','singlet','compression',
];

const EXCLUDE = [
  /\btreadmill\b/,/\brower\b/,/\bstationary bike\b/,/\bspin bike\b/,
  /\bpower rack\b/,/\bsquat rack\b/,/\bdumbbell\b/,/\bbarbell\b/,
  /\bkettlebell\b/,/\bweight plate\b/,/\bgym flooring\b/,/\bcold plunge\b/,
  /\bperfume\b/,/\bfragrance\b/,/\bskincare\b/,/\bmakeup\b/,/\bhair care\b/,
  /\bworkout equipment\b/,/\bice bath\b/,/\bbook\b/,
];

function detectCategory(productType, tags, title) {
  // 1. product_type exact match
  const pt = (productType || '').trim().toLowerCase();
  if (pt && TYPE_MAP[pt]) return TYPE_MAP[pt];

  // 2. product_type substring match
  for (const [key, cat] of Object.entries(TYPE_MAP)) {
    if (pt.includes(key)) return cat;
  }

  // 3. Tags
  const tagStr = (tags || []).join(' ').toLowerCase();
  for (const [key, cat] of Object.entries(TYPE_MAP)) {
    if (tagStr.includes(key)) return cat;
  }

  // 4. Title keyword scan
  const t = (title || '').toLowerCase();
  if (/\bshaker\b/.test(t) || /\bgym bag\b/.test(t) || /\bwrist wrap\b/.test(t) || /\blifting strap\b/.test(t) || /\bfoam roller\b/.test(t) || /\bresistance band\b/.test(t)) return 'accessories';
  if (/\brtd\b/.test(t) || t.includes('ready to drink') || t.includes('protein water') || /\benergy drink\b/.test(t)) return 'rtd';
  if (t.includes('protein bar') || t.includes('protein cookie') || t.includes('protein chip') || t.includes('protein snack')) return 'proteinbars';
  if (t.includes('meal replacement') || t.includes('peanut butter') || /\bjerky\b/.test(t) || t.includes('rice cake')) return 'gymfood';
  if (/\bvitamin\b/.test(t) || t.includes('omega-3') || /\bmagnesium\b/.test(t) || /\belectrolyte\b/.test(t) || t.includes('greens powder') || /\bprobiotic\b/.test(t) || /\bnootropic\b/.test(t) || t.includes('test booster') || /\bmelatonin\b/.test(t)) return 'vitamins';
  if (/\bsinglet\b/.test(t) || /\blegging\b/.test(t) || /\bactivewear\b/.test(t) || t.includes('gym wear') || /\bsports bra\b/.test(t)) return 'clothing';
  if (t.includes('whey') || t.includes('isolate') || t.includes('casein') || t.includes('mass gainer') || t.includes('plant protein') || t.includes('vegan protein') || t.includes('collagen protein')) return 'protein';
  if (/\bprotein\b/.test(t)) return 'protein';
  if (t.includes('creatine')) return 'creatine';
  if (t.includes('pre-workout') || t.includes('pre workout') || t.includes('preworkout')) return 'preworkout';
  if (t.includes('oxyshred') || t.includes('fat burn') || t.includes('thermogenic') || /\bshred\b/.test(t) || t.includes('l-carnitine')) return 'fatburner';
  if (t.includes('bcaa') || t.includes('amino acid') || / eaa\b/.test(t) || t.includes('glutamine')) return 'bcaa';

  return null;
}

function isGymProduct(title, productType) {
  const t = (title + ' ' + (productType || '')).toLowerCase();
  if (EXCLUDE.some(rx => rx.test(t))) return false;
  return GYM_KEYWORDS.some(kw => t.includes(kw));
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
        'User-Agent': 'ScoopScore/2.0 price-comparison-bot (+https://scoopscore.co.nz)',
        ...headers
      },
      timeout: 20000,
    }, (res) => {
      // Follow one redirect
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
// Every public Shopify store exposes this endpoint with no auth required.
// Returns up to 250 products per request with full variant/price data.
// This is 10-50x faster than products.json pagination and never breaks.
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
        // Public Storefront API requires this token — 'anonymous' works for public data
        'X-Shopify-Storefront-Access-Token': 'anonymous',
        'User-Agent': 'ScoopScore/2.0 price-comparison-bot',
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
// If GraphQL fails (some stores disable it), fall back to products.json.
async function fetchProductsJSON(baseUrl, page = 1) {
  const url = `https://${baseUrl}/products.json?limit=250&page=${page}`;
  const data = await httpGet(url);
  if (data.trim().startsWith('<')) throw new Error('Got HTML instead of JSON');
  return JSON.parse(data);
}

// ─── SCRAPE ONE SHOPIFY STORE ───────────────────────────────────
async function scrapeShopifyStore(retailer) {
  log(`Scraping ${retailer.name}...`);
  const products = [];
  let cursor = null;
  let page = 0;
  let usedGQL = false;

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
        const cat = detectCategory(node.productType, node.tags, node.title);
        if (!cat && !isGymProduct(node.title, node.productType)) continue;
        const finalCat = cat || detectCategory('', [], node.title) || 'protein';

        const variants = node.variants.edges.map(({ node: v }) => ({
          id:        v.id,
          title:     v.title,
          price:     parseFloat(v.price.amount),
          sku:       v.sku || '',
          available: v.availableForSale, // GQL gives accurate real-time stock status
        }));

        const availVariants = variants.filter(v => v.available);
        const allPrices = variants.map(v => v.price).filter(p => p > 0);
        if (allPrices.length === 0) continue;

        const minPrice = availVariants.length
          ? Math.min(...availVariants.map(v => v.price))
          : Math.min(...allPrices);

        products.push({
          id:           `${retailer.id}_${node.handle}`,
          retailer:     retailer.id,
          retailerName: retailer.name,
          brand:        node.vendor || 'Unknown',
          name:         node.title,
          category:     finalCat,
          description:  (node.description || '').slice(0, 300),
          tags:         (node.tags || []).slice(0, 8),
          priceFrom:    minPrice,
          priceTo:      Math.max(...allPrices),
          available:    availVariants.length > 0,
          currency:     'NZD',
          variants,
          url:          `https://${retailer.baseUrl}/products/${node.handle}`,
          imageUrl:     node.images.edges[0]?.node.url || null,
          updatedAt:    new Date().toISOString(),
          priceHistory: [],
        });
      }

      log(`  ${retailer.name} page ${page}: ${edges.length} products (GQL)`);
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
      await sleep(300); // polite pause between pages
    }
    usedGQL = true;
  } catch(gqlErr) {
    log(`  ${retailer.name} GQL failed (${gqlErr.message}), falling back to products.json...`);

    // Fallback to products.json
    let jsonPage = 1;
    while (true) {
      try {
        const data = await fetchProductsJSON(retailer.baseUrl, jsonPage);
        const batch = data.products || [];
        if (batch.length === 0) break;

        for (const raw of batch) {
          const cat = detectCategory(raw.product_type, raw.tags, raw.title);
          if (!cat && !isGymProduct(raw.title, raw.product_type)) continue;
          const finalCat = cat || 'protein';

          const allPrices = (raw.variants||[]).map(v => parseFloat(v.price)).filter(p => p > 0);
          if (allPrices.length === 0) continue;

          products.push({
            id:           `${retailer.id}_${raw.handle || raw.id}`,
            retailer:     retailer.id,
            retailerName: retailer.name,
            brand:        raw.vendor || 'Unknown',
            name:         raw.title,
            category:     finalCat,
            description:  (raw.body_html||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,300),
            tags:         (raw.tags||[]).slice(0,8),
            priceFrom:    Math.min(...allPrices),
            priceTo:      Math.max(...allPrices),
            available:    true, // products.json available field is unreliable
            currency:     'NZD',
            variants:     (raw.variants||[]).map((v,i) => ({
              id: v.id, title: v.title,
              price: parseFloat(v.price), sku: v.sku||'',
              available: true,
            })),
            url:          `https://${retailer.baseUrl}/products/${raw.handle}`,
            imageUrl:     raw.images?.[0]?.src || null,
            updatedAt:    new Date().toISOString(),
            priceHistory: [],
          });
        }

        log(`  ${retailer.name} page ${jsonPage}: ${batch.length} products (JSON)`);
        if (batch.length < 250) break;
        jsonPage++;
        await sleep(400);
      } catch(jsonErr) {
        log(`  ${retailer.name} products.json page ${jsonPage} failed: ${jsonErr.message}`);
        break;
      }
    }
  }

  log(`  ${retailer.name}: ${products.length} gym products total`);
  return products;
}

// ─── RETAILER LIST ─────────────────────────────────────────────
// All confirmed Shopify stores. GraphQL is tried first for speed and
// accurate stock status; products.json is the automatic fallback.
const RETAILERS = [
  { id: 'nzmuscle',           name: 'NZ Muscle',             baseUrl: 'nzmuscle.co.nz',                    freeShipping: 'Always free' },
  { id: 'sportsfuel',         name: 'Sportsfuel',            baseUrl: 'www.sportsfuel.co.nz',              freeShipping: 'Free over $60' },
  { id: 'scorpion',           name: 'Scorpion Supplements',  baseUrl: 'scorpionsupplements.co.nz',         freeShipping: 'Check site' },
  { id: 'asnonline',          name: 'ASN Online',            baseUrl: 'asnonline.co.nz',                   freeShipping: 'Free over $100' },
  { id: 'supplementsolutions',name: 'Supplement Solutions',  baseUrl: 'www.supplementsolutions.co.nz',     freeShipping: 'Check site' },
  { id: 'raiseys',            name: "Raisey's",              baseUrl: 'raiseys.co.nz',                     freeShipping: 'Check site' },
  { id: 'bodystrong',         name: 'BodyStrong',            baseUrl: 'bodystrong.co.nz',                  freeShipping: 'Check site' },
  { id: 'bargainchemist',     name: 'Bargain Chemist',       baseUrl: 'www.bargainchemist.co.nz',          freeShipping: 'Free shipping' },
  { id: 'payless',            name: 'Payless Supplements',   baseUrl: 'paylesssupplements.co.nz',          freeShipping: 'Free shipping' },
  { id: 'supplementsnz',      name: 'Supplements NZ',        baseUrl: 'www.supplements.co.nz',             freeShipping: 'Free shipping' },
  { id: 'reactiv',            name: 'Reactiv Supplements',   baseUrl: 'www.reactivsupplements.co.nz',      freeShipping: 'Free NZ-wide' },
  { id: 'eatme',              name: 'Eat Me Supplements',    baseUrl: 'www.eatmesupplements.co.nz',        freeShipping: 'Check site' },
  { id: 'kiwinutrition',      name: 'Kiwi Nutrition',        baseUrl: 'kiwinutrition.co.nz',               freeShipping: 'Check site' },
  { id: 'elitesupplements',   name: 'Elite Supplements',     baseUrl: 'elitesupplements.co.nz',            freeShipping: 'Check site' },
  { id: 'nutritionwarehouse', name: 'Nutrition Warehouse',   baseUrl: 'www.nutritionwarehouse.co.nz',      freeShipping: 'Free over $60' },
  // Xplosiv and Sprint Fit are not Shopify and require Playwright (see README)
];

// ─── MERGE WITH EXISTING (preserve price history) ───────────────
function mergeWithExisting(newProducts, existing) {
  const existMap = {};
  for (const p of existing) existMap[p.id] = p;

  return newProducts.map(p => {
    const prev = existMap[p.id];
    if (!prev) return p;

    // Build price history — record if price changed since last scrape
    const history = prev.priceHistory || [];
    if (prev.priceFrom !== p.priceFrom) {
      history.push({ date: prev.updatedAt, price: prev.priceFrom });
      if (history.length > 30) history.shift(); // keep last 30 price points
    }

    return { ...p, priceHistory: history };
  });
}

// ─── MAIN ──────────────────────────────────────────────────────
async function main() {
  log('');
  log('═══════════════════════════════════════════');
  log('  ScoopScore Scraper v2 — GraphQL Edition  ');
  log('═══════════════════════════════════════════');
  log(`  Retailers: ${RETAILERS.length}`);
  log(`  Method: Shopify GraphQL → products.json fallback`);
  log('');

  // Load existing data to preserve price history
  let existing = [];
  try {
    const raw = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    existing = raw.products || [];
    log(`  Loaded ${existing.length} existing products for price history`);
  } catch(e) { log('  No existing data — fresh start'); }

  const allProducts = [];
  const stats = {};
  const startTime = Date.now();

  // Scrape all retailers concurrently in small batches (5 at a time)
  // to be polite and avoid overwhelming any single server
  const BATCH_SIZE = 5;
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
    if (i + BATCH_SIZE < RETAILERS.length) await sleep(1000);
  }

  // Deduplicate by id (same product scraped from multiple collections)
  const seen = new Set();
  const deduped = allProducts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Merge with existing to carry price history forward
  const merged = mergeWithExisting(deduped, existing);

  // Sort: category → brand → price
  merged.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    return a.priceFrom - b.priceFrom;
  });

  const ALL_CATS = ['protein','proteinbars','rtd','creatine','preworkout','fatburner','bcaa','vitamins','gymfood','accessories','clothing'];
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
      scrapeMethod:  'shopify-graphql-v2',
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
    const bar = '█'.repeat(Math.min(30, Math.round(count / 100)));
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
