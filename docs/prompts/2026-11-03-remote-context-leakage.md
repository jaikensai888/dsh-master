# 远程消息交付指令外露：排查结论与 Agent 执行 Prompt

## 已确认的原因

本报告基于用户截图、本地 master/node/coordinator 源码及相关测试，不包含对截图中 office1 节点的在线诊断。截图中的链接只是用户原始任务内容，本轮没有访问或执行该任务，也不复制其中 token。

1. `src/service.ts` 的 `MasterService.prompt()` 在附件处理后，无条件向 `body` 追加 `[remote-session-delivery]` 和截图中完全一致的英文，然后作为普通 `text` 发送。分析任务、普通聊天、queue 和 steer 都会经过该路径，没有文件能力判断。
2. `src/coordinator/client.ts` 直接将该字符串发到 `/api/session/prompt`。coordinator 的 `src/sessions.ts` 再把 text 包装为一个 text content part；在这一链路没有将用户正文与宿主指令区分。
3. `src/client/wire.ts` 依靠 `user/message` 的 `source.kind` 判断上下文来源；用户来源或无来源会整体渲染为用户正文。`SessionView.tsx` 的用户气泡显示完整 `row.text`。字符串内部附加的指令不会自动成为独立上下文。
4. `SessionView.tsx` 将 capability-unavailable、endpoint-not-found、capability-mismatch 等错误统一映射为 unsupported，再把 unsupported 转为 deliveryTool=unavailable。因此“节点版本较旧”和“交付工具未启用”可以来自同一次失败，不能当作两个独立诊断结果。
5. `docs/verification/2026-10-30-artifact-delivery.md` 记录了此前为解决普通文本请求缺少文件交付引导而引入的改动。`test/files-api.test.ts` 还明确要求文本里包含该标记；说明当前测试保护了拼接行为，没有验证用户正文与宿主上下文的边界。
6. node 的 `files/service.ts` 中 describe.deliveryTool 表示工具注册状态；`index.ts` 依赖 tools 服务注册成功后才置 available。它不能单独保证某个具体模型或会话最终能调用工具。

本地已执行：`pnpm exec vitest run test/files-api.test.ts test/remote-attachments.test.ts test/remote-artifacts.test.ts`，3 个文件、51 项测试通过。没有修改实现、没有部署、没有修改历史会话。Git 状态读取被仓库所有权检查阻止，未修改全局 safe.directory。

## 推荐解决顺序

| 优先级 | 工作 | 验收结果 |
| --- | --- | --- |
| P0 | 将用户正文与可信宿主上下文分开，查明真实宿主支持的接口 | 新消息用户正文保持原样，模型仍收到正确交付约定 |
| P0 | 保留能力错误原因，区分未知、协议不支持、工具未注册、临时故障 | 不再用统一“升级节点”代替诊断，普通文本分析不受文件能力失败影响 |
| P1 | 能力变化后的重试/重查，合并重复提示 | 重连或升级后状态可更新，同一问题只出现一个主要提示 |
| P1 | 历史消息兼容，仅在存在可信来源证据时处理已知注入 | 不篡改用户文本，不破坏旧会话回放 |

首选复用宿主已有的工具说明或上下文注入能力，在实际 Agent 构建模型上下文时提供交付约定，不再污染用户 prompt。若宿主不支持，提出基于实际协议的最小扩展及旧节点降级方案；不能凭空添加 system/developer 字段或伪造 source.kind。

不建议把正则隐藏标记当作根因修复。用户也可能主动讨论或粘贴这段文本，单靠内容无法可靠判断来源。历史原始事件保留；没有可信来源时保留原文或另行设计明确标注方式，不静默截断。

## 可直接交给其他 Agent 的 Prompt

```text
请修复 dsh-master 远程工作区的宿主交付指令混入用户正文，以及文件能力错误提示失真的问题。请实际修改代码、补充必要测试并完成验证。本任务不包含截图中 readvideo /jobs/56 任务的业务排查，不要访问截图中的 token URL。

工作区：G:\claude_project\code-agent\dsh-master
相关源码可只读参考同级 dsh-node、dsh-coordinator、deepseek-harness。跨仓库改动前检查各自 AGENTS.md、现有改动及修改范围，不覆盖其他人的工作。部署、重启真实远程节点、修改历史数据不在本次授权内。

先阅读 docs/prompts/2026-11-03-remote-context-leakage.md，核对以下链路：
- src/service.ts：MasterService.prompt()、attachmentPromptBlock()
- src/coordinator/client.ts：prompt()
- ../dsh-coordinator/src/sessions.ts：buildPromptRequest()、promptContent()
- src/client/wire.ts：injectedSource()、rowOf()
- src/client/SessionView.tsx：能力请求、错误映射、消息展示、ArtifactList 参数
- src/client/ArtifactCard.tsx、src/client/copy.ts
- ../dsh-node/src/files/service.ts、src/index.ts、src/files/deliver-tool.ts
- docs/verification/2026-10-30-artifact-delivery.md
- test/files-api.test.ts、remote-attachments.test.ts、remote-artifacts.test.ts 及相关 wire/会话测试

目标一：消息来源边界
1. 用户原始正文与宿主交付指令必须独立；普通聊天、URL 分析、文件任务均不能再把自动追加英文显示成用户输入。
2. 首先查明实际宿主支持的工具描述或模型上下文注入接口，优先复用；工具说明必须说明“写完文件后调用 deliver_file，工具成功后才可声称可下载”。仅展示文本路径、present 卡片或 diff 卡片不能代表交付成功。
3. 不得把整个用户消息改成 context 来隐藏正文，不得只在前端正则删掉标记，不得伪造来源，不得臆造宿主不支持的协议字段。
4. 如果必须扩展 node/coordinator 协议，先给出实际接口证据、最小改动清单、兼容策略与能力协商方式，再按已有授权完成可验证的实现；确需扩大修改范围时明确说明。
5. 新节点支持时使用正确上下文机制；旧节点无能力时安全降级，普通文本消息继续正常发送。文件能力检查失败不能阻断不含附件的普通任务。
6. 附件信息继续由服务端验证并解析 attachmentId；保留文件内容属于用户数据的边界，不能信任浏览器提交的远端路径。避免重复交付指令。

目标二：能力诊断和提示
1. 区分 loading/未知、协议不支持、工具明确未注册、网络故障、权限失败和协议不匹配；保留可诊断的原始错误码，但不显示凭据或 token。
2. 没有明确版本证据时，不要写“此节点版本较旧”。协议不可用不等于 deliver_file 明确未注册；无法确认时显示“无法确认文件能力”并提供适当重试。
3. 同一错误不要同时在交付区和输入框重复显示。用户不需要读取内部英文协议；详细错误可放在可展开的诊断信息中。
4. 检查当前能力仅在会话切换时请求的问题，按已有连接生命周期补足重连/重试后的能力更新，避免无意义轮询和跨会话状态串用。
5. 不承诺工具注册 available 就等于当前会话调用成功；下载仍以真实工具结果和 artifact 元数据为依据。

历史兼容：
不要改写或删除历史原始事件。只有存在可信来源元数据或可靠记录时，才将已知宿主注入以独立上下文展示。用户手动输入相同标记或英文必须完整保留。若历史数据已无法区分来源，明确说明这个限制，不能用宽泛正则猜测删除。

请先写能暴露问题的回归测试，再做最小修复。至少覆盖：
- 普通分析消息、文件生成消息、queue、steer，用户正文保持完整；
- 交付约定仍进入真实模型上下文，且不会重复；
- 附件解析与不信任浏览器路径的校验保持有效；
- 支持文件协议且工具可用、支持协议但工具未注册、旧节点缺协议、endpoint 缺失、协议不匹配、网络/权限错误、能力重试恢复；
- 同一问题无重复横幅；刷新及历史回放显示一致；
- 用户手动粘贴 [remote-session-delivery] 不被删除；
- 工具失败或没有 artifact 时不虚构下载入口。

替换 test/files-api.test.ts 中保护“无条件拼接交付说明”的旧断言，不要为了测试通过而维持错误行为。运行相关测试、pnpm typecheck、pnpm build；若跨仓库修改，运行对应仓库必要检查。

最终提供：根因与证据、修改文件、兼容策略、测试结果、尚未验证项。真实节点验收必须记录 office1 对应 nodeId/sessionId、实际能力响应、运行插件构建身份及相关事件（凭据脱敏）。没有访问真实节点就明确写“未完成真实节点验收”；本地构建通过不能证明运行实例已经加载。
```
