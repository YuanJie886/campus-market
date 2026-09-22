#!/bin/bash
# 校园集市 · 浏览器端到端走查（真实点击 + 截图 + localStorage 断言）
# 单进程内完成：启动 dev server → agent-browser 走查 → 关闭
set +e
export PATH="/Users/lhz/.workbuddy-ai/binaries/node/versions/22.22.2-2/bin:$PATH"
PROJ="/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"
cd "$PROJ" || exit 1
SHOT="$PROJ/qa-tests/screenshots"
LOG="$PROJ/qa-tests/e2e.log"
: > "$LOG"

log(){ echo "$@" | tee -a "$LOG"; }
step(){ echo "" | tee -a "$LOG"; echo "########## $* ##########" | tee -a "$LOG"; }
ab(){ agent-browser "$@" 2>&1 | tee -a "$LOG"; }
ev(){ agent-browser eval "$1" 2>&1 | tee -a "$LOG"; }
shot(){ agent-browser screenshot "$1" >/dev/null 2>&1; echo "[shot] $1" | tee -a "$LOG"; }

# ---------- 1. 启动 dev server ----------
step "启动 dev server"
NODE_OPTIONS="" CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 npx vite --port 5173 --host 127.0.0.1 >/tmp/vite-e2e.log 2>&1 &
VPID=$!
CODE=""
for i in $(seq 1 80); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ 2>/dev/null)
  [ "$CODE" = "200" ] && break
  sleep 0.5
done
log "dev server http=$CODE pid=$VPID"
if [ "$CODE" != "200" ]; then log "SERVER FAILED"; cat /tmp/vite-e2e.log | tee -a "$LOG"; exit 1; fi

# 校验关键路由
for p in / /index.html /src/main.tsx /src/App.tsx /product/xyz /publish /profile /messages /login; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:5173$p")
  log "route $p -> $c"
done

# ---------- 2. 首页 + 种子数据 ----------
step "首页加载 + 种子数据初始化"
ab open http://127.0.0.1:5173/
agent-browser wait --text "校园集市" >/dev/null 2>&1
sleep 1.5
ev "JSON.stringify({market:!!localStorage.getItem('campus_market_market_v1'),auth:!!localStorage.getItem('campus_market_auth_v1')})"
ev "JSON.stringify({products:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.length,users:JSON.parse(localStorage.getItem('campus_market_auth_v1')).users.length,currentUserId:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length})"
ev "JSON.stringify({cats:[...new Set(JSON.parse(localStorage.getItem('campus_market_market_v1')).products.map(p=>p.category))],campuses:[...new Set(JSON.parse(localStorage.getItem('campus_market_market_v1')).products.map(p=>p.campus))],statuses:[...new Set(JSON.parse(localStorage.getItem('campus_market_market_v1')).products.map(p=>p.status))]})"
ev "JSON.stringify({onSaleText:[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>t&&t.includes('件好物'))})"
shot "$SHOT/01-home.png"

# ---------- 3. 搜索 ----------
step "搜索：关键词命中标题/描述"
ab find placeholder "搜索你想要的闲置好物" fill "教材"
ab press Enter
sleep 1.2
ev "JSON.stringify({url:location.search,cards:document.querySelectorAll('.cm-fade-in').length,countText:[...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>t&&t.includes('件闲置'))})"
ev "JSON.stringify({titles:[...document.querySelectorAll('.cm-fade-in h3')].map(h=>h.textContent)})"
shot "$SHOT/02-search.png"

step "搜索：无结果空状态"
ab find placeholder "搜索你想要的闲置好物" fill "zzz不存在zzz"
ab press Enter
sleep 1.2
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,empty:[...document.querySelectorAll('h3,h2,div,p')].map(e=>e.textContent).find(t=>t&&t.includes('没有找到相关闲置'))||null})"
shot "$SHOT/03-search-empty.png"

# 重置回首页
ab open http://127.0.0.1:5173/
sleep 1.2

# ---------- 4. 分类筛选 ----------
step "分类筛选：教材书籍"
ev "(()=>{const c=[...document.querySelectorAll('.MuiChip-clickable')].find(x=>x.textContent.trim()==='教材书籍');if(!c)return 'no-chip';c.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({cards:document.querySelectorAll('.cm-fade-in').length,catChips:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.textContent).slice(0,3)})"
shot "$SHOT/04-category.png"

# ---------- 5. 排序 ----------
step "排序：价格从低到高 / 从高到低"
ab open http://127.0.0.1:5173/
sleep 1.2
# 打开筛选面板
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('筛选'));if(b)b.click();return !!b})()"
sleep 0.6
# 选排序 = 价格从低到高
ev "(()=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.replace(/\\s/g,'').startsWith('排序'));if(!l)return 'no-label';const el=document.querySelector('[aria-labelledby=\"'+l.id+'\"]');if(!el)return 'no-el';el.click();return 'opened'})()"
sleep 0.5
ev "(()=>{const o=[...document.querySelectorAll('li[role=option]')].find(x=>x.textContent.includes('价格从低到高'));if(!o)return 'no-opt';o.click();return 'picked'})()"
sleep 1.0
ev "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/05-sort-asc.png"
# 价格从高到低
ev "(()=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.replace(/\\s/g,'').startsWith('排序'));const el=document.querySelector('[aria-labelledby=\"'+l.id+'\"]');el.click();return 'opened'})()"
sleep 0.5
ev "(()=>{const o=[...document.querySelectorAll('li[role=option]')].find(x=>x.textContent.includes('价格从高到低'));o.click();return 'picked'})()"
sleep 1.0
ev "JSON.stringify({prices:[...document.querySelectorAll('.cm-fade-in')].map(c=>c.querySelector('.text-brand-600')?.textContent)})"
shot "$SHOT/06-sort-desc.png"

# ---------- 6. 未登录访问受限页（重定向） ----------
step "未登录访问受限页 → 重定向登录"
ab open http://127.0.0.1:5173/publish
sleep 1.2
ev "JSON.stringify({path:location.pathname})"
ab open http://127.0.0.1:5173/profile
sleep 1.2
ev "JSON.stringify({path:location.pathname})"
ab open http://127.0.0.1:5173/messages
sleep 1.2
ev "JSON.stringify({path:location.pathname})"
shot "$SHOT/07-redirect-login.png"

# ---------- 7. 登录：错误密码 ----------
step "登录：错误密码"
ab open http://127.0.0.1:5173/login
sleep 1.0
# 用原生 setter 写入受控输入框（2021001 / wrongpass）
ev "(()=>{const set=(el,v)=>{const p=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;p.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};const ins=[...document.querySelectorAll('input')];set(ins[0],'2021001');set(ins[1],'wrongpass');return ins.length})()"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='登录');b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({path:location.pathname,toast:[...document.querySelectorAll('.MuiAlert-message')].map(e=>e.textContent)})"
shot "$SHOT/08-login-wrong.png"

# ---------- 8. 一键体验账号登录 ----------
step "一键体验账号登录"
ab open http://127.0.0.1:5173/login
sleep 1.0
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('一键体验账号'));b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({path:location.pathname,currentUserId:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"
ev "JSON.stringify({nickname:[...document.querySelectorAll('span,p')].map(e=>e.textContent).find(t=>t&&t.includes('小鹿'))||null})"
shot "$SHOT/09-login-demo.png"

# ---------- 9. 商品详情：收藏 + 下单 ----------
step "商品详情：进入 + 浏览量 + 收藏 + 我想要"
ev "JSON.stringify({uid:JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId})"
PID=$(agent-browser eval "(()=>{const m=JSON.parse(localStorage.getItem('campus_market_market_v1'));const u=JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId;const p=m.products.find(x=>x.status==='在售'&&x.sellerId!==u);return p.id})()" 2>/dev/null | tr -d '"' | tail -1)
log "target product id = $PID"
ab open "http://127.0.0.1:5173/product/$PID"
sleep 1.5
ev "JSON.stringify({h1:document.querySelector('h1')?.textContent,path:location.pathname})"
ev "JSON.stringify({viewsText:[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>t&&t.includes('次浏览'))})"
shot "$SHOT/10-detail.png"
# 收藏
ev "(()=>{const b=document.querySelector('[aria-label=\"收藏\"]');if(!b)return 'no-fav';b.click();return 'clicked'})()"
sleep 0.8
ev "JSON.stringify({favCount:JSON.parse(localStorage.getItem('campus_market_market_v1')).favorites.length,toast:[...document.querySelectorAll('.MuiAlert-message')].map(e=>e.textContent)})"
shot "$SHOT/11-favorited.png"
# 我想要（下单）
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('我想要'));if(!b)return 'no-buy';b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({path:location.pathname,orders:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders.length})"
ev "JSON.stringify({latestOrder:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0]&&{status:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].status,price:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].price}})"
ev "JSON.stringify({productStatus:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='$PID')?.status})"
shot "$SHOT/12-order-created.png"

# ---------- 10. 我的订单 + 取消回滚 ----------
step "我的订单：取消订单 → 商品回滚在售"
sleep 0.8
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='取消订单');if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.2
ev "JSON.stringify({orderStatus:JSON.parse(localStorage.getItem('campus_market_market_v1')).orders[0].status,productStatus:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.find(p=>p.id==='$PID')?.status})"
shot "$SHOT/13-order-cancelled.png"

# ---------- 11. 我的收藏 / 我的发布 ----------
step "个人中心：我的收藏"
ab open http://127.0.0.1:5173/profile/favorites
sleep 1.2
ev "JSON.stringify({favCards:document.querySelectorAll('.cm-fade-in').length})"
shot "$SHOT/14-favorites.png"

step "个人中心：我的发布 + 下架/重新上架"
ab open http://127.0.0.1:5173/profile/listings
sleep 1.2
ev "JSON.stringify({listings:document.querySelectorAll('img').length,body:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).slice(0,20)})"
shot "$SHOT/15-listings.png"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='下架');if(!b)return 'no-takedown';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({statuses:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.filter(p=>p.sellerId===JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId).map(p=>p.status)})"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新上架');if(!b)return 'no-relist';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({statuses:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.filter(p=>p.sellerId===JSON.parse(localStorage.getItem('campus_market_auth_v1')).currentUserId).map(p=>p.status)})"
shot "$SHOT/16-listings-relisted.png"

# ---------- 12. 发布新商品（含校验） ----------
step "发布：空表单校验"
ab open http://127.0.0.1:5173/publish
sleep 1.2
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({errors:[...document.querySelectorAll('.MuiFormHelperText-root.Mui-error')].map(e=>e.textContent)})"
shot "$SHOT/17-publish-validation.png"

step "发布：填写并提交"
ev "(()=>{const set=(el,v)=>{const p=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;p.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};const ta=(el,v)=>{const p=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;p.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};const title=[...document.querySelectorAll('input')].find(e=>e.placeholder&&e.placeholder.includes('iPhone'));set(title,'QA 测试商品 九成新机械键盘');const desc=[...document.querySelectorAll('textarea')].find(e=>e.placeholder&&e.placeholder.includes('成色'));ta(desc,'这是 QA 自动化测试发布的商品，用于验证发布流程与列表刷新，机械键盘手感良好，支持面交。');const nums=[...document.querySelectorAll('input[type=number]')];set(nums[0],'199');const contact=[...document.querySelectorAll('input')].find(e=>e.placeholder&&e.placeholder.includes('手机号或学号'));set(contact,'13800001111');return JSON.stringify({inputs:document.querySelectorAll('input').length,textareas:document.querySelectorAll('textarea').length})})()"
# 选 2 张图片
ev "(()=>{document.querySelector('[aria-label=\"选择图片 1\"]').click();document.querySelector('[aria-label=\"选择图片 2\"]').click();return 'imgs-selected'})()"
sleep 0.5
ev "JSON.stringify({imgCount:[...document.querySelectorAll('[aria-pressed=true]')].length})"
shot "$SHOT/18-publish-filled.png"
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('立即发布'));b.click();return 'clicked'})()"
sleep 1.8
ev "JSON.stringify({path:location.pathname,h1:document.querySelector('h1')?.textContent})"
ev "JSON.stringify({products:JSON.parse(localStorage.getItem('campus_market_market_v1')).products.length,newest:JSON.parse(localStorage.getItem('campus_market_market_v1')).products[0].title})"
shot "$SHOT/19-published.png"

# 首页确认出现
ab open http://127.0.0.1:5173/
sleep 1.2
ev "JSON.stringify({found:[...document.querySelectorAll('.cm-fade-in h3')].some(h=>h.textContent.includes('QA 测试商品'))})"
shot "$SHOT/20-home-new-product.png"

# ---------- 13. 留言 ----------
step "详情页留言"
ab open "http://127.0.0.1:5173/product/$PID"
sleep 1.3
ev "(()=>{const ta=[...document.querySelectorAll('textarea')].find(e=>e.placeholder&&e.placeholder.includes('想问点什么'));const p=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;p.call(ta,'QA 留言：还在吗？可以小刀吗？');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()"
sleep 0.4
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='留言');b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({comments:JSON.parse(localStorage.getItem('campus_market_market_v1')).comments.length,hasQa:[...document.querySelectorAll('p')].some(p=>p.textContent.includes('QA 留言'))})"
shot "$SHOT/21-comment.png"

# ---------- 14. 站内消息 ----------
step "站内消息：联系卖家 → 会话 → 发消息 → 未读角标"
ab open http://127.0.0.1:5173/
sleep 1.2
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('联系卖家'));if(!b)return 'no-btn';b.click();return 'clicked'})()"
# 首页卡片没有联系卖家，直接进详情
ab open "http://127.0.0.1:5173/product/$PID"
sleep 1.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('联系卖家'));if(!b)return 'no-btn';b.click();return 'clicked'})()"
sleep 1.5
ev "JSON.stringify({path:location.pathname,convs:JSON.parse(localStorage.getItem('campus_market_market_v1')).conversations.length})"
shot "$SHOT/22-messages.png"
ev "(()=>{const ta=[...document.querySelectorAll('textarea')].find(e=>e.placeholder&&e.placeholder.includes('输入消息'));if(!ta)return 'no-ta';const p=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;p.call(ta,'你好，这个还在吗？');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()"
sleep 0.3
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('发送'));if(!b)return 'no-send';b.click();return 'clicked'})()"
sleep 1.0
ev "JSON.stringify({messages:JSON.parse(localStorage.getItem('campus_market_market_v1')).messages.length,hasMsg:[...document.querySelectorAll('div')].some(d=>d.textContent==='你好，这个还在吗？')})"
shot "$SHOT/23-message-sent.png"

# ---------- 15. localStorage 损坏自愈 ----------
step "localStorage 损坏 → 自愈"
ev "(()=>{localStorage.setItem('campus_market_market_v1','{broken json');return 'corrupted'})()"
ab open http://127.0.0.1:5173/
sleep 1.5
ev "JSON.stringify({recovered:(()=>{try{const m=JSON.parse(localStorage.getItem('campus_market_market_v1'));return m.products.length}catch(e){return 'STILL_BROKEN'}})()})"
shot "$SHOT/24-corrupt-selfheal.png"

# ---------- 收尾 ----------
step "收尾"
ab close --all
kill $VPID 2>/dev/null
wait $VPID 2>/dev/null
log "DONE"
