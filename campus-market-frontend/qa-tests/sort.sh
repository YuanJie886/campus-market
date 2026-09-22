set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/sort.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5176 --host 127.0.0.1 >/tmp/vite-sort.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5176/); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"
agent-browser open http://127.0.0.1:5176/ >/dev/null 2>&1
sleep 1.5
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));b.click();return 'expanded'})()" 2>&1 | tee -a "$L"
sleep 0.8
log "--- comboboxes ---"; agent-browser snapshot -i 2>&1 | grep -iE "combobox|最新发布|全部校区|全部成色" | tee -a "$L"
log "--- click sort combobox (nth 3) ---"
agent-browser find nth 3 "[role=combobox]" click 2>&1 | tee -a "$L"
sleep 0.8
log "--- options after open ---"; agent-browser snapshot -i 2>&1 | grep -E "价格从|最多浏览|最新发布" | tee -a "$L"
log "--- click option 价格从低到高 ---"
agent-browser find text "价格从低到高" click 2>&1 | tee -a "$L"
sleep 1.2
agent-browser eval "JSON.stringify([...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent))" 2>&1 | tee -a "$L"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-17-sort-final.png" >/dev/null 2>&1
log "shot done"
agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log DONE
