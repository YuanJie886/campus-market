set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/filter.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
refof(){ agent-browser snapshot -i 2>/dev/null | grep "$1" | grep -oE "ref=e[0-9]+" | head -1 | sed 's/ref=//'; }
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5180 --host 127.0.0.1 >/tmp/vite-filter.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5180/); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"
agent-browser open http://127.0.0.1:5180/ >/dev/null 2>&1
sleep 1.5
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));b.click();return 'expanded'})()" >/dev/null 2>&1
sleep 0.8
# 校区 = 东校区
agent-browser eval "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('全部校区'));cb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));return 'md'})()" >/dev/null 2>&1
sleep 0.9
O=$(refof "东校区"); log "east opt=@$O"; agent-browser click "@$O" 2>&1 | tee -a "$L"
sleep 1.2
agent-browser eval "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,allEast:[...document.querySelectorAll('.cm-fade-in')].every(c=>c.textContent.includes('东校区'))})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-20-filter-campus.png" >/dev/null 2>&1
# 成色 = 全新
agent-browser eval "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('全部成色'));cb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));return 'md'})()" >/dev/null 2>&1
sleep 0.9
O2=$(refof "全新"); log "new opt=@$O2"; agent-browser click "@$O2" >/dev/null 2>&1
sleep 1.2
agent-browser eval "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,allNew:[...document.querySelectorAll('.cm-fade-in')].every(c=>c.textContent.includes('全新'))})" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-21-filter-condition.png" >/dev/null 2>&1
agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log DONE
