# 商品展示与联系方式

当前平台提供同校商品展示与卖家联系方式。后续沟通、价格协商和实际交易由双方通过实际联系方式自行约定，平台不建立交易订单、不预约地点或时间、不确认履约、不记录交易评价或交易履历。

## 卖家选择

发布和编辑商品时，卖家填写手机号、微信号或其他联系方式，并手动选择「公开展示联系方式」。单件、整套打包和批量发布均支持这一选项，默认不勾选；旧商品迁移后也保持不公开。

**勾选的后果（界面必须如实告知）**：联系方式会随商品一起出现在商品详情、商品列表与搜索结果、楼栋动态和需求匹配收件箱里，所有能看到这件商品的本校登录同学都能看到，不需要申请。商品本身的学校、圈子和内容可见范围仍然有效：「公开」不会让圈子商品或跨校商品对更多人可见。可以随时取消勾选；取消后只有卖家本人与已获同意（且未被撤回）的买家能看到。

未勾选时，买家点击「我想要」提交联系申请。卖家在「个人中心 → 联系申请」中同意或拒绝。同意后仅该商品的该买家能够在商品详情页查看联系方式，不授权其他买家或其他商品。申请不改变商品在售状态，不生成订单。

## 联系申请状态（阶段 1，V16）

| 当前状态 | 操作 | 结果 | 谁可以 |
|---|---|---|---|
| — | 申请 | PENDING | 买家（商品在售、未公开联系方式、不是自己的商品、没有生效中的「申请联系方式」限制） |
| PENDING | 同意 / 拒绝 | APPROVED / REJECTED | 卖家 |
| PENDING | 撤回申请 | WITHDRAWN | 买家 |
| WITHDRAWN | 重新申请 | PENDING（同一条记录） | 买家（计入限流；受「申请联系方式」限制） |
| APPROVED | 撤回同意 | REVOKED（买家立即看不到联系方式） | 卖家 |
| REJECTED / REVOKED | 再次申请 | **409**，不会静默成功 | — |

- 对同一件商品重复申请：PENDING / APPROVED 时幂等返回原申请（200，内容不变），不计入限流——**幂等判断在限制检查之前**：
  买家此刻即使处于「申请联系方式」限制中，重复提交已有的 PENDING / APPROVED 申请也照常返回原申请（例如前端重试、刷新后重放）；
- 状态机由数据库守卫（V16 `contact_requests_guard`）：只能以 PENDING 开始，非法迁移、改身份、删除都被拒绝；申请人必须与商品同校；
- 限流：同一用户每小时最多发起 20 次新申请（`campus-market.rate-limit.contact-request.*`，超限 429 + `Retry-After`）；
- 限制：工作人员可以施加「申请联系方式」（`CONTACT`）限制；历史上的「预约新订单」（`BOOKING`）限制在到期前同样拦截申请。
  限制只拦**新申请**与**撤回后的重新申请**（WITHDRAWN → PENDING），返回 403（`data.code=RESTRICTED`、`data.scope=CONTACT`），什么都不写、也不计入限流；
  对已被拒绝 / 撤回同意的申请再次提交，受限期间同样是 403（不是幂等重放）。受限期间已有申请照常查看、撤回、幂等重放，私信不受影响。
  实现上仍先对用户行取共享锁读出限制（锁顺序：用户行 → 商品行，与「工作人员施加限制」串行化），确认不是幂等重放之后才拒绝；
- 不存在、看不到的商品与不属于本人的申请一律 404，不透露是否存在；商品被治理隐藏、买家被移出圈子或商品跨校后，申请从列表中消失，已获的同意也不再让他看到联系方式。

## API

所有接口要求登录；请求体只接受列出的字段，其他字段一律 400（只回显字段名）。

| 方法与路径 | 请求 | 响应 |
|---|---|---|
| `GET /v1/products/{id}/contact-request` | — | 本人对该商品的申请，尚未申请时为 `null` |
| `POST /v1/products/{id}/contact-request` | 空或 `{}` | 申请（新建、幂等返回或重新申请） |
| `GET /v1/contact-requests?role=received\|sent&status=&page=1&size=20` | `role` 默认 `received`；`status` 可选 PENDING / APPROVED / REJECTED / WITHDRAWN / REVOKED；`size` 1～50 | `{ items, total, page, size }`，按最近变化倒序 |
| `GET /v1/contact-requests/unread-count` | — | `{ received, updates, total }`：卖家未读的新申请、买家未读的同意 / 拒绝 / 撤回同意 |
| `POST /v1/contact-requests/read` | `{ "role": "received" \| "sent" }` | 标记该角色的未读为已读，返回新的未读数 |
| `POST /v1/contact-requests/{id}/decision` | `{ "status": "APPROVED" \| "REJECTED" }` | 申请（卖家；同一结论重复提交幂等） |
| `POST /v1/contact-requests/{id}/withdraw` | 空或 `{}` | 申请（买家；重复撤回幂等） |
| `POST /v1/contact-requests/{id}/revoke` | 空或 `{}` | 申请（卖家；重复撤回幂等） |

申请对象：`id, productId, buyerId, sellerId, status, createdAt, updatedAt, decidedAt, productTitle, buyerNickname, sellerNickname, unread`。
`unread` 按查看者视角计算（卖家：未看过的待处理申请；买家：未看过的结果）。申请对象里**从不**包含联系方式；联系方式只出现在商品详情的 `contact` 字段，由后端按「本人 / 公开 / 已同意」判断。

## 历史交易数据

已撤下用户订单、验货提交、预约地点、档期改约、到达确认、爽约报告、交易评价、交易履历和历史成交参考的公开接口，相关后端代码在阶段 1 移除。
V16 对历史数据做了一次性收尾，并把交易相关表冻结为只读历史：

- 未结束的订单统一关闭为 EXPIRED（写订单事件，没有操作人）；未决的爽约报告失效；爽约规则产生、仍在生效的自动限制撤销（`RULE_RETIRED`）；以订单 / 爽约为对象的未结案件以「不采取措施」结案；残留的「预约中」商品恢复在售；
- 每一行改动都写入只增不改的 `legacy_trade_closures`（对象、原状态、新状态、原因、时间）；
- `orders`、`order_*`、`reviews`、自动限制的依据与纠正等表拒绝任何写入；订单参与者不再享有任何读取例外（`product_readable_by` 与 `product_visible_to` 等价）；
- 运营后台仍可只读查看历史订单。

数据库变更位于 `V15__contact_requests.sql` 与 `V16__retire_trade_and_contact_request_closure.sql`，由 Flyway 在后端启动时执行。

## 验证

- `ContactRequestsIT`：审批与隔离、公开开关、撤回与重新申请、撤回同意、拒绝终态、未知字段、分页与筛选、未读数、限流、数据库状态机守卫、已停用接口；
- `ContactRequestsIT` › `existingRequestsStayIdempotentWhileContactIsRestrictedButNewOnesAreBlocked`：受限买家重复提交 PENDING / APPROVED 申请原样返回、不计入限流；新申请、撤回后重新申请、已拒绝后再申请 403 且不写入、不计数；
- `ModerationIT` 5：`CONTACT` 限制拦截新申请、已有申请照常撤回；`SchoolIsolationIT`：跨校申请（接口与直接写库）；
- `FlywayLegacyBaselineIT` K：V10 → V11 → V15 → V16 的真实升级路径与收尾留痕；`PostgresSchemaIT` 5：历史交易表只读；
- 前端与小程序的对应测试见 `docs/phase-1-closure.md`。
