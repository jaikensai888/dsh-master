# 远程工作区选择与会话管理方案

日期：2026-10-31。状态：待用户评审的设计建议，未实施、未部署。

> 后续范围修正：用户已明确选择器只优化呈现样式，保留现有交互。本文的选择器设计已由 `../plans/2026-10-31-workspace-picker-style.md` 及其配套确认稿取代，不再作为选择器实施依据。本文会话管理内容属于独立任务，不得随选择器优化一并实施。

## 需求与边界

用户要求：优化节点选择框，只显示在线 node；为远程工作区提供归档会话和新建会话；文件显示方案另开会话讨论。本文件供其他 agent 实施。保留现有深色产品语言，不引入新 UI 框架。

设计默认值（本轮提出，尚非用户确认）：在线定义为 state === 'ready' && revoked !== true；保留本地入口；归档可恢复且不删除历史；新建只允许选择 node 已注册的工作区；运行中会话首期禁止归档。最后一项避免用户误以为归档会停止任务，后续可单独设计“停止并归档”。

## 代码核对结果

| 内容 | 当前实现 | 实施含义 |
| --- | --- | --- |
| 节点选择 | src/workspace/WorkspaceNodeChooser.tsx、browse-scope.ts | nodeChoices 只搜索，没有在线过滤 |
| 现有测试 | test/workspace-node-chooser.test.ts | 明确要求保留离线和 revoked，需要随新需求更新 |
| 浏览与会话 | chooser 只修改 browseScope | 保持浏览节点与当前打开会话分离 |
| 归档 | RemoteSection.tsx → client/api.ts → http-api.ts → service.ts → coordinator/client.ts | 已有 POST /dsh-master/api/session/archive；复用，不重建 |
| node 归档调用 | workspace/archiveSession，参数 { request: { sessionId } } | 已存在；返回 archivedSessionIds，并非本地隐藏 |
| 归档竞态 | 归档成功后取消旧列表请求，更新归档集合并刷新；当前会话归档后清空 selection | 必须保留，增加重复操作保护 |
| 空白会话 | remote-model.ts 过滤 blank 会话 | 新建后需保留当前草稿，不能创建后立即消失 |
| 新建与恢复 | master 当前未发现远程创建/恢复路由 | 需先核对 node 和 coordinator 的实际能力，不能照搬本地 startSession |

截图来自运行环境，代码来自本地 checkout；本轮未连接真实部署核对版本。归档在截图中不可见不等于后端不存在，应先核对部署版本、archiveError 和菜单可见性。

## 选择器设计

推荐紧凑弹层，保持侧栏结构：工作区标题右侧显示节点名 office1 与向下箭头，整个节点名区域可点击，不再只有小三角。弹层宽 320px（窄屏不超过 viewport - 24px），内边距 8px，圆角 12px，1px 弱边框与柔和阴影；行高 48px，正文 14px，副文 12px；搜索框高 36px，圆角 8px；采用宿主中文无衬线字体。

弹层顺序：搜索 → 本地行 → 分隔线 → “在线节点 · N” → 在线节点行 → 分隔线 → 刷新节点。节点行左侧设备图标，中部名称和“在线”副文，右侧为“当前会话”弱标签与已选择勾选。勾选只表示浏览选中，当前会话标签只表示主区域会话所属节点。名称长时省略，完整名称和 ID 通过 tooltip / accessible description 提供；同名节点额外显示 ID 尾 6 位。

离线、closing、未知、已撤销节点不进入候选，也不在搜索结果出现。不提供“显示离线”开关。本地不计入在线 node 数。计数显示过滤前的可用远程总数，搜索无匹配时显示“未找到匹配的在线节点”。

状态：

- 在线节点为 0：保留本地，显示“暂无在线节点”和刷新按钮。
- 首次加载：显示加载占位，不把未知状态算在线。
- 刷新中：禁用刷新动作；旧数据可保留但显示“正在刷新”，选择时以最新状态复核。
- 刷新失败：保留已知数据并显示“连接状态未更新”；禁止以失效缓存认定可写，服务端仍需校验。
- 浏览中节点掉线：从候选列表移除，触发器标记“office1 · 已断开”，保留当前上下文和缓存，不自动切到本地或别的节点；新建、发送、归档禁用。重连后同一 nodeId 恢复。
- 搜索支持名称和完整 ID；中文输入组合阶段 Enter 不选择。保留方向键、Esc、Tab、点击外部关闭和焦点返回。候选列表内部滚动，搜索和刷新固定可见。

## 会话管理设计

入口：侧栏顶部“新会话”跟随当前浏览范围，旁边或按钮文字标明目标节点；本地范围沿用本地创建逻辑。每个远程工作区目录行右侧增加常见的“＋”图标（键盘和触摸可达），直接带入 nodeId、workspaceId。远程无注册工作区或能力不足时显示具体原因，不回退成本地新建。

顶部入口弹出“新建远程会话”小对话框：节点只读；工作区为当前 node 的已注册工作区下拉框，显示名称和路径；名称可选，默认“新会话”。从目录加号打开时工作区预填。提交前不发送 prompt，不创建本地会话。

提交状态：未填工作区不可提交；提交后按钮显示“正在创建…”并禁用重复点击。成功后以服务器返回的 sessionId 打开远程主面板、展开工作区、聚焦输入框。新会话以临时“新会话”行显示，当前草稿例外于 blank 过滤；首条消息后采用真实标题。离开未发送草稿后遵循现有 blank 隐藏规则，不产生多个可见空白行。优先复用同 node + workspace 下未发送的本次草稿。

失败：保留表单和用户输入；节点断线、目录失效、能力不支持分别提示；不展示伪成功会话。超时可能已创建，须用幂等键或查询结果确认，禁止无保护重试。

归档入口：会话行“…”中显示“归档会话”；归档不采用危险红色。运行中显示禁用项及“任务结束后可归档”。静止会话点击后进入处理中，服务端确认成功再从活动列表隐藏。失败保留行并就地提示可重试。当前打开会话归档后回到同 node、同 workspace 的空态，不跳到其他 node。

工作区菜单提供“已归档会话”入口：打开带工作区上下文的面板，列出归档标题/时间（若服务端有字段），允许“恢复”。恢复成功后回活动列表；不自动发送消息。空列表显示“暂无已归档会话”。归档集合与会话列表按 nodeId 联合识别，不能跨 node 串用 ID。

建议将恢复能力与归档入口一起交付；若 node 只支持归档，不要假装有恢复操作，实施前明确能力缺口，保留现有归档实现。

## 接口与分层建议

以下是拟新增的 master 契约，不代表 node 已支持对应方法。保持浏览器 → master → coordinator → node 链路，不从浏览器直连 node，不暴露 token。

| master 接口 | 建议参数 | 成功结果 |
| --- | --- | --- |
| POST /dsh-master/api/session/create | nodeId、workspaceId、可选 title、requestId（幂等） | nodeId、workspaceId、sessionId、title |
| POST /dsh-master/api/session/archive（已有） | nodeId、sessionId | archivedSessionIds（已有） |
| POST /dsh-master/api/session/unarchive（拟新增） | nodeId、sessionId | archivedSessionIds |
| GET /dsh-master/api/sessions（已有） | nodeId | 复用 sessions、workspaces、archivedSessionIds；核查 sessions 是否含已归档条目 |

先核对 dsh-node 的真实 create / attach-to-workspace / unarchive 能力和 coordinator 调用白名单。能复用就复用；缺失时需要 node/coordinator 配套，不能仅改 master 前端。创建会话与工作区绑定需原子完成，或有明确补偿；workspaceId 必须由目标 node 校验，不能用浏览器传入 cwd 推断绑定。标题应由服务端确认支持，能力不支持时去掉可选名称字段。

建议新增节点级能力声明 canCreateSession / canArchiveSession / canUnarchiveSession（字段名待实施确定）。不能用 capabilityCount > 0 推断具体能力。旧节点显示原因，所有写入在服务端再检查节点、权限、资源归属和当前运行状态。复用现有鉴权及错误封装；新建开关需明确与现有 promptEnabled 的关系，不能绕过部署对远程写入的限制。

## 实施顺序与文件

1. 选择器：browse-scope.ts 增加统一 ready 且未撤销的候选过滤；WorkspaceNodeChooser.tsx 调整布局、空态和重复名称；RemoteSection.module.css 为样式源；运行 tools/build-styles.mjs 更新 styles.generated.ts；locales.ts 补中文和英文。不要从 API 全局删离线节点，当前会话仍需状态信息。
2. 归档：复查 RemoteSection.tsx 现有链路和部署能力；补处理中、运行中禁用、明确错误、已归档列表及恢复。归档后保留当前工作区上下文。
3. 新建：先验证远程能力和实际数据结构，再从 protocol.ts、coordinator/client.ts、service.ts、http-api.ts、client/api.ts 到 RemoteSection.tsx / WorkspaceBrowser.tsx 接通；selection 和 blank 例外处理需按 node + workspace 隔离。本地逻辑保持原样。
4. 验证：选取器、归档和新建分别验证，再执行项目 typecheck / build / test，以及 CSS 生成检查。真实远程验证单列，不把合成测试当作线上通过。

## 验收清单

- ready 未撤销才可见；offline / revoked / closing / unknown 均不出现在候选及搜索结果；保留本地。
- 同名节点可区分，长名称不挤压勾选；320px 窄屏不越界；键盘与中文输入正常。
- 切浏览范围不会替换当前会话，断线不会自动跳 node；刷新异常不误显示在线。
- 归档调用已有接口；失败不消失，刷新旧响应不复活，重复点击只提交一次；运行中前后端一致拒绝。
- 已归档可恢复且刷新后状态一致；不同 node 的相同 sessionId 不互相影响。
- 新建绑定正确远程 workspace，目录失效明确报错；不触发本地创建，不自动执行 prompt；新建空白会话可见并可输入。
- 双击、超时重试不产生多个会话；旧节点按具体能力降级；现有本地新会话不回归。

文件显示方案已独立为新讨论会话，不在本轮确定文件树、预览或编辑范围。
