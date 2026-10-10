#!/usr/bin/env bash
# Publish Bot Office to https://johnsonswork-star.github.io/grok-bot-hq/
set -e
cd "$(dirname "$0")"
# bump the service-worker cache name so iPads drop old cached files
sed -i -E "s/bot-office-v[0-9]+/bot-office-v$(date +%s)/" sw.js
git add -A
git commit -m "${1:-Update office $(date '+%Y-%m-%d %H:%M')}" || echo "nothing to commit"
git push origin main
echo "Pushed. Live in ~1 min: https://johnsonswork-star.github.io/grok-bot-hq/"
