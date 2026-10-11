#!/usr/bin/env bash
# Publish Bot Office to https://johnsonswork-star.github.io/grok-bot-hq/
set -e
cd "$(dirname "$0")"
# bump the service-worker cache name so iPads drop old cached files
BUILD=$(date +%s)
sed -i -E "s/bot-office-v[0-9]+/bot-office-v$BUILD/" sw.js
# open iPads poll this and reload themselves (live.js)
echo "{\"build\":\"$BUILD\"}" > version.json
git add -A
git commit -m "${1:-Update office $(date '+%Y-%m-%d %H:%M')}" || echo "nothing to commit"
git push origin main
# live work feed: the deploy shows up on App Builder's desk monitor (tools/work-live.mjs)
node tools/work-live.mjs log builder "deployed: ${1:-office update} (build $BUILD)" 2>/dev/null || true
echo "Pushed. Live in ~1 min: https://johnsonswork-star.github.io/grok-bot-hq/"
