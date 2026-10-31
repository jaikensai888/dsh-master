# 工作区节点选择器样式优化实施文档

> 实施 agent：按本文件逐项执行，可使用 superpowers:executing-plans。本次仅实施选择器样式及在线节点过滤，不执行此前文档中的会话管理需求。

**Goal:** 保留现有选择器的结构、入口和交互，将其呈现优化为用户已确认的设计稿，并仅显示在线远程 node。

**Architecture:** 复用 WorkspaceNodeChooser 组件和当前 browseScope 数据流；CSS 修改限定在 chooser 相关类，必要时增加少量展示用 class / span。在线过滤限定在 nodeChoices 候选函数，不改变节点 API 或当前会话导航。

**Tech Stack:** 现有 React、TypeScript、CSS Modules 生成工具、Vitest；不新增依赖。

**Spec:** 本文中的设计规格与配套设计稿 `../../designs/workspace-selector/2026-10-31-approved/workspace-picker-style.html`。设计稿为已确认的视觉依据，不是生产组件；实施应保留产品原有事件逻辑。

## 1. 用户确认与范围

用户明确要求：“只需要优化选择器的样式”“当前的交互我是满意的”。用户已看过本版设计稿并要求生成实施文档。

保留原顺序：搜索框 → 本地 → 在线节点 → 刷新远程节点。保留节点名、在线状态、节点 ID、“当前会话”和勾选标记。节点 ID 仍可见，过长省略，原 tooltip 保留完整内容。

在线过滤是用户最初提出并在本版设计中保留的唯一行为调整，采用 `state === 'ready' && revoked !== true` 作为可选在线节点条件。

### 不属于本次任务

- 不增加分组标题、在线数量、离线开关、额外入口或状态面板。
- 不把三角触发器改成节点名按钮，不更改触发器位置和侧栏结构。
- 不增加设备图标或新的节点信息字段；刷新图标仅为原按钮的视觉装饰。
- 不改变节点切换、搜索规则、排序、刷新请求、展开关闭、焦点和键盘逻辑。
- 不增加归档、新建会话、恢复或文件显示功能。
- 不调整远程聊天区域、工作区树和全局主题。
- 不新增网络接口、权限开关或持久化状态。

本文件取代 `../specs/2026-10-31-remote-workspace-design.md` 中的选择器设计。旧文档的会话管理内容属于另一个任务，不能顺带实施。

## 2. 设计稿与视觉规格

配套文件：`docs/designs/workspace-selector/2026-10-31-approved/workspace-picker-style.html`。

设计稿仅展示一个弹层：本地和在线 office1；离线节点不出现。外部点阵背景及演示区域留白属于评审容器，不要实现到产品中。演示中的搜索、点击和刷新只是示意；生产代码必须继续使用原组件逻辑，不能用演示脚本替换。

### 尺寸和排版

| 元素 | 目标规格 |
| --- | --- |
| 弹层 | 宽 400px，窄视口不超过 `100vw - 16px`；padding 8px；圆角 12px；边框 1px |
| 搜索区 | 左右及顶部留白 2px，底部留白 8px |
| 搜索框 | 高 38px；横向 padding 11px；圆角 7px；字号 13px，行高 20px |
| 本地行 | 最小高 42px；padding 11px 12px；下方间距 3px；字号 14px |
| 远程节点行 | 最小高 66px；padding 11px 12px；列间距 12px；圆角 7px |
| 节点名称 | 14px，字重 500，行高 21px |
| 状态与 ID | 11px，行高 18px；名称下方间距 2px；状态、分隔点、ID 间距 5px |
| 当前会话标签 | 11px；padding 2px 5px；圆角 4px；不换行 |
| 勾选 | 14 × 14px，固定占位，不挤压、不换行 |
| 刷新区 | 顶部间距 8px；顶部细分隔线；线下留白 5px |
| 刷新按钮 | padding 9px 12px；字号 12px；圆角 6px；图标 13px，距文字 8px |

沿用宿主无衬线字体与字体回退，不加载外部字体。避免继承导致截图中字号偏大、字重混乱。主文字与副文字必须显式建立层级。

### 深色参考值

以下为已确认稿的视觉参考；实施优先匹配现有 `--dsw-*` 语义变量。缺少合适变量时只在 chooser 范围补充样式，不改全局变量，也不强制浅色主题显示深色弹层。

| 用途 | 深色参考值 |
| --- | --- |
| 弹层底色 / 边框 | `#242426` / `#424247` |
| 主文字 | `#ededf0` |
| 输入框底色 / 边框 | `#1c1c1f` / `#48484f` |
| placeholder | `#92929c` |
| 副文字 | `#9d9da7` |
| 悬停 / 选中底色 | `#303034` / `#333338` |
| 标签文字 / 标签底色 | `#bdbdc7` / `#414147` |
| 刷新区分隔线 | `#3b3b40` |
| 焦点边框 | `#839bd0`，外圈 `0 0 0 2px #819bd01a` |
| 阴影 | `0 16px 40px #0004, 0 3px 8px #0003` |

不要增加强蓝色选中块、彩色在线圆点、大图标、卡片式节点或明显发光效果。选中背景是克制的中性灰色。

### 对齐、宽度与状态

- 名称和副文字作为同一可伸缩列，`min-width: 0`；名称过长单行省略。
- 右侧依次为“当前会话”标签、勾选；固定占位，不因切换而抖动。
- “当前会话”取自 `currentNodeId`，勾选和背景取自 `scope`。两者可以属于不同节点，不能混用。
- 选中行需要持续的浅灰背景，可使用现有 scope 派生样式或 `data-selected`；不改变语义和点击处理。
- 远程 ID 长时在自己的列内省略，不隐藏整行，不挤掉标签；保留完整 ID tooltip。
- 320px 视口下弹层边缘距屏幕至少 8px，必要时行列间距降至 8px、左右 padding 降至 10px；内容不越界。
- 节点很多时继续让候选列表内部滚动；搜索和刷新不被压缩或滚走。
- 保留现有 loading/error、禁用刷新等状态，只统一样式，不新建状态流程。

## 3. 修改位置

| 文件 | 本次职责 |
| --- | --- |
| `src/workspace/WorkspaceNodeChooser.tsx` | 小范围补展示 class、选中样式标识、标签及刷新图标；保留原事件处理 |
| `src/workspace/RemoteSection.module.css` | 修改 chooser 样式源，避免影响其他 remote 组件 |
| `src/workspace/styles.generated.ts` | 由生成命令更新，禁止仅手改生成文件 |
| `src/workspace/browse-scope.ts` | 仅在 nodeChoices 中过滤可选在线节点，保留函数签名与原顺序 |
| `test/workspace-node-chooser.test.ts` | 更新旧离线可见预期，补在线候选过滤断言 |

仅在确有必要时改现有样式测试；无需为圆角、颜色等添加逐项镜像测试。中文文案沿用现有 locales，不因视觉设计新增业务文案。

## 4. 实施步骤

### 任务 A：在线候选过滤

**接口保持不变：** `nodeChoices(nodes: readonly MasterNode[], query: string): MasterNode[]`。

- [ ] 先查看当前 checkout 的用户改动，保留无关修改；不要直接照旧文档重构。
- [ ] 更新旧测试 `searches IDs and names while retaining offline and revoked nodes`：搜索 LOCAL 只返回 ready 且未 revoked 的 same；搜索 revoked 返回空。
- [ ] 增加 closing、unknown、revoked ready、ready 的组合断言；空查询只保留合法 ready；名称和 ID 大小写不敏感搜索及 trim 行为不变；保留原始顺序。
- [ ] 执行 `pnpm exec vitest run test/workspace-node-chooser.test.ts`，确认新过滤预期在旧实现下失败。
- [ ] 最小修改 nodeChoices：先判断 ready 且未撤销，再应用原名称/ID 搜索条件。
- [ ] 重跑同一测试，确认通过。

不要在 fetchNodes 或共享节点数据层删除离线节点，不改 browseNodes；离线节点状态仍可能用于已打开会话。

### 任务 B：样式落地

- [ ] 打开设计稿，按照第 2 节调整 CSS 和最少量 JSX。
- [ ] 保留原三角触发器和图标旋转逻辑，继续用原 portal、dialog、关闭和键盘处理。
- [ ] 弹层宽度从 360px 改为 400px 后，同步核查 WorkspaceNodeChooser 的 place 定位：现有 `window.innerWidth - 372` 包含旧宽度假设，应按实际新宽度计算横向避让，不能仅修改 CSS。仍保持原锚点和定位方向，只消除溢出。
- [ ] 不替换原搜索 Enter/中文输入法保护、方向键、Esc、Tab、外部点击关闭及 focus 返回逻辑。
- [ ] 执行 `node tools/build-styles.mjs` 更新生成样式。

注意：生成器还依赖本机 `G:/claude_project/code-agent/deepseek-harness/packages/client/ui-workspace/src/client` 的上游 CSS。若执行环境缺失，报告真实依赖缺口，不重新生成无关上游样式、不引入新构建工具。

### 任务 C：验证与交付

- [ ] 执行下列检查，以实际结果为准，不能把本方案列出的命令当作已通过：

```powershell
pnpm exec vitest run test/workspace-node-chooser.test.ts test/workspace-styles.test.ts
node tools/build-styles.mjs --check
pnpm typecheck
pnpm build
pnpm test
```

- [ ] 在实际浏览器中核对：本地、选中的 office1、搜索、无匹配、长名称、长 ID、多个在线节点滚动、loading/error、320px 窄视口和右侧边缘位置。
- [ ] 分别验证浏览选中节点与当前会话节点不同的状态，确保标签、勾选和背景各自正确。
- [ ] 验证原触发器、鼠标切换、刷新、方向键、中文输入、Esc/Tab/外部关闭、焦点回归，无新增交互。
- [ ] 验证 offline、revoked、closing、unknown 不出现在候选和搜索结果，本地入口仍在。
- [ ] 交付修改文件清单、选择器截图及检查结果；真实部署未验证时如实说明。是否提交或部署遵循用户授权，不把本文件当作发布授权。

## 5. 完成标准

选择器与确认稿在尺寸、字体层级、间距、标签、选中背景、搜索框、底部分隔及阴影方面一致；仅显示可选在线 node；原交互不变；无样式外溢与窄屏越界；没有夹带新建、归档、恢复或文件功能。

本文仅交付实施方案与视觉参考。本轮没有修改产品代码，也没有执行产品测试或部署。
