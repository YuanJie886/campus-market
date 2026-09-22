# 第一阶段：Spring Boot 真实后端

当前后端位于仓库根目录的 `campus-market-backend`，使用 Spring Boot + MyBatis-Plus + PostgreSQL；React 前端继续使用原有 `/v1` REST 契约。`services/api` 是迁移前的 NestJS 实现，不再作为部署入口。

## 本地启动

需要 Java 17+、Maven 和 PostgreSQL。Spring Boot 启动时会自动执行 `campus-market-backend/src/main/resources/db/schema.sql`，已有表和数据不会被覆盖。

```sh
cd campus-market-backend
export DATABASE_URL=jdbc:postgresql://localhost:5432/campus_market
export DATABASE_USERNAME=campus
export DATABASE_PASSWORD=replace-with-your-password
export JWT_SECRET=replace-with-at-least-32-random-characters
mvn spring-boot:run
```

另开终端启动前端：

```sh
cd campus-market-frontend
npm ci
npm run dev
```

前端 Vite 会把 `/v1` 转发到 `http://localhost:3000`。健康检查为 `GET /v1/health`。

## Docker

```sh
cd campus-market-frontend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d
```

访问 `http://localhost:8080`。正式 HTTPS 环境请设置 `SECURE_COOKIES=true`，并把 `WEB_ORIGIN` 改成真实前端来源。

## 已迁移接口

- 认证：注册、登录、刷新、退出、当前用户和资料编辑
- 商品：查询、筛选、排序、发布、编辑、状态、浏览量、收藏
- 订单：预约、幂等、卖家接单、买家确认、确认码完成、取消和超时释放
- 互动：评价、评论、会话、消息、已读游标和未读数

所有成功响应保持 `{ code: 0, data, message: "ok" }`，错误响应保持 HTTP 4xx/5xx 与 `{ code, data, message, requestId }`。刷新令牌使用 HttpOnly Cookie，业务请求继续携带 `Authorization: Bearer <token>`。

订单状态流转：卖家将 `PENDING_SELLER_CONFIRM` 转为 `PENDING_MEETING`，买家转为 `BUYER_CONFIRMED`，卖家携带六位确认码转为 `COMPLETED`；双方都可以在未完成前取消。

## 验证

```sh
cd campus-market-backend
mvn test
cd ../campus-market-frontend
npm run build
```

当前本地自动化测试验证 Spring Boot 上下文和前端构建；真实 PostgreSQL 下的订单并发与迁移兼容性，需在 PostgreSQL 实例可用后进行联调。
