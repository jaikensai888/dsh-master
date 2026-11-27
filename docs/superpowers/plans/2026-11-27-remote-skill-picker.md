# dsh-master 远程 Skill 选择器实施计划

> 开发 Agent 从 `AGENTS.md`、设计说明和本计划开始，检查现有改动，再按任务实现和验收。可使用 `superpowers:executing-plans` 逐项执行。

**目标**　在远程会话输入框用 `/` 浏览、筛选并选择当前远端会话的 Skill。

**架构**　浏览器调用 dsh-master 的只读目录路由，服务端复用 Coordinator 通用调用访问目标节点的 `skills/list`。选择只补全输入草稿，发送继续走现有 `sendPrompt`。

**技术栈**　TypeScript、React、DSH Typert Remote、现有 HTTP envelope、Vitest。

**设计**　[dsh-master 远程 Skill 选择器设计](../specs/2026-11-27-remote-skill-picker-design.md)

## 全局约束

- 首版业务代码限定在 dsh-master。节点使用部署环境已开放的 DSH 会话目录能力。技能同步和安装单独规划。
- 浏览器只发送 `nodeId` 和 `sessionId`，由服务端固定调用 `skills/list`。沿用现有会话路由的访问控制与凭据处理。
- `allowPrompt` 继续控制远程发送。目录路由是只读操作，发送禁用时输入框无 Skill 选择入口。

## 重点验收

- 同节点不同项目或预设可得到不同目录。切换会话后，旧响应不能覆盖新列表。
- 选择条目只补全草稿。普通发送、排队、插话、附件、输入法和 Shift+Enter 继续生效。
- 空目录、旧节点缺能力、节点临时不可用分别反馈。失效时不阻塞普通消息，临时失败可以重试。
- `modelInvocable: false` 的用户可调用 Skill 仍在列表中。浏览器收到的只有目录字段。

## 任务 1　接通按会话查询的只读目录

**文件**　`src/protocol.ts`、`src/coordinator/client.ts`、`src/service.ts`、`src/http-api.ts`、`src/client/api.ts`。测试放在 `test/coordinator-client.test.ts`、`test/http-api.test.ts`、`test/client-api.test.ts`。

**接口**　在 `src/protocol.ts` 定义 `MasterSkillEntry`，字段为 `readonly name: string`、`readonly description: string`、`readonly whenToUse?: string`、`readonly modelInvocable: boolean`。`MasterSkillCatalog` 包含 `readonly skills: readonly MasterSkillEntry[]`。协调器客户端、服务及浏览器 API 提供 `fetchSkillCatalog(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<MasterSkillCatalog>`。浏览器路径为 `GET /dsh-master/api/session/skills?nodeId=…&sessionId=…`，可按项目惯例支持 HEAD。

- [x] 核对目标运行时的能力表或直接做一次有权限的只读调用。业务远端名固定 `skills/list`，参数固定 `{ request: { sessionId } }`。上游 `deepseek-harness/packages/client/connection/tests/fixture-commands.client.spec.ts` 的用例和 `packages/api/session-controller/src/skill-catalog.ts` 可交叉确认。实际部署不通时记录节点能力或错误码，继续用夹具实现和验证。
- [x] 增加测试，验证 Coordinator 请求体、两个会话分别使用自身 ID、`modelInvocable: false` 的条目保留、`{ skills: [] }` 是成功。缺 `skills` 数组或条目字段类型错误沿用 `master/coordinator-unreadable`。额外字段如 `content` 和 `path` 不透传。HTTP 验证缺少任一 ID 返回 400、方法不支持返回 405、上游能力缺失与其他错误保留可识别的错误码。浏览器测试验证 URL 编码和 abort signal。
- [x] 运行 `pnpm test test/coordinator-client.test.ts test/http-api.test.ts test/client-api.test.ts`，确认新增用例能发现功能缺口。
- [x] 复用 `#invokeNode()`、服务端现有会话路由校验和响应 envelope。校验名称符合上游 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` 并投影白名单字段，浏览器断开时中止对应查询。不向浏览器提供通用 Remote 调用入口。
- [x] 重跑本任务测试。本阶段可通过真实目录读取或模拟节点响应独立验证。

## 任务 2　增加远程输入框 Skill 选择交互

**文件**　`src/client/SessionView.tsx`、`src/client/copy.ts`、`src/client/styles.ts`。独立选择器组件或草稿辅助函数仅在能简化 `SessionView` 时新建。测试放在 `test/remote-composer.test.ts`，交互测试按现有运行时测试方式补齐。

- [x] 先覆盖草稿和键盘用例。`/` 列出目录；`/rev` 筛出 `review`；在 `/rev 检查改动` 的首个 token 内补全后得到 `/review 检查改动`；选中单独的 `/rev` 后得到 `/review `。`请看 /rev`、路径中的斜杠及普通正文不触发。选中、Esc、输入法选词均不发送。无匹配、空目录和旧节点缺能力保留手动输入能力。
- [x] 增加会话切换回归。A 会话打开列表后切换到 B，A 的延迟响应到达时不显示、不覆盖 B 的条目。重复输入同一个前缀时复用本次菜单的请求，过滤在浏览器完成；关闭后再次打开重新请求。网络失败不缓存成空列表，关闭重开可重试。
- [x] 在可以发送且普通远程输入框可用时，用首个以 `/` 开始的 token 触发菜单。支持前缀匹配、加载中、无匹配、空目录、暂时失败和能力缺失。使用可访问的候选列表，提供键盘高亮和状态提示。Esc 收起且保留草稿；点击候选或菜单激活时按 Enter 只做选择，焦点留在输入框。选择后退出菜单，等待用户再次确认发送。沿用输入框现有队列、插话和附件状态。
- [x] 以当前远程面板会话身份管理请求。会话或来源切换、菜单关闭和组件卸载时取消该次请求，处理已失效的返回。候选区沿用现有主题和布局，检查在窄会话窗口内可浏览。
- [x] 运行 `pnpm test test/remote-composer.test.ts test/client-api.test.ts`，并在真实输入框检查鼠标、键盘、Esc 和中文输入法。

## 任务 3　验收从选择到远端加载

- [x] 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`，记录结果。桌面验收时确认实际加载当前构建。
- [ ] 使用一个远端已安装、只输出固定文本的测试 Skill。在 dsh-master 中打开目标远程会话，输入 `/`，确认它出现在列表。鼠标或 Enter 选择时检查草稿且确认未发请求。发送后确认请求仍走现有 prompt 路由，并在同一远端会话事件中确认对应 `skill-invocation`。模型回复只能作为辅助证据。
- [ ] 用两个目录不同的会话验证目录隔离。分别模拟旧节点不支持、空目录、临时断网和发送禁用。确认正常消息、排队和插话仍可使用。运行环境不足时报告哪些是夹具验证、哪些是真节点验证，并列出待验证的环节。

## 执行记录（2026-11-27）

- **任务 1（完成）**：`MasterSkillEntry`/`MasterSkillCatalog` 加入 protocol；协调器新增 `fetchSkillCatalog()`，固定 `skills/list` + `{ request: { sessionId } }`；解析严格：缺 `skills` 数组、条目字段类型错误或名称不符合 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` 一律 `master/coordinator-unreadable`，只投影 name/description/whenToUse/modelInvocable（`path`/`content` 丢弃）；服务与 `GET /api/session/skills`（GET/HEAD）复用现有校验与 envelope；浏览器 API 负责 URL 编码与 abort。
- **任务 2（完成）**：新增纯函数 `skillTrigger`/`completeSkill`/`filterSkills`/`skillFailureKind` 与 `SkillMenu` 组件；`SessionView` 在首个 `/token` 打开菜单，前缀本地过滤、请求每次打开重新发起并在关闭/会话切换/卸载时 abort；菜单打开时 Up/Down 高亮、Enter 只选择、Esc 关闭保留草稿，IME 组字期间全部按键交给输入法；选择只改草稿，发送/排队/插话/附件逻辑未改；`allowPrompt: false` 时无入口。
- **任务 3（部分）**：`pnpm typecheck`、`pnpm test`（538 passed / 1 skipped）、`pnpm run build` 通过。宿主半新增了路由，**需重启 DSH Desktop 后**才能用真实节点验证目录与 `skill-invocation`；当前验收为夹具/单元级，未做真节点验证。
- **改动状态**：未提交。
