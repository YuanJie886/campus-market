# 校园集市 (Campus Market)

以**校园身份认证、同校当面验货、绿色循环交易**为核心的校园二手物品流转平台。界面采用具有 Apple 级别质感的极简设计与沉浸式交互体验，系统采用完整的前后端分离架构。

---

## 一、项目架构一览

本项目采用全栈前后端分离架构，代码结构清晰：

```
campus-market/
├── campus-market-frontend/      # 前端工程 (React 18 + TS + Vite + TailwindCSS + MUI)
├── campus-market-backend/       # 后端服务 (Java 17 + Spring Boot 3 + MyBatis-Plus)
├── docker-compose.yml           # PostgreSQL 16 数据库一键部署
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
数据库将在 `localhost:5432` 启动就绪，自动创建 `campus_market` 数据库。

### 2. 启动 Spring Boot 后端服务
进入后端目录并启动：
```bash
cd campus-market-backend
mvn spring-boot:run
```
> 后端启动时会自动执行 `src/main/resources/db/schema.sql` 完成全量建表，默认监听 `http://localhost:3000`。
> 访问 `http://localhost:3000/v1/health` 可验证数据库与服务健康状态。

### 3. 启动前端 Web 应用
进入前端目录并启动：
```bash
cd campus-market-frontend
npm install
npm run dev
```
浏览器访问 `http://localhost:5173` 即可开始使用。

---

## 三、更多文档
- [后端开发与 API 文档](campus-market-backend/README.md)
- [前端工程说明文档](campus-market-frontend/README.md)
- [产品方案与设计文档](campus-market-frontend/方案设计.md)
