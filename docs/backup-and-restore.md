# 备份与恢复（模块 8.2）

本文说明 PostgreSQL 16 数据库的备份、**恢复到新的临时数据库做验证**、以及 schema 变更失败时的恢复流程。
这里的步骤在本地演练里真实执行过（见 `docs/local-deployment.md` 的演练脚本与 `docs/release-readiness.md` 的结果），
但**没有**在任何服务器或生产数据库上执行过。

---

## 1. 原则

- 备份文件含全部业务数据（账号、联系方式、订单、私信、治理记录）：按敏感数据保管——加密存放在数据库主机之外，限制访问，按保留期删除。
- **永远先恢复到一个新的临时数据库验证，再考虑切换**；不要对正在使用的数据库直接执行 `pg_restore -c`。
- 命令行里不出现密码：备份与恢复都通过 `docker compose exec` 在数据库容器内执行（容器内本地 socket 连接，不需要密码），
  或者使用 `~/.pgpass` / `PGPASSFILE`，绝不要把密码写进命令参数、脚本或 CI 日志。
- 每次执行新的 Flyway 迁移（包括 V11）之前都必须有一份**验证过可以恢复**的备份（`campus-market-backend/docs/database-migrations.md` 第 8 节）。

## 2. 备份

在部署目录（`campus-market-frontend/deploy`）执行，`-T` 关闭伪终端，输出是二进制的自定义格式：

```bash
docker compose exec -T postgres pg_dump -U campus -d campus_market -Fc > campus_market_$(date +%Y%m%d_%H%M%S).dump
```

- 自定义格式（`-Fc`）带压缩，可以用 `pg_restore --list` 查看内容、按需恢复部分对象。
- 备份包含 `flyway_schema_history`：恢复后 Flyway 会认出数据库的版本，不会重复执行迁移。
- 建议同时保存对应的应用版本（镜像 tag / jar 版本）与迁移目录的 checksum，恢复时成对使用。

## 3. 恢复到新的临时数据库做验证

1. 启动一个一次性的 PostgreSQL 16 容器（唯一名字、不发布端口）。随机密码只放在当前 shell 的环境变量里，
   `docker run -e POSTGRES_PASSWORD` 只写变量名、值取自环境，命令行与 shell 历史里都不会出现密码：

   ```bash
   export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
   docker run -d --name cm-restore-check --label purpose=restore-check \
     -e POSTGRES_PASSWORD -e POSTGRES_DB=restore_check postgres:16-alpine
   unset POSTGRES_PASSWORD
   ```

2. 等待就绪后恢复：

   ```bash
   docker exec cm-restore-check pg_isready -h 127.0.0.1 -U postgres -d restore_check
   docker exec -i cm-restore-check pg_restore -U postgres -d restore_check --no-owner --no-privileges --exit-on-error < campus_market_XXXX.dump
   ```

3. 核对（两边执行同样的查询，结果必须完全一致）：

   ```sql
   -- Flyway 历史：版本、checksum、成功标记
   SELECT string_agg(version || ':' || checksum || ':' || success, ',' ORDER BY installed_rank) FROM flyway_schema_history;
   -- 哨兵数据：挑选几条已知的商品、订单、圈子、治理记录，比较数量与状态
   ```

   还要确认约束与触发器仍然生效，例如 `DELETE FROM moderation_actions ...` 必须被拒绝（只增不改）。

4. 验证完删除临时容器（连同它的匿名卷）：`docker rm -f -v cm-restore-check`。

## 4. 真实故障时的恢复

1. 停止 API（避免新写入）：`docker compose stop api web`。
2. 按第 3 节把备份恢复到**新的**数据库并核对。
3. 切换：让 API 的 `DATABASE_URL` 指向核对过的新库（或在维护窗口内用新库替换旧卷），用**与备份同版本**的应用镜像启动。
4. 保留出故障的旧库，直到确认不再需要用于排查。

## 5. schema 变更失败时的恢复流程

Flyway 迁移在一个事务里执行（PostgreSQL 的 DDL 是事务性的）：V11 这类迁移失败时整个版本回滚，`flyway_schema_history` 会记下一条 `success = f`，应用拒绝启动。

1. **不要**执行 `flyway repair`、不要删除历史表里的记录、不要手工改表去「凑」成功（`database-migrations.md` 第 13 节）。
2. 停止 API；保留失败时的日志（`docker compose logs api`，日志里没有密码或令牌）。
3. 用迁移前的备份按第 3 节恢复到新的数据库并核对版本（应停在上一个版本，例如 10）。
4. 回滚应用镜像到上一个版本，连接恢复出的数据库启动，确认服务正常。
5. 在测试环境（Testcontainers 或本地演练栈）复现并修正，**新增**下一个版本（例如 V12）发布；已发布的迁移文件一个字节也不能改——CI 会拒绝。

## 6. 演练记录

`campus-market-frontend/deploy/drill/local-deploy-drill.mjs` 在一次性 Compose 项目里：写入哨兵商品 / 订单（含档期快照）/ 圈子 / 治理记录（举报、案件、动作、限制）→
`pg_dump -Fc` → 恢复到一个新的一次性 PostgreSQL 容器 → 核对哨兵、Flyway 历史（11 条，版本 / checksum / 成功标记一致）与只增不改触发器 → 精确清理。
结果见 `docs/release-readiness.md`。
