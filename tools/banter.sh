#!/usr/bin/env bash
# HQ #56 banter loop on the box: tools/banter.sh start | stop | restart | status | once | dry | off | on
cd "$(dirname "$0")/.."; D="$HOME/.config/grok-bot-hq"; PID="$D/banter.pid"
alive() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }
case "$1" in
  start) if alive; then echo "running (pid $(cat "$PID"))"; else nohup node --no-warnings tools/banter.mjs run >/dev/null 2>>"$D/banter.log" & sleep 1; echo "started (pid $(cat "$PID" 2>/dev/null))"; fi ;;
  stop) if alive; then kill "$(cat "$PID")"; echo stopped; else echo "not running"; fi ;;
  restart) "$0" stop; sleep 1; "$0" start ;;
  status) alive && echo "running (pid $(cat "$PID"))" || echo "not running"; node --no-warnings tools/banter.mjs status; tail -5 "$D/banter.log" ;;
  once) node --no-warnings tools/banter.mjs once ${2:+$2} ;;
  dry) node --no-warnings tools/banter.mjs dry ;;
  off) touch "$D/banter.off"; echo "banter paused (loop keeps running, skips every tick)" ;;
  on) rm -f "$D/banter.off"; echo "banter on" ;;
  *) echo "usage: $0 start|stop|restart|status|once [--force]|dry|off|on" ;;
esac
