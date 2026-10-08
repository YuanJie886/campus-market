# 校园集市 (Campus Market)

以**校园身份认证、同校当面验货、绿色循环交易**为核心的校园二手物品流转平台。界面采用具有 Apple 级别质感的极简设计与沉浸式交互体验，系统采用完整的前后端分离架构。

---

## 一、项目架构一览

本项目采用全栈前后端分离架构，代码结构清晰：

```
campus-market/
├── campus-market-frontend/      # 前端工程 (React 18 + TS + Vite + TailwindCSS + MUI)
├── campus-market-admin/         # 复用 react-admin 的运营后台（角色鉴权、工作人员、治理与审计）
├── campus-market-backend/       # 后端服务 (Java 17 + Spring Boot 3 + MyBatis-Plus)
├── docker-compose.yml           # 仅本机开发用的 PostgreSQL 16（固定开发密码，只绑定 127.0.0.1）
├── .github/workflows/ci.yml     # CI 配置（尚未在远程执行过）
├── .gitignore                   # 全局 Git 忽略规则
└── README.md                    # 本文档
```

### 1. 技术栈
- **前端 (Frontend)**:
  - 框架：React 18, TypeScript, Vite
  - 样式与组件：TailwindCSS, Material UI (MUI)
  - 核心设计：Apple Keynote 级 3D 透视倾斜商品卡片、沉浸式 Hero 视差展台、分屏粘性 Scrollytelling 叙事展具、动态滑动胶囊吸顶导航
- **后端 (Backend)**:
  - 框架：Java 17, Spring Boot 3, MyBatis-Plus
  - 安全鉴权：JJWT (双 Token 无感刷新 + HttpOnly Cookie)
  - 核心能力：订单状态机、校内推荐交易点、实时未读数、全量 RESTful API (`/v1/*`)
- **数据存储 (Database)**:
  - PostgreSQL 16 (基于 Docker 独立部署，支持持久化卷)

---

## 二、三步极速启动

### 1. 启动 PostgreSQL 数据库 (Docker)
在项目根目录下执行：
```bash
docker compose up -d
```
数据库将在 `127.0.0.1:5432` 启动就绪，自动创建 `campus_market` 数据库。这个编排**只供本机开发**；
部署请用 `campus-market-frontend/deploy/docker-compose.yml`，见 [docs/local-deployment.md](docs/local-deployment.md)。

### 2. 启动 Spring Boot 后端服务
进入后端目录并启动：
```bash
cd campus-market-backend
mvn spring-boot:run
```
> 后端默认监听 `http://localhost:3000`。数据库结构由 **Flyway** 管理：空库启动时自动依次执行
> `src/main/resources/db/migration/` 下的 V1～V11；非空但未被 Flyway 管理的库会拒绝启动。
> 可信面交闭环（验货清单、档期握手、出发/到达、交易履历）的设计见 [docs/trusted-meeting-flow.md](docs/trusted-meeting-flow.md)。
> 课程教材图谱（课程 → 指定教材版本 → 本校在售 → 精确版本订阅）的设计见 [docs/course-textbook-graph.md](docs/course-textbook-graph.md)。
> **当前课程目录是虚构的演示数据**，不来自任何学校的教务系统；演示教材一律「无 ISBN」，不占用任何真实书号。
> 毕业季通用供给引擎（服务端草稿、最多 20 件的批量发布、整套打包、协助整理发布、历史成交价格参考）的设计见 [docs/graduation-supply-engine.md](docs/graduation-supply-engine.md)。
> 圈子集市（班级 / 社团 / 兴趣圈子、仅圈子可见的商品、邀请码加入、圈子订阅）的设计见 [docs/circle-market.md](docs/circle-market.md)。
> 交易承诺与可信治理（结构化取消原因、爽约报告与公开的保守限制规则、举报与治理案件、用户限制与申诉、平台工作人员）的设计见
> [docs/commitment-and-moderation.md](docs/commitment-and-moderation.md)。平台不托管资金、不做仲裁或赔付，没有公开的信用分。
> **商品只在同一所学校内公开，浏览与搜索都需要登录**；未登录只能看到落地页与登录注册。
> 系统没有默认管理员：首个平台工作人员按 [工作人员运维手册](campus-market-backend/docs/staff-runbook.md) 用受控 SQL 配置。
> 圈子都是用户自己创建的，平台不核验班级或社团身份，也不会自动建立宿舍圈。
> 详见 [数据库迁移手册](campus-market-backend/docs/database-migrations.md)。
>
> 启动前需要显式设置 `JWT_SECRET`（无默认值，缺失即启动失败）：`export JWT_SECRET="$(openssl rand -base64 48)"`
> 访问 `http://localhost:3000/v1/health` 可验证数据库与服务健康状态。

### 3. 启动前端 Web 应用
进入前端目录并启动：
```bash
cd campus-market-frontend
npm install
npm run dev
```
浏览器访问 `http://localhost:5173` 即可开始使用。

生产构建请使用显式模式，结果只由命令决定、不读取本机 `.env`：

```bash
cd campus-market-frontend
npm run build:rest   # 连接真实后端（部署镜像使用这一项），产物在 dist/
npm run build:mock   # 纯前端离线演示（localStorage），产物在 dist-mock/
npm run build:all    # 两种构建 + 产物检查（REST 包不含 Mock，Mock 包不含 REST 传输层）
npm run build        # 等同于 build:all；无论本机 .env 是什么，产物都逐字节相同
```

---

## 三、发布验收（模块 8）

- **当前结论**：功能验收与本地部署通过；**受控试运行与公开上线都还没有就绪**。门禁矩阵、缺失能力与演示数据清单见 [docs/release-readiness.md](docs/release-readiness.md)。
- 本地部署与演练：[docs/local-deployment.md](docs/local-deployment.md)；备份与恢复：[docs/backup-and-restore.md](docs/backup-and-restore.md)。
- 真实浏览器 E2E：`cd campus-market-frontend && npm run e2e`（需要 Docker、JDK 17、已打包的后端 jar；默认使用本机 Chrome）。
- 治理规则（明确档期、自动限制重算、利益回避、内容处置）：[docs/commitment-and-moderation.md](docs/commitment-and-moderation.md) 第 13 节。

## 四、管理后台

后台复用 MIT 开源项目 [react-admin](https://github.com/marmelab/react-admin)，同源入口为 `/admin/`，共用现有登录、后端和数据库。支持学校管理员、高级审核员、审核员、只读审计员，以及人员授权审计。

启动与首位管理员配置见 [管理后台说明](campus-market-admin/README.md)，选型与接入设计见 [后台复用决策](docs/admin-reuse.md)。

## 五、更多文档
- [后端开发与 API 文档](campus-market-backend/README.md)
- [前端工程说明文档](campus-market-frontend/README.md)
- [产品方案与设计文档](campus-market-frontend/方案设计.md)
