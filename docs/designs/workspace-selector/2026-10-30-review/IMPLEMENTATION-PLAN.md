# 工作区标题三角选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本会话采用直接执行最合适；用户若要求分工再改用 subagent-driven-development。

**Goal:** 将多节点并列侧栏收敛为“工作区 ▾”选择本地或一个远程节点，保持原有搜索交互和当前会话。

**Architecture:** 浏览范围与实际会话选择分别管理。WorkspaceBrowser 保留标题、本地列表和原有搜索；RemoteSection 继续持有远程 roster、缓存和请求，按浏览范围只渲染一个节点，并把共享 roster 的选择器通过 React portal 放进标题后的挂载点，避免创建第二份远程请求状态。

**Tech Stack:** 现有 TypeScript / React 18 / Cordis store / 宿主 primitives / CSS modules / Vitest，不新增依赖。

**Spec:** `docs/designs/workspace-selector/2026-10-30-review/REVIEW.md`；最新布局 `compact-selector-comparison.jpg`；可交互参考 `prototype.html`。

## 状态与范围

用户在最新小三角方案后要求“继续”，本轮继续到实施计划；尚未执行产品代码修改。不提交、不发布、不重启 DSH。计划位置遵从本会话独有目录约束。

检索语义采用最小变更：**沿用现有本地 / 远程合并搜索**。原型使用静态范围内过滤只是演示，不能照搬为正式搜索范围变更；本计划以现有 `searchSessions()`、SearchResults 和结果归属显示为准，不新增全局搜索服务。

## Global Constraints

- 保留其他会话的未提交改动。实施前重新核对 Git 状态；不覆盖附件、产物、SessionView 或其他会话的文件。
- 仅实现 A：节点选择；B 仅历史对照，不实现具体目录选择器。
- “工作区”文字后紧跟小三角按钮，无常驻节点卡片、不额外占一行。
- 搜索默认收起，点击放大镜原位展开；× / Escape 清除并恢复标题、三角和操作按钮。
- 切换浏览节点不调用会话导航、不卸载当前远程会话面板，不清草稿、不取消附件上传、不停止任务。
- 工作区归属取登记的 sessionIds，保留空目录、未分组及已有归档过滤，不按 cwd 猜分组。
- 本地与远程 my-desktop 即便同机也不合并；显示名不充当 ID。
- 不改 coordinator / node API，不新增远程新建工作区或会话能力。
- 原有面板恢复持久化问题不在本次范围；不得为做归属提示修改 SessionView。

## Review Focus

1. 持久化的节点暂时未加载：不能在 roster pending / 断网时误回退本地，清掉用户选择。（Task 1、2）
2. A → B → A 快速切换、请求乱序：不能把 B 的数据显示在 A 下，不能显示多份列表。（Task 2）
3. 离线 / 已撤销 / 长名称 / 重名：文字状态与 ID 区分，菜单可搜索滚动，错误不是空目录。（Task 2、3）
4. 当前会话位于其他节点：范围切换不能触发导航或附件清理；显式定位必须让会话行可见。（Task 4）
5. 搜索结果来自非当前节点：继续展示原结果并标明归属，点击才导航且同步浏览范围；本地功能不退化。（Task 3、4）

## 文件边界

| 文件 | 职责 |
| --- | --- |
| `src/workspace/stores.ts` | 新增浏览范围；兼容已有 v5 排序 / 展开字段 |
| `src/workspace/contract/slots.ts` | RemoteSection 的范围、回调及标题挂载点 props |
| `src/workspace/WorkspaceNodeChooser.tsx`（新） | 无请求的节点菜单和标题三角按钮，使用宿主 primitives |
| `src/workspace/RemoteSection.tsx` / `.module.css` | 现有 roster / 缓存所有者，选择器 portal 与单节点内容 |
| `src/workspace/rows/WorkspaceBrowser.tsx` | 标题挂载点、本地列表显隐、搜索兼容、侧栏归属提示 |
| `src/workspace/LocalSection.module.css` / `locales.ts` | 紧凑布局及中英文文案 |
| `src/workspace/styles.generated.ts` | 仅按仓库既有生成方式同步新增样式，不改生成格式 |
| `test/workspace-stores.test.ts`、`test/remote-section.test.ts`、`test/workspace-current.test.ts`、`test/workspace-styles.test.ts` | 在现有 fixture / mocks 上补有行为意义的验证 |
| `test/workspace-node-chooser.test.ts`（新） | 选择器与筛选纯规则、可访问性及事件验证 |

### Task 1：区分浏览范围与会话选择

**Interfaces:** 在 `stores.ts` 导出 `WorkspaceBrowseScope = { kind: 'local' } | { kind: 'remote'; nodeId: string }`。新增状态 `browseScope`，默认 `{ kind: 'local' }`；新增 action `setBrowseScope(draft, scope: WorkspaceBrowseScope): void`。会话 selection 保持现有接口。

- [ ] 在 workspace-stores 测试添加：旧 v5 快照缺字段时补本地默认值；已有排序、折叠字段逐项保持；本地与远程身份互不冲突；setBrowseScope 只改浏览范围。
- [ ] 运行 `pnpm exec vitest run test/workspace-stores.test.ts`，确认新增测试因缺状态 / action 失败。
- [ ] 最小修改 store，在已有迁移位置补 `browseScope`。不因远端列表 pending 就改写范围；成功取得权威 roster 后才能认定节点已移除。
- [ ] 同命令通过后，记录证据；不提交。

### Task 2：复用远程数据源，选择后只显示一个节点

**Interfaces:** 扩展 `RemoteSectionProps`：`browseScope: WorkspaceBrowseScope`、`onBrowseScopeChange(scope: WorkspaceBrowseScope): void`、`chooserMount: HTMLElement | null`。保持既有远程会话打开回调不变。新增 `WorkspaceNodeChooser` 消费 `nodes: readonly MasterNode[]`、范围和切换回调、roster loading / error，不自行 fetch。

- [ ] 在 remote-section 与新增 chooser 测试覆盖：本地范围不显示远程内容但保留 roster 所有者；远程范围只出现一个节点；切换范围不调用 onOpenRemoteSession；pending / coordinator 断网不清选择；成功 roster 确认已移除才回退并提示。
- [ ] 加入可控 Promise 夹具模拟 A → B → A 和刷新乱序，断言最终内容只属于 A；离线仍可查看状态，revoked 禁止在线操作；最后成功快照必须标明过期。
- [ ] 运行 `pnpm exec vitest run test/remote-section.test.ts test/workspace-node-chooser.test.ts` 验证新增用例先失败。
- [ ] 保留现有 AbortController / 请求版本防护、按 nodeId 缓存和展开状态；选中在线节点触发按需加载，避免因只渲染选中节点丢弃缓存。顶层 RemoteSection 不随浏览切换卸载。
- [ ] 使用宿主菜单与现有在线排序规则实现 chooser；菜单中有本地、节点显示名、ID、文字状态、✓ 选中标记，支持名称 / ID 搜索。通过 `createPortal` 挂到标题 mount；无 mount 时不输出额外卡片或占位行。
- [ ] 同命令通过；记录证据，不提交。

### Task 3：接入“工作区 ▾”标题与原搜索

**Interfaces:** WorkspaceBrowser 用 DOM ref 提供 `chooserMount`；向现有 renderRemoteSection 传 Task 2 props。选择器切换仅派发 Task 1 action。标题和搜索继续使用现有 searchExpanded、query、searchSessions 状态。

- [ ] 添加验证：三角位于工作区标题后；无节点卡片行；搜索默认无输入框，点击聚焦，× / Escape 恢复三角和工具；搜索仍调用原 searchSessions 且结果不受 browseScope 过滤。
- [ ] 覆盖长名称不会撑宽侧栏、菜单有滚动上限与键盘关闭 / 选择、收窄侧栏不再为每个节点堆一个图标。窄栏使用一个选择入口，点后展开侧栏并打开同一菜单。
- [ ] 沿用测试现有宿主 mocks；运行 `pnpm exec vitest run test/workspace-node-chooser.test.ts test/workspace-styles.test.ts test/remote-section.test.ts`，确认新增断言先失败。
- [ ] 接入 mount 和范围；非搜索时只展示本地列表或一个远程节点的目录列表。搜索时由原 SearchResults 占用这一个列表区域，不在下方额外重复显示远程目录。
- [ ] 保留本地添加、视图选项和现有可用管理动作。三角 tooltip 显示当前浏览节点；菜单中的“当前会话”标记与 ✓ 浏览范围分开。搜索展开时隐藏标题和三角，关闭后恢复。
- [ ] 使用既有 primitives / token / 图标与样式生成方法，更新 locales；运行同命令并确认通过，不提交。

### Task 4：状态保留和会话导航兼容

**Interfaces:** 延用现有 open / openRemoteSession，不修改服务签名。列表浏览 UI 的临时状态按本地 / nodeId 记忆，目录展开和排序继续使用现有 store。显式“定位当前会话”在侧栏实现，不修改右侧 SessionView。

- [ ] 添加行为断言：切节点不调用 layout.selectPanel、会话 retain / release 或 setRemoteSelection；远程面板实例身份和上传 signal 不因 browseScope 变化而改变。
- [ ] 添加恢复用例：A 的滚动、展开和 overflow，切 B 后再切 A 恢复；原有搜索维持全局 query，避免暗中变成按节点查询。
- [ ] 添加搜索结果导航用例：点击其他节点结果才打开该会话，同时同步 browseScope；点击本地结果同步本地范围。测试来源重名而 ID 不同的节点。
- [ ] 添加定位用例：当前会话被折叠 / overflow / 搜索遮住时，显式定位清除遮挡条件，展开并滚到该行；仅浏览切换不能自动定位或换会话。
- [ ] 运行 `pnpm exec vitest run test/workspace-current.test.ts test/remote-panel.test.ts test/remote-section.test.ts`，确认新增行为先失败；最小接线后通过。
- [ ] 若宿主无法从现有侧栏接口可靠读取当前本地会话归属，实施者记录证据并回报，不伪造归属、不扩展到 SessionView；不阻断正常菜单选择与会话打开。

### Task 5：构建检查与真实界面验收

- [ ] 依次运行 `pnpm typecheck`、`pnpm build`、`pnpm test`。测试读取 bundle，不能省略先构建。若 styles 需要生成，先从既有脚本确认正确入口。
- [ ] 在隔离预览 / 测试宿主使用本地 + 至少三个远程节点 fixture，对照 compact-selector-comparison.jpg 验收；不重启当前 DSH，不从该预览发送真实模型 prompt。
- [ ] 人工验证标题小三角、菜单搜索 / 状态 / 长名称、单列表、空目录 / 未分组、原搜索、本地添加、窄栏、列表状态恢复。保存实际组件截图到本设计目录的新验收子目录，并标明模拟数据。
- [ ] 在测试宿主保留当前会话和有内容草稿，切浏览节点，确认右侧实例、草稿、发送目标不变；用模拟上传确认 signal 不被取消。此检查不能用“单元测试全绿”替代。
- [ ] 交付改动清单、验证结果和限制。真实当前宿主验收、提交、发布、重启另待用户授权；本计划不包含这些动作。

## 自查与执行方式

已核对：标题布局、节点 / 目录身份、原搜索、数据竞争、离线状态、旧缓存迁移、本地管理、窄栏、草稿和上传边界均有对应任务。无 server API 或协议变更。

建议由当前会话直接执行：任务共用标题 / store / RemoteSection 接口，顺序实施比拆多人更容易控制范围。先审核本计划，确认后再执行；若用户明确要求分工，可再选分任务实现与独立复核。
