set +e
# ============================================================
# QA 增量回归验证脚本（严过关）
# 覆盖：构建/单元回归之外的真实 DOM 行为验证
#   - 默认排序回归（无关键词 = createdAt 降序）
#   - 显式排序不被相关性加权干预（价格升/降、最多浏览）
#   - 分类/校区/成色筛选回归
#   - 搜索相关性（标题命中优先于仅描述命中）— 自建关键词
#   - 价格区间校验（内联提示 + 定制空状态）+ 价格过滤逻辑未变
#   - 边界：min==max / 只填一项 / 填 0 / 纯空白关键词 / 标题+描述双命中
#   - 主链路：注册登录 / 商品详情 / 下单 / 个人中心 / 体验账号登录
# ============================================================
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
SHOT="$PROJ/qa-tests/screenshots"
L="$PROJ/qa-tests/qa-verify-increment.log"; : > "$L"
PASS=0; FAIL=0
log(){ echo "$@" | tee -a "$L"; }
step(){ echo "" | tee -a "$L"; echo "##### $* #####" | tee -a "$L"; }
ev(){ agent-browser eval "$1" 2>&1 | tail -1 | sed 's/^"//; s/"$//'; }
judge(){ local label="$1" v="$2"; case "$v" in PASS*) PASS=$((PASS+1)); log "[PASS] $label | $v";; INFO*) log "[INFO] $label | $v";; *) FAIL=$((FAIL+1)); log "[FAIL] $label | $v";; esac; }
# 判断纯布尔型返回值（如 asc=true）
judge_has(){ local label="$1" v="$2" want="$3"; case "$v" in *"$want"*) PASS=$((PASS+1)); log "[PASS] $label | $v";; *) FAIL=$((FAIL+1)); log "[FAIL] $label | (want $want) | $v";; esac; }

PORT=5191
B="http://127.0.0.1:$PORT"
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port $PORT --host 127.0.0.1 >/tmp/vite-qa2.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" "$B/"); [ "$c" = 200 ] && break; sleep 0.5; done
log "HTTP=$c  URL=$B"

# ---- 清空 localStorage 并让种子数据重新初始化 ----
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{Object.keys(localStorage).filter(k=>k.indexOf("campus_market_")===0).forEach(k=>localStorage.removeItem(k));return "cleared";})()' >/dev/null
agent-browser open "$B/" >/dev/null 2>&1; sleep 2

step "T1 种子数据完整性"
judge "T1 seed" "$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1")||"null");if(!st)return "FAIL|no market storage";const a=st.products;return "INFO|products="+a.length+" notDelisted="+a.filter(p=>p.status!=="已下架").length+" onSale="+a.filter(p=>p.status==="在售").length;})()')"

step "T2 回归：无关键词时默认排序 = createdAt 降序"
judge "T2 no-keyword createdAt desc" "$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const exp=st.products.filter(p=>p.status!=="已下架").slice().sort((a,b)=>b.createdAt-a.createdAt).map(p=>p.title);const got=[...document.querySelectorAll(".cm-fade-in h3")].map(h=>h.textContent.trim());const same=got.length===exp.length&&got.every((t,i)=>t===exp[i]);return (same?"PASS":"FAIL")+"|noKw createdAtDesc n="+got.length+" expected="+exp.length;})()')"

step "T3 回归：显式排序严格单调（相关性加权不得干预）"
# 展开筛选，记录 combobox 顺序
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(!b)return "FAIL|no expand";b.click();return "OK|expand";})()' >/dev/null
sleep 1.2
log "comboboxes=$(ev '(()=>{return [...document.querySelectorAll("[role=combobox]")].map((c,i)=>i+":"+c.textContent.trim()).join(" | ");})()')"

# T3a 价格从低到高
ev '(()=>{window.__idx=2;return "idx2";})()' >/dev/null
ev '(()=>{const t=[...document.querySelectorAll("[role=combobox]")][window.__idx];if(!t)return "FAIL";t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));t.click();return "OK";})()' >/dev/null
sleep 1.0
ev '(()=>{const o=[...document.querySelectorAll("li[role=option]")].find(x=>x.textContent.trim().indexOf("价格从低到高")>=0);if(!o)return "FAIL|noopt";o.click();return "OK";})()' >/dev/null
sleep 1.2
judge_has "T3a priceAsc monotonic" "$(ev '(()=>{const ps=[...document.querySelectorAll(".cm-fade-in .text-brand-600")].map(e=>Number(e.textContent.replace(/[^0-9.]/g,"")));let asc=true;for(let i=1;i<ps.length;i++){if(ps[i-1]>ps[i])asc=false;}return "n="+ps.length+" asc="+asc+" prices="+ps.join(",");})()')" "asc=true"

# T3b 价格从高到低
ev '(()=>{const t=[...document.querySelectorAll("[role=combobox]")][2];t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));t.click();return "OK";})()' >/dev/null
sleep 1.0
ev '(()=>{const o=[...document.querySelectorAll("li[role=option]")].find(x=>x.textContent.trim().indexOf("价格从高到低")>=0);if(!o)return "FAIL|noopt";o.click();return "OK";})()' >/dev/null
sleep 1.2
judge_has "T3b priceDesc monotonic" "$(ev '(()=>{const ps=[...document.querySelectorAll(".cm-fade-in .text-brand-600")].map(e=>Number(e.textContent.replace(/[^0-9.]/g,"")));let desc=true;for(let i=1;i<ps.length;i++){if(ps[i-1]<ps[i])desc=false;}return "n="+ps.length+" desc="+desc+" prices="+ps.join(",");})()')" "desc=true"

# T3c 最多浏览
ev '(()=>{const t=[...document.querySelectorAll("[role=combobox]")][2];t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));t.click();return "OK";})()' >/dev/null
sleep 1.0
ev '(()=>{const o=[...document.querySelectorAll("li[role=option]")].find(x=>x.textContent.trim().indexOf("最多浏览")>=0);if(!o)return "FAIL|noopt";o.click();return "OK";})()' >/dev/null
sleep 1.2
judge_has "T3c views non-increasing" "$(ev '(()=>{const cards=[...document.querySelectorAll(".cm-fade-in")];const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const byT={};st.products.forEach(p=>byT[p.title]=p);const vs=cards.map(c=>{const t=c.querySelector("h3").textContent.trim();return byT[t]?byT[t].views:-1;});let desc=true;for(let i=1;i<vs.length;i++){if(vs[i-1]<vs[i])desc=false;}return "n="+vs.length+" viewsNonIncr="+desc+" views="+vs.join(",");})()')" "viewsNonIncr=true"

step "T3d 关键词存在时显式排序仍不被加权干预（价格升序严格单调）"
# 运行时挑选一个命中数最多的关键词，保证用例非空
KW3R=$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const prods=st.products.filter(p=>p.status!=="已下架");let best=null;const seen=new Set();prods.forEach(p=>{for(let n=2;n<=3;n++){for(let i=0;i+n<=p.title.length;i++){const s=p.title.slice(i,i+n);if(seen.has(s))continue;seen.add(s);const L=s.toLowerCase();const m=prods.filter(q=>q.title.toLowerCase().includes(L)||q.description.toLowerCase().includes(L)).length;if(!best||m>best.m)best={s,m};}}});return best?("INFO|kw3="+best.s+" matched="+best.m):"FAIL|none";})()')
judge "T3d pick-keyword" "$KW3R"
KW3=$(printf '%s' "$KW3R" | sed -n 's/.*kw3=\([^ ]*\).*/\1/p')
KW3ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]||""))' "$KW3")
agent-browser open "$B/?keyword=$KW3ENC" >/dev/null 2>&1; sleep 2.2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const t=[...document.querySelectorAll("[role=combobox]")][2];if(!t)return "FAIL";t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));t.click();return "OK";})()' >/dev/null
sleep 1.0
ev '(()=>{const o=[...document.querySelectorAll("li[role=option]")].find(x=>x.textContent.trim().indexOf("价格从低到高")>=0);if(!o)return "FAIL|noopt";o.click();return "OK";})()' >/dev/null
sleep 1.2
judge_has "T3d kw+priceAsc monotonic" "$(ev '(()=>{const ps=[...document.querySelectorAll(".cm-fade-in .text-brand-600")].map(e=>Number(e.textContent.replace(/[^0-9.]/g,"")));let asc=true;for(let i=1;i<ps.length;i++){if(ps[i-1]>ps[i])asc=false;}return "n="+ps.length+" asc="+asc+" prices="+ps.join(",");})()')" "asc=true"

step "T4 回归：分类筛选（数码电子）"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 0.8
ev '(()=>{window.__kind="cat";window.__exp="数码电子";return "set";})()' >/dev/null
ev '(()=>{const c=[...document.querySelectorAll(".no-scrollbar .MuiChip-root")].find(x=>x.textContent.trim()==="数码电子");if(!c)return "FAIL|nochip";c.click();return "OK";})()' >/dev/null
sleep 1.2
judge "T4 category filter" "$(ev '(()=>{const exp="数码电子";const cards=[...document.querySelectorAll(".cm-fade-in")];const vals=cards.map(c=>[...c.querySelectorAll(".MuiChip-label")].map(e=>e.textContent.trim())[1]);const all=vals.every(v=>v===exp);return (all&&vals.length>0?"PASS":"FAIL")+"|exp="+exp+" n="+vals.length+" uniq="+[...new Set(vals)].join("/");})()')"
agent-browser screenshot "$SHOT/qa2-T4-category.png" >/dev/null 2>&1

step "T5 回归：校区筛选（东校区）"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const t=[...document.querySelectorAll("[role=combobox]")][0];if(!t)return "FAIL";t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));t.click();return "OK";})()' >/dev/null
sleep 1.0
ev '(()=>{const o=[...document.querySelectorAll("li[role=option]")].find(x=>x.textContent.trim().indexOf("东校区")>=0);if(!o)return "FAIL|noopt";o.click();return "OK";})()' >/dev/null
sleep 1.2
judge "T5 campus filter" "$(ev '(()=>{const exp="东校区";const cards=[...document.querySelectorAll(".cm-fade-in")];const vals=cards.map(c=>[...c.querySelectorAll(".MuiChip-label")].map(e=>e.textContent.trim())[0]);const all=vals.every(v=>v===exp);return (all&&vals.length>0?"PASS":"FAIL")+"|exp="+exp+" n="+vals.length+" uniq="+[...new Set(vals)].join("/");})()')"

step "T6 回归：成色筛选（全新）"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const t=[...document.querySelectorAll("[role=combobox]")][1];if(!t)return "FAIL";t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));t.click();return "OK";})()' >/dev/null
sleep 1.0
ev '(()=>{const o=[...document.querySelectorAll("li[role=option]")].find(x=>x.textContent.trim()==="全新");if(!o)return "FAIL|noopt";o.click();return "OK";})()' >/dev/null
sleep 1.2
judge "T6 condition filter" "$(ev '(()=>{const exp="全新";const cards=[...document.querySelectorAll(".cm-fade-in")];const vals=cards.map(c=>{const s=c.querySelector("span.text-white");return s?s.textContent.trim():"";});const all=vals.every(v=>v===exp);return (all&&vals.length>0?"PASS":"FAIL")+"|exp="+exp+" n="+vals.length+" uniq="+[...new Set(vals)].join("/");})()')"

step "T7 新行为：搜索相关性（自建关键词，标题命中优先）"
FIND=$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const prods=st.products.filter(p=>p.status!=="已下架");const cands=new Set();prods.forEach(p=>{const t=p.title;for(let n=2;n<=4;n++){for(let i=0;i+n<=t.length;i++){const s=t.slice(i,i+n);if(/\s/.test(s))continue;cands.add(s);}}});let best=null;cands.forEach(g=>{const L=g.toLowerCase();if(L==="le")return;const titleHit=prods.filter(p=>p.title.toLowerCase().includes(L)).length;const descOnly=prods.filter(p=>!p.title.toLowerCase().includes(L)&&p.description.toLowerCase().includes(L)).length;if(titleHit<1||descOnly<1)return;const matched=prods.filter(p=>p.title.toLowerCase().includes(L)||p.description.toLowerCase().includes(L));const naive=matched.slice().sort((a,b)=>b.createdAt-a.createdAt);let seenOne=false,wrong=false;naive.forEach(p=>{const lv=p.title.toLowerCase().includes(L)?2:1;if(lv===1)seenOne=true;else if(seenOne)wrong=true;});const score=(wrong?1000000:0)+(matched.length<=6?10000:0)+titleHit*100-matched.length*10+g.length;if(!best||score>best.score)best={g,titleHit,descOnly,matched:matched.length,wrong,score};});if(!best)return "FAIL|no keyword candidate";return "INFO|kw="+best.g+" titleHits="+best.titleHit+" descOnly="+best.descOnly+" matched="+best.matched+" naiveWouldBeWrong="+best.wrong;})()')
judge "T7 find-keyword" "$FIND"
KW=$(printf '%s' "$FIND" | sed -n 's/.*kw=\([^ ]*\).*/\1/p')
log "chosen keyword=[$KW]"
if [ -n "$KW" ]; then
  KENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]||""))' "$KW")
  agent-browser open "$B/?keyword=$KENC" >/dev/null 2>&1; sleep 2.2
  judge "T7 relevance order" "$(ev '(()=>{const K=(new URLSearchParams(location.search).get("keyword")||"").trim().toLowerCase();const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const byT={};st.products.forEach(p=>byT[p.title]=p);const cards=[...document.querySelectorAll(".cm-fade-in")];const rows=cards.map(c=>{const t=c.querySelector("h3").textContent.trim();const p=byT[t];return {lvl:p?(p.title.toLowerCase().includes(K)?2:1):-1,ca:p?p.createdAt:0};});let seenOne=false,orderOk=true;rows.forEach(r=>{if(r.lvl===1)seenOne=true;else if(r.lvl===2&&seenOne)orderOk=false;});let withinOk=true;for(let i=1;i<rows.length;i++){if(rows[i-1].lvl===rows[i].lvl&&rows[i-1].ca<rows[i].ca)withinOk=false;}const l2=rows.filter(r=>r.lvl===2).length,l1=rows.filter(r=>r.lvl===1).length;return ((orderOk&&withinOk&&l2>0&&l1>0)?"PASS":"FAIL")+"|kw="+K+" n="+rows.length+" l2(title)="+l2+" l1(descOnly)="+l1+" orderOk="+orderOk+" withinLevelCreatedAtDesc="+withinOk+" levels="+rows.map(r=>r.lvl).join(",");})()')"
  agent-browser screenshot "$SHOT/qa2-T7-relevance.png" >/dev/null 2>&1
else
  judge "T7 relevance order" "FAIL|no keyword"
fi

step "T7b 边界：标题与描述同时命中的商品，等级应为 2（非 1）"
KB=$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const prods=st.products.filter(p=>p.status!=="已下架");const cands=new Set();prods.forEach(p=>{const t=p.title;for(let n=2;n<=3;n++){for(let i=0;i+n<=t.length;i++)cands.add(t.slice(i,i+n));}});let hit=null;cands.forEach(g=>{const L=g.toLowerCase();const both=prods.filter(p=>p.title.toLowerCase().includes(L)&&p.description.toLowerCase().includes(L)).length;const descOnly=prods.filter(p=>!p.title.toLowerCase().includes(L)&&p.description.toLowerCase().includes(L)).length;if(both>=1&&descOnly>=1){if(!hit||both+descOnly<hit.tot)hit={g,both,descOnly,tot:both+descOnly};}});return hit?("INFO|kwBoth="+hit.g+" both="+hit.both+" descOnly="+hit.descOnly):"INFO|kwBoth=NONE";})()')
judge "T7b find-both-keyword" "$KB"
KBW=$(printf '%s' "$KB" | sed -n 's/.*kwBoth=\([^ ]*\).*/\1/p')
if [ -n "$KBW" ] && [ "$KBW" != "NONE" ]; then
  KBENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]||""))' "$KBW")
  agent-browser open "$B/?keyword=$KBENC" >/dev/null 2>&1; sleep 2.2
  judge "T7b both-hit level=2" "$(ev '(()=>{const K=(new URLSearchParams(location.search).get("keyword")||"").trim().toLowerCase();const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const both=st.products.filter(p=>p.title.toLowerCase().includes(K)&&p.description.toLowerCase().includes(K));if(both.length<1)return "FAIL|no both-hit product";const cards=[...document.querySelectorAll(".cm-fade-in")];const titles=cards.map(c=>c.querySelector("h3").textContent.trim());const idx=titles.indexOf(both[0].title);if(idx<0)return "FAIL|both product not rendered";const lvls=titles.map(t=>{const p=st.products.find(x=>x.title===t);return p.title.toLowerCase().includes(K)?2:1;});let seenOne=false,ok=true;lvls.forEach(l=>{if(l===1)seenOne=true;else if(l===2&&seenOne)ok=false;});return ((lvls[idx]===2&&ok)?"PASS":"FAIL")+"|kw="+K+" bothProduct="+both[0].title+" renderedIdx="+idx+" itsLevel=2-by-title orderOk="+ok+" levels="+lvls.join(",");})()')"
else
  judge "T7b both-hit level=2" "INFO|skip (no both-hit keyword)"
fi

step "T8 边界：纯空白关键词（应等价无关键词 = createdAt 降序，全部展示）"
agent-browser open "$B/?keyword=%20%20%20" >/dev/null 2>&1; sleep 2.2
judge "T8 whitespace keyword" "$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const exp=st.products.filter(p=>p.status!=="已下架").slice().sort((a,b)=>b.createdAt-a.createdAt).map(p=>p.title);const got=[...document.querySelectorAll(".cm-fade-in h3")].map(h=>h.textContent.trim());const same=got.length===exp.length&&got.every((t,i)=>t===exp[i]);return (same?"PASS":"FAIL")+"|whitespaceKw n="+got.length+" createdAtDesc="+same;})()')"

step "T9 价格区间校验：min>max 时内联提示 + 定制空状态均出现"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{window.__min="9999";window.__max="1";return "set";})()' >/dev/null
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];if(nums.length<2)return "FAIL";const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"9999");ap(nums[1],"1");return "OK";})()' >/dev/null
sleep 1.2
R9=$(ev '(()=>{const cards=document.querySelectorAll(".cm-fade-in").length;const helpers=[...document.querySelectorAll(".MuiFormHelperText-root")].map(e=>e.textContent.trim());const errs=document.querySelectorAll(".Mui-error").length;const body=document.body.innerText;return "cards="+cards+" errs="+errs+" helper="+helpers.join("|")+" priceEmptyTitle="+body.includes("价格区间设置有误")+" priceEmptyDesc="+body.includes("请调整价格区间后再试");})()')
log "T9 detail: $R9"
case "$R9" in *"priceEmptyTitle=true"*"priceEmptyDesc=true"*) P1=PASS;; *) P1=FAIL;; esac
case "$R9" in *"helper=最低价不能高于最高价"*) P2=PASS;; *) P2=FAIL;; esac
judge "T9a custom empty state" "$P1|$R9"
judge "T9b inline helperText + error" "$P2|$R9"
agent-browser screenshot "$SHOT/qa2-T9-price-invalid.png" >/dev/null 2>&1

step "T10 价格过滤逻辑未变：min=50 / max=200 正常区间"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];if(nums.length<2)return "FAIL";const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"50");ap(nums[1],"200");return "OK";})()' >/dev/null
sleep 1.2
judge "T10 price filter 50-200" "$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const exp=st.products.filter(p=>p.status!=="已下架"&&p.price>=50&&p.price<=200).length;const ps=[...document.querySelectorAll(".cm-fade-in .text-brand-600")].map(e=>Number(e.textContent.replace(/[^0-9.]/g,"")));const allIn=ps.every(v=>v>=50&&v<=200);const noErr=document.querySelectorAll(".Mui-error").length===0;return ((allIn&&ps.length===exp&&noErr)?"PASS":"FAIL")+"|n="+ps.length+" expected="+exp+" allInRange="+allIn+" noErrorState="+noErr+" prices="+ps.join(",");})()')"
agent-browser screenshot "$SHOT/qa2-T10-price-normal.png" >/dev/null 2>&1

step "T11 边界：min==max（100/100）不应判为无效"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"100");ap(nums[1],"100");return "OK";})()' >/dev/null
sleep 1.2
judge "T11 min==max not invalid" "$(ev '(()=>{const errs=document.querySelectorAll(".Mui-error").length;const helpers=[...document.querySelectorAll(".MuiFormHelperText-root")].length;const body=document.body.innerText;return ((errs===0&&helpers===0&&!body.includes("价格区间设置有误"))?"PASS":"FAIL")+"|errs="+errs+" helpers="+helpers+" priceEmpty="+body.includes("价格区间设置有误");})()')"

step "T12 边界：只填最低价（max 空）不应判为无效"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"100");ap(nums[1],"");return "OK";})()' >/dev/null
sleep 1.2
judge "T12 only-min not invalid" "$(ev '(()=>{const errs=document.querySelectorAll(".Mui-error").length;const helpers=[...document.querySelectorAll(".MuiFormHelperText-root")].length;return ((errs===0&&helpers===0)?"PASS":"FAIL")+"|errs="+errs+" helpers="+helpers;})()')"

step "T13 边界：只填最高价（min 空）不应判为无效"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"");ap(nums[1],"100");return "OK";})()' >/dev/null
sleep 1.2
judge "T13 only-max not invalid" "$(ev '(()=>{const errs=document.querySelectorAll(".Mui-error").length;const helpers=[...document.querySelectorAll(".MuiFormHelperText-root")].length;return ((errs===0&&helpers===0)?"PASS":"FAIL")+"|errs="+errs+" helpers="+helpers;})()')"

step "T14 边界：min=0 / max=100 不应判为无效，且 0 参与过滤"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"0");ap(nums[1],"100");return "OK";})()' >/dev/null
sleep 1.2
judge "T14 min=0 not invalid + filter" "$(ev '(()=>{const errs=document.querySelectorAll(".Mui-error").length;const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const exp=st.products.filter(p=>p.status!=="已下架"&&p.price>=0&&p.price<=100).length;const ps=[...document.querySelectorAll(".cm-fade-in .text-brand-600")].map(e=>Number(e.textContent.replace(/[^0-9.]/g,"")));const allIn=ps.every(v=>v>=0&&v<=100);return ((errs===0&&allIn&&ps.length===exp)?"PASS":"FAIL")+"|errs="+errs+" n="+ps.length+" expected="+exp+" allInRange="+allIn;})()')"

step "T15 边界：min>max 后修正为正常区间，错误态应消失"
agent-browser open "$B/" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("筛选"));if(b)b.click();return "ok";})()' >/dev/null
sleep 1.0
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"5000");ap(nums[1],"10");return "OK";})()' >/dev/null
sleep 1.0
BAD=$(ev '(()=>{const errs=document.querySelectorAll(".Mui-error").length;const body=document.body.innerText;return "errs="+errs+" priceEmpty="+body.includes("价格区间设置有误");})()')
log "T15 step1 (min5000>max10): $BAD"
ev '(()=>{const nums=[...document.querySelectorAll("input[type=number]")];const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(nums[0],"10");ap(nums[1],"5000");return "OK";})()' >/dev/null
sleep 1.2
judge "T15 error clears after fix" "$(ev '(()=>{const errs=document.querySelectorAll(".Mui-error").length;const helpers=[...document.querySelectorAll(".MuiFormHelperText-root")].length;const body=document.body.innerText;return ((errs===0&&helpers===0&&!body.includes("价格区间设置有误"))?"PASS":"FAIL")+"|errs="+errs+" helpers="+helpers+" priceEmpty="+body.includes("价格区间设置有误");})()')"

step "T16 主链路回归：注册 / 详情 / 下单 / 个人中心 / 体验账号登录"
agent-browser open "$B/register" >/dev/null 2>&1; sleep 2
ev '(()=>{const ins=[...document.querySelectorAll("main input")];if(ins.length<5)return "FAIL|inputs="+ins.length;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;const ap=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};ap(ins[0],"2021901");ap(ins[1],"QA回归员");ap(ins[2],"abc123");ap(ins[3],"abc123");ap(ins[4],"13800009999");return "OK|n="+ins.length;})()' >/dev/null
sleep 0.6
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("注册"));if(!b)return "FAIL|no reg btn";b.click();return "OK";})()' >/dev/null
sleep 1.8
judge "T16a register + auto login" "$(ev '(()=>{const a=JSON.parse(localStorage.getItem("campus_market_auth_v1")||"null");return (a&&a.currentUserId)?"PASS|uid="+a.currentUserId:"FAIL|not logged in";})()')"

PID=$(ev '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const p=st.products.find(x=>x.status==="在售");return p?p.id:"NONE";})()')
log "T16 target product id=$PID"
agent-browser open "$B/product/$PID" >/dev/null 2>&1; sleep 2
judge "T16b detail page renders" "$(ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("我想要"));return b?"PASS|buy btn present":"FAIL|no buy btn";})()')"
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("我想要"));if(b)b.click();return "OK";})()' >/dev/null
sleep 1.6
JSORD=$(printf '(()=>{const st=JSON.parse(localStorage.getItem("campus_market_market_v1"));const o=st.orders.filter(x=>x.productId==="%s");return (o.length>0)?"PASS|orders="+o.length+" status="+o[o.length-1].status:"FAIL|no order";})()' "$PID")
judge "T16c place order" "$(ev "$JSORD")"

agent-browser open "$B/profile" >/dev/null 2>&1; sleep 2
judge "T16d profile page" "$(ev '(()=>{const t=document.body.innerText;return t.includes("退出登录")?"PASS|profile rendered":"FAIL|no logout";})()')"
agent-browser screenshot "$SHOT/qa2-T16-profile.png" >/dev/null 2>&1

agent-browser open "$B/login" >/dev/null 2>&1; sleep 2
ev '(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("一键体验"));if(b)b.click();return "OK";})()' >/dev/null
sleep 1.6
judge "T16e demo login" "$(ev '(()=>{const a=JSON.parse(localStorage.getItem("campus_market_auth_v1")||"null");return (a&&a.currentUserId)?"PASS|uid="+a.currentUserId:"FAIL|no login";})()')"

step "汇总"
log "PASS=$PASS FAIL=$FAIL"
log "DONE"

agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
