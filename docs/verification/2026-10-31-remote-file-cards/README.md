# 远程原生文件卡片：实现与验证记录

日期：2026-10-31（Asia/Shanghai）。范围：`write` / `edit` 文件修改卡片；不提交、不部署、不重启服务、不向真实远程会话发送 prompt。

## 1. 结论

- 远程链路**并不缺数据**：真实快照里 `tool/result.data.meta` 带有 `path` / `diffs`，node → coordinator → master 三段都原样转发；丢失发生在 `dsh-master` 的 `src/client/wire.ts`（只保留工具名、800 字参数摘要和 4000 字输出文本）。
- 已按安装版 `dsh-client-ui-tool` 的 `diffCardModel` 规则补齐解析，并新增调用级差异卡与回合汇总卡；未像旧设计那样要求 `deliver_file`，也没有把差异路径当成下载 ID。
- 截图中「已编辑 N 个文件」卡片的本地数据源是 `workspace/changes`（Host 侧 git 快照 + 捕获，浏览器再调 Host 路由取汇总），**该汇总不在远程 wire 上**：远程 `workspace/changes` 事件只带 `turn`。本期只能用 `meta.diffs` 自行聚合，聚合口径见 §4，其中「同文件多次修改」与「增删行口径」是按可证实数据选定的实现默认值，**仍需用户确认**。
- 未完成：真实远程 GUI 点击验收（运行中的 GUI 需要浏览器会话认证，直接请求返回 403）；本轮没有新的真实远程会话样本，字段证据来自 2026-10-30 的脱敏快照调查。

## 2. 字段证据

| 层 | 位置（版本） | 事实 |
| --- | --- | --- |
| 会话事件 | 安装版 `@deepseek-ai/dsh-session@0.2.1-rc.2`（`lib` 打包） | `tool/call.data = {turn, step, callId, name, arguments}`；`arguments` 是原始 JSON 字符串 |
| 结果事件 | 同上 | `tool/result.data = {turn, step, message, error?, meta?}`；`message.source.callId` + `message.toolCallId` 关联调用；`message.isError` 是失败标记 |
| 文件工具生产 | 安装版 `@deepseek-ai/dsh-tool-fs@0.2.1-rc.2` | `write` 的 `presentationMeta` = `{operation, path, diffs}`，`edit` = `{path, diffs}`；`diffs` 每项 `{path, oldText, newText}`，`path` 是后端解析后的**绝对路径** |
| node 转发 | `dsh-node/src/stream-manager.ts:382` `pumpOne()` | 把原始 `value` 放进 `stream.data`，只在超帧大小时报错，不按类型裁剪 |
| coordinator 转发 | `dsh-coordinator/src/http-api.ts:845` 起 | 逐值写 `{type:'data', value}`，无字段过滤 |
| master 服务 | `src/coordinator/client.ts` `follow()` + `src/http-api.ts` `streamFollow()` | 同上，`value` 原样透传 |
| master 解析（改动前） | `src/client/wire.ts` `rowOf()` | 只保留 name / 800 字参数 / 4000 字输出 / failed；**丢弃 `meta`** |
| 真实快照旁证 | `docs/reviews/message-card-gap/2026-10-30/evidence/live-snapshot-summary.json` | 5 个会话中 `tool/result` 实际 keys 含 `meta`，`meta` 键集含 `["path","diffs"]`、`["operation","path","diffs"]`；`wire-replay-summary.json` 的 `metaKeySets` 也记录到这两组 |

字段示意（脱敏、非可直接重放的 fixture）：

```json
{ "type": "tool/result",
  "data": { "turn": 3, "step": 1,
    "message": { "role": "tool", "source": { "kind": "tool", "callId": "call-example" }, "isError": false, "content": [{ "type": "text", "text": "…" }] },
    "meta": { "path": "C:\\work\\src\\example.ts",
              "diffs": [{ "path": "C:\\work\\src\\example.ts", "oldText": "a\nold\nb", "newText": "a\nnew\nb" }] } } }
```

安装版与旁边 checkout `deepseek-harness@0.1.2-rc.1` 的两处差异已按安装版对齐：`presentationMeta` 用后端绝对路径；`diffCardModel` 不再校验 escalation 字段，且会把 `meta.path` 映射回调用参数里的 `file_path`。

## 3. 本地识别规则（安装版 `dsh-client-ui-tool`）

- 只对 `write` / `edit` / `str_replace_editor` 产出差异；`parentCallId` 非空的子调用直接走通用行。
- 运行中：`write` 用 `content`、`edit` 用 `old_string || null` / `new_string`、`str_replace_editor` 仅 `create` / `str_replace`。
- 已结束：`isError` 直接放弃差异卡；合法非空 `meta.diffs` 覆盖意图；`write` 在 `diffs` 缺失或为空时回退到参数整文件差异；`edit` 无合法 hunks 时退回通用行；`str_replace_editor` 结束后一律走通用行。
- 参数的 JSON 解析失败、`file_path` 为空、hunk 非法 → 不产卡，不静默丢事件。

## 4. 聚合口径（实现默认值，待确认）

| 项 | 本期实现 | 依据 / 代价 |
| --- | --- | --- |
| 范围 | 单个回合（与本地汇总卡一致） | 本地 `workspace/changes` 按回合记录；不跨回合相加、不挂到最后一条回复 |
| 计入条件 | 只有 `applied` 且结果非 error | 运行意图与失败调用不算修改 |
| 同文件多次修改 | 路径去重为一行，行数**累加** | 本地能用回合起始快照算净结果；只有 diffs 时无法净算，累加是唯一可证实算法 |
| 增删行 | 去掉 hunk 共同前后缀后做行级 LCS，报净增删 | 直接按两侧内容行计数会把 3 行上下文算进去（1 行改动显示 +4 -4）；本地汇总卡也是净增删口径 |
| 超大头 | 行数比较超过 25 万格时标 `过大`、不给数字 | 与本地 `oversized` 处理一致：宁可不给数字，不编造 |
| 文件数 | 去重后的路径数 | 标题 `已编辑 N 个文件`；单文件用 `已编辑 <文件名>`，与本地一致 |

这些规则被抽成纯函数 `turnChanges()`，输入是同一回合的 `FileChange[]`，因此重复事件、快照重放都不会重复累计。

## 5. 修改文件

| 文件 | 变更 |
| --- | --- |
| `src/client/file-changes.ts` | 新增：`meta.diffs` 校验、参数意图解析、结束态结算、净增删计算、回合汇总、路径显示（纯函数） |
| `src/client/wire.ts` | `ConversationRow` 增加 `change` / `resultDiffs`；从**原始** `arguments` 解析意图；保留 `meta.diffs` 到结果行；`mergeRows` 增加结算与重复事件保护；`TurnGroup.changes` 由 `turnChanges()` 生成 |
| `src/client/FileChangeCard.tsx` | 新增：调用级差异卡（原生 `<details>`，运行/完成状态、`+a -d`、`过大`）与回合汇总卡（图标块、`已编辑 N 个文件`、4 行折叠、`全部 N 个文件` 按钮、`aria-expanded` / `aria-controls`） |
| `src/client/SessionView.tsx` | 文件工具行改用差异卡；回合汇总卡渲染在答复之后；把 `cwd` 传给卡片用于缩短绝对路径 |
| `src/client/copy.ts` | 卡片文案与 `已编辑 …` 格式化函数 |
| `src/client/styles.ts` | 卡片样式（全部使用 `--dsw-*` token）、窄屏规则；导出 `PANEL_CSS` 供预览 harness 使用 |
| `test/file-changes.test.ts` | 新增 22 项：解析、配对、重放、失败、缺失/非法/空 diffs、长参数、跨回合、同文件累加、超大头、静态渲染 |
| `test/turn-view.test.ts` | 新增 2 项：汇总卡在答复之后且调用卡在过程折叠内、运行中的回合不出汇总卡 |
| `README.md` / `PLAN.md` / `docs/log.md` | 能力状态与记录更新 |

未改动：`ArtifactCard` / `listArtifacts` / 下载链路、节点选择器、会话创建与归档、node/coordinator 协议、凭证相关代码。

## 6. 验证

| 检查 | 结果 |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | 通过（exit 0） |
| `vitest run`（全量） | 34 个文件通过 / 1 个跳过（`installed-runtime`），290 项通过 / 1 项跳过 |
| `tsc -p tsconfig.build.json` | 通过（exit 0） |
| `tsdown` | 通过：`lib/index.js` 89.87 kB、`lib/client.js` 368.20 kB |
| 构建后重跑全量测试 | 同上，全部通过 |
| 原有产物 / 附件 / 提问 / 工作区测试 | 全部通过，未回归 |

覆盖点：snapshot 与 live 一致、`callId` 配对（含结果先到）、重复事件不翻倍、>800 字参数仍可解析、合法/缺失/非法/空 `diffs`、失败调用、跨回合隔离、同文件多次修改、超大头、单文件/多文件/折叠渲染。

## 7. 视觉证据（模拟）

`docs/verification/2026-10-31-remote-file-cards/` 下的截图由 `.tmp/preview/`（未入库）用**真实组件 + 真实 `PANEL_CSS` + 安装版主题 token** 静态渲染，**事件数据是手写模拟**，不是真实远程会话截图：

| 文件 | 内容 |
| --- | --- |
| `dark-overview.png` | 深色全览：6 文件汇总（折叠）、单文件汇总、运行中意图卡、已应用 edit 卡 |
| `dark-summary-collapsed.png` / `dark-summary-expanded.png` | 4 行折叠 / 点击后展开为 6 行并为「收起」（点击由真实按钮触发） |
| `dark-calls-open.png` / `dark-calls-collapsed.png` | 调用级卡片展开（`-` / `+` 行）与收起 |
| `light-summary.png` / `light-calls-open.png` | 浅色主题可读性 |
| `narrow-summary.png` | 390px 容器宽度：路径省略、计数列不被挤出、无横向滚动 |

键盘可访问性依赖原生 `<details>/<summary>` 与真实 `<button>`，测试断言了 `aria-expanded="false"` 与 `aria-controls`；**没有在真实 GUI 中做点击/键盘验收**（见 §8）。

## 8. 未完成与限制

- **真实远程 GUI 验收未做**：对 `http://127.0.0.1:43120/dsh-master/api/status` 的只读请求返回 403（运行实例要求浏览器会话认证）；没有读取或使用任何凭证，也没有通过别的通道绕过。
- **本轮没有新的真实远程样本**：字段证据来自 2026-10-30 的脱敏快照；部署中的 node/coordinator 磁盘版本也没有逐文件核对 SHA，只能依据真实末端快照证明这些字段已穿过链路。
- **聚合口径待确认**：§4 的两项默认值（同文件累加、净增删）是为推进实现选定的；若要求与本地 `workspace/changes` 完全一致（净结果、`binary`/`oversized` 语义），需要新的 node 能力或协议，不在本期范围。
- `str_replace_editor` 只在运行中显示意图，结束后回到通用工具行，与安装版一致。
- 未接打开 / 预览 / 编辑；差异路径不被当成下载入口，产物下载仍走原 `deliver_file` → `listArtifacts` 链路。
