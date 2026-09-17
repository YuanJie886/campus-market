set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/sort4.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
refof(){ agent-browser snapshot -i 2>/dev/null | grep "$1" | grep -oE "ref=e[0-9]+" | head -1 | sed 's/ref=//'; }
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5179 --host 127.0.0.1 >/tmp/vite-sort4.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5179/); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"
agent-browser open http://127.0.0.1:5179/ >/dev/null 2>&1
sleep 1.5
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));b.click();return 'expanded'})()" >/dev/null 2>&1
sleep 0.8
# 用真实 mousedown 打开 MUI Select
agent-browser eval "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('最新发布'));cb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));return 'mousedown-sent'})()" 2>&1 | tee -a "$L"
sleep 0.9
log "--- options ---"; agent-browser snapshot -i 2>&1 | grep -E "价格从低到高|价格从高到低|最多浏览" | tee -a "$L"
O=$(refof "价格从低到高"); log "opt=@$O"
agent-browser click "@$O" 2>&1 | tee -a "$L"
sleep 1.2
agent-browser eval "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-17-sort-asc.png" >/dev/null 2>&1
# 切 价格从高到低
agent-browser eval "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('价格从低到高'));cb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));return 'md'})()" >/dev/null 2>&1
sleep 0.9
O2=$(refof "价格从高到低"); agent-browser click "@$O2" >/dev/null 2>&1
sleep 1.2
agent-browser eval "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-18-sort-desc.png" >/dev/null 2>&1
# 切 最多浏览
agent-browser eval "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('价格从高到低'));cb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));return 'md'})()" >/dev/null 2>&1
sleep 0.9
O3=$(refof "最多浏览"); agent-browser click "@$O3" >/dev/null 2>&1
sleep 1.2
agent-browser eval "JSON.stringify({views:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.textContent.match(/(\\d+)\\s*$/)?.[1])})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-19-sort-views.png" >/dev/null 2>&1
agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log DONE
