# 真实图片上传与内容安全（阶段 4）

> 状态日期：2026-10-19。迁移 `V19__uploaded_images_and_content_safety.sql`、`V20__content_safety_textbook_scene.sql`。本文的「通过」都来自本机实际执行；
> 微信内容安全只用本机桩服务器验证过；**没有开通任何云存储或第三方服务**。

## 1. 图片

| 环节 | 做法 |
|---|---|
| 上传 | `POST /v1/images`（multipart，字段 `file`，需要登录）。只接受 JPEG / PNG，**按文件头判断**，不信任扩展名与 Content-Type；单张最大 5 MB；按用户每小时 60 张 |
| 防解压炸弹 | 先只读文件头里的宽高：超过 6000×6000 不解码直接拒绝 |
| 去元数据 | 服务端**重新编码**为 JPEG（质量 0.85），不写入任何元数据：EXIF、拍摄地点、设备信息全部丢弃；最长边缩到 1600 像素；透明背景铺白 |
| 存放 | `ImageStore` 接口；当前实现是本地持久卷（`IMAGES_DIR`，编排里是命名卷 `uploaded_images`），文件名为随机 id。接入对象存储只需新增实现 |
| 登记 | `uploaded_images`：上传者、学校、SHA-256、大小、宽高、状态（ACTIVE / HIDDEN / DELETED）；登记内容不可改、不能删除，删除只能改状态 |
| 读取 | 访问令牌只在内存里，`<img>` 带不上请求头，所以用**短时签名地址** `/v1/images/{id}?exp=…&sig=…`（HMAC，1 小时）。签名地址只出现在商品响应（只发给能看到这件商品的人，同一套可见性函数）与发布草稿响应（只发给草稿所有者与持有生效邀请的协助人）里；伪造、过期、隐藏、删除、不存在一律同一个 404 |
| 草稿预览 | 草稿 `GET /v1/listing-drafts`、`/{id}`、`/assisting`、保存后的响应与批次详情里的草稿，图片和商品响应一样换成签名地址，刷新后仍能预览。只给**草稿所有者本人上传、仍有效**的图片签名（整组草稿一条语句查完）；别人的图片、已隐藏 / 删除的图片原样返回 `upload:<id>`，保存时原样回写不会丢 |
| 回写 | 所有图片入口（商品发布 / 编辑、整套打包、草稿保存、批量发布）都接受平台自己签发的地址：相对的 `/v1/images/<uuid>?…`，或以这段路径结尾的绝对地址（`https://任意主机/…/v1/images/<uuid>?…`），先还原成 `upload:<uuid>` 再校验与保存——**库里只存引用**。签名是否有效、是否过期都不影响还原；能不能用这张图仍由「卖家或协助人本人上传、仍有效」决定。因此 GET 商品 / 草稿后把 `images` 原样 PATCH 回去，库里的引用不变 |
| 引用 | 商品里存 `upload:<id>`；只能引用**卖家本人或该商品协助人**上传、仍有效的图片：发布 / 编辑时先给出可读的 400，数据库在提交时再用约束触发器兜底（覆盖单件、打包、批量发布、后台编辑与直接写库） |
| 注销 | 本人上传的图片一律 DELETED，已经发出的签名地址同时失效 |
| 外部图片开关 | `campus-market.images.allow-external`（环境变量 `ALLOW_EXTERNAL_IMAGES`），**默认 `true`**：开发、测试、E2E 与演示数据不变。设为 `false` 时：单件 / 打包发布、草稿新建与保存、草稿标记可发布、批量发布里**新提交**的 `http(s)://` 图片一律 400「不支持外部图片链接，请先上传图片」（批量发布逐条给出 `INVALID_FIELD`，整批不发布）；**编辑**商品时，这件商品原本就有的外部地址可以原样保留（也可以调整顺序），旧商品照常可编辑，但移除后不能再加回，也不能挪到别的商品；草稿同理（草稿原有的外部地址可以保留，但不能发布）。`upload:` 引用与平台签名地址不受影响。后台编辑商品只改标题 / 描述 / 价格，不接受图片字段（400），原有图片保持不变。公开上线前建议设为 `false` |
| 公开配置 | `GET /v1/config`（不需要登录，普通信封）：`{"images":{"maxCount":9,"maxBytes":5242880,"accept":["image/jpeg","image/png"],"externalAllowed":<开关>},"messages":{"freeTextEnabled":<私信自由文字开关>}}`（`messages` 见 `messaging.md`）。数值与上传、商品、草稿校验读同一组常量（`ImagePolicy`），客户端据此做上传前检查、决定是否显示「粘贴图片链接」 |

已知限制（如实说明）：

- 已经发出的签名地址在 1 小时内对拿到它的人一直有效——商品被隐藏后，之前看过的人在过期前仍能打开图片本身。需要立即下线时，把图片状态改为 HIDDEN（立即生效）。
- 图片本身没有自动内容审核（微信的图片检测是异步回调接口，需要正式 AppID 与可公网访问的回调地址）；目前靠举报与工作人员隐藏商品处理。
- 本地卷需要和数据库一起备份（见 `docs/backup-and-restore.md`）。

## 2. 文本内容安全

适用：商品标题与描述（发布、编辑）、留言、私信（**只在自由文字开关打开时**；默认只能发预设快捷消息，文案固定，不做内容安全检查，见 `messaging.md`）、昵称（修改资料；注册时只做关键词过滤）、圈子名称与简介（创建、修改；只检查本次提交的字段）、
教材建议的自由文本（书名、作者、出版社、版次、备注）。被拦截的圈子创建与教材建议不消耗各自的每日配额。

1. **关键词过滤（始终生效）**：内置一份很短的违禁交易词表（代考代写、证件、管制物品、药品与成瘾品、银行卡买卖、赌博、校园贷等，只放明确的词以免误伤），
   可用 `campus-market.content-safety.keywords-file` 追加。比对前统一全半角与大小写，去掉空白与标点，挡住「代 - 考」这类拆分。
2. **微信内容安全（配置 AppID / AppSecret 且用户已绑定微信时）**：`msg_sec_check` v2。`risky` 拒绝；`review` 放行但记录；
   微信不可用时**放行并告警**（关键词过滤仍然生效，举报与工作人员处理兜底）。调用凭证缓存到过期前 5 分钟。
3. 拦截与待复核记录在 `content_safety_events`：用户、场景（PRODUCT / COMMENT / MESSAGE / PROFILE / CIRCLE / TEXTBOOK_SUGGESTION，V20 放开最后一项）、来源、结论、规则编号 / 微信标签、文本的 SHA-256。**不保存原文，日志里也不出现原文**。
4. 用户看到的统一提示：「内容可能包含违规信息，请修改后再提交」，不提示命中了哪个词（避免被用来试探词表）。

未覆盖：举报说明与申诉理由（内容只给工作人员查看）。

## 3. 测试追踪

| 要求 | 测试（类 › 用例） |
|---|---|
| 重新编码去掉 EXIF / 定位；签名地址无需登录；伪造、无签名、过期、不存在一律 404；登记信息 | `UploadedImagesIT` › `uploadsAreReencodedWithoutMetadataAndServedOnlyThroughSignedUrls` |
| 未登录 401；按文件头拒绝非图片与 GIF；只读文件头就拒绝 7000×7000；超过 5 MB 413；损坏文件 400；缩放到 1600；透明铺白 | `UploadedImagesIT` › `onlyRealJpegOrPngWithinLimitsIsAccepted` |
| 商品只能引用本人有效图片（接口 400 + 直接写库被提交时拒绝）；响应里是签名地址、库里只存引用；隐藏后签名地址失效；登记不能删除 | `UploadedImagesIT` › `productsMayOnlyUseTheSellersOwnActiveUploadsAndResponsesCarrySignedUrls` |
| 注销后图片不可读 | `UploadedImagesIT` › `deletingTheAccountMakesItsImagesUnreadable` |
| 按用户限流 | `UploadedImagesIT` › `uploadsAreRateLimitedPerUser` |
| `GET /v1/config` 不需要登录、普通信封、字段与默认值；与实际校验一致（9 张可以、10 张 400，草稿同一上限，超过 maxBytes 413，accept 以外 400） | `UploadedImagesIT` › `publicConfigIsAnonymousAndMatchesTheLimitsTheValidatorsEnforce` |
| 商品 / 打包 / 批量发布接受相对与绝对签名地址并只存引用；GET → PATCH 原样回写引用不变；别人的签名地址还原后仍 400 | `UploadedImagesIT` › `productImagesAcceptThePlatformsOwnSignedUrlsAndStoreOnlyRefs` |
| 草稿（创建、详情、列表、协助人视图、批次详情）返回签名地址；只签所有者本人有效的图片；所有者与协助人 GET → PATCH 原样回写引用不变；图片隐藏后不再签名 | `UploadedImagesIT` › `draftResponsesSignOwnUploadsLikeProductsAndSavingThemBackKeepsRefs` |
| 开关关闭：配置返回 `externalAllowed=false` | `ExternalImagesDisabledIT` › `configReportsTheSwitch` |
| 开关关闭：单件、打包、草稿新建 / 保存、商品编辑加入外部地址 400（统一提示，不落库）；上传引用与签名地址照常 | `ExternalImagesDisabledIT` › `newExternalImagesAreRejectedEverywhereButUploadsAndSignedUrlsStillWork` |
| 开关关闭：同一商品原有外部地址可保留（只改标题、原样回写、调整顺序），不能挪到别的商品，移除后不能再加回 | `ExternalImagesDisabledIT` › `legacyExternalImagesStayEditableOnTheSameListingOnly` |
| 开关关闭：草稿原有外部地址可以保存，但标记可发布与批量发布 400（逐条原因，整批不发布） | `ExternalImagesDisabledIT` › `legacyExternalImagesInDraftsCanBeKeptButNotPublished` |
| 后台编辑不接受图片字段，原有图片不变 | `ExternalImagesDisabledIT` › `adminEditsCannotSetImagesAndKeepLegacyOnes` |
| 关键词过滤：拆分也能挡住、描述 / 编辑 / 留言 / 私信 / 昵称 / 注册都检查、不误伤「大麻袋」、事件不存原文、日志不含原文 | `ContentSafetyIT` › `keywordFilterBlocksProhibitedTradesEvenWhenSplitAndRecordsNoRawText`（本类打开私信自由文字开关） |
| 私信自由文字开关打开时照常做内容安全检查；快捷消息跳过内容安全（同样文字作为自由文字被拦截、作为快捷消息照常发送） | `MessageFreeTextEnabledIT` › `freeTextWorksWithContentSafety`、`templatesStillWorkAndSkipContentSafety` |
| 微信：risky 拒绝、review 放行并记录、不可用放行、凭证缓存、未绑定用户只有关键词过滤 | `ContentSafetyIT` › `wechatCheckBlocksRiskyAllowsReviewAndFailsOpenForBoundUsers` |
| 圈子名称 / 简介（创建、修改）与教材建议（书名、备注）同一提示拦截、不落库；正常文本通过；事件场景 CIRCLE / TEXTBOOK_SUGGESTION、不存原文 | `ContentSafetyIT` › `circlesAndTextbookSuggestionsUseTheSameCheck` |
| 部署：经 nginx 上传超过 1 MB 的图片、非 root 写入持久卷、重启后保留 | 部署演练「图片上传」两项 |

## 4. 头像

> 2026-10-21 新增。不需要迁移（`users.avatar` 仍是 V1 的 `text NOT NULL DEFAULT ''`）。

起因：客户端原来提供的「预设头像」是第三方图床（picsum.photos）上的图片，每次显示都会把查看者的 IP 交给第三方，与隐私政策不符。
改为**平台预设头像由客户端在本地绘制**，另外可以用本人上传的图片。规则集中在 `AvatarService`。

| 环节 | 做法 |
|---|---|
| 可提交的值（`PATCH /v1/auth/me` 的 `avatar`） | `""`：没有头像（客户端显示昵称首字）；`preset:1` … `preset:12`：**精确匹配**，不接受前导零、大小写变体（`preset:0`、`preset:13`、`preset:01`、`PRESET:1`、`preset:x` 都是 400「头像无效」）；`upload:<uuid>`：**本人上传、仍为 ACTIVE** 的图片（与商品图片同一个 `ImageService.requireUsable` 检查，别人的或已隐藏 / 删除的图片 400「只能使用自己上传的图片，请重新上传」）；`http(s)://` 地址：**只在** `campus-market.images.allow-external=true` 时接受，否则 400「不支持外部头像链接，请选择预设头像或上传图片」。其他任何值 400「头像无效」。长度、类型与去首尾空白沿用资料字段的既有规则（最多 2048 字，`null` 等同 `""`） |
| 签名地址回写 | 与商品图片相同（`ImagePolicy.normalize`）：相对的 `/v1/images/<uuid>?…` 或以这段路径结尾的绝对地址先还原成 `upload:<uuid>` 再校验，签名过期不影响还原。GET `/v1/auth/me` 后把整份资料原样 PATCH 回来，库里的引用不变。以平台路径结尾的 https 地址在外部开关关闭时也照常接受（它是平台自己的地址） |
| 库里存什么 | 只存上面四种之一；上传图片存小写的 `upload:<uuid>` |
| 展示（所有带头像的响应） | `preset:N`、`http(s)` 地址、`""` 原样返回；`upload:<id>` 换成 1 小时签名地址（与商品图片同一个 `ImageUrlSigner`）；图片已不是 ACTIVE（被隐藏 / 删除）或不属于这位用户时返回 `""`；不认识的旧值（只可能来自绕过接口的直接写库）同样返回 `""`。覆盖：`GET/PATCH /v1/auth/me`、注册 / 登录 / 刷新响应里的 `user`、`GET /v1/users/{id}`（商品详情的卖家、留言作者、会话对方都由客户端经这里取头像——商品、留言、会话响应本身只带用户 id）、圈子成员名单、后台交易列表与详情的 `buyerAvatar` / `sellerAvatar`。成员名单与后台列表整页只查一次图片状态，与行数无关 |
| 外部链接开关关闭时的旧数据 | 库里已有的外部头像展示时原样返回，改昵称等其他字段不受影响；但把同一个外部地址再次提交同样 400（契约不做「保留原值」例外，与商品图片不同），客户端应只在用户真的更换头像时才提交 `avatar` |
| 注册 | 默认 `""` |
| 注销 | `avatar` 清空为 `""`；本人上传的全部图片（含头像）改为 DELETED，已发出的签名地址立即 404 |
| 数据库约束 | **不加**。唯一写入口是 `PATCH /v1/auth/me` 的服务层校验；与商品不同，头像引用的图片之后被隐藏 / 删除时不需要拒绝任何写入，展示层返回 `""` 即可，因此没有新增触发器或迁移 |

隐私说明：上传头像的签名地址会发给所有能看到这位用户公开资料的同校登录用户（与昵称同一可见范围）；预设头像不产生任何图片请求。

测试追踪（`AvatarIT` 使用默认开关 `true`；`AvatarExternalDisabledIT` 设 `campus-market.images.allow-external=false`）：

| 要求 | 测试（类 › 用例） |
|---|---|
| 注册默认 `""` | `AvatarIT` › `registrationDefaultsToNoAvatar` |
| 每种可接受的值：`""`、`null`、`preset:1/9/10/12`、去空白、`upload:<id>`（含大写 uuid 规范化）、`https` / `http`（开关打开）；响应与库里的值 | `AvatarIT` › `acceptsEveryContractFormAndStoresTheReference` |
| `preset:0`、`preset:13`、`preset:01`、`PRESET:1`、`preset:x` 等及其他形式 400「头像无效」，库不变 | `AvatarIT` › `invalidPresetsAndUnknownFormsAreRejected` |
| 别人的上传（引用、相对 / 绝对签名地址）、不存在的、本人已隐藏的图片 400 | `AvatarIT` › `anotherUsersUploadAndUnusableImagesAreRejected` |
| 签名地址回写：GET me → PATCH 同一头像 → 库里仍是 `upload:<id>`；绝对地址、过期签名同样还原 | `AvatarIT` › `signedUrlFromAResponseRoundTripsToTheReference` |
| 图片 HIDDEN / DELETED 后本人与他人看到 `""`，库里引用保留 | `AvatarIT` › `hiddenOrDeletedAvatarImagesRenderAsEmpty` |
| 预设、外部地址原样展示；直接写库的非法值、别人的图片展示为 `""` | `AvatarIT` › `presetExternalAndUnknownStoredValuesRenderPerContract` |
| 未知字段仍拒绝（`avatarUrl`）；非字符串、超长 400 | `AvatarIT` › `unknownFieldsAndMalformedValuesAreStillRejected` |
| 商品卖家、留言作者、会话双方的头像为可读的签名地址；图片隐藏后为 `""` | `AvatarIT` › `uploadedAvatarIsSignedWhereverSellerCommenterOrChatPartnerIsShown` |
| 圈子成员名单签名上传头像、预设原样、隐藏后 `""` | `AvatarIT` › `circleMemberListSignsUploadedAvatarsAndKeepsPresets` |
| 后台交易列表与详情的买卖双方头像 | `AvatarIT` › `adminOrderRecordsSignBuyerAndSellerAvatars` |
| 注销清空头像、图片 DELETED、旧签名地址 404 | `AvatarIT` › `accountDeletionClearsTheAvatarAndDeletesTheUploadedImage` |
| 开关关闭：`https` / `http` 头像 400（专用提示），非法预设仍是「头像无效」 | `AvatarExternalDisabledIT` › `externalAvatarUrlsAreRejected` |
| 开关关闭：预设、上传引用、以平台路径结尾的绝对签名地址照常 | `AvatarExternalDisabledIT` › `presetsUploadsAndPlatformSignedUrlsStillWork` |
| 开关关闭：库里旧的外部头像原样展示，改其他资料不受影响，原样再提交 400 | `AvatarExternalDisabledIT` › `legacyExternalAvatarsAreStillDisplayedUnchanged` |
