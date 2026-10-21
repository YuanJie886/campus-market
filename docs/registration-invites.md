# 注册邀请码（邀请制注册）

> 状态日期：2026-10-21。迁移 `V23__registration_invites.sql`。本文的「通过」都来自本机实际执行；没有部署到任何服务器。

## 1. 为什么

首批小范围试运行（网页，安徽理工大学）只面向学校工作人员挑选的同学。开放注册意味着任何拿到网址的人都能进来，
早期没有足够的人手审核，所以试运行期间**注册必须持有本校工作人员签发的邀请码**。

- 开关：`REGISTRATION_INVITE_REQUIRED`（配置项 `campus-market.registration.invite-required`），**默认 false**——
  本地开发、测试与 E2E 的注册行为完全不变。**试运行的生产环境设为 `true`。**
- 客户端从 `GET /v1/config` 读取 `"registration": {"inviteRequired": true|false}`，决定注册表单是否显示邀请码输入框。
- 关闭时 `POST /v1/auth/register` 仍然接受 `inviteCode` 字段，但完全忽略：不校验、不占用任何邀请码。

> 部署提示：`campus-market-frontend/deploy/docker-compose.yml` 的 `api.environment` 是显式列表，只有列在那里的变量才会传进容器；
> 部署文件里为 `REGISTRATION_INVITE_REQUIRED` 设置的默认值是 `true`（`${REGISTRATION_INVITE_REQUIRED:-true}`）。

## 2. 注册时的规则

`POST /v1/auth/register` 增加可选字段 `inviteCode`（字符串）。要求邀请码时：

| 情况 | 结果 |
|---|---|
| 没有 `inviteCode`、为空或只有空白 | 400「请输入邀请码」 |
| 不存在、已撤销、已过期、已用完、签发给别的学校（与所选校区的学校不同）、格式不对 | **一律** 400「邀请码无效或已用完」——不透露是哪一种 |
| 有效 | 注册成功，占用一次 |

- **规范化**：转大写，去掉空格（含全角空格）与连字符，之后必须恰好是 12 位字母表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789` 内的字符。
  所以 `abcd efgh jkmn`、`ABCDEFGHJKMN`、`abcd-efgh-jkmn` 都等于 `ABCD-EFGH-JKMN`。字母表去掉了容易看错的 0/O、1/I/L。
- **原子占用**：在注册事务里执行带条件的 `UPDATE … SET used_count = used_count + 1 WHERE 未撤销 AND 未过期 AND used_count < max_uses AND 学校一致`，
  再插入用户、记录使用。注册失败（例如账号已存在 409）整个事务回滚，**不占用次数**。
  多人同时用一张只剩一次的邀请码时，数据库行锁保证只有一个成功，其余 400。
- **使用记录**：`registration_invite_uses(invite_id, user_id, used_at)`，只增不改、禁止 TRUNCATE。
- 邀请码的有效性在注册限流（同一账号每小时 5 次）计数**之后**判断，猜码同样受限流；12 位、31 个字符的空间约 7.9×10¹⁷。

## 3. 工作人员签发邀请码（后台）

后台「注册邀请码」，接口全部在 `/v1/admin/registration-invites`，只能看到、操作**本校**的邀请码（他校的一律 404）：

| 接口 | 学校管理员 | 只读审计员 | 审核员 / 高级审核员 / 普通用户 |
|---|---|---|---|
| `GET /v1/admin/registration-invites?status=ACTIVE\|USED_UP\|EXPIRED\|REVOKED&page&size(≤50，默认 20)` | ✓ | ✓ | 403 |
| `GET /v1/admin/registration-invites/{id}`（含 `uses`：谁、何时用的） | ✓ | ✓ | 403 |
| `POST /v1/admin/registration-invites` `{"maxUses":1～500,"expiresInDays":1～90,"note"?:≤100 字}` | ✓ | 403 | 403 |
| `POST /v1/admin/registration-invites/{id}/revoke`（幂等） | ✓ | 403 | 403 |

- 列表项：`id, codeHint（末 4 位）, maxUses, usedCount, expiresAt, revokedAt, note, createdBy（签发人昵称；命令行签发为 null）, createdAt, status`；
  时间是毫秒时间戳（与后台其他资源一致）。分页响应 `{items, total, page, size}`。
- 状态：已撤销 → `REVOKED`；否则用完 → `USED_UP`；否则过期 → `EXPIRED`；否则 `ACTIVE`。
- **明文只出现一次**：签发响应里多一个 `"code": "XXXX-XXXX-XXXX"`，之后任何接口都不再返回；库里只有规范化之后的 SHA-256 与末 4 位提示；从不写日志。
  弄丢了就撤销后重新签发。
- 权限名：`registration-invites:read`（学校管理员、只读审计员）、`registration-invites:write`（学校管理员），出现在 `GET /v1/admin/me` 的 `permissions` 里。
- 读取（列表、详情）计入后台读取限额并写读取留痕（`admin_read_audit.resource = 'registration-invites'`，详情会显示使用者昵称）；
  签发、撤销计入后台写入限额。
- 校验消息：「可用次数需为 1～500 的整数」「有效天数需为 1～90 的整数」「备注最多 100 个字」「备注格式无效」「请求包含不支持的字段：…」
  「邀请码状态无效」「分页参数无效」「查询参数无效」「编号无效」「邀请码不存在」。

## 4. 首次部署：用命令行签发第一张邀请码

开启邀请制后，第一位学校管理员也要先注册，而那时还没有任何工作人员能签发邀请码。用同一个镜像以命令行方式运行一次：

```bash
cd campus-market-frontend/deploy
docker compose run --rm api --campus-market.cli.issue-invite.school=aust
# 可选参数：
#   --campus-market.cli.issue-invite.max-uses=2      # 默认 1（1～500）
#   --campus-market.cli.issue-invite.days=3          # 默认 7（1～90）
#   --campus-market.cli.issue-invite.note=首批管理员   # 可选，100 字以内
```

- 镜像的 `ENTRYPOINT` 是 `java -jar app.jar`（exec 形式），`docker compose run` 后面的参数直接追加给应用。
- 与正常启动一样先执行 Flyway 迁移与学校数据包导入，然后签发一张邀请码（`created_by` 为空 = 命令行签发），
  **不启动 Web 服务**，向标准输出打印唯一一行后以 0 退出：

  ```
  邀请码：ABCD-EFGH-JKMN（1 次，至 2026-10-28 14:05）
  ```

  截止时间为北京时间。命令行模式下日志降到 WARN、不打印启动横幅。
- 学校不存在、已停用（或是已隐藏的演示学校 `pilot`）、参数越界时，向标准错误输出原因并以非 0 退出，例如
  `签发邀请码失败：学校「xxx」不存在或已停用（学校 id 见学校数据包，例如 aust）`（退出码 2；应用本身启动失败为 1）。
- 建议首批签发 `max-uses=2`（两名学校管理员，见 `campus-market-backend/docs/staff-runbook.md`），有效期尽量短。
  之后的邀请码一律由学校管理员在后台签发，命令行只用于引导。

## 5. 分发建议

- **私下发送**：一对一私聊或当面告知，不要发到群聊、朋友圈、公开文档或海报上。
- **次数要小**：默认按人签发（1 次）；确需给一个小组时，次数等于人数，不要预留余量。
- **有效期要短**：通常 1～7 天；过期没用的，重新签发即可。
- **备注写清楚**发给了谁、为什么（例如「计算机学院 2023 级班委 5 人」），便于事后核对使用记录。
- **泄露立即撤销**：发现邀请码被转发或公开，马上在后台撤销；已经用它注册的账号不受影响，需要时在后台核对使用记录后按治理流程处理。
- 生产环境设置 `REGISTRATION_INVITE_REQUIRED=true`；试运行结束、决定开放注册时改回 `false`（不需要迁移，已签发的邀请码保留为记录）。

## 6. 数据库

- `registration_invites`：`code_hash` 唯一（规范化之后的 SHA-256 十六进制）、`code_hint` 末 4 位、`max_uses` 1～500、
  `0 ≤ used_count ≤ max_uses`、有效期最长 90 天（按 2160 小时检查，不受时区夏令时影响）、`note` ≤ 100 字、`created_by` 可空（命令行）。
  守卫：除「已用次数每次 +1（撤销后不能再 +1）」与「撤销（终态）」外任何字段都不能改；不能删除；不能 TRUNCATE。
- `registration_invite_uses`：每个账号最多一条；插入时要求对应的一次使用已经计入 `used_count`；只增不改；不能 TRUNCATE。
- `admin_read_audit.resource` 白名单加入 `registration-invites`。

## 7. 测试追踪

| 要求 | 测试（类 › 用例） |
|---|---|
| 默认模式：不带邀请码照常注册 | `RegistrationInviteDefaultModeIT` › `registeringWithoutAnInviteCodeStillWorks` |
| 默认模式：inviteCode 接受但忽略（有效码不被占用、垃圾值不报错） | `RegistrationInviteDefaultModeIT` › `anInviteCodeIsAcceptedButIgnored` |
| `/v1/config` 两种模式 | `RegistrationInviteDefaultModeIT` › `publicConfigSaysInvitesAreNotRequiredAndKeepsTheOtherSections`；`RegistrationInviteRequiredIT` › `publicConfigSaysInvitesAreRequired` |
| 缺少 / 空白邀请码 400「请输入邀请码」 | `RegistrationInviteRequiredIT` › `aMissingOrBlankInviteCodeIsRejectedBeforeAnythingIsCreated` |
| 有效邀请码注册并占用、记录使用 | `RegistrationInviteRequiredIT` › `aValidCodeRegistersConsumesOneUseAndRecordsTheUse` |
| 用完后同一句话 400 | `RegistrationInviteRequiredIT` › `aCodeStopsWorkingOnceAllUsesAreTakenWithTheSameMessage` |
| 过期 / 撤销 / 他校 / 不存在 / 垃圾值同一句话、不占用 | `RegistrationInviteRequiredIT` › `expiredRevokedWrongSchoolUnknownAndGarbageCodesAllGetTheSameMessageAndConsumeNothing` |
| 规范化（小写、空格、连字符） | `RegistrationInviteRequiredIT` › `codesAreNormalisedLowercaseSpacesAndHyphens` |
| 注册失败（账号已存在）不占用 | `RegistrationInviteRequiredIT` › `aFailedRegistrationDoesNotConsumeAUse` |
| 并发使用一次性邀请码只成功一个（接受任意先后） | `RegistrationInviteRequiredIT` › `concurrentRegistrationsOnAOneUseCodeLetExactlyOneThrough` |
| 后台详情列出使用记录 | `RegistrationInviteRequiredIT` › `theAdminDetailListsWhoUsedTheCode` |
| 后台权限（学校管理员 / 只读审计员 / 审核员 / 普通用户 / 未登录） | `RegistrationInviteAdminIT` › `onlySchoolAdminsIssueAndRevokeAuditorsOnlyReadAndOthersAreForbidden` |
| 只看本校（他校 404） | `RegistrationInviteAdminIT` › `staffOnlySeeTheirOwnSchoolsInvites` |
| 明文只在签发响应里出现，库里只有哈希，不写日志 | `RegistrationInviteAdminIT` › `thePlainCodeAppearsOnlyInTheCreateResponse` |
| 列表、状态筛选、分页、命令行签发显示 createdBy=null | `RegistrationInviteAdminIT` › `listFiltersByStatusPagesAndShowsWhoIssuedEachCode` |
| 撤销幂等 | `RegistrationInviteAdminIT` › `revokingIsIdempotentAndRecordsWhoRevoked` |
| 校验消息 | `RegistrationInviteAdminIT` › `createValidatesItsInputWithClearMessages` |
| 后台读写限流 | `RegistrationInviteAdminIT` › `readsAndWritesAreRateLimitedPerStaffMember` |
| 读取留痕 | `RegistrationInviteAdminIT` › `listAndDetailReadsAreAudited` |
| 数据库守卫（改 code_hash / 删除 / TRUNCATE / 回退次数 / 撤销后再用等被拒） | `RegistrationInviteAdminIT` › `theDatabaseOnlyAllowsCountingUsesAndRevoking` |
| 命令行签发可用的邀请码、不启动 Web 服务、标准输出一行 | `RegistrationInviteRequiredIT` › `theBootstrapCommandIssuesAUsableCodeWithoutStartingTheWebServer` |
| 命令行默认参数；不存在 / 停用的学校、越界参数非 0 退出并给出原因 | `RegistrationInviteRequiredIT` › `theBootstrapCommandUsesDefaultsAndFailsClearlyForUnknownOrInactiveSchools` |
| 迁移结构与版本 | `PostgresSchemaIT`（表集合、索引、V1～V23）；`FlywayLegacyBaselineIT`（LATEST=23，旧库升级后两张表为空） |
