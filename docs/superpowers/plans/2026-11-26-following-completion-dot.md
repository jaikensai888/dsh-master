# 「关注」会话完成蓝点实施计划

> 执行时使用 `superpowers:executing-plans`，或在选定代理执行方式后使用 `superpowers:subagent-driven-development`。复选框用于记录实施进度。

**目标**　在 dsh-master 左侧「关注」会话行显示「已完成，待查看」蓝点，查看相应结果后消除。

**架构**　本机复用宿主已有的未读状态。远程会话列表提供最近成功结果的事件序号，远程会话面板回传前台已经看到的成功序号，侧栏用两者计算未查看状态。

**技术栈**　TypeScript、React、CSS Modules、现有侧栏持久化 store、Vitest。

**设计**　[「关注」会话完成蓝点设计](../specs/2026-11-26-following-completion-dot-design.md)

## 全局约束

- 远程继续复用 `RemoteSection` 的共享会话缓存、请求取消和可见时 5 秒轮询。进入「关注」及手动刷新继续走现有核验逻辑。
- 每个节点的一次会话列表请求承载所有关注会话的摘要。列表轮询不读取各个会话的正文。
- 完成事实来自持久化 `turn/end` 且 `reason.kind === 'completed'`。远程比较同一会话内的事件 `seq`，避免节点时钟差异。
- 先完成本地交付，远端协议具备后再接入远程蓝点。支持期内旧节点可继续使用现有「关注」功能。

## 验收重点

- 单轮任务在两次远程轮询之间开始并成功结束，下一次有效摘要到达后仍能亮点。
- 点击后加载失败、只收到连接成功帧、后台接收完成事件时均保留提醒。
- 面板只看到轮次 A，而列表已更新到轮次 B 时，查看 A 不能清除 B 的蓝点。
- 刷新、断线重连、失败或取消均不会重复产生早已查看的提醒。
- 切换 Coordinator、取消后重新关注、快速切换会话时，迟到的回调不能确认其他来源或其他关注记录。

## 任务 1　本机信号和蓝点样式

**文件**　`src/workspace/rows/WorkspaceBrowser.tsx`、`src/workspace/following.ts`、`src/workspace/FollowingList.tsx`、`src/workspace/RemoteSection.module.css`、`src/workspace/styles.generated.ts`、`src/workspace/locales.ts`。测试放在 `test/workspace-following.test.ts`、`test/following-list.test.ts`。

- [x] 在模型测试中构造两个空闲本机会话，分别传入 `completionUnread: true` 和 `false`，断言模型对应输出 `completionUnread: true` 和 `false`。加入 `completed: true` 但 `completionUnread: false` 的用例，断言已读优先。归档和缺失行不显示提醒。
- [x] 在列表测试中断言未查看行提供「已完成，待查看」的可访问名称和对应样式。`running` 与 `completionUnread` 同时为真时只显示现有运行状态，已读行不渲染状态圆点。
- [x] 运行 `pnpm test test/workspace-following.test.ts test/following-list.test.ts`，确认新增断言失败。
- [x] `WorkspaceBrowser` 用现有 `useSessionPendingInteraction` 订阅补齐 `FollowingLocalSnapshot.pendingInteractions`。在 `FollowingRow` 增加 `completionUnread: boolean`。本机可打开行沿用普通会话列表的 `pendingInteractions.get(id)?.completionUnread ?? summary.completed === true`。远程在任务 3 接入前输出 `false`。
- [x] `FollowingRowItem` 在共用状态位置增加实心蓝点。选择现有主题蓝色 token，补齐中英文提示，并运行 `node tools/build-styles.mjs`。沿用宿主打开会话的确认机制，用实际加载成功和失败的场景核验其时机。如果宿主在发起导航时就清除状态，本机验收须补齐宿主的成功加载信号。
- [x] 重跑本任务测试，运行 `node tools/build-styles.mjs --check`，通过后提交这一任务。

## 任务 2　远程完成摘要协议

**生产端接口**　为 `session/list` 单项摘要提供 `projections.values.lastCompletedSeq: number | null`。非负安全整数表示同一会话最近一次成功 `turn/end` 的持久化事件序号。`null` 表示支持此字段且尚无成功轮次。缺失表示当前无可用摘要。

**消费端接口**　在 `src/protocol.ts` 的 `MasterSession` 增加 `readonly lastCompletedSeq?: number | null`。在 `src/coordinator/client.ts` 按上述契约解析，测试放在 `test/coordinator-client.test.ts` 和 `test/http-api.test.ts`。

- [x] 先定位已安装 runtime 的 session controller 投影注册点。相邻 `dsh-node` 通过 Gateway 暴露该接口，`dsh-coordinator/src/server.ts` 的 `listSessions` 转发其返回值。主仓库内已确认列表解析支持读取 `projections.values`。生产端是否允许通过 dsh-node 注册新投影仍需实测。若注册点由上游 session controller 所有，把摘要实现落在该组件，并用支持该契约的节点版本验收。
  **实测结论（2026-11-26）**：注册点是公开的 `ctx.sessionProjections`（`@deepseek-ai/dsh-session-projection` 的 `ProjectionDefinition`，`summary: true` 的投影会自动进入 `session/list` 的 `projections.values`），所以生产端可以由节点侧插件提供；但当前 dsh-node 源码没有任何 `sessionProjections` 注册，上游 0.2.x 也没有名为 `lastCompletedSeq` 的投影，因此**现役节点不会返回该字段**。远程蓝点要等 dsh-node 注册改投影并发布新节点版本后才能验收。
- [ ] 在生产端测试以 `turn/end(seq=12, completed)` 建立摘要，追加 `seq=15` 的失败或取消事件后仍为 `12`，节点重启后也仍为 `12`，追加成功 `seq=19` 后变为 `19`。新会话返回 `null`。从节点真实的 `session/list` 响应验证字段能穿过投影和 Gateway，避免只覆盖内部模型。
- [x] 在 master 契约测试断言列表行保留 `12` 和 `null`，跳过缺失、字符串、负数和非整数。通过现有 `/api/sessions` 响应测试验证多个会话共用节点列表请求。
- [ ] 先运行新测试确认失败，再补齐持久化投影和字段解析。投影从事件写入路径或持久化索引更新，首次恢复时从已有事实恢复，避免每次列表请求重扫会话记录。
- [ ] 运行生产端对应测试和 `pnpm test test/coordinator-client.test.ts test/http-api.test.ts`。以真实旧节点验证字段缺失时仍可列出和打开会话。生产端和 master 各自在其仓库提交。

## 任务 3　远程已读、前台确认与接线

**文件**　`src/workspace/following.ts`、`src/workspace/stores.ts`、`src/workspace/RemoteSection.tsx`、`src/workspace/rows/WorkspaceBrowser.tsx`、`src/client/selection.ts`、`src/client/RemotePanel.tsx`、`src/client/SessionView.tsx`。测试沿用 `test/workspace-following.test.ts`、`test/workspace-stores.test.ts`、`test/selection.test.ts`、`test/remote-panel.test.ts`。

**接口**　远程关注记录增加 `remoteReadThroughSeq?: number | null`。`undefined` 表示还未建立基线，`null` 表示基线时没有成功轮次。侧栏 store 提供 `advanceFollowReadThrough(key: string, followedAt: number, seq: number | null): void`。`seq` 为整数时只单调推进，为 `null` 时只初始化。发往侧栏的前台已读事实包含已核验的远程会话身份和已呈现的成功事件序号。

- [ ] 编写失败用例。首个有效快照为 `null` 后收到 `12` 应亮点，查看 `12` 后清除，列表再收到 `19` 应重新亮点。查看 `12` 的迟到回调不能清除 `19`，重复或较小的确认不回退。旧存储无字段时从首个有效摘要 `12` 初始化且不补亮。断线和旧节点缺失字段时保留存储，刷新页面后读取保留的基线。不同 Coordinator 下相同 `nodeId/sessionId` 隔离。取消并重新关注后，旧 `followedAt` 的回调无效。
- [ ] 增加面板用例。`open` 帧和错误帧均不提交已读，前台呈现 `completed` 序号 `12` 后提交 `12`。后台接收同一事件时暂缓提交，恢复前台且结果仍在当前面板才确认。切换会话后忽略旧流的回调。已呈现 A 但列表已报告 B 时只确认 A。
- [ ] 运行 `pnpm test test/workspace-following.test.ts test/workspace-stores.test.ts test/selection.test.ts test/remote-panel.test.ts`，确认新增断言失败。
- [ ] 沿用 `dsh.workspace.view.v5`，在现有 `readFollowRecords` 中兼容旧快照并验证新字段。远程可打开行仅在列表有有效数字、已建立基线且数字大于已读序号时设置 `completionUnread`，将 `null` 基线视作早于任何成功事件。首个有效摘要仅初始化，`undefined` 不写入。离线、核验中或数据缺失时保留已读游标。若添加关注时已经有新鲜摘要，在创建记录时直接初始化，避免丢失添加关注到下次轮询之间的短任务。无摘要时以首次有效列表为起点。
- [ ] 在 `SessionView` 复用会话流已有的 `TurnEvent.seq`、`type` 和 `reason`，从成功呈现的快照及实时事件取最大成功序号。在实际展示的远程面板和前台文档内确认该序号。若快照窗口不包含目标成功事件，保持提醒，并在用户加载包含该事件的结果后确认。回调绑定打开时已核验的 Coordinator 来源，核对当前面板、选择、关注记录及挂载的会话流。通过共享的远程选择边界转交确认，使从关注行、普通列表和搜索打开会话共用同一路径。面板流先于列表轮询时仍记录该序号，后续轮询不会补亮已看到的轮次。
- [ ] 重跑任务测试，核对快速切换及刷新页面用例均通过，再提交这一任务。

## 任务 4　整体核验

- [x] 运行 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `node tools/build-styles.mjs --check`。类型检查、测试、构建和生成样式检查均通过才完成自动化验收。
- [ ] 前台打开「关注」，分别在本机和支持摘要的新节点启动一轮回复，再切到其他会话。成功完成后原行亮蓝点。远程验证用短任务，等待下一次成功轮询后查验。
- [ ] 模拟打开失败，蓝点仍在。恢复后从侧栏和搜索分别成功打开，蓝点消失。刷新后不复亮。重新执行并成功，蓝点再次亮起。
- [ ] 在当前会话可见时完成一轮，确认无需离开再打开。切到后台完成一轮，回前台的实际显示决定是否已读。再检查停止、失败、离线恢复、旧节点、两种主题和窄侧栏。

## 执行记录（2026-11-26）

- **任务 1 完成**：本机蓝点走宿主 `completionUnread`（`pendingInteractions` 订阅）；显式已读优先于 `completed`，归档与缺失行不亮，运行中优先显示运行点；文案（中/英）与主题蓝点样式已加，`styles.generated.ts` 已再生且 `--check` 通过。
- **任务 2 消费端完成**：`MasterSession.lastCompletedSeq`（`number | null`），只接受非负安全整数与显式 `null`，字符串/负数/小数/缺失一律按“无摘要”处理；契约测试覆盖 12 / null / 各非法值。
- **任务 2 生产端阻塞**：注册点 `ctx.sessionProjections` 是公开 seam（`summary: true` 的投影会自动进入 `session/list` 的 `projections.values`），但 dsh-node 当前没有任何投影注册，上游 0.2.x 也没有 `lastCompletedSeq` 投影——**现役节点不会返回该字段**。因此任务 3（远程已读、前台确认与接线）及其验收尚未开始。
- **自动化**：`pnpm typecheck`、`pnpm test`（522 passed / 1 skipped）、`pnpm build`、`node tools/build-styles.mjs --check` 全部通过。
- **待办**：先在 dsh-node 注册 `lastCompletedSeq` 投影并发布节点版本，然后在 master 完成任务 3/4 与真机验收（含“打开失败不清蓝点”“后台完成回前台才确认”等场景）。
