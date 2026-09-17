#!/bin/bash
# 校园集市 · Round 2（修正版）：真实鼠标事件驱动 MUI 组件 + main 作用域输入框
set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
SHOT="$PROJ/qa-tests/screenshots"
LOG="$PROJ/qa-tests/e2e3.log"
: > "$LOG"
log(){ echo "$@" | tee -a "$LOG"; }
step(){ echo "" | tee -a "$LOG"; echo "########## $* ##########" | tee -a "$LOG"; }
ab(){ agent-browser "$@" 2>&1 | tee -a "$LOG"; }
ev(){ agent-browser eval "$1" 2>&1 | tee -a "$LOG"; }
shot(){ agent-browser screenshot "$1" >/dev/null 2>&1; echo "[shot] $1" | tee -a "$LOG"; }
S='const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;d.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};const setT=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;d.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};'

step "启动 dev server"
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5175 --host 127.0.0.1 >/tmp/vite-e2e3.log 2>&1 &
VPID=$!
CODE=""
for i in $(seq 1 80); do CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5175/ 2>/dev/null); [ "$CODE" = "200" ] && break; sleep 0.5; done
log "dev server http=$CODE pid=$VPID"
[ "$CODE" != "200" ] && { log "SERVER FAILED"; exit 1; }
B="http://127.0.0.1:5175"

ab open "$B/"
sleep 1.0
ev "(()=>{Object.keys(localStorage).filter(k=>k.startsWith('campus_market_')).forEach(k=>localStorage.removeItem(k));return 'cleared'})()"
ab open "$B/"
sleep 1.5
ev "JSON.stringify({products:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.length})"

# ---------- 排序（真实鼠标事件） ----------
step "排序：价格升 / 价格降 / 最多浏览 / 最新"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));b.click();return 'expanded'})()"
sleep 0.7
ab find text "最新发布" click
sleep 0.6
ab find text "价格从低到高" click
sleep 1.0
ev "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/r3-01-sort-asc.png"
ab find text "价格从低到高" click
sleep 0.6
ab find text "价格从高到低" click
sleep 1.0
ev "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/r3-02-sort-desc.png"
ab find text "价格从高到低" click
sleep 0.6
ab find text "最多浏览" click
sleep 1.0
ev "JSON.stringify({views:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.textContent.match(/(\\d+)\\s*$/)?.[1])})"
shot "$SHOT/r3-03-sort-views.png"
ab find text "最多浏览" click
sleep 0.6
ab find text "最新发布" click
sleep 1.0
ev "JSON.stringify({first3:[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent).slice(0,3)})"

# ---------- 校区 + 成色筛选 ----------
step "筛选：校区 = 东校区"
ab find text "全部校区" click
sleep 0.6
ab find text "东校区" click
sleep 1.0
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,allEast:[...document.querySelectorAll('.cm-fade-in')].every(c=>c.textContent.includes('东校区'))})"
shot "$SHOT/r3-04-filter-campus.png"
step "筛选：成色 = 全新"
ab find text "全部成色" click
sleep 0.6
ab find text "全新" click
sleep 1.0
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,allNew:[...document.querySelectorAll('.cm-fade-in')].every(c=>c.textContent.includes('全新'))})"
shot "$SHOT/r3-05-filter-condition.png"

# ---------- 登录：错误密码 ----------
step "登录：错误密码 → 提示「密码错误」"
ab open "$B/login"
sleep 1.0
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021001');set(ins[1],'wrongpass');return ins.length})()"
ev "(()=>{const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({path:location.pathname,toast:[...document.querySelectorAll('.MuiAlert-message')].map(e=>e.textContent)})"
shot "$SHOT/r3-06-login-wrong.png"

step "登录：账号不存在"
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'9999999');set(ins[1],'whatever');return 'ok'})()"
ev "(()=>{const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({toast:[...document.querySelectorAll('.MuiAlert-message')].map(e=>e.textContent)})"

# ---------- 注册 ----------
step "注册新账号 B（自动登录）"
ab open "$B/register"
sleep 1.0
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021999');set(ins[1],'QA买家');set(ins[2],'abc123');set(ins[3],'abc123');set(ins[4],'13800002222');return ins.length})()"
ev "(()=>{const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.includes('注册并登录'));b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({path:location.pathname,users:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.length,currentUserId:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId,accounts:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.map(u=>u.account)})"
shot "$SHOT/r3-07-register.png"

step "注册校验：密码不足 6 位"
ab open "$B/register"
sleep 1.0
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021888');set(ins[1],'短密码用户');set(ins[2],'123');set(ins[3],'123');return 'ok'})()"
ev "(()=>{const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.includes('注册并登录'));b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({toast:[...document.querySelectorAll('.MuiAlert-message')].map(e=>e.textContent),users:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.length})"

# ---------- 买家下单（B 购买 demo 的 p13） ----------
step "买家 B 下单购买 demo 的商品"
ab open "$B/login"
sleep 1.0
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021999');set(ins[1],'abc123');const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({currentUserId:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"
ab open "$B/product/p13"
sleep 1.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('我想要'));b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({orders:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.map(o=>o.buyerId+'>'+o.sellerId+':'+o.status),p13:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='p13').status})"
shot "$SHOT/r3-08-buyer-order.png"

# ---------- 卖家 demo 确认 → 交易中 → 已完成 ----------
step "卖家 demo：确认交易 → 交易中 → 完成交易"
ab open "$B/profile"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('退出登录'));b.click();return 'clicked'})()"
sleep 1.0
ab open "$B/login"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('一键体验账号'));b.click();return 'clicked'})()"
sleep 1.5
ab open "$B/profile/orders"
sleep 1.3
ab find text "我卖出的" click
sleep 1.0
ev "JSON.stringify({chips:[...document.querySelectorAll('.MuiChip-label')].map(c=>c.textContent)})"
shot "$SHOT/r3-09-sell-orders.png"
ab find text "确认交易" click
sleep 1.2
ev "JSON.stringify({status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13')?.status})"
shot "$SHOT/r3-10-trading.png"
ab find text "完成交易" click
sleep 1.2
ev "JSON.stringify({status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13')?.status,p13:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='p13').status})"
shot "$SHOT/r3-11-done.png"

step "卖家评价买家"
ab find text "评价买家" click
sleep 0.8
ev "(()=>{$S const ta=[...document.querySelectorAll('.MuiDialog-root textarea')][0];setT(ta,'卖家评价：买家很爽快，交易顺利');const b=[...document.querySelectorAll('.MuiDialog-root button')].find(x=>x.textContent.includes('提交评价'));b.click();return 'submitted'})()"
sleep 1.2
ev "JSON.stringify({sellerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13')?.sellerReview})"
shot "$SHOT/r3-12-seller-review.png"

# ---------- 买家评价卖家 ----------
step "买家 B：评价卖家"
ab open "$B/profile"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('退出登录'));b.click();return 'clicked'})()"
sleep 1.0
ab open "$B/login"
sleep 1.0
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];set(ins[0],'2021999');set(ins[1],'abc123');const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');b.click();return 'clicked'})()"
sleep 1.5
ab open "$B/profile/orders"
sleep 1.3
ab find text "评价卖家" click
sleep 0.8
ev "(()=>{$S const ta=[...document.querySelectorAll('.MuiDialog-root textarea')][0];setT(ta,'买家评价：卖家很好，物美价廉');const b=[...document.querySelectorAll('.MuiDialog-root button')].find(x=>x.textContent.includes('提交评价'));b.click();return 'submitted'})()"
sleep 1.2
ev "JSON.stringify({buyerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13')?.buyerReview,sellerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.find(o=>o.productId==='p13')?.sellerReview})"
shot "$SHOT/r3-13-buyer-review.png"

# ---------- 价格校验 ----------
step "发布校验：价格 0 / 负数 / 超限"
ab open "$B/publish"
sleep 1.3
ev "(()=>{$S const title=[...document.querySelectorAll('main input')].find(e=>e.placeholder&&e.placeholder.includes('iPhone'));set(title,'QA 校验测试标题占位');const desc=[...document.querySelectorAll('main textarea')][0];setT(desc,'这是一段足够长的商品描述，超过十个字，用于通过描述校验。');document.querySelector('[aria-label=\"选择图片 1\"]').click();return 'ok'})()"
sleep 0.4
ev "(()=>{$S const nums=[...document.querySelectorAll('main input[type=number]')];set(nums[0],'0');return 'set0'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({price0:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
ev "(()=>{$S const nums=[...document.querySelectorAll('main input[type=number]')];set(nums[0],'-5');return 'neg'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({neg:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
ev "(()=>{$S const nums=[...document.querySelectorAll('main input[type=number]')];set(nums[0],'2000000');return 'big'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({big:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
shot "$SHOT/r3-14-price-validation.png"

step "发布校验：标题过短 / 描述过短 / 未选图片"
ab open "$B/publish"
sleep 1.3
ev "(()=>{$S const ins=[...document.querySelectorAll('main input')];const title=[...document.querySelectorAll('main input')].find(e=>e.placeholder&&e.placeholder.includes('iPhone'));set(title,'短');const desc=[...document.querySelectorAll('main textarea')][0];setT(desc,'太短');return 'ok'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({errs:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent),imgErr:[...document.querySelectorAll('span,p')].map(e=>e.textContent).filter(t=>t&&t.includes('请至少选择一张商品图片'))})"
shot "$SHOT/r3-15-other-validation.png"

# ---------- 超长文本 ----------
step "超长文本：200 字标题"
ab open "$B/publish"
sleep 1.3
ev "(()=>{$S const title=[...document.querySelectorAll('main input')].find(e=>e.placeholder&&e.placeholder.includes('iPhone'));set(title,'超长标题'.repeat(50));const desc=[...document.querySelectorAll('main textarea')][0];setT(desc,'描述'.repeat(60));const nums=[...document.querySelectorAll('main input[type=number]')];set(nums[0],'10');document.querySelector('[aria-label=\"选择图片 1\"]').click();return 'ok'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({path:location.pathname,titleLen:document.querySelector('h1')?.textContent.length})"
shot "$SHOT/r3-16-longtext.png"

step "收尾"
ab close --all
kill $VPID 2>/dev/null
wait $VPID 2>/dev/null
log "DONE"
