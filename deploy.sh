#!/usr/bin/env bash
# Publish Bot Office to https://johnsonswork-star.github.io/grok-bot-hq/
set -e
cd "$(dirname "$0")"
# Open 2D iPads poll 2d/version.json and reload. Root version.json gets the same
# build so an iPad still on the previous 2D page (it polled ../version.json) reloads once.
# Root sw.js only unregisters the old 3D worker. Do not put a cache name back in it.
BUILD=$(date +%s)
echo "{\"build\":\"$BUILD\"}" > version.json
echo "{\"build\":\"$BUILD\"}" > 2d/version.json
git add -A
git commit -m "${1:-Update office $(date '+%Y-%m-%d %H:%M')}" || echo "nothing to commit"
git push origin main
# live work feed: the deploy shows up on App Builder's desk monitor (tools/work-live.mjs)
node tools/work-live.mjs log builder "deployed: ${1:-office update} (build $BUILD)" 2>/dev/null || true
echo "Pushed. Live in ~1 min: https://johnsonswork-star.github.io/grok-bot-hq/"
