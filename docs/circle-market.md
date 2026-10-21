# 圈子集市（模块 6）

圈子让同学在班级、社团、兴趣小组这样的小范围里交易：卖家可以把商品设为「仅圈子可见」，只有所选圈子的在籍成员能看到。
圈子**都是用户自己创建的**：平台不核验班级或社团身份，没有「官方」字段，不会根据宿舍楼自动建圈，界面从不出现「官方认证」一类说法。

## 1. 数据模型（V9）

| 表 | 要点 |
|---|---|
| `circles` | 类型 `CLASS / CLUB / INTEREST / OTHER`；可见性 `PRIVATE`（默认，只有成员知道）/ `DISCOVERABLE`（本校可搜到名称与简介）；状态 `ACTIVE / ARCHIVED`（归档不可逆）；学校与创建时间不可改；不能删除 |
| `circle_memberships` | 主键 (circle_id, user_id)；角色 `OWNER / MODERATOR / MEMBER`；状态 `ACTIVE / LEFT / REMOVED`；同校；在籍 OWNER 恰好一个（部分唯一索引 + 延迟约束触发器）；不能删除 |
| `circle_invites` | 只存 SHA-256 哈希（64 位十六进制）；默认 24 小时，最长 7 天；一次性；状态 `PENDING / REDEEMED / REVOKED`（过期由时间推导） |
| `circle_events` | 审计：创建、邀请生成 / 撤销 / 兑换、加入、退出、移除、角色变化、转让、归档；只增不改 |
| `product_circle_visibility` | `PUBLIC` 商品没有行；`CIRCLE_ONLY` 商品 1～5 行；圈子必须 ACTIVE、同校，卖家必须是在籍成员（写入时触发器校验，提交时延迟约束复核行数） |
| `demand_subscriptions.circle_id` | 圈子订阅：范围固定为全校、不能带教材版本，只有在籍成员能创建 |
| `orders.visibility_snapshot` | 下单时冻结商品的可见范围，之后不可改写；价格参考据此排除圈子成交 |

迁移只加结构：旧商品全部 `PUBLIC`，不创建任何圈子、成员或邀请（`FlywayLegacyBaselineIT` 场景 I）。

## 2. 唯一的可见性口径

V9 定义两个 SQL 函数，后端所有读取入口都调用它们，Mock 以同名逻辑 `visibleTo / readableBy` 镜像：

- `product_visible_to(商品, 查看者)`：`PUBLIC`；或查看者是卖家；或查看者是该商品某个 ACTIVE 圈子的在籍成员。
  用于列表、搜索、计数、首页与楼栋 feed、圈子商品流、收藏列表、需求匹配、需求收件箱与未读数、教材在售数与在售列表。
- `product_readable_by(商品, 查看者)`：在上面基础上，再允许**这件商品上**未取消、未过期订单的买卖双方。
  用于商品详情 / 分享链接、浏览计数、评论、会话与消息、订单流程。

**订单参与者例外只针对那一件商品**：成员下单后被移出圈子，仍能查看这件商品并完成交易；但看不到卖家在同一圈子的其他商品，
列表和 feed 里也不会再出现这件商品（`CircleMarketIT` 12）。

无权访问与不存在返回同一个 404、同一句话，不暴露私密商品或私密圈子是否存在。

| 入口 | 规则 | 行为测试 |
|---|---|---|
| 列表 / 搜索 / 计数 | visible | `CircleMarketIT` 9、18；`circle.contract` 9、18 |
| 首页 / 楼栋 feed | visible | 同上 |
| 圈子商品流 | 只有在籍成员；只含关联到该圈子的商品 | `CircleMarketIT` 10；`circleUi` 圈子商品流 |
| 商品详情 / 分享 / 浏览 | readable | `CircleMarketIT` 9、12 |
| 收藏（列表 / 加入） | 列表 visible；加入需 readable | `CircleMarketIT` 11 |
| 评论 | readable | `CircleMarketIT` 9 |
| 会话 / 消息 / 未读 | 买方需 readable | `CircleMarketIT` 11 |
| 需求匹配 / 收件箱 / 未读 | visible，且圈子商品只匹配同一圈子的圈子订阅 | `CircleMarketIT` 13、14 |
| 教材在售数 / 在售列表 | visible | `CircleMarketIT` 9 |
| 下单 | readable（在加锁后复核） | `CircleMarketIT` 9、12；`CircleConcurrencyIT` 1 |
| 价格参考 | 按订单快照排除圈子成交 | `CircleMarketIT` 15 |
| 公开资料 / 交易履历 | 不含任何圈子信息 | `CircleMarketIT` 17 |

圈子标签只返回给有权查看的人，而且只列出**查看者自己也在籍**的圈子（卖家看到全部）。卡片与详情页据此显示「圈子可见 · 圈子名」。

## 3. 权限

- 创建：任何登录用户（每日 10 个）；创建者成为 OWNER。
- 查看详情：成员看到完整资料与自己的角色；非成员只能看到 `DISCOVERABLE` 圈子的名称 / 简介 / 类型；其余 404。
- 成员名单：OWNER / MODERATOR 可见，只有昵称、头像、角色、加入时间；普通成员 403。
- 邀请：OWNER / MODERATOR 生成（每日 30 个，1～168 小时）；邀请码原文只在生成的那次响应里出现，链接写成 `/circles/join#code=…`，
  放在 `#` 之后不进服务器日志；兑换每次尝试都计入限流（10 分钟 10 次，超出 429）；无效、过期、已用、已撤销、他校一律 404「邀请码无效或已失效」。
- 角色：只有 OWNER 能调整角色、转让所有者（原所有者变为 MODERATOR）、修改类型与可见性、归档。MODERATOR 只能移除普通成员。
  OWNER 不能直接退出（409），需要先转让或归档。
- 加入只有邀请一条路：没有「申请加入」，也没有公开的加入按钮。

## 4. 发布与编辑

- 可见范围默认 `PUBLIC`；`CIRCLE_ONLY` 必须提交 1～5 个不重复的圈子 id，卖家必须在籍，圈子必须 ACTIVE 且同校，否则 400 / 404。
  `PUBLIC` 带圈子是 400。
- 单件、整套打包、批量发布都支持。批量发布逐项校验（`INVALID_CIRCLE`），发布时加锁复核；任何一件失败整批回滚。
- 协助整理的人不能替所有者选圈子：`visibility / circleIds` 不在协助人可写字段里（403），协助页也不显示这一项。
- `PUBLIC → CIRCLE_ONLY`：非成员的收藏从列表消失、再收藏 404，未成交会话与消息不可见；已经成立的订单不受影响。

## 5. 圈子订阅

- 只有在籍成员能创建；范围固定为这个圈子，界面显示「圈子：名称」。
- 圈子商品只匹配绑定同一圈子的订阅；公开商品只匹配普通订阅（`demand_subscriptions_match_public` 排除了圈子订阅）。
- 退出、被移除或圈子归档：该圈子的订阅停用、旧匹配失效、未读清零；非成员不能重新启用（404）。

## 6. 并发与锁

- 成员关系的所有变更（加入、退出、移除、角色、转让）与归档都先锁圈子行（`FOR UPDATE`）。
- 发布、下单、创建圈子订阅按固定顺序先对圈子行、再对成员行取 `FOR SHARE`，与上面的变更互斥，且不会互相死锁。
- `users.lockById` 使用 `FOR NO KEY UPDATE`，不与审计事件插入时外键检查取的 `KEY SHARE` 冲突。
- MyBatis 本地缓存改为语句级：加锁之后重新读取的行一定是锁后的最新值。
- 状态变化时间戳使用 `clock_timestamp()`，保证 `updated_at ≥ created_at` 在并发提交下仍成立。

`CircleConcurrencyIT` 在真实 PostgreSQL 上跑 7 组竞态（每组多轮）：移除 × 下单、归档 × 发布、改为圈子可见 × 收藏、
同一邀请码 8 人并发兑换、转让 × 退出与并发转让、批量发布 × 成员资格失效、创建圈子订阅 × 移除。每轮结束后断言不变量。

## 7. 性能证据

`CirclePerformanceIT` 在 1,000 个圈子、20,000 条成员关系、50,000 件商品（公开与圈子可见混合）、10,000 条圈子订阅上，
对生产 Mapper SQL 执行 `EXPLAIN (ANALYZE, BUFFERS)`，断言计划形状与语句条数（不断言毫秒数）：

- 首页公开列表：按新增的 `products_created_order` 顺序读取、凑满一页即停；圈子关系只按索引探测。
  没有这个索引时是商品全表扫描 + 排序（本机观测约 511 ms → 0.63 ms，仅供参考，不作为断言）。
- 圈子商品流按 `product_circle_visibility_circle` 取回；商品详情权限按主键。
- 需求匹配：圈子商品走 `demand_subscriptions_match_circle`，公开商品走 `demand_subscriptions_match_public`。
- 我的圈子走 `circle_memberships_user_active`；成员管理按主键前缀。
- 没有 N+1：关联 1 个与 5 个圈子时，列表与详情的语句条数相同；公开列表的语句条数与圈子功能无关。

## 8. 前端

- 懒加载页面：`/circles`（我的圈子 + 可发现）、`/circles/new`、`/circles/:id`、`/circles/:id/products`、`/circles/:id/manage`、`/circles/join`。
- 发布页、整套打包表单、批量工作台都有「谁能看到这件商品」：全校公开 / 圈子可见（`aria-pressed` 按钮），圈子多选（最多 5 个，
  其余自动禁用），并实时写明「只有「…」的在籍成员和你自己能看到」。只在选择「圈子可见」后才读取我的圈子。
- 退出确认写明三条后果：圈子订阅将停用；私密商品将不可见；已经成立的订单不受影响。
- 隐私：圈子名、成员关系、搜索词不写进地址栏 query，不写日志、不上报分析；邀请码只在 `#` 片段与请求体中，读取后立即从地址栏抹掉，
  不写入 localStorage / sessionStorage。发现页的搜索词只作为 API 请求参数发送（只匹配 `DISCOVERABLE` 圈子），不会出现在页面地址里。

## 9. Mock schema v9

- 新增 `circles / circleMemberships / circleInvites / circleEvents / circleSeq / productCircleVisibility`，订阅增加 `circleId`，订单增加 `visibilitySnapshot`。
- v1～v8 均可升级：旧商品 `PUBLIC`，不创建圈子、不替任何人入圈，种子里没有预置的班级或社团。
- 更高版本的数据不降级、不覆盖；带明文邀请码、`official` 字段或损坏的圈子记录逐条丢弃；损坏的可见关系不会让私密商品变成公开。
- 权限结论与后端一致：`src/api/circle.contract.test.ts` 与 `CircleMarketIT` 的 18 组断言编号一一对应。

## 10. 测试

| 层 | 测试 |
|---|---|
| 后端 HTTP | `CircleMarketIT`（18 组，每个入口都是真实 HTTP 行为） |
| 数据库约束 | `CircleSchemaIT`（5 组） |
| 并发 | `CircleConcurrencyIT`（7 组竞态） |
| 性能计划 | `CirclePerformanceIT`（6 组 EXPLAIN / 语句条数） |
| 迁移 | `FlywayLegacyBaselineIT` 场景 I、`PostgresSchemaIT` |
| Mock 契约 | `circle.contract.test.ts`（19）、`mockMigrationV9.test.ts`（5） |
| 界面 / 无障碍 / 键盘 | `circleUi.test.tsx`（14：axe、焦点、菜单方向键与回车、对话框焦点恢复、错误摘要跳转、邀请码只显示一次） |
| 补充源码守卫 | `circleGuards.test.ts`（只补充，不替代行为测试） |

## 11. 已知限制

- 模块 6.1 / 7 已收口的三项（详见 [commitment-and-moderation.md](commitment-and-moderation.md)）：
  - 学校隔离：「PUBLIC」表示当前学校公开；商品读取需要登录，他校商品与不存在同为 404；
  - 邀请登录连续性：未登录打开邀请链接时，邀请码只在页面内存里保留到登录回来，仍需用户确认才加入；刷新页面会丢失（安全取舍）；
  - 成员分页（默认 20、最大 100）与单圈 1000 人在籍上限。
- 平台工作人员可以强制归档违规圈子（需要高级工作人员），圈子所有者之外终于有了治理入口；但平台不做圈子内纠纷的仲裁。
- 圈子没有成员搜索。
- axe 在 jsdom 中无法计算颜色对比度；键盘测试用焦点与按键事件模拟，自动化检查通过不等于 WCAG 合规。
