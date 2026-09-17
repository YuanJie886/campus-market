# 校园集市 · 校园二手交易平台（纯前端演示版）

一个面向校内学生的闲置物品交易平台演示应用。**无后端、无数据库**，使用 mock 种子数据 + 浏览器 `localStorage` 持久化，打开浏览器即可体验完整可交互的产品效果。

---

## 技术栈

| 分类 | 选型 |
| --- | --- |
| 构建工具 | Vite 5 |
| 框架 | React 18 + TypeScript 5 |
| UI 组件 | MUI (Material UI) v5 |
| 原子样式 | Tailwind CSS 3 |
| 路由 | react-router-dom v6 |
| 状态管理 | React Context + useReducer |
| 图标 | @mui/icons-material |
| 数据持久化 | localStorage（统一前缀 `campus_market_`） |

> **Tailwind 与 MUI 共存策略**：Tailwind 的 `preflight` 已关闭（`tailwind.config.js` → `corePlugins.preflight: false`），全局样式重置交由 MUI `CssBaseline` 负责，避免两套 reset 互相干扰；Tailwind 只提供原子类。

---

## 快速开始

> ⚠️ 项目路径包含空格，命令中的路径请用双引号包裹。

```bash
# 1. 进入项目目录
cd "/Users/lhz/WorkBuddy AI/2026-09-16-10-16-58/campus-market"

# 2. 安装依赖
npm install

# 3. 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 4. 生产构建（含 TypeScript 类型检查）
npm run build

# 5. 本地预览构建产物（http://localhost:4173）
npm run preview
```

### 一键体验账号

| 账号 | 密码 | 说明 |
| --- | --- | --- |
| `2021001` | `123456` | 演示主账号（小鹿同学），已有发布、收藏、订单、会话数据 |

登录页点击 **「一键体验账号」** 按钮即可自动登录，无需手动输入。

---

## 功能清单

### 模块 1 · 商品发布与浏览
- 首页响应式商品网格（手机 1 列 / 平板 2 列 / 桌面 3–4 列）
- 商品卡片：图片、标题、价格（原价划线对比）、成色标签、分类、校区、发布时间、浏览量、收藏按钮
- 商品详情页：多图切换、标题、价格与原价对比、成色、分类、校区、描述、卖家信息（头像 / 昵称 / 校区 / 联系方式脱敏）、浏览量
- 「我想要」下单、收藏、联系卖家
- 发布商品页：标题 / 描述 / 价格 / 原价 / 分类 / 成色（全新、几乎全新、轻微使用痕迹、明显使用痕迹）/ 交易地点（校区）/ 预置图片选择器（最多 5 张）/ 联系方式，含完整表单校验
- 商品状态：`在售` / `已售出` / `已下架`

### 模块 2 · 搜索与分类筛选
- 顶部搜索框，按关键词匹配**标题与描述**
- 分类导航：数码电子 / 教材书籍 / 生活用品 / 服饰鞋包 / 运动户外 / 其他
- 筛选：价格区间、成色、校区
- 排序：最新发布 / 价格从低到高 / 价格从高到低 / 最多浏览
- 搜索或筛选结果为空时展示友好空状态

### 模块 3 · 用户认证与个人中心
- 注册 / 登录（学号或手机号 + 密码），登录态持久化到 localStorage
- **一键体验账号**，方便快速演示
- 个人中心：我的发布（编辑 / 下架 / 标记已售 / 重新上架）、我的收藏、我的订单（我买到的 / 我卖出的）、编辑个人资料（昵称 / 头像 / 校区 / 联系方式）
- 未登录访问受限页面自动重定向到登录页，登录后回跳原页面

### 模块 4 · 交易与留言沟通
- 「我想要」下单生成订单，状态流转：`待确认 → 交易中 → 已完成 / 已取消`，卖家在「我卖出的」中确认
- 下单后商品自动锁定为「已售出」，取消订单后自动恢复「在售」
- 商品详情页留言板：留言 / 回复 / 按时间倒序展示
- 站内消息页：会话列表（按商品 + 对话聚合）+ 聊天窗口，模拟即时通讯
- 交易完成后可互相评价（星级 + 文字）

### 通用体验
- 全局顶部导航栏：Logo、搜索、发布按钮、消息入口（未读角标）、用户头像菜单
- 移动端底部导航：首页 / 消息 / 发布（凸起按钮）/ 收藏 / 我的
- 全中文界面，现代清爽风格，移动端友好
- 所有交互有反馈：Snackbar 提示、骨架屏、空状态、图片加载失败兜底（渐变 + emoji）
- 预置 **26 条**逼真校园二手商品种子数据，覆盖全部 6 个分类与 4 个校区

---

## 目录结构

```
campus-market/
├── index.html                  # 应用入口 HTML
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js          # Tailwind 配置（已关闭 preflight）
├── postcss.config.js
├── README.md
└── src/
    ├── main.tsx                # 应用入口，挂载全局 Provider
    ├── App.tsx                 # 路由表
    ├── theme.ts                # MUI 全局主题
    ├── index.css               # Tailwind 指令 + 全局样式
    ├── types/
    │   └── index.ts            # 领域模型与枚举类型
    ├── data/
    │   └── seed.ts             # 种子数据（用户 / 商品 / 订单 / 留言 / 会话）
    ├── utils/
    │   ├── storage.ts          # localStorage 封装（统一前缀）
    │   ├── id.ts               # 唯一 id 生成
    │   ├── format.ts           # 价格 / 时间 / 文本格式化与校验
    │   └── constants.ts        # 分类 emoji / 渐变、状态色、预置图片
    ├── context/
    │   ├── NotificationContext.tsx  # 全局 Snackbar 提示
    │   ├── AuthContext.tsx          # 用户认证与资料
    │   └── MarketContext.tsx        # 商品 / 订单 / 留言 / 收藏 / 会话 / 消息
    ├── components/
    │   ├── Layout.tsx          # 全局布局
    │   ├── Navbar.tsx          # 顶部导航
    │   ├── BottomNav.tsx       # 移动端底部导航
    │   ├── RequireAuth.tsx     # 受保护路由
    │   ├── ProductCard.tsx     # 商品卡片
    │   ├── ProductGrid.tsx     # 响应式商品网格（含骨架屏 / 空状态）
    │   ├── ProductForm.tsx     # 商品表单（发布 / 编辑共用）
    │   ├── FilterBar.tsx       # 搜索筛选排序工具条
    │   ├── ImageWithFallback.tsx    # 图片加载失败兜底
    │   ├── EmptyState.tsx      # 通用空状态
    │   ├── RatingStars.tsx     # 星级评分
    │   └── ReviewDialog.tsx    # 交易评价弹窗
    └── pages/
        ├── HomePage.tsx            # 首页
        ├── ProductDetailPage.tsx   # 商品详情
        ├── PublishPage.tsx         # 发布商品
        ├── LoginPage.tsx           # 登录
        ├── RegisterPage.tsx        # 注册
        ├── MessagesPage.tsx        # 站内消息
        ├── NotFoundPage.tsx        # 404
        └── profile/
            ├── ProfileLayout.tsx     # 个人中心布局（标签页）
            ├── ProfileInfoPage.tsx   # 个人资料
            ├── MyListingsPage.tsx    # 我的发布
            ├── FavoritesPage.tsx     # 我的收藏
            └── OrdersPage.tsx        # 我的订单
```

---

## 数据持久化说明

所有数据保存在浏览器 `localStorage`，key 统一带前缀 `campus_market_`：

| Key | 内容 |
| --- | --- |
| `campus_market_auth_v1` | 用户列表与当前登录用户 id |
| `campus_market_market_v1` | 商品 / 订单 / 留言 / 收藏 / 会话 / 消息 |

首次进入自动写入种子数据；之后以本地数据为准。
在 **个人中心 → 演示工具 → 重置演示数据** 可一键恢复到初始状态。

> 说明：本演示项目为纯前端实现，密码以明文存于 localStorage，仅用于功能演示，**切勿用于真实生产环境**。
