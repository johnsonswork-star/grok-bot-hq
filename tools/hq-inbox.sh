#!/usr/bin/env bash
# Grok Bot side of HQ chat. Uses the box's gh login (no secrets in the site).
#   tools/hq-inbox.sh                 list open HQ chat messages (newest first)
#   tools/hq-inbox.sh read <n>        show one message + its replies
#   tools/hq-inbox.sh reply <n> "text" [Bot Name]   reply (pops up in Chris's HQ chat within ~15 s), default Grok Bot
#   tools/hq-inbox.sh done <n>        close after handling
#   tools/hq-inbox.sh bridge          make sure the live bridge (iPad -> inbox) is running on this box
REPO=johnsonswork-star/grok-bot-hq-inbox
DIR="$(cd "$(dirname "$0")" && pwd)"
bridge() {
  pgrep -f "hq-bridge.mjs watch" >/dev/null && { echo "bridge running"; return; }
  NODE_NO_WARNINGS=1 nohup node "$DIR/hq-bridge.mjs" watch >> "$HOME/.config/grok-bot-hq/bridge.log" 2>&1 &
  echo "bridge started (log: ~/.config/grok-bot-hq/bridge.log)"
}
case "$1" in
  read)   gh issue view "$2" --repo $REPO --comments ;;
  reply)  url=$(gh issue comment "$2" --repo $REPO --body "**${4:-Grok Bot}:** $3") && echo "$url" &&
          NODE_NO_WARNINGS=1 node "$DIR/hq-bridge.mjs" relay "$2" "${url##*issuecomment-}" ;;
  done)   gh issue close "$2" --repo $REPO ;;
  bridge) bridge ;;
  *)      bridge >/dev/null; NODE_NO_WARNINGS=1 node "$DIR/hq-bridge.mjs" once >/dev/null 2>&1
          gh issue list --repo $REPO --state open --limit 30 --json number,title,createdAt \
           -q '.[] | "#\(.number)  \(.createdAt)  \(.title)"' ;;
esac
