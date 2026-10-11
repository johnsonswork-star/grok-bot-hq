#!/usr/bin/env bash
# Post one line to Slack #hq-chat using ~/.config/grok-bot-hq/slack.env (see tools/slack.env.example).
# Usage: tools/hq-slack-wake.sh "text"     (no args = test message)
set -euo pipefail
cd "$(dirname "$0")/.."
exec node tools/hq-bridge.mjs slack-test "${1:-Slack wake test from Bot HQ bridge (ignore)}"
