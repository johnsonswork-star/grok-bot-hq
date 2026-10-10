#!/usr/bin/env bash
# Grok Bot side of HQ chat. Uses the box's gh login (no secrets in the site).
#   tools/hq-inbox.sh                 list open HQ chat messages (newest first)
#   tools/hq-inbox.sh read <n>        show one message + its replies
#   tools/hq-inbox.sh reply <n> "text" [Bot Name]   reply (shows in Chris's HQ chat), default Grok Bot
#   tools/hq-inbox.sh done <n>        close after handling
REPO=johnsonswork-star/grok-bot-hq-inbox
case "$1" in
  read)  gh issue view "$2" --repo $REPO --comments ;;
  reply) gh issue comment "$2" --repo $REPO --body "**${4:-Grok Bot}:** $3" ;;
  done)  gh issue close "$2" --repo $REPO ;;
  *)     gh issue list --repo $REPO --state open --limit 30 --json number,title,createdAt \
           -q '.[] | "#\(.number)  \(.createdAt)  \(.title)"' ;;
esac
