# SDD ledger — plan: docs/designs/workspace-selector/2026-10-30-review/IMPLEMENTATION-PLAN.md

2026-10-30：用户明确批准“ok 请帮我实现”。产品源码已实现，未提交、未发布、未重启 DSH。

## 实现及决定

- Task 1 complete：browseScope 独立持久化，v5 缺字段补本地默认值，保留已有排序及目录展开数据。新增迁移测试先失败，再通过。
- Task 2 complete：复用 RemoteSection 的 roster 和按 nodeId 缓存；本地范围不展示远程目录，远程范围只展示所选节点。保留空目录、未分组、归档过滤和五条 overflow。失败保留旧快照并标记、禁止从旧快照打开或归档。
- Task 3 complete：标题后小三角通过 portal 挂载，没有节点卡片行。菜单可搜索名称 / ID、显示文字状态、当前会话及选择标记；支持方向键 / Enter / Escape，输入法合成期间忽略选择键。原会话搜索及其服务调用保持。
- Task 4 complete：browseScope 变化不调用会话导航；本地列表在节点切换时隐藏而不卸载，远程缓存 / overflow / 滚动按节点保留。RemoteSection 在宽 / 窄栏保持同一挂载位置；窄栏点击先展开，再打开菜单。当前会话与范围不一致时提供侧栏归属提示。
- Task 5 complete：类型、构建、全量测试、样式生成一致性检查与真实组件隔离浏览器操作验证；具体边界见下。

Ruling: 沿用当前 checkout，不切分或切换其他会话的分支 — 当前 profile 链接该 checkout 且用户要求保留并行会话改动 — 不提交、不回退其他文件。

Ruling: 不实现 B 或重写搜索 — 用户已选择 A，且要求搜索原方式 — 静态原型的范围内过滤不搬入产品。

Ruling: 使用独立的标题节点弹层而非宿主 Menu — 已读宿主 Menu 接口，其 items/footer 都是菜单条目，不提供输入框插槽 — 仅该搜索节点弹层使用现有 token 和宿主图标，不新增依赖。

Ruling: 归属提示按钮命名为“返回会话所在节点” — 本轮只切浏览节点，不改变会话或搜索关键词 — 它不承诺滚动定位单条会话；替代计划里额外的强制清搜索 / 展开目录定位，以避免改变原搜索状态。

Ruling: 不修改共享 README / docs/log.md — 它们已有其他会话改动，避免争写；变更与验证记录统一保存在本会话目录。

## 独立复核

首次发现：宽窄切换导致数据所有者卸载；刷新失败没有旧快照提示 / 操作限制；IME Enter 误选。

均已修复。快照操作与 IME 增加回归测试，观察到失败后修复通过。宽窄问题在实际组件页面复验：展开至 12 条，再收窄、点击节点入口展开、重新选择原节点，12 条状态保留且菜单已自动打开。第二次只读复核确认三项消解，无新增严重问题。

## 验证证据

- `pnpm typecheck`：通过。
- `pnpm build`：通过，见 build.log。
- `pnpm test`：251 passed，1 skipped（installed-runtime 环境探针），见 tests.log。
- `node tools/build-styles.mjs --check`：生成内容与 CSS 一致。
- 隔离页面使用真实 WorkspaceBrowser、RemoteSection、WorkspaceNodeChooser、生成样式；宿主 primitives / 数据与服务为 mock，不连接实际 coordinator，不运行真实模型，不读取凭据。
- 浏览器实际验证：本地 → offiec1 只出现一个节点；当前本地会话及草稿保持；打开 office 会话后浏览 my-desktop，当前会话仍是 office，归属提示正确。
- 验证空工作区、五条 overflow 展开与宽窄恢复、窄栏一次点击开菜单、原搜索能从远程浏览范围找到本地会话、关闭搜索恢复入口。
- 截图：implemented-sidebar.jpg、implemented-menu.jpg。图标使用 mock，是组件结构与行为证据，不当作真实宿主视觉验收。

## 边界

未刷新或重启真实 DSH，未向真实模型发送提示词，未执行真实附件上传。本次浏览切换保持 RemotePanel / SessionView 的选择与实例身份，未修改会话、草稿或上传模块；真实附件的端到端复验仍需在真实宿主单独进行。

预览源码：preview.tsx、preview.html、build-preview.mjs、serve-preview.mjs；生成 bundle 和宿主 mock 文件由 build-preview.mjs 重建。后续执行者不得将 mock 文件用于产品打包。
