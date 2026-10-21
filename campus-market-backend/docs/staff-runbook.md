# 平台工作人员运维手册

`staff_members` 表在迁移后**默认为空**：系统没有任何默认管理员、默认账号或默认密码；
公开注册接口不接受任何角色字段（未知字段一律 400），也不能创建工作人员。
工作人员身份每次请求都从数据库读取，不写进 JWT，因此下面的每一步都立即生效。

> 本手册里的 SQL 只能由有数据库管理权限的运维人员在受控环境里执行（例如带审批的变更窗口），
> 不要写进应用代码、脚本仓库或 CI；执行记录请同时登记到团队的变更记录里。

> V12 起已接入复用 react-admin 的 `/admin/` 管理后台。首位 `SCHOOL_ADMIN` 仍由数据库运维受控配置，后续本校工作人员授权/停用可以在后台操作，并写入不可修改的审计。详见 [管理后台说明](../../campus-market-admin/README.md)。`AUDITOR` 只读且不能处理案件；原有两个审核角色和利益回避规则保持兼容。
>
> **阶段 2（V17）起**：涉及 `SCHOOL_ADMIN` 的授予、降级、停用必须由另一位本校学校管理员在后台「人员变更复核」中确认，
> 并且每校至少保留一名在岗学校管理员（数据库守卫）。因此**首批需要由运维用下面同一段受控 SQL 配置两名学校管理员**（分别核对两个用户 UUID，各执行一次），
> 之后的学校管理员变更一律在后台走两人复核。高级审核员在后台只有治理与商品只读，需要用户 / 订单 / 审计只读的人请授予 `AUDITOR`。
> 设计与测试见 [docs/admin-security.md](../../docs/admin-security.md)。

## 0. 邀请制下的首次部署：先签发引导邀请码

首批试运行开启了邀请制（`REGISTRATION_INVITE_REQUIRED=true`，见 [docs/registration-invites.md](../../docs/registration-invites.md)）：
注册必须持有本校工作人员签发的邀请码，而首次部署时还没有任何工作人员。按下面的顺序引导：

1. 确认部署环境已设置 `REGISTRATION_INVITE_REQUIRED=true`、`SCHOOL_PACKS` 含本校（例如 `aust`），且 compose 的 `api.environment` 会把它传进容器。
2. 用同一个镜像以命令行方式签发**一张**引导邀请码（不启动 Web 服务，执行完即退出；迁移与学校数据包导入照常执行）：

   ```bash
   cd campus-market-frontend/deploy
   docker compose run --rm api --campus-market.cli.issue-invite.school=aust \
       --campus-market.cli.issue-invite.max-uses=2 --campus-market.cli.issue-invite.days=3 \
       --campus-market.cli.issue-invite.note=首批两名学校管理员
   ```

   标准输出只有一行：`邀请码：XXXX-XXXX-XXXX（2 次，至 yyyy-MM-dd HH:mm）`（北京时间）。退出码非 0 时看标准错误里的原因
   （学校 id 不存在或已停用、参数越界）。**这一行就是明文的唯一出处**：不要贴进工单、群聊或变更记录，只登记「已签发、几次、到期时间」。
3. 把邀请码**分别私下**交给两位首批学校管理员，请他们在注册页填写后注册（校区选本校）。
4. 按第 1 节第 2～3 步把两人登记为 `SCHOOL_ADMIN`（各执行一次）。之后的邀请码一律由学校管理员在后台「注册邀请码」签发、撤销，
   不再使用命令行；引导邀请码若还有剩余次数，请学校管理员在后台撤销。

没有开启邀请制时（`REGISTRATION_INVITE_REQUIRED` 未设置或为 false）跳过本节。

## 1. 配置首个工作人员

1. 请对方先用普通方式注册一个账号（与普通同学相同；开启邀请制时用第 0 节签发的引导邀请码），并告诉你**账号**（学号或手机号）。不要索取对方的密码。
2. 确认这个账号属于哪所学校（工作人员只能处理本人所在学校的案件）：

   ```sql
   SELECT u.id, u.account, u.nickname, c.school_id
   FROM users u JOIN campuses c ON c.id = u.campus
   WHERE u.account = :account;
   ```

3. 在事务里登记为工作人员（`school_id` 必须等于上一步查到的学校，否则数据库会拒绝）：

   ```sql
   BEGIN;
   INSERT INTO staff_members (user_id, school_id, role)
   SELECT u.id, c.school_id, 'SENIOR_MODERATOR'
   FROM users u JOIN campuses c ON c.id = u.campus
   WHERE u.account = :account;
   -- 确认只影响了 1 行，再提交
   COMMIT;
   ```

   - `MODERATOR`：处理举报与案件、隐藏 / 恢复商品、确认 / 驳回爽约、7 天以内的限制、申诉。
   - `SENIOR_MODERATOR`：在此之外可以强制归档圈子、施加 7～30 天的限制。

4. 请对方重新打开页面：导航栏出现「治理工作台」即配置成功。

**每所学校至少配置两名工作人员**（模块 7.1 起这是硬性需要）：利益回避由数据库函数判断，下列情况本人都不能查看细节、领取、结案或决定申诉，
这些案件与申诉也不会出现在本人的队列里：

- 以本人为目标的案件、本人的商品 / 评论 / 私信 / 圈子、本人参与的订单或爽约报告、本人提交的举报；
- 对本人做出的处理（限制、隐藏、隔离、确认爽约）提出的申诉，以及本人在原案件里做过处理的申诉；本人自己的申诉。

只有一名工作人员、而案件恰好与他有关时，案件**保持待处理**（不会被自动驳回），举报人与申诉人会看到「本校暂时没有可以回避利益冲突的工作人员」。
这时请按第 1 节再配置一名工作人员。自动限制（公开规则生成、没有工作人员）的申诉可以由本校任何无利益冲突的工作人员决定。

## 2. 调整或停用

工作人员记录不能删除（保留审计），只能调整角色或停用：

```sql
-- 调整角色
UPDATE staff_members SET role = 'MODERATOR', updated_at = clock_timestamp() WHERE user_id = :user_id;
-- 停用（立即失去权限；已经做出的处理与审计记录保留）
UPDATE staff_members SET active = false, updated_at = clock_timestamp() WHERE user_id = :user_id;
```

## 3. 不要做的事

- 不要直接修改 `moderation_actions`、`moderation_reports`、`order_cancellations`：它们只增不改，数据库会拒绝。
- 不要直接删除或延长 `user_restrictions`：限制只能撤销一次，其余字段不可改；自动限制只能由系统按纠正记录缩短或撤销（申诉推翻依据后自动重算）。
  需要纠正时，请在工作台里另立案件或处理申诉。
- 不要直接修改 `order_slot_agreements`、`user_restriction_basis`、`user_restriction_corrections`：它们只增不改，数据库会拒绝。
- 不要手工给旧订单补结束时间：没有明确档期的旧预约不能认定爽约，这是刻意的规则。
- 隐藏评论、隔离私信都不会删除原文；恢复请在工作台处理（或由申诉恢复），不要直接改 `comments` / `messages`。
- 不要把一个人登记到他不在的学校：数据库会拒绝。
- 平台治理不等于交易仲裁或赔付，也不对商品真伪下结论；工作台里没有、也不应该增加这类动作。
