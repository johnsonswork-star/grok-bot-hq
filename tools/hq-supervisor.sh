#!/bin/bash
# HQ bridge supervisor (Oct 17 v3). THE ONLY thing that starts or restarts `hq-bridge.mjs watch`.
#   tools/hq-supervisor.sh            run the loop (normally started detached by `tools/hq-inbox.sh bridge`)
#   tools/hq-supervisor.sh status     one line: supervisor + bridge pids, heartbeat age
# Every 10 s: if the bridge is not running, or its heartbeat (written after every successful 4 s relay poll) is
# older than 30 s, kill every watch process and start exactly one. A flock keeps it to one supervisor, and the
# bridge itself runs under a second flock (plus its own bridge.pid check), so two bridges can never run.
cd "$(dirname "$0")/.." || exit 1
D="$HOME/.config/grok-bot-hq"; LOG="$D/bridge.log"; HB="$D/bridge.heartbeat"
export NODE_NO_WARNINGS=1
ts() { date '+%m/%d/%Y, %-I:%M:%S %p'; }
hb_age() { echo $(( $(date +%s) - $(stat -c %Y "$HB" 2>/dev/null || echo 0) )); }
watch_pids() { pgrep -f "^(/[^ ]*/)?node .*hq-bridge.mjs watch" | tr '\n' ' '; }
if [ "$1" = status ]; then
  echo "supervisor: $(pgrep -f 'bash .*hq-supervisor.sh$' | tr '\n' ' ')| bridge: $(watch_pids)| heartbeat $(hb_age)s old"; exit 0
fi
exec 9>"$D/supervisor.lock"
flock -w 15 9 || { echo "supervisor already running"; exit 0; }  # -w: a killed predecessor's short sleeps may hold the lock a few s
echo "$(ts) supervisor: started (pid $$)" >> "$LOG"
start_bridge() {
  local p; p=$(watch_pids)
  [ -n "$p" ] && { kill $p 2>/dev/null; sleep 2; p=$(watch_pids); [ -n "$p" ] && kill -9 $p 2>/dev/null; }
  pkill -9 -f "^flock .*bridge.lock node" 2>/dev/null   # stale wrapper of a killed bridge must not hold the lock
  rm -f "$D/bridge.pid"; touch "$HB"   # fresh grace period for the new process
  setsid flock -w 8 "$D/bridge.lock" node tools/hq-bridge.mjs watch >> "$LOG" 2>&1 < /dev/null 9>&- &
  sleep 3; echo "$(ts) supervisor: bridge started (pid $(watch_pids))" >> "$LOG"
}
while true; do
  p=$(watch_pids); age=$(hb_age)
  if [ -z "$p" ]; then echo "$(ts) supervisor: bridge not running, starting" >> "$LOG"; start_bridge
  elif [ "$(echo $p | wc -w)" -gt 1 ]; then echo "$(ts) supervisor: $(echo $p | wc -w) bridges running ($p), restarting one" >> "$LOG"; start_bridge
  elif [ "$age" -gt 30 ]; then echo "$(ts) supervisor: heartbeat ${age}s old (pid $p), restarting" >> "$LOG"; start_bridge
  fi
  sleep 10 9>&-
done
