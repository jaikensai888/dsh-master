# dsh-master 交接计划

> 这份文档写给**接手这个仓库的下一个 agent**。它假定你没有任何先前对话的上下文，只读仓库和本机环境。
>
> 事实依据（每条都有出处，施工前必读）：[`docs/GROUND-TRUTH.md`](docs/GROUND-TRUTH.md)
> 设计取舍与验收边界：[`docs/design.md`](docs/design.md)
> 面向使用者的说明：[`README.md`](README.md)

---

## 0. 一句话

`dsh-master` 是一个 DSH 插件：连上一台 `dsh-coordinator`，把它旗下的 `dsh-node` 及其会话，以「远程工作区」的形式做进**左侧边栏的工作区树**里，和本地工作区并列。

```
dsh-node（远程机器） ──拨出 WS──► dsh-coordinator ──/api──► dsh-master（本机插件）──► 本地 GUI
```

---

## 1. 当前状态（截至 2026-09-24）

### 已完成并验证

| 部分 | 状态 |
| --- | --- |
| 宿主半侧 | 协调器 HTTP 客户端、`ctx.dshMaster` 服务、`/dsh-master/api/*` 路由、信任围栏、脱敏日志 |
| 远程面板 | `main[key=dsh-master]` 只显示左侧选中的远程会话内容与 composer（默认禁用）；节点/会话浏览只保留在左侧工作区树 |
| 工作区接管 | 已 fork 官方 `ui-workspace` 并在 profile 里禁用官方 entry，由本插件完整取代 |
| 工作区树 | 本地与远程工作区为平级可折叠组；本地搜索/添加保留；各自滚动；远程组支持刷新、在线状态、会话、5 条 overflow 及面板联动 |
| 自动化验证 | `tsc --noEmit`、`tsdown` 通过；**114 项测试通过**（15 个文件）；构建产物 `lib/client.js` 196.98 kB，bundle 依赖与样式/导入 fork 检查通过 |

**真机已验证**：插件加载、`ui-workspace` 已从启动清单移除、本地工作区树渲染出**正确的工作区名与会话标题**、`/dsh-master/api/*` 全部路由在真实实例上返回真实数据（含 272 条记录的会话流）。

### 待确认 / 后续

| 项 | 说明 |
| --- | --- |
| **① 侧边栏截图复验** | 用户已确认本地工作区可以正常运行；本次新增远程组刚完成代码与自动化验证，仍需在当前 DSH 页面确认样式和交互。 |
| **② 远程工作区组真机验证** | 已实现，见 §3；尚未在当前桌面 UI 重新加载后确认节点、会话与面板联动。 |
| ③ 审批 / 提问交互 | 需要**节点侧伴生插件**，尚未决定是否纳入范围。见 §5。 |
| ④ 会话生命周期通知 | 远程新建会话不会自动出现在树里，需要手动刷新。 |

> §1 的状态是按「有真机证据才算已验证」的标准维护的。**不要**在没有肉眼确认的情况下把某项标成已验证。

---

## 2. 环境与操作手册

### 2.1 路径

| 什么 | 在哪 |
| --- | --- |
| 本仓库 | `G:\claude_project\code-agent\dsh-master` |
| DSH 安装（运行版本 **0.1.5-rc.2**） | `E:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\`（**无 `.d.ts`、无 `src/`**） |
| 可读的旧源码（**0.1.2-rc.1**） | `G:\claude_project\code-agent\deepseek-harness\packages\client\` |
| DSH profile | `C:\Users\jaike\.dsh\profiles\desktop` |
| 协调器仓库 | `G:\claude_project\code-agent\dsh-coordinator` |
| GUI | http://127.0.0.1:43120 |
| `dsh` CLI | `dsh`（已在本机 PATH 里） |

### 2.2 命令

```powershell
cd G:\claude_project\code-agent\dsh-master
pnpm install
pnpm build       # = tsc -p tsconfig.build.json && tsdown
pnpm test        # vitest，读 lib/client.js，所以必须先 build
pnpm typecheck
```

若 `pnpm run` 被 registry 策略拦住（本机出现过 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`），直接用本地 bin：

```powershell
& .\node_modules\.bin\tsc.cmd -p tsconfig.json --noEmit
& .\node_modules\.bin\tsdown.cmd
& .\node_modules\.bin\vitest.cmd run
```

两个代码生成器，改动对应源码后必须重跑（`--check` 只校验不写）：

```powershell
node tools/import-fork.mjs      # 重新导入上游 fork（文件已存在则跳过，不覆盖本地改动）
node tools/build-styles.mjs     # 重新编译 CSS module
```

### 2.3 真机验证怎么做

```powershell
# 1. 构建
pnpm build

# 2. 合成 profile 配置，退出码必须为 0
dsh --profile desktop --dump-config
#    检查：`- id: dsh-master` 恰好 1 次；`- id: ui-workspace` 后面跟着 `disabled: true`

# 3. 完全退出 DSH Desktop 再打开（不是刷新页面）
```

**为什么必须重启**：插件树在启动时组合。`dsh-node` 的实测记录证明 desktop profile 里 `patchReload: "live"` **实际不生效**（`docs/GROUND-TRUTH.md` 引用的 §11.2），profile 的 patch 层不会被热重放。

**只有客户端 bundle 变化时**（`lib/client.js`）不需要重启：客户端模块的 HMR 轮询会自动换，或刷新页面（Ctrl+R）。

### 2.4 协调器

远程节点要出现在界面里，协调器必须在跑：

```powershell
cd G:\claude_project\code-agent\dsh-coordinator
node lib/cli.js --port 39472        # 绑回环；不要用 start.cmd（它绑 0.0.0.0）
```

注意事项：

- 协调器**不随 DSH 重启存活**：如果它是从 DSH 的进程树里起的，DSH 一退出它就没了。
- 协调器的管理面当前 **`apiToken: unset`**，所以本插件配置里也没有 token（回环来源免鉴权）。**不要**把它绑到 `0.0.0.0`。
- 本机节点的持久化配置在 `C:\Users\jaike\.dsh\storages\dsh-node\config.json`，`coordinatorUrl` 已被改成 `ws://127.0.0.1:39472/node`（原值 `ws://192.168.0.57:39472/node`，备份在同目录 `config.json.bak-before-master-verify`）。**这个文件的优先级高于 profile patch。**

### 2.5 `ui-workspace` 在哪里被禁用（有两处，都有用）

| 位置 | 作用 |
| --- | --- |
| 本仓库 `cordis.patch.yml` | 插件**自带的** bundle patch。跟着插件走，装到哪个 profile 都生效。 |
| `profiles\desktop\cordis.patch.yml` | profile 层的 `- id: ui-workspace / disabled: true`，写明理由与回滚方式。 |

两处同时存在是冗余但无害的：patch 层按顺序应用，"禁用" 是幂等的。**改这里之前先确认另一处**，否则会出现「删了 profile 那条却发现还禁用着」的困惑。

真正必须遵守的是**结论**：`ui-workspace` 必须处于 disabled，理由见 §4 第 2 条。插件自身在检测到它仍启用时会降级为遮蔽模式（priority -1）而不是崩溃，但那时「添加工作区…」会不可用。

### 2.6 回滚

| 想回到什么 | 怎么做 |
| --- | --- |
| 官方工作区浏览器 | 把**两处** `ui-workspace` 的 `disabled: true` 都去掉，重启。本插件检测到后会降级为遮蔽模式，不会崩，但「添加工作区…」不可用。 |
| 完全不装本插件 | 恢复 `profiles\desktop\.backup-before-master-mount\` 里的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`，重启。 |

### 2.7 ⚠️ 这个仓库可能被并发编辑

交接时观察到：`cordis.patch.yml`、`test/manifest.test.ts`、`package.json`、`src/client/index.tsx` 的修改时间与单一编辑者的操作序列对不上，说明**不止一个 agent 在改这个仓库**。

动手前请：
1. `git status` + `git log` 看清楚当前工作区是谁改的；
2. 不要因为「这段代码我没写过」就回滚它 —— 先判断它是否自洽（跑 `pnpm test`）；
3. 改同一个文件前，先读一遍当前内容，不要按记忆改。

当前状态是自洽的：`tsc --noEmit` 退出码 0、`vitest run` **108 项全绿**、构建通过。

---

## 3. 远程工作区区块（主体功能与验证状态）

### 3.1 已确认的设计（B2）

用户明确选定：**同一个侧边栏区域里，本地工作区在上，远程工作区在下；两组平级且分别可折叠/展开**。

```
┌─ 左侧边栏 ───────────────────────────────────────┐
│  🐟  DeepSeek Harness                     ⧉       │
│  ＋  新会话                                        │
│  ▾ 工作区                              🔍   ＋    │  本地组（可折叠）
│   ▾ 📁 dsh-master                                 │
│        会话标题 · 3 分钟前                          │
│        展开其余                                     │
│   ▸ 📁 dsh-drawio                                 │
│  ▾ 🌐 远程工作区                          ⟳       │  远程组（与本地平级）
│    ▾ 🖥 my-desktop                            ●   │  ← 一级：节点（位置等同「工作区」）
│         会话标题 · 刚刚                             │  ← 二级：该节点下的会话
│         会话标题 · 昨天                             │
│         展开其余                                    │
│    ▸ 🖥 palel-desktop                    离线      │  离线节点：一行，展不开
│  ──────────────────────────────────────────────   │
│  ⬤  节点 已连接                                    │
│  ⚙  设置                                           │
└───────────────────────────────────────────────────┘
```

### 3.2 数据从哪来

宿主半侧的路由已经就绪（`src/http-api.ts`），客户端半侧已有取数封装（`src/client/api.ts`）：

| 需要什么 | 用哪个 |
| --- | --- |
| 节点列表与状态 | `fetchNodes()` → `GET /dsh-master/api/nodes` |
| 某节点的会话 | `fetchSessions(nodeId)` → `GET /dsh-master/api/sessions?nodeId=` |
| 协调器状态 | `fetchStatus()` |
| 打开会话的实时流 | `followSession(nodeId, sessionId, signal, onRecord)` |

节点状态取值：`connecting` / `authenticating` / `ready` / `closing` / `offline`，外加正交的 `revoked` 布尔。契约在 `src/protocol.ts`。

### 3.3 代码放哪

`src/workspace/RemoteSection.tsx` 由 fork 的 `WorkspaceBrowser` 渲染为本地组下方的同级区块。本地与远程组分别可折叠，状态持久化；本地搜索和添加入口保留。两组各自滚动，远程组标题不随大量本地工作区滚出首屏，节点/会话过多时只滚动远程组内容。远程渲染器通过 `src/workspace/contract/slots.ts` 注入，不向 fork 文件增加 import；本地组样式由 `src/workspace/LocalSection.module.css` 编译。

> ⚠️ `tools/import-fork.mjs` **遇到已存在的文件会跳过**；`--check` 仍需通过。fork 中的本地改动只在组件体内，不改机械重写的 import 头。
>
> 编辑时保持它在 fork 文件里的存在感：加一处明显的注释标明「本插件新增」，方便将来对齐上游。

### 3.4 行为规则（已与用户确认）

- **组**：本地与远程是平级组，分别可折叠；状态存浏览器本地。远程区头有刷新按钮；本地折叠时仍保留搜索和添加入口，点搜索会展开本地组。
- **可见性**：两组使用独立滚动区；远程组位于本地组下方，标题常驻可见；不能把远程组塞到本地列表滚动容器的末尾。
- **节点行**：图标 + 节点名 + 右侧状态点（在线/离线可辨）；不显示能力数等技术细节。
- **离线节点**：一行、置灰、点不开（协调器对离线节点直接返回 `node-offline`，读不到会话）。
- **不做自动轮询**：要更新点区头刷新。
- **节点排序**：在线的在前，其次按协调器返回顺序。
- **会话行**：标题 + 相对时间 + 运行中圆点。**拿不到**「等待审批/等待回答」的琥珀色点（那条通道 coordinator 没透传，见 §5）。
- **空白会话**（建了没发过消息）**隐藏**，和官方侧栏一致。
- **默认显示 5 条**，其余折在「展开其余」后面 —— 和官方工作区一致。常量参考 fork 里的 `COLLAPSED_SESSION_LIMIT`。
- **协调器不可达**：组行下面一行灰字说明，节点列表**清空**（陈旧数据比空更糟）。
- **折叠成 56px 轨道**：显示各节点的图标。
- **点远程会话**：右侧切到本插件的面板并打开该会话。

### 3.5 树与面板之间的联动

`RemotePanel`（`src/client/RemotePanel.tsx`）与左侧树共用**极小的可订阅选中状态**（`src/client/selection.ts`，模块级 store + `useSyncExternalStore` 友好的 `getSnapshot` / `subscribe`）。不要为此新造一个 cordis 服务。

点击远程会话时先调用 `layout.selectPanel('dsh-master')`，再把 `{nodeId, sessionId, nodeName, sessionTitle}` 写进 store；`layout` 是 client bundle 的显式注入依赖。

点击本地会话时先调用 `layout.selectPanel('conversation')`，再打开本地 session；否则远程面板仍是 active main panel，本地 session store 虽然更新，用户看到的内容却不会切换。此时同时清除远程选择，避免侧栏保留过期高亮。

`dsh-master` 主面板不再重复渲染节点/会话树、协调器状态或刷新入口；左侧工作区树是唯一的远程浏览入口。选中状态同时携带节点名和会话标题，供主面板显示标题。主面板只读取协调器状态来决定 composer 是否允许发送，不再重复请求节点及会话列表。

> **必须接受的取舍**：官方对话页渲染不了远程会话（见 GROUND-TRUTH §2.4），所以**点本地会话走官方页面、点远程会话走本插件面板**——同一个侧边栏里两种去向。用户已知悉并接受。

### 3.6 面板职责

用户已确认移除 `sidebar.panellist` 上独立的「远程」入口。当前不再注册该图标；`main[key=dsh-master]` 面板保留，由点击左侧远程会话时打开，只显示选中会话的对话内容与发送设置。重复的面板内远程工作区树已移除。

---

## 4. 施工时必须知道的坑（都踩过）

前 10 条在 [`docs/GROUND-TRUTH.md`](docs/GROUND-TRUTH.md) §5，另外这批是本轮新增的：

1. **侧边栏那个区域只能有一个占用者。** `sidebar.workspaces` 是 `single` 槽；同 priority 二次注册**直接抛错**，不同 priority 时数值最小者渲染。
2. **子槽只能由声明它的那个 entry 渲染。** `ui-renderer` 的 `renderSlot` 是**按 entry 绑定**的，不在自己 `children` 里的键抛 `SlotOwnershipError`；而唯一非 entry 的入口 `ctx.slots.renderSlot(key, owner)` **只接受 `'root'`**。这就是为什么必须**禁用官方 `ui-workspace`** 而不是遮蔽它 —— 否则「添加工作区…」用的 `sidebar.workspaces.directoryFlow` 拿不到。
3. **CSS 类名不能以数字开头。** `.5c9b35_projectRow{…}` 是非法选择器，浏览器**不报错，只是丢掉那条规则**。表现为「整个侧边栏没有样式」。生成器现在保证字母开头（`dsh` + 5 位十六进制）并在生成时断言；`test/workspace-styles.test.ts` 再守一遍。
4. **`declare module '@deepseek-ai/cordis'` 写在非模块 `.d.ts` 里是「环境模块声明」，会把真类型整个盖掉** —— `Context.effect / get / provide / inject` 全部消失，连宿主半侧都编译不过。要加事件键必须放**带 `export {}` 的文件**里（见 `src/events.d.ts`）。
5. **数据形状要先看客户端投影，不要假定是线上形状。** 线上 `session/list` 用 `sessionId` + `projections.values`；而客户端 `projectList()` **已经拍平回** `id` / `displayTitle` / `completed` / `projectionValues`。适配层（`src/workspace/adapt.ts`）是双形状识别，已投影的行**原样透传**。
6. **client bundle 只能 `require` shell 冻结的平台表里的模块**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。多要一个就是**静默失败**（宿主正常、浏览器里什么都没有、无日志）。`clsx` 不在表里，因此被打进 bundle。
7. **`package.json` 的 `exports` 必须导出 `"./package.json"`**，否则宿主定位不到插件清单、整包被静默跳过。
8. **`class extends` 用的测试桩必须是 `function` 而不是箭头函数**（箭头函数不可构造），且 `super()` 不能返回对象（否则子类自己的原型方法会丢）。这是 `test/client-bundle.test.ts` 报出来的。
9. **`bundle` 里的 `apply` 守卫要按产物实际读取的属性名构造桩。** 手写导出清单不管用：bundle 经 CJS interop **复制自有可枚举属性**，只答 `get` 的 Proxy 会让 `Service` 变成 `undefined`。
10. **改完客户端 bundle 先刷新页面**（HMR 可能已自动换）；只有改宿主半侧或 profile 才需要重启桌面。
11. **不要用 Node 的 `fetch` 伪造 `Host` 头测信任围栏** —— undici 把 `Host` 当禁止头丢掉。用 `curl -H "Host: ..."`。
12. **`%APPDATA%\DSH Desktop\logs\dsh-*.log` 不含插件日志**（只有 run 标记行），「日志里没报错」不能当证据。诊断走插件自己的路由；浏览器渲染期的问题只能看 console。
13. **远程树跳转需要 `layout.selectPanel`**：服务 `layout` 必须是客户端硬 `inject`；不要在 apply 之后软等待，否则点击路径会在 renderer 运行期缺服务。
14. **远程组不能嵌在本地列表的滚动容器末尾**：本地工作区较多时整个远程区会被推到首屏之外，看起来像功能没有实现。把它作为本地滚动区的同级停靠区，并限制组内内容高度、独立滚动。

---

## 5. 已知能力缺口（不要承诺做不到的事）

| 缺口 | 原因 | 补齐需要什么 |
| --- | --- | --- |
| 工具授权审批 / `ask_user_question` | 走的是 forwarded Remote Event（`$events` 保留流），coordinator **没有透传这条通道**；且无头节点上**没有应答者，审批按 `unavailable` 直接拒绝**，不是挂起 | **节点侧伴生插件**：注册 `approval/request` 应答者与本地 userQuestions listener；再用一条常驻 `/api/stream` 做反向通道 |
| 会话生命周期通知 | `api-session/added\|removed\|status\|activity\|error` 同样走 `$events`，没透传 | 常驻订阅 + 手动刷新 |
| 远程会话的「等待审批」标记 | 那是客户端对 forwarded event 的本地投影 | 同第 1 条 |
| token 级流式增量 | `assistant-stream` 的 `chunk` 是 provider 形状，**不猜** | 显示「输出中」，等 durable `assistant/message` |
| 队列 / 模型切换 / diff | `session/control`、`session/selectModel`、`workspaceFiles/changes` 未接入 | 后续阶段 |
| 向上翻页加载更早历史 | `hasMore` 已读到并展示提示 | 实现 `session/page` 分页 |

---

## 6. 完成标准

一份改动算完成，需要同时满足：

1. `pnpm build` 通过；`tsc --noEmit` 退出码 0。
2. `pnpm test` 全绿，且**新行为有对应断言**（尤其是会静默失败的那类：槽位注册、bundle 可解析的模块、CSS 标识符合法性、适配层的形状识别）。
3. `dsh --profile desktop --dump-config` 退出码 0，`- id: dsh-master` 恰好 1 次。
4. 真机确认（重启或刷新后肉眼可见），并把结果写进 `docs/GROUND-TRUTH.md` 的落地状态。
5. 改动涉及新事实/新坑时，同步更新 `docs/GROUND-TRUTH.md`；改动涉及取舍时更新 `docs/design.md`。

**不要**在没有真机确认的情况下把某项标成「已验证」。本文档 §1 的表就是按这个标准维护的。
