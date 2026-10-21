# 阶段 0：恢复全绿基线（只展示商品 + 联系请求）

> 状态日期：2026-10-19。分支 `release/phase-1-acceptance`，基于上游 `66238cc`。本文所有「通过」都来自本机实际执行；
> 本阶段**没有提交、推送**，远程 CI 尚未运行这些改动。

## 1. 背景与范围

上游 `f790a44` / `6792617` 把产品方向改为「平台只展示商品与联系方式」：

- 移除对外接口：下单与订单流转、验货提交、改约、到达声明、评价、交易履历 / 摘要、面交点、爽约报告、价格参考；
- 新增 V15 `contact_requests` 与 `products.contact_public`：买家申请 → 卖家同意 / 拒绝 → 只有被同意的买家看到联系方式；
- 历史订单、快照、爽约等**数据保留**，后台仍可只读查看历史订单。

方向变更后测试与构建没有同步：前端类型检查 19 个错误、vitest 95 / 505 失败、构建失败；后端 Failsafe 471 个中 137 个失败；
3 个 E2E 文件依赖已移除的流程；CI 没有小程序作业；发布文档仍宣称交易链路通过。

阶段 0 **只让测试、构建与文档和新方向一致**，不删除仍在使用的功能代码；历史订单的收口、`OrderService` 等后端交易代码的移除、
界面文案中残留的「订单 / 预约」说法属于阶段 1（第 5 节列出）。

## 2. 处理原则

| 判定 | 条件 | 做法 |
|---|---|---|
| **退役** | 测试的对象本身是已移除的功能（下单、确认码、档期、改约、到达、验货提交、评价、爽约、价格参考、交易履历） | 删除用例，在本文登记 |
| **改写** | 测试的对象仍然存在（治理、可见性、学校隔离、圈子、协助发布、打包、未知字段、限流、请求 ID），只是用订单做了前置条件或断言了已移除的路径 | 换成联系请求或直接的商品操作，**仍然是行为测试**，断言同一条规则 |
| **新增** | 新方向的核心规则此前没有覆盖 | 新增行为测试 |
| **空转修复** | 用例仍然「通过」，但通过的原因是路由已经不存在（例如期望 404、或 `isIn(200, 404)`） | 视为失效测试，改写为真实入口 |

历史订单仍需要被后台只读查看：`support/LegacyOrders` 通过仍保留的 `OrderService` 直接生成与旧流程一致的订单行（不经过 HTTP），
阶段 1 移除 `OrderService` 时改为冻结的 SQL 种子。

## 3. 后端（Spring Boot + PostgreSQL 16 Testcontainers）

### 3.1 整类退役（7 个类，77 个用例）

| 类 | 用例数 | 退役原因（对应已移除的接口） |
|---|---|---|
| `OrderAuthorizationIT` | 4 | `POST /v1/orders`、订单响应 |
| `OrderConfirmationCodeIT` | 9 | 确认码核销与锁定 |
| `OrderLifecycleIT` | 9 | 订单状态机、取消、过期 |
| `OrderSnapshotTransactionIT` | 1 | 下单时验货快照的事务回滚 |
| `TrustedMeetingFlowIT` | 34 | 档期提议 / 接受、改约、到达声明、验货、交易履历与摘要、面交点 |
| `PriceGuidanceIT` | 11 | `/v1/price-guidance` |
| `CommitmentIT` | 9 | 取消承诺、爽约资格与报告 |

### 3.2 部分退役

| 类 · 用例 | 原因 |
|---|---|
| `GovernanceRulesIT` A1～A8（`completeSlot` `serverValidation` `frozen` `usesSnapshot` `legacyNotGuessed` `cannotBypass` `reschedule` `arrivalIsNotEvidence`） | 明确档期 / 改约 / 到达 |
| `GovernanceRulesIT` B1～B8（`provenance` `windowByConfirmation` `thirdShortened` `revokedWhenOneLeft` `expiredUntouched` `manualAndGuard` `neverHeavier`） | 爽约自动限制与重算：爽约报告接口已移除，不会再产生新的 SYSTEM_RULE 限制 |
| `GovernanceRulesIT` C7 `systemRuleAppeal` | 同上 |
| `GovernanceConcurrencyIT` `bothCancel` `cancelVersusComplete` `rescheduleVersusReport` `mutualReports` `staffConfirmVersusAcknowledge` `restrictVersusBooking` `expiryVersusBooking` `appealConfirmExpiry` `twoAppealsSameUser` | 全部是下单 / 取消 / 改约 / 爽约的竞态 |
| `GovernanceSchemaIT` `noShowStateMachine` | 爽约报告状态机 |
| `ModerationIT` `noShowReview` | 爽约复核 |
| `CircleMarketIT` `priceGuidanceExcludesCircleTrades` | 价格参考 |
| `BundleListingIT` `inspectionAndCompletion` `mismatchDisputes` | 打包验货与核销 |
| `RateLimitIT` `confirmationCodeRateLimit` | 确认码限流 |
| `UnknownFieldRejectionIT` `reviewRejectsUnknownFields`、`transitionRejectsUnknownFields` | 评价接口、订单流转接口（后者由新增的 `contactDecisionRejectsUnknownFields` 取代） |

### 3.3 改写（仍断言同一条规则）

| 类 · 用例 | 改写后证明的行为 |
|---|---|
| `GovernanceRulesIT` C1～C4 `ownThings` | 以本人 / 本人商品 / 评论 / 私信 / 本人举报为对象的案件一律回避（去掉「本人参与的订单」一项） |
| `GovernanceRulesIT` C8～C9 `matrix` | 本校 / 他校 / 本人处理 / 本人申诉矩阵与停用立即失权（去掉自动限制一项） |
| `GovernanceSchemaIT` `hiddenProductVisibility` | 被隐藏商品：权威可见性函数对卖家为真、对他人为假；**已同意的联系请求不构成读取例外**（`product_visible_to` 与 `product_readable_by` 都为假） |
| `ModerationIT` `reporterPrivacy` | 工作人员案件详情不含举报人、联系方式与会话其他消息（买卖双方已有已同意的联系请求时也一样）；日志不含消息正文、联系方式、令牌 |
| `ModerationIT` `everyEntryPoint` | 三种限制同时记录在「我的限制」；受限期间仍可私信；PUBLISHING 拦单件 / 打包 / 批量发布，草稿与下架不受影响；CIRCLE_CREATION 只拦新建 |
| `ModerationIT` `durations` | 期限上限、角色上限、不可改不可删、到期失效（去掉「到期后可以下单」） |
| `ModerationIT` `hideProduct` | 隐藏后他人列表与详情 404、卖家可见；**已同意联系请求的买家同样 404，且联系请求列表不再出现该商品**；动作只增不改、申诉恢复 |
| `ModerationIT` `appealRestriction` | 接受申诉后限制立即结束、不能再次申诉（去掉「撤销后可以下单」） |
| `AdminIT` 4 个订单用例 | 后台历史订单只读查看：列表与详情字段、无确认码 / 联系方式等敏感字段、按商品与双方搜索、成交价快照、冻结的学校范围；活跃历史订单阻止目录编辑。数据由 `LegacyOrders` 生成 |
| `CircleMarketIT` `participantException` | 圈子商品：非成员申请联系与不存在同为 404；成员被同意后移出圈子，**不再保留访问**（详情 404、列表与联系请求列表都不出现） |
| `CircleMarketIT` `publicProfile` | 公共资料不展示圈子（去掉已移除的交易摘要接口） |
| `AssistInviteIT` `ownerPublishes` | 协助人发布后不能编辑，也看不到、不能处理这件商品的联系请求（404） |
| `BundleListingIT` `singleOrder` → `singleContactEntry` | 整套只有一个联系入口；申请不改变在售状态、不产生订单；明细编码不是商品 |
| `SupplyPerformanceIT` `bundlePlansAndCounts` | 明细取回走索引、列表摘要不逐卡查询、详情语句数与明细数量无关（去掉下单语句数） |
| `CourseTextbookIT` `editKeepsSnapshotsHonest` | 教材版本快照替换 / 不改写 / 切换分类解除关联（去掉订单验货快照） |
| `SchoolIsolationIT` `directAccessIs404` | 他校商品详情 / 评论 / 浏览 / 收藏 / 会话 / **联系请求（读与写）** / 卖家资料与不存在相同；不产生任何联系请求行 |
| `SchoolIsolationIT` `anonymousCannotReadProducts` | 未登录读取商品与**联系请求接口**一律 401（去掉已移除的交易摘要与面交点） |
| `UnknownFieldRejectionIT` `errorMessageIsStableAndDoesNotEchoValues` | 在仍存在的联系请求决定接口上验证：字段名排序、不回显值 |

### 3.4 空转修复（原来「通过」但已不再测试任何东西）

| 类 · 用例 | 问题 | 改写 |
|---|---|---|
| `CircleConcurrencyIT` `removalVsOrder` → `removalVsContactRequest` | 下单路由已不存在，结果恒为 404，断言 `isIn(200, 404)` 与「订单数为 0」空转 | 移出成员与申请联系并发：成功恰好一条记录、失败没有记录；之后商品与申请都不可见 |
| `RequestIdIT` 404 分支 | 请求已移除的订单路由，得到的是「接口不存在」 | 改为联系申请决定接口上的业务 404，并断言是「联系申请不存在」 |

### 3.5 新增

| 类 · 用例 | 证明的行为 |
|---|---|
| `UnknownFieldRejectionIT` `contactDecisionRejectsUnknownFields` | 卖家决定联系申请时携带 `buyerId` / `sellerId` → 400，申请保持 PENDING |

### 3.6 迁移与结构

- `FlywayLegacyBaselineIT`：`LATEST` 由 14 改为 15，旧库基线与逐版本升级场景都执行到 V15；
- `PostgresSchemaIT`：期望表集合加入 `contact_requests`，空库历史记录 15 条（V12～V15 均为成功的 SQL 迁移）；
- V1～V15 未修改，只读取。

### 3.7 删除的死代码

- `service/DemandService`、`mapper/DemandSubscriptionMapper`：没有任何调用方；列名与现行表结构不符（`campus` / `campus_id`，缺 `school_id`、`fingerprint`、`geo_scope`），且是硬删除。
  需求订阅的现行实现是 `demand/DemandSubscriptionService`，不受影响；
- 测试夹具 `support/SlotClock`、`InspectionFixtures.submitAllMatch`、`SupplyApi.order / transition / flow / submit / complete`：只服务于已退役的用例。

## 4. 前端、E2E、CI

### 4.1 前端（React + vitest）

类型检查 19 个错误 → 0；vitest 505 个中 95 个失败 → **442/442**（退役 78、新增 15）；legacy 62/62；构建与包隔离、构建确定性恢复通过。

**删除的未路由页面**（删除前确认路由表与任何在用组件都不引用它们，只互相引用）：
`CheckoutPage`、`CheckoutSuccessPage`、`orders/OrderDetailPage`、`MarketResultsPage`、`SearchPage`、`CategoryPage`、`profile/DemandSubscriptionsPage`、
`components/DemandSubscriptionDialog`，以及只被前两者使用的 `utils/listingFreshness`。删除 `CheckoutPage` 后，
`circleGuards` #6、`privacyGuards` #24（页面含「校园实名用户」「已认证」）恢复通过——守卫本身没有放宽。

**产品代码改动（删除之外）**

| 文件 | 改动 | 原因与证据 |
|---|---|---|
| `components/supply/BundleProductForm.tsx` | 去掉价格参考卡片与「成交价统计」说明 | 在用的整套发布页仍调用已退役的价格参考接口，Mock 模式下显示「交易和预约功能已移除」；`supplyUi.test.tsx` 5.4 |
| `pages/MessagesPage.tsx` | 等市场数据首次刷新结束再读取消息 | 既有缺陷：首次读取被首次刷新作废，打开会话后最长 5 秒显示「暂无消息」；`governanceRulesUi.test.tsx` 7.1E 由约 5.3 秒超时变为约 0.6 秒通过 |
| `pages/ProductDetailPage.tsx` | 联系方式区块加一句「注册时的学校与校区由用户自行选择，平台目前不核验学籍或身份。」 | 上游 `63886b9` 删掉首页上的这句说明后界面上已没有任何地方说明身份未核验；`truthfulCopy.test.tsx` 新增用例 |

**逐条处理**

| 文件 › 用例 | 判定 | 退役的功能 / 改写后证明的行为 |
|---|---|---|
| `api/mockCampusMarketApi.test.ts` › 新会话 | 改写 | 从商品发起会话不产生订单；`createOrder` 返回 410 |
| `api/mockCampusMarketApi.test.ts` › 复用会话 | 改写 | 重试与联系申请后复用同一会话；卖家对自己的商品 400；卖家看到消息 |
| `api/orderStateMachine.test.ts` › 6 个 Mock 订单用例 + 13 行流转矩阵 | 退役 | 订单状态机（保留 2 个仍被 Mock 使用的纯函数用例） |
| `api/trustedFlow.contract.test.ts` › 3.3 ×8、3.4 ×3、3.5 ×3、3.6 ×2 | 退役 | 验货快照、档期提议、到达声明、交易履历 |
| `trustedFlowUi.test.tsx` › 3.2 | 改写 | 卖家声明仍展示；没有交易履历区域；未获同意的买家看不到联系方式；axe 通过 |
| `trustedFlowUi.test.tsx` › 3.3 ×6、3.4 ×3、3.5 ×1、3.6 ×3 | 退役 | 订单验货页、档期提议、到达、时间线 / 交易履历 |
| `closure38.test.tsx` › 全部 8 个 | 退役 | 订单列表摘要、档期、我的订单页 |
| `reviewSubmit.test.tsx` › 2 个 | 退役 | 评价 |
| `api/governance.contract.test.ts` › 6.1A 学校隔离 | 改写 | 跨校 `requestContact` 与 `getOrCreateConversation` 返回 404 |
| `api/governance.contract.test.ts` › 7.1 取消、7.2 ×2 | 退役 | 订单取消、爽约报告 |
| `api/governanceRules.contract.test.ts` › A1/A2、A4～A6、A7、B1/B3、B4～B6 | 退役 | 明确档期、爽约自动限制 |
| `api/governanceRules.contract.test.ts` › C6/C7 → C6 | 改写 | 无可回避工作人员时举报保持待处理，新增工作人员后标记清除并可处理（C7 爽约限制申诉退役） |
| `api/governanceRules.contract.test.ts` › REST 7.1 | 改写 | 隐藏留言 / 隔离私信的决定与申诉走正确路径、参数只在请求体（去掉订单档期部分） |
| `api/circle.contract.test.ts` › 9 | 改写 | 圈外用户对私密圈子商品 `requestContact` / `getContactRequest` 404 |
| `api/circle.contract.test.ts` › 12 | 改写 | 联系请求没有参与者例外：被同意的成员移出圈子后失去商品、联系方式与申请 |
| `api/circle.contract.test.ts` › 15 | 退役 | 价格参考 |
| `api/circle.contract.test.ts` › 17 | 改写 | 公共资料与公开商品视图不泄露圈子 |
| `api/demandRadar.test.ts` › 13 | 改写 | 联系申请不锁定商品（匹配仍有效）；标记售出后匹配失效 |
| `api/mockMigration.test.ts` › 8 | 改写 | 迁移时有进行中旧订单的商品释放为在售，订单记录保留 |
| `api/mockMigration.test.ts` › 24 | 退役 | 推进旧订单 |
| `api/mockMigrationV5.test.ts` › v4 加载 | 改写 | 数据升级到当前版本；商品可读且在售；旧订单保留但流程调用返回 410 |
| `api/supply.contract.test.ts` › 5.1C / 5.4 打包 | 改写 | 明细 ID `requestContact` 404；每位买家一条幂等申请；商品保持在售 |
| `api/supply.contract.test.ts` › 5.6 ×2 | 退役 | 价格参考 |
| `supplyMatrix.test.tsx` › #7 | 改写 | 明细不能单独申请联系；界面「我想要」创建 PENDING 申请 |
| `supplyMatrix.test.tsx` › #14、#19 | 退役 | 价格参考；整套下单流程 |
| `supplyUi.test.tsx` › 5.4 | 改写 | 现行整套文案；没有下单 / 面交 / 价格参考文字；从不调用价格接口 |
| `supplyUi.test.tsx` › 5.6 | 退役 | 价格参考卡片 |
| `governanceUi.test.tsx` › 爽约报告、取消订单 | 退役 | 爽约报告、订单取消 |
| `governanceRulesUi.test.tsx` › 7.1A ×2、「我的限制」自动限制 | 退役 | 档期、爽约自动限制 |
| `demandUi.test.tsx` › 7、10、12 | 改写 | 「申请联系卖家」入口取代「去预约面交」；失效匹配显示「已售出或下架，暂不可联系」且没有联系入口；打开商品不自动申请，点击「我想要」才创建申请 |
| `truthfulCopy.test.tsx` › 首页 | 改写 | 没有实名 / 认证说法与无来源统计 |
| `truthfulCopy.test.tsx` › 商品联系方式区块 | 新增 | 展示「不核验学籍或身份」与「只展示商品和联系方式」说明；页面没有核验类说法 |
| `routes.test.tsx` › `/profile/orders` 行 | 改写 | 改为 `/profile/contact-requests` |
| `routes.test.tsx` › 2b、9 个已移除路由 | 新增 | 旧的订单、结算、搜索、分类路由显示 404 页 |
| `contactRequestsUi.test.tsx` › 卖家拒绝 | 新增 | 买家看到禁用的「卖家已拒绝」、不能再申请、联系方式保持隐藏 |
| `contactRequestsUi.test.tsx` › 自己的商品 | 新增 | 本人看到禁用的「这是我发布的」，不发送申请，接口返回 400 |
| `api/contactRequests.test.ts` › 全部已退役接口 | 新增 | 20 个已退役的交易方法都返回 410 与准确提示；不产生订单、商品保持在售 |

「申请联系 → 卖家同意 → 买家看到联系方式」此前已由 `contactRequestsUi.test.tsx` 覆盖。

**保留未删（不在阶段 0 清单内，均未路由，阶段 1 处理）**：`OrderFlowPage`、`profile/OrdersPage`、`profile/TradeHistoryPage`、`ReviewDialog`、
`components/trust/` 中的订单部分、已不再使用的 `PriceGuidanceCard`、`MarketContext` 中的订单动作、REST 客户端里的交易方法
（3 个 REST 适配测试仍覆盖这些端点）。删除 `OrderFlowPage` / `OrdersPage` 时需要同步 `privacyGuards.test.ts` 第 94、139 行的路径过滤。

### 4.2 真实浏览器 E2E（Playwright + 后端 jar + 一次性 PostgreSQL 16）

| # | 场景 | 用例 | 状态 |
|---|---|---|---|
| 1 | **核心链路**：界面发布 → 搜索浏览 → 申请联系 → 卖家同意 → 买家看到联系方式（第三人看不到）→ 卖家下架后不再出现、不能再申请 | `contact.spec.ts` #1 | 新增 |
| 2 | 卖家拒绝：买家始终看不到联系方式、拒绝是终态；卖家公开联系方式时直接展示 | `contact.spec.ts` #2 | 新增 |
| 3 | 整套打包同样只有一个联系入口，申请不改变在售状态 | `contact.spec.ts` #3 | 新增 |
| 4～8 | 批量发布、需求命中、私密圈子、两校隔离、邀请兑换 | `supply-demand.spec.ts` `circles-schools.spec.ts` | 保留；#7 的「不能预约他校商品」改为「不能申请他校商品的联系方式」（业务 404，而不是接口不存在） |
| 9 | 举报 → 工作人员在界面上隐藏 → 他人与**已获同意的买家**都看不到，卖家看到被隐藏 | `governance.spec.ts` #9 | 新增 |
| 10 | 受限用户不能发布新商品（界面给出原因与到期时间），仍可下架已有商品 | `governance.spec.ts` #10 | 改写（原为「不能新下单」） |
| 11 | ~~爽约报告不自动处罚~~ | — | 退役 |
| 12 | 工作人员处理 → 用户申诉 → 原处理人回避 → 另一位工作人员接受 → 限制解除 | `governance.spec.ts` #12 | 保留，限制类型改为「发布商品」 |
| 13～14 | 刷新登录恢复；直接打开详情无 Hook 错误 | `session.spec.ts` | 保留；#14 的深链接由 `/profile/orders` 改为 `/profile/contact-requests` |
| 15 | 手机尺寸：搜索 → 详情 → 申请联系 → 联系申请列表，无横向滚动 | `mobile-keyboard.spec.ts` #15 | 改写 |
| 16 | 只用键盘：发布、申请联系、卖家同意 | `mobile-keyboard.spec.ts` #16 | 改写 |

退役：`trade.spec.ts`（原 #1 #2 #3 #9：预约 → 接单 → 验货 → 核销 → 评价）。

### 4.3 CI

新增 `miniapp` 作业：`npm ci` → 类型检查 → 单元测试 → Mock 构建 → REST 构建。`check:wxss` 依赖微信开发者工具自带的 `wcsc`，
托管运行器上没有，保留为本机发布前步骤。现有触发条件是 `push` 到 `main` 与 `pull_request`，本分支要开 PR 才会触发远程 CI。

### 4.4 本地部署演练脚本

`deploy/drill/local-deploy-drill.mjs`：Flyway 期望改为 V1～V15，SPA 深链接改为 `/profile/contact-requests`，
备份恢复哨兵由「已接单的订单 + 档期快照」改为「已同意的联系请求」。

## 5. 留给阶段 1 的事项（本阶段发现、未处理）

| 事项 | 现状 |
|---|---|
| `RESTRICT_BOOKING` 没有入口 | 限制仍可施加、记录与申诉，但联系请求不检查任何限制范围；需决定改为「限制申请联系」或停用该动作 |
| 后端交易代码 | `OrderService`、`OrderExpiryJob`（已无定时）、验货 / 档期 / 爽约服务与映射仍在；`ConversationMapper`、`MessageMapper`、`CircleMapper` 仍用含订单例外的 `product_readable_by` |
| 历史订单收口 | 进行中的历史订单仍会阻止后台编辑商品（`AdminIT` 当前行为）；需通过新增迁移统一关闭 |
| 界面文案 | 治理说明（`utils/governance.ts` 的影响说明、「仍然可以完成已经成立的订单」等）、后台「交易订单」菜单仍按交易流程描述 |
| 联系请求 | 没有频率限制、撤回、分页与通知 |
| 前端交易残留 | 见 4.1「保留未删」 |
| 小程序 REST 构建 | 仍打包了演示种子与演示密码；`project.config.json` 为 `touristappid` 且上传源码映射 |

## 6. 最终结果（2026-10-19 本机）

| 项目 | 阶段 0 前 | 阶段 0 后 |
|---|---|---|
| 后端 Surefire | 16/16 | **16/16** |
| 后端 Failsafe（PostgreSQL 16） | 471 个中 137 个失败（按测试报告计） | **362/362**（按测试报告计：471 − 整类退役 77 − 部分退役 33 + 新增 1；Maven 控制台汇总为 Tests run 364、Failures 0、Errors 0，差异来自嵌套 / 参数化用例的计数方式） |
| 前端类型检查 | 19 个错误 | **0** |
| 前端 vitest | 505 个中 95 个失败 | **442/442** |
| 前端 legacy | — | **62/62** |
| 前端构建 / 包隔离 / 确定性 | 构建失败 | **通过** |
| 复用后台 | 9/9；构建通过 | **9/9；构建通过；浏览器回归 28/28** |
| 微信小程序 | 10/10；构建通过 | **10/10；类型检查、Mock 与 REST 构建通过** |
| 真实浏览器 E2E | 3 个文件依赖已移除流程 | **15/15，连续两次** |
| 本地部署与备份恢复演练 | V11 / 订单哨兵 | **28/28（V15 / 联系请求哨兵）** |
| 迁移 | V1～V15 | V1～V15 **未改动** |

E2E 第一次运行有 2 个失败，都是新写用例的错误（受限发布用例的描述少于 10 个字被表单校验拦下；下架后申请联系实际返回 404 而不是我预期的 409），
修正用例后连续两次全部通过；部署演练第一次重跑有 1 项失败（脚本把迁移数量写死为 11），改为从迁移目录读取后 28/28。
