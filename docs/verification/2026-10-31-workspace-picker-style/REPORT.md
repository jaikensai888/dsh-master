# 工作区节点选择器样式优化 · 实施与验证记录

日期：2026-10-31。状态：**已实施并完成本地验证；未提交、未部署、未重启 DSH。**

依据：`docs/superpowers/plans/2026-10-31-workspace-picker-style.md` 与
`docs/designs/workspace-selector/2026-10-31-approved/workspace-picker-style.html`。
本文取代 `docs/superpowers/specs/2026-10-31-remote-workspace-design.md` 中的选择器方案；本任务不涉及新建会话、归档、恢复或文件显示。

## 1. 范围

| 已做 | 未做 |
| --- | --- |
| 精修弹层布局、间距、字号层级、搜索框、选中背景、标签、边框、圆角、阴影 | 不新增分组、数量、离线开关、额外入口或状态面板 |
| 候选层只显示 `state === 'ready' && revoked !== true` 的远程节点 | 不删除共享 roster 中的离线节点，不改 `browseNodes` / 节点 API |
| 保留本地入口、原触发器、搜索、节点切换、刷新、键盘、弹层开关与焦点 | 不改搜索规则、排序、刷新请求、会话导航 |
| 弹层 400px 宽度后重算横向避让，窄屏不越界 | 不实施会话管理、文件、归档等旧方案内容 |

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/workspace/WorkspaceNodeChooser.tsx` | 展示层结构调整：搜索区、候选行文本列、状态/ID 分列、标签、固定 14px 勾选槽、刷新图标与刷新区；新增 `data-selected` 与 `aria-pressed`；`place()` 按 400px 实际宽度计算左右避让。事件、portal、dialog、键盘、焦点逻辑保持原样。 |
| `src/workspace/RemoteSection.module.css` | 重写 `chooser*` 类：尺寸、间距、层级、颜色、选中、标签、分隔线、阴影与 `max-width: 420px` 窄屏规则；未改其他 remote 组件样式。 |
| `src/workspace/browse-scope.ts` | `nodeChoices` 候选层过滤：`ready` 且未撤销后才应用原名称/ID 搜索；签名与顺序不变。 |
| `src/workspace/styles.generated.ts` | 由 `node tools/build-styles.mjs` 生成，未手改。 |
| `src/upstream.d.ts` | 补 `IconCheckOutlineRegular` 声明（已确认存在于安装的 DSH runtime 0.2.1-rc.2）。 |
| `test/workspace-node-chooser.test.ts` | 更新旧离线可见预期，补 closing/unknown/revoked/ready、空查询、trim、大小写、顺序断言。 |
| `docs/verification/2026-10-31-workspace-picker-style/` | 隔离预览、浏览器核对脚本、截图与检查结果；仅验证材料，不参与产品打包。 |

用户已有的其他未提交改动（README、SessionView、附件、面板等）均未触碰。

## 3. 视觉规格落地

浏览器实测值（900px 视口、深色 token、2x 截图）：

| 项 | 设计稿 | 实测 |
| --- | --- | --- |
| 弹层 | 400px / padding 8 / 圆角 12 / 边框 1px | 400px / `8px` / `12px` / `1px` |
| 阴影 | `0 16px 40px #0004, 0 3px 8px #0003` | 一致（计算值同） |
| 搜索框 | 高 38 / 圆角 7 / 13px·20px / 横向 padding 11 | 38 / 7px / 13px·20px / `8px 11px` |
| 搜索留白 | 2 / 2 / 2 / 8 | margin `2px 2px 8px` |
| 本地行 | 最小 42 / padding 11 12 / 下方 3 / 14px | 42 / `11px 12px` / 3 / 14px |
| 远程行 | 最小 66 / padding 11 12 / 列间距 12 / 圆角 7 | 66 / `11px 12px` / 12 / 7px |
| 名称 | 14 / 500 / 21 | 14 / 500 / `21px` |
| 状态与 ID | 11 / 18 / 间距 5 / 上间距 2 | 11 / `18px` / 5 / 2 |
| 当前会话 | 11 / padding 2 5 / 圆角 4 / 不换行 | 11 / `2px 5px` / 4 / `nowrap` |
| 勾选 | 14×14 固定占位 | 14×14 |
| 刷新区 | 上间距 8 / 1px 分隔 / 线下 5 | 8 / 1px / 5 |
| 刷新按钮 | padding 9 12 / 12px / 圆角 6 / 图标 13 / 间距 8 | `9px 12px` / 12 / 6 / 13×13 / 8 |
| 320px | 不越界，边缘 ≥ 8px | 宽 304，x=8，右缘 312，行 padding 10、间距 8 |

## 4. 主题映射

优先使用宿主 `--dsw-*` 语义变量；只有设计稿明确指定、且无对应变量的焦点色/阴影在 chooser 范围内使用字面值，未修改全局变量，也未强制浅色主题显示深色弹层。

| 用途 | 设计参考 | 实现 |
| --- | --- | --- |
| 弹层底色 | `#242426` | `--dsw-alias-bg-layer-1`（深色 `#232324`） |
| 弹层边框 | `#424247` | `--dsw-alias-border-l3` |
| 主文字 | `#ededf0` | `--dsw-alias-label-primary` |
| 输入框底色 / 边框 | `#1c1c1f` / `#48484f` | `--dsw-specific-sidebar-fill` / `--dsw-alias-border-l4` |
| placeholder | `#92929c` | `--dsw-alias-label-caption` |
| 副文字 | `#9d9da7` | `--dsw-alias-label-tertiary` |
| 悬停 / 选中 | `#303034` / `#333338` | `--dsw-alias-interactive-bg-hover`（与工作区行选中一致） |
| 标签文字 / 底色 | `#bdbdc7` / `#414147` | `--dsw-alias-label-secondary` / `--dsw-alias-interactive-bg-active` |
| 刷新区分隔线 | `#3b3b40` | `--dsw-alias-border-l2` |
| 焦点边框 + 外圈 | `#839bd0` + `0 0 0 2px #819bd01a` | 同值（仅 `.chooserSearch:focus`） |
| 行焦点环 | `#91a9df` | 同值，`outline-offset: -2px`（列表内部滚动，外置环会被裁切） |
| 阴影 | 见上 | 同值（仅 `.chooserPopup`） |
| 禁用刷新 | — | `--dsw-alias-label-dimmed` |

## 5. 在线候选过滤

`nodeChoices(nodes, query)` 现在先判断 `node.state === 'ready' && node.revoked !== true`，再应用原来的名称/ID 搜索。过滤只发生在候选函数；`fetchNodes`、`browseNodes`、共享 roster 和当前会话导航未改，已打开会话所属的离线节点仍在数据中。

## 6. 定位计算

弹层 CSS 为 `width: min(400px, calc(100vw - 16px))`，`place()` 按同一公式算出实际宽度后再夹取横向位置：

```ts
const width = Math.min(400, innerWidth - 8 * 2)
left = max(8, min(rect.left, innerWidth - width - 8))
```

原先的 `innerWidth - 372`（按 360px 弹层）已移除。锚点、展开方向、纵向 `maxHeight` 逻辑保持原样。

## 7. 自动检查结果

| 命令 | 结果 |
| --- | --- |
| `node tools/build-styles.mjs` | 写入 `styles.generated.ts`（5 个样式表、109 类） |
| `node tools/build-styles.mjs --check` | `ok: src/workspace/styles.generated.ts matches the CSS modules` |
| `pnpm exec vitest run test/workspace-node-chooser.test.ts test/workspace-styles.test.ts` | 16 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0（`lib/index.js`、`lib/client.js`） |
| `pnpm test` | 33/34 文件通过；`installed-runtime.test.ts` 因环境失败：pnpm 注入的 `DSH_RUNTIME_ROOT` 指向 `runtime-commands/generations/...`，该目录没有 `node_modules`，测试在读取上游文件时即报 ENOENT，与本次改动无关 |
| `node node_modules/vitest/vitest.mjs run`（`DSH_RUNTIME_ROOT='E:\DSH\DSH Desktop\resources\app\node_modules'`，README 记录的用法） | **34 文件 / 267 测试全部通过**，其中包含“插件导入的每个 primitive 图标都存在于已安装 runtime”的契约检查 |
| `python docs/verification/.../verify-picker.py` | **60 项浏览器断言全部通过**，结果见 `checks.json` |

第一条过滤测试在旧实现下确实先失败（`nodeChoices` 仍返回 offline/revoked/closing/unknown），实现后通过；这是任务 A 要求的前后对照。

## 8. 浏览器核对

方法：`preview.html` 使用**生产** `WorkspaceNodeChooser`、生产生成样式与生产浮层/键盘/焦点逻辑，只把节点 fixture、三个图标（SVG 几何取自安装 runtime）和选择器用到的 `--dsw-*` token 放进隔离页；不连接 coordinator，不发送消息。

覆盖：默认（本地 + office1；离线/撤销/连接中/未知均未出现）→ 搜索与 trim/大小写 → 无匹配 → 本地/远程切换与焦点回归 → 浏览范围与当前会话不一致（标签在 office2、勾选和背景在 office1）→ 长名称/长 ID 各自省略 → 多节点内部滚动且搜索/刷新不滚走 → 方向键、Esc、Tab、外部点击、Enter 选择 → 刷新保持弹层打开并计数 → loading/error 与禁用刷新 → 右缘锚点 8px 避让 → 320px 视口 → 与设计稿并排对比。

截图（同目录）：

| 文件 | 内容 |
| --- | --- |
| `comparison.png` | 设计稿与实现并排（400px） |
| `picker-default.png` | 默认：本地 + office1，选中、勾选、当前会话标签、搜索聚焦 |
| `picker-search.png` | 搜索 `office` 后的结果 |
| `picker-current-session-mismatch.png` | 浏览 office1、当前会话在 office2 |
| `picker-long-name.png` | 超长名称与超长 ID 的省略 |
| `picker-many-nodes.png` | 多个在线节点，候选区内部滚动 |
| `picker-keyboard-focus.png` | 方向键聚焦行（内嵌焦点环，未被滚动区裁切） |
| `picker-busy-error.png` | 加载中 + 错误 + 禁用刷新 |
| `picker-right-edge.png` | 触发器靠右时的 8px 横向避让 |
| `picker-320.png` | 320px 视口，宽 304、两侧 8px |

## 9. 保留的原有行为与已知现象

- **Enter 选择后会重新打开弹层**：原逻辑在 `choose()` 里关闭并 `trigger.focus()`；同一次 Enter 的按钮默认激活随后点击触发器，于是弹层再次打开。这是原有 `close()` + Enter 处理的组合行为，本次按要求未改，核对脚本把它记录为 pre-existing（`Enter reopens via focus return (pre-existing)`）。
- **无匹配时不显示“未找到”文案**：设计稿中的 `.empty` 属于演示脚本；现有 locales 没有对应文案，本次不新增业务文案与状态，只保留空候选列表。
- **触发器尺寸未改**：仍为 24×28、10px 图标与旋转逻辑，符合“保留原触发器”。
- **勾选语义**：勾选改为图标（图标库自身 `aria-hidden`），选中信息通过 `aria-pressed` 保留，与设计稿的 `aria-pressed` 一致；点击行为不变。

## 10. 未验证与边界

- 未重启/重载真实 DSH Desktop 会话，未在真实插件面板中人工复验；按要求未提交、未部署。
- 节点、会话状态为 fixtures；未连接真实 coordinator。
- 三个图标为隔离页 mock（几何与安装 runtime 一致，但非真实模块加载）；主题只复制了选择器用到的 token。
- 未截图浅色主题；颜色使用语义变量，理论上随主题切换。
- 未在真实中文输入法组合态下操作；`browseNavigationKey` 的 IME 分支有单测覆盖（`isComposing` / `keyCode 229`）。

## 11. 复现

```powershell
node tools/build-styles.mjs
node docs/verification/2026-10-31-workspace-picker-style/build-preview.mjs

$env:PICKER_CHROMIUM = "$env:LOCALAPPDATA\ms-playwright\chromium_headless_shell-1148\chrome-win\headless_shell.exe"
python docs/verification/2026-10-31-workspace-picker-style/verify-picker.py
```

`preview.tsx`、`preview-primitives.tsx`、`build-preview.mjs`、`verify-picker.py` 及生成的 HTML/截图均为验证材料，**不得用于产品打包**。
