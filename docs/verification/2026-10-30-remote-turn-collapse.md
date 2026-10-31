# 远程会话「运行过程」折叠修复（2026-10-30）

范围：`dsh-master` 远程会话面板的呈现层（`src/client/wire.ts`、`SessionView.tsx`、`copy.ts`、`styles.ts`）。不改 node / coordinator，不改附件与产物链路。

## 结论

同一个会话在图 1（远程面板）里把整段思考与工具调用摊成正文，图 2（本地会话）却折叠成「已完成，用时 58 秒」。原因有两条，都不是样式细节：

| 编号 | 根因 | 证据 |
| --- | --- | --- |
| R1 | 正在运行的 GUI 加载的是 **14:17 构建的旧 `lib/client.js`**。该产物里没有 `turn-group`、`思考过程`、`已完成，用时`，即回合折叠能力只存在于源码，没有进入运行中的插件包 | `Select-String lib\client.js`：`turn-group` 0 次；源码 15:31 已实现 |
| R2 | DSH 自己注入的 `user/message`（`source.kind = time-context` / `agent-instructions`）被当作**真实用户输入**。它落在回合行的区间内，触发 `conversationItems` 的「本回合含追加消息」降级，整个回合改为逐条展开，于是过程不再折叠 | 会话 `session-354f5e6a`（查询识别日志是否存在）真实快照回放：修复前出现 `本回合含追加消息` 降级，2 个回合散成几十行 |

官方 DSH 的处理可对照 `docs/reviews/message-card-gap/2026-10-30/sources/dsh-client-ui-chat.js:7758`：非 `user` 来源的消息渲染为 `ContextInjectionRow`（「上下文注入 · 来源」），既不是用户气泡，也不打断回合。

## 改动

- `wire.ts`
  - `ConversationRow.kind` 新增 `context`；`user/message` 按 `source.kind` 分流：`user` 或缺省 = 真人输入，其余 = 注入上下文（标签取 `changes.path` / `name` / `references.label`，`time-context` 显示「时间上下文」）。
  - 回合归属与「追加消息」判定只看真实用户行，注入上下文不再拆分回合。
- `SessionView.tsx`
  - 新增 `context` 行：`上下文注入 · 来源`，默认收起，展开看注入原文。
  - 回合摘要：运行中默认展开过程，完成 / 失败 / 中断后按状态重挂载（完成即收起）；文案对齐本地为「已完成，用时 N 秒」。
- `copy.ts` / `styles.ts`：新增「上下文注入」文案与 `.dsh-master-context*` 样式。
- `tools/replay-remote-session.mjs`：只读回放工具，用真实 `session/follow` 快照打印面板的分组结果，供下次对比截图。

## 验证

真实会话 `session-354f5e6a`（node `my-desktop`）回放，修复后（`node tools/replay-remote-session.mjs --node … --session …`）：

```
records=374 rows=97 turnEvents=253 unrendered=129
kinds={"reasoning":33,"tool-call":56,"context":3,"assistant":3,"user":2}

#0 turn-group status=completed seconds=-   process=29 answer=1
#1 context    xingliu\AGENTS.md
#2 user       识别日志应该是以倒序的方式显示的，；
#3 context    时间上下文
#4 turn-group status=completed seconds=217 process=46 answer=1
#5 context    xingliu\AGENTS.md
#6 user       git commit
#7 turn-group status=completed seconds=59  process=14 answer=1
```

即图 1 那一段现在等价于图 2：一条「已完成，用时 59 秒」，展开才是 14 条思考 / 工具记录，答案单独显示在下面。`seconds=-` 的两个回合是快照窗口从回合中途开始，属预期（不得凭猜测编时间）。

- `pnpm typecheck`：通过。
- `pnpm test`：33 个文件 265 项通过，1 项跳过。新增覆盖：注入上下文不伪装用户消息（`test/wire.test.ts`）、注入消息不拆回合（`test/turn-presentation.test.ts`）、完成态默认收起且答案为「已完成，用时 58 秒」（`test/turn-view.test.ts`）。
- `pnpm build`：`lib/client.js` 已含 `dsh-master-context`（7 处）、`上下文注入`、`已完成，用时`。

## 未完成 / 边界

- 没有做「同一会话官方本地 / 远程成对真机截图」；本轮是真实快照回放 + 组件静态渲染 + 构建产物核对。
- 正在运行的桌面实例需要**刷新页面（Ctrl+R）**才会加载新 `lib/client.js`；若仍显示旧样子，完整重启桌面实例。
- 仍未覆盖的呈现差距（见 `docs/reviews/message-card-gap/2026-10-30/REPORT.md`）：终端 / read / diff / 搜索 / Todo / 目标专用卡片，工具 `meta` 与完整输入输出，审批应答通道，向上翻页，实时流式正文。这些是后续独立阶段，不在本次改动内。
