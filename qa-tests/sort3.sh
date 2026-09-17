set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/sort3.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
refof(){ agent-browser snapshot -i 2>/dev/null | grep "$1" | grep -oE "ref=e[0-9]+" | head -1 | sed 's/ref=//'; }
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5178 --host 127.0.0.1 >/tmp/vite-sort3.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5178/); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"
agent-browser open http://127.0.0.1:5178/ >/dev/null 2>&1
sleep 1.5
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));b.click();return 'expanded'})()" >/dev/null 2>&1
sleep 0.8
R=$(refof "最新发布排序"); log "sort ref=@$R"
agent-browser click "@$R" 2>&1 | tee -a "$L"
sleep 0.9
O=$(refof "价格从低到高"); log "opt ref=@$O"
agent-browser click "@$O" 2>&1 | tee -a "$L"
sleep 1.2
agent-browser eval "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-17-sort-asc.png" >/dev/null 2>&1
# 价格从高到低
R2=$(refof "价格从低到高排序"); log "sort ref2=@$R2"
agent-browser click "@$R2" >/dev/null 2>&1; sleep 0.9
O2=$(refof "价格从高到低"); agent-browser click "@$O2" >/dev/null 2>&1; sleep 1.2
agent-browser eval "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-18-sort-desc.png" >/dev/null 2>&1
# 最多浏览
R3=$(refof "价格从高到低排序"); agent-browser click "@$R3" >/dev/null 2>&1; sleep 0.9
O3=$(refof "最多浏览"); agent-browser click "@$O3" >/dev/null 2>&1; sleep 1.2
agent-browser eval "JSON.stringify({views:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.textContent.match(/(\\d+)\\s*$/)?.[1])})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-19-sort-views.png" >/dev/null 2>&1
agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log DONE
