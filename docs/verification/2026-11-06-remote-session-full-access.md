# 远程会话权限开发记录

计划：`docs/superpowers/plans/2026-11-06-remote-session-full-access.md`。用户于 2026-11-06 明确批准开始开发。本次不提交、不推送、不发布、不重启真实 profile。

- 基线：master 存在大量既有修改，涉及 SessionView、api、copy、protocol、service、http-api、coordinator client，保留并叠加本次修改。node 基线干净；harness 有无关未跟踪目录 bt-dsh-integration/。
- Ruling：沿用现有 checkout，未创建 worktree；Git 状态通过 host escalation 只读检查，未更改全局 safe.directory。.superpowers 下记录目录因权限无法创建，因此开发记录保存在本文件。
- 接口检查：Task 1 宿主权限与审批服务 → Task 2 nodeSessionAccess → Task 3 固定 master API → Task 4 会话 UI，统一会话身份与终态。
- Task 1：先观察新增 pending/decide 和 setForAgent 测试失败，再实现。宿主相关 5 个测试文件 76 项通过；两个正式 TypeScript 工程构建通过。
- Task 2：节点接口测试先失败，再实现。初次接口测试及既有真实 Gateway/WS 集成共 54 项通过；新增只读租约回归先失败，修复中验证。
- Task 3：新增接口及写入开关测试先失败，再实现。master 相关 6 个测试文件共 74 项通过；正式类型检查通过。
- Task 4：控制器用例先失败，再实现；覆盖先切换后批准、确认列表、切换失败、部分成功、卸载和禁用写入。已接入同一 Menu/RiskConfirmation 原语，确认弹窗不依赖普通 composer 可见。
- Ruling：get 增加可选 interactive 布尔参数。master 由后端 allowPrompt 决定是否维持交互租约；只读页面不能持续拦截本机审批。节点默认只读。
- Ruling：节点回答者等待宿主提供的撤回 signal，不新增公共 waitForDecision 方法；请求与终态仍由宿主单独拥有，租约到期交给 next()。
- Ruling：审批的 never/已取消分支在登记 pending 之前同步结算，禁止出现可被远程抢答的瞬时窗口。

源码验证已完成。dsh-node 完整回归 636 项通过，正式构建及临时目录安装包冒烟通过。dsh-master 完整回归 362 项通过、1 项跳过，审阅后修复了错误提示恢复问题，4 项权限控制器测试和最终 TypeScript 检查通过。宿主权限和审批相关 76 项、本机审批 UI 15 项通过。

`node tools/e2e-session-access.mjs` 在回环环境通过。用例经真实 master HTTP、Coordinator、节点 WebSocket 和 Gateway 调用真实宿主权限、审批与文件沙箱服务，验证当前调用仅执行一次、切回后恢复工作区限制、其他会话隔离及权限日志重放。测试使用可控工具调用，线上 GUI 与远程安装版本仍待验收。
