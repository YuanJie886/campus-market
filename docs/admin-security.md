# 运营后台安全（阶段 2）

> 状态日期：2026-10-19。本文的「通过」都来自本机实际执行；没有部署到任何服务器。迁移 `V17__admin_security.sql`。

## 1. 角色与权限（每次请求从 `staff_members` 读取）

| 角色 | 权限 |
|---|---|
| SCHOOL_ADMIN 学校管理员 | 本校用户、商品、历史订单、授权审计、复核请求与读取审计；商品编辑与展示管理；发起 / 确认人员变更；案件与申诉处理；**注册邀请码签发、撤销与查看**（V23） |
| SENIOR_MODERATOR 高级审核员 | **与审核员相同的后台范围**：商品目录只读、案件与申诉处理；更长的限制、强制归档圈子等仍按治理规则。**不再自动获得**用户 / 订单 / 审计只读与商品编辑；注册邀请码 403 |
| MODERATOR 审核员 | 商品目录只读；案件与申诉处理（限制最长 7 天）；注册邀请码 403 |
| AUDITOR 只读审计员 | 本校用户、商品、历史订单、授权审计、复核请求、读取审计、角色权限表、**注册邀请码**只读；不能处理案件，不能签发或撤销邀请码 |

注册邀请码（V23，`registration-invites:read` / `registration-invites:write`）：只能看到、操作本校的邀请码，他校的一律 404；
明文只在签发响应里出现一次。接口、命令行引导签发与分发建议见 [registration-invites.md](registration-invites.md)。

**为什么收窄高级审核员**：高级审核员是接入后台之前就存在的角色，README 承诺「接入代码不会为现有账号自动增加权限」，
但此前的实现让所有高级审核员在后台上线那一刻自动获得了用户、订单、审计只读与商品编辑权限。需要这些能力的人应由学校管理员按需授予对应角色。

## 2. 两人复核与最后一名学校管理员

- **任何涉及学校管理员的变更**（授予、降级为其他角色、停用）只生成一条 `admin_role_requests`（PENDING，72 小时内有效），
  由**另一位**本校学校管理员确认才生效；发起人、被变更的本人都不能确认。发起人可以撤回；过期后显示为 EXPIRED，不能再确认。
- 确认时以当时的状态重新校验：目标的后台权限在发起后已变化、已不在本校、或变更后本校将没有在岗学校管理员，都会拒绝（409）。
- 确认与生效、审计在同一事务：`admin_staff_audit` 同时记录发起人（`staff_user_id`）与确认人（`confirmed_by`）和对应请求；
  数据库约束要求两者不同。复核请求内容不可改、处理结果是终态、不能删除。
- 其他角色之间的变更（例如授予审计员、审核员）仍由一位学校管理员完成并审计。
- **每校至少一名在岗学校管理员**：数据库守卫在降级 / 停用 / 改学校前按学校行加锁，再确认仍有另一位在岗学校管理员；运维 SQL 同样受限。
- 结果：一所学校至少需要**两名**学校管理员才能在后台授予第三名；要撤掉一名学校管理员，需要第三名来确认。首批两名由运维按
  `campus-market-backend/docs/staff-runbook.md` 的受控 SQL 配置。

## 3. 利益回避

- 后台直接管理商品（编辑、隐藏、恢复）前调用 `staff_product_conflict`：本人商品（OWN_CONTENT）、本人举报过（OWN_REPORT）、
  申请过这件商品的联系方式（CONTACT_PARTY）一律 403 `CONFLICT_OF_INTEREST`。
- 治理案件的 `staff_case_conflict` 同样新增 CONTACT_PARTY：申请过某件商品联系方式的工作人员不能查看、领取或处理该商品的案件。

## 4. 读取留痕、限流与审计表保护

- **读取留痕**：读取用户、历史订单、授权审计、复核请求、读取审计、注册邀请码（V23，详情含使用者昵称）时写入 `admin_read_audit`：工作人员、资源、记录 id（详情）或返回条数（列表 / 导出）、
  请求 id、时间。搜索词可能本身就是个人信息（账号、昵称），**只存小写后的 SHA-256**，不存原文。商品目录不是个人信息，不记录。
  只读审计员与学校管理员可以在后台查看读取审计；查看本身也留痕。表只增不改。
- **限流**（按工作人员）：读取（列表、详情、导出）每 10 分钟 300 次，写入（授权、复核、商品管理、签发 / 撤销注册邀请码）每 10 分钟 60 次；超限 429 + `Retry-After`。
  可用 `RATE_LIMIT_ADMIN_READ` / `RATE_LIMIT_ADMIN_WRITE` 调整。
- **禁止 TRUNCATE**：后台审计、复核请求、读取审计、治理案件 / 举报 / 动作 / 申诉 / 限制、联系申请、历史交易收尾与全部历史交易表都有语句级守卫
  （行级的 UPDATE / DELETE 守卫此前已有）。数据库超级用户仍可绕过——这是防误操作与应用层漏洞，不是防有意破坏的 DBA；后者靠数据库审计与备份。
- **500 留痕**：未预期的服务端错误按请求 id 记录异常与堆栈（不记录请求体、参数或令牌）。

## 5. 浏览器侧

- 网页与后台同源（`/admin/`）。网页 nginx 在 server 级统一设置安全响应头（`deploy/nginx/security-headers.conf`），后台容器也加载同一份：
  - `Content-Security-Policy`：脚本只允许同源；`frame-ancestors 'none'`（防点击劫持）；`form-action 'self'`、`base-uri 'self'`、`object-src 'none'`；
    MUI 运行时注入样式需要 `style-src 'unsafe-inline'`；商品图片暂时允许任意 `https:`（接入自有对象存储后收紧为该域名）；
  - `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、
    `Permissions-Policy`（关闭摄像头、麦克风、定位、支付、USB）、`Cross-Origin-Opener-Policy: same-origin`；`server_tokens off`。
  - HSTS 由前面终止 HTTPS 的反向代理设置。
- E2E 的静态服务器读取同一份头文件，真实浏览器测试在同样的 CSP 下运行；部署演练检查 `/`、`/admin/`、`/v1/health` 都带上这些头。
- 去掉了网页 nginx 里指向后端 `/docs` 的代理（后端没有这个接口，属于无用暴露面）。

## 6. 依赖扫描

- CI 新增 `dependency-audit`：网页与后台的生产依赖出现 high 及以上漏洞即失败（本机 2026-10-19：网页 2 个 moderate、后台 0）；
  小程序 Taro 工具链目前 28 个（6 critical / 14 high / 8 moderate），先只报告不阻塞，阶段 4 处理。
- `.github/dependabot.yml`：Maven、三个 npm 工程与 GitHub Actions 每周检查一次，只开 PR、不自动合并。

## 7. 评估：后台独立子域名与二次验证（未实施，需要外部条件）

| 方案 | 收益 | 代价 / 前提 | 建议 |
|---|---|---|---|
| 后台放到独立子域名（如 `admin.<域名>`），Cookie 不共享 | 网页出现 XSS 时不能直接带着同一会话访问后台；后台可以单独加 IP 白名单、单独的 CSP | 需要额外的备案域名与证书；刷新 Cookie 的 `Path`、`SameSite` 与 Origin 校验要按子域名重做；后台需要独立登录 | 正式上线前实施。受控试运行阶段靠 CSP、同源、令牌只在内存与本节其余措施 |
| 后台二次验证（TOTP） | 账号密码泄露时后台仍然安全 | 需要密钥存储与找回流程（找回本身要两人复核）；工作人员要装验证器应用 | 与账号体系（阶段 3：微信登录 / 校园邮箱）一起设计；在此之前限制工作人员人数并用两人复核约束最危险的操作 |
| 后台访问 IP 白名单 / VPN | 大幅缩小攻击面 | 依赖学校网络环境；远程值班不便 | 部署时按学校情况决定，nginx 层即可实现 |

## 8. 测试追踪

| 要求 | 测试（类 › 用例） |
|---|---|
| 授予学校管理员需要第二位学校管理员确认；发起人、被授权人、审核员都不能确认；审计记录发起人与确认人；数据库拒绝发起人自确认 | `AdminSecurityIT` › `grantingSchoolAdminNeedsASecondSchoolAdminAndBothAreAudited` |
| 降级 / 停用同样两人复核；驳回、撤回、过期；其他角色变更仍一人完成 | `AdminSecurityIT` › `demotionIsAlsoTwoPersonAndRequestsCanBeRejectedCancelledOrExpire` |
| 每校至少一名在岗学校管理员（数据库守卫） | `AdminSecurityIT` › `aSchoolAlwaysKeepsAnActiveSchoolAdmin` |
| 高级审核员不被后台自动扩权 | `AdminSecurityIT` › `seniorModeratorsAreNotWidenedByTheAdminConsole` |
| 商品管理与商品案件的利益回避（CONTACT_PARTY、OWN_REPORT） | `AdminSecurityIT` › `productManagementRecusesStaffWithAContactRequestOrAReport` |
| 读取个人信息留痕、搜索词只存哈希、审计员可查看、查看本身留痕、只增不改 | `AdminSecurityIT` › `readingPersonalDataIsAuditedWithoutStoringTheSearchText` |
| 后台读写按工作人员限流 | `AdminSecurityIT` › `adminReadsAndWritesAreRateLimitedPerStaffMember` |
| 审计与历史表禁止 TRUNCATE | `AdminSecurityIT` › `auditAndHistoryTablesCannotBeTruncated` |
| 安全响应头 | 部署演练「安全响应头」三项；真实浏览器 E2E 在同一 CSP 下全部通过 |
| 注册邀请码的权限、本校隔离、限流、读取留痕 | `RegistrationInviteAdminIT`（逐项见 [registration-invites.md](registration-invites.md) 第 7 节） |
| 迁移结构与版本 | `PostgresSchemaIT`（表集合、V1～V17）；`FlywayLegacyBaselineIT`（LATEST=17） |
