# 校园集市后端服务 (Campus Market Backend)

本项目为校园二手交易平台的后端服务。系统采用**前后端分离架构（Decoupled Frontend / Backend）**，提供稳定、安全、高性能的 RESTful API，并针对校园交易场景（校区面交点、学子信用、实名认证、即时私信与订单状态机）进行了完整实现。

---

## 一、前后端分离架构说明

系统由独立的前端工程与后端工程组成，并通过标准 RESTful 协议与 JWT 鉴权进行通信：

```
+-------------------------------------------------------------+
|                      前端应用 (Frontend)                     |
|  - 路径: campus-market-frontend/                            |
|  - 技术栈: React 18 + TypeScript + Vite + TailwindCSS + MUI |
|  - 运行地址: http://localhost:5173                          |
+-------------------------------------------------------------+
                              |
                     HTTP / RESTful API
           (/v1/*, Authorization: Bearer, HttpOnly Cookie)
                              |
                              v
+-------------------------------------------------------------+
|                      后端服务 (Backend)                      |
|  - 路径: campus-market-backend/                             |
|  - 技术栈: Java 17 + Spring Boot 3 + MyBatis-Plus           |
|  - 运行端口: http://localhost:3000                          |
+-------------------------------------------------------------+
                              |
                         JDBC (HikariCP)
                              |
                              v
+-------------------------------------------------------------+
|                     数据库 (Database)                        |
|  - PostgreSQL 16 (基于 Docker 独立部署)                      |
|  - 监听端口: 5432                                           |
+-------------------------------------------------------------+
```

### 1. 前后端协同规范
- **统一接口前缀**：所有业务接口统一规范在 `/v1/*` 命名空间下。
- **统一响应封装**：成功响应格式为 `{ code: 0, data: ..., message: "ok", requestId: "..." }`，HTTP 状态码为 200。
- **双 Token 认证机制 (JWT Dual-Token)**：
  - **Access Token**：保存在前端内存中（模块闭包，不落任何 Web Storage / Cookie / URL），有效期 15 分钟，通过请求头 `Authorization: Bearer <token>` 传输；
    页面刷新后令牌随之消失，由前端携带 `cm_refresh` Cookie 调用 `POST /v1/auth/refresh` 重新换取；
  - **Refresh Token**：保存在浏览器的安全 `HttpOnly Cookie` 中，有效期 7 天，支持自动无感续期与防 XSS 攻击；
  - **跨域凭据**：跨域请求时允许携带 Cookie 凭证（`allowCredentials = true`）。
- **CORS 跨域配置**：通过环境变量 `WEB_ORIGIN` 精确允许前端来源（本地开发默认允许 `http://localhost:5173`）。

---

## 二、环境要求

在开始运行前，请确保本地已安装以下环境：

- **JDK 17+**
- **Maven 3.8+**
- **Docker & Docker Compose**（用于一键安装与运行 PostgreSQL 数据库）

---

## 三、快速启动指南

### 步骤 1：使用 Docker 启动 PostgreSQL 数据库

本项目配套提供了极简的 `docker-compose.yml`，**仅安装与启动 PostgreSQL 数据库**，无需安装多余容器。

在 `campus-market-backend/` 目录下（或项目根目录）执行：

```bash
# 后台启动 PostgreSQL 数据库容器
docker compose up -d
```

> **Docker Compose 说明**：
> - 镜像版本：`postgres:16-alpine`
> - 默认端口映射：`5432:5432`
> - 默认数据库名：`campus_market`
> - 默认用户与密码：`postgres` / `postgres`
> - 数据持久化：使用具名数据卷 `campus_market_pgdata`，容器重启数据不丢失。

**常用数据库管理命令**：
```bash
# 查看数据库运行状态
docker compose ps

# 查看数据库日志
docker compose logs -f postgres

# 停止数据库容器
docker compose stop

# 停止并删除容器（数据卷保留）
docker compose down

# 连接进入 psql 交互式命令行终端
docker exec -it campus-market-postgres psql -U postgres -d campus_market
```

---

### 步骤 2：启动 Spring Boot 后端服务

后端的数据库默认参数匹配上述 Docker 数据库账号密码。首次本地启动还需生成独立的 JWT 签名密钥，在 `campus-market-backend/` 目录执行（已有 `.env` 时请保留原密钥）：

```bash
umask 077
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
```

应用从后端目录或仓库根目录启动时都会读取这个私有 `.env`，IDEA 直接运行主类也适用。
环境变量 `JWT_SECRET` 可以覆盖文件配置；没有有效密钥时应用会拒绝启动。

在 `campus-market-backend/` 目录下运行：

```bash
./mvnw spring-boot:run
```

或使用 IDEA / Eclipse 直接运行主类：
`com.lulu.campusmarketbackend.CampusMarketBackendApplication`

#### 数据库结构管理（Flyway）
数据库结构由 **Flyway** 统一管理，是本项目**唯一**的建表入口。
（历史说明：早期由 `DatabaseInitializer` 启动时执行 `db/schema.sql`，该机制及其脚本均已删除。）

- 迁移目录：`src/main/resources/db/migration`，当前只有 `V1__initial_schema.sql`
- **空库**：启动时自动执行 V1，创建 14 张业务表、6 个具名索引与预置的 1 所学校 / 4 个校区 / 12 个面交点
- **已被 Flyway 管理的库**：校验通过后继续，不重复迁移
- **非空但无 `flyway_schema_history` 的库**：拒绝启动。这是刻意设置的安全闸
- `baseline-on-migrate` 默认 **false**，仅在从旧 `DatabaseInitializer` 升级的首次接管时，
  经 `SPRING_FLYWAY_BASELINE_ON_MIGRATE=true` 临时开启，**且必须先备份、先做结构 diff、先在测试环境演练**；
  接管成功后立即改回 false
- `clean-disabled` 固定为 **true**，任何环境都不得改为 false
- 当前迁移为 V1～V6（V5：可信面交闭环；V6：课程教材图谱）。后续结构变更一律新增 `V7__*.sql` 起的新版本，**禁止修改已发布的 V1～V6**

完整操作手册见 [`docs/database-migrations.md`](docs/database-migrations.md)。

#### 验证后端就绪
后端服务默认监听 `3000` 端口。在终端执行健康检查接口：

```bash
curl http://localhost:3000/v1/health
```

返回如下 JSON 表示后端与数据库连通正常：
```json
{
  "code": 0,
  "data": {
    "status": "ok"
  },
  "message": "ok"
}
```

---

### 步骤 3：启动前端项目进行联调

打开新的终端窗口，进入前端目录 `campus-market-frontend/`：

```bash
cd ../campus-market-frontend

# 安装依赖（首次运行需执行）
npm install

# 确保 .env 配置为 REST 模式（如果文件不存在可复制 .env.example）
# VITE_API_MODE=rest
# VITE_API_BASE_URL=http://localhost:3000

# 启动前端开发服务器
npm run dev
```

在浏览器打开 `http://localhost:5173`，即可体验完整的全栈校园集市系统。

---

## 四、环境变量配置参考

如需在生产环境或自定义环境中部署，可通过环境变量覆盖 `application.yaml` 中的配置项：

| 环境变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端 HTTP 服务监听端口 |
| `DATABASE_URL` | `jdbc:postgresql://localhost:5432/campus_market` | PostgreSQL 数据库 JDBC 连接串 |
| `DATABASE_USERNAME` | `postgres` | 数据库用户名 |
| `DATABASE_PASSWORD` | `postgres` | 数据库密码 |
| `WEB_ORIGIN` | `http://localhost:5173` | 允许跨域访问的前端域名/端口 |
| `JWT_SECRET` | 无，必填 | 至少 32 字节的强随机 JWT 签名密钥；本地可配置在后端私有 `.env`，生产环境通过环境变量注入 |
| `SECURE_COOKIES` | `false`（`deploy/docker-compose.yml` 中**无默认值，必须显式设置**） | 刷新 Cookie 的 `Secure` 标记。若 `WEB_ORIGIN` 是 `https://` 而此处为 `false`，应用会**拒绝启动**——该组合意味着七天有效的长期凭据将在明文连接上发送，只可能是配置遗漏 |
| `DATABASE_POOL_SIZE` | `10` | HikariCP 连接池最大连接数 |

---

## 五、核心业务功能与 API 模块速查

所有请求返回均包含 `{ code, data, message, requestId }` 统一结构。

### 1. 身份认证与用户模块 (`/v1/auth`, `/v1/users`)
- `POST /v1/auth/register` - 学子注册（学号/手机号绑定与校区选择）
- `POST /v1/auth/login` - 学子登录（下发 Access Token，并在 Cookie 设置 Refresh Token）
- `POST /v1/auth/refresh` - 无感刷新访问令牌
- `POST /v1/auth/logout` - 退出登录并清除 Cookie
- `GET /v1/auth/me` - 获取当前登录用户的详细身份信息与学子认证状态
- `PATCH /v1/auth/me` - 更新个人昵称、头像、联系方式、所属校区或宿舍楼（`dormBuildingId`，仅本人可见，传 `null` 清空）
- `GET /v1/users/{id}` - 获取指定用户的公开资料（不含任何信用分）
- `GET /v1/users/{id}/trade-summary` - 公共交易履历：只有完成次数、加入时间、评价数与平均分（评价少于 3 条不给平均分）

### 2. 商品与流转广场 (`/v1/products`, `/v1/favorites`)
- `GET /v1/products` - 多维度分页查询与筛选商品（分类、校区、成色、价格区间、关键词搜索、排序）
- `GET /v1/products/feed` - 楼栋集市 feed：`scope=BUILDING` 时按 本楼→同园区→同校区→全校 自动降级，支持 `sort=nearest`；返回范围元数据（见 `docs/building-market.md`）
- `GET /v1/buildings?campus=` - 某校区的可选楼栋（公共只读，不含任何住户信息）
- `GET /v1/products/{id}` - 获取商品详情与卖家信息
- `POST /v1/products` - 发布闲置商品（支持多图、原价、成色、面交预选点、可选取货楼栋 `buildingId`）
- `PATCH /v1/products/{id}` - 编辑更新闲置商品信息
- `POST /v1/products/{id}/status` - 商品状态流转（在售 / 预约中 / 已售出 / 已下架）
- `POST /v1/products/{id}/view` - 浏览量自增
- `GET /v1/favorites` - 获取当前用户的收藏夹列表
- `PUT /v1/products/{id}/favorite` - 切换收藏状态（收藏 / 取消收藏）

### 3. 订单与面交状态机 (`/v1/orders`)
- `POST /v1/orders` - 发起购买/面交预约订单（支持幂等键 `Idempotency-Key`）
- `GET /v1/orders?role=buyer|seller|all` - 查看我买到的/我卖出的预约单
- `POST /v1/orders/{id}/transitions` - 推进面交订单状态（买家发起预约 -> 卖家接单确认 -> 线下当面试用 -> 双方核验完成 -> 评价/争议/取消）
- `POST /v1/orders/{id}/reviews` - 交易完成后双向互评打分

### 可信面交闭环（模块 3，详见仓库根目录 `docs/trusted-meeting-flow.md`）
- `GET /v1/inspection-templates?category=` - 该分类当前启用的验货清单（「其他」返回 `null`）
- `POST /v1/products`、`PATCH /v1/products/{id}` 的 `inspection` 字段 - 卖家逐项声明（`NORMAL / DEFECT / NOT_TESTED / NOT_APPLICABLE`），受支持分类必填，无默认值
- `GET /v1/orders/{id}/flow` - 订单双方的流程视图：当前档期、提议、出发/到达、验货快照与结果、时间线（不含确认码与联系方式）
- `PUT /v1/orders/{id}/inspection` - 买家保存验货草稿；`POST /v1/orders/{id}/inspection/submit` - 最终提交（幂等，提交后不可修改；存在不一致项时订单转为 `DISPUTED`）
- `POST /v1/orders/{id}/meeting-proposals` - 发起档期提议；`POST …/meeting-proposals/{proposalId}/accept|reject|withdraw` - 接受 / 拒绝 / 撤回
- `PUT /v1/orders/{id}/presence` - 本人「已出发 / 已到达」（`{"action":"DEPART"|"ARRIVE"}`，人工状态，不是定位）
- `GET /v1/me/trade-history` - 本人交易履历（计数 + 最近订单）
- 买家确认与卖家核销之前必须完成验货：验货待提交或存在不一致时返回 409，且不消耗确认码尝试次数

### 课程教材图谱（模块 4，详见仓库根目录 `docs/course-textbook-graph.md`；当前为演示目录）
- 以下接口均需登录，学校由登录用户的校区推导；他校数据一律 404
- `GET /v1/courses?q=&term=&academicYear=&campus=&page=&pageSize=` - 课程搜索（名称子串 / 课程代码前缀）
- `GET /v1/courses/{courseId}` - 课程详情：各学期开课与**已验证**的指定教材版本，含本校在售数量
- `GET /v1/course-offerings/{offeringId}` - 单个开课
- `GET /v1/textbooks/{textbookEditionId}?sort=nearest|latest` - 教材版本详情：关联课程、精确版本在售商品、单独返回的其他版次
- `GET /v1/textbooks/isbn/{isbn}` - ISBN 精确查询（接受空格与连字符，校验位错误 400）
- `POST /v1/textbook-suggestions`、`GET /v1/textbook-suggestions/mine`、`DELETE /v1/textbook-suggestions/{id}` - 教材建议（只能是待审核，只有本人可见，每人每天 10 条）
- 商品的 `textbookEditionId` 字段 - 只允许教材书籍分类，关联时保存版本快照；商品投影带 `textbook` 摘要
- 需求订阅的 `textbookEditionId` 字段 - 精确版本订阅，理由码 `TEXTBOOK_EXACT`

### 需求雷达 (`/v1/demand-subscriptions`, `/v1/demand-matches`)
- `POST /v1/demand-subscriptions` - 创建需求订阅（幂等；同条件返回原订阅，已停用则重新激活）
- `GET /v1/demand-subscriptions` - 我的订阅
- `PATCH /v1/demand-subscriptions/{id}` - 修改条件或启用状态
- `DELETE /v1/demand-subscriptions/{id}` - 软停用
- `GET /v1/demand-matches` - 需求匹配收件箱（只含本人订阅产生的匹配）
- `GET /v1/demand-matches/unread-count` - 未读数
- `POST /v1/demand-matches/{id}/read`、`/dismiss` - 标记已读 / 忽略
- 商品发布与编辑时在同一事务内同步匹配，详见 `docs/demand-radar.md`

### 4. 校园常用面交点 (`/v1/meeting-points`)
- `GET /v1/meeting-points` - 获取校园内官方推荐的安全公共交易点（图书馆一楼正门、学一食堂、宿舍快递驿站、教学楼等）。V3 起附带演示坐标 `latitude` / `longitude`，仅用于校园示意地图与直线距离估算，不是导航数据；V5 起附带 `active`，停用的面交点仍返回（历史订单要显示名称），但不能用于新下单或新提议

### 5. 留言与即时私信 (`/v1/conversations`, `/v1/messages`)
- `GET /v1/products/{id}/comments` - 获取商品下方公开留言问答列表
- `POST /v1/products/{id}/comments` - 在商品下公开发表询问留言
- `GET /v1/conversations` - 获取当前用户的私信会话列表
- `POST /v1/conversations` - 基于商品创建或进入一对一咨询会话
- `GET /v1/conversations/{id}/messages` - 分页拉取私聊历史消息
- `POST /v1/conversations/{id}/messages` - 发送私信消息
- `POST /v1/conversations/{id}/read` - 上报消息已读游标
- `GET /v1/messages/unread` - 获取全站未读消息红点计数

---

## 六、工程代码结构

```
campus-market-backend/
├── docker-compose.yml             # 仅安装启动 PostgreSQL 数据库的 Docker Compose
├── pom.xml                        # Maven 依赖定义 (Spring Boot 3, MyBatis-Plus, PostgreSQL Driver, JJWT 等)
├── README.md                      # 本文档
└── src/
    ├── main/
    │   ├── java/com/lulu/campusmarketbackend/
    │   │   ├── CampusMarketBackendApplication.java  # 启动类
    │   │   ├── api/                                 # 控制层与统一响应规范
    │   │   │   ├── CampusMarketController.java      # REST 控制器 (所有 /v1 接口路由)
    │   │   │   ├── ApiEnvelope.java                 # 统一响应对象 { code, data, message }
    │   │   │   ├── ApiException.java                # 业务异常抽象
    │   │   │   ├── ApiExceptionHandler.java         # 全局异常捕获器
    │   │   │   └── ApiResponseAdvice.java           # 自动报文包装拦截器
    │   │   ├── config/                              # 基础配置
    │   │   │   ├── WebConfig.java                   # CORS 跨域配置与定时任务支持
    │   │   │   ├── JacksonConfig.java               # ObjectMapper
    │   │   │   └── MybatisPlusConfig.java           # MyBatis-Plus Mapper 扫描
    │   │   ├── entity/                              # 数据实体对象
    │   │   ├── mapper/                              # 数据访问接口与 XML 映射
    │   │   ├── security/                            # JWT、Cookie 与安全校验逻辑
    │   │   └── service/                             # 核心业务服务层 (MarketService, OrderService 等)
    │   └── resources/
    │       ├── application.yaml                     # 核心配置文件
    │       ├── db/
    │       │   └── schema.sql                       # 自动初始化的数据库表结构与索引脚本
    │       └── mapper/                              # 复杂 SQL 查询映射 XML
    └── test/                                        # 自动化测试用例
```

---

## 七、常见问题排查 (FAQ)

### Q1: `docker compose up -d` 报错端口 5432 已被占用？
- 说明本地已安装或运行了独立的 PostgreSQL 实例。
- **解决方式 1**：停用本地原本运行的 postgres 服务（如 `brew services stop postgresql` 或在服务管理器中停止）。
- **解决方式 2**：修改 `docker-compose.yml` 中的端口映射，如改为 `"5433:5432"`，同时启动后端时指定环境变量：
  ```bash
  export DATABASE_URL=jdbc:postgresql://localhost:5433/campus_market
  mvn spring-boot:run
  ```

### Q2: 前端请求接口出现跨域 (CORS) 错误？
- 检查前端运行的端口与后端配置的 `WEB_ORIGIN` 是否一致。
- 本地前端默认端口为 `5173`。若前端运行在其他端口（例如 `http://localhost:8080`），启动后端前请设置：
  ```bash
  export WEB_ORIGIN=http://localhost:8080
  mvn spring-boot:run
  ```

### Q3: 如何完全清空数据库重新体验？
```bash
# 停止容器并销毁持久化数据卷
docker compose down -v

# 重新启动数据库
docker compose up -d

# 重启后端，schema.sql 将自动重新建表初始化
mvn spring-boot:run
```
