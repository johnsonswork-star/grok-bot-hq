#!/usr/bin/env bash
# HQ #63 Direct-tab drain hint (cron/routine friendly). Prints ONLY the Direct messages from Chris still waiting for a
# real teammate, each with its agentId + a ready SendToAgent prompt. Prints nothing when the queue is empty.
# It never sends anything: the parent agent / routine does SendToAgent, then runs the printed `forwarded` command.
#   tools/direct-drain-hint.sh          human-readable (silent if empty)
#   tools/direct-drain-hint.sh --json   JSON array (always printed; [] when empty)
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$1" = "--json" ]; then NODE_NO_WARNINGS=1 exec node "$DIR/direct.mjs" pending --json; fi
NODE_NO_WARNINGS=1 exec node "$DIR/direct.mjs" pending --quiet
