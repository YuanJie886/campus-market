# 账号体系：修改密码、人工找回、注销与微信登录（阶段 3）

> 状态日期：2026-10-19。迁移 `V18__account_lifecycle.sql`。本文的「通过」都来自本机实际执行；微信接口只用本机桩服务器验证过，
> **没有**用真实 AppID 调用过微信。

## 1. 决定与边界

| 事项 | 决定 | 原因 |
|---|---|---|
| 密码 | 保留账号 + 密码登录；新增自助修改 | 网页端需要；微信登录未开通时是唯一入口 |
| 找回密码 | 先上线**人工找回**：学校管理员线下核对身份后签发一次性重置码 | 没有邮件 / 短信通道（需要外部服务与备案，未开通）。接入短信或校园邮箱后，可以改成自助发码，重置接口不变 |
| 注销 | 自助注销，匿名化而不是物理删除 | 微信小程序审核要求提供注销；治理与审计记录需要保留引用 |
| 微信登录 | 小程序 `code2session` 换 openid，绑定到已有账号；配置 AppID / AppSecret 后才启用 | 主体与 AppID 尚未确定；先把能力与测试做好，开通时只需要配置 |
| 校园邮箱验证 | 未实现 | 需要邮件服务；是公开上线前「学校身份核验」的候选方案（见 release-readiness） |

## 2. 接口

| 方法与路径 | 说明 |
|---|---|
| `POST /v1/auth/password` `{currentPassword, newPassword}` | 修改密码（8～72 位）；当前会话保留，**其他设备的会话全部结束**；按用户每小时 10 次 |
| `POST /v1/admin/users/{id}/password-reset` `{note}` | 学校管理员为本校用户签发重置码（`XXXX-XXXX-XXXX`，30 分钟、最多 5 次错误，只在这次响应里出现一次）；不能给自己签发；新码签发后旧码作废 |
| `POST /v1/auth/password-reset` `{account, code, newPassword}` | 凭重置码设新密码（码不区分大小写、可省略短横线）；成功后**全部会话结束**；失败一律「账号或重置码无效或已过期」；按账号每小时 10 次 |
| `POST /v1/auth/me/deletion` `{password, confirmation: "确认注销"}` | 注销（见第 3 节）；仍有后台权限或仍是在用圈子的所有者时 409 |
| `GET /v1/auth/wechat` | `{enabled, bound}` |
| `POST /v1/auth/wechat/login` `{code}` | 已绑定：直接签发会话（与密码登录相同的访问令牌与刷新 Cookie）；未绑定：`{bound:false, bindTicket, expiresAt}`（10 分钟、一次性） |
| `POST /v1/auth/wechat/bind` `{bindTicket}` | 已登录用户把这个微信绑定到自己；一个账号一个微信、一个 openid 一个账号 |
| `POST /v1/auth/wechat/unbind` | 解除绑定 |

## 3. 注销做了什么

同一事务里：在售商品下架；本人全部商品清除联系方式并取消「公开」；本人发出的待处理联系申请撤回、收到的待处理申请拒绝、已同意的撤回同意；
退出所有圈子（所有者身份需先移交或归档）；停用需求订阅；撤销协助邀请；解除微信绑定；结束全部会话；
资料匿名化（昵称「已注销用户」、头像与联系方式清空、宿舍楼清空、账号改为 `deleted-<id>`、密码改为随机值）；
写入只有数量、不含个人信息的 `account_deletions`。原账号名可以重新注册（是一个新账号）。

**保留**：已售出商品的标题描述、留言与私信正文（对方的历史记录）、治理案件 / 举报 / 处理 / 限制记录（合规与申诉需要）。
这些记录里本人显示为「已注销用户」。隐私政策需要如实写明这一点（阶段 7）。

## 4. 安全要点

- 重置码、绑定票据只存 SHA-256；重置票据内容不可改、用过或作废后是终态、不能删除或清空；有效期上限由数据库约束（30 分钟）。
- AppSecret 只来自环境变量；session_key、临时登录凭证与 AppSecret 从不落库、不进日志、不返回前端（`AccountLifecycleIT` 用捕获的日志断言）。
- 格式不对的登录凭证不会转发给微信；微信登录接口全局限流，防止被用来放大对微信接口的调用。
- 已注销的账号不能再被授予后台权限（服务端 409 + 数据库守卫）。

## 5. 测试追踪

| 要求 | 测试（类 › 用例） |
|---|---|
| 修改密码：核对当前密码、长度、未知字段、其他设备立即失效、当前会话保留、旧密码不能再登录 | `AccountLifecycleIT` › `changingPasswordEndsOtherSessionsButKeepsTheCurrentOne` |
| 重置码：只有学校管理员、不能给自己、必须写依据、库里只有哈希、新码让旧码作废、不透露账号是否存在、大小写与短横线无关、全部会话结束、只能用一次、终态不可改 | `AccountLifecycleIT` › `schoolAdminIssuesAOneTimeResetCodeThatIsStoredOnlyAsAHash` |
| 5 次错误后作废；过期不能用；有效期上限（数据库约束） | `AccountLifecycleIT` › `aResetCodeDiesAfterFiveWrongAttemptsAndExpiredCodesNeverWork` |
| 重置按账号限流 | `AccountLifecycleIT` › `resetAttemptsAreRateLimitedPerAccount` |
| 注销：确认语与密码、所有者 / 工作人员先处理、下架与清除联系方式、联系申请收尾、退出圈子、匿名化、会话结束、不能登录、审计不含个人信息、不能再获后台权限、账号名可重新注册、日志不含密码 | `AccountLifecycleIT` › `deletingAnAccountAnonymisesItAndClosesEverythingItOwned` |
| 微信登录：未开通 / 凭证无效 / 格式不对、未绑定返回票据、绑定需登录、票据一次性、绑定后直接登录（刷新 Cookie）、一对一、解绑、密钥与 session_key 不泄露 | `AccountLifecycleIT` › `wechatLoginBindsAnOpenidToAnExistingAccountWithoutLeakingSecrets`；`WeChatClientTest`（未配置即关闭、不可达时不泄露密钥） |
