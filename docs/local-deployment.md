# 本地部署（模块 8.2）

本文说明如何在一台机器上用 Docker Compose 部署整套系统，以及如何用演练脚本验证部署。
**这里验证的只是「本地可以部署」**：没有在任何服务器上部署过，也没有配置 HTTPS、域名、监控或自动备份——不能据此宣称已经上线。

---

## 1. 组成

生产编排：`campus-market-frontend/deploy/docker-compose.yml`

| 服务 | 镜像 / 构建 | 端口 | 说明 |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 只绑定 `127.0.0.1:5432` | 命名卷 `postgres_data` 保存数据；`pg_isready` 健康检查 |
| `api` | `deploy/api.Dockerfile`（Maven 构建 jar，JRE 17 运行，非 root 用户 10001） | 不发布 | 等 `postgres` **健康**之后才启动；启动时先执行 Flyway，成功后才开始接受请求 |
| `web` | `deploy/web.Dockerfile`（`npm run build:rest` + nginx） | 只绑定 `127.0.0.1:8080` | `/v1/` 反向代理到 `api:3000`；其他路径 `try_files ... /index.html`（SPA 深链接刷新） |

根目录的 `docker-compose.yml` **只供本机开发**：固定的开发密码、只绑定 `127.0.0.1:5432`，不要用于任何服务器。

## 2. 必填配置（没有默认值，不填就启动失败）

| 变量 | 生成 / 取值 | 缺失时 |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | 编排拒绝渲染 |
| `JWT_SECRET` | `openssl rand -base64 48`（至少 32 字节，每个环境独立） | 编排拒绝渲染；应用本身也拒绝启动，不回落到任何默认密钥 |
| `SECURE_COOKIES` | HTTPS 部署 `true`；仅本地 http 调试 `false` | 编排拒绝渲染 |
| `WEB_ORIGIN` | 浏览器访问的来源，例如 `https://market.example.edu` | 默认 `http://localhost:8080` |

- 真实部署时把这些值写进 `deploy/.env`（已被 `.gitignore` 忽略），模板是 `deploy/.env.example`；绝不要提交真实值，也不要贴进聊天、工单或截图。
- `WEB_ORIGIN` 是 `https://` 而 `SECURE_COOKIES=false` 时，后端拒绝启动（长期凭据不能在明文连接上发送）。
- 系统里**没有默认管理员**；首个平台工作人员按 `campus-market-backend/docs/staff-runbook.md` 用受控 SQL 配置，每校至少两名。

## 3. 启动与停止

```bash
cd campus-market-frontend/deploy
cp .env.example .env          # 然后逐项填写；不要使用示例里的任何值
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8080/v1/health     # {"code":0,"data":{"status":"ok"},...}
docker compose down           # 停止并删除容器，保留命名卷里的数据（不要加 -v）
```

- 刷新 Cookie `cm_refresh`：`HttpOnly`、`SameSite=Strict`、`Path=/v1/auth`；`SECURE_COOKIES=true` 时带 `Secure`。
  Access Token 只在页面内存里，不写浏览器存储；刷新接口校验 `Origin` 必须等于 `WEB_ORIGIN`。
- 健康检查 `/v1/health` 只返回 `{"status":"ok"}`，不包含版本、数据库地址或任何配置。
- 服务器部署还需要自行在前面放一个终止 HTTPS 的反向代理（本仓库没有提供），并把 `WEB_ORIGIN` 设为 https 来源、`SECURE_COOKIES=true`。

## 4. 部署演练脚本

`campus-market-frontend/deploy/drill/local-deploy-drill.mjs` 用**生产编排 + 演练覆盖文件**（`deploy/drill/docker-compose.drill.yml`，只改端口）在一个唯一命名的 Compose 项目里完成一次完整演练：

```bash
cd campus-market-frontend
node deploy/drill/local-deploy-drill.mjs <报告输出目录>
```

| 检查 | 方法 |
|---|---|
| 缺密钥启动失败 | 分别缺 `JWT_SECRET` / `SECURE_COOKIES` / `POSTGRES_PASSWORD` 时 `config` 失败；直接运行 api 镜像不给 `JWT_SECRET` 时进程退出 |
| 端口 | 生产编排的两个端口都只绑定 `127.0.0.1`；演练栈的 PostgreSQL 不发布任何端口，Web 只绑定 `127.0.0.1` 临时端口 |
| 数据库就绪后 API 启动 | 比较 PostgreSQL 健康检查首次通过的时间与 API 容器的启动时间 |
| Flyway 成功后接受请求 | API 日志里 `Successfully applied 11 migrations` 在 `Tomcat started` 之前；历史表 11 条全部成功 |
| 健康检查不泄露配置 | 响应只有 `{"status":"ok"}`，不含 jdbc / password / secret / 版本 |
| SPA 深链接与 /v1 代理 | 深链接返回 `index.html`；未知的 `/v1/...` 得到 API 的 JSON 404 而不是页面 |
| Cookie 策略按环境生效 | http 配置不带 `Secure`、https 配置带 `Secure`；https + `SECURE_COOKIES=false` 拒绝启动；刷新接口拒绝其他来源 |
| 重启后数据保留 | 写入哨兵后 `down`（不带 `-v`）+ `up`，哨兵数据与读取都在 |
| 备份与恢复 | 见 `docs/backup-and-restore.md` |

演练约束：唯一项目名；只绑定 `127.0.0.1`；一次性随机凭据只经环境变量传给 `docker-compose`（不写文件、不打印）；
用一个空的 `--env-file` 代替 `deploy/.env`（既不读取也不创建它）；不 prune；
结束时 `down -v --rmi local` 只删除本项目的容器、网络、命名卷与构建出的镜像，另外删除本次运行前本机没有的、被拉取的基础镜像；运行前已有的镜像不动。
Docker 构建缓存保留在本机（清理它需要 prune，按约束不执行）。

## 5. 真实浏览器 E2E 的测试栈

`npm run e2e`（在 `campus-market-frontend`）先 `build:rest`，再由 Playwright 的 global-setup 启动：一次性 PostgreSQL 16 容器（唯一名字与标签、只绑定 `127.0.0.1` 临时端口、随机密码）
+ 后端 jar（需要先 `./mvnw -DskipTests package`）+ 一个与 nginx 规则相同的静态服务器；结束时只删除那一个容器与它的匿名卷。
浏览器默认用本机已安装的 Chrome（不下载浏览器）；CI 用 Playwright 自带的 Chromium。
进程被强制终止时可能留下容器，可以用 `docker ps -a --filter label=campus-market-e2e` 找到后逐个 `docker rm -f -v <名字>`（不要 prune）。
