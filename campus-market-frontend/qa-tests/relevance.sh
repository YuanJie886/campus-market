set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/relevance.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
PORT=5178
URL="http://127.0.0.1:$PORT"

NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port $PORT --host 127.0.0.1 >/tmp/vite-relevance.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" "$URL/"); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"

agent-browser open "$URL/" >/dev/null 2>&1
sleep 2.0

# ---- A. 无关键词：默认排序应仍为 createdAt 降序（行为不变）----
agent-browser open "$URL/" >/dev/null 2>&1
sleep 1.8
A=$(agent-browser eval "(()=>{const titles=[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent.trim());const st=JSON.parse(localStorage.getItem('campus_market_market_v1'));const byTitle={};st.products.forEach(p=>{byTitle[p.title]=p;});const exp=st.products.filter(p=>p.status!=='已下架').sort((a,b)=>b.createdAt-a.createdAt).map(p=>p.title);const same=titles.length===exp.length&&titles.every((t,i)=>t===exp[i]);return 'noKeywordCreatedAtDesc='+same+' count='+titles.length;})()" 2>&1 | tail -1 | tr -d '"')
log "CHECK_A=$A"

# ---- B. 显式选择「价格从低到高」：应严格按价格升序（不加权干预）----
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));if(b)b.click();return 'expanded';})()" >/dev/null 2>&1
sleep 1.0
agent-browser eval "(()=>{const cbs=[...document.querySelectorAll('[role=combobox]')];const s=cbs.find(c=>c.textContent.includes('最新发布'));if(!s)return 'no-sort-select';s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));s.click();return 'opened';})()" >/dev/null 2>&1
sleep 1.0
agent-browser eval "(()=>{const opt=[...document.querySelectorAll('li[role=option]')].find(o=>o.textContent.includes('价格从低到高'));if(!opt)return 'no-option';opt.click();return 'clicked';})()" >/dev/null 2>&1
sleep 1.2
B=$(agent-browser eval "(()=>{const prices=[...document.querySelectorAll('.cm-fade-in .text-brand-600')].map(e=>Number(e.textContent.replace(/[^0-9.]/g,'')));const asc=prices.every((v,i)=>i===0||prices[i-1]<=v);return 'priceAscOrder='+asc+' count='+prices.length+' prices='+prices.join(',');})()" 2>&1 | tail -1 | tr -d '"')
log "CHECK_B=$B"

# ---- 1. 选取关键词：标题命中 & 仅描述命中并存；优先选取「未加权排序会出错」的用例 ----
KW_RAW=$(agent-browser eval "(()=>{const st=JSON.parse(localStorage.getItem('campus_market_market_v1'));const prods=st.products.filter(p=>p.status!=='已下架');let best=null;for(const p of prods){const t=p.title.toLowerCase();for(let i=0;i<t.length-1;i++){const g=t.slice(i,i+2);if(/\s/.test(g))continue;const titleHits=prods.filter(q=>q.title.toLowerCase().includes(g)).length;const descOnly=prods.filter(q=>!q.title.toLowerCase().includes(g)&&q.description.toLowerCase().includes(g)).length;if(titleHits>=1&&descOnly>=1){const matched=prods.filter(q=>q.title.toLowerCase().includes(g)||q.description.toLowerCase().includes(g));const lvl=q=>q.title.toLowerCase().includes(g)?2:1;const naive=[...matched].sort((a,b)=>b.createdAt-a.createdAt).map(lvl);const naiveCorrect=naive.every((v,k)=>k===0||naive[k-1]>=v);const score=(naiveCorrect?1000:0)+matched.length;if(!best||score<best.score){best={g,titleHits,descOnly,naiveCorrect,matched:matched.length,score};}}}};return best?[best.g,best.titleHits,best.descOnly,best.naiveCorrect,best.matched].join('|'):'NONE';})()" 2>&1 | tail -1 | tr -d '"')
log "KW_RAW=$KW_RAW"
IFS='|' read -r KW TH DO NC MT <<< "$KW_RAW"
log "keyword=[$KW] titleHits=$TH descOnly=$DO naiveOrderCorrect=$NC matched=$MT"

# ---- 2. URL 关键词筛选：读取真实 DOM 卡片顺序，判定匹配等级是否降序 ----
agent-browser open "$URL/?keyword=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]||''))" "$KW")" >/dev/null 2>&1
sleep 2.0
RES=$(agent-browser eval "(()=>{const K=decodeURIComponent(new URLSearchParams(location.search).get('keyword')||'').toLowerCase();const titles=[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent.trim());const st=JSON.parse(localStorage.getItem('campus_market_market_v1'));const byTitle={};st.products.forEach(p=>{byTitle[p.title]=p;});const levels=titles.map(t=>{const p=byTitle[t];if(!p)return -1;return p.title.toLowerCase().includes(K)?2:1;});const correct=levels.every((v,i)=>i===0||levels[i-1]>=v);return ['kw='+K,'rendered='+titles.length,'titleHit='+levels.filter(x=>x===2).length,'descOnly='+levels.filter(x=>x===1).length,'levels='+levels.join(','),'correctOrder='+correct].join(' ');})()" 2>&1 | tail -1 | tr -d '"')
log "RELEVANCE_RESULT=$RES"

# ---- 3. 价格区间校验提示（最低价 9999 > 最高价 1）----
agent-browser open "$URL/" >/dev/null 2>&1
sleep 1.5
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));if(b)b.click();return 'expanded';})()" >/dev/null 2>&1
sleep 1.0
agent-browser eval "(()=>{const set=(el,val)=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));};const nums=[...document.querySelectorAll('input[type=number]')];if(nums[0])set(nums[0],'9999');if(nums[1])set(nums[1],'1');return 'set '+nums.length;})()" >/dev/null 2>&1
sleep 1.2
PRICE=$(agent-browser eval "(()=>{const t=document.body.innerText;return ['inlineHint='+t.includes('最低价不能高于最高价'),'emptyTitle='+t.includes('价格区间设置有误'),'cardsRendered='+[...document.querySelectorAll('.cm-fade-in')].length].join(' ');})()" 2>&1 | tail -1 | tr -d '"')
log "PRICE_RESULT=$PRICE"

agent-browser screenshot "$PROJ/qa-tests/screenshots/relevance-verify.png" >/dev/null 2>&1
agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log "DONE"
