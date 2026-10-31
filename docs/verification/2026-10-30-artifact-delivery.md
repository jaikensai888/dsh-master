# 远程交付文件排查与验收（2026-10-30）

## 结论与边界

`my-desktop` 当前运行实例已通过真实模型 → 真实宿主 `deliver_file` → 元数据落盘 → master `listArtifacts` → HTTP 下载验证。原反馈对应节点及会话尚未获得，不能据此认定原场景已经复现或修复。真实 GUI 截图、卡片可见性及浏览器点击下载尚未完成。

已确认并修复两个可独立复现的缺口：

1. 原 `ArtifactList` 在文件列表为空时直接返回 `null`，整个交付区域隐藏，也不展示节点工具不可用的原因。现在读取 `describe.deliveryTool`，显示空态说明或工具不可用提示；已交付文件继续使用原卡片。
2. 交付引导原本只出现在 `attachmentPromptBlock` 中，即只有上传附件后才向模型说明交付。普通文本请求现在同样附加交付约定：文件完成后调用 `deliver_file`，工具成功才可声称交付；工具不可用时明确说明。没有添加远端路径解析或人工登记文件的接口。

本次没有修改 node/coordinator、侧栏或其他信息卡片；保留三个仓库已有未提交修改。未重启、发布、部署或提交 Git。本地 bundle 已构建；运行中宿主不保证加载本次源码，不能以 `0.1.0` 包版本作为加载证明。

## 真实运行证据

| 字段 | 实际值 |
| --- | --- |
| 本机实例 | `http://127.0.0.1:56574`（端口可能变化） |
| 测试节点 | `my-desktop` / `node-b7ae1e560774708d7e8f22f523c592a0` |
| 测试会话 | `session-1e445c41-bcac-4666-86dc-4fdfd144b3ab`，测试前为空白、未运行 |
| 模型 | `deepseek-official` / `deepseek-flash`，真实回合 1 |
| 模型实际调用 | `write` → `read` → `deliver_file`，均成功，随后 `turn/end: completed` |
| 工具调用 ID | `call_00_ET_2NaPsCOFguZ7Ez2TltPs3450` |
| 文件 | `artifact-acceptance.md`，56 字节，两行 Markdown 文本 |
| 产物 ID | `fcbcaa24-fa8e-4f0e-80b0-19eec8caf5cf` |
| 归属 | `listArtifacts` 返回的 nodeId/sessionId 与请求一致 |
| 创建/到期 | `2026-10-30T02:48:48.332Z` / `2026-11-06T02:48:48.332Z` |
| 下载响应 | HTTP 200；`Content-Disposition: attachment`，UTF-8 文件名 `artifact-acceptance.md` |
| SHA-256 | `8d1e60811094395b6354db37bec8fd8301409beb2302b65778b1c238d6f6bbb5` |
| 校验 | 元数据 SHA-256 = 下载文件 SHA-256 = 原文件 SHA-256 |

节点文件存储中新增对应的 artifact 快照及 `manifests/artifacts/<artifactId>.json`。测试没有伪造产物、没有直接调用 store 来代替模型工具调用，也没有触碰其他远端节点。

这次真实模型回合在修复前已成功，证明当时运行的交付工具链可用；它不能证明新的空态和提示已经在运行中的 GUI 生效。

## 验证分层

| 层次 | 本次结果 | 不能证明的内容 |
| --- | --- | --- |
| 模拟/组件回归 | 新增 3 个失败用例先红后绿；另补 SessionView 能力状态的渲染断言 | 不能代替真实 GUI |
| 本地自动化 | 245 passed、1 skipped；跳过项为未配置安装宿主路径的导出兼容测试 | 跳过项不能算通过 |
| 类型与构建 | `tsc -p tsconfig.json --noEmit`、`tsc -p tsconfig.build.json`、tsdown 通过 | 不代表运行中插件已重载 |
| 真实宿主工具 | 实际 DSH 会话内 `deliver_file` 成功，持久化数据可读 | 未单独执行另一份 ToolRuntime 探针 |
| 真实模型回合 | 已实际生成、读取并调用工具交付 | 不能保证每个模型/预设都会正确调用 |
| 真实 HTTP 下载 | master → coordinator → my-desktop 下载成功且哈希一致 | 不代表浏览器保存交互已通过 |
| 真实 GUI | 未完成：Chrome 显示 Web 认证页，之后 origin 权限门禁拒绝，用户表示允许后仍报告保存设置/托管策略拒绝 | 无截图，不声称卡片已肉眼可见 |

## 用户可执行的 GUI 验收

1. 在 DSH 中展开 `my-desktop` → 本仓库工作区，打开上述测试会话。若会话列表未更新，点击节点刷新。测试会话首条消息以“这是 DSH 远程文件交付验收”开头。
2. 查找输入框上方的“本次会话的交付文件”，应有 `artifact-acceptance.md` 及“保存到本地”。点击后用浏览器原生下载保存。
3. 校验下载大小为 56 字节，两行为 `# 文件交付验收` 和 `DSH artifact acceptance 2026-10-30`；可用 `Get-FileHash -Algorithm SHA256 <下载路径>` 对照上表。刷新或重新打开会话后应仍有同一张卡片。
4. 本次代码由用户安排重新加载后，打开一个无产物的会话，应该看到交付说明。直接发送“请生成并交付一个可下载的文件”测试，无需先上传附件。节点缺工具时应显示检查/升级提示。

若原会话仍无卡片，需要该会话的节点名及会话 ID，继续比较工具事件、该会话 `listArtifacts`、前端请求及可见区域。当前没有证据可以将原问题归因于用户操作。
