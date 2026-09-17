set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
L="$PROJ/qa-tests/lifecycle.log"; : > "$L"
log(){ echo "$@" | tee -a "$L"; }
step(){ echo "" | tee -a "$L"; echo "##### $* #####" | tee -a "$L"; }
ev(){ agent-browser eval "$1" 2>&1 | tee -a "$L"; }
refof(){ agent-browser snapshot -i 2>/dev/null | grep "$1" | grep -oE "ref=e[0-9]+" | head -1 | sed 's/ref=//'; }
clickr(){ R=$(refof "$1"); log "click '$1' @$R"; agent-browser click "@$R" 2>&1 | tee -a "$L"; }
S='const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;d.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};const setT=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;d.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};'
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5181 --host 127.0.0.1 >/tmp/vite-life.log 2>&1 &
V=$!
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5181/); [ "$c" = 200 ] && break; sleep 0.5; done
log "http=$c"
B="http://127.0.0.1:5181"
agent-browser open "$B/" >/dev/null 2>&1; sleep 1
ev "(()=>{Object.keys(localStorage).filter(k=>k.startsWith('campus_market_')).forEach(k=>localStorage.removeItem(k));return 'cleared'})()"
agent-browser open "$B/" >/dev/null 2>&1; sleep 1.5

step "注册买家 B"
agent-browser open "$B/register" >/dev/null 2>&1; sleep 1.2
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021777');set(ins[1],'QA买家B');set(ins[2],'abc123');set(ins[3],'abc123');set(ins[4],'13800003333');return 'filled'})()"
clickr "注册并登录"
sleep 1.5
ev "JSON.stringify({uid:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"

step "B 下单 p13"
agent-browser open "$B/product/p13" >/dev/null 2>&1; sleep 1.3
clickr "我想要"
sleep 1.5
ev "JSON.stringify({order:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13'),p13:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='p13').status})"

step "切换到 demo（卖家）"
agent-browser open "$B/profile" >/dev/null 2>&1; sleep 1.2
clickr "退出登录"
sleep 1.2
agent-browser open "$B/login" >/dev/null 2>&1; sleep 1.2
clickr "一键体验账号"
sleep 1.5
ev "JSON.stringify({uid:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"

step "我卖出的 → 确认交易（交易中）"
agent-browser open "$B/profile/orders" >/dev/null 2>&1; sleep 1.4
clickr "我卖出的"
sleep 1.2
ev "JSON.stringify({chips:[...document.querySelectorAll('.MuiChip-label')].map(c=>c.textContent)})"
clickr "确认交易"
sleep 1.4
ev "JSON.stringify({status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13').status})"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-22-trading.png" >/dev/null 2>&1

step "完成交易（已完成）"
clickr "完成交易"
sleep 1.4
ev "JSON.stringify({status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13').status,p13:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='p13').status})"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-23-completed.png" >/dev/null 2>&1

step "卖家评价买家"
clickr "评价买家"
sleep 1.0
ev "(()=>{$S const ta=[...document.querySelectorAll('.MuiDialog-root textarea')][0];if(!ta)return 'no-ta';setT(ta,'卖家评价：买家很爽快，交易顺利');const b=[...document.querySelectorAll('.MuiDialog-root button')].find(x=>x.textContent.includes('提交评价'));b.click();return 'submitted'})()"
sleep 1.2
ev "JSON.stringify({sellerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13').sellerReview})"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-24-seller-review.png" >/dev/null 2>&1

step "切换回 B → 评价卖家"
agent-browser open "$B/profile" >/dev/null 2>&1; sleep 1.2
clickr "退出登录"
sleep 1.2
agent-browser open "$B/login" >/dev/null 2>&1; sleep 1.2
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021777');set(ins[1],'abc123');const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');b.click();return 'login-clicked'})()"
sleep 1.5
ev "JSON.stringify({uid:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"
agent-browser open "$B/profile/orders" >/dev/null 2>&1; sleep 1.4
clickr "评价卖家"
sleep 1.0
ev "(()=>{$S const ta=[...document.querySelectorAll('.MuiDialog-root textarea')][0];if(!ta)return 'no-ta';setT(ta,'买家评价：卖家很好，物美价廉');const b=[...document.querySelectorAll('.MuiDialog-root button')].find(x=>x.textContent.includes('提交评价'));b.click();return 'submitted'})()"
sleep 1.2
ev "JSON.stringify({buyerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13').buyerReview,sellerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13').sellerReview})"
agent-browser screenshot "$PROJ/qa-tests/screenshots/r3-25-both-reviews.png" >/dev/null 2>&1

agent-browser close --all >/dev/null 2>&1
kill $V 2>/dev/null; wait $V 2>/dev/null
log DONE
