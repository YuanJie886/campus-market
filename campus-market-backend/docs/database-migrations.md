# 数据库迁移操作手册

> 适用范围：`campus-market-backend`
> 生效版本：Flyway 接管之后（模块 0.5C 起）

---

## 1. Flyway 是唯一的数据库结构管理入口

自本版本起，**Flyway 是本项目创建和演进数据库结构的唯一途径**。

此前的 `DatabaseInitializer`（启动时读取 `db/schema.sql`、按分号切分逐条执行 `CREATE TABLE IF NOT EXISTS`）已被**删除**，`db/schema.sql` 与仅服务于它的 `SchemaMapper` 也一并删除。项目中**不再存在第二个建表入口**。

应用启动时由 Spring Boot 自动执行 Flyway 迁移，使用应用自身的 `DataSource`，不需要额外的数据库账号。

---

## 2. 迁移目录位置

```
campus-market-backend/src/main/resources/db/migration/
├── V1__initial_schema.sql       14 张业务表、6 个具名索引、参考数据
├── V2__rate_limit_counters.sql  主体维度限流计数表（基础设施表）
├── V3__building_market.sql      楼栋参考数据、宿舍楼/取货楼栋关联、面交点坐标
├── V4__demand_radar.sql         需求订阅与匹配、复合外键用的唯一约束、一栋停用演示楼
├── V5__trusted_meeting_flow.sql 验货模板/声明/订单快照、档期提议、出发到达、流程事件、面交点启用状态
├── V6__course_textbook_graph.sql 课程、开课、教材版本目录、课程教材关系、教材建议、商品教材关联、精确版本订阅
├── V7__graduation_supply_engine.sql 发布草稿、批量发布与幂等记录、整套打包明细、协助整理邀请与审计、订单成交价快照；4.8 演示教材 ISMN 修正
├── V8__immutable_trade_dimensions.sql 5.7：订单冻结学校 / 分类 / 成色 / 形态 / 教材版本五个统计维度；价格参考改读快照
├── V9__circle_market.sql        模块 6：圈子、成员、邀请（只存哈希）、审计事件、商品可见范围、圈子订阅、订单可见性快照、权威可见性函数
├── V10__commitment_and_moderation.sql 模块 6.1 / 7：学校口径的可见性函数、同校触发器、圈子成员分页索引与 1000 人上限；取消记录、爽约报告、工作人员、举报 / 案件 / 动作 / 申诉、用户限制
└── V11__slots_corrections_and_content_moderation.sql 模块 7.1：明确档期快照与档期冻结、爽约只认快照；自动限制 SYSTEM_RULE + 规则版本 + 依据 + 纠正记录；工作人员利益回避函数；评论隐藏 / 单条私信隔离
```

### V11 的升级路径

当前最新版本为 **11**。V1～V10 全部冻结（checksum 由 `FlywayLegacyBaselineIT` 场景 K 校验不变）；V11 是模块 7.1 新增、尚未发布的迁移，后续变更从 V12 开始。

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V11 | `PostgresSchemaIT`（11 条历史记录、54 张业务表） |
| 旧库 baseline 到 1 | V2 → V11（10 条） | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V9 | 仅 V10（场景 J 固定停在 V10） | 场景 J |
| 已在 V10（模块 7 的库） | 仅 V11 | 场景 K（V1～V10 checksum 不变、二次启动 0 条） |

**V11 不猜、不伪造**：

- 旧的原始预约（revision 0）在 V11 之前从未保存结束时间：**不补写结束时间、不生成档期快照**；这些订单上的爽约报告只能驳回 / 失效，
  数据库触发器拒绝把它们改为已承认 / 已确认；也不能事后给旧预约补一个结束时间（只能通过改约握手确认一个完整的新档期）。
- 只为**真实被接受过的改约**（`order_meeting_proposals.revision ≥ 1`，本来就有完整的开始 / 结束时间）回填快照，来源记为 `LEGACY_ACCEPTED_PROPOSAL`。
- V10 的 `NO_SHOW_RULE` 限制一次性改名为 `SYSTEM_RULE`，补规则版本 `NO_SHOW_V1`、决定时间 = 创建时间、依据 = 来源报告 + 决定前 30 天内仍已确认的报告；
  人工（CASE）限制只补决定时间。已有治理动作补上「涉及的用户」。这三处数据改写只在迁移内临时停用对应的只增不改 / 限制守卫，随后立即恢复。
- 不生成纠正记录，不隐藏任何评论或私信。

主要数据库保证：新预约必须带结束时间；档期只能随版本号增加变化；快照只增不改；爽约报告与承认 / 确认必须有快照；
自动限制只能按一条纠正记录缩短或撤销、不能延长；人工限制不能被重算改动；评论与私信正文不可改写，处置过的不能删除；
`staff_case_conflict / staff_appeal_conflict / eligible_staff_for_*` 给出利益回避结论。详见 `docs/commitment-and-moderation.md` 的 7.1 一节。

### V10 的升级路径

V10 发布时的最新版本为 **10**（现已冻结，见上一节）。

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V10 | `PostgresSchemaIT`（10 条历史记录、51 张业务表）、`GovernanceSchemaIT` |
| 旧库 baseline 到 1 | V2 → V10（9 条） | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V8 | 仅 V9（场景 I 固定停在 V9 验证 V9 本身） | 场景 I |
| 已在 V9（模块 6 的生产库） | 仅 V10 | 场景 J（V1～V9 checksum 不变、二次启动 0 条） |

**V10 只加结构，不伪造任何数据**：没有工作人员、举报、案件、处罚或爽约记录；旧的已取消订单不补写取消原因；旧商品都没有被隐藏。
主要数据库保证：

- 用 `CREATE OR REPLACE` 重新定义 V9 的 `product_visible_to / product_readable_by`（4 参数版本委托给新增的 6 参数版本）：
  加入「商品校区属于查看者的学校」与「被治理隐藏的商品只有卖家看得到」；未登录（NULL）一律不可见。V9 文件本身一个字节都没有改。
- `products_same_school_guard`：商品校区必须与卖家同校；`orders_same_school_guard`：新订单买家必须与商品同校。
- `circle_memberships_page` 分页索引（含 `INCLUDE (role)`）与 `circle_member_cap_guard`（先锁圈子行再计数，在籍上限 1000）。
- 取消记录一张订单至多一条、只能跟随取消状态写入、只增不改；爽约报告的参与者约束与状态机；工作人员只能属于本人学校、不能删除；
  案件结果不可更换；举报与动作只增不改；申诉只能决定一次；限制最长 30 天、只能撤销一次、不能删除。
- 索引的理由见 `SchoolIsolationIT`、`CircleMemberLimitIT`、`GovernancePerformanceIT` 与 `docs/commitment-and-moderation.md`。

首个工作人员的配置方式见 [`staff-runbook.md`](staff-runbook.md)。

### V9 的升级路径

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V9 | `PostgresSchemaIT`（9 条历史记录）、`CircleSchemaIT` |
| 旧库 baseline 到 1 | V2 → V9（8 条） | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V6 | V7（场景 G 固定停在 V7 验证 V7 本身） | 场景 G |
| 已在 V7（模块 5 的生产库） | 仅 V8（场景 H 停在 V8） | 场景 H |
| 已在 V8（5.7 的生产库） | 仅 V9 | 场景 I（V1～V8 checksum 不变、二次启动 0 条） |
| 未知的非空库 | 拒绝启动 | 场景 B |

**V8 只加结构，不回填**：订单新增 `school_id_snapshot / category_snapshot / condition_snapshot / listing_kind_snapshot /
textbook_edition_id_snapshot`，与 `price_snapshot` 在下单的同一事务里从服务端商品记录写入，客户端不能提交；触发器
`orders_trade_dimensions_guard` 禁止事后改写（包括给旧订单补写）。V8 之前的订单五项一律为 `NULL`，价格参考直接排除这些
维度不完整的订单。`orders_trade_guidance` 部分索引替换了 V7 的 `orders_completed_price_snapshot`；V7 的
`products_single_campus_category` 不再被查询使用，一并删除。

**V9 只加结构，不伪造身份**：不创建任何圈子、成员、邀请或宿舍圈，旧商品一律 `visibility = 'PUBLIC'` 且没有圈子关系，
旧订阅 `circle_id` 为空，旧订单 `visibility_snapshot` 为空且触发器不允许补写。没有「官方」列：所有圈子都是用户创建的。
主要数据库保证：

- 圈子恰好一个 OWNER（部分唯一索引 + 延迟约束触发器），成员与圈子同校，成员关系与审计事件不能删除；
- 邀请只存 64 位十六进制哈希，有效期不超过 7 天，状态 PENDING / REDEEMED / REVOKED；
- `PUBLIC` 商品没有可见关系，`CIRCLE_ONLY` 商品 1～5 个圈子，且卖家是这些同校、ACTIVE 圈子的在籍成员（延迟约束触发器）；
- `product_visible_to` / `product_readable_by` 两个 SQL 函数是可见性的唯一口径：列表、计数、feed、收藏、需求匹配、收件箱、
  未读数用前者；单个商品的直接访问用后者（再加「有未取消、未过期订单的参与者」）；
- 圈子订阅只能是全校范围、不能带教材版本，只有在籍成员能创建；
- 新增 `products_created_order`（首页最新排序）、`demand_subscriptions_match_circle / _match_public`（替换 V4 的
  `demand_subscriptions_match_plain`）、`orders_public_trade_guidance`（替换 V8 的 `orders_trade_guidance`，排除圈子成交）。
  每个索引的理由见 `CirclePerformanceIT` 的 EXPLAIN 断言与 `docs/circle-market.md`。

### V1～V7 的 checksum

5.7 与模块 6 的全部工作没有修改 V1～V7 的任何字节。维护者可以用以下命令核对（`shasum -a 256`，前 16 位）：

```bash
shasum -a 256 src/main/resources/db/migration/V[1-7]__*.sql
```

场景 H、I、J 会在真实 PostgreSQL 上断言 `flyway_schema_history` 中 V1～V7（场景 H）/ V1～V8（场景 I）/ V1～V9（场景 J）的 checksum 在升级前后完全相同。
模块 6.1 / 7 同样没有修改 V1～V9 的任何字节（V8 前 16 位 `9ca4469a516c169e`，V9 前 16 位 `2bd7d7d436d6387c`）。

### V7 的升级路径

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V7 | `PostgresSchemaIT`、`SupplySchemaIT` |
| 旧库 baseline 到 1 | V2 → V7（6 条） | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V2 / V3 / V4 / V5 | 5 / 4 / 3 / 2 条 | 场景 C / D / E / F（F 先停在 V6 验证 V6 本身） |
| 已在 V6（模块 4 的生产库） | 仅 V7 | 场景 G（V1～V6 checksum 不变、二次启动 0 条） |
| 未知的非空库 | 拒绝启动 | 场景 B |

V7 **只加结构，不伪造任何数据**：没有草稿、批次、邀请、打包明细或协助关系；旧商品一律 `listing_kind = 'SINGLE'`，
`published_by / assisted_by` 为空；旧订单的 `price_snapshot / currency` 保持 `NULL`——不从 `orders.price` 猜，触发器也不允许事后补写。

V7 唯一的数据更新是 **4.8 演示教材修正**：V6 植入的 5 条演示教材曾使用 979-0（乐谱号 ISMN）号段，V7 按
id + `is_demo` + 学校 + 原号码 + 书名 + 版次六项精确匹配，把它们改为「无 ISBN」并写入稳定指纹；被改过的演示行和任何用户数据都不动
（场景 G 用一条被维护者改过书名的演示行和一条号码同样在 979-0 号段的用户行验证）。商品快照里的 979-0 号码只在对应版本确实被修正时才清掉，
为此在本迁移内临时停用、随即恢复了 V6 的快照保护触发器。V6 的 `isbn13_is_valid` 函数没有被重新定义。

V7 新增 8 个具名索引。其中 `orders_completed_price_snapshot` 与 `products_single_campus_category` 是给**既有表**加的部分索引，
服务于价格参考聚合：`SupplyPerformanceIT` 在多校规模下显示，没有它们时是订单全表顺序扫描，有了之后是「本校校区 → 同分类单件商品 → 仅索引扫描取快照」。
设计说明见仓库根目录 `docs/graduation-supply-engine.md`。

### V6 的升级路径

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V6 | `PostgresSchemaIT`、`TextbookSchemaIT` |
| 旧库 baseline 到 1 | V2 → V6（5 条） | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V2 / V3 / V4 | 4 / 3 / 2 条 | 场景 C / D / E |
| 已在 V5（模块 3 的生产库） | 仅 V6 | 场景 F（V1～V5 checksum 不变、二次启动 0 条、旧订阅与匹配原样） |
| 未知的非空库 | 拒绝启动 | 场景 B |

V6 **不替任何旧商品猜教材版本**，也不生成选课、订阅或建议记录。它植入的是明确标记 `is_demo` 的虚构演示目录：
5 门「演示课程」、6 个开课、6 个版本。其中 5 个版本当时用了 979-0 号段作演示号码——那是乐谱号（ISMN）而不是图书 ISBN，已由 V7 更正为「无 ISBN」（见上文 V7）。
V6 通过 ALTER 扩展了 V4 的两张表：`demand_subscriptions` 增加 `textbook_edition_id`；
`demand_matches` 的理由码 CHECK 增加 `TEXTBOOK_EXACT`，原约束按定义内容定位后替换，不依赖系统生成的名字。
V6 新增 12 个具名索引，其中 `demand_subscriptions_match_plain` 是给**既有表**加的。
它是 `(school_id, category)` 部分索引，但排除了教材版本订阅，这样每发布一件教材商品不必把全校的教材订阅逐条扫一遍（执行计划见 `TextbookPerformanceIT`）。
V4 的 `demand_subscriptions_match_category` 仍然保留。设计说明见仓库根目录 `docs/course-textbook-graph.md`。

### V5 的升级路径

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V5 | `PostgresSchemaIT`、`TrustedFlowSchemaIT` |
| 旧库 baseline 到 1 | V2 → V5（4 条） | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V2 | V3、V4、V5 | 场景 C |
| 已在 V3 | V4、V5 | 场景 D |
| 已在 V4（模块 2 的生产库） | 仅 V5 | 场景 E（同时验证 V1～V4 checksum 不变、二次启动 0 条） |
| 未知的非空库 | 拒绝启动 | 场景 B |

V5 **不伪造任何事实**：升级后没有任何商品声明、订单验货、档期提议或到达记录；旧订单 `meeting_revision = 0`，
`meeting_ends_at` 为空。旧订单在接口里显示为「无结构化验货记录」，照常按原流程确认与核销。

V5 还给既有表 `order_events` 加了索引 `order_events_order_created (order_id, created_at)`：订单时间线按订单读事件，
EXPLAIN（1 万订单）显示原先是全表扫描，加索引后为索引扫描。这是本次唯一针对既有表的新索引；
其余查询经 EXPLAIN 确认已有索引足够，没有为「凑数」加索引。设计说明见仓库根目录 `docs/trusted-meeting-flow.md`。

### V4 的升级路径

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V4 | `PostgresSchemaIT`、`DemandSchemaIT` |
| 旧库 baseline 到 1 | V2 → V4 | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V2 | V3、V4 | 场景 C |
| 已在 V3（模块 1 的生产库） | 仅 V4 | 场景 D（同时验证 V1～V3 checksum 不变） |

V4 不伪造任何订阅或匹配。它会给 `campuses` 与 `buildings` 各加一条唯一约束（供复合外键使用），
并插入一栋**停用**的演示楼 `east-songyuan-6`。需求雷达设计见仓库根目录 `docs/demand-radar.md`。

### V3 的升级路径

| 起点 | 执行的迁移 | 验证用例 |
|---|---|---|
| 全新空库 | V1 → V2 → V3 | `PostgresSchemaIT`、`BuildingSchemaIT` |
| 旧 DatabaseInitializer 库（baseline 到 1） | V2 → V3 | `FlywayLegacyBaselineIT` 场景 A |
| 已在 V2 的库（阶段 0.9 的生产库） | 仅 V3 | `FlywayLegacyBaselineIT` 场景 C |
| 已在 V3 | 0 条 | 三个用例的「二次启动」断言 |

V3 **不推断任何关联**：升级后所有用户的 `dorm_building_id` 与所有商品的 `building_id` 都是 `NULL`。
楼栋设计与隐私边界见仓库根目录 `docs/building-market.md`。

配置项在 `src/main/resources/application.yaml`：

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    baseline-on-migrate: ${SPRING_FLYWAY_BASELINE_ON_MIGRATE:false}
    baseline-version: 1
    baseline-description: legacy-schema-v1
    clean-disabled: true
```

---

## 3. 禁止修改已执行的 V1

`V1__initial_schema.sql` **一旦在任何环境（包括开发同事的本地库、CI、测试环境）执行过，就不得再修改**。

Flyway 会把每个迁移脚本的 checksum 写入 `flyway_schema_history`。修改已执行脚本会导致下次启动时 `validate-on-migrate` 校验失败，应用直接拒绝启动。

**这是保护机制，不是障碍。** 遇到校验失败时正确的做法是回退你对 V1 的修改，而不是绕过校验。

---

## 4. 以后的结构变更一律新增版本

需要加字段、加表、改索引时，**新增**下一个版本（当前应为 `V12__<描述>.sql`），不要动已有的 V1～V11。
CI（`.github/workflows/ci.yml` 的 static 任务）会拒绝任何修改或删除已有迁移文件的提交。

命名规范：`V<版本号>__<下划线分隔的英文描述>.sql`（两个下划线）。例如：

```
V7__add_product_tags.sql
V8__add_inspection_evidence.sql
```

编写新迁移时：

- 只写该版本需要的增量变更，不要重复 V1 的内容
- 对已有数据的表加 `NOT NULL` 列时，必须提供 `DEFAULT` 或分步迁移
- 变更 `one_active_order_per_product` 的谓词前，先阅读 `OrderService` 的状态机，两者必须保持一致
- 新迁移同样要被 `PostgresSchemaIT` 覆盖

---

## 5. 禁止使用 flyway clean

`clean-disabled: true` 已在 `application.yaml` 中固化。

**任何环境都不得改为 `false`。** `flyway clean` 会删除 schema 下的全部对象，在生产库上执行等同于删库。

---

## 6. 全新空库启动流程

这是默认路径，无需任何额外配置。

```bash
# 1. 准备一个空的 PostgreSQL 16 数据库
docker compose up -d          # 项目根目录，仅用于本地开发

# 2. 正常启动后端
cd campus-market-backend
./mvnw spring-boot:run
```

启动时 Flyway 会：

1. 创建 `flyway_schema_history` 表
2. 执行 `V1__initial_schema.sql`，创建 14 张业务表、6 个具名索引、全部约束
3. 写入 1 所学校、4 个校区、12 个面交点的预置数据
4. 在历史表中记录一行 `version=1, type=SQL, success=true`

再次启动时 Flyway 发现 V1 已执行，`migrationsExecuted=0`，不会重复建表。

---

## 7. 旧库首次接管流程（从 DatabaseInitializer 升级）

**适用对象**：由旧版 `DatabaseInitializer` 建好结构、已有真实业务数据、但**没有** `flyway_schema_history` 表的数据库。

### ⚠️ 接管前必须理解的风险

**`baseline` 不会验证旧库的结构是否真的与 V1 一致。** 它只是在历史表里写一行「假定此库已处于版本 1」的记录，然后跳过 V1。

如果旧库的结构实际上与 V1 存在差异（例如当年手工改过某个字段、某个索引没建成功），baseline 会**静默接受**这种差异，后续的 V2 可能在一个与预期不符的结构上执行，导致难以定位的故障。

因此下面每一步都不能跳过。

### 步骤

**第 1 步：完整备份**

```bash
pg_dump -h <host> -U <user> -d campus_market -F c -f campus_market_before_flyway.dump
```

确认备份文件大小合理，并**实际验证过可以恢复**。没有验证过的备份不算备份。

**第 2 步：比对结构**

在测试环境用 V1 建一个全新库，与生产旧库做结构 diff：

```bash
# 参考：用 pg_dump 只导出结构后比对
pg_dump -s -h <old-host> -U <user> -d campus_market > old_schema.sql
pg_dump -s -h <new-host> -U <user> -d campus_market_v1 > v1_schema.sql
diff old_schema.sql v1_schema.sql
```

重点核对第 9 节列出的 14 张表、预置数据和 6 个索引。**存在差异时不要接管**，先补齐差异或编写对应的修复迁移。

**第 3 步：在测试环境演练**

用生产备份在测试环境还原一份，完整走一遍第 4~6 步，确认无误后再动生产。

**第 4 步：临时开启 baseline-on-migrate**

只在这一次部署时设置环境变量：

```bash
SPRING_FLYWAY_BASELINE_ON_MIGRATE=true
```

Docker Compose 部署时在 `campus-market-frontend/deploy/.env` 中设置，不要写进 `application.yaml`。

**第 5 步：启动应用**

Flyway 会写入一行 `version=1, type=BASELINE, description=legacy-schema-v1`，`migrationsExecuted=0`，**不会执行 V1**，既有数据完全不受影响。

**第 6 步：确认成功后立刻恢复 false**

```bash
SPRING_FLYWAY_BASELINE_ON_MIGRATE=false
```

然后重启一次，确认应用正常启动且 `migrationsExecuted=0`。

**`baseline-on-migrate=true` 不得长期保留。** 长期开启意味着任何未知的非空数据库都会被自动接管，这正是第 12 节要防止的事故。

---

## 8. 备份要求

| 场景 | 备份要求 |
|---|---|
| 全新空库首次启动 | 无需备份（库本来就是空的） |
| 旧库首次 baseline 接管 | **强制**，且必须验证过可恢复 |
| 执行任何新增的迁移（V2 起，包括 V11） | **强制**，步骤见 `docs/backup-and-restore.md` |
| 仅重启应用（无新迁移） | 不需要 |

---

## 9. 如何确认结构正确

接管或迁移后，用下列 SQL 核对。

**14 张业务表：**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name <> 'flyway_schema_history'
ORDER BY table_name;
```

应返回恰好 14 行：`campuses`、`comments`、`conversation_reads`、`conversations`、`favorites`、`meeting_points`、`messages`、`order_events`、`orders`、`products`、`reviews`、`schools`、`sessions`、`users`。

**预置数据（1 / 4 / 12）：**

```sql
SELECT (SELECT count(*) FROM schools)        AS schools,        -- 期望 1
       (SELECT count(*) FROM campuses)       AS campuses,       -- 期望 4
       (SELECT count(*) FROM meeting_points) AS meeting_points; -- 期望 12
```

**6 个具名索引：**

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN (
  'one_active_order_per_product','products_campus_created','products_seller',
  'orders_buyer','orders_seller','messages_conversation_created')
ORDER BY indexname;
```

**部分唯一索引的谓词（最关键的一项）：**

```sql
SELECT i.indisunique,
       (i.indpred IS NOT NULL) AS is_partial,
       pg_get_indexdef(i.indexrelid) AS indexdef
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'one_active_order_per_product';
```

`indisunique` 与 `is_partial` 都应为 `t`，`indexdef` 的谓词应排除 `CANCELLED`、`EXPIRED`、`COMPLETED`。

---

## 10. 如何检查 flyway_schema_history

```sql
SELECT installed_rank, version, description, type, checksum,
       installed_on, execution_time, success
FROM flyway_schema_history
ORDER BY installed_rank;
```

| 场景 | 期望的 `type` | 期望的 `description` |
|---|---|---|
| 全新空库执行 V1 | `SQL` | `initial schema` |
| 执行 V2 | `SQL` | `rate limit counters` |
| 执行 V3 | `SQL` | `building market` |
| 执行 V4 | `SQL` | `demand radar` |
| 执行 V5 | `SQL` | `trusted meeting flow` |
| 执行 V6 | `SQL` | `course textbook graph` |
| 执行 V7 | `SQL` | `graduation supply engine` |
| 执行 V8 | `SQL` | `immutable trade dimensions` |
| 执行 V9 | `SQL` | `circle market` |
| 执行 V10 | `SQL` | `commitment and moderation` |
| 执行 V11 | `SQL` | `slots corrections and content moderation` |
| 旧库 baseline 接管 | `BASELINE` | `legacy-schema-v1` |

`success` 必须全部为 `t`。**出现 `success = f` 的行说明有迁移执行到一半失败了**，见第 13 节。

---

## 11. 首次接管如何临时开启 baseline-on-migrate

见第 7 节第 4 步。要点重复一遍：

- 通过**环境变量** `SPRING_FLYWAY_BASELINE_ON_MIGRATE=true` 开启，不要改 `application.yaml`
- 只在确认过备份与结构 diff 之后开启
- 只针对**明确知道是本项目旧库**的数据库开启

---

## 12. 接管完成后如何恢复 false

```bash
SPRING_FLYWAY_BASELINE_ON_MIGRATE=false
```

重启应用并确认日志中 `migrationsExecuted=0`、无异常。

**绝不能对未知的非空数据库开启 `baseline-on-migrate`。** 默认的 `false` 会让 Flyway 在遇到「非空但没有历史表」的库时直接拒绝启动——这是一道刻意设置的安全闸，`FlywayLegacyBaselineIT` 中有专门的测试守护它。

---

## 13. 启动失败时禁止直接 repair 或删除历史表

迁移失败时，**不要**做下面任何一件事：

- ❌ `flyway repair`
- ❌ `DROP TABLE flyway_schema_history`
- ❌ 手工 `DELETE FROM flyway_schema_history`
- ❌ 把 `validate-on-migrate` 改成 `false`
- ❌ 把 `clean-disabled` 改成 `false`

这些操作会掩盖真实问题，让数据库进入「Flyway 认为的状态」与「实际结构」不一致的状态，后续故障将极难定位。

**正确流程：**

1. 读日志，定位失败的具体 SQL 语句和错误
2. 判断是脚本问题还是目标库状态问题
3. 若已污染数据，按第 15 节恢复备份
4. 修正后**新增**一个迁移版本重新走流程，不要改已执行的脚本

---

## 14. Testcontainers 验证命令

本地或 CI 用真实 PostgreSQL 16 验证迁移：

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" && export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH" && export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock" && export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="/var/run/docker.sock" && export TESTCONTAINERS_HOST_OVERRIDE="$(colima ls -j | jq -r '.address')"
```

```bash
cd campus-market-backend && ./mvnw verify -Ppostgres-it
```

覆盖范围：

| 测试类 | 覆盖场景 |
|---|---|
| `PostgresSchemaIT` | 空库 Flyway 迁移、14 张表、预置数据、6 个索引、部分唯一索引真实行为、`flyway_schema_history` 的 V1 记录 |
| `FlywayLegacyBaselineIT` | 旧库 baseline 接管（哨兵数据保留、不重跑 V1、预置数据不翻倍）、V2～V6 各起点升级（场景 C～G）、未知非空库被默认拒绝 |
| `SupplySchemaIT` | V7 的数据库层保证：发布人 / 协助人约束、批次位置与唯一未发布批次、邀请只存哈希与有效期上限、成交价快照不可改写 |
| `PriceGuidanceIT` | V8：维度快照与成交价同事务写入、不可改写；旧订单与维度不完整的订单被排除；商品编辑不影响统计 |
| `CircleSchemaIT` | V9 的数据库层保证：唯一 OWNER、同校、不可删除、邀请哈希与有效期、可见关系 1～5 与卖家在籍、订阅形状、订单可见性快照 |
| `SchoolIsolationIT` | V10：两所学校下的学校隔离（未登录 401、列表 / 总数 / feed / 详情 / 评论 / 收藏 / 会话 / 下单 / 资料不跨校、schoolId 400、写入不跨校、触发器兜底） |
| `CircleMemberLimitIT` | V10：成员分页与 1000 人在籍上限（含并发抢名额） |
| `CommitmentIT` / `ModerationIT` | V10：取消记录、爽约报告、工作人员、举报、限制、申诉的接口行为 |
| `GovernanceSchemaIT` | V10 的数据库层保证：爽约状态机、案件结果不可改、只增不改、申诉只决定一次、隐藏商品的可见性 |
| `GovernanceConcurrencyIT` | V10 的 10 组竞态（双方同时取消、取消 × 完成、改约 × 爽约报告、互相报告、确认 × 承认、限制 × 下单、到期 × 下单、强制归档 × 所有者归档、两名工作人员、申诉 × 到期）；V11 新增 2 组（推翻确认 × 新确认 × 限制到期、同一用户两条申诉同时决定） |
| `GovernancePerformanceIT` | V10 / V11：多校规模下治理查询的计划形状与语句条数（含档期快照、带快照条件的 30 天计数、依据索引、我的处理通知） |
| `GovernanceRulesIT` | V11：明确档期、自动限制重算、工作人员利益回避、邀请幂等边界、评论隐藏与单条私信隔离（24 条 HTTP 行为测试） |
| `CircleConcurrencyIT` | V9 的 7 组竞态：移除 × 下单、归档 × 发布、改为圈子可见 × 收藏、同一邀请码 8 人并发兑换、转让 × 退出 / 并发转让、批量发布 × 成员资格失效、创建圈子订阅 × 移除；每轮结束后断言不变量 |

普通单元测试不需要 Docker：

```bash
cd campus-market-backend && ./mvnw test
```

---

## 15. 回滚策略

**本项目不使用 Flyway 的 undo 迁移，也不通过修改已执行的 V1 来回滚。**

出问题时的回滚方式是：

1. **恢复数据库备份**（第 8 节那份）
   ```bash
   pg_restore -h <host> -U <user> -d campus_market -c campus_market_before_flyway.dump
   ```
2. **回滚应用到上一个版本**（上一个镜像 tag / 上一个 jar）
3. 在测试环境定位问题，修正后**新增**迁移版本重新发布

理由：数据库迁移往往伴随数据变形，反向 SQL 很难保证数据无损。备份恢复是唯一可靠的回滚手段，这也是第 8 节强制备份的原因。

---

## 相关文件

| 路径 | 说明 |
|---|---|
| `src/main/resources/db/migration/V1__initial_schema.sql` | 唯一的结构基线 |
| `src/main/resources/application.yaml` | Flyway 生产配置 |
| `src/test/resources/application-test.yaml` | H2 普通测试，已关闭 Flyway |
| `src/test/java/.../PostgresSchemaIT.java` | 空库迁移验证 |
| `src/test/java/.../FlywayLegacyBaselineIT.java` | 旧库接管与未知库保护验证 |
| `../campus-market-frontend/deploy/.env.example` | 部署环境变量示例 |
| `../campus-market-frontend/database/README.md` | 已废弃的 NestJS 迁移目录说明 |
