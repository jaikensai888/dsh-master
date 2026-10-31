# 远程原生文件卡片开发 Prompt（修正版）

请在 `G:\claude_project\code-agent\dsh-master` 补齐远程会话原生文件卡片的识别与渲染。先读适用的 AGENTS.md，再读 `docs/superpowers/specs/2026-10-31-remote-native-file-card-parsing.md`，查看该目录下的 `2026-10-31-remote-delivery-summary-card-reference.png`。

旧的 `remote-delivery-summary-card-design.md` 与旧 prompt 已废弃，不要仅美化 listArtifacts，也不要要求 Agent 调用 deliver_file 才出现文件修改卡片。

用户澄清：本地已能正常识别这些卡片，远程缺少相应识别/渲染。先定位本地真实组件和数据规则。已经找到旁边 deepseek-harness 的 `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`，以及 `packages/fs/tool-fs/src/write.ts`、`edit.ts` 的 presentationMeta/presentCall/presentResult。

核心排查：`tool/call.data.name/arguments/callId` 与 `tool/result.data.meta.diffs`、`message.source.callId`、错误状态。当前 master 的 `src/client/wire.ts` 仅提取文本摘要并截断参数，未保留 meta.diffs；`SessionView.tsx` 将工具事件统一画成通用工具行。但仍需核对实际远程版本及 snapshot/live 事件，确认 node/coordinator 转发是否保留这些字段，不得把当前旁边源码当作已部署版本证据。

先完成只读链路核对并汇报确切字段和本地聚合规则，再按已证实规则实现最小解析与渲染。若本地没有对应汇总算法，需向用户确认聚合范围和统计规则后再实施这一部分。不要扫描助手正文中的路径来猜测结构化卡片，不使用截断后的参数解析，不把运行意图或失败调用计入成功修改。

只用现有真实数据；差异路径不是下载 ID。保留现有 deliver_file/listArtifacts 下载链路，不凭差异卡片伪造下载按钮；打开、预览、编辑不在本期。

有其他 Agent 同时工作，先检查并保留已有改动，不覆盖他人修改；不动节点选择器、会话创建与归档。禁止读取或输出凭证、向真实远程会话发送 prompt、提交 Git、部署或重启服务。仅实施必要产品代码与本地验证；如需协议变更，先报告证据并确认范围。

验证 snapshot/live 一致、callId 配对、重复事件、长参数、合法/缺失/错误 diffs、失败调用、跨会话隔离、参考样式和交互，并保留原产物测试。运行实际仓库对应测试、typecheck、完整测试和 build。最终提供字段证据、修改文件、测试结果和视觉证据；模拟样本必须标注，未完成的真实远程验证明确说明。
