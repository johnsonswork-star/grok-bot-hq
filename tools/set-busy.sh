#!/usr/bin/env bash
# Mark a bot busy/idle in the 3D office (its worker walks to its desk and types while busy).
#   tools/set-busy.sh <id> "task text" [minutes]   busy (optional auto-clear after N minutes)
#   tools/set-busy.sh <id> off                     idle again (roams the floor)
#   tools/set-busy.sh list                         show who's busy
#   add --no-push to edit tasks.json without publishing
# ids: grok cos inbox assist designer kids builder review onpad icons faith broker conn profile
# Live on Chris's iPad within ~1-2 min (Pages rebuild + 20 s poll).
set -e
cd "$(dirname "$0")/.."
PUSH=1; args=(); for a in "$@"; do [ "$a" = "--no-push" ] && PUSH=0 || args+=("$a"); done; set -- "${args[@]}"
[ -z "$1" ] && { sed -n '2,9p' "$0"; exit 1; }
node -e '
const fs=require("fs"),[id,task,mins]=process.argv.slice(1);
const j=JSON.parse(fs.readFileSync("tasks.json","utf8")); j.busy=j.busy||{};
const ids=(fs.readFileSync("stations.js","utf8").match(/id:\s*"?\x27?([a-z]+)/g)||[]).map(s=>s.replace(/id:\s*["\x27]?/,""));
if(id==="list"){for(const[k,v]of Object.entries(j.busy))console.log(k+": "+(typeof v==="string"?v:JSON.stringify(v)));process.exit(0)}
if(!ids.includes(id)){console.error("unknown id "+id+" (use: "+ids.join(" ")+")");process.exit(2)}
if(!task||task==="off"||task==="idle")delete j.busy[id];
else j.busy[id]=mins?{task,until:new Date(Date.now()+mins*60000).toISOString()}:task;
fs.writeFileSync("tasks.json",JSON.stringify(j,null,2)+"\n");console.log(id+" -> "+(j.busy[id]?JSON.stringify(j.busy[id]):"idle"));
' "$@"
[ "$1" = "list" ] && exit 0
if [ $PUSH = 1 ]; then
  git add tasks.json && git commit -q -m "tasks: $1 ${2:-}" tasks.json && git push -q origin main && echo "published"
fi
