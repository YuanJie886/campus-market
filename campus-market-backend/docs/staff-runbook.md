# 平台工作人员运维手册

`staff_members` 表在迁移后**默认为空**：系统没有任何默认管理员、默认账号或默认密码；
公开注册接口不接受任何角色字段（未知字段一律 400），也不能创建工作人员。
工作人员身份每次请求都从数据库读取，不写进 JWT，因此下面的每一步都立即生效。

> 本手册里的 SQL 只能由有数据库管理权限的运维人员在受控环境里执行（例如带审批的变更窗口），
> 不要写进应用代码、脚本仓库或 CI；执行记录请同时登记到团队的变更记录里。

> V12 起已接入复用 react-admin 的 `/admin/` 管理后台。首位 `SCHOOL_ADMIN` 仍由数据库运维受控配置，后续本校工作人员授权/停用可以在后台操作，并写入不可修改的审计。详见 [管理后台说明](../../campus-market-admin/README.md)。`AUDITOR` 只读且不能处理案件；原有两个审核角色和利益回避规则保持兼容。

## 1. 配置首个工作人员

1. 请对方先用普通方式注册一个账号（与普通同学相同），并告诉你**账号**（学号或手机号）。不要索取对方的密码。
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
