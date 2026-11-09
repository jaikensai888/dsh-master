# dsh-master「关注」开发 Prompt

复制下方代码块交给开发 Agent。设计与验收见 [跨工作区「关注」设计](../superpowers/specs/2026-11-09-session-following-design.md)。

```text
请在 dsh-master 实现跨工作区的「关注」功能，并完成代码验证。

工作区：G:\claude_project\code-agent\dsh-master
先读 AGENTS.md 和 docs/superpowers/specs/2026-11-09-session-following-design.md，检查当前分支、已有改动和代码入口。用户已确认首版的关注记录存于当前浏览器。代码范围为 dsh-master，使用现有接口和依赖。本次交付为实现和验证，发布与部署另行安排。

用户要解决的问题：我在多台机器上都有要持续跟进的会话，希望给本机和远程会话做标记，从同一个列表直接继续，不用切换工作区。

实现目标
1. 在工作区下拉加「关注」，在本地分组、平铺和远程的正式会话行菜单加「关注 / 取消关注」。远程关注动作独立于远程归档接口的可用性。
2. 关注列表显示会话标题、机器和工作区，按关注时间倒序，支持用已有搜索入口筛选这三个字段。打开条目后右侧切换会话，左侧保留「关注」并高亮已选行。取消关注仅移除标记。
3. 使用浏览器侧持久化机制，兼容既有 v5 快照。区分本机与远程身份，远程按 Coordinator 来源、nodeId、sessionId 定位。只保存身份、关注时间及最少显示摘要。进入与刷新时核验来源，核验期间暂停打开远程条目。按设计界定的范围隔离已确认来源，沿用现有远程 API。
4. 进入与手动刷新时复用现有节点名册和会话加载流程，仅查询有关注的可路由节点。同一节点合并加载，限制并发，隔离失败和过时响应。离线、归档、暂未找到或加载失败时保留记录，提示状态并允许取消关注。

先核对这些文件
- src/workspace/stores.ts 与 test/workspace-stores.test.ts 的持久化和旧快照兼容。
- src/workspace/WorkspaceNodeChooser.tsx、src/workspace/browse-scope.ts 与 src/workspace/locales.ts 的下拉范围和文案。
- src/workspace/rows/WorkspaceBrowser.tsx 与 src/workspace/rows/Rows.tsx 的本地会话菜单、搜索和打开后切换范围逻辑。
- src/workspace/RemoteSection.tsx 与 src/workspace/contract/slots.ts 的单一远程数据所有者、节点级加载、远程行菜单及归档能力。
- src/client/selection.ts、src/client/api.ts 与 src/protocol.ts 的会话打开和节点身份契约。

验收与回报
- 依据设计中的六项验收逐一核对。补充针对旧快照、去重、跨节点或跨 Coordinator 身份、离线保留和导航范围的回归覆盖。覆盖目标节点请求合并和过时响应保护。
- 运行相关 Vitest、pnpm run typecheck 和 pnpm test。若触及样式生成或打包入口，按仓库现有流程执行生成或构建检查。
- 用本地可控环境检查实际侧栏交互。若缺少可用的多节点环境，以测试夹具验证跨节点行为，并在交付中区分自动化结果和真实节点验收。
- 交付时报告修改文件、执行过的命令与结果，以及任何仍待验证的行为。
```
