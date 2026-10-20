# 校园集市 · 微信小程序第一版

独立的 Taro 4.3 + React 18 + TypeScript 学生端。沿用 Web 首页的深绿配色与两列商品布局，底部为「集市 / 发布 / 通知 / 我的」。默认是可交互的本地演示模式，也提供现有 Spring Boot `/v1` 接口的 REST 适配。

## 已实现

- 登录、注册、登录后回到目标页面；演示买家与卖家身份切换。
- 商品列表、关键词、分类、校区、成色、价格筛选、排序、分页与下拉刷新。
- 多图详情、收藏、商品分享、联系方式复制及举报入口。
- 发布、编辑、成色与商品情况声明；最多 9 张照片真实上传（进度、失败重试、排序）；联系方式默认不公开。
- 隐私授权弹窗、用户协议与隐私政策（草案，待法务审核）、注册须勾选同意。
- 联系申请、卖家同意或拒绝、查看收到和发出的申请（分页加载）；获批准的买家才能查看该商品的联系方式。买家可以撤回待处理的申请并重新申请；卖家可以撤回同意，买家立即看不到联系方式。被拒绝或撤回同意后不能再次申请。
- 联系申请站内未读：底部「通知」角标显示卖家未读的新申请与买家未读的结果，打开对应列表即标记已读。
- 我的资料、发布、收藏；下架、标记已售和重新上架。
- 账号（阶段 3，见 `docs/account-lifecycle.md`）：修改密码（其他设备退出）、凭学校管理员签发的一次性重置码找回密码、自助注销（输入密码与「确认注销」）、微信一键登录与绑定 / 解除绑定。演示模式模拟微信身份；演示没有学校管理员，重置码找回会提示「演示模式不支持」。演示实现只打进演示构建，REST 产物不含演示账号。
- REST 请求 envelope、超时、单次重试、并发 401 单次刷新、429 提示、会话失效回到登录状态。

演示数据与真实接口模式各自独立，演示商品均为虚构数据，配图为本地示意插画。演示买家和卖家的数据保存在此客户端的专用本地缓存中。

## 开始体验

```sh
cd campus-market-miniapp
npm ci
npm run check
npm run dev:weapp
```

在微信开发者工具中导入 **`campus-market-miniapp/` 工程根目录**，配置文件的 `miniprogramRoot` 指向生成的 `dist/`。`touristappid` 是演示占位值；真机、分享及微信开放能力验证需要换成你的小程序 AppID。

打开后点击「登录 / 注册」→「以买家体验」。找一件未公开联系方式的商品，申请联系；到「我的」切换演示身份，以卖家登录，在「通知」同意申请；再切回买家，即可查看该商品的联系方式。

演示账号也可手动登录：`buyer001`、`seller001`，演示密码均为 `demo12345`。

### 浏览器预览

```sh
npm run dev:h5
```

访问 `http://127.0.0.1:5180`。H5 与微信端使用同一套页面和业务代码，方便检查手机布局。H5 预览不能替代微信真机验证；浏览器中的自选照片使用临时 URL，重新打开后可能需要重新选择。微信端演示选图使用本地保存文件。

## 连接当前后端

```sh
MINIAPP_API_BASE_URL=https://你的后端域名 npm run build:weapp:rest
```

第一版使用现有平台账号登录与注册，商品、收藏、资料、举报和联系申请直接调用当前后端。学校与联系方式的权限由后端决定。开发环境接口默认指向 `http://127.0.0.1:3000`，真机访问需改成设备可达的地址，并完成微信后台相应域名配置。

### 登录的当前范围

- 原生端 Access Token 和刷新 Cookie 仅保存在内存；Cookie 只发送到该后端的 `/v1/auth/` 路径。
- 本次运行期间支持刷新与轮换；原生端完全关闭后，需要重新输入账号登录。
- H5 使用浏览器凭据，跨域联调需把预览来源加入后端实际允许的 Web 来源配置。
- 没有持久化真实账号密码、访问令牌或刷新凭据。
- 微信一键登录（`wx.login` → `POST /v1/auth/wechat/login`）只在后端 `GET /v1/auth/wechat` 返回 `enabled: true` 时显示；后端返回 503「微信登录尚未开通」时隐藏。未绑定时得到的绑定票据只放内存（10 分钟、一次性），账号密码登录或注册成功后立即 `POST /v1/auth/wechat/bind`。AppSecret 只在后端配置，不写入此工程；尚未用真实 AppID 联调。

### 商品照片上传（阶段 4，见 `docs/images-and-content-safety.md`）

- 发布 / 编辑页最多 9 张照片（与后端上限一致）：`Taro.chooseMedia`（相册或拍摄，`sizeType: ['compressed']`）选图后逐张 `Taro.uploadFile` 到 `${MINIAPP_API_BASE_URL}/v1/images`，multipart 字段 `file`，请求头只带内存里的 `Authorization: Bearer`。
- 401 时与其他请求共用一次刷新，再重试一次；仍 401 结束会话。每张照片单独显示上传进度与失败原因：413「图片不能超过 5 MB」（超过 5 MB 的照片在本机就标为失败，不上传）、429 上传限流、400 原样显示后端文案；失败的可以点击重试或移除，提交前必须处理完。
- 表单里保存上传返回的 `ref`（`upload:<id>`），提交时按当前顺序放进 `images`；可移除、用 ‹ › 调整顺序，第一张是主图。
- 商品响应里的图片是 1 小时有效的相对签名地址 `/v1/images/…`，显示时拼上接口域名（`src/images.ts` 的 `resolveImageUrl`）；编辑时换回 `upload:<id>` 再提交（后端不接受签名地址）。外部 HTTP(S) 示例图原样保留。
- 演示模式不联网：照片在微信端用 `saveFile` 存为本机文件，演示库只记路径，返回与后端同形的引用与签名地址，显示时换回本机路径；内置示意插画仍可直接选用。
- 真机需要在微信后台把接口域名同时加入 request 合法域名、uploadFile 合法域名和 downloadFile 合法域名（图片走签名地址下载）。

内容安全：发布 / 编辑商品、修改昵称、注册被拦截时，后端返回 400「内容可能包含违规信息，请修改后再提交」，小程序原样提示。

### 隐私保护（阶段 5）

- `app.config.ts` 设置 `__usePrivacyCheck__: true`，构建后在 `dist/app.json` 中保留（已核对）。
- 启动时注册 `wx.onNeedPrivacyAuthorization`；发布、详情、登录页放有隐私弹窗：显示摘要并链接《用户协议》《隐私政策》，只有点击「同意」按钮（`open-type="agreePrivacyAuthorization"`）才 `resolve({ event: 'agree', buttonId })`，「拒绝」回 `disagree`。
- 选图（`chooseMedia`）、复制联系方式（写剪贴板）、微信登录凭证（`wx.login`）调用前先用 `getPrivacySetting` 检查，需要授权时先弹窗，拒绝则不调用并提示原因。
- 新增「用户协议」「隐私政策」页（`pages/terms`、`pages/privacy`），按本工程与后端实际收集的数据撰写，**顶部标注「草案，待法务审核后生效」**，运营主体、联系方式、存储地点、管辖等均为【…】占位，正式上线前须由运营主体和法务补全、审核。注册需勾选「已阅读并同意」；登录页与「我的」均有入口。
- 微信公众平台「用户隐私保护指引」需要按同样内容填写（相册 / 相机、剪贴板写入），这一步在后台完成，本工程无法代替。

## 检查与产物

```sh
npm run typecheck
npm test
npm run build:weapp        # 演示微信产物：dist/
npm run check:wxss         # 安装微信开发者工具后，用官方编译器复查 WXSS
npm run build:weapp:rest   # REST 微信产物：dist/
npm run build:h5           # 浏览器预览产物：dist-h5/
```

测试覆盖同校边界、联系方式按商品授权、重复申请、卖家审批、拒绝、收藏隔离、发布与状态管理，请求层 Cookie 作用域、并发刷新、错误处理和现有接口路径，以及图片上传（路径、请求头、字段名、401 单次刷新重试、错误文案）、签名地址解析、表单引用提交、隐私授权状态机与注册同意勾选。

### 发布设置（`project.config.json`）

- `uploadWithSourceMap: false`：上传到微信时不附带 Source Map，避免把源码结构随包发布（Taro 生产构建本身也不产出 `.map`）。
- `minified`、`minifyWXML`、`minifyWXSS` 保持 `true`：Taro 已用 terser 压缩 JS，开发者工具再压缩模板与样式。
- `es6` 保持 `true`：Taro 输出已是 ES5（已核对产物中没有箭头函数与 `const`），开发者工具的 ES6→ES5 转换只作兜底，对旧基础库更安全。
- `urlCheck` 保持 `true`：真机只访问后台配置的合法域名。`appid` 仍为占位的 `touristappid`，需换成正式 AppID。

## 依赖审计（`npm audit --omit=dev`，2026-10-19）

修复前后都是 **28 项：critical 6、high 14、moderate 8**。`npm audit fix --omit=dev`（不加 `--force`）没有可用的非破坏性修复，锁文件没有变化；其余修复都要把 Taro 4.3 降到 3.x 或升级 Vite / webpack 大版本，属于破坏性改动，未执行。
（注意：带 `--omit=dev` 的 `audit fix` 会把本地 `node_modules` 里的开发依赖删掉，之后需要 `npm ci` 恢复。）

| 漏洞所在包（严重度） | 来源 | 是否进入微信产物 |
|---|---|---|
| `swiper` 11.1.15（critical，原型污染） | `@tarojs/components` 的 H5 实现 | **否**；只在 H5 预览产物里（Swiper 组件，参数来自本工程固定的组件属性，不接收用户输入的配置对象）。微信端用原生 `<swiper>` |
| `@tarojs/*`（critical / high / moderate，6 + 若干） | 都是**继承**下面这些依赖的告警，Taro 包本身没有独立公告 | 微信产物只含 `@tarojs/runtime`、`@tarojs/taro` 的运行时部分，不含下列依赖 |
| `lodash-es` 4.17.21（high，`_.template` 代码注入 / 原型污染） | `@tarojs/taro-h5`、`@tarojs/router`（H5） | 否，只在 H5 预览产物里；本工程代码不调用 `_.template` |
| `braces`、`micromatch`、`chokidar`、`find-yarn-workspace-root`、`scss-bundle`（high） | `@tarojs/helper` 等构建工具的文件监听与匹配 | 否，构建期 |
| `webpack-dev-server`、`webpack-dev-middleware`、`http-proxy-middleware`、`selfsigned`、`node-forge`、`sockjs`、`uuid`（high / moderate） | 本地 H5 开发服务器 | 否，只在 `dev:h5` 时运行；只监听 127.0.0.1 |
| `vite`、`esbuild`（high / moderate，开发服务器读文件 / 跨站请求） | `@tarojs/plugin-framework-react` 的可选依赖与 vitest | 否，开发与测试期 |
| `webpack` 5.91.0（moderate，AutoPublicPath DOM clobbering、buildHttp SSRF） | `@tarojs/webpack5-runner` **固定** 5.91.0 | 否；本工程 `publicPath` 是固定值、不用 buildHttp |

结论：微信产物中没有发现带公告的依赖代码；剩余告警集中在构建工具、本地开发服务器和 H5 预览。等 Taro 发布修复后的 4.x 版本再整体升级。

`dist/` 和 `dist-h5/` 是构建产物，不提交；`package-lock.json` 固定安装依赖。构建 REST 后若想回到演示版，再运行 `npm run build:weapp`。

`check:wxss` 默认读取 macOS 标准安装位置；其他安装位置可通过 `WECHAT_WXSS_COMPILER` 指定官方 `wcsc` 可执行文件。它验证微信样式编译兼容性，不替代模拟器或真机测试。

## 后续范围

本版不接入旧订单、预约面交、交易评价与支付，也未迁移课程图谱、圈子管理、批量发布、整套打包和求购订阅。后台继续使用现有 Web 管理后台。

正式迁移前还需真实 AppID、真机联调、法务审核协议与隐私政策、微信后台隐私保护指引与合法域名配置。完整路线见 [迁移方案](../docs/wechat-miniapp-migration.md)。

已完成的构建、业务测试、手机预览与仍待处理的依赖审计，见 [第一版验证记录](../docs/wechat-miniapp-v1-validation.md)。
