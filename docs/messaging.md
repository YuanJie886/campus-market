# 私信：预设快捷消息与自由文字开关

> 状态日期：2026-10-21。迁移 `V21__message_templates.sql`。商品留言**不受影响**：仍是自由文字，照常做内容安全检查，可举报、可由工作人员隐藏（`HIDE_COMMENT`）。

## 1. 为什么

私信是一对一的私密沟通，平台看不到上下文，出问题只能靠举报事后处理。早期没有足够的人工审核能力，所以**默认只允许发送一组预设的快捷消息**：
文案固定、可预期，买卖双方仍能完成「还在吗 / 成色如何 / 能否议价 / 申请联系方式」这些最常见的沟通，真正的联系通过商品页的「申请联系方式」完成（卖家同意后才展示）。
需要更自由的沟通时，运营可以打开自由文字开关（见第 3 节），自由文字照常做内容安全检查。

## 2. 规则

| 项目 | 规则 |
|---|---|
| 快捷消息定义 | 只在后端一处定义：`messaging/MessageTemplates.java`（code、文案、角色、顺序）。客户端从 `GET /v1/message-templates` 读取，不要硬编码 |
| 角色 | `BUYER_*` 只能由会话的买家（发起人）发送，`SELLER_*` 只能由卖家发送，`ANY_*` 双方都可以 |
| 存储 | `messages.content` 存发送时的文案，`messages.template_code` 存 code；自由文字（含 V21 之前的全部历史消息）`template_code` 为 NULL。以后改文案不影响已发送的消息；删除某个 code 后历史消息照常显示，只是不能再发 |
| 不可修改 | `template_code` 与正文一样写入后不可修改（V21 更新了 `messages_moderation_guard` 触发器）；格式约束 `^[A-Z][A-Z0-9_]{0,63}$`（不在数据库里限定具体有哪些 code） |
| 内容安全 | 快捷消息文案固定，**不做**内容安全检查；自由文字（开关打开时）照常做关键词过滤与微信 `msg_sec_check`（场景 MESSAGE） |
| 权限 | 不变：只有会话双方能读写；买家在商品对其不可见（圈子可见、被治理隐藏、离开圈子等）后与第三方一样 404「会话不存在」；未登录 401 |
| 举报与隔离 | 不变：快捷消息与自由文字一样可以举报（目标类型 MESSAGE）、被隔离（`QUARANTINE_MESSAGE`）、申诉解除。被隔离的消息对双方返回 `content=""`、`quarantined=true`，`templateCode` 同样返回 null（code 本身就等于正文） |
| 限流 | 私信本来没有单独的限流，保持不变 |

### 2.1 快捷消息（顺序即接口顺序）

| code | 文案 | 角色 |
|---|---|---|
| `BUYER_STILL_AVAILABLE` | 你好，这件还在吗？ | BUYER |
| `BUYER_ASK_CONDITION` | 可以再介绍一下成色和使用情况吗？ | BUYER |
| `BUYER_ASK_PRICE` | 价格还有商量的空间吗？ | BUYER |
| `BUYER_ASK_PHOTOS` | 方便在商品里补充几张实物照片吗？ | BUYER |
| `BUYER_ASK_CONTACT` | 我想要这件，已在商品页申请联系方式，麻烦同意一下。 | BUYER |
| `SELLER_AVAILABLE` | 还在的，可以在商品页申请联系方式。 | SELLER |
| `SELLER_SOLD` | 不好意思，已经出了。 | SELLER |
| `SELLER_PRICE_FIRM` | 价格不议，谢谢理解。 | SELLER |
| `SELLER_PRICE_NEGOTIABLE` | 价格可以商量，交换联系方式后细聊。 | SELLER |
| `SELLER_CONTACT_VIA_REQUEST` | 请在商品页点「申请联系方式」，我同意后你就能看到。 | SELLER |
| `SELLER_PHOTOS_ADDED` | 照片已补充，刷新商品页就能看到。 | SELLER |
| `ANY_THANKS` | 好的，谢谢！ | ANY |
| `ANY_LATER` | 稍等，我晚点回复你。 | ANY |

## 3. 开关

`campus-market.messages.free-text-enabled`（环境变量 `MESSAGES_FREE_TEXT_ENABLED`），**默认 `false`**。

- `false`（默认，建议试运行期间保持）：只能发快捷消息；请求体里出现 `content`（不论是否同时带 `templateCode`）一律 400。
- `true`：`{"content":"…"}` 与以前完全一样（1～2000 字，去掉首尾空白，内容安全检查）；快捷消息照常可用；两个字段同时出现 400。

开关只影响**新发送**的消息；历史自由文字消息始终照常显示。生产编排（`campus-market-frontend/deploy/docker-compose.yml`）已透传该变量，默认 `false`；需要打开时在 `deploy/.env` 里设置 `MESSAGES_FREE_TEXT_ENABLED=true`。

## 4. 接口契约

### `GET /v1/config`（不需要登录）

在原有 `images` 之外新增：

```json
{"images":{…不变…},"messages":{"freeTextEnabled":false}}
```

### `GET /v1/message-templates`（需要登录，未登录 401）

```json
{"freeTextEnabled":false,"templates":[{"code":"BUYER_STILL_AVAILABLE","text":"你好，这件还在吗？","role":"BUYER"}, …共 13 条，顺序同 2.1…]}
```

`role` 取值 `BUYER | SELLER | ANY`。客户端按当前用户在会话里的身份（是否等于会话的 `buyerId`）过滤出可发送的模板。

### `POST /v1/conversations/{id}/messages`

请求体只允许 `templateCode`、`content` 两个字段（其他字段 400「请求包含不支持的字段：…」，与其他接口一致）。

| 情况 | 结果 |
|---|---|
| `{"templateCode":"<code>"}`，角色匹配 | 200，正文为预设文案 |
| code 不存在（含大小写不符、空串、非字符串、null） | 400「快捷消息不存在」 |
| 角色不匹配（买家发 `SELLER_*`，卖家发 `BUYER_*`） | 400「这条快捷消息不能由你发送」 |
| 开关关闭，请求体含 `content`（不论是否带 `templateCode`） | 400「私信目前只能发送预设的快捷消息」 |
| 开关关闭，请求体为空 `{}` | 400「请选择一条快捷消息」 |
| 开关打开，`content` 与 `templateCode` 同时出现 | 400「只能二选一：快捷消息或文字」 |
| 开关打开，`{"content":"…"}` | 与以前一样（长度校验、内容安全 400「内容可能包含违规信息，请修改后再提交」） |
| 不是会话双方 / 买家已看不到商品 / 会话不存在 | 404「会话不存在」（与以前一致） |

检查顺序：字段白名单 → 请求体（以上 400）→ 参与者（404）→ 角色（400）→ 内容安全（仅自由文字）→ 写入。所有被拒的请求都不落库。

### 消息响应（创建与列表）

在原有字段（`id`、`conversationId`、`senderId`、`content`、`createdAt`、`quarantined`）之外新增 `templateCode`：快捷消息为 code，自由文字（含历史消息）为 `null`，被隔离时为 `null`。

会话列表（`GET /v1/conversations`）不变；它本来就没有「最后一条消息」字段，客户端从消息列表取最后一条时，看到的就是快捷消息的文案。

## 5. 测试追踪

| 要求 | 测试（类 › 用例） |
|---|---|
| 模板接口需要登录；13 条按约定顺序，code / text / role 完全一致；`freeTextEnabled=false` | `MessageTemplatesIT` › `templatesEndpointListsTheContractInOrderAndRequiresLogin` |
| `/v1/config` 返回 `messages.freeTextEnabled=false`，`images` 不变 | `MessageTemplatesIT` › `configReportsTheMessagesSwitch`；`UploadedImagesIT` › `publicConfigIsAnonymousAndMatchesTheLimitsTheValidatorsEnforce` |
| 买家发 BUYER_* / ANY_*、卖家发 SELLER_* / ANY_*；文案与 code 落库；创建与列表响应带 `templateCode` | `MessageTemplatesIT` › `buyerAndSellerSendTheirOwnTemplates` |
| 角色不对 400，不落库 | `MessageTemplatesIT` › `wrongRoleIsRejected`；`MessageFreeTextEnabledIT` › `templatesStillWorkAndSkipContentSafety` |
| 未知 code 400，不落库 | `MessageTemplatesIT` › `unknownCodeIsRejected` |
| 默认关闭时自由文字 400（含同时带 code）、空请求 400、未知字段 400，均不落库、不进内容安全 | `MessageTemplatesIT` › `freeTextIsRejectedByDefault` |
| 历史自由文字消息照常显示，`templateCode=null` | `MessageTemplatesIT` › `legacyFreeTextMessagesStillDisplay` |
| 第三方 / 不存在的会话 / 失去可见性的买家 404，未登录 401 | `MessageTemplatesIT` › `thirdPartiesStillCannotSendOrRead`；`MessageFreeTextEnabledIT` › `thirdPartyFreeTextIsStillNotFound`；`CircleMarketIT` › `switchToCircleOnly` |
| 开关打开：配置与模板接口报告 true | `MessageFreeTextEnabledIT` › `switchIsReported` |
| 开关打开：自由文字照常发送并做内容安全，`templateCode=null` | `MessageFreeTextEnabledIT` › `freeTextWorksWithContentSafety`；`ContentSafetyIT` › `keywordFilterBlocksProhibitedTradesEvenWhenSplitAndRecordsNoRawText` |
| 开关打开：两个字段同时出现 400 | `MessageFreeTextEnabledIT` › `bothFieldsAreRejected` |
| 快捷消息跳过内容安全 | `MessageFreeTextEnabledIT` › `templatesStillWorkAndSkipContentSafety` |
| 快捷消息可举报、隔离（双方看到占位、`templateCode=null`）、申诉解除；`template_code` 不可修改 | `GovernanceRulesIT` › `messages`；`ModerationIT` › `reporterPrivacy` |
| V21 迁移：空库与旧库升级都到 V21 | `PostgresSchemaIT`、`FlywayLegacyBaselineIT` |
