# ⚠️ 已废弃目录 · DEPRECATED

**本目录属于已废弃的 NestJS 实现，不再维护，不得作为当前数据库结构的真值。**

---

## 当前唯一的数据库迁移入口

```
campus-market-backend/src/main/resources/db/migration/
```

由 Flyway 管理。操作手册见 [`campus-market-backend/docs/database-migrations.md`](../../campus-market-backend/docs/database-migrations.md)。

---

## 本目录的状态

| 项目 | 状态 |
|---|---|
| 是否参与 Spring Boot 构建 | ❌ 否 |
| 是否参与生产部署 | ❌ 否（`deploy/` 下的任何 Dockerfile 与 compose 都不引用本目录） |
| 是否被任何脚本、`package.json`、`vite.config.ts`、`tsconfig.json` 引用 | ❌ 否 |
| 是否为当前数据库结构真值 | ❌ 否 |
| 保留原因 | 仅供历史审计追溯 |

### 目录内容

| 文件 | 说明 |
|---|---|
| `migrations/001_initial.sql` | NestJS 时期的初始建表脚本。**与当前 `V1__initial_schema.sql` 可能已经漂移**，不要据此判断线上结构。 |
| `seeds/demo.json` | NestJS 时期的演示种子数据，已无加载方。 |

---

## 禁止事项

- ❌ **禁止在本目录继续新增迁移脚本。** 任何结构变更一律在 `campus-market-backend/src/main/resources/db/migration/` 下新增 `V2__*.sql`、`V3__*.sql`。
- ❌ 禁止把本目录的 SQL 手工执行到任何环境的数据库上。
- ❌ 禁止在排查线上结构问题时参考本目录——请以 Flyway 迁移目录和 `flyway_schema_history` 表为准。

## 为什么不直接删除

删除属于本次迁移工作范围之外的破坏性清理。保留文件本身便于日后审计「当年 NestJS 阶段的结构长什么样」，但必须明确它已不具备任何权威性——这正是本文件存在的目的。

---

## 历史背景

项目后端经历了两次演进：

1. **NestJS + 手写 SQL 迁移**（本目录）→ 已废弃
2. **Spring Boot + `DatabaseInitializer` 读取 `db/schema.sql`** → 已于 Flyway 接管时删除
3. **Spring Boot + Flyway**（当前）→ `campus-market-backend/src/main/resources/db/migration/`

同一时期 `campus-market-frontend/services/api/`（NestJS 服务端实现）同样已废弃，参见 `campus-market-frontend/docs/backend.md`。
