# 可信面交闭环（模块 3）

结构化验货清单 + 面交档期握手 + 出发/已到同步 + 交易履历。

> **边界先说清楚**：平台不接触资金，也不对商品做鉴定或担保。验货清单是**买卖双方当面检查过程的记录**，
> 「已出发 / 已到达」是**本人手动点选的状态**，都不是平台的质量结论，也不是定位结果。

---

## 1. 数据模型（V5）

迁移文件：`campus-market-backend/src/main/resources/db/migration/V5__trusted_meeting_flow.sql`。V1～V4 未改动。

| 表 / 字段 | 作用 | 关键约束 |
|---|---|---|
| `inspection_templates` | 分类级清单模板，按版本存 | `(category, version)` 唯一；`version > 0`；每个分类最多一个 `active` 版本（部分唯一索引）；触发器只允许修改 `active`，禁止删除 |
| `inspection_template_items` | 模板条目 | `(template_id, code)` 唯一；`code` 为 `^[A-Z][A-Z0-9_]{1,39}$` 的稳定机器码；`sort_order >= 0`；触发器禁止任何修改与删除 |
| `product_inspection_disclosures` | 卖家对**当前**商品的声明 | 主键 `(product_id, item_code)`；复合外键 `(template_id, item_code)` 指向模板条目；`declared_condition ∈ {NORMAL, DEFECT, NOT_TESTED, NOT_APPLICABLE}`；`note` ≤ 200 字且不含 `<` `>` |
| `order_inspections` | 订单级验货头 | 状态 `NOT_PROVIDED / PENDING / SUBMITTED / NEEDS_RESOLUTION`；CHECK 绑定「有模板 ⇔ 非 NOT_PROVIDED」「已提交 ⇔ 有提交时间与提交人」「has_mismatch ⇔ NEEDS_RESOLUTION」；触发器：快照列永不可改、终态整行不可改、禁止删除 |
| `order_inspection_items` | 订单级条目快照 + 买家结果 | 快照列（标签、说明、卖家声明、卖家说明）永不可改；父记录进入终态后买家列也不可改；`buyer_result ∈ {MATCH, MISMATCH, NOT_CHECKABLE}`；`checked_at` 非空必须有结果；禁止删除 |
| `orders.meeting_ends_at` / `orders.meeting_revision` | 当前协议的结束时间与版本号 | `meeting_revision` 默认 0（下单时的原始预约）；`meeting_ends_at` 为空或晚于开始且不超过 2 小时 |
| `order_meeting_proposals` | 档期提议 | 时段 `starts_at < ends_at ≤ starts_at + 2h`；每单最多一个 `PENDING`、最多一个 `ACCEPTED`（部分唯一索引）；`(order_id, revision)` 唯一；接受/拒绝者必须不是提议人，撤回者必须是提议人；`revision` 仅 ACCEPTED / SUPERSEDED 有值 |
| `order_presence` | 出发 / 到达 | 主键 `(order_id, user_id, meeting_revision)`；状态 `NOT_STARTED / DEPARTED / ARRIVED`；触发器：只能是订单买家或卖家、状态只能前进、已记录的时间不可改、禁止删除。**没有任何坐标、精度、路线或设备字段** |
| `order_flow_events` | 流程事件（时间线） | `event_code` 为 CHECK 限定的机器码；`seq bigserial` 做同一时刻的稳定排序 |
| `meeting_points.active` | 面交点启用状态 | 默认 `true`；停用点仍在列表中返回（历史订单需要名称），但不能用于新下单或新提议 |
| 索引 `order_events_order_created` | 时间线读 `order_events` | EXPLAIN 显示原先按订单读事件是全表扫描，这是本模块唯一新增的、面向既有表的索引 |

所有非法状态和非法时间段都由数据库约束兜底：`TrustedFlowSchemaIT` 绕过服务层直接写 SQL，验证每一条 CHECK / 唯一索引 / 触发器都会拒绝。

## 2. 验货模板版本策略

- 模板按 `(category, version)` 存储，**条目一旦写入就不可修改**（触发器）。要调整清单就新增一个版本，把旧版本 `active` 置为 `false`。
- `GET /v1/inspection-templates?category=` 只返回该分类**当前启用**的版本，不返回内部 id。客户端无法指定版本——提交声明时服务端按分类取当前模板，`templateVersion` 之类的字段被白名单拒绝。
- 已有订单引用的是下单那一刻的快照（见第 3 节），模板升级不会影响它们。
- 种子模板覆盖仓库真实存在的 5 个主要分类（与 `MarketService.CATEGORIES` 一致）：数码电子（8 项）、教材书籍（5）、生活用品（5）、服饰鞋包（5）、运动户外（5）。「其他」没有模板，允许无清单发布。

## 3. 商品声明与订单快照的区别

| | 商品声明 `product_inspection_disclosures` | 订单快照 `order_inspection_items` |
|---|---|---|
| 含义 | 卖家对商品**现在**状况的陈述 | 下单那一刻的声明副本 + 买家现场结果 |
| 何时写 | 发布；编辑时显式提交或切换分类 | 创建订单的**同一事务**里一次性 `INSERT … SELECT` 复制 |
| 能否修改 | 卖家可随时整体替换 | 快照列永不可改；买家提交后全部不可改 |

- 发布受支持分类时必须逐项声明全部必填项；**没有默认值**，前端不预选「正常」。
- 编辑时切换分类必须提交新分类的声明，不能复用旧分类的条目；只改其他字段时声明不变。编辑页提示「修改只影响之后生成的订单」。
- 快照失败则订单一起回滚（`OrderSnapshotTransactionIT`）；幂等重放与并发抢单都不会产生重复快照。

## 4. 旧商品 / 旧订单兼容

- V5 之前的商品没有声明，**不会被猜测为全部正常**；照常展示和交易。商品页显示「未提供结构化验货声明」。
- 旧商品在 V5 后被下单：订单验货状态为 `NOT_PROVIDED`，页面显示「该商品发布时未提供结构化验货声明」，不伪造任何结果，确认流程与原来一致。
- V5 之前创建的订单没有 `order_inspections` 行：接口返回 `LEGACY_NONE`（「无结构化验货记录」），同样按原流程确认与核销。
- 升级不写入任何验货、到达或提议记录；旧订单 `meeting_revision = 0`（`FlywayLegacyBaselineIT` 场景 A～E）。

## 5. 权限矩阵

| 操作 | 买家 | 卖家 | 其他登录用户 |
|---|---|---|---|
| 读取流程视图 `GET /v1/orders/{id}/flow` | ✅ | ✅（买家草稿不可见，提交后可见） | 404 |
| 保存验货草稿 / 最终提交 | ✅（仅待面交阶段） | 403 | 404 |
| 发起档期提议 | ✅ | ✅ | 404 |
| 接受 / 拒绝提议 | 仅对方的提议（自己的 403） | 同左 | 404 |
| 撤回提议 | 仅自己的（对方的 403） | 同左 | 404 |
| 更新出发 / 到达 | 仅本人状态 | 仅本人状态 | 404 |
| 本人履历 `GET /v1/me/trade-history` | 本人 | 本人 | — |
| 公共履历 `GET /v1/users/{id}/trade-summary` | 任何人（仅聚合） | 同左 | 同左 |

不存在管理员接口，本模块也没有新增。所有请求体采用字段白名单：`sellerId`、`buyerId`、`orderId`、`productId`、`templateVersion`、`inspectionStatus`、`checkedAt`、`buyerResult`（在声明中）、`submittedAt`、`proposerId` 等一律 400，错误响应带 `requestId`，不回显请求体。

## 6. 订单状态机的变化

以现有状态机为准，**没有新增状态**：

- **复用 `DISPUTED`**。V1 的 CHECK 已包含它，但此前没有任何代码路径进入。现在唯一入口是：买家在 `PENDING_MEETING` 最终提交的验货里存在 `MISMATCH`，同一事务内 `PENDING_MEETING → DISPUTED` 并写入 `order_events`。
- `DISPUTED` 的出口：任一方取消（`CANCELLED`，释放商品）或到期（`EXPIRED`，释放商品）。它**永远不能**进入 `BUYER_CONFIRMED` / `COMPLETED`。
- **验货闸门**：进入 `BUYER_CONFIRMED` 或 `COMPLETED` 之前检查验货——`PENDING` 返回 409「请先由买家完成验货并提交」，`NEEDS_RESOLUTION` 返回 409「验货存在不一致」。闸门在确认码校验**之前**，被拦下时不消耗确认码尝试次数；5 次锁死逻辑不变。`NOT_PROVIDED` 与无记录的旧订单不受闸门影响。
- 过期扫描覆盖 `PENDING_SELLER_CONFIRM / PENDING_MEETING / DISPUTED`。
- 界面统一称为 **「验货不一致」**。可执行的操作只有：取消交易、查看验货记录、等待订单到期。
  **本项目不做平台仲裁**（3.8C）：没有管理员裁决、举证上传、判责或赔付；界面与接口都不出现「平台仲裁中」「赔付处理中」「保证退款」一类说法。
  平台只记录双方当面验货的过程，不代替专业鉴定，也不提供资金担保。
- 被否决的备选方案：mismatch 后停留在 `PENDING_MEETING`、只靠闸门阻断。缺点是订单列表无法区分「正常待面交」与「验货有争议」，且会让已有争议的订单继续约时间、同步到达。

### 6.1 订单列表的可操作性（3.8A）

`GET /v1/orders` 的每一笔订单都带 `flow` 摘要，与订单同一条 SQL 取回（1 笔与 100 笔订单都是 3 条语句），前端不逐单请求流程详情：

| 字段 | 含义 |
|---|---|
| `inspectionRequired` / `inspectionStatus` | 是否有结构化清单；`LEGACY_NONE / NOT_PROVIDED / PENDING / SUBMITTED / NEEDS_RESOLUTION` |
| `buyerConfirmAllowed` / `buyerConfirmBlockReason` | 买家此刻确认面交是否会被放行；原因码 `INSPECTION_REQUIRED / INSPECTION_MISMATCH / ORDER_NOT_IN_MEETING / ORDER_TERMINAL / ALREADY_CONFIRMED` |
| `currentMeetingStatus` | `AWAITING_SELLER / CONFIRMED / RESCHEDULE_PENDING / CLOSED` |
| `myPresenceStatus` / `counterpartyPresenceStatus` | 当前档期版本下本人 / 对方的到达状态 |

计算只有一处：后端 `OrderActionability`，执行器的验货闸门、流程视图与列表摘要都调用它；Mock 的同名函数逐条对应。
界面据此禁用按钮并显示原因——这只是体验优化，后端 409 防线保持不变（测试逐阶段断言「允许 ⇔ 200、禁止 ⇔ 409」）。

## 7. 档期握手与改约

- 可约时间的状态（3.8B 收紧）：**只有 `PENDING_MEETING`**。卖家接受之前（`PENDING_SELLER_CONFIRM`）下单时填的时间只是买家的预约意向，
  不是双方握手确认的正式档期，提议返回 409「卖家接受预约后，才能约定正式面交档期」，界面也不显示提议入口。
  `BUYER_CONFIRMED`、`DISPUTED` 与 `CANCELLED / EXPIRED / COMPLETED` 一律 409。
- 提议必须：面交点属于订单校区且启用；开始与结束对齐到整点或半点；时长 ≤ 2 小时；开始晚于现在且在 30 天内；备注 ≤ 100 字。前端提供未来 7 天 × 08:00～21:30 每半小时 × 30/60/90/120 分钟的离散选项，没有自由文本时间。
- 每单同一时间最多一个待回应提议（部分唯一索引 + 服务层 409）。
- **安全改约**：发起新提议时旧档期保持有效；拒绝或撤回后旧档期不变；接受时在订单行锁（`FOR UPDATE`）内先把旧 `ACCEPTED` 标为 `SUPERSEDED`（保留历史），再把新提议置为 `ACCEPTED`、`revision + 1`，并同步 `orders.meeting_point_id / meeting_at / meeting_ends_at / meeting_revision / expires_at`。
- 接受后过期时间为新开始时间 + 1 天，与卖家接单时 `meetingAt + 1 天` 同一口径，保证旧的过期任务不会释放仍在正常面交中的商品。
- 并发：8 个线程同时接受同一提议，只产生一个当前协议（`revision = 1`，一个 `MEETING_ACCEPTED` 事件）；去掉行锁的变异测试会失败。

## 8. 出发 / 已到不是定位

- 接口 `PUT /v1/orders/{id}/presence`，请求体只有 `{"action": "DEPART" | "ARRIVE"}`；时间由服务端写入。
- 只能改本人状态；重复请求幂等；`ARRIVED` 后不能退回 `DEPARTED`；允许不经「已出发」直接「已到达」（此时 `departed_at` 为空，不伪造）。
- 只在 `PENDING_MEETING`、`BUYER_CONFIRMED` 可用；终态 409。
- 改约被接受后按新 `meeting_revision` 重新开始，旧记录保留为历史。
- **到达不会**完成订单、提交验货或显示联系方式。
- 模块 7：爽约复核时，工作人员能看到双方在那个档期版本上的到达声明，但界面固定写着「本人手动声明，不是定位证据」；
  到达声明**不能**单独证明爽约，也不会自动产生任何处罚。取消阶段会参考它（有一方声明到达后取消记为 `AFTER_ARRIVAL_REPORTED`）。

## 模块 7：取消、爽约与争议

- 取消：卖家确认前买家可以无责取消（原因选填）；卖家确认后双方仍可取消，但必须选择结构化原因（`reasonCode`，「其他」须写说明）。
  取消记录与取消状态变化同一事务写入，一张订单至多一条，重复取消幂等；阶段由服务端判定。确认档期后的取消只出现在本人履历里。
- 爽约：只能基于双方确认过的档期、在档期结束 15 分钟后 7 天内报告对方；单方报告只是 PENDING，不处罚；对方承认或工作人员确认后才计数，
  按公开规则（30 天内第 2 次限制预约 24 小时、第 3 次起 72 小时）。改约或见面后，旧档期上尚未确认的报告失效。
- 争议（`DISPUTED`，验货不一致）行为不变：只能取消或到期释放；平台不仲裁、不赔付、不鉴定真伪。
- 详见 [commitment-and-moderation.md](commitment-and-moderation.md)。
- 不采集位置：表中没有坐标类字段，前端源码扫描禁止 `navigator.geolocation`、地图 SDK、通知权限；界面固定显示「这是双方手动点选的人工状态，不是定位结果」。
- 并发：数据库 `ON CONFLICT DO NOTHING` + 只前进触发器；5 轮 × 12 线程快速点击没有产生倒退或重复事件。Mock 在写操作前从 localStorage 重新装载，过期标签页无法把另一个标签页的「已到达」写回「已出发」。

## 9. 验货凭证不是平台担保

订单流程页显示模板名称与版本、卖家下单时的声明、买家现场结果、不一致项、提交时间，并固定显示：
**「该记录仅用于记录双方当面检查过程，不代表平台鉴定或担保。」**
不显示确认码、联系方式或内部主键。

## 10. 时间线与履历

- 时间线合并 `order_events`（状态机）与 `order_flow_events`（流程）。只取机器码、操作人角色、档期版本与时间，**不取**取消原因等自由文本。
- 同一事务写入的事件时间相同，按固定的逻辑先后（`OrderFlowService.LOGICAL_ORDER`）→ `seq` → 行 id 排序，结果稳定。中文只在前端 `utils/trustedFlow.ts` 映射，未知码显示「其他进展」。
- **本人履历**：已完成、作为买家/卖家完成、取消、过期、验货不一致、进行中的数量，以及最近 10 笔订单入口。
- **公共履历**：只有 `completedCount`、`joinedAt`、`reviewCount`、`averageRating` 四个字段，由后端投影白名单直接生成；评价少于 3 条时 `averageRating` 为 `null`。不含交易对象、商品、订单时间、宿舍楼、取消或争议细节。**不计算任何信用分或指数。**

## 11. Mock / REST 契约

- Mock schema 升级到 v5：新增验货模板（从 V5 SQL 生成，测试逐项比对）、商品声明、订单快照、提议、当前档期、到达状态和流程事件。v1～v4 均可升级，幂等；不把旧商品标为正常，不给旧订单补验货或到达；单条损坏的记录只丢弃该条；更高版本不被覆盖；不触碰无关的 localStorage key。
- 两端同一套规则：声明校验、快照语义、验货闸门、`DISPUTED`、确认码 5 次锁死、提议校验、到达状态机、公共履历白名单与阈值。`src/api/trustedFlow.contract.test.ts` 与后端 `TrustedMeetingFlowIT` 的关键断言逐条对应，并用同一条完整链路比对时间线机器码顺序。
- 唯一有意的差异：Mock 的事件在同一数组中按写入序号追加，时间线直接按 `(时间, seq)` 排序；REST 需要 `LOGICAL_ORDER` 是因为事件分属两张表且同一事务时间相同。两者对外顺序一致。

## 12. 已知限制

- 没有平台仲裁：`DISPUTED` 只能协商取消或到期，平台不判定谁对谁错。
- 验货结果是买家本人的陈述；卖家不能修改，但也不能「申诉」某一项。
- 到达状态是自报的，平台无法也不会验证是否真的到了。
- 面交时段是固定的离散选项，没有读取课程表，也没有冲突检测。
- 停用面交点只影响新下单和新提议；已确认在该点的档期保持有效，需要双方自行改约。
- 自动化无障碍检查（axe）只覆盖结构性规则，jsdom 无法计算颜色对比度，不代表 WCAG 合规。

## 13. 后续扩展：图片证据（本阶段不实现）

如需为条目附图，建议新增 `order_inspection_evidence(order_id, item_code, object_key, sha256, uploaded_by, uploaded_at)`：
只允许买家在提交前上传、提交后随父记录一起锁定；对象存储使用私有桶 + 短期签名 URL，只对订单双方可见；
上传前在客户端去除 EXIF（尤其是 GPS）；不在公共履历中出现。
