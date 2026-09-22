set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/sort2.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5177 --host 127.0.0.1 >/tmp/vite-sort2.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5177/); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"
agent-browser open http://127.0.0.1:5177/ >/dev/null 2>&1
sleep 1.5
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));b.click();return 'expanded'})()" >/dev/null 2>&1
sleep 0.8
REF=$(agent-browser snapshot -i 2>/dev/null | grep "最新发布排序" | grep -o "e[0-9]*" | head -1)
log "sort wrapper ref = @$REF"
agent-browser click "@$REF" 2>&1 | tee -a "$L"
sleep 0.9
log "--- options ---"; agent-browser snapshot -i 2>&1 | grep -E "价格从低到高|价格从高到低|最多浏览" | tee -a "$L"
OPT=$(agent-browser snapshot -i 2>/dev/null | grep "价格从低到高" | grep -o "e[0-9]*" | head -1)
log "option ref = @$OPT"
agent-browser click "@$OPT" 2>&1 | tee -a "$L"
sleep 1.2
agent-browser eval "JSON.stringify([...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent))" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-17-sort-final.png" >/dev/null 2>&1
# 再切「最多浏览」
R2=$(agent-browser snapshot -i 2>/dev/null | grep "价格从低到高排序" | grep -o "e[0-9]*" | head -1)
agent-browser click "@$R2" >/dev/null 2>&1
sleep 0.8
O2=$(agent-browser snapshot -i 2>/dev/null | grep "最多浏览" | grep -o "e[0-9]*" | head -1)
agent-browser click "@$O2" >/dev/null 2>&1
sleep 1.2
agent-browser eval "JSON.stringify({views:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.textContent.match(/(\\d+)\\s*$/)?.[1])})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-18-sort-views-final.png" >/dev/null 2>&1
agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log DONE
