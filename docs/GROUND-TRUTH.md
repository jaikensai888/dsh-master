# GROUND-TRUTH — dsh-master 的施工前事实基线与坑位清单

> 本文是 `dsh-master` 的**已核实事实**清单，目的是让新会话**不必重新调研**，也**不要重新踩坑**。
>
> 标注规则：
> - `[源码]` 从代码直接读出的；
> - `[文档]` 来自包内 README / 规格文档；
> - `[推断]` 由事实推得，未直接验证；
> - `[未证实]` 明确没有证据，不要在它上面做设计决策。
>
> 环境时间基准：2026-09-23。

---

## 0. 版本与取证前提

| 项 | 值 |
| --- | --- |
| 运行中的 DSH | `@deepseek-ai/dsh@0.1.5-rc.2` |
| 已安装包位置 | `E:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai`（243 个包目录） |
| `.d.ts` | **0 个**。各包 `package.json` 的 `files` 列了它，实际未随包发布 `[源码]` |
| 可读源码 | 只有打包后的 `lib/*.js`（保留 JSDoc）；`lib/types/**` 也是 `.js` 不是 `.d.ts` |
| 旧源码 checkout | `G:\claude_project\code-agent\deepseek-harness` 是 **0.1.2-rc.1**，比安装版旧，行号与行为一律以安装版为准 |

**因此**：写这个插件时不能依赖任何 `@deepseek-ai/*` 的类型导入。`dsh-node` 与 `dsh-drawio` 的做法是**结构化读取**（自己声明用到的接口切片），本项目沿用。

---

## 1. DSH 插件形态

| 事实 | 依据 |
| --- | --- |
| 没有独立的 `dsh-plugin.json` manifest | 全树 grep `dsh\.plugin\.json` = **0 命中**。它只存在于第三方仓库（如 `dsh-skillui`），**没有任何消费者** `[源码]` |
| 真正生效的 manifest 是 `package.json` 的 `dsh` 字段 | `dsh.bundle.patch` 指向插件自带的 `cordis.patch.yml`；`dsh.client` 声明前端半侧 `[文档]` |
| 插件目录（用户级） | `$DSH_HOME/profiles/<name>`，内含 `package.json` / `cordis.yml` / `cordis.patch.yml` / `node_modules` `[文档]` |
| 模块导出契约 | `export const name`（必须等于包名）、`export const inject`、`export function apply(ctx, config?)`；无 default export `[源码]` |
| **项目级插件目录** | **未找到** `[未证实]` |

### 1.1 client 插件

- 包里声明 `dsh.client = { platform: 'web', inject: [...], external: [...], immediately: false }`，并导出 `./client` 子路径。
- 产物 `lib/client.js` 是一个**经典脚本**，整体是一次调用：
  ```js
  window.__ModuleLoader__.load({ id: 'dsh-master', factory: (require) => { ... return module.exports; } });
  ```
  执行 bundle 只**注册 factory**，模块副作用（含组件代码）在物化时才运行 `[文档]`。
- 宿主半侧扫描已启用的 Loader 条目组成启动图，经 `/plugins` 提供 bundle；浏览器半侧惰性加载 `[文档]`。

### 1.2 平台模块表（client bundle 能 `require` 什么）

冻结的 seed 表，**多要一个就解析失败**：

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

`@deepseek-ai/dsh-client-ui-primitives` 里有 `MarkdownText` / `JsonTree` / `TerminalBlock` / `DiffBlock` / `Menu` / `Modal` / `Toast` / `StateDot` / 约 70 个图标 —— 这是自建会话视图时唯一可用的官方视觉层 `[源码]`。

---

## 2. 会话通信链路（`dsh-master` 的核心约束来源）

### 2.1 传输层：单例、单 host

| 事实 | 说明 |
| --- | --- |
| unary RPC | `POST /api/<endpoint>`，信封 `{type:'client-request', rpcId, method, payload}` `[源码]` |
| 所有 stream | **唯一一条** WebSocket `/api/remote.mux`，多路复用键是客户端自造的 `streamId`（`randomUUID()`），**不是 session id** `[源码]` |
| 认证 | 绑定 authority 的 HttpOnly 签名 cookie（默认 30 天）+ Host/Origin 信任围栏 `[源码]` |
| 第二个 host | **不存在**。`RemoteHostFacts` 只有 `{home, isLoopback}`，无 host 列表/id/路由维度；`remoteHost` / `federat` / `coordinator` 在 session-controller 内零匹配 `[源码]` |
| 单例保障 | 重复注册 generation source、重复启动 stream loop、`ClientRemoteService` 内单个 `RemoteStreamMuxClient`，三处都会抛错 `[源码]` |

### 2.2 session remote 面

`session/` 下共 **16 个** endpoint：`list, page, follow, control, prompt, cancel, updateQueue, create, fork, rename, search, attachment, modelCatalog, selectModel, openWorkspacePath, canOpenWorkspacePath`。**只有 `follow` 与 `control` 是 `mode: 'stream'`**，其余 unary `[源码]`。

关键类型（`dsh-api-session-controller/lib/typert.host.js`）：

```ts
type SessionAddress =
  | { kind: 'session'; sessionId: SessionId }
  | { kind: 'subagent'; parentSessionId; childSessionId; mode }

type SessionFollowFrame =
  | { type: 'snapshot'; header; cursor; records; hasMore; projections; assistantStream? }
  | { type: 'event'; event: SessionWireEvent }        // SessionEventEntry
  | { type: 'assistant-stream'; frame: SessionAssistantStreamFrame }

interface SessionWireEvent { type; seq; time; data; ignorable?; surfaceOp?; sourceEventSeqs? }

type SessionControlFrame =
  | { type: 'baseline'; value: { queues; jobs; projections } }   // 全 host，无参数
  | { type: 'queue' | 'jobs' | 'projection'; … }
```

`SessionEventMap` 有 **55 个**事件类型（`turn/*`、`step/*`、`user/message`、`assistant/message`、`tool/call`、`tool/result`、`approval/asked|decided|policy`、`command/run|done`、`compaction/*`、`subagent/*`、`team/*`、`goal/change`、`todo/write`、`session/title` …）`[源码]`。

`SessionId` 是**无格式约束的字符串**（`brandString`，线上按 `z.intersection(z.string(), z.unknown())` 校验）`[源码]`。

### 2.3 交互审批 / 提问走的是另一条通道

这两件事**不是**普通 remote：

| 能力 | host 侧机制 | 客户端机制 |
| --- | --- | --- |
| 工具授权 | `ctx.approval` 的 `approval/request` **waterfall 应答者**；没有应答者时请求以 `unavailable` **拒绝关闭** | forwarded Remote Event 的 `waterfall` 帧 |
| `ask_user_question` | `ctx.userQuestions.ask()` 派发**回答者 waterfall**；无 agent scope 的程序化请求交给本地未限定 scope 的 listener | 同上 |

forwarded Remote Event 的载体是同一 WS 上的一条**保留逻辑流** `$events`，下行帧 `ready | emit | waterfall | cancel`，**应答走 HTTP** `POST /api/$events/result`。它**不是**生成的 Typert remote 描述符（`$events/result` 被 RPC 拦截器无条件认领）`[源码]`。

`api-session/added|removed|status|activity|error` 这些会话生命周期通知也走这条 `$events` 流 `[源码]`。

### 2.4 前端没有「会话来源」这个维度

- 客户端会话状态是**单例服务**：`ClientSessions` 构造器里 `rootCtx.reflect.provide("sessions", this, void 0)` `[源码]`。
- 官方对话 UI 只从 `ctx.uiConversation.binding(sessionId)` 取装配源，而 binding 又来自这个单例 `[源码]`。
- Cordis 的 `provide` 在同一 scope 二次注册**直接抛错**；`ctx.set` 只允许原 fiber 改值；唯一的隔离手段 `ctx.isolate(name, label)` 是**换命名空间**，不是覆盖 `[源码]`。
- 官方 UI 插件由 loader 固定在 root，且 `slots.install()` / `installScope('session')` / `installLocale()` / `renderSlot` / `uiRenderer.mount` 全是 **boot-once / 单例**；同一个插件包在 boot roster 里也只能出现一次 `[源码]`。

**结论（本项目的立项依据）**：树外插件**不能**让远程 session 走官方对话页。要么 host 侧把远程会话投影成本地会话（整体替换 host 单例 `sessionQuery`，且 `ClientSessions` 的 transport 写死在构造参数上、没有公开方法可换），要么自建视图。本项目选后者。

---

## 3. slot 机制

### 3.1 语义

| kind | 同 cell 冲突 | 渲染规则 |
| --- | --- | --- |
| `single` | 整槽一个 cell，**同 priority 二次注册抛错** | **priority 最小者渲染**（高者留在账本里但不渲染） |
| `keyed` | cell = `key`，同上 | 同上 |
| `list` | cell = `id`，同上 | 按 `(priority, order)` **升序**，全部渲染 |
| `chain` | 无 shadowing | `select` 按 priority 升序，首个非 null 者中选 |

注册选项：`name`（必填）、`key`/`id`/`select`（按 kind 必填）、`order`、`priority`、`label`、`inject`、`children`、`store`、`locale`、`registrant`。**没有 `icon` 选项，也没有 `route`** —— 面板只有文字标签，寻址只有 `key`/`id` `[源码]`。

声明即认领：注册进未声明的 slot 会抛 `slot "X" is not declared`。跨插件必须用 `ctx.slots.inject(key, cb)`，它在目标 slot 的声明生命周期内运行回调，声明塌陷后重新注册。

### 3.2 与本项目相关的 slot

| slot | kind | scope | 声明者 | 用途 |
| --- | --- | --- | --- | --- |
| `root` | single | root | 内置 | **不要注册**：它是 single，后注册者 priority 更低会顶掉整个 AppFrame |
| `main` | keyed | root | `ui-layout` | 中央面板，按 `activePanelId` 派发；保留键 `conversation` |
| `sidebar` | single | root | `ui-layout` | 左侧外壳 |
| `sidebar.panellist` | list | root | `ui-sidebar` | 全局面板图标；**每个 id 对应同名的 `main` key** |
| `sidebar.workspaces` | single | root | `ui-sidebar` | 工作区/会话浏览区，官方占用者 `ui-workspace` |
| `sidebar.footer.action` | list | root | `ui-sidebar` | 侧栏底部动作行（`dsh-node` / `dsh-drawio` 用这个） |
| `shell.overlay` | list | root | `ui-layout` | 全局浮层，默认点击穿透 |

**完整 slot 目录（64 个 key）的唯一权威来源**：`dsh-cordis-client-runner/lib/client.js` 里的 `CLIENT_SLOT_API` 常量（约 2201–4601 行），每条带 `key / kind / scope / declaredBy / occupants / replaceRisk / example`。同文件的 `SERVICE_API` 列出客户端可注入服务，`EVENT_API` 列出 `connection/reset`、`locale/change`、`slots/changed`、`theme/change`。

### 3.3 路由

**没有 router。** 全树 grep `pushState` / `popstate` / `hashchange` / `useRouter` 等均无消费；`/session/<id>` 在服务端直接 404。当前 session 选择走 `localStorage` 的 `dsh.sessions.current`。`main` 的 `activePanelId` **不持久化、无 URL**，刷新回到 Conversation `[源码]`。

---

## 4. 上游：coordinator 与 node

### 4.1 拓扑

```
dsh-node（远程机器，DSH profile 里的插件）
   │  主动拨出 WebSocket（节点侧零入站端口）
   ▼
dsh-coordinator（独立 Node 服务，默认 127.0.0.1:39472）
   │  /api/*  HTTP + NDJSON
   ▼
dsh-master（本机 DSH 插件，operator token，管理面消费方）
```

### 4.2 node 协议

- 自定义协议 `dsh-node/1`，**不复用** DSH 自身的 RPC/session 协议；只有业务载荷沿用 Typert 形状：`{endpoint, payload:{args}}`，`endpoint = "<namespace>/<method>"` `[源码/文档]`。
- 真机能力面：**93 unary + 4 stream = 97**，20 个命名空间。4 条流是 `session/control`、`session/follow`、`workspace/follow`、`workspaceFiles/changes` `[文档，dsh-node GROUND-TRUTH §0.4]`。
- **树外插件可以注册自己的 namespace**：源码模式（`TypertRemoteService` + 公开的 `typertRemote` 绑定）会让节点把该 namespace 写进 `ready.capabilities`，coordinator 据此派发。`dsh-node` 的 `nodeAdmin/*` 13 个端点就是这么做的 `[源码/文档]`。

### 4.3 coordinator 的 HTTP API

`/api/*`，Bearer operator token。端点：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` `/api/stats` `/api/nodes` `/api/node` `/api/capabilities` | 健康与节点视图 |
| GET/POST | `/api/operator-token` `/api/enrollment` | 运营端配置（仅 localhost） |
| GET/POST | `/api/sessions` `/api/session/page` | `session/list` / `session/page` 包装 |
| POST | `/api/session/create` `/api/session/prompt` `/api/session/follow` | 会话操作；follow 是 NDJSON 长流 |
| POST | `/api/invoke` `/api/stream` `/api/streams/cancel` | 通用 unary / stream / 取消 |
| POST | `/api/nodes/add` `/api/nodes/rotate` `/api/nodes/revoke` `/api/nodes/restore` | 节点管理 |

要点：
- 节点业务错误以 **HTTP 200 + `{ok:false, error:{code,…}}`** 返回；只有 `coordinator/*` 才映射真实状态码 `[文档]`。
- `/api/session/follow` 的 data.value 就是节点发来的 `SessionFollowFrame` 原文，coordinator **不解释任何字段** `[文档]`。
- **审批 / 提问 / 会话生命周期通知都没有透传**，`session/control` 也没有专用包装（只能走通用 `/api/stream`）`[文档]`。

---

## 5. 坑位清单（施工前必读）

1. **`exports` 必须导出 `./package.json`。** 否则 `createRequire(baseUrl).resolve('<包名>/package.json')` 失败，包被**静默跳过** —— 宿主侧一切正常，浏览器里什么都没有，而且**没有任何日志**。`dsh-node` 丢过一次 UI。守卫：`test/manifest.test.ts`。
2. **client bundle 只能 `require` 平台表里的模块。** 多要一个就在物化时抛错，同样是静默的。守卫：`test/client-bundle.test.ts`。
3. **`dsh.client.inject` 是包名数组，只控制 bundle 到达顺序，不构成 apply 顺序。** 跨插件 slot 依赖必须用 `ctx.slots.inject(key, cb)`。
4. **不要注册 `root` slot。** 它是 single，且动态注册的条目 priority 更低，结果是把 AppFrame 整个顶掉，所有 seat 一起消失。
5. **`main` 的面板选择不持久化、无 URL。** 刷新回到对话页。要留住必须自己存 localStorage 并在 apply 时 `selectPanel` 回去。
6. **非 `conversation` 的 `main` key 拿不到 session binding**，只有 root 级 standard props（`useResource` / `useWorkspaces` / `usePanelInfo` / `useSessions` / `useSessionPendingInteraction`）。
7. **slot 没有 `icon` 选项**，只有 `label`（`string | (() => string)`，thunk 会跟随 locale 变化重读）。
8. **`ctx.slots.register` 必须以服务方法形式调用**，不要解构出来赋值给变量 —— Cordis 服务代理在调用时把 `this.ctx` 绑到调用者上下文，解构会冻结到服务自身，静默破坏按插件的卸载级联。
9. **`approval` 与 `user question` 在无头节点上会 fail closed。** 节点没有应答者时审批以 `unavailable` **拒绝**，不是挂起。补齐它需要节点侧插件注册应答者。
10. **不要在挂载时做网络请求。** 协调器是另一个进程，插件挂载不能依赖它在线；`/dsh-master/api/status` 才是报告不可达的地方。

---

## 6. 未证实 / 未验证

- `ctx.reflect.accessor` 是否存在、能否绕过 `provide` 的占用检查 —— **未证实**（即便存在也按同一 isolate key 取键）。
- host 侧 `sessionQuery` 替换方案能否让 `session/prompt` 对远程 id 生效 —— **未证实**。`ClientSessions` 的 transport 写死在构造参数上，`sessionController` 的远程由生成的 Typert 绑定提供，只认本地 session 注册表。这是本项目**没有**选那条路的直接原因，不是对它可行性的断言。
- ~~本项目的代码没有在运行中的 DSH 实例上验证过。~~ **2026-09-24 已在运行中的 desktop 实例上验证**（见 §7）。
- `dsh-master` 的 client 半侧已在真实浏览器里渲染过（用户确认「看到远程工作区及其节点树」）。当前面板只注册 `main[key=dsh-master]`；独立 `sidebar.panellist` 图标已按用户确认移除，远程会话点击仍可打开面板。

---

## 7. 真机验证记录（2026-09-24，desktop profile）

前提：`dsh-master` 以 `link:` 装进 `profiles/desktop`，pnpm 自动把它加进了 `dsh.profile.bundles`；profile 的 `cordis.patch.yml` 用 **id 定向覆盖**给配置（不是第二次 insert）。

| 检查 | 结果 |
| --- | --- |
| 配置合成 | `dsh --profile desktop --dump-config` 退出码 0，586 行，`- id: dsh-master` **恰好 1 次**，无 error 标记 |
| 客户端清单解析 | 从 profile 目录 `createRequire(...).resolve('dsh-master/package.json')` **成功**，`platform: web`、`dsh.bundle`、`./client` 导出齐全 —— 这就是「静默跳过」的那条路 |
| 客户端进入启动图 | `dsh-node/api/diagnostics` 的 59 个条目里含 `dsh-master` |
| `/dsh-master/api/status` | `{coordinator:{url,reachable:true}, nodeCount:3, promptEnabled:false}` |
| `/dsh-master/api/nodes` | 3 个节点；`my-desktop` **ready，能力面 97**（93 unary + 4 stream，与文档一致） |
| `/dsh-master/api/sessions` | 真实会话：标题、`cwd`、`running`、`blank` 均正确 |
| `/dsh-master/api/session/follow` | `200` + `application/x-ndjson`；`open` → snapshot **272 条记录**、`hasMore: true`、`header.cwd` 与 `projects.values.title` 正确 |
| prompt 闸门 | `403 master/prompt-disabled`（`allowPrompt: false`），且在读请求体之前拒绝 |
| 信任围栏 | 伪造 `Host: evil.example` → **403 `master/forbidden`**；`sec-fetch-site: cross-site` → 403；不匹配的 `Origin` → 403；正常请求 → 200；未知路由 → 404 |
| 浏览器渲染（当时构建） | 用户确认左侧曾出现「远程」入口，主区出现「远程工作区」与节点树；后续按确认设计移除独立入口 |

两点方法论记录，避免下次误判：

1. **用 Node 的 `fetch` 伪造 `Host` 测不出围栏** —— undici 把 `Host` 当禁止头丢掉，请求会带着真实 authority 发出去并合法通过。必须用 `curl -H "Host: ..."`。
2. **`%APPDATA%\DSH Desktop\logs\dsh-*.log` 不含插件日志**（2.0.13 只有 run 标记行），所以「日志里没有报错」不能作为证据；诊断要走插件自己的路由或浏览器 console。

---

## 8. 客户端视觉的取证结论（2026-09-24）

第一版面板的样式是**推断**出来的（`currentColor` + `color-mix`），因为当时没读主题 token，所以看起来不像原生。补齐后的依据：

| 事实 | 来源 |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-primitives` **在**冻结平台表里 | shell 自己的模块工厂：`dsh-web-frontend/dist/assets/index-*.js` 里 `"@deepseek-ai/dsh-client-ui-primitives":Zg` |
| 主题 token 前缀是 `--dsw-alias-*` / `--dsw-specific-*` / `--dsh-*` / `--dsl-*` | `dsh-web-frontend/dist/assets/index-*.css` |
| 列表行几何 | `ui-workspace`：`height:34px; border-radius:8px; padding:0 8px; gap:6px`，hover 与 selected 都是 `var(--dsw-alias-interactive-bg-hover)` |
| 用户气泡几何 | `ui-chat`：`background:var(--dsw-specific-bubble); border-radius:22px; padding:10px 16px` |
| `MarkdownText` 的 label 面很小 | `ui-chat` 的 `markdownLabels(t)` 只返回 `{ code:{copyLabel,copiedLabel}, footnotes }` |
| `StateDot` 的五态 | `done / warning / ongoing / error / idle`，且是 `aria-hidden`（名字由 owner 提供） |

`ui-primitives` **不随包发布 `.d.ts`**，所以本仓库自带 `src/client/primitives.d.ts` 声明用到的那一小片契约；它是对一个无法自校验的包的手写契约，改用时必须同步。

---

## 9. 工作区浏览器的二开（2026-09-24）

侧边栏那个工作区树不是内核画的，是官方插件 `@deepseek-ai/dsh-client-ui-workspace`（loader entry id **`ui-workspace`**）画的。要让它同时装下本地和远程两个区块，只能把它整个换掉。

### 9.1 为什么「遮蔽」不行，必须「取代」

三条实测事实决定了这件事：

1. `sidebar.workspaces` 是 **single** 槽 —— 一个格子一个占位者，同 priority 再注册直接抛错；不同 priority 时**数值最小者渲染**。
2. `renderSlot` 是**按 entry 绑定**的：`ui-renderer` 的 `boundRenderSlot` 里，`entry.children?.[key]` 为 undefined 就抛 `SlotOwnershipError`。
3. 唯一的服务级入口 `ctx.slots.renderSlot(key, owner)` **只接受 `'root'`**，其余一律抛错。

目录选择器（「添加工作区」）挂的正是 `sidebar.workspaces.directoryFlow`，而这个子槽是**官方那个 entry 声明**的。所以遮蔽者既不能重复声明（会抛「already declared」），也不能渲染它 —— 「添加工作区」会静默消失。

**结论**：禁用 `ui-workspace` 这个 entry，由 `dsh-master` 完整接管它的两处注册。官方这个包的**宿主半侧是空实现**（`lib/index.js` 453 字节，`function apply() {}`），所以禁用只损失它的两个客户端注册，而这两个我们都重新注册了。

### 9.2 源码从哪来

| | |
| --- | --- |
| 许可 | MIT，Copyright (c) 2026 DeepSeek —— fork 合法，保留声明即可 |
| 源码 | `deepseek-harness/packages/client/ui-workspace/src` @ **0.1.2-rc.1**（本地已有） |
| 运行版本 | **0.1.5-rc.2**，`@deepseek-ai/*` **不发布 `src/`，也不发布 `.d.ts`** |
| 导入方式 | `tools/import-fork.mjs`：按名单复制 + 三条机械重写，`--check` 可复现校验 |

重写的三条：相对说明符补 `.js` 后缀（NodeNext 要求）、`@deepseek-ai/dsh-util-workspace-path` 内联成 `workspace-path.ts`（**它不在冻结平台表里**，运行时永远解析不到）、CSS module 指向生成模块。

> 顺带一提：`@deepseek-ai/*` 里唯一**在**平台表、又真被用到的运行时依赖是 `@deepseek-ai/dsh-client-store`（`defineStore`）。`clsx` 不在表里，所以被**打进 bundle**。

### 9.3 要适配的只有数据形状

接口层不用改：0.1.2 源码用的 `slots / sessions / workspaces / locale / remote / remote.directoryPicker`，以及 `uiWorkspace.startSession / archiveSession`、`sessions.open / binding / fork / search / searchResultLimit / create / clear`、`workspaces.create / rename / delete / archiveSession / insertBefore / insertSessionBefore`，**0.1.5 里全都在**。

差异集中在 `SessionSummary`。**但结论和最初设想的相反**：0.1.5 的**客户端**（`dsh-api-session-controller/lib/client.js` 的 `projectList()`）已经把它拍平回 `id` / `displayTitle` / `completed` / `projectionValues` —— 也就是 fork 期望的那套 0.1.2 字段名，因为 0.1.5 官方浏览器读的也是这些名字。只有**线上**（host → browser 的 `session/list`）才用 `sessionId` + `projections.values`。

所以 `src/workspace/adapt.ts` 的规则是**双形状识别**：行的 `id` 与 `displayTitle` 都是字符串就判定为已投影，**原样透传、一个字段都不动**（连对象身份都保留）；只有线上形状才映射。用 `WeakMap` 按快照对象身份缓存 —— React 的 `useSyncExternalStore` 按引用比较，每次渲染新建对象是会死循环的。

> 第一版适配层假定拿到的是线上形状并无条件映射，结果**每一行的标题都变成空字符串、`updatedAt` 变成 0**：树结构正确，每行空白。`test/workspace-adapt.test.ts` 里那条「已投影的快照必须 `toBe` 原对象」就是这次的回归。

`completed`（0.1.2 的"没看着就跑完了"绿点）在**线上** summary 里没有对应物，**故意不做**：靠时间戳猜会得到一个亮起来就不会灭的点。

### 9.4 CSS module 编译：类名不能以数字开头

`tools/build-styles.mjs` 把 `.module.css` 编译成 `styles.generated.ts`：类名 `.foo` → `.<scope>_foo`，`@keyframes bar` → `@keyframes <scope>_bar` 并同步改写所有 `animation` 引用（不改写的话两张表的动画会在同一文档里撞名）。

**`<scope>` 必须字母开头，这是整个脚本唯一真正要命的地方。** 第一版直接把模块路径 hash 成 6 位十六进制，其中两个以数字开头 —— `.5c9b35_projectRow{…}` 是**非法选择器**，浏览器不会报错，只是把那条规则丢掉。于是三张表里两张全废，整个侧边栏渲染成**没有样式的 HTML**：数据正确、标题齐全，但按钮变回默认样式、输入框带边框、没有缩进和间距。看着像「样式表没加载」，实际是一个字符的问题。

现在前缀是 `dsh` + 5 位十六进制，并在生成时对每个类名与 keyframes 名做**标识符合法性断言**；`test/workspace-styles.test.ts` 再守一遍。

> 顺带一条教训：我当时的自检正则是「选择器后紧跟 `{`」，而第一条选择器后面跟的是 `,`，所以漏报。守卫要么用权威数据（类名映射表），要么就别用带位置的启发式。

### 9.5 类型 shim 的两个坑

`src/upstream.d.ts` 集中声明所有不发布类型的上游模块。两个坑记在这里：

1. **`declare module '@deepseek-ai/cordis'` 写在非模块 `.d.ts` 里是「环境模块声明」，会把真类型整个盖掉** —— `Context.effect / get / provide / inject` 全部消失，连宿主半侧的 `src/index.ts` 都编译不过。要加事件键必须放**带 `export {}` 的文件**里做模块增强（见 `src/events.d.ts`）。
2. `Menu` 之类的组件只能声明 shim 里用到的 props 再加索引签名，否则回调参数会变成隐式 `any`；`Service` 之类要能被 `class extends` 的桩**必须是 `function` 而不是箭头函数**（箭头函数不可构造），而且 `super()` 不能返回对象（否则子类自己的原型方法会丢）。后者是 `test/client-bundle.test.ts` 报出来的。

### 9.6 落地状态

- 工作区树：本地区块由官方 fork 接管；本地与远程区块平级、分别可折叠，本地搜索/添加保留；独立「远程」面板入口已移除。用户确认本地工作区可以正常运行。
- 自动验证：类型检查、bundle 构建、**14 个文件 / 108 项测试**、样式生成与 fork 导入检查均通过。
- 真机状态：远程节点组已有此前浏览器渲染证据；本次平级布局、本地折叠及入口移除尚未在当前桌面实例重新加载后截图确认。

### 9.7 插件自身的注入契约

宿主半侧 `inject` 为空；`webServer` 用 `ctx.inject` 软等待。客户端半侧硬注入为 `slots`、`layout`、`sessions`、`workspaces`、`locale`、`remote` 和 `remote.directoryPicker`：工作区 fork 在注册时同步读取这些服务，远程会话导航需要 `layout.selectPanel`，本地「添加工作区」流程需要 `remote.directoryPicker`。这些依赖已列在 `src/client/index.tsx` 的 `inject`，bundle 回归测试检查其声明与导航调用。

与官方 `ui-workspace` 一样，这是一组硬依赖；profile 必须加载 `dsh-master` 的 client inject 列出的官方模块。不要把依赖改成晚到的 `ctx.inject` 回调，否则 `sidebar.workspaces` 可能在 renderer 判定启动失败后才注册。
