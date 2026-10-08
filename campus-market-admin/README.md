# 校园集市管理后台

复用 [marmelab/react-admin](https://github.com/marmelab/react-admin) 社区版 **5.15.4**，在其 Admin、Resource、List、Show、Edit 和权限钩子之上维护校园业务界面、自定义布局与登录/API 适配。

- 上游使用 MIT 许可，项目 README 明确支持商业使用。保留版权和许可声明；详见 `THIRD_PARTY_NOTICES.md`。
- 未引入付费的 `@react-admin/ra-rbac`。社区版 `authProvider.canAccess` 配合服务端权限矩阵提供本次鉴权。
- 复用现有 Spring Boot 后端、PostgreSQL、登录会话、HttpOnly 刷新 Cookie、学校隔离及治理服务。没有第二套用户或业务数据库。
- 接入范围：本校用户与工作人员、商品目录、交易订单、治理案件、用户申诉、授权审计、角色权限表。

## 运营界面

- 深绿分组导航、浅色卡片工作区、响应式布局，统一中文状态和角色标签。
- 工作台读取现有接口的用户/商品总数、待处理案件和待复核申诉，展示近期商品与授权动态；只查询当前角色有权读取的资源，加载失败明确显示错误。
- 列表提供搜索、案件状态/目标类型筛选、清除筛选、显示列选择与 CSV 导出。显示列偏好由框架保存；导出最多 100 条当前筛选结果，遵守服务端分页上限。
- 顶部快速导航支持页面搜索与 `Cmd/Ctrl + K`；列表中的长编号支持完整编号提示和复制。
- 人员授权包含账号摘要、角色能力预览、访问状态、变更原因和提交确认。确认前不会写入；保存失败保留确认内容以便重试，自己的权限仍禁止修改。
- 角色权限卡片中的可访问资源以接口返回的权限矩阵为准。用户、商品、订单与审计详情采用分栏布局。

新增界面复用现有接口，不需要数据库迁移。浏览器回归覆盖工作台数据、队列导航、角色预览、授权确认与失败重试、显示列/导出、只读角色及手机布局；截图使用测试响应，真实业务数据来自后端。

### 订单内容展示

订单列表通过一次关联查询提供商品标题/缩略图/分类、买家与卖家的昵称/校园账号、成交金额、订单状态与下单时间。搜索支持订单编号、商品名称和双方昵称/账号；显示列使用新的偏好键，让原来只有编号的列配置不影响新字段。

订单详情补充商品图片、描述与打包明细、双方校区/编号、面交地点/起止时间/改约次数、订单快照、状态及面交流程时间线、取消说明和交易评价。商品名称、图片和描述明确标记为当前信息；成交金额优先取不可修改的 `price_snapshot`，旧订单取订单自身 `price`，不会改用商品当前售价。未保存的历史快照显示“未记录”。

接口继续要求 `orders:read`。学校范围优先使用订单下单时的学校快照，旧订单回退到商品所在学校；不通过逐行前端请求拼接商品和双方，避免列表 N+1 请求。订单接口不返回确认码、联系方式、会话、密码、宿舍或幂等凭据。

本次同时补齐已有 V12 遗漏的后台审计结构：新增 **V13**，创建不可修改的授权审计表，并从可处理案件/申诉的人数中排除只读审计员。已有审计表、索引、保护函数及触发器的旧库也可升级，原有审计记录保留。已有 V12 保持不变。更新后需要重新运行 Spring Boot，Flyway 会应用 V13；前端开发服务会自动更新。

## 启动

先启动原有 PostgreSQL 和后端，Flyway 自动运行尚未执行的 V12、V13，然后分别启动两个前端：

```bash
# 终端 1，仓库根目录
cd campus-market-admin
npm ci
npm run dev

# 终端 2，仓库根目录
cd campus-market-frontend
npm run dev
```

访问 **http://localhost:5173/admin/**。后台 Vite 在 5174 提供资源，由商城 Vite 代理 `/admin/`。API 仍走同源 `/v1/`，因此不需要扩大 CORS、修改 Origin 校验或把 Cookie 放进 JavaScript。请通过 5173 访问，不直接访问 5174。

入口 `/admin` 会自动跳转到 `/admin/`。后台使用 BrowserRouter，并在路由层统一设置 `/admin` 前缀；登录、菜单及资源页面均支持直接访问和刷新。后端未启动时仍显示登录表单，提交会提示服务错误；完成真实登录需要后端与数据库正常运行。

已有工作人员在商城导航栏可进入“管理后台”。开发服务修改 proxy 后需要重启商城 Vite。后台访问由服务器决定，隐藏按钮只是界面体验。

```bash
npm run build  # TypeScript 检查 + 生产构建
npm test      # 请求映射与会话恢复测试
npm run test:e2e # 先 build；使用本机 Chrome 检查开发与生产构建的入口
```

浏览器回归覆盖未登录打开首页/子页面、刷新、后端不可用、登录后资源导航。测试拦截 API，不使用或修改真实业务账号。CI 设置 `E2E_BROWSER_CHANNEL=chromium`，并预先运行 `npx playwright install --with-deps chromium`。

## 首位学校管理员

没有默认账号、默认密码或自动授予的管理员。先通过商城注册真实账号，再由数据库运维人员核对用户 ID 和学校，以受控 SQL 授予第一位管理员。后续授权在后台“用户与工作人员 → 配置权限”操作。

```sql
BEGIN;
-- 将下面占位符替换为已核对的用户 UUID；学校取自服务器，不接收客户端 schoolId。
INSERT INTO staff_members(user_id, school_id, role, active)
SELECT u.id, c.school_id, 'SCHOOL_ADMIN', true
FROM users u JOIN campuses c ON c.id = u.campus
WHERE u.id = '<已核对的用户UUID>'::uuid
ON CONFLICT (user_id) DO UPDATE
SET school_id = EXCLUDED.school_id, role = EXCLUDED.role,
    active = true, updated_at = clock_timestamp();
-- 核对恰好影响 1 行，否则 ROLLBACK。此引导动作应保留在数据库运维审计中。
COMMIT;
```

接入代码不会为现有账号自动增加权限，也不会更改已有工作人员的角色。后台人员授权的审计从后台 API 变更开始记录；运维 SQL 应由数据库自身审计。

## 角色范围

| 角色 | 权限 |
| --- | --- |
| SCHOOL_ADMIN 学校管理员 | 本校用户、商品、订单、授权审计；授权/停用其他工作人员；案件和申诉处理 |
| SENIOR_MODERATOR 高级审核员 | 本校业务数据与授权审计只读；高级案件和申诉处理；无人员授权能力 |
| MODERATOR 审核员 | 本校商品目录只读；案件和申诉处理；原有 7 天限制上限继续生效 |
| AUDITOR 只读审计员 | 本校用户、商品、订单、授权审计、角色权限表只读；无案件证据和处理权限 |

本阶段使用固定角色，角色表是权限矩阵展示，不提供自定义角色和权限编辑。权限每次请求从 `staff_members` 查询，不缓存到 JWT 或 localStorage。停用、降级和跨校调动对下一个请求生效；登录会话仍属于普通校园账号。

学校管理员不能修改自己的后台权限。授权只允许本校目标，拒绝额外字段，记录变更前后角色/启用状态、操作人、目标、原因、请求编号及数据库时间。授权与审计同事务提交；审计表禁止 UPDATE/DELETE。

## 业务边界

商品、用户、订单列表只读。隐藏和恢复内容在治理案件中执行，继续使用已有状态机、利益回避、校内隔离和动作审计。申诉复核继续禁止原处理人或利益相关人决定。

列表在数据库分页，每页最多 100 条，排序字段使用白名单，搜索使用绑定参数。用户数据不包含密码散列、会话、联系方式和宿舍位置。

## 部署

原有 `campus-market-frontend/deploy/docker-compose.yml` 已加入 admin 静态服务，商城 nginx 代理 `/admin/`。统一通过原有站点域名访问 `/admin/` 和 `/v1/`，后台不单独发布主机端口。

```bash
cd campus-market-frontend/deploy
docker compose up -d --build
```

依赖版本由 `package-lock.json` 固定。后台使用 Node 24、Vite 7.3.7 和 Vitest 5.0.3。上游旧 query-string 解析器存在已公布的拒绝服务问题，已升级至 9.5.1（使用修复版 decode-uri-component 0.5.0）；`src/queryStringCompat.ts` 保留 react-admin 5 需要的具名和默认导出。该适配经中文筛选解析、类型检查、生产构建与依赖审计验证。权限矩阵和身份适配详见 `src/authProvider.ts`；数据接口见 `src/dataProvider.ts`；服务端入口见 `campus-market-backend/.../admin/AdminController.java`。
