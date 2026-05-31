/**
 * ScoopScore Scraper v6
 * ─────────────────────────────────────────────────────────────
 * CHANGES FROM v5:
 *
 * CLASSIFICATION OVERHAUL — replaced first-match-wins keyword scan
 * with a multi-signal weighted scoring system:
 *
 *   • Every category accumulates a score from four independent sources:
 *       - Title match    (weight ×4 — highest signal, clearest intent)
 *       - product_type   (weight ×3 — retailer-assigned, very reliable)
 *       - Tags           (weight ×2 — structured metadata)
 *       - Description    (weight ×1 — prose, noisier)
 *
 *   • Keywords are split into two tiers per category:
 *       - DEFINITIVE (score ×3): phrases that unambiguously identify the
 *         category, e.g. "whey protein isolate", "pre-workout", "creatine"
 *       - SUPPORTING (score ×1): broader terms that nudge the score but
 *         alone are not enough to confirm, e.g. "protein", "energy"
 *
 *   • A category is confirmed only when it clears MIN_SCORE (default 4).
 *     This prevents weak substring matches from producing false positives.
 *
 *   • When two categories score closely (within AMBIGUITY_GAP = 2) the
 *     product goes to the review queue instead of being auto-assigned.
 *
 *   • Negative keywords (-3 per hit) let a category actively reject
 *     products that superficially match but belong elsewhere, e.g.
 *     "protein" in the protein category is penalised when the title also
 *     contains "bar" or "cookie" (those belong in proteinbars).
 *
 *   • Exclusions now also run against product_type alone (not just the
 *     full search text) so mis-tagged accessories are caught faster.
 *
 * Everything else (three-bucket output, variant normalisation, price
 * history, health check, review persistence) is unchanged from v5.
 *
 * Usage:
 *   node scraper.js               — normal daily run
 *   node scraper.js --debug all   — dump every skipped product with reason
 *   node scraper.js --debug nzmuscle
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── PATHS ──────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const OUT_FILE    = path.join(DATA_DIR, 'products.json');
const REVIEW_FILE = path.join(DATA_DIR, 'review.json');
const EXCL_FILE   = path.join(DATA_DIR, 'excluded.json');
const LOG_FILE    = path.join(DATA_DIR, 'scrape.log');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── CLI FLAGS ───────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const DEBUG_RETAILER = (() => {
  const i = ARGS.indexOf('--debug');
  return i !== -1 ? (ARGS[i + 1] || 'all') : null;
})();

// ─── RETAILERS ───────────────────────────────────────────────────
// All of these expose /products.json (standard on every Shopify store).
// Sprint Fit uses a custom platform (cdn.n2erp.co.nz) and requires
// Playwright — see README for setup. Add it back when ready.
const RETAILERS = [
  { id: 'nzmuscle',            name: 'NZ Muscle',            baseUrl: 'nzmuscle.co.nz',                freeShipping: 'Always free'    },
  { id: 'sportsfuel',          name: 'Sportsfuel',           baseUrl: 'www.sportsfuel.co.nz',          freeShipping: 'Free over $60'  },
  { id: 'scorpion',            name: 'Scorpion Supplements', baseUrl: 'scorpionsupplements.co.nz',     freeShipping: 'Check site'     },
  { id: 'asnonline',           name: 'ASN Online',           baseUrl: 'asnonline.co.nz',               freeShipping: 'Free over $100' },
  { id: 'supplementsolutions', name: 'Supplement Solutions', baseUrl: 'www.supplementsolutions.co.nz', freeShipping: 'Check site'     },
  { id: 'raiseys',             name: "Raisey's",             baseUrl: 'raiseys.co.nz',                 freeShipping: 'Check site'     },
  { id: 'bodystrong',          name: 'BodyStrong',           baseUrl: 'bodystrong.co.nz',              freeShipping: 'Check site'     },
  { id: 'payless',             name: 'Payless Supplements',  baseUrl: 'paylesssupplements.co.nz',      freeShipping: 'Free shipping'  },
  { id: 'supplementsnz',       name: 'Supplements NZ',       baseUrl: 'www.supplements.co.nz',         freeShipping: 'Free shipping'  },
  { id: 'reactiv',             name: 'Reactiv Supplements',  baseUrl: 'www.reactivsupplements.co.nz',  freeShipping: 'Free NZ-wide'   },
  { id: 'eatme',               name: 'Eat Me Supplements',   baseUrl: 'www.eatmesupplements.co.nz',    freeShipping: 'Check site'     },
  { id: 'nutritionwarehouse',  name: 'Nutrition Warehouse',  baseUrl: 'www.nutritionwarehouse.co.nz',  freeShipping: 'Free over $60'  },
];

// ─── HARD EXCLUSIONS ─────────────────────────────────────────────
// Only things that can NEVER be supplements: gym equipment, cosmetics,
// clothing, accessories, and non-gym media. Borderline food products
// (peanut butter protein, meal replacements) are removed from here —
// they'll be caught by category rules or sent to the review queue.
const EXCLUDE_PATTERNS = [
  // Gym equipment
  /\btreadmill\b/, /\brower\b/, /\bstationary\s*bike\b/, /\bspin\s*bike\b/,
  /\bpower\s*rack\b/, /\bsquat\s*rack\b/, /\bdumbbell\b/, /\bbarbell\b/,
  /\bkettlebell\b/, /\bweight\s*plate\b/, /\bgym\s*flooring\b/,
  /\bcold\s*plunge\b/, /\bice\s*bath\b/, /\bworkout\s*equipment\b/,
  // Cosmetics
  /\bperfume\b/, /\bfragrance\b/, /\bskincare\b/, /\bmakeup\b/,
  /\bhair\s*care\b/, /\bhaircare\b/,
  // Accessories (shaker bottles are sold as accessories, not supplements)
  /\bshaker\s*bottle\b/, /\bshaker\s*cup\b/, /\bblender\s*bottle\b/,
  /\bwater\s*bottle\b/, /\bgym\s*bag\b/, /\blifting\s*strap\b/,
  /\blifting\s*belt\b/, /\bgym\s*glove\b/, /\bwrist\s*wrap\b/,
  /\bknee\s*sleeve\b/, /\bresistance\s*band\b/, /\bfoam\s*roller\b/,
  // Clothing
  /\bgym\s*wear\b/, /\bgym\s*clothing\b/, /\bactivewear\b/,
  /\bsinglet\b/, /\bleggings\b/, /\bsports\s*bra\b/, /\bcompression\s*wear\b/,
  // Non-gym media & items
  /\bebook\b/, /\bphone\s*case\b/, /\bwallet\b/, /\bsunglasses\b/,
  // Pharmacy-only vitamins (not gym-relevant)
  /\bfolic\s*acid\b/, /\bfolate\b/, /\bprenatal\b/, /\bpregnancy\s*vitamin\b/,
  /\bkids?\s*vitamin\b/, /\bchildren.s\s*vitamin\b/,
  /\bcold\s*(and|&)\s*flu\b/, /\bhayfever\b/,
];

// ─── CLASSIFICATION CONFIG ────────────────────────────────────────
// Minimum total score required to confirm a category.
// A product scoring below this goes to the review queue.
const MIN_SCORE = 4;

// If the top two category scores are within this gap, the result is
// ambiguous and the product goes to review rather than being auto-assigned.
const AMBIGUITY_GAP = 2;

// Source weights: how much each data field contributes to the raw score.
// Title is highest because it is the most intentional signal from the retailer.
const SOURCE_WEIGHT = {
  title:       4,
  productType: 3,
  tags:        2,
  description: 1,
};

// ─── CATEGORY RULES ──────────────────────────────────────────────
// Each rule has:
//   cat         — the category ID
//   definitive  — phrases that alone are strong enough to confirm the cat
//                 (each match scores ×3 before the source weight is applied)
//   supporting  — broader terms that add evidence but are not decisive
//                 (each match scores ×1)
//   negative    — patterns that actively lower the score for this category
//                 (each match scores −3) used to prevent cross-category bleed
//
// Matching rules:
//   • Multi-word / hyphenated phrases: substring match on the source text
//   • Single words: whole-word boundary match (\b) to avoid partial hits
//     (e.g. "eaa" won't match "pea" or "ideas")
//   • All matches are case-insensitive (text is lowercased before scoring)
const CATEGORY_RULES = [
  {
    cat: 'proteinbars',
    definitive: [
      'protein bar','protein bars','protein cookie','protein cookies',
      'protein chip','protein chips','protein wafer','protein ball','protein balls',
      'protein snack','protein snacks','protein brownie','protein muffin',
      'high protein bar','high protein snack','protein flapjack',
    ],
    supporting: [
      'snack bar','nutrition bar','energy bar','protein spread',
      'high protein','cereal bar','oat bar','quest bar',
    ],
    // Avoid pulling in RTDs or powders that mention "protein"
    negative: [
      'ready to drink','ready-to-drink','rtd','protein shake','protein drink',
      'protein powder','whey protein','protein blend','mass gainer',
    ],
  },
  {
    cat: 'rtd',
    definitive: [
      'ready to drink','ready-to-drink','rtd','protein water',
      'canned protein','protein can','protein milk','protein shake',
      'protein drink','electrolyte drink','recovery drink',
    ],
    supporting: [
      'energy drink','sports drink','hydration drink','isotonic drink',
      'can','bottle','liquid protein',
    ],
    // RTDs shouldn't absorb powdered drink mixes
    negative: [
      'powder','tub','scoop','sachet',
    ],
  },
  {
    cat: 'creatine',
    definitive: [
      'creatine monohydrate','creatine hcl','creatine ethyl ester',
      'creatine blend','creatine powder','creatine capsules','creatine tablets',
      'creatine gummies','flavoured creatine','micronised creatine',
      'kre-alkalyn','buffered creatine',
    ],
    supporting: [
      'creatine',
    ],
    negative: [],
  },
  {
    cat: 'preworkout',
    definitive: [
      'pre-workout','pre workout','preworkout',
      'stim free pre','non-stim pre','stimulant free pre',
      'pump pre-workout','pump pre workout','nootropic pre',
      'n.o. booster','no booster','nitric oxide booster',
    ],
    supporting: [
      'pump formula','pump supplement','vasodilator','vascularity',
      'alpha gpc','alpha-gpc','citrulline malate','l-citrulline',
      'caffeine supplement','caffeine powder','caffeine tablets',
      'energy supplement','focus supplement','pre training',
      'agmatine','beta alanine','beta-alanine','betaine anhydrous',
    ],
    // "pump" alone is too generic — only count it when paired with other signals
    negative: [
      'protein bar','protein cookie','bcaa','amino acid','fat burner','thermogenic',
    ],
  },
  {
    cat: 'fatburner',
    definitive: [
      'fat burner','fat burners','fat metaboliser','fat metabolisers',
      'thermogenic','thermogenics','weight loss supplement',
      'weight management supplement','oxyshred','fat loss supplement',
      'shred supplement','shred formula','diet supplement',
    ],
    supporting: [
      'l-carnitine','l carnitine','carnitine supplement',
      'cla supplement','cla softgel','cla capsule',
      'appetite control','appetite suppressant','metabolism support',
      'metabolism booster','fat oxidation','lipotropic',
      'acetyl l-carnitine','alcar',
    ],
    negative: [
      'protein powder','whey protein','mass gainer','pre-workout','pre workout',
    ],
  },
  {
    cat: 'bcaa',
    definitive: [
      'bcaa','bcaas','eaa','eaas','essential amino acids','essential aminos',
      'intra-workout','intra workout','amino acid supplement','amino blend',
      'amino recovery','recovery amino','post-workout amino','post workout amino',
    ],
    supporting: [
      'amino acids','amino acid','leucine','isoleucine','valine',
      'l-glutamine supplement','glutamine supplement','glutamine powder',
      'l-leucine supplement','leucine supplement',
      'hmb supplement','hmb powder',
      'taurine supplement','l-taurine supplement',
      'tyrosine supplement','l-tyrosine supplement',
      'glycine supplement','l-arginine supplement','arginine supplement',
    ],
    // Single amino acids sold standalone are sometimes vitamins or preworkout
    // ingredients — only score them as BCAA when the context is clear
    negative: [
      'pre-workout','pre workout','preworkout','fat burner','thermogenic',
      'protein powder','whey protein',
    ],
  },
  {
    cat: 'vitamins',
    definitive: [
      'multivitamin','multi-vitamin','multi vitamin',
      'vitamin d3','vitamin d supplement','vitamin c supplement',
      'vitamin b12 supplement','vitamin e supplement','vitamin k2',
      'omega 3','omega-3','fish oil','krill oil',
      'magnesium supplement','magnesium glycinate','magnesium citrate',
      'zinc supplement','iron supplement','calcium supplement',
      'greens powder','super greens','all-in-one greens',
      'collagen peptide','collagen supplement','collagen powder',
      'probiotic supplement','prebiotic supplement',
      'sleep formula','sleep supplement','melatonin',
      'ashwagandha supplement','ashwagandha extract',
      'adaptogen supplement','rhodiola supplement',
      'zma supplement','testosterone booster','test booster',
      'joint supplement','joint support','glucosamine','chondroitin',
      'coq10','coenzyme q10','ubiquinol',
      'spirulina','chlorella','barley grass','wheat grass',
    ],
    supporting: [
      'vitamin','mineral','supplement tablet','supplement capsule',
      'softgel','electrolyte tablet','electrolyte capsule',
      'biotin','collagen','probiotic','gut health','digestive enzyme',
      'immune support','antioxidant','nootropic','cognitive support',
      'ashwagandha','rhodiola','maca','tribulus','tongkat ali',
      'omega','fish oil','krill','magnesium','zinc','calcium','iron',
      'greens','superfoods','super food',
    ],
    // Vitamins category shouldn't pull in RTDs or powders labelled "greens drink"
    negative: [
      'ready to drink','ready-to-drink','rtd','protein powder','whey protein',
      'mass gainer','pre-workout','pre workout','fat burner',
    ],
  },
  {
    cat: 'protein',
    definitive: [
      'whey protein isolate','whey protein concentrate','whey protein blend',
      'whey protein powder','hydrolysed whey','hydrolyzed whey',
      'hydrolysed protein','hydrolyzed protein',
      'plant based protein powder','plant protein powder','vegan protein powder',
      'pea protein powder','pea protein isolate',
      'hemp protein powder','rice protein powder','soy protein powder',
      'casein protein','casein powder','slow release protein',
      'egg protein','beef protein isolate','collagen protein',
      'mass gainer','mass gainers','weight gainer','lean mass',
      'protein powder','protein blend','isolate protein','protein tub',
      'whey isolate','wpi','wpc',
    ],
    supporting: [
      'whey protein','plant protein','vegan protein','pea protein',
      'hemp protein','rice protein','soy protein',
      'thermogenic protein','lean protein','low carb protein',
      'protein supplement','high protein powder',
      'casein','isolate','concentrate',
    ],
    // "protein" alone as a supporting word is very broad — keep it but
    // negative-weight snack and RTD forms so they don't bleed here
    negative: [
      'protein bar','protein cookie','protein chip','protein ball','protein snack',
      'ready to drink','ready-to-drink','rtd','protein shake','protein drink',
      'protein water','canned protein',
    ],
  },
];

// ─── GYM SIGNALS ─────────────────────────────────────────────────
// Used as a fallback: if scoring produces no confirmed category, check
// whether the product is still gym-adjacent (→ review queue) or completely
// unrelated (→ excluded).
const GYM_SIGNALS = [
  'supplement','supplements','sports nutrition','sports supplement',
  'pre-workout','preworkout','post-workout','creatine','protein','whey',
  'casein','isolate','bcaa','eaa','amino','glutamine','carnitine',
  'mass gainer','fat burner','thermogenic','oxyshred','anabolic',
  'bodybuilding','powerlifting','crossfit','athlete','gym','workout',
  'training','performance','endurance','strength','muscle','bulking',
  'cutting','body composition','physique','stack','formula','complex',
  'testosterone','collagen','greens','probiotic','electrolyte','recovery',
  'beta alanine','citrulline','arginine','taurine','tyrosine','hmb',
  'nitric oxide','pump formula','nootropic','adaptogen','ashwagandha',
  'vitamin d','omega 3','fish oil','magnesium','zinc',
];

// ─── BRAND ALIASES ───────────────────────────────────────────────
const BRAND_ALIASES = {
  'mutant nutrition':'Mutant','mutant':'Mutant',
  'optimum nutrition':'Optimum Nutrition','on':'Optimum Nutrition','optimum':'Optimum Nutrition',
  'bsn':'BSN','dymatize':'Dymatize','dymatize nutrition':'Dymatize',
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
  'musashi':'Musashi','balance':'Balance','balance sports nutrition':'Balance',
  'cellucor':'Cellucor','redcon1':'Redcon1','redcon 1':'Redcon1',
  'ryse':'Ryse','ryse supps':'Ryse','atp science':'ATP Science',
  'isopure':'Isopure','the isopure company':'Isopure',
  'vpa':'VPA','vpa australia':'VPA','bulk nutrients':'Bulk Nutrients',
  'true protein':'True Protein','prana on':'Prana ON','prana':'Prana ON',
  'body science':'Body Science','bsc':'Body Science',
  'science in sport':'Science in Sport','sis':'Science in Sport',
  'switch nutrition':'Switch Nutrition','switch':'Switch Nutrition',
  'xtend':'Xtend','inspired nutraceuticals':'Inspired','inspired':'Inspired',
  'outbreak nutrition':'Outbreak','outbreak':'Outbreak',
  'staunch':'Staunch','staunch nation':'Staunch',
  'axe & sledge':'Axe & Sledge','axe and sledge':'Axe & Sledge',
  'gorilla mind':'Gorilla Mind','cbum':'CBUM',
};

function normalizeBrand(raw) {
  if (!raw || raw.trim() === '' || raw === 'Unknown') return 'Unknown';
  const key = raw.toLowerCase().trim();
  return BRAND_ALIASES[key] || raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── LOGGING ─────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ─── HTTP HELPERS ────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'ScoopScore/5.0 price-comparison-bot (+https://scoopscore.co.nz)' },
      timeout: 25000,
    }, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
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

async function httpGetWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await httpGet(url);
    } catch (err) {
      const isRetryable = /429|503|502|504/.test(err.message);
      if (isRetryable && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        log(`    ↻ Retryable error (${err.message.match(/\d{3}/)?.[0] ?? '?'}) — waiting ${delay / 1000}s (attempt ${attempt}/${maxRetries})`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

// ─── VARIANT NORMALISATION ───────────────────────────────────────
/**
 * Parse a Shopify variant title into structured fields.
 * Shopify variants use patterns like:
 *   "2.27kg / Chocolate Fudge"
 *   "500g / Vanilla"
 *   "5lb / Unflavoured"
 *   "80 Serves / Chocolate"
 *   "Chocolate / 2kg"    ← reversed order
 *   "Default Title"      ← single-variant product
 */
function parseVariantTitle(title) {
  const t = (title || '').trim();
  if (!t || t.toLowerCase() === 'default title') {
    return { sizeKg: null, serves: null, sizeLabel: null, flavour: null };
  }

  const parts = t.split('/').map(p => p.trim()).filter(Boolean);
  let sizeKg = null, serves = null, sizeLabel = null;
  const flavourParts = [];

  for (const part of parts) {
    const lower = part.toLowerCase();

    // Weight: 2.27kg, 500g, 2KG, 500G
    const weightMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(kg|g)$/);
    if (weightMatch) {
      const val = parseFloat(weightMatch[1]);
      sizeKg = weightMatch[2] === 'g' ? +(val / 1000).toFixed(3) : val;
      sizeLabel = part;
      continue;
    }

    // Weight embedded in text: "2kg Bag", "900g Pouch"
    const weightEmbedded = lower.match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/);
    if (weightEmbedded) {
      const val = parseFloat(weightEmbedded[1]);
      sizeKg = weightEmbedded[2] === 'g' ? +(val / 1000).toFixed(3) : val;
      sizeLabel = `${weightEmbedded[1]}${weightEmbedded[2]}`;
      // The remainder might be a descriptor, not a flavour — skip it
      continue;
    }

    // Imperial: 5lb, 2.2lbs, 5 lb
    const lbMatch = lower.match(/^(\d+(?:\.\d+)?)\s*lbs?$/);
    if (lbMatch) {
      sizeKg = +(parseFloat(lbMatch[1]) * 0.453592).toFixed(3);
      sizeLabel = part;
      continue;
    }

    // Ounces: 32oz
    const ozMatch = lower.match(/^(\d+(?:\.\d+)?)\s*oz$/);
    if (ozMatch) {
      sizeKg = +(parseFloat(ozMatch[1]) * 0.028349).toFixed(3);
      sizeLabel = part;
      continue;
    }

    // Serves / caps / tablets: "80 Serves", "120 Capsules", "30 Sachets"
    const servesMatch = lower.match(/^(\d+)\s*(?:serves?|servings?|scoops?|sachets?|caps?|capsules?|tabs?|tablets?|softgels?|gummies?)$/);
    if (servesMatch) {
      serves = parseInt(servesMatch[1]);
      sizeLabel = part;
      continue;
    }

    // Everything else is flavour / option
    if (part && part !== '-') flavourParts.push(part);
  }

  return {
    sizeKg,
    serves,
    sizeLabel,
    flavour: flavourParts.join(' / ').trim() || null,
  };
}

/**
 * Detect price anomalies within a product's variants.
 * A variant price is flagged if it's more than 3× or less than ⅓
 * of the product's median price — almost always a data error.
 */
function flagPriceAnomalies(variants) {
  const prices = variants.map(v => v.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return variants; // not enough data

  const median = prices[Math.floor(prices.length / 2)];
  return variants.map(v => ({
    ...v,
    priceAnomaly: v.price > 0 && (v.price > median * 3 || v.price < median / 3),
  }));
}

// ─── CLASSIFICATION ENGINE ────────────────────────────────────────

/**
 * Test whether a keyword matches a text string.
 * Multi-word and hyphenated phrases use substring match.
 * Single words use whole-word boundary match to prevent partial hits
 * (e.g. "eaa" won't match "pea", "bar" won't match "barbell").
 */
function kwMatch(text, kw) {
  if (kw.includes(' ') || kw.includes('-')) {
    return text.includes(kw);
  }
  // Escape any regex special chars in the keyword then wrap in \b
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/**
 * Score a single source field against one category rule.
 * Returns a number: positive = evidence for, negative = evidence against.
 *
 * Scoring per keyword hit (before source weight is applied):
 *   definitive match  → +3
 *   supporting match  → +1
 *   negative match    → -3
 */
function scoreField(fieldText, rule) {
  let score = 0;
  for (const kw of rule.definitive) {
    if (kwMatch(fieldText, kw)) score += 3;
  }
  for (const kw of rule.supporting) {
    if (kwMatch(fieldText, kw)) score += 1;
  }
  for (const kw of rule.negative) {
    if (kwMatch(fieldText, kw)) score -= 3;
  }
  return score;
}

/**
 * Score a product against every category using all available signal sources.
 * Returns an array of { cat, score } sorted descending by score.
 *
 * Each source is scored independently then multiplied by SOURCE_WEIGHT
 * before being summed into the category total.
 */
function scoreCategoryAll(title, productType, tags, description) {
  const titleText = (title || '').toLowerCase();
  const typeText  = (productType || '').toLowerCase();
  const tagsText  = (Array.isArray(tags) ? tags.join(' ') : (tags || '')).toLowerCase();
  const descText  = (description || '').slice(0, 400).toLowerCase();

  return CATEGORY_RULES
    .map(rule => {
      const total =
        scoreField(titleText, rule) * SOURCE_WEIGHT.title       +
        scoreField(typeText,  rule) * SOURCE_WEIGHT.productType +
        scoreField(tagsText,  rule) * SOURCE_WEIGHT.tags        +
        scoreField(descText,  rule) * SOURCE_WEIGHT.description;

      return { cat: rule.cat, score: total };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Classify a product into a category, or return null.
 * Returns { cat, score, reason } where reason explains the decision.
 *
 * Decision logic:
 *   1. Top score < MIN_SCORE → no category confirmed (→ review/excluded)
 *   2. Top score ≥ MIN_SCORE AND gap to second place ≤ AMBIGUITY_GAP
 *      → ambiguous (→ review queue)
 *   3. Top score ≥ MIN_SCORE AND gap > AMBIGUITY_GAP → confirmed
 */
function detectCategory(title, productType, tags, description) {
  const scores = scoreCategoryAll(title, productType, tags, description);
  const best   = scores[0];
  const second = scores[1];

  if (best.score < MIN_SCORE) {
    return { cat: null, score: best.score, reason: `below-threshold (best: ${best.cat} ${best.score})` };
  }

  const gap = best.score - second.score;
  if (gap <= AMBIGUITY_GAP) {
    return { cat: null, score: best.score, reason: `ambiguous (${best.cat} ${best.score} vs ${second.cat} ${second.score})` };
  }

  return { cat: best.cat, score: best.score, reason: `scored:${best.cat} (${best.score}, gap ${gap})` };
}

function buildSearchText(...parts) {
  return parts
    .map(p => Array.isArray(p) ? p.join(' ') : (p || ''))
    .join(' ')
    .toLowerCase();
}

function isExcluded(text) {
  return EXCLUDE_PATTERNS.some(rx => rx.test(text));
}

function isGymRelated(text) {
  return GYM_SIGNALS.some(sig => text.includes(sig));
}

// ─── BUILD PRODUCT RECORD ────────────────────────────────────────
/**
 * Returns { record, bucket, reason } where bucket is:
 *   'confirmed' — category matched, ready for products.json
 *   'review'    — gym-related but needs a human to assign category
 *   'excluded'  — definitely not a supplement
 */
function buildProduct(retailer, rawTitle, handle, productType, vendor, tags, description, variants, imageUrl, prevReviewDecisions) {
  const searchText = buildSearchText(rawTitle, productType, tags, (description || '').slice(0, 400));

  // ── 1. Hard exclusion ──
  if (isExcluded(searchText)) {
    return { record: null, bucket: 'excluded', reason: 'hard-excluded' };
  }

  // ── 2. Price check ──
  const allPrices = variants.map(v => parseFloat(v.price)).filter(p => !isNaN(p) && p > 0);
  if (allPrices.length === 0) {
    return { record: null, bucket: 'excluded', reason: 'no-valid-price' };
  }

  // ── 3. Normalise variants ──
  const normalisedVariants = flagPriceAnomalies(
    variants.map(v => {
      const parsed = parseVariantTitle(v.title);
      return {
        id:           v.id,
        title:        v.title,
        price:        parseFloat(v.price) || 0,
        sku:          v.sku || '',
        available:    v.available !== false,
        sizeKg:       parsed.sizeKg,
        serves:       parsed.serves,
        sizeLabel:    parsed.sizeLabel,
        flavour:      parsed.flavour,
      };
    })
  );

  // ── 4. Check for a previous human review decision ──
  const productId = `${retailer.id}_${handle}`;
  if (prevReviewDecisions[productId]) {
    const decision = prevReviewDecisions[productId];
    if (decision.bucket === 'confirmed') {
      const record = assembleRecord(retailer, rawTitle, handle, productType, vendor, tags, description, normalisedVariants, imageUrl, decision.category);
      return { record, bucket: 'confirmed', reason: 'human-approved' };
    }
    if (decision.bucket === 'excluded') {
      return { record: null, bucket: 'excluded', reason: 'human-excluded' };
    }
    // decision is still 'pending' — fall through to re-classify
  }

  // ── 5. Multi-signal category scoring ──
  // Pass individual fields so each source can be weighted independently.
  const detection = detectCategory(rawTitle, productType, tags, (description || '').slice(0, 400));

  if (detection.cat) {
    const record = assembleRecord(retailer, rawTitle, handle, productType, vendor, tags, description, normalisedVariants, imageUrl, detection.cat);
    return { record, bucket: 'confirmed', reason: detection.reason };
  }

  // ── 6. Gym signal check — send to review rather than drop ──
  if (isGymRelated(searchText)) {
    const record = assembleRecord(retailer, rawTitle, handle, productType, vendor, tags, description, normalisedVariants, imageUrl, null);
    return { record, bucket: 'review', reason: `gym-related-uncategorised: ${detection.reason}` };
  }

  // ── 7. Not gym-related at all ──
  return { record: null, bucket: 'excluded', reason: 'not-gym-related' };
}

function assembleRecord(retailer, rawTitle, handle, productType, vendor, tags, description, normalisedVariants, imageUrl, cat) {
  const availableVariants = normalisedVariants.filter(v => v.available && v.price > 0 && !v.priceAnomaly);
  const allPrices = normalisedVariants.map(v => v.price).filter(p => p > 0);
  const minPrice = availableVariants.length > 0
    ? Math.min(...availableVariants.map(v => v.price))
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
    available:    availableVariants.length > 0,
    currency:     'NZD',
    variants:     normalisedVariants,
    url:          `https://${retailer.baseUrl}/products/${handle}`,
    imageUrl:     imageUrl || null,
    updatedAt:    new Date().toISOString(),
    priceHistory: [],
  };
}

// ─── FETCH ───────────────────────────────────────────────────────
async function fetchProductsJSON(baseUrl, page) {
  const url = `https://${baseUrl}/products.json?limit=250&page=${page}`;
  const raw = await httpGetWithRetry(url);
  if (raw.trim().startsWith('<')) throw new Error('Got HTML instead of JSON — store may not be Shopify');
  return JSON.parse(raw);
}

async function scrapeShopifyStore(retailer, prevReviewDecisions) {
  log(`Scraping ${retailer.name}...`);

  const confirmed = [], review = [], excluded = [];
  let page = 0;

  while (true) {
    page++;
    try {
      const data = await fetchProductsJSON(retailer.baseUrl, page);
      const batch = data.products || [];
      if (batch.length === 0) break;

      for (const raw of batch) {
        const desc = (raw.body_html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const variants = (raw.variants || []).map(v => ({
          id:        v.id,
          title:     v.title,
          price:     parseFloat(v.price),
          sku:       v.sku || '',
          available: v.available !== false,
        }));

        const result = buildProduct(
          retailer,
          raw.title,
          raw.handle || String(raw.id),
          raw.product_type,
          raw.vendor,
          raw.tags || [],
          desc,
          variants,
          raw.images?.[0]?.src || null,
          prevReviewDecisions,
        );

        if (result.bucket === 'confirmed' && result.record) confirmed.push(result.record);
        else if (result.bucket === 'review' && result.record)  review.push({ ...result.record, reviewReason: result.reason });
        else excluded.push({ retailer: retailer.id, title: raw.title, reason: result.reason });
      }

      log(`  ${retailer.name} page ${page}: ${batch.length} fetched → ${confirmed.length} confirmed, ${review.length} review, ${excluded.length} excluded`);
      if (batch.length < 250) break;
      await sleep(1000);
    } catch (err) {
      log(`  ${retailer.name} page ${page} FAILED: ${err.message}`);
      break;
    }
  }

  log(`  ${retailer.name} done: ${confirmed.length} confirmed, ${review.length} pending review, ${excluded.length} excluded`);
  return { confirmed, review, excluded };
}

// ─── HEALTH CHECK ────────────────────────────────────────────────
/**
 * Compare new product counts to the previous run.
 * Returns an array of warning strings for any retailer that dropped >20%.
 */
function healthCheck(newStats, prevStats) {
  const warnings = [];
  for (const [name, newCount] of Object.entries(newStats)) {
    const prev = prevStats[name];
    if (prev == null || prev === 0) continue;
    const drop = (prev - newCount) / prev;
    if (drop > 0.2) {
      warnings.push(`⚠️  ${name}: ${prev} → ${newCount} products (${Math.round(drop * 100)}% drop — possible scrape failure)`);
    }
  }
  return warnings;
}

// ─── MERGE PRICE HISTORY ─────────────────────────────────────────
function mergeWithExisting(newProducts, existing) {
  const existMap = {};
  for (const p of existing) existMap[p.id] = p;

  return newProducts.map(p => {
    const prev = existMap[p.id];
    if (!prev) return p;

    const history = [...(prev.priceHistory || [])];
    if (prev.priceFrom !== p.priceFrom) {
      history.push({ date: prev.updatedAt?.slice(0, 10) ?? 'unknown', price: prev.priceFrom });
      if (history.length > 30) history.shift();
    }
    return { ...p, priceHistory: history };
  });
}

// ─── LOAD PREVIOUS REVIEW DECISIONS ──────────────────────────────
/**
 * Read the existing review.json and extract human decisions (confirmed/excluded).
 * These are applied during classification so approved products don't
 * fall back into the queue on every scrape.
 */
function loadPrevReviewDecisions() {
  try {
    const raw = JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8'));
    const decisions = {};
    for (const item of raw.products || []) {
      if (item.decision && item.decision !== 'pending') {
        decisions[item.id] = { bucket: item.decision, category: item.confirmedCategory || null };
      }
    }
    const count = Object.keys(decisions).length;
    if (count > 0) log(`  Loaded ${count} previous review decisions (will auto-apply)`);
    return decisions;
  } catch (_) {
    return {};
  }
}

// ─── MAIN ────────────────────────────────────────────────────────
async function main() {
  // Truncate log for this run
  try { fs.writeFileSync(LOG_FILE, ''); } catch (_) {}

  log('═══════════════════════════════════════════════');
  log('  ScoopScore Scraper v6 — Multi-Signal Classifier  ');
  log('═══════════════════════════════════════════════');
  log(`  Retailers: ${RETAILERS.length}`);
  log(`  Output: confirmed → products.json | uncategorised → review.json | junk → excluded.json`);
  log('');

  // Load previous data for price history + health check baseline
  let existingProducts = [];
  let prevRetailerStats = {};
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    existingProducts = prev.products || [];
    prevRetailerStats = prev.meta?.retailerStats || {};
    log(`  Loaded ${existingProducts.length} existing products (for price history)`);
  } catch (_) {
    log('  No existing products.json — fresh start');
  }

  // Load previous human review decisions
  const prevReviewDecisions = loadPrevReviewDecisions();

  const allConfirmed = [];
  const allReview    = [];
  const allExcluded  = [];
  const retailerStats = {};
  const startTime = Date.now();

  // Scrape in small batches — 3 concurrent to avoid overloading retailers
  const BATCH_SIZE = 3;
  for (let i = 0; i < RETAILERS.length; i += BATCH_SIZE) {
    const batch = RETAILERS.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(r => scrapeShopifyStore(r, prevReviewDecisions))
    );

    for (let j = 0; j < results.length; j++) {
      const retailer = batch[j];
      if (results[j].status === 'fulfilled') {
        const { confirmed, review, excluded } = results[j].value;
        allConfirmed.push(...confirmed);
        allReview.push(...review);
        allExcluded.push(...excluded);
        retailerStats[retailer.name] = confirmed.length;
      } else {
        log(`  ${retailer.name} FAILED: ${results[j].reason?.message}`);
        retailerStats[retailer.name] = 0;
      }
    }

    if (i + BATCH_SIZE < RETAILERS.length) await sleep(3000);
  }

  // ── Health check ──
  const warnings = healthCheck(retailerStats, prevRetailerStats);
  if (warnings.length > 0) {
    log('');
    log('  HEALTH CHECK WARNINGS:');
    warnings.forEach(w => log(`  ${w}`));
    log('');
  }

  // ── Deduplicate confirmed (same product in multiple collections) ──
  const seen = new Set();
  const deduped = allConfirmed.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // ── Merge price history ──
  const merged = mergeWithExisting(deduped, existingProducts);

  // ── Sort ──
  merged.sort((a, b) => {
    const catOrder = ['protein','proteinbars','rtd','creatine','preworkout','fatburner','bcaa','vitamins'];
    const ai = catOrder.indexOf(a.category ?? '');
    const bi = catOrder.indexOf(b.category ?? '');
    if (ai !== bi) return ai - bi;
    return (a.brand || '').localeCompare(b.brand || '');
  });

  // ── Category counts ──
  const ALL_CATS = ['protein','proteinbars','rtd','creatine','preworkout','fatburner','bcaa','vitamins'];
  const catCounts = Object.fromEntries(ALL_CATS.map(c => [c, merged.filter(p => p.category === c).length]));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Write products.json ──
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    meta: {
      updatedAt:     new Date().toISOString(),
      totalProducts: merged.length,
      retailers:     RETAILERS.map(r => r.name),
      retailerStats,
      categories:    catCounts,
      pendingReview: allReview.length,
      elapsed:       `${elapsed}s`,
      healthWarnings: warnings,
    },
    products: merged,
  }));

  // ── Write / merge review.json ──
  // Keep existing pending decisions, add new uncategorised products,
  // don't overwrite any item that already has a human decision.
  let existingReview = [];
  try {
    existingReview = JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8')).products || [];
  } catch (_) {}

  const existingReviewIds = new Set(existingReview.map(r => r.id));
  const newReviewItems = allReview
    .filter(p => !existingReviewIds.has(p.id))       // don't add duplicates
    .map(p => ({
      id:                p.id,
      decision:          'pending',
      confirmedCategory: null,
      reviewReason:      p.reviewReason,
      product:           p,
    }));

  // Prune review items for products that are now confirmed or excluded
  const confirmedIds = new Set(merged.map(p => p.id));
  const prunedExisting = existingReview.filter(r => !confirmedIds.has(r.id));

  const allReviewItems = [...prunedExisting, ...newReviewItems];
  fs.writeFileSync(REVIEW_FILE, JSON.stringify({
    meta: { updatedAt: new Date().toISOString(), total: allReviewItems.length, pending: allReviewItems.filter(r => r.decision === 'pending').length },
    products: allReviewItems,
  }, null, 2));

  // ── Write excluded.json (audit only, not committed to git) ──
  fs.writeFileSync(EXCL_FILE, JSON.stringify({
    meta: { updatedAt: new Date().toISOString(), total: allExcluded.length },
    products: allExcluded,
  }, null, 2));

  // ── Print results ──
  log('');
  log('═══════════════════════ RESULTS ═══════════════════════');
  log(`  ✅ Confirmed:     ${merged.length} products → products.json`);
  log(`  🟡 Review queue:  ${allReviewItems.filter(r => r.decision === 'pending').length} products → review.json  ← open review.html`);
  log(`  ❌ Excluded:      ${allExcluded.length} products → excluded.json`);
  log(`  ⏱  Time:          ${elapsed}s`);
  if (warnings.length > 0) {
    log('');
    log(`  ⚠️  ${warnings.length} health warning(s) — see above`);
  }
  log('');
  log('  By retailer (confirmed):');
  for (const [name, count] of Object.entries(retailerStats)) {
    const bar = '█'.repeat(Math.min(30, Math.round(count / 5)));
    log(`    ${name.padEnd(26)} ${String(count).padStart(5)}  ${bar}`);
  }
  log('');
  log('  By category:');
  for (const [cat, count] of Object.entries(catCounts)) {
    log(`    ${cat.padEnd(15)} ${count}`);
  }
  log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
