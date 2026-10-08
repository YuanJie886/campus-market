# 开源管理后台复用决策与接入

## 选择

2026-10-08 核对 GitHub 上游文档后，采用 [react-admin](https://github.com/marmelab/react-admin) 的 MIT 社区版，锁定 npm 发行版本 5.15.4。

比较过 [Ant Design Pro](https://github.com/ant-design/ant-design-pro)：同样采用 MIT，是完整的 React 后台模板，但当前上游使用 React 19 / Umi / Ant Design，与本项目 React 18 / Vite / Material UI 的组合不同。采用 react-admin 能直接复用其管理框架和现成 CRUD 页面，并通过 authProvider/dataProvider 连接已有后端。这是针对当前仓库的适配成本判断，不代表两个项目优劣的通用结论。

上游依据：

- [仓库与商业使用许可说明](https://github.com/marmelab/react-admin)
- [自定义认证适配](https://marmelab.com/react-admin/Authentication.html)
- [社区版访问控制](https://marmelab.com/react-admin/Permissions.html)
- [API 数据适配](https://marmelab.com/react-admin/DataProviderWriting.html)
- [付费 RBAC 扩展的边界](https://marmelab.com/react-admin/AuthRBAC.html)

本次使用社区版 canAccess，不依赖付费 ra-rbac。

## 复用结构

```text
现有商城 /admin/ → react-admin 管理界面
                    ├─ authProvider → 现有 /v1/auth/* + /v1/admin/me
                    ├─ dataProvider → /v1/admin/*
                    └─ 现成 Resource/List/Show/Edit 页面
现有 Spring Boot → AdminPermissions（数据库角色）
                  → AdminService（本校业务查询、授权与审计）
                  → StaffModerationService（原有治理动作）
现有 PostgreSQL → staff_members 扩展角色 + admin_staff_audit
```

现有系统已经有登录、会话吊销、同校数据隔离、工作人员与治理服务。此次增补集中管理入口和四种固定后台角色；保留原有身份体系和交易模型。

## 实施与验证

新增 `campus-market-admin` 可独立构建、单独升级上游依赖；API、数据库和同源入口与商城共用。数据库仅新增 V12，不修改已执行的历史迁移。现有工作人员维持原角色，首位管理员由运维受控授权。

- 单元测试：权限矩阵、未知角色拒绝、撤权后的重新校验。
- PostgreSQL HTTP 集成测试：未登录/普通用户拒绝、只读角色不能写新旧管理接口、自我授权拒绝、跨校访问拒绝、角色停用立即生效、审计不可篡改、分页/排序/搜索校验。
- 前端适配测试：请求字段白名单、队列参数转换、403 不刷新、并发 401 单次刷新。
- 保留并运行现有 ModerationIT 以检查治理行为兼容性。
- 实测：4 项后台权限单元测试、7 项 PostgreSQL 后台集成测试、10 项现有治理集成测试、8 项新后台适配测试、19 项原前端治理/路由测试通过。后台类型检查与生产构建通过，生产编排语法校验通过；最终锁定依赖的 npm audit 报告为 0。
- 修复默认 HashRouter 与 `/admin` 前缀不匹配造成的白屏，使用挂载在 `/admin` 的 BrowserRouter；开发入口 `/admin` 自动跳转。没有访问令牌时退出不再等待后端，避免服务不可用阻断登录页。
- 6 项真实 Chrome 回归通过（开发与生产构建各 3 项）：未登录访问与刷新、后端不可用、登录及资源导航。API 使用测试响应；另实测主站 `5173/admin` 代理入口、子页面登录返回与刷新正常。
- 未在现有业务数据库授予账号权限；未执行生产部署或真实账号的浏览器端业务验收。商城主工程已有的其他文件类型错误仍需独立解决。

可用角色、启动、首位管理员和部署步骤见 [管理后台 README](../campus-market-admin/README.md)。此阶段没有开放自定义角色编辑、全平台跨校超级管理员、计费、资金托管或身份核验；这些不由一个通用后台模板自动获得。
