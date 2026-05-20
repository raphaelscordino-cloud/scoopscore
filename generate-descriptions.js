#!/usr/bin/env node
/**
 * ScoopScore — AI Description Generator
 * ─────────────────────────────────────
 * Reads data/products.json, generates AI descriptions for every unique
 * product group, and writes results to data/descriptions.json.
 *
 * Run:  node generate-descriptions.js
 *
 * Re-run any time you add new products — existing descriptions are kept
 * from the previous run so you only pay for new/changed products.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY          = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';
const PRODUCTS_FILE    = path.join(__dirname, 'data', 'products.json');
const DESCRIPTIONS_FILE = path.join(__dirname, 'data', 'descriptions.json');
const CONCURRENCY      = 3;   // parallel API calls (stay well under rate limits)
const DELAY_MS         = 500; // ms between batches
// ─────────────────────────────────────────────────────────────────────────────

if (API_KEY === 'YOUR_API_KEY_HERE') {
  console.error('❌  Set your API key: ANTHROPIC_API_KEY=sk-... node generate-descriptions.js');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normKey(name) {
  return name.toLowerCase()
    .replace(/\b(whey|protein|isolate|concentrate|blend|complex|formula|nz|new zealand)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normBrand(b) {
  return (b || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function callAnthropic(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.error) return reject(new Error(data.error.message));
          const text = (data.content || []).map(b => b.text || '').join('').trim();
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateForGroup(group, brandName) {
  const productName = group.name;
  const category    = group.category || '';
  const flavours    = [...new Set(
    (group.listings || [])
      .flatMap(l => (l.variants || []).map(v => v.title))
      .filter(Boolean)
  )].slice(0, 6).join(', ');
  const sizes = [...new Set(
    (group.sizes || group.listings?.flatMap(l =>
      (l.variants || []).map(v => v.size).filter(Boolean)
    ) || [])
  )].filter(Boolean).join(', ');

  const prompt = `You are a supplement expert writing for a NZ price comparison site. Generate a structured JSON review for "${productName}" by ${brandName}${category ? ' (category: ' + category + ')' : ''}.${flavours ? ' Flavours: ' + flavours + '.' : ''}${sizes ? ' Sizes: ' + sizes + '.' : ''}

Return ONLY valid JSON with exactly this shape:
{
  "overview": "2-3 sentence factual overview: what it is, who it's for, key ingredients/benefits. No hype.",
  "reviewerSay": ["short quote-style comment reflecting real user sentiment 1", "comment 2", "comment 3"],
  "pros": ["pro 1", "pro 2", "pro 3"],
  "cons": ["con 1", "con 2"]
}

Rules: no markdown, no backticks, no preamble. Just the JSON object.`;

  const raw = await callAnthropic(prompt);
  const cleaned = raw.replace(/^```json|^```|```$/gm, '').trim();
  return JSON.parse(cleaned);
}

async function runBatch(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) await sleep(DELAY_MS);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📦  Reading products.json…');
  if (!fs.existsSync(PRODUCTS_FILE)) {
    console.error(`❌  Not found: ${PRODUCTS_FILE}`);
    process.exit(1);
  }

  const { products } = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  console.log(`    ${products.length} raw listings found`);

  // Group products the same way the site does
  const groups = {}; // "brand::key" → { group, brandName }
  for (const p of products) {
    const brandName = normBrand(p.brand);
    const key       = normKey(p.name);
    const groupKey  = `${brandName}::${key}`;
    if (!groups[groupKey]) {
      groups[groupKey] = { group: { key, name: p.name, category: p.category, listings: [] }, brandName };
    }
    if (p.name.length < groups[groupKey].group.name.length) {
      groups[groupKey].group.name = p.name;
    }
    groups[groupKey].group.listings.push(p);
  }

  // Resolve category by majority vote (matches site logic)
  for (const { group } of Object.values(groups)) {
    const votes = {};
    for (const l of group.listings) votes[l.category] = (votes[l.category] || 0) + 1;
    group.category = Object.entries(votes).sort((a, z) => z[1] - a[1])[0][0];
  }

  const allGroups = Object.values(groups);
  console.log(`    ${allGroups.length} unique product groups\n`);

  // Load existing descriptions so we skip already-generated ones
  let existing = {};
  if (fs.existsSync(DESCRIPTIONS_FILE)) {
    existing = JSON.parse(fs.readFileSync(DESCRIPTIONS_FILE, 'utf8'));
    const existingCount = Object.keys(existing).length;
    console.log(`♻️   Loaded ${existingCount} existing descriptions (skipping these)\n`);
  }

  const toGenerate = allGroups.filter(({ group, brandName }) => {
    const id = `${brandName}::${group.key}`;
    return !existing[id];
  });

  if (toGenerate.length === 0) {
    console.log('✅  All products already have descriptions — nothing to do!');
    console.log('    Delete data/descriptions.json to regenerate everything.');
    return;
  }

  console.log(`🤖  Generating ${toGenerate.length} descriptions (${CONCURRENCY} at a time)…\n`);

  let done = 0;
  let failed = 0;

  const results = await runBatch(toGenerate, async ({ group, brandName }) => {
    const id = `${brandName}::${group.key}`;
    try {
      const desc = await generateForGroup(group, brandName);
      existing[id] = desc;
      done++;
      console.log(`  ✓  [${done + failed}/${toGenerate.length}] ${brandName} — ${group.name}`);
      // Save after every successful generation so progress isn't lost
      fs.writeFileSync(DESCRIPTIONS_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      failed++;
      console.warn(`  ✗  [${done + failed}/${toGenerate.length}] ${brandName} — ${group.name}: ${e.message}`);
    }
  }, CONCURRENCY);

  console.log(`\n──────────────────────────────────────`);
  console.log(`✅  Done — ${done} generated, ${failed} failed`);
  console.log(`📄  Saved to: ${DESCRIPTIONS_FILE}`);
  if (failed > 0) console.log(`    Re-run to retry failed items.`);
}

main().catch(e => { console.error(e); process.exit(1); });
