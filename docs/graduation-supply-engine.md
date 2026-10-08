# 毕业季通用供给引擎（模块 5）

毕业季集中出清时，一个人往往要一次挂出十几件东西，其中有些更适合整套转让；也常常是室友或朋友帮忙拍照、写描述。
这个模块把「整理 → 检查 → 一次发布」做成一条可靠的链路，**所有商品分类通用，全年可用**（不只是毕业季，也不只是教材）：

- **服务端草稿**：可以只填一部分，随时保存；多标签页或协助人同时编辑时用版本号防止互相覆盖。
- **批量发布**：一个批次最多 20 件，逐件校验，全部通过后一次确认——**要么全部发布，要么一件都不发布**。
- **整套打包**：一个商品主体 + 2～30 条明细，整套出售、只生成一个订单，面交验货逐条核对明细。
- **协助整理发布**：所有者用一次性邀请码请别人帮忙整理内容；协助人**不能发布**，最终由所有者检查后发布。
- **历史成交价格参考**：只统计校内已完成交易的成交价快照，样本不足不给区间；不是估价，也不是成交保证。

同时收口了模块 4.8：演示教材不再使用 979-0（乐谱号 ISMN）号段冒充图书 ISBN；前端提供显式的 REST / Mock 双模式构建。

---

## 1. 数据模型（V7）

迁移：`campus-market-backend/src/main/resources/db/migration/V7__graduation_supply_engine.sql`。V1～V6 未改动（checksum 由 `FlywayLegacyBaselineIT` 场景 A、C～G 断言不变）。

| 表 / 列 | 要点 |
|---|---|
| `products.listing_kind` | `SINGLE` / `BUNDLE`，默认 `SINGLE`（旧商品一律单件）；发布后不能切换（触发器） |
| `products.published_by` / `assisted_by` | 发布人必须等于卖家本人（CHECK）；协助人只做记录、不能是卖家本人，不授予任何发布后的权限 |
| `bundle_items` | 明细：编号、名称（1～60 字、不含尖括号）、真实分类、成色、数量 1～99、备注 ≤200、排序 0～29；主键 `(product_id, item_code)`；只允许挂在 `BUNDLE` 商品上；**延迟约束触发器**保证提交时每件打包商品有 2～30 条明细 |
| `listing_drafts` | 所有者、最后编辑人、类型、白名单 payload（jsonb ≤64 KB）、版本号、状态 `DRAFT / READY / PUBLISHED / DISCARDED / EXPIRED`、到期时间；**不能删除**，已发布 / 丢弃 / 过期的草稿只读（触发器） |
| `listing_batches` / `listing_batch_items` | 批次 `OPEN / PUBLISHED / DISCARDED` + 乐观锁；条目位置 1～20；复合外键保证草稿与批次同一所有者；部分唯一索引保证**一个草稿只能在一个未发布批次里** |
| `listing_publish_requests` | 批量发布幂等记录：`(所有者, Idempotency-Key)` 主键、请求哈希、结果商品 id（1～20 个） |
| `listing_assist_invites` | 一次性邀请：草稿或批次恰好一个（复合外键限定为所有者本人的）；**只存 SHA-256 哈希**（CHECK 限定 64 位十六进制）；`PENDING → ACTIVE → REVOKED`；有效期不超过 7 天 |
| `listing_assist_events` | 审计：`INVITE_CREATED / INVITE_REDEEMED / INVITE_REVOKED / ASSIST_DRAFT_EDITED / PUBLISHED_AFTER_ASSIST`，只有机器码与时间，不含邀请码或草稿内容 |
| `orders.price_snapshot` / `currency` | 下单时在同一事务写入；之后**任何**改写（包括给旧订单补写）都被触发器拒绝；旧订单保持 `NULL`，不从 `orders.price` 猜 |

**4.8A 演示 ISMN 修正**：V7 只更新 V6 植入的 5 条演示教材，匹配条件是 id + `is_demo` + 学校 + 原号码 + 书名 + 版次**六项同时相等**；
改为「无 ISBN」并写入由书目信息计算的稳定指纹（与 `TextbookFingerprint` 同一算法，`TextbookSchemaIT` 用 Java 实现复算比对）。
被维护者改过的演示行、任何用户数据都不受影响（场景 G 断言）。商品快照里的 979-0 号码只在对应版本确实被修正时才清掉。
V6 的 `isbn13_is_valid` **没有**重新定义；「979-0 不是图书 ISBN」由服务端 `Isbn.java` 与前端 `utils/isbn.ts` 的解析拒绝。

---

## 2. API

全部需要登录，身份只取自认证；请求体或路径里的 `ownerId / sellerId / publishedBy / assistedBy / schoolId` 等字段一律 400。

| 方法与路径 | 说明 |
|---|---|
| `POST /v1/listing-drafts` | 新建草稿（`draftType`、`payload`），允许不完整；按账号限流 |
| `GET /v1/listing-drafts` | 我的草稿（读取时把到期的显式标为 `EXPIRED`，不删除） |
| `GET /v1/listing-drafts/assisting` | 我作为协助人可以编辑的草稿（不含所有者联系方式） |
| `GET /v1/listing-drafts/{id}` | 所有者或持有生效邀请的协助人可读，其他人 404 |
| `PATCH /v1/listing-drafts/{id}` | payload 整体替换；必须带 `expectedVersion`（或 `If-Match`），不一致 409 并在 `data.currentVersion` 给出最新版本；`status: READY` 需要通过正式校验（400，`data` 是逐项原因） |
| `DELETE /v1/listing-drafts/{id}` | 软丢弃，幂等；仍在未发布批次里的草稿 409 |
| `POST /v1/listing-batches`、`GET`、`GET /{id}`、`PATCH /{id}`、`DELETE /{id}` | 批次的创建、列表、详情（逐项校验结果）、整体替换条目（乐观锁）、丢弃 |
| `POST /v1/listing-batches/{id}/publish` | 整批发布；**`Idempotency-Key` 请求头必填**（8～100 位） |
| `POST /v1/listing-assist-invites` | 为草稿或批次创建邀请（`expiresInHours` 1～168，默认 24）；**原始邀请码只在这个响应里出现一次** |
| `GET /v1/listing-assist-invites`、`POST /{id}/revoke`、`GET /{id}/events` | 我发出的邀请（不含邀请码）、撤销（幂等）、审计事件 |
| `POST /v1/listing-assist-invites/redeem` | 兑换；邀请码**只放在请求体** `{ "token": "…" }` |
| `GET /v1/price-guidance?category=&condition=&textbookEditionId=` | 价格参考；只接受这三个维度 |

### 逐项校验码

`VALID`、`MISSING_FIELD`（`field` 是逗号分隔的缺失字段名）、`INVALID_CATEGORY`、`INVALID_PRICE`、`INVALID_BUILDING`、`INVALID_INSPECTION`、`INVALID_TEXTBOOK`、`INVALID_BUNDLE`，
另有两个扩展码：`INVALID_FIELD`（标题 / 描述长度、成色、校区、图片地址等格式问题）与 `DRAFT_CLOSED`（草稿已发布、丢弃或过期）。
界面只根据这些码展示文案，中文不参与判断（`supplyGuards.test.ts` 核对前端能展示后端给出的每一个码）。

### 批量发布的事务

`ListingBatchService.publish` 是一个事务：限流（独立事务，失败的尝试也计数）→ 所有者行锁（同一所有者的并发发布串行）→ 幂等检查 → 批次行锁（非 `OPEN` 即 409）→
草稿行锁 → 逐项校验（任一不通过 400，逐项原因在 `data.items`，**什么都不写**）→ 按位置逐条调用 `MarketService.createProductAs`
（商品 + 验货声明或打包明细 + 教材关联 + **同步需求匹配**）→ 标记草稿与批次已发布 → 写入幂等记录与协助事件。
任何一步抛错（第 10 件创建失败、第 15 件匹配失败、数据库唯一约束冲突）整批回滚，`ListingBatchIT` 的故障注入用例逐一验证。
同一个键 + 同一批次重放返回原结果（`replayed: true`），不会重复创建；同一个键用于另一个批次 409。响应里没有任何需求人数。

---

## 3. 整套打包

- 发布：`listingKind: "BUNDLE"` + `bundleItems`（2～30 条）；主分类选真实分类，混合物品选「其他」（界面显示为「其他 / 混合物品」）。
  打包商品不提交商品级验货声明，也不能关联单一教材版本。
- 下单：整套一个订单，下单后整套进入「预约中」；明细编号不是商品，不能单独下单。
- 验货：订单一份验货记录（模板标识 `tpl-bundle-v1`），**每条明细一项基础核对**；说明快照写出分类、卖家标注的成色，
  以及该分类当前模板的必填检查点（例如数码电子 → 能正常开机、屏幕显示正常……）。任一明细不一致，订单照旧进入 `DISPUTED`，只能取消。
  这是刻意的取舍：逐条展开完整分类清单会让 30 条明细变成上百个单选组，面交现场不可用。
- 需求雷达只按整套主体（标题、描述、主分类）匹配，只出现在明细名称里的关键词不会命中。
- 展示：卡片写「整套转让 · 包含 N 类 / N 件」与整套总价；详情列出明细表、总件数、总价与「平均每件（仅供参考，不能按件购买）」。
- 性能：详情的明细是一条按主键前缀的查询，卡片摘要是商品列表 SQL 里的标量子查询；详情与下单的语句条数在 2 条和 30 条明细时相同（`SupplyPerformanceIT`）。

## 4. 协助整理发布

- 所有者为某个草稿或批次创建邀请：32 字节随机数（base64url），服务端只存 SHA-256；原始邀请码只显示一次。
- 分享方式：手动告诉对方，或发送链接 `…/assist#code=…`。邀请码放在 **URL fragment**（`#` 之后）：浏览器不会把它发给服务器，
  也不会出现在 Referer 或访问日志里；协助页读出后立即用 `history.replaceState` 从地址栏抹掉，只放进兑换请求的请求体。
- 前端**不把邀请码写进 localStorage / sessionStorage**：它只存在于邀请弹窗的组件内存里，关闭即丢弃（离线 Mock 也只保存哈希）。
- 兑换：每次尝试都计入限流；邀请不存在、已兑换、已撤销、已过期、自己兑换自己的邀请，对外都是同一个 404「邀请码无效或已失效」。
- 协助人**可以**：整理标题、描述、分类、价格建议、打包明细、取货楼栋建议，并保存。
- 协助人**不可以**：发布、改所有者、看或改联系方式、改成色 / 图片 / 验货声明 / 校区 / 教材版本（服务端逐字段比对，改动即 403）、
  把草稿标记为可发布、查看订单或确认码、查看所有者的其他草稿或批次、再发邀请、修改所有者账号或读取所有者的宿舍楼。
- 撤销或过期后，协助人的下一次读写立即 404。所有者与协助人同时编辑时由版本号保护，后保存的一方 409。
- 所有者发布时，确认框写明：「内容由他人协助整理，商品所有者已检查并确认发布。」商品的 `seller_id` 与 `published_by` 都是所有者，`assisted_by` 记录协助人。
- 文案一律是「协助整理发布」，从不写成代卖或平台代理（源码守卫）。

## 5. 价格参考

- 口径（5.7 起）：**只读订单上的不可变快照**（V8）——学校、分类、成色、商品形态、教材版本与成交价一起在下单的同一事务里
  从服务端商品记录写入，客户端不能提交，触发器禁止事后改写。同一学校看 `school_id_snapshot`；只统计 `COMPLETED` 订单；
  排除整套打包看 `listing_kind_snapshot`；五个维度或成交价任一为空的订单（V8 之前的旧订单）一律排除，不从商品当前值回填；
  模块 6 起再排除 `visibility_snapshot = 'CIRCLE_ONLY'` 的圈子成交，公开参考不泄露圈子内的交易。
  维度只有分类（必填）、成色、教材版本（仅教材书籍）。其他参数（例如 `groupBy`、`sellerId`、`schoolId`）一律 400。
- 样本少于 8 笔：`sufficient: false`，**不给区间，也不给样本数**。
- 足够时返回中位数与上下四分位数（与 PostgreSQL `percentile_cont` 相同的线性插值），金额按量级取整
  （百元以下到 1 元、千元以下到 5 元、以上到 10 元），时间范围只到月。
- 防差分：样本数只给下界档位（8、10、15、20…），相邻两次查询之间多成交一笔通常看不出变化；维度固定，不能任意组合切出某一笔交易。
- 不返回任何单笔价格、买卖双方、商品标题、成交日期或宿舍楼。
- 固定说明：「这是校内历史已完成交易的统计参考，不是平台估价或成交保证。」界面从不出现估价、官方指导价、保证成交一类说法。
- 卖家在成交后修改商品的分类、成色、校区、形态或教材关联，统计完全不变（`PriceGuidanceIT` 与 Mock 契约测试都有这条行为断言）。

## 6. 限流

复用 `rate_limit_counters`（按账号计数，不只看 IP；计数在独立事务里写入，失败也计数）：

| 作用域 | 默认 | 配置键 |
|---|---|---|
| 新建草稿 | 120 次 / 小时 | `campus-market.rate-limit.listing-draft-create.*` |
| 批量发布 | 30 次 / 小时 | `campus-market.rate-limit.listing-batch-publish.*` |
| 创建邀请 | 20 次 / 天 | `campus-market.rate-limit.assist-invite-create.*` |
| 兑换邀请 | 10 次 / 10 分钟 | `campus-market.rate-limit.assist-invite-redeem.*` |
| 价格参考 | 60 次 / 10 分钟 | `campus-market.rate-limit.price-guidance.*` |

超出返回 429、`Retry-After` 与 `requestId`。邀请码、草稿内容、描述都不写日志（`AssistInviteIT` 用输出捕获断言）。

## 7. 前端

- **毕业季快速发布** `/publish/batch`（懒加载路由，全年可用）：新建批次、添加单件或整套打包（最多 20 件）、
  可选「复制上一件的通用字段」（只复制校区、取货楼栋、联系方式；分类、价格、成色、验货声明、图片、明细都逐件填写）、逐件保存、
  「检查全部」列出缺项清单（获得焦点，点击条目把焦点带到那一件的标题）、一次确认发布、结果标题获得焦点。
  不预选验货「正常」，不猜教材版本，不读相册，不申请相机权限，不把所有条目设成同一分类；发布被拒时不假装部分成功，其他条目的内容都还在。
- 多标签页：保存时 409 → 提示「已在其他页面或被协助人保存过」，提供「重新加载这件」，不静默覆盖、不自动合并。
- 发布页 `/publish` 增加「单件 / 整套打包」切换；整套打包表单默认 2 行空明细，添加 / 删除行有焦点管理。
- 协助页 `/assist`：手动输入或从 `#code=` 读取邀请码；只显示可以整理的字段，没有联系方式、图片、成色或发布按钮。
- 价格参考卡片出现在发布页、工作台与协助页。

## 8. Mock / REST 契约

- Mock schema 升到 **v7**：新增 `listingDrafts`、`listingBatches`、`listingPublishRequests`、`listingAssistInvites`（只有哈希）、
  `listingAssistEvents`、`bundleItems`、`productAttribution`，以及订单的 `priceSnapshot / currency`。
- v1～v6 都能升级到 v7，迁移幂等（二次迁移深度相等）；旧商品为 `SINGLE`；旧订单成交价快照显式为 `null`，不猜；不伪造任何草稿、批次或协助关系；
  只修正与 V6 种子逐项精确匹配的演示 ISMN；单条损坏的记录只丢弃该条（带明文邀请码的邀请记录直接丢弃）；更高版本的数据不被降级或覆盖；不改动无关的 localStorage key。
- Mock 的批量发布在内存副本上进行，暂停落盘，整批成功后一次写入；失败时恢复副本，localStorage 从未出现中间状态。
- Mock 的限流计数只在内存中（按账号），刷新即清零。
- 契约测试：`src/api/supply.contract.test.ts` 与后端 `ListingBatchIT`、`BundleListingIT`、`AssistInviteIT`、`PriceGuidanceIT` 的关键断言逐条对应。

## 9. 双模式构建（4.8B）

```bash
npm run build:rest   # tsc --noEmit && vite build --mode rest --outDir dist
npm run build:mock   # tsc --noEmit && vite build --mode mock --outDir dist-mock
npm run build:all    # 两种构建 + 产物检查
npm run build        # 5.7B 起等同于 build:all
```

显式模式下 Vite 的 `envDir` 指向不放 `.env` 的 `build-modes/` 目录，`VITE_API_MODE` 在构建期写成字面量：结果只由命令决定，不受本机 `.env` 影响。
`scripts/check-bundles.mjs` 检查 REST 产物不含离线 Mock（存储键、演示种子、Mock 专用标识），Mock 产物不含 REST 传输层（认证刷新、批量发布、价格参考等路径），
并要求每个标记在另一份产物里存在，避免检查空转。`chunkSizeWarningLimit` 保持 1500 未调高。部署镜像（`deploy/web.Dockerfile`）使用 `npm run build:rest`。

5.7B：`npm run build` 不再按本机 `.env` 决定模式，而是执行 `build:all`。`npm run check:deterministic` 在「未设置 / `VITE_API_MODE=mock` /
`VITE_API_MODE=rest`」三种环境下各构建一次，逐字节比较 `dist/` 与 `dist-mock/`，任何差异都会失败。

## 10. 性能证据

`SupplyPerformanceIT` 在 10,000 草稿、1,000 批次（5,000 条目）、20,000 商品（2,000 件整套打包，5～30 条明细）、10,000 笔带快照的已完成订单上，
对生产 Mapper SQL 执行 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`，只断言计划形状与语句条数，不断言毫秒数，也不关闭顺序扫描：

- 我的草稿：`listing_drafts_owner_updated` 取页，所在批次按 `listing_batch_items_one_open_batch` 探测。
- 批次详情 / 列表 / 发布时的草稿行锁 / 幂等查询：全部走索引；批次详情的语句条数 1 件与 20 件相同（草稿一次取回、参考数据一次预读）。
- 打包：明细按主键前缀；卡片摘要不逐卡查询；详情与下单的语句条数 2 条与 30 条明细相同。
- 价格参考：多校规模（21 所学校、约 7 万笔已完成订单）下只读订单快照，经部分索引聚合，不扫订单或商品全表，也不再连接商品表。
  V7 的 `products_single_campus_category`、`orders_completed_price_snapshot` 已由 V8 的 `orders_trade_guidance` 取代，
  模块 6 的 V9 再换成排除圈子成交的 `orders_public_trade_guidance`（`SupplyPerformanceIT` 断言当前计划使用它）。

## 11. 已知限制

- 图片仍是预置地址，没有真实上传服务。
- 协助邀请只能整理内容，没有「协助人代为回复买家」之类的能力，这是刻意的边界。
- V8 之前成交的订单没有维度快照，不计入价格参考；数据量小的学校长期拿不到区间。
- 批次上限 20、明细上限 30 是产品取舍，不是性能上限。
- jsdom 无法检查颜色对比度，自动化无障碍检查通过不等于 WCAG 合规。
