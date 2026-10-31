# 交给开发 Agent 的 Prompt

> 本 Prompt 已失效，请勿将下面旧正文交给开发 Agent。用户已明确：本地原生文件卡片能正常解析，需要为远程消息补齐识别与渲染，而非仅改版 `listArtifacts`。请使用 `2026-10-31-remote-native-file-card-parsing.md`。

将下面内容整段交给有此仓库访问权限的 Agent：

---

请在 `G:\claude_project\code-agent\dsh-master` 实现远程会话“交付文件汇总卡片”。本次授权产品代码实现与本地验证，不包含提交 Git、部署、重启服务或向真实远程会话发送提示。

先读取并遵守当前工作区及父目录适用的 AGENTS.md，然后阅读：

1. `docs/superpowers/specs/2026-10-31-remote-delivery-summary-card-design.md`
2. 同目录的 `2026-10-31-remote-delivery-summary-card-reference.png`，必须实际查看图片。
3. `src/client/ArtifactCard.tsx`、`src/client/SessionView.tsx`、`src/client/styles.ts`、`src/client/copy.ts`。
4. `src/client/api.ts`、`src/files-protocol.ts` 和 `test/remote-artifacts.test.ts` 中相关部分。

目标是用户参考图里的紧凑汇总卡片：一个圆角容器，头部文件图标、“已交付 N 个文件”和总大小，分隔线，紧凑文件行，右侧小型下载入口/失效状态；大于 4 个文件时可展开全部及收起。不是一份文件一张大卡片，也不是代码修改/增删行统计卡片。

执行约束：

- 当前仓库有其他 Agent 同时工作。先检查已有改动，保留它们，不覆盖或回退他人修改。
- 保持现有会话级展示位置，不擅自绑定到某条 AI 回复，不改节点选择器、会话创建和归档。
- 只使用真实 `listArtifacts` 元数据，保留合并去重及升序排序语义；同名不同 ID 是不同交付快照。
- 复用现有下载 URL、原生链接与后端安全校验；不解析远程路径，不改三仓库文件协议。
- 原生下载无法可靠回传保存结果，本期不造下载进度/成功/失败状态，不做 Blob 整文件下载。
- 不做预览、编辑、自动打开、文件树和批量下载，不新增依赖。不要读取或输出凭证。
- 默认 4 行、展开状态跨轮询保留、跨会话重置；防止迟到响应串会话。
- 使用宿主主题变量，处理长文件名、窄屏、失效状态、工具不可用、空态、读取失败和键盘可访问性。

先补充/调整必要测试，再完成最小实现，运行：

```powershell
pnpm exec vitest run test/remote-artifacts.test.ts
pnpm run typecheck
pnpm test
pnpm run build
```

还需实际检查展开/收起、键盘操作、会话切换和视觉效果。静态渲染断言不能代替交互验证。输出 1 文件、6 文件折叠/展开、失效行的截图或明确说明哪些视觉验证未完成；模拟截图需标注，不得假称真实远程验收。不要自行向真实节点发送 prompt 来造产物。

如果出现“卡片仍未显示”，先区分无登记产物、请求失败、运行实例版本和布局缺陷；不要为了显示卡片伪造数据或自动将消息里的路径登记为产物。超出本期范围时报告证据。

请持续完成实现和本地验证，最终用简体中文说明：改了哪些文件、交互行为、验证命令和结果、视觉证据、仍存在的问题。文档中已明确的默认值可直接采用；遇到会改变本期范围的冲突再询问。

---
