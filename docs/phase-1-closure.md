# 阶段 1：收口「只展示商品 + 联系请求」模型

> 状态日期：2026-10-19。分支 `release/phase-1-acceptance`，在阶段 0（`docs/phase-0-baseline.md`）之上。本文的「通过」都来自本机实际执行；
> 本阶段**没有提交、推送**，远程 CI 尚未运行这些改动。接口契约见 `docs/contact-display-model.md`。

## 1. 范围与决定

| 事项 | 决定 |
|---|---|
| 站内交易 | 不恢复。后端交易代码移除，历史数据保留为只读 |
| 未结束的历史订单 | V16 统一关闭为 EXPIRED（系统关闭、没有操作人，不算任何一方的取消），每行写入 `legacy_trade_closures` |
| 订单的读取通道 | 去掉订单参与者例外：`product_readable_by` 与 `product_visible_to` 等价，Java 侧统一用后者 |
| 「限制预约新订单」 | 新增「申请联系方式」（`CONTACT`）限制与 `RESTRICT_CONTACT` 动作；`BOOKING` 只保留为历史，到期前按 `CONTACT` 生效，新限制不能再用（数据库守卫） |
| 爽约规则 | 停用：未决报告失效、仍在生效的自动限制撤销（`RULE_RETIRED`）、以爽约 / 订单为对象的未结案件以「不采取措施」结案；新的爽约 / 订单举报与案件被数据库拒绝 |
| 联系申请 | 买家撤回、卖家撤回同意、拒绝 / 撤回同意后为终态（再次申请 409）、分页、站内未读、限流、受限拦截、未知字段拒绝、数据库状态机与同校守卫 |
| 公开联系方式 | 界面如实告知后果（详情、列表与搜索、楼栋动态、需求匹配里都会出现） |

## 2. 后端

### 2.1 V16 迁移（`V16__retire_trade_and_contact_request_closure.sql`）

1. 历史交易收尾（订单、爽约报告、自动限制、案件、残留的「预约中」商品），全部写入只增不改的 `legacy_trade_closures`；
2. `orders`、`order_*`、`reviews`、`user_restriction_basis`、`user_restriction_corrections` 冻结为只读（任何写入 → `check_violation`）；
3. `product_readable_by` 重定义为与 `product_visible_to` 相同；
4. `CONTACT` 限制范围、`RESTRICT_CONTACT` 动作与结论码；`BOOKING` 与 `SYSTEM_RULE` 不能再新建；订单 / 爽约不能再被举报或立案；
5. `contact_requests`：WITHDRAWN / REVOKED、`decided_at`、`seller_seen_at`、`buyer_seen_at`，状态机守卫、同校守卫与未读索引。

V1～V15 未改动（`FlywayLegacyBaselineIT` K 比对 checksum）。

### 2.2 移除的代码

`OrderService`、`OrderTransitionExecutor`、`OrderExpiryJob`、`flow/*`（订单流程、交易履历、可操作性）、`PriceGuidanceService`、`NoShowService`、
`OrderMapper`（含 XML）、`OrderEventMapper`、`FlowMapper`、`ReviewMapper`、订单 / 评价 / 订单事件实体，`InspectionService` 与 `InspectionMapper` 的订单快照部分，
`RestrictionGuard` 的爽约规则与重算，`GovernanceMapper` 里 25 条只服务于取消 / 爽约 / 重算的语句，面交点查询，`DomainMapper` 的订单投影，
`ProductVisibility.requirePurchasable`，以及 3 个限流作用域（确认码、价格参考、爽约报告）与对应配置。

### 2.3 新增与修改

- `ContactRequestService` / `ContactRequestMapper` / `ContactRequestController`：契约见 `contact-display-model.md`；
- 治理：`RESTRICT_CONTACT` 取代 `RESTRICT_BOOKING`；历史订单 / 爽约案件只读展示；历史爽约确认的通知不再生效、不能申诉；申诉接受历史爽约确认时只记录结论；
- 后台：历史订单不再阻止目录编辑（只有已售出的商品不能改）；
- `ApiExceptionHandler`：真正的 500 现在按请求 id 记录异常与堆栈（不记录请求体、参数或令牌）。此前 500 完全不留痕，本阶段排查一处 SQL 错误时发现。

### 2.4 测试追踪

| 要求 | 测试（类 › 用例） | 判定 |
|---|---|---|
| 历史订单统一关闭并留痕、自动限制撤销、爽约案件结案、预约中商品恢复、联系申请决定时间回填、V1～V15 不变 | `FlywayLegacyBaselineIT` › `databaseAtV10AppliesV11`（K：V10 → V11 → V15 → V16） | 改写 |
| 未结束的旧订单只被 V16 改写状态，原状态留痕，其余字段不变 | `FlywayLegacyBaselineIT` › `legacyDatabaseIsBaselinedWithoutTouchingData`、`databaseAtV4OnlyAppliesV5` | 改写 |
| 历史交易表只读（新订单、评价、爽约报告；已有订单不能改或删） | `PostgresSchemaIT` › `legacyTradeTablesAreReadOnly` | 新增（取代 `oneActiveOrderPerProductIsEnforced`） |
| 迁移表集合含 `legacy_trade_closures`，历史 16 条 | `PostgresSchemaIT` › `allSchemaTablesExist`、`flywayHistoryRecordsInitialMigration` | 改写 |
| 买家撤回、重新申请沿用同一条、撤回后卖家不能再决定、已同意不能撤回 | `ContactRequestsIT` › `buyerCanWithdrawAndReapplyWhileSellerSeesTheCurrentState` | 新增 |
| 卖家撤回同意后立即看不到联系方式；撤回 / 拒绝后再次申请 409 | `ContactRequestsIT` › `sellerCanRevokeApprovalAndRejectedOrRevokedRequestsAreFinal` | 新增 |
| 未知字段与查询参数一律 400、没有副作用 | `ContactRequestsIT` › `unknownFieldsAndQueryParametersAreRejectedWithoutSideEffects` | 新增 |
| 按角色分页、按状态筛选、两页合起来不重不漏 | `ContactRequestsIT` › `listsArePagedPerRoleAndFilterable` | 新增 |
| 站内未读：新申请、同意、撤回同意；看列表不清零，标记已读才清零 | `ContactRequestsIT` › `unreadCountsFollowNewRequestsAndDecisionsUntilMarkedRead` | 新增 |
| 新申请按用户限流，幂等重复不计数，不影响他人 | `ContactRequestsIT` › `newRequestsAreRateLimitedPerUserButIdempotentRepeatsAreFree` | 新增 |
| 数据库状态机守卫（只能以 PENDING 开始、非法迁移、改身份、删除） | `ContactRequestsIT` › `databaseGuardsTheStateMachineEvenForDirectWrites` | 新增 |
| 列表响应分页后仍不含联系方式 | `ContactRequestsIT` › `privateContactsRequireSpecificSellerApproval` | 改写 |
| 申请人必须与商品同校（直接写库） | `SchoolIsolationIT` › `databaseGuards` | 改写（取代旧的订单同校断言） |
| `CONTACT` 限制拦截新申请、已有申请照常撤回、消息照常 | `ModerationIT` › `everyEntryPoint` | 改写 |
| 限制到期 / 申诉撤销后可以再次申请联系 | `ModerationIT` › `durations`、`appealRestriction` | 改写（恢复阶段 0 删掉的断言） |
| 工作人员只能用 `RESTRICT_CONTACT`；回避、矩阵、申诉 | `GovernanceRulesIT` › `ownActionAppeal`、`matrix`；`GovernanceConcurrencyIT` › `appealVersusExpiry`；`GovernanceSchemaIT` › `casesActionsAppeals` | 改写 |
| `CONTACT` 检查同时覆盖历史 `BOOKING`，仍走有效限制索引 | `GovernancePerformanceIT` › `userSide` | 改写 |
| 历史订单在后台只读查看（数据来自冻结的 SQL 种子）；不再阻止目录编辑；未结案件仍阻止 | `AdminIT` › 订单 4 个用例、`historicalOrdersDoNotLockCatalogButUnresolvedCaseCannotBeOverwritten` | 改写 |

退役（被测对象已删除）：`OrderExpiryJobConfigurationTest`、`TrustedFlowPerformanceIT`（订单流程语句计数）、`DomainMapperTest`（订单投影）、
`TrustedFlowSchemaIT` 中订单验货 / 档期 / 到达 / 流程事件 / 面交点的 12 个用例（表已只读，只读性由 `PostgresSchemaIT` 5 覆盖）、
`SupplySchemaIT` › `snapshotConstraints`、`SupplyPerformanceIT` › `priceGuidancePlan`、`CircleSchemaIT` 5 的订单快照部分、
`GovernancePerformanceIT` 中爽约计数 / 取消记录 / 档期快照 / 依据重算的执行计划断言。

## 3. 前端、小程序、后台

### 3.1 Web 前端（`campus-market-frontend`）

- 删除全部订单 / 预约 / 验货 / 爽约 / 评价 / 价格参考 / 面交点代码（页面、组件、Mock 与 REST 适配层里的方法）；`CampusMarketApi` 不再有任何交易方法。
- 联系申请：「收到的 / 我发出的」两个标签按角色分页（服务端分页、状态筛选），未读标记与导航栏、个人中心的未读数（带无障碍名称）；
  买家撤回 / 重新申请，卖家「撤回同意」需二次确认；详情页展示 WITHDRAWN / REVOKED，撤回同意后联系方式立即隐藏；限制、409 文案原样显示。
- 治理：限制动作改为 RESTRICT_CONTACT、范围 CONTACT；ORDER / NO_SHOW 只能查看历史、不能举报或立案；历史文案标「（历史）」，`RULE_RETIRED` 显示「规则已停用，自动撤销」。
- Mock 数据迁移到 v13，镜像 V16 的历史交易收口（写收口日志、幂等）。
- 「公开展示联系方式」开关在单件 / 打包 / 批量发布里统一说明后果，默认不勾选。
- 结果：typecheck 通过；vitest 48 个文件 459/459（另有 test:legacy 62/62）；`build`（含产物隔离检查）与 `check:deterministic` 通过。追踪表见前端代理报告中的 19 项，已逐项映射到测试文件与用例名。

### 3.2 小程序（`campus-market-miniapp`）

- 联系申请收发列表、撤回 / 撤回同意、未读数；交易相关页面与接口移除。vitest 33 个用例通过（阶段 1 时）。

### 3.3 管理后台（`campus-market-admin`）

- 订单资源只读展示历史；治理动作与范围同步为 CONTACT。单元 22、e2e 32 通过（阶段 1 时）；之后阶段 2–3 扩展到单元 71、e2e 60。

## 4. 仍未解决（后续阶段）

后端行为上的已知取舍（如实记录，均有测试覆盖当前行为）：

1. 创建申请先检查限制、后检查幂等：受限买家重复点击已存在的 PENDING / APPROVED 申请会得到 403 而不是原记录。
2. 撤回同意会覆盖 `decided_at`，列表「处理于」显示撤回时间，原同意时间只在审计里。
3. 若仍有未关闭的 ORDER / NO_SHOW 案件，后端允许 NO_ACTION 关闭，但 Web 端只读展示（V16 已全部关闭，正常情况下不会出现）。
4. 手工创建的历史 BOOKING 限制仍以 `BOOKING` 返回，客户端标为「申请联系方式（原「预约新订单」限制）」，后端按 CONTACT 执行直到到期。

客户端文案收尾（圈子退出说明、协助邀请里仍把订单写成现有功能）与移动端底部导航未读数：已在阶段 2–4 的 Web 工作中完成（`circleGuards.test.ts`、`circleUi.test.tsx` 改写，`imagesAndSafetyUi.test.tsx` 新增）。
