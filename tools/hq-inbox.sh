#!/usr/bin/env bash
# Grok Bot side of HQ chat. Uses the box's gh login (no secrets in the site).
#   tools/hq-inbox.sh                 list open HQ chat messages (newest first)
#   tools/hq-inbox.sh read <n>        show one message + its replies
#   tools/hq-inbox.sh reply <n> "text" [Bot Name]   reply (pops up in Chris's HQ chat within ~15 s), default Grok Bot
#   tools/hq-inbox.sh memory <bot>    HQ #58: that worker's own memory digest (what Chris said to them, mood, recent events)
#        `read` prints the recipient's digest too, and `reply ... "Bot Name"` adds the reply to that worker's memory.
#   tools/hq-inbox.sh shot <n>        path(s) of the 📸 screenshot(s) of Chris's 3D view sent with issue n (open with Read)
#   tools/hq-inbox.sh done <n>        close after handling
#   tools/hq-inbox.sh pending         open HQ messages with no bot reply yet (what Grok Bot must answer); also heals the bridge
#   tools/hq-inbox.sh direct <map|pending|forwarded|reply|thread> ...   HQ #63 Direct tab (1:1 with a teammate, no Grok Bot)
#   tools/hq-inbox.sh refreshes       open tap-to-refresh requests (bank / inbox) newer than the last feed push (pending shows them too)
#   tools/hq-inbox.sh bridge          make sure the live bridge (iPad -> inbox) is running on this box (also keeps the watcher up)
#   tools/hq-inbox.sh watcher [start|stop|status|log]   auto-reply watcher: full AI reply to each HQ message within seconds
#        Cost: polling is free (gh only). Each HQ message = one LLM call: local model on this box (free) unless an
#        XAI_API_KEY/OPENAI_API_KEY is put in ~/.config/grok-bot-hq/llm.env (then ~fractions of a cent per message).
REPO=johnsonswork-star/grok-bot-hq-inbox
DIR="$(cd "$(dirname "$0")" && pwd)"
bridge() {
  # Oct 17 v3: tools/hq-supervisor.sh is the single owner of bridge (re)starts (heartbeat > 30 s => restart).
  # This only makes sure the supervisor itself is running; it never starts or kills the bridge directly.
  if pgrep -f "bash .*hq-supervisor.sh$" >/dev/null; then echo "bridge supervised ($("$DIR/hq-supervisor.sh" status))"; return; fi
  setsid nohup "$DIR/hq-supervisor.sh" > /dev/null 2>&1 < /dev/null &
  [ "$1" = nowait ] && return  # pending: don't wait 6 s, it reads the relay itself right after this
  sleep 6; echo "supervisor started ($("$DIR/hq-supervisor.sh" status))"
}
worklive() { # live desk-monitor publisher (tools/work-live.mjs watch): plain node, no AI
  pgrep -f "work-live.mjs watch" >/dev/null && return
  NODE_NO_WARNINGS=1 nohup node "$DIR/work-live.mjs" watch >> "$HOME/.config/grok-bot-hq/work-live.log" 2>&1 < /dev/null &
}
swipetrain() { # HQ #85 design-trainer wall: publishes the designer deck (cards-v*.json) to each iPad's encrypted _swipe feed. Plain node, no AI
  pgrep -f "swipe-train.mjs watch" >/dev/null && return
  NODE_NO_WARNINGS=1 nohup node "$DIR/swipe-train.mjs" watch >> "$HOME/.config/grok-bot-hq/swipe-train.log" 2>&1 < /dev/null &
}
# Oct 17: 3D office abandoned. worklive / banter / swipetrain are NOT auto-started any more (pending + bridge no longer call them).
banter() { "$DIR/banter.sh" start >/dev/null 2>&1; } # HQ #56 free-model office banter loop (idempotent; banter.sh off pauses it)
CFG="$HOME/.config/grok-bot-hq"
watcher_pid() { pgrep -f "node $DIR/hq-watcher.mjs$" | head -1; }
watcher() {
  case "${1:-start}" in
    start)  rm -f "$CFG/watcher.off"; [ -n "$(watcher_pid)" ] && { echo "watcher running (pid $(watcher_pid))"; return; }
            NODE_NO_WARNINGS=1 nohup node "$DIR/hq-watcher.mjs" >> "$CFG/watcher.log" 2>&1 < /dev/null &
            sleep 1; echo "watcher started (pid $(watcher_pid), log: ~/.config/grok-bot-hq/watcher.log)" ;;
    stop)   touch "$CFG/watcher.off"; p=$(watcher_pid); [ -n "$p" ] && kill $p && echo "watcher stopped (was pid $p)" || echo "watcher not running" ;;
    status) p=$(watcher_pid); [ -n "$p" ] && echo "watcher running (pid $p)" || { echo "watcher not running"; [ -f "$CFG/watcher.off" ] && echo "(stopped on purpose; 'watcher start' to resume)"; } ;;
    log)    tail -n "${2:-30}" "$CFG/watcher.log" ;;
  esac
}
refreshes() { node -e '
const fs=require("fs"),D=process.env.HOME+"/.config/grok-bot-hq";let L=[];try{L=fs.readFileSync(D+"/refresh-requests.jsonl","utf8").trim().split("\n").filter(Boolean).map(JSON.parse)}catch(e){}
const how={bank:"Finance finance_list_accounts + finance_list_connections (write_to_file) -> node tools/refresh-bank-feed.mjs <accounts> <connections>",inbox:"Gmail search_threads in:inbox -category:promotions -category:social pageSize 40 (write_to_file) -> node tools/refresh-inbox-feed.mjs <file>"};
const file={bank:"bank-live.json",inbox:"inbox-live.json"};
for(const k of Object.keys(how)){const r=L.filter(x=>x.kind===k).pop();if(!r)continue;let m=0;try{m=fs.statSync(D+"/"+file[k]).mtimeMs}catch(e){}
 const at=Date.parse(r.at);if(at>m&&Date.now()-at<6*3600e3)console.log("REFRESH "+k+" requested "+new Date(at).toLocaleString("en-US",{timeZone:"America/Chicago",timeStyle:"short"})+" CT: "+how[k])}'; }
autowatch() { [ -f "$CFG/watcher.off" ] || [ -n "$(watcher_pid)" ] || watcher start >/dev/null; }
case "$1" in
  read)   out=$(gh issue view "$2" --repo $REPO --json number,title,body,comments \
            -q '"#\(.number) \(.title)\n\n\(.body)\n\n" + ([.comments[] | "[\(.createdAt)] \(.body)"] | join("\n\n"))') || exit 1
          echo "$out"
          to=$(printf '%s' "$out" | head -1 | sed -nE 's/^#[0-9]+ HQ chat → ([^:]+):.*/\1/p')
          [ -n "$to" ] && { echo; echo "----- worker memory (HQ #58) -----"; NODE_NO_WARNINGS=1 node "$DIR/worker-memory.mjs" sync >/dev/null 2>&1; NODE_NO_WARNINGS=1 node "$DIR/worker-memory.mjs" digest "$to" 2>/dev/null; } ;;
  memory) NODE_NO_WARNINGS=1 node "$DIR/worker-memory.mjs" sync >/dev/null 2>&1; NODE_NO_WARNINGS=1 node "$DIR/worker-memory.mjs" digest "${2:-grok}" ;;
  pending) echo "$(date -Is) pending pid $$ ppid $PPID" >> "$HOME/.config/grok-bot-hq/pending.log"  # when a wake run starts (delay measurement)
          bridge nowait >/dev/null
          # Oct 18: always read the relay directly (only what came after the last handled id, ~1-2 s), so a woken run
          # files new messages itself even when the box bridge is dead or stalled. The mid claim files stop double filing.
          NODE_NO_WARNINGS=1 timeout 40 node "$DIR/hq-bridge.mjs" once >> "$CFG/bridge.log" 2>&1
          # a filing the live bridge is in the middle of (claimed < 30 s ago, no outcome yet): wait up to 12 s for it
          for _ in 1 2 3 4 5 6; do
            find "$CFG/mids" -type f -newermt '-30 seconds' 2>/dev/null | xargs -r grep -L -E 'filed #|office' 2>/dev/null | grep -q . || break; sleep 2
          done
          NODE_NO_WARNINGS=1 node "$DIR/worker-memory.mjs" sync >/dev/null 2>&1
          # Oct 18 ack dedupe: this run claims what it lists; ones another run already claimed are shown apart (tools/hq-claim.mjs)
          mkdir -p "$CFG/claims"
          ( flock -w 20 9
            gh issue list --repo $REPO --label hq-chat --state open --limit 50 --json number,title,createdAt,comments \
             -q '.[] | select((.comments|length)==0 or ((.comments|last|.body) | test("^\\s*\\*\\*[^*]{1,40}:\\*\\*") | not)) | "#\(.number)  \(.createdAt)  \(.title)"' |
             NODE_NO_WARNINGS=1 node "$DIR/hq-claim.mjs" filter
          ) 9> "$CFG/claims/.lock"
          refreshes
          NODE_NO_WARNINGS=1 node "$DIR/direct.mjs" pending --quiet ;;  # HQ #63: Direct-tab messages queued for real teammates
  refreshes) refreshes ;;
  direct) shift; NODE_NO_WARNINGS=1 node "$DIR/direct.mjs" "$@" ;;  # HQ #63: map | pending | forwarded <bot> <id|all> | reply <bot> "text" | thread <bot>
  reply)  mkdir -p "$CFG/claims"; exec 9> "$CFG/claims/$2.lock"; flock -w 30 9  # Oct 18: one reply at a time per issue
          [ "${HQ_FORCE:-}" = 1 ] || NODE_NO_WARNINGS=1 node "$DIR/hq-claim.mjs" may-reply "$2" || exit 3  # double-ack guard
          url=$(gh issue comment "$2" --repo $REPO --body "**${4:-Grok Bot}:** $3") && echo "$url" &&
          { NODE_NO_WARNINGS=1 node "$DIR/hq-claim.mjs" replied "$2" || true; } &&
          { NODE_NO_WARNINGS=1 node "$DIR/worker-memory.mjs" log "${4:-Grok Bot}" "I told Chris: $3" --kind reply --issue "$2" --src hq-reply >/dev/null 2>&1 || true; } &&
          NODE_NO_WARNINGS=1 node "$DIR/hq-bridge.mjs" relay "$2" "${url##*issuecomment-}" ;;
  shot)   paths=$(gh issue view "$2" --repo $REPO --json body -q .body | grep -oE '[^` ]*/grok-bot-hq/shots/[A-Za-z0-9_-]+\.(jpg|png)' | sort -u)
          [ -z "$paths" ] && { echo "no screenshot on #$2"; exit 1; }
          for f in $paths; do
            if [ ! -s "$f" ]; then mkdir -p "$(dirname "$f")"; gh api "repos/$REPO/contents/shots/$(basename "$f")" -H 'Accept: application/vnd.github.raw' > "$f" 2>/dev/null || { rm -f "$f"; echo "missing: $f"; continue; }; fi
            echo "$f"
          done ;;
  done)   gh issue close "$2" --repo $REPO ;;
  bridge) bridge; autowatch ;;
  watcher) watcher "$2" "$3" ;;
  *)      bridge >/dev/null
          gh issue list --repo $REPO --state open --limit 30 --json number,title,createdAt \
           -q '.[] | "#\(.number)  \(.createdAt)  \(.title)"' ;;
esac
