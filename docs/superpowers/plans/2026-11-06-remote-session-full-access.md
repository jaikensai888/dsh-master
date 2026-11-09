# Remote Session Full Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划是待评审草案，本次不执行实现。

**Goal:** 在 dsh-master 切换当前远程会话的 Full Access，并允许已确认的活跃待审批调用继续。

**Architecture:** 远程宿主的权限预设服务与审批服务拥有实际状态；dsh-node 注册命名明确的 nodeSessionAccess Remote；dsh-master 通过现有 Coordinator invoke 提供会话级 UI。权限切换与现有审批结算分别执行并呈现部分成功。

**Tech Stack:** 现有 TypeScript、Cordis、Typert Gateway、React、Vitest、pnpm；不引入新依赖。

**Spec:** `docs/superpowers/specs/2026-11-06-remote-session-full-access-design.md`

## Global Constraints

- 仅作用于 nodeId + sessionId 指定会话，不改变其他会话及新会话默认值。
- Full Access 必须同时核实 sandbox danger-full-access 和 approval never；never 仍然拒绝额外审批，不是自动批准策略。
- set/decide 在 master 后端受 allowPrompt 和现有鉴权约束；节点仍校验会话与请求归属。
- 当前调用恢复必须结算原审批，不能用 prompt、日志重放或自动重试代替。
- get 每 5 秒刷新，远程回答者查看租约为 15 秒；操作结果以远程回读为准。
- 仅文档位于 dsh-master；实施时先读取另外两个仓库及其子目录 AGENTS.md，保留用户已有修改。不得因本计划自动提交、推送或发布。

## Review Focus

- 审批正在本地 UI 等待时远程批准：原调用继续，本地面板撤回且只写一次 decided。
- set 成功但 decide 响应丢失：不能误报全失败、自动回滚或再次执行工具。
- 确认后出现新审批：新 requestId 不在本次批量批准范围。
- 未知或自定义预设：显示真实选项，不根据名字错误赋予 Full Access 含义。
- 切换会话、节点重连或宿主重启：旧响应不污染当前状态，历史审批不被复活。

## 文件与责任

路径相对于各自仓库根目录。新宿主接口名称为本方案建议，实施时须同步正式类型、Remote descriptor 和契约测试，不使用 any 绕过宿主类型。

| 仓库 | 文件 | 责任 |
| --- | --- | --- |
| deepseek-harness | packages/interaction/permission-presets/src/index.ts | setForAgent 与本地命令共用实时预设写入 |
| deepseek-harness | packages/interaction/user-approval/src/index.ts、types.ts | 活跃请求、统一终态、外部决策、回答者撤回 |
| deepseek-harness | 对应 tests/approval.spec.ts、permission-presets.spec.ts；packages/client/ui-approval/src/client/index.ts（必要时） | 生命周期契约、本地面板回收 |
| dsh-node | 新 src/session-access.ts；src/index.ts、src/upstream.d.ts | Remote、能力枚举、租约与宿主接线 |
| dsh-node | 新 test/session-access.test.ts；test/integration.test.ts | 节点契约与真实 Gateway 调用 |
| dsh-master | src/protocol.ts、src/coordinator/client.ts、src/service.ts、src/http-api.ts | 命名明确的数据类型、调用与路由 |
| dsh-master | src/client/api.ts、copy.ts、SessionView.tsx；新 session-access.ts、RemotePermissionSelect.tsx、RemoteApprovalPanel.tsx | 状态、权限选择、原审批结算与部分成功 |
| dsh-master | 新 test/remote-access-api.test.ts、remote-access.test.ts；既有 http-api、coordinator-client、remote-composer 测试 | 跨层边界及界面验证 |

### Task 1：补宿主的实时权限写入和统一审批结算

**Interfaces:**
- `PermissionPresetService.setForAgent(agent: Agent, preset: string): void`；本地 /permission 调用同一方法。
- `ApprovalService.pending(session: Session): readonly PendingApproval[]`。
- `ApprovalService.decidePending(session: Session, requestId: ApprovalRequestId, outcome: 'allowed-once' | 'rejected'): ApprovalDecisionResult`。
- 审批事件增加服务生成的 requestId；内部提供 `waitForDecision(requestId, signal)` 给节点回答者等待统一决策。PendingApproval 包含 sessionId、requestId、toolName、可选 callId/reason；DecisionResult 包含 settled outcome 或 not-found/already-decided 状态。

- [ ] 在现有 approval.spec.ts 添加失败用例：本机回答者挂起时 external allowed-once 使原 request 返回；随后本机晚到回答不能覆盖终态；取消胜出后外部批准不能执行工具；asked/decided 各一次。
- [ ] 添加 never 仍直接 rejected、无回答者仍 unavailable、请求归属错误拒绝、同 id 重复相同决策幂等、相反决策冲突的用例。
- [ ] 在 permission-presets.spec.ts 添加 setForAgent 双旋钮写入、重复预设不重复追加、活跃 Agent 通知及会话隔离用例。
- [ ] 在 deepseek-harness 运行 `pnpm exec vitest run packages/interaction/user-approval/tests packages/interaction/permission-presets/tests`，确认新增用例先失败。
- [ ] 实现统一 pending 表和终态竞争，复用现有 audit append 路径；decision Promise 与回答者 signal 一同退出，finally 清理；setForAgent 复用 /permission 的实时路径。
- [ ] 重跑上述测试；若本机 UI 未响应撤回信号，更新 ui-approval 并添加面板撤回测试。验证服务销毁、Agent 取消不会遗留挂起调用。

### Task 2：节点 Remote 和审批等待接入

**Interfaces:**
- `nodeSessionAccess/get({sessionId}) -> AccessSnapshot`。
- `nodeSessionAccess/set({sessionId,preset,expectedRevision,operationId}) -> AccessSnapshot`。
- `nodeSessionAccess/decide({sessionId,requestId,outcome,operationId}) -> ApprovalDecisionResult`。
- AccessSnapshot 包含 `currentValue, options[{value,name,sandbox,approval}], revision, pendingApprovals, supportsResumePending`；revision 为覆盖有效预设和旋钮值的不透明字符串。

- [ ] 新建 test/session-access.test.ts：无会话、未知预设、custom 写入、错误 revision、错误 session/request、重复操作、能力缺失均有明确错误；不创建会话或发送 prompt。
- [ ] 添加租约测试：5 秒刷新维持查看；15 秒过期退出远程回答并交给 next；没有本地回答者则 unavailable；本地请求也能从统一 pending 表读到。
- [ ] 运行 `pnpm exec vitest run test/session-access.test.ts` 确认失败，再实现 src/session-access.ts 和生命周期接线。
- [ ] set/decide 复用宿主正式 lookup，限制标量/数组大小与标识长度；同一会话内按序比较 revision 和修改预设；operationId 幂等缓存按会话隔离、有界并在 dispose 清理。
- [ ] 更新正式描述符及 capabilities，缺宿主方法时不广告对应完整能力；新增 integration.test.ts 用例经真实 Gateway 调用三种操作，不仅 mock 方法。
- [ ] 在 dsh-node 运行 `pnpm exec vitest run test/session-access.test.ts test/integration.test.ts`、`pnpm typecheck`、`pnpm build`，预期通过。

### Task 3：master 的受控 API

**Interfaces:**
- 客户端 `fetchSessionAccess(nodeId,sessionId,signal?)`、`setSessionAccess(nodeId,sessionId,preset,expectedRevision,operationId,signal?)`、`decideSessionApproval(nodeId,sessionId,requestId,outcome,operationId,signal?)`。
- MasterService 与 CoordinatorClient 提供同名对应方法；仅 server 固定映射至三个 nodeSessionAccess endpoint。
- HTTP：GET `/api/session/access`；POST `/api/session/access/set` 与 `/api/session/access/decide`。

- [ ] 新增 remote-access-api.test.ts 及既有 http-api/coordinator-client 用例，验证参数、信号、响应解析、capability 缺失、conflict、allowPrompt=false、跨源拒绝和节点离线。
- [ ] 在 dsh-master 运行 `pnpm exec vitest run test/remote-access-api.test.ts test/http-api.test.ts test/coordinator-client.test.ts`，确认新增用例失败。
- [ ] 按 protocol → CoordinatorClient → MasterService → HTTP → browser API 的依赖顺序实现；get 不改变权限，set/decide 在后端各自检查写入开关。
- [ ] 重跑该组测试；明确请求不经 session/prompt，浏览器传入 endpoint 无法改变固定目标。

### Task 4：权限选择与当前任务恢复 UI

**Interfaces:**
- 新 session-access.ts 管理按 nodeId/sessionId 隔离的 snapshot、轮询、取消与 mutation 状态。
- RemotePermissionSelect 消费 snapshot/options，通过 onSelect(preset) 发起修改。
- RemoteApprovalPanel 消费统一 pending 列表，通过 onDecide(requestId,outcome) 和 onEnableFullAccess(requestIds) 处理当前任务。

- [ ] 新 remote-access.test.ts：当前权限显示、Full Access 确认、切回、set 失败不 approve、部分成功不伪装成功、确认中新出现的请求不被批准。
- [ ] 添加本机抢答后的过期请求刷新、另一客户端修改后的 revision conflict、同名 session 在不同节点隔离、旧响应丢弃、卸载停止轮询测试。
- [ ] 运行 `pnpm exec vitest run test/remote-access.test.ts test/remote-composer.test.ts` 确认新增用例失败，再实现三个组件/状态模块并替换 disabled 权限按钮。
- [ ] 严格执行 set → 权威状态确认 → 对确认列表逐项 decide → 回读；response 超时先查询，不以新 operationId 自动重放批准；局部错误可逐项处理。
- [ ] 对齐本地权限控件现有视觉和确认习惯；保留文字可读、键盘操作、loading 与错误反馈。重跑该组测试，再运行 master 的 `pnpm typecheck` 和 `pnpm build`。

### Task 5：跨进程验收和操作文档

**Files:** 新 `dsh-master/tools/e2e-session-access.mjs`，两端 README 中功能与兼容说明，按各仓库约定维护变更日志。

- [ ] 建立可复现的真实 DSH Host + node + Coordinator + master 场景；测试用 fake agent/tool 记录执行次数，避免依赖真实 LLM 生成特定调用。
- [ ] 验证在 workspace-write 下的工作区外受控写入先受限；切换并允许后原调用执行一次；切回后新调用恢复约束。
- [ ] 验证本地 UI 已持有审批时远程继续、多 master 抢答、set 后断网、决策响应丢失、节点重连、宿主重启后的权限恢复和 pending 不复活。
- [ ] 验证旧节点/旧宿主提示升级，不把节点 full-access 展示成会话 Full Access；验证普通问题及计划审核仍等待真实回答。
- [ ] 两插件各运行 `pnpm test`、`pnpm typecheck`、`pnpm build`；宿主运行 Task 1 相关测试、本机审批 UI 测试及受影响包的仓库规定类型检查。记录版本、命令、退出码及实际证据。
- [ ] 更新两端 README：含义、当前任务恢复、部分成功、allowPrompt、宿主升级依赖及首次升级的旧请求边界。部署是后续动作，按宿主 → node → master 验证，不自动发布。

## 自检与交接

- 目标覆盖：会话权限切换由 Tasks 1–4 覆盖；原审批继续由 Tasks 1、2、4、5 覆盖；兼容与持久化由 Tasks 2、5 覆盖。
- Review Focus 五项分别落在 Tasks 1、4、4、2/4、4/5；不是留待人工猜测的空白。
- 当前仓库 Git 状态只读检查遇到 unsafe repository，未更改 safe.directory 全局配置，未提交。实施者在开始修改产品代码前须解决其执行环境的仓库所有权检查并确认用户改动。
- 用户评审通过后再实现；建议同一执行者按以上依赖顺序完成，避免三仓库接口同时漂移。
