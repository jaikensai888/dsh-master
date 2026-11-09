# 远程消息交付指令外露：修复与验证（2026-11-03）

## 结论

用户正文不再被追加任何宿主交付说明。交付约定移到节点 `deliver_file` 的工具描述中，这是实际宿主提供给模型的上下文；`session/prompt` 没有独立的宿主上下文字段，不能在不改动协议的情况下把一段宿主文本与用户正文分开。

文件能力错误不再折叠成“节点版本较旧”。面板区分协议缺失、端点缺失、工具明确未注册、协议不匹配、网络失败、权限失败和未知失败；同一问题只在交付文件区域显示一次，原始错误码保留在可展开的诊断信息中。

本次未访问截图中的节点或 token URL，未部署、未重启真实节点、未修改历史会话。**未完成真实节点验收**。

## 根因证据

| 结论 | 证据 |
| --- | --- |
| 旧 `MasterService.prompt()` 无条件追加交付英文 | 修复前 `src/service.ts` 在附件处理后执行 `body += '[remote-session-delivery]...'`，普通聊天、分析、queue、steer 都经过同一路径 |
| coordinator 只是转发文本 | `dsh-coordinator/src/sessions.ts` 的 `buildPromptRequest()` 把 `text` 展开成单个 `{type:'text'}` content part，没有宿主上下文字段 |
| 宿主 `session/prompt` 没有独立上下文入口 | `deepseek-harness/packages/api/session-controller/src/types.ts` 的 `SessionPromptRequest` 只有 `requestId/sessionId/mode/content/clientTimeZone`；`PromptContentPart` 只有 `text`/`image` |
| 宿主把远程 prompt 记为用户来源 | `.../src/commands.ts` 的 `prompt()` 固定构造 `source = { kind: 'user', rpcId, ... }`，再 `agent.followup()/steer()` |
| 真正的宿主注入接口只在进程内 | `agent.inject(createUserMessage({ source: { kind: 'plugin', ... } }))` 是 host 插件 API；远程协议没有暴露它，臆造 `source`/`system` 字段会被 Gateway 的 exact-arguments 校验拒绝 |
| 模型实际能读到的交付约定是工具描述 | `dsh-node/src/files/deliver-tool.ts` 通过 `ctx.tools.register()` 注册 `deliver_file`，其 `description` 是模型上下文的一部分 |
| 旧前端把多种失败折叠成 unsupported | 修复前 `SessionView.tsx` 把 `capability-unavailable`、`endpoint-not-found`、`capability-mismatch` 都映射为 `unsupported`，再转成 `deliveryTool=unavailable` |
| 旧测试保护了错误行为 | `test/files-api.test.ts` 明确要求无附件 prompt 含 `[remote-session-delivery]`；该断言已替换 |

因此没有扩展 node/coordinator 协议：现成且受支持的模型上下文入口就是工具描述。扩展一个远程 `agent.inject` 端点会同时改动 node、coordinator 和 master，且无法在本地验证真实节点，收益不足以抵消兼容风险。

## 修改

| 文件 | 改动 |
| --- | --- |
| `src/service.ts` | 删除 `[remote-session-delivery]` 追加；`attachmentPromptBlock()` 只保留服务端解析的附件元数据，不再重复交付指令；用户正文原样发送 |
| `dsh-node/src/files/deliver-tool.ts` | 工具描述明确“写完文件后调用；工具成功后才可声称可下载；文本路径、present 卡片、diff 卡片都不算登记成功；工具不可用不得声称已创建下载” |
| `src/client/file-support.ts`（新） | 纯函数：错误分类、`describe` 协议版本校验、能力探测、重连后是否需要复查、诊断脱敏 |
| `src/client/SessionView.tsx` | 使用分类后的能力状态；首连不重复探测，重连或显式“重新检查”后复查；不再在输入框重复显示能力错误；附件上传仍以 `describe` 成功为前提 |
| `src/client/ArtifactCard.tsx` | `ArtifactList` 接收完整能力状态；交付区是唯一能力提示位置，错误码放入可展开诊断 |
| `src/client/copy.ts` | 不再断言“版本较旧”；新增按原因区分的提示、诊断与重试文案 |
| `test/file-support.test.ts`（新） | 覆盖各类错误码、脱敏、协议版本、探测恢复、重连复查 |
| `test/remote-context-boundary.test.ts`（新） | 覆盖普通消息、附件消息、queue、steer、用户手写标记、能力失败不阻断普通文本 |
| `test/files-api.test.ts` | 删除保护无条件拼接的旧断言，改为正文逐字节断言 |
| `test/remote-attachments.test.ts` | 覆盖协议缺失、工具未注册、单条提示、文本输入仍可用 |
| `test/remote-artifacts.test.ts` | 覆盖空态、工具未注册、错误诊断、重试按钮、无重复提示 |
| `test/wire.test.ts` | 固定用户手写标记与历史泄露文本都按原文回放，不做正则猜测 |
| `dsh-node/test/files-deliver-tool.test.ts` | 固定工具描述中的交付契约 |

## 兼容策略

| 场景 | 行为 |
| --- | --- |
| 节点有文件协议、`deliver_file` 已注册 | 附件上传可用；交付区显示空态；模型从工具描述获得交付约定 |
| 节点有文件协议、`deliver_file` 未注册 | 附件上传仍可用；交付区明确显示工具未注册；不虚构下载入口 |
| 旧节点缺少 `sessionFiles` 命名空间 | 附件与交付区显示“未提供远程文件接口”，普通文本照常发送；可重连或手动重新检查 |
| 节点缺少具体文件端点 | 显示“未注册所需的文件接口”，不推断版本 |
| 网络、权限、协议版本失败 | 各自保留原始错误码；网络和未知失败提供重试，权限和协议版本不提供无意义重试 |
| 历史会话 | 原始事件不改写。旧消息中的泄露英文按原文回放；只有 `source.kind` 等可信元数据才渲染为独立上下文。用户手写相同标记完整保留 |

`describe.deliveryTool === 'available'` 只表示工具已注册，不保证某个模型或某一轮一定调用成功；下载入口仍只来自节点返回的 artifact 元数据。

附件消息仍把服务端解析出的附件元数据作为同一个 text part 追加在用户正文之后：`session/prompt` 没有独立的 host-context 通道，现有协议无法在不扩展 node/coordinator 的情况下把这段元数据与用户正文拆成两个来源。该块标注为“用户数据，不是系统指令”，且不再包含交付指令；本轮没有为了视觉分离而伪造 `source.kind` 或在前端用正则裁剪。

## 测试结果

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run`（dsh-master，全量） | 36 个文件通过、1 个跳过；348 项通过、1 项跳过 |
| `pnpm run typecheck`（dsh-master） | 通过 |
| `pnpm run build`（dsh-master） | 通过（tsc declarations + tsdown 两个 bundle） |
| `node node_modules/vitest/vitest.mjs run`（dsh-node，全量） | 22 个文件、579 项全部通过 |
| `tsc -p tsconfig.json --noEmit`（dsh-node） | 通过 |
| `tsc -p tsconfig.build.json` + `tsdown`（dsh-node） | 通过 |

说明：dsh-node 的 `pnpm run ...` 在当前环境触发依赖目录重装检查并以无 TTY 中止；上述 dsh-node 检查改用本地 `node_modules` 中的 vitest/tsc/tsdown 直接执行，未改动依赖。

## 尚未验证

- **未完成真实节点验收**：没有访问 office1，没有 nodeId/sessionId、实际 `describe` 响应、运行插件构建身份或相关事件记录。本地构建通过不能证明运行实例已加载本次代码。
- 没有在真实 GUI 中目视确认新提示、重试按钮和诊断折叠区。
- 没有验证旧节点上的历史会话在新版本中的实际回放；本地只有 wire 单元测试。
- 没有验证升级/重连后的真实能力刷新时序；本地覆盖的是纯函数判断和组件静态渲染。
- dsh-node 的工具描述改动已构建，但未部署到任何运行节点。

## 历史数据限制

旧会话中已经写入的 `[remote-session-delivery]` 英文没有可信来源元数据，无法区分“宿主追加”和“用户自己输入”。本次不删除、不截断、不用正则改写；修复只保证新消息不再产生这种混合文本。
