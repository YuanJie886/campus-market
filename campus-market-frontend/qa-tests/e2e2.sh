#!/bin/bash
# 校园集市 · Round 2：修正定位器 + 深度用例（搜索/排序/登录/注册/订单全流程/评价/校验）
set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
SHOT="$PROJ/qa-tests/screenshots"
LOG="$PROJ/qa-tests/e2e2.log"
: > "$LOG"
log(){ echo "$@" | tee -a "$LOG"; }
step(){ echo "" | tee -a "$LOG"; echo "########## $* ##########" | tee -a "$LOG"; }
ab(){ agent-browser "$@" 2>&1 | tee -a "$LOG"; }
ev(){ agent-browser eval "$1" 2>&1 | tee -a "$LOG"; }
shot(){ agent-browser screenshot "$1" >/dev/null 2>&1; echo "[shot] $1" | tee -a "$LOG"; }
setval='const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;d.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};const setT=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;d.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};'

# ---------- 启动 ----------
step "启动 dev server"
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5174 --host 127.0.0.1 >/tmp/vite-e2e2.log 2>&1 &
VPID=$!
CODE=""
for i in $(seq 1 80); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/ 2>/dev/null)
  [ "$CODE" = "200" ] && break
  sleep 0.5
done
log "dev server http=$CODE pid=$VPID"
[ "$CODE" != "200" ] && { log "SERVER FAILED"; cat /tmp/vite-e2e2.log | tee -a "$LOG"; exit 1; }
B="http://127.0.0.1:5174"

# ---------- 重置 localStorage ----------
step "重置 localStorage → 种子数据重新初始化"
ab open "$B/"
sleep 1.0
ev "(()=>{Object.keys(localStorage).filter(k=>k.startsWith('campus_market_')).forEach(k=>localStorage.removeItem(k));return 'cleared'})()"
ab open "$B/"
sleep 1.5
ev "JSON.stringify({products:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.length,users:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.length})"
step "种子结构快照（供报告）"
ev "JSON.stringify(JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.map(u=>({id:u.id,account:u.account,nickname:u.nickname,campus:u.campus})))"
ev "JSON.stringify({favs:JSON.parse(localStorage.getItem('campus_market_market_v1')).favorites.map(f=>f.userId+':'+f.productId),orders:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.map(o=>o.buyerId+'>'+o.sellerId+':'+o.status),convs:JSON.parse(localStorage.getItem('campus_market_market_v1')).conversations.length,comments:JSON.parse(localStorage.getItem('campus_market_market_v1')).comments.length,messages:JSON.parse(localStorage.getItem('campus_market_market_v1')).messages.length})"
ev "JSON.stringify({statusCount:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.reduce((a,p)=>{a[p.status]=(a[p.status]||0)+1;return a},{})})"
ev "JSON.stringify({u_demo_products:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.filter(p=>p.sellerId==='u_demo').map(p=>p.id+':'+p.title+':'+p.status)})"

# ---------- 搜索（修正定位） ----------
step "搜索：关键词命中（修正定位器）"
ev "(()=>{$setval const inp=[...document.querySelectorAll('input')].find(e=>e.placeholder&&e.placeholder.includes('搜索你想要的闲置好物'));if(!inp)return 'no-input';set(inp,'教材');const f=inp.closest('form');f.requestSubmit();return 'submitted'})()"
sleep 1.3
ev "JSON.stringify({url:location.search,cards:document.querySelectorAll('.cm-fade-in').length,count:[...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>t&&t.includes('件闲置'))})"
ev "JSON.stringify({titles:[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent)})"
shot "$SHOT/r2-01-search.png"

step "搜索：大小写不敏感 + 无结果空状态"
ev "(()=>{$setval const inp=[...document.querySelectorAll('input')].find(e=>e.placeholder&&e.placeholder.includes('搜索你想要的闲置好物'));set(inp,'IPHONE');inp.closest('form').requestSubmit();return 'ok'})()"
sleep 1.2
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,titles:[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent)})"
ev "(()=>{$setval const inp=[...document.querySelectorAll('input')].find(e=>e.placeholder&&e.placeholder.includes('搜索你想要的闲置好物'));set(inp,'zzz不存在zzz');inp.closest('form').requestSubmit();return 'ok'})()"
sleep 1.2
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,emptyText:[...document.querySelectorAll('h2,h3,div,p')].map(e=>e.textContent).find(t=>t&&t.includes('没有找到相关闲置'))||null})"
shot "$SHOT/r2-02-search-empty.png"

# ---------- 排序（修正 MUI Select） ----------
step "排序：最新 / 价格升 / 价格降 / 最多浏览"
ab open "$B/"
sleep 1.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));if(b)b.click();return !!b})()"
sleep 0.6
pick(){ # $1 当前值包含, $2 目标选项
  ev "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('$1'));if(!cb)return 'no-cb';cb.click();return 'opened'})()"
  sleep 0.5
  ev "(()=>{const o=[...document.querySelectorAll('li[role=option]')].find(x=>x.textContent.includes('$2'));if(!o)return 'no-opt';o.click();return 'picked'})()"
  sleep 1.0
}
pick "最新发布" "价格从低到高"
ev "JSON.stringify({sort:document.querySelector('[role=combobox][aria-labelledby]')?.textContent, prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/r2-03-sort-asc.png"
pick "价格从低到高" "价格从高到低"
ev "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/r2-04-sort-desc.png"
pick "价格从高到低" "最多浏览"
ev "JSON.stringify({views:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.textContent.match(/(\\d+)\\s*$/)?.[1])})"
shot "$SHOT/r2-05-sort-views.png"
pick "最多浏览" "最新发布"
ev "JSON.stringify({titles:[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent).slice(0,3)})"

# ---------- 筛选：校区 + 成色 + 价格区间 ----------
step "筛选：校区 + 成色 + 价格区间"
ev "(()=>{const cb=[...document.querySelectorAll('[role=combobox]')].find(c=>c.textContent.includes('全部校区'));cb.click();return 'opened'})()"
sleep 0.5
ev "(()=>{const o=[...document.querySelectorAll('li[role=option]')].find(x=>x.textContent.includes('东校区'));o.click();return 'picked'})()"
sleep 1.0
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,allEast:[...document.querySelectorAll('.cm-fade-in')].every(c=>c.textContent.includes('东校区'))})"
shot "$SHOT/r2-06-filter-campus.png"
ev "(()=>{$setval const nums=[...document.querySelectorAll('input[type=number]')];set(nums[0],'50');set(nums[1],'200');return 'range-set'})()"
sleep 1.0
ev "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/r2-07-filter-price.png"

# ---------- 登录：错误密码（修正按钮定位） ----------
step "登录：错误密码 → 报错提示"
ab open "$B/login"
sleep 1.0
ev "(()=>{$setval const ins=[...document.querySelectorAll('input')];set(ins[0],'2021001');set(ins[1],'wrongpass');return 'filled'})()"
ev "(()=>{const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({path:location.pathname,toast:[...document.querySelectorAll('.MuiAlert-message')].map(e=>e.textContent)})"
shot "$SHOT/r2-08-login-wrong.png"

# ---------- 注册新账号 ----------
step "注册新账号（自动登录）"
ab open "$B/register"
sleep 1.0
ev "(()=>{$setval const ins=[...document.querySelectorAll('input')];set(ins[0],'2021999');set(ins[1],'QA买家');set(ins[2],'abc123');set(ins[3],'abc123');set(ins[4],'13800002222');return ins.length})()"
ev "(()=>{const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.includes('注册并登录'));b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({path:location.pathname,users:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.length,currentUserId:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId,newUser:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.map(u=>u.account)})"
shot "$SHOT/r2-09-register.png"
ev "JSON.stringify({pwdCheck:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.find(u=>u.account==='2021999').password})"

# ---------- 买家下单（B 购买 u_demo 的商品） ----------
step "买家下单：B 购买 u_demo 在售商品"
BID=$(agent-browser eval "(()=>{const m=JSON.parse(localStorage.getItem('campus_market_market_v1'));const p=m.products.find(x=>x.sellerId==='u_demo'&&x.status==='在售');return p?p.id:'NONE'})()" 2>/dev/null | tr -d '"' | tail -1)
log "target seller-product = $BID"
ab open "$B/product/$BID"
sleep 1.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('我想要'));b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({orders:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.map(o=>({b:o.buyerId,s:o.sellerId,st:o.status,p:o.productId})).slice(0,3),productStatus:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='$BID')?.status})"
shot "$SHOT/r2-10-buyer-order.png"

# ---------- 卖家确认 → 交易中 → 已完成 ----------
step "卖家（demo）确认交易 → 交易中 → 已完成"
ab open "$B/profile"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('退出登录'));if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.0
ab open "$B/login"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('一键体验账号'));b.click();return 'clicked'})()"
sleep 1.5
ab open "$B/profile/orders"
sleep 1.3
ev "(()=>{const t=[...document.querySelectorAll('button,[role=tab]')].find(x=>x.textContent.includes('我卖出的'));t.click();return 'tab'})()"
sleep 1.0
ev "JSON.stringify({orderChips:[...document.querySelectorAll('.MuiChip-label')].map(c=>c.textContent)})"
shot "$SHOT/r2-11-sell-orders.png"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='确认交易');if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].status})"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='完成交易');if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].status,productStatus:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='$BID')?.status})"
shot "$SHOT/r2-12-order-done.png"

step "卖家评价买家"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('评价买家'));if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 0.8
ev "(()=>{const ta=document.querySelector('textarea');const d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;d.call(ta,'卖家评价：交易顺利');ta.dispatchEvent(new Event('input',{bubbles:true}));const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('提交评价'));b.click();return 'submitted'})()"
sleep 1.0
ev "JSON.stringify({sellerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].sellerReview})"
shot "$SHOT/r2-13-seller-review.png"

# ---------- 买家评价卖家 ----------
step "买家评价卖家"
ab open "$B/profile"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('退出登录'));b.click();return 'clicked'})()"
sleep 1.0
ab open "$B/login"
sleep 1.0
ev "(()=>{$setval const ins=[...document.querySelectorAll('input')];set(ins[0],'2021999');set(ins[1],'abc123');const b=[...document.querySelectorAll('button.MuiButton-contained')].find(x=>x.textContent.trim()==='登录');b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({currentUserId:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"
ab open "$B/profile/orders"
sleep 1.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('评价卖家'));if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 0.8
ev "(()=>{const ta=document.querySelector('textarea');const d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;d.call(ta,'买家评价：卖家很好');ta.dispatchEvent(new Event('input',{bubbles:true}));const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('提交评价'));b.click();return 'submitted'})()"
sleep 1.0
ev "JSON.stringify({buyerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].buyerReview,sellerReview:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].sellerReview})"
shot "$SHOT/r2-14-buyer-review.png"

# ---------- 价格校验：0 / 负数 ----------
step "发布校验：价格 0 / 负数 / 超限"
ab open "$B/publish"
sleep 1.2
ev "(()=>{$setval const ins=[...document.querySelectorAll('input')];const title=[...document.querySelectorAll('input')].find(e=>e.placeholder&&e.placeholder.includes('iPhone'));set(title,'QA 校验测试标题占位');const desc=document.querySelector('textarea');setT(desc,'这是一段足够长的描述用于通过校验，共超过十个字。');const nums=[...document.querySelectorAll('input[type=number]')];set(nums[0],'0');document.querySelector('[aria-label=\"选择图片 1\"]').click();return 'ok'})()"
sleep 0.4
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({err0:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
ev "(()=>{$setval const nums=[...document.querySelectorAll('input[type=number]')];set(nums[0],'-5');return 'set-neg'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({errNeg:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
ev "(()=>{$setval const nums=[...document.querySelectorAll('input[type=number]')];set(nums[0],'2000000');return 'set-big'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({errBig:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
shot "$SHOT/r2-15-price-validation.png"

# ---------- 图片校验提示 ----------
step "发布校验：未选图片提示"
ab open "$B/publish"
sleep 1.2
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({imgErr:[...document.querySelectorAll('span,p')].map(e=>e.textContent).filter(t=>t&&t.includes('请至少选择一张商品图片'))})"
shot "$SHOT/r2-16-image-validation.png"

# ---------- 已下架商品从首页隐藏 ----------
step "下架商品 → 首页不再展示"
ab open "$B/login"
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('一键体验账号'));b.click();return 'clicked'})()"
sleep 1.3
ab open "$B/"
sleep 1.3
ev "JSON.stringify({homeBefore:document.querySelectorAll('.cm-fade-in').length})"
ev "JSON.stringify({demoProductsBefore:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.filter(p=>p.sellerId==='u_demo').map(p=>p.title+'|'+p.status)})"
ab open "$B/profile/listings"
sleep 1.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='下架');if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({demoProductsAfter:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.filter(p=>p.sellerId==='u_demo').map(p=>p.title+'|'+p.status)})"
ab open "$B/"
sleep 1.3
ev "JSON.stringify({homeAfter:document.querySelectorAll('.cm-fade-in').length})"
shot "$SHOT/r2-17-takedown-hidden.png"

# ---------- 未读角标 ----------
step "未读角标"
ev "JSON.stringify({badge:[...document.querySelectorAll('.MuiBadge-badge')].map(b=>b.textContent).filter(Boolean)})"
shot "$SHOT/r2-18-badge.png"

# ---------- 收尾 ----------
step "收尾"
ab close --all
kill $VPID 2>/dev/null
wait $VPID 2>/dev/null
log "DONE"
