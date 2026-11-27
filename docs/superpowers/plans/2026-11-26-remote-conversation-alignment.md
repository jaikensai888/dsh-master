# 远程会话内容对齐本地实施计划

> 执行时使用 `superpowers:executing-plans`，或在选定代理执行方式后使用 `superpowers:subagent-driven-development`。用复选框记录实施进度。

**目标**　让 dsh-master 远程会话正文的状态、过程、回复、工具和文件展示与当前本地会话一致，优先解决停止和失败回合的过程堆叠。

**架构**　以本地与远程的同会话对照作为呈现契约。现有远程 `session/follow` 和分页继续提供事件，`wire.ts` 负责分类和时序，`SessionView.tsx` 负责回合和消息呈现，文件区保留原有数据入口及远程动作。

**技术栈**　TypeScript、React、DSH 桌面运行时、Vitest。

**设计**　[远程会话内容对齐本地设计](../specs/2026-11-26-remote-conversation-alignment-design.md)

## 全局约束

- 使用实际运行的本地 DSH 窗口做对照，记录版本与远程插件实际加载的构建版本。历史调查用于定位代码和选样。
- 首期在 dsh-master 内实施。遇到缺字段时，先用真实快照核对事件来源及现有解析，再决定适配或兼容展示。
- 远程发送、停止、审批、提问和文件访问沿用既有入口。对照与测试优先复用现有记录和脱敏事件样本。

## 重点回归

- 真实插话在先前输出之后、后续回复之前，关闭回合后阅读顺序仍正确。
- 失败原因、部分回复、待审批或待回答入口保持可见，展开过程后同一消息和工具只出现一次。
- 从快照、实时事件和历史翻页得到同一完整回合时，状态与排序一致。缺失起始记录时保留可读内容。
- 工具失败与中断能区分，失败写入不会计入文件变更。远程交付文件的过期和权限反馈仍可用。
- 更新后查看的是当前桌面加载的插件，历史翻页和回到底部不会跳错位置。

## 任务 1　记录本地呈现契约

**入口**　`tools/replay-remote-session.mjs`、`docs/verification/2026-10-30-remote-turn-collapse.md`。将成对截图及用例矩阵放在 `docs/verification/2026-11-26-remote-conversation-alignment/`。

- [ ] 从同一个节点分别以本地和远程打开同一会话，记录 DSH 版本、实际插件构建及窗口尺寸。优先定位截图中的「研发」会话和「已停止」回合。若访问不到该会话，采用含部分回复、思考、命令和停止事件的脱敏样例，并记下替换原因。
- [ ] 对运行中、成功完成、停止、失败各记录一组对照。逐场景登记摘要文案、默认展开、部分回复及最终回复的位置、工具错误可见性、展开后顺序和文件区位置。另补一组真实插话和一组历史分页。能双侧显示的文件样例同时记录点击、预览或下载动作。
- [ ] 用 `node tools/replay-remote-session.mjs --node <nodeId> --session <sessionId> --base <当前分配的本机地址>` 获取对应快照的分组摘要。核对当前运行时公开的渲染入口，记录可复用接口。无公开正文挂载入口时沿用任务 2 的适配路径。

## 任务 2　对齐回合分组和折叠

**文件**　`src/client/wire.ts`、`src/client/SessionView.tsx`、`src/client/styles.ts`、`src/client/copy.ts`。测试放在 `test/turn-presentation.test.ts`、`test/turn-view.test.ts`、`test/wire.test.ts`。

**接口**　沿用 `conversationItems(rows, events)`、`TurnGroup` 和 `ConversationLog`。`process` 装可折叠的过程，`answer` 继续表示最后有效的完整回复，`visible` 装需直接显示的内容。依据任务 1 记录的本地行为区分部分回复、终止原因与过程详情。

- [x] 加入 `stopped` 和 `error` 用例。每个回合包含思考、两条命令及部分回复，断言过程归属和默认折叠符合任务 1 的本地记录，并断言部分回复仅出现一次、失败原文保留。运行 `pnpm test test/turn-presentation.test.ts test/turn-view.test.ts` 确认当前行为触发新增断言失败。
- [x] 在 `wire.ts` 修正终态行分类，在 `SessionView.tsx` 统一摘要和折叠容器。运行态持续显示进展，普通关闭回合恢复本地对应的默认展示。等候用户输入的内容继续可见。仅在事件不能可靠确定回合或步骤时保留逐条兼容展示。
- [x] 补齐真实插话、上下文注入、快照与实时合并、缺少起始事件的用例。验证重新组装后顺序正确、工具结果与调用只出现一次、缺失时间时不编造时长。运行 `pnpm test test/turn-presentation.test.ts test/turn-view.test.ts test/wire.test.ts`，再用任务 1 的停止回合重放。

## 任务 3　对齐高频工具和文件

**文件**　`src/client/tool-preview.ts`、`src/client/wire.ts`、`src/client/SessionView.tsx`、`src/client/FileChangeCard.tsx`、`src/client/ArtifactCard.tsx`、`src/client/styles.ts`。测试放在 `test/tool-preview.test.ts`、`test/turn-view.test.ts`、`test/file-changes.test.ts`、`test/remote-artifacts.test.ts`。

- [ ] 先根据本地对照补三组测试。成功和失败命令分别断言摘要、状态及展开输出。包含成功与失败编辑的回合只汇总实际应用的变更。交付文件区域断言本地对应的默认展开行为，同时覆盖可下载、已过期和权限不足的远程状态。
- [ ] 沿 `toolPreview()` 和现有工具行补齐命令与通用工具的标题、状态和展开层级。确认 `tool/result` 的 `message.isError`、`meta` 和现有摘要截断位置能支撑详情。摘要保持简短；展开详情使用事件中实际可用的输出；缺字段时使用通用工具详情。
- [ ] 复用 `TurnChangesCard` 与 `ArtifactList`，按本地对照统一各自的层级、标题及展开行为。用远程资源地址验证文件动作，不把远端路径当作客户机本地路径处理。
- [ ] 运行 `pnpm test test/tool-preview.test.ts test/turn-view.test.ts test/file-changes.test.ts test/remote-artifacts.test.ts`，通过后复查运行中、停止、失败三种场景的工具和文件显示。

## 任务 4　验收构建与真机

- [ ] 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`，记录构建结果。桌面验收前核对实际加载的 `lib/client.js` 对应当前构建。
- [ ] 用任务 1 的同一批回合复拍成对截图，逐项核对默认可见内容、展开后的顺序、文件区域和可用动作。验证历史翻页时滚动锚点稳定，离开底部时新消息不强制拉动，回到底部后继续跟随新内容。
- [ ] 核验旧节点缺数据的兼容表现，以及窄侧栏下长命令和长文件名的可读性。把截图、版本、自动化结果和未验证项写入验收记录。

## 执行记录（2026-11-26）

- **任务 1（基准，部分替代）**：已拿到同一会话（`bot 的研发`）的本地与远程对照截图：本地把停止回合收成「已停止 + 过程摘要（执行了命令，已读取文件，修改了文件等）+ 红色中断说明」，运行中的回合也只显示当前活动行与流式内容。本会话仍无法操作桌面 UI 做全场景复拍；其余场景继续用脱敏事件样例，替换原因即“无法访问该会话的停止/失败时刻”。
- **任务 2（完成）**：`wire.ts` 终态行分类改为：`unknown`/事件不完整时逐条可见；`completed` 只保留通知、失败工具行、待回答卡；`stopped`/`error` 额外保留**最后一条非空助手回复**（部分回复）；`running` 回合也折叠已完成步骤，只保留**当前步骤的流式回复**与**未完成的工具调用**，过程摘要按实际活动生成（如“已读取文件，执行了命令”）。`SessionView` 的折叠摘要使用该活动描述（`已停止 · …`、`已完成，用时 X 秒`），运行中也会显示折叠容器。展开后同一行只出现一次（测试断言所有 key 唯一）。新增用例：停止回合、失败回合、无回复停止回合、运行中回合（完成步骤折叠 + 流式回复与待执行命令可见）。
- **任务 3（未完成）**：工具与文件行为沿用现状（`toolPreview()` 已按调用参数生成摘要、失败工具行有警告图标与错误样式、`TurnChangesCard` 只汇总实际应用变更、`ArtifactList` 保留下载/过期/权限反馈）。与本地默认展开层级、标题措辞的对齐仍待真机对照。
- **任务 4（部分）**：`pnpm typecheck`、`pnpm test`（525 passed / 1 skipped）、`pnpm run build`、`node tools/build-styles.mjs --check` 全部通过。桌面加载校验、成对截图、翻页锚点与窄侧栏检查待重启后补。
- **改动状态**：未提交；`lib/` 已重建，本次只改客户端，刷新页面即可生效。
