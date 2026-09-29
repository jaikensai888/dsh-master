# dsh-master 设计方案

> 事实依据见 [`GROUND-TRUTH.md`](./GROUND-TRUTH.md)。本文只写**决策与取舍**，不重复取证。

---

## 1. 定位

`dsh-master` 是一个 DSH 插件，把一台 `dsh-coordinator` 旗下的所有 `dsh-node` 及其会话带进本地 Web GUI，作为与「本地工作」并列的**远程工作区**。

它是**管理面消费方**：不监听端口、不持有节点凭据、不主动连节点。它用 **operator token** 调 coordinator 的 HTTP API，把结果镜像进本地界面。

**非目标**

- 不做第二个执行器：不在本地重放远程的命令，不缓存会话内容作为事实来源。
- 不做多 host 并存：DSH 前端没有多 host 维度（见 GROUND-TRUTH §2.1），这个目标在当前 DSH 上不可达，不装作可达。
- 不改 DSH 本体，也不打补丁替换官方客户端服务。

---

## 2. 架构

```
┌─ 本地 DSH 实例 ──────────────────────────────────────────────┐
│                                                              │
│  host half (src/index.ts, src/http-api.ts, src/service.ts)   │
│    ctx.dshMaster  ──►  CoordinatorClient ──► coordinator     │
│    ctx.webServer.register(/dsh-master, prefix)               │
│             ▲                                                │
│             │ 同源 fetch（信任围栏，不走浏览器 cookie）        │
│             ▼                                                │
│  client half (src/client/**)                                 │
│    sidebar.workspaces ──► 本地组 + 远程组（平级、可折叠）       │
│    main[key=dsh-master] ──► RemotePanel ──► SessionView      │
└──────────────────────────────────────────────────────────────┘
```

两侧只通过 `/dsh-master/api/*` 见面，契约集中在 `src/protocol.ts`。

---

## 3. 协议映射

| 界面能力 | 本项目实现 | 对应 coordinator / node |
| --- | --- | --- |
| 协调器是否在线 | `GET /dsh-master/api/status` | `GET /api/health` + `GET /api/nodes` |
| 节点列表与在线状态 | `GET /dsh-master/api/nodes` | `GET /api/nodes`（`ready` / `offline` / `revoked`） |
| 某节点的会话列表 | `GET /dsh-master/api/sessions?nodeId=` | `POST /api/sessions` → `session/list` |
| 打开一个会话（历史 + 实时） | `GET /dsh-master/api/session/follow?nodeId=&sessionId=`（NDJSON） | `POST /api/session/follow` → `session/follow` |
| 发消息 | `POST /dsh-master/api/session/prompt`（**默认关闭**） | `POST /api/session/prompt` → `session/prompt` |

**转发原则：`data.value` 原样透传，不做严格 schema 校验。** 节点上的 DSH 版本不一定是我们的版本；把版本偏差变成「会话一片空白」是最糟的失败模式。`src/client/wire.ts` 负责尽力解释，解释不了的事件**计数并显示**，不静默丢弃。

---

## 4. 左侧树：本地与远程工作区作为平级折叠组

用户确认的界面是：本地工作区在上、远程节点组在下。`sidebar.workspaces` 是 single slot，官方 `ui-workspace` 占位且不导出可复用组件，因此不能只在官方树中插一行。

**决策：由 `dsh-master` 替换官方客户端 entry，并使用其 MIT fork 保留本地浏览器；本地组在上、远程组在下，二者平级并分别折叠/展开。** 本地搜索和添加入口在折叠时仍保留，点搜索会展开本地组；本地列表与远程内容各自在自己的滚动区域内滚动。远程树独立取数，使用同一套 primitives、设计 token 和行尺寸。`tools/import-fork.mjs --check` 约束 fork 的机械 import 头部；本地折叠样式使用属性选择器，远程视图通过注入 renderer 接入。

远程会话不能交给官方对话页渲染，所以点击本地会话仍走本地会话页，点击远程会话则调用 `layout.selectPanel('dsh-master')` 并由 `RemotePanel` 打开。用户已确认移除独立的 `sidebar.panellist`「远程」入口。

---

## 5. 「体验和本地一样」能到什么程度

这是需求里最难的一条。分项说清楚边界，避免事后扯皮。

| 维度 | 现状 | 说明 |
| --- | --- | --- |
| 消息数据模型 | ✅ 完全一致 | 前端消费的本来就是同一套 `SessionFollowFrame` / `SessionEventMap` |
| 历史 + 实时 + 发消息 | ✅ 打通 | 走 coordinator 已有的转发面 |
| 列表 / 分组 / 搜索 / 拖拽 / fork / 归档 | ⚠️ 自建，功能更少 | 官方工作区浏览器不可复用 |
| 对话渲染 | ⚠️ 自建，覆盖主要事件；视觉已用官方原子组件与 `--dsw-*` token 对齐 | 官方对话组件不导出；`ui-primitives` 的 `MarkdownText` / `Button` / `StateDot` / `Pill` / 图标是唯一可复用的官方视觉层 |
| 工具卡片 / diff / 计划 / todo / 子代理视图 | ❌ 暂缺 | 目前只渲染文本、工具调用与结果、少量 notice；其余事件计数显示 |
| token 级流式增量 | ⚠️ 只显示「输出中」 | `assistant-stream` 的 `chunk` 是 provider 形状，**不猜**；等 durable `assistant/message` |
| `ask_user_question` 结构化提问 | ✅ 已支持 | `dsh-node` 暴露 session-scoped pending/answer/cancel；`dsh-master` 经现有 `/api/invoke` 轮询并提交原始结构化答案；需升级节点插件 |
| 工具授权审批 | ❌ 未实现 | 与提问交互不同；仍需单独设计节点应答与转发协议 |
| 会话生命周期通知（新建会话自动出现） | ❌ 不通 | `api-session/*` 走 `$events`，需要手动刷新 |
| 队列 / 插话 / 模型切换 | ⚠️ 只有 queue / steer | `session/control`、`session/selectModel` 尚未接入 |
| 向上翻页加载更早历史 | ❌ 暂缺 | snapshot 的 `hasMore` 已读到并展示提示，未实现分页 |

**结论**：会话数据面保持同构。`ask_user_question` 已通过 `dsh-node` 的 session-scoped 桥接完成结构化问答；工具授权审批仍是独立缺口，不能与提问混为一谈，后续需单独设计节点应答与转发协议。

---

## 6. 安全模型

| 面 | 措施 |
| --- | --- |
| 凭据 | operator token 只从配置读，**只**作为 `Authorization` 头发送；不进任何响应、日志或错误详情。`createMasterLogger` 在**出口**做递归脱敏，`test/log.test.ts` 覆盖 |
| 路由暴露 | `/dsh-master/api/*` 不在浏览器 cookie 之后（DSH 插件前缀就是这样），因此每个请求先过**信任围栏**：Host 必须回环或部署声明的 `trustedHosts`；带 `Origin` 必须同 hostname；`sec-fetch-site: cross-site` 一律拒绝 |
| 副作用 | 发 prompt 会在远程机器上真实跑一个 agent 回合（可改文件、执行工具），**默认关闭**，必须由部署方显式 `allowPrompt: true`。关闭时在读请求体**之前**拒绝 |
| 请求体 | 上限 256 KiB，超限 413 |
| 不做的 | 不建入站端口、不 spawn 进程、不写远程文件系统、不做多租户 |

---

## 7. 阶段划分

**P0（本次已落地）**
- host half：协调器客户端、`ctx.dshMaster`、`/dsh-master/api/*` 只读路由 + 受控 prompt、信任围栏、脱敏日志。
- client half：保留本地工作区浏览器，增加可折叠本地组并与远程组平级；远程会话联动至 `dsh-master` 面板、只读会话视图 + composer（默认禁用）。
- 工程：构建、类型检查、自动化测试、bundle 不变式守卫、工作区样式生成器校验。

**P1（下一步，按价值排序）**
1. 在当前桌面 UI 刷新后，确认新增远程组外观、节点展开、会话 overflow 与面板跳转；用户已确认本地工作区可运行，本次远程组尚待截图复验。
2. 面板选中态持久化（刷新后恢复上次的面板与会话）。
3. 会话视图补齐：向上翻页、工具卡片折叠、更完整的事件渲染。
4. 队列 / 插话 / 取消按钮（`session/cancel`、`session/updateQueue`，经通用 `/api/invoke`）。
5. 远程面板会话列表的搜索、按 `updatedAt` 排序与手动刷新。

**P2（需要显式决策）**
6. 工具授权审批：设计独立的节点应答与转发通道；不要复用 `ask_user_question` 的结构化问答接口。
7. 会话生命周期：常驻订阅，让远程新建会话自动出现。
8. 文件变更 / diff：`workspaceFiles/changes` 流。

---

## 8. 验收

已完成的验证：

- `tsc -p tsconfig.json --noEmit`：通过。
- `vitest run`：全量测试通过，覆盖 API / host 回归、远程节点排序与 blank/overflow 规则、跨面板 selection 顺序、本地折叠样式及 loader bundle 注册契约。
- `tsdown`：构建成功；`test/client-bundle.test.ts` 验证生成脚本只 `require` 冻结平台表内模块，并在桩模块系统里执行 `apply`。
- `node tools/build-styles.mjs --check` 与 `node tools/import-fork.mjs --check`：通过。

**尚未验证**：本次新增远程组在当前真实 DSH UI 的外观与交互；用户确认本地树当前可运行，新增部分仍需刷新后截图复验。
