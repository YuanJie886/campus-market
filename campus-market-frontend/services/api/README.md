# ⚠️ 已废弃目录 · DEPRECATED

**本目录是迁移前的 NestJS 后端实现，已不参与当前构建、部署与运行，不得作为任何契约真值。**

---

## 当前生产后端

```
campus-market-backend/
```

Java 17 + Spring Boot + MyBatis-Plus + PostgreSQL 16，数据库结构由 Flyway 管理。

| 需要什么 | 去哪里 |
|---|---|
| 生产后端源码 | `campus-market-backend/src/main/java/` |
| **API 契约真值** | `campus-market-backend/.../api/CampusMarketController.java` |
| **数据库结构真值** | `campus-market-backend/src/main/resources/db/migration/`（当前 V1） |
| 迁移与运维手册 | `campus-market-backend/docs/database-migrations.md` |
| 后端说明 | `campus-market-backend/README.md` |

---

## 本目录的状态

| 项目 | 状态 |
|---|---|
| 是否参与构建 | ❌ 否。前端 `package.json` 的任何 script 都不引用本目录；`tsconfig.json` 的 `include` 仅为 `["src"]`；`vitest.config.ts` 仅收集 `src/**/*.test.ts` |
| 是否参与部署 | ❌ 否。`deploy/api.Dockerfile` 构建的是 `campus-market-backend`；`deploy/docker-compose.yml` 与根目录 compose 均不引用本目录 |
| 是否有独立依赖 | ⚠️ 有。本目录保留了自己的 `package.json` 与 `package-lock.json`（NestJS 11、pg、helmet 等），**它们不会被安装**，但可能被依赖扫描工具误报 |
| 是否为 API 契约真值 | ❌ 否 |
| 是否为数据库结构真值 | ❌ 否 |
| 保留原因 | 仅供历史审计追溯 |

---

## 禁止事项

- ❌ **禁止在本目录继续新增业务功能或修改现有逻辑。**
- ❌ **禁止启动本目录的服务。** 其 `package.json` 里的 `dev` / `start` / `migrate` / `seed` 脚本都指向已废弃的实现，运行它们会连上数据库并执行与当前 Flyway 基线**不一致**的建表/种子逻辑。
- ❌ 禁止把本目录的接口定义当作前端联调依据——以 `CampusMarketController` 为准。
- ❌ 禁止把本目录的 SQL 或 seed 数据手工执行到任何环境。

## 为什么不删除

删除属于本次收口工作范围之外的破坏性清理。保留代码便于日后审计「NestJS 阶段的实现长什么样」，但它已不具备任何权威性——这正是本文件存在的目的。

---

## 相关的其他废弃入口

| 路径 | 说明 |
|---|---|
| `campus-market-frontend/database/` | NestJS 时期的 SQL 迁移与 JSON 种子，同样已废弃，见该目录的 README |

## 历史背景

后端共经历三个阶段：

1. **NestJS + 手写 SQL 迁移**（本目录 + `../../database/`）→ 已废弃
2. **Spring Boot + `DatabaseInitializer` 读取 `db/schema.sql`** → 该机制与脚本已于 Flyway 接管时删除
3. **Spring Boot + Flyway**（当前）→ `campus-market-backend/`
