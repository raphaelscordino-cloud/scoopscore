#!/bin/bash
# ─────────────────────────────────────────────────────
# ScoopScore daily scrape + git push
# Runs via cron at 3am. See README.md for setup.
#
# IMPORTANT: change the path below to your actual folder
# ─────────────────────────────────────────────────────

cd /path/to/your/scoopscore  # ← CHANGE THIS

# Use the full path to node (cron doesn't load your PATH)
# Find yours by running: which node
NODE=/usr/local/bin/node      # ← CHANGE THIS if needed (run: which node)

echo ""
echo "========================================"
echo "  ScoopScore scrape — $(date)"
echo "========================================"

$NODE scraper.js

# Only commit if products.json actually changed
git add data/products.json data/scrape.log
if git diff --staged --quiet; then
  echo "No changes to commit."
else
  git commit -m "chore: daily price update $(date +%Y-%m-%d)"
  git push
  echo "Pushed to git."
fi

echo "Done — $(date)"
