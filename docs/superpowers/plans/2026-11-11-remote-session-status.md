# 远程会话执行状态（running 圆点）补齐

> 状态：**已实施**（自动化验证通过，真机待复验）。日期：2026-11-11。

**目标：** 让“会话是否在执行中”在三处列表里表现一致，并让远程状态不再只靠手动刷新。

## 1. 事实与问题

| 事实 | 出处 |
| --- | --- |
| `session/list` 每项带 `running` 与 `agentAvailable`；`running = agents.get(id)?.status === 'running'`，即“此刻有 turn 在跑”；非活会话恒为 false | `@deepseek-ai/dsh-api-session-controller` 列表实现 |
| master 已把 `running` 透传到 `MasterSession`，远程树也会在 true 时显示 `StateDot` | `src/protocol.ts`、`src/coordinator/client.ts`、`src/workspace/RemoteSection.tsx` |
| `running` 是快照事实，不推送；master 不订阅 `session/control` | 同上 |
| 关注列表的 `FollowingRow` 根本没有 `running`，所以从不显示圆点 | `src/workspace/following.ts`、`FollowingList.tsx` |

结论：缺的不是渲染，而是①关注列表的字段与渲染；②远程列表的刷新时机。

## 2. 改动

| 文件 | 改动 |
| --- | --- |
| `src/workspace/following.ts` | `FollowingRow.running`；本地行取 `SessionSummary.running`（主机订阅，实时），远程行取 `MasterSession.running`；归档/离线/未找到一律 false |
| `src/workspace/FollowingList.tsx` | `running` 时渲染 `StateDot state="ongoing"`，外层 `role="img"` + `aria-label`/`title` = `status.running` |
| `src/workspace/RemoteSection.module.css` | 新增 `.followingRunning`（16px 容器） |
| `src/workspace/remote-model.ts` | 新增 `pollableNodeIds()`：只允许 `ready` 且已有列表快照的节点参与静默刷新 |
| `src/workspace/RemoteSection.tsx` | `loadSessions(nodeId, force, silent)`；可见时每 15 秒静默刷新当前可见节点；`visibilitychange` 回前台立即刷新一次 |

刷新范围：关注范围 = 关注目标节点；单节点范围 = 该节点；其余 = 已展开节点。静默刷新不切换加载态、不清除错误；与在途加载、新建、重命名互斥（通过 controller 与 inflight 守卫）。

## 3. 已知限制

- 没有订阅 `session/control`：其他客户端/其他操作者启动的 turn 最多滞后一个刷新周期（15 秒）。
- 页面不可见时停止刷新；回到前台立即刷新一次。
- 只表达“是否在跑”，不区分等待审批/等待回答/排队；那是另一组投影字段。
- 本地关注行实时，远程关注行与远程树共享同一份快照。

## 4. 验证

- `pnpm build`、`pnpm typecheck`、`node tools/build-styles.mjs --check` 通过。
- Vitest **46 文件 / 443 测试全部通过**（`DSH_RUNTIME_ROOT` 指向已安装 runtime）。
- 新增断言：本地/远程 `running` 透传与归档/离线清零、关注行圆点与 aria、`pollableNodeIds` 的 ready/已加载过滤。

真机待验：远程树与关注列表在 turn 开始/结束后 15 秒内出现/消失圆点；隐藏页面时无请求；回到页面立即刷新一次。
