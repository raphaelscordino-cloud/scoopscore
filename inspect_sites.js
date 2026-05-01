/**
 * inspect_sites.js — run this from your project folder to dump
 * the real HTML structure of Sprint Fit and Nutrition Warehouse.
 * 
 * Usage:  node inspect_sites.js
 * Output: inspect_sprintfit.html and inspect_nw.html
 */

const { chromium } = require('playwright');
const fs = require('fs');

async function inspect(name, url, filename) {
  console.log(`\nInspecting ${name}...`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-NZ',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const html = await page.content();
    fs.writeFileSync(filename, html);

    // Also dump a summary
    const summary = await page.evaluate(() => {
      const allClasses = new Set();
      document.querySelectorAll('*').forEach(el => {
        el.className?.toString().split(' ').forEach(c => {
          if (c && c.length > 2 && (
            c.includes('product') || c.includes('card') || c.includes('item') ||
            c.includes('grid') || c.includes('list') || c.includes('price') ||
            c.includes('title') || c.includes('name') || c.includes('collection')
          )) allClasses.add(c);
        });
      });

      const priceEls = [...document.querySelectorAll('*')]
        .filter(el => el.children.length === 0 && /\$\d+/.test(el.textContent))
        .slice(0, 8)
        .map(el => ({
          tag: el.tagName,
          cls: el.className?.toString().substring(0, 60),
          text: el.textContent.trim().substring(0, 40),
          parentCls: el.parentElement?.className?.toString().substring(0, 60),
        }));

      const linkEls = [...document.querySelectorAll('a[href*="/product"]')]
        .slice(0, 5)
        .map(a => ({
          href: a.href.substring(0, 80),
          text: a.textContent.trim().substring(0, 50),
          cls: a.className?.toString().substring(0, 50),
          parentCls: a.parentElement?.className?.toString().substring(0, 60),
        }));

      return {
        bodyText: document.body.innerText.substring(0, 500),
        relevantClasses: [...allClasses],
        priceEls,
        linkEls,
        totalElements: document.querySelectorAll('*').length,
      };
    });

    console.log(`  Body text: ${summary.bodyText.substring(0, 120).replace(/\n/g, ' ')}`);
    console.log(`  Total elements: ${summary.totalElements}`);
    console.log(`  Relevant classes: ${summary.relevantClasses.join(', ')}`);
    console.log(`  Price elements: ${JSON.stringify(summary.priceEls, null, 2)}`);
    console.log(`  Product links: ${JSON.stringify(summary.linkEls, null, 2)}`);
    console.log(`  Full HTML saved to: ${filename}`);
  } catch(e) {
    console.error(`  Error: ${e.message}`);
  }

  await browser.close();
}

(async () => {
  await inspect(
    'Sprint Fit',
    'https://www.sprintfit.co.nz/products/category/321/protein-powder',
    'inspect_sprintfit.html'
  );
  await inspect(
    'Nutrition Warehouse',
    'https://www.nutritionwarehouse.co.nz/collections/protein-powders',
    'inspect_nw.html'
  );
  console.log('\nDone. Open the .html files in a browser or send the console output back.');
})();
