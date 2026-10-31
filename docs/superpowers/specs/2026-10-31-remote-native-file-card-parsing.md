# 远程原生文件卡片：解析链路修正

日期：2026-10-31。替代此前将需求限定为交付产物列表美化的设计。本文为只读源码调查与开发交接，没有实现产品代码。

## 用户澄清

本地工作区已经能正常识别并显示文件卡片，远程会话需要补齐相应数据识别与样式。应先复用本地规则，不能要求远程 Agent 为显示卡片另行调用 `deliver_file`。视觉沿用 `2026-10-31-remote-delivery-summary-card-reference.png` 的紧凑汇总容器。打开、预览与编辑仍不在本期。

## 已确认的源码事实

当前旁边的 `deepseek-harness` 源码提供以下规则；它不证明运行中的安装版本或特定远程节点完全相同。开发时要核对实际版本与脱敏事件样本，不得把派生展示模型冒充原始 wire 字段。

| 层 | 源码位置 | 事实 |
| --- | --- | --- |
| 原始调用事件 | `../deepseek-harness/packages/core/session/src/types.ts` | `tool/call.data` 有 `turn`、`step`、`callId`、`name`、`arguments`；arguments 是 JSON 字符串 |
| 原始结果事件 | 同上 | `tool/result.data` 有 `turn`、`step`、`message`、可选 `error` 和 `meta`；结果关联可来自 `message.source.callId` |
| 文件工具生产 | `../deepseek-harness/packages/fs/tool-fs/src/write.ts` 与 `edit.ts` | 写入/编辑工具通过 `output.presentationMeta` 生产 `meta.diffs`，并通过 presenter 生产 `card: 'diff'` 展示视图 |
| 原生 UI 识别 | `../deepseek-harness/packages/client/ui-tool/src/client/tool/models/diff-card-model.ts` | 从工具名、参数、状态和 `meta.diffs` 推导差异卡片；不是扫描回复中的“文件”字样 |
| 远程降维处 | `src/client/wire.ts` | `tool/call` 仅保留 name 和最多 800 字符参数摘要；`tool/result` 仅保留最多 4000 字符输出文本及 failed，未保留 meta.diffs |
| 远程绘制处 | `src/client/SessionView.tsx` | 工具事件统一渲染为可展开的通用输入/输出行，没有相应原生文件差异卡片分支 |

因此已经确认一个前端结构化数据丢失缺口；尚未采集用户所指真实会话，也尚未证明上游全链路一定保留 meta。

## 应识别什么

下面是字段示意，省略了其他真实消息字段，不是完整可直接重放的 fixture：

```json
{
  "type": "tool/call",
  "data": {
    "turn": 3,
    "step": 1,
    "callId": "call-example",
    "name": "edit",
    "arguments": "{\"file_path\":\"src/example.ts\",\"old_string\":\"old\",\"new_string\":\"new\"}"
  }
}
```

```json
{
  "type": "tool/result",
  "data": {
    "turn": 3,
    "step": 1,
    "message": { "source": { "callId": "call-example" }, "isError": false },
    "meta": {
      "diffs": [{ "path": "src/example.ts", "oldText": "old", "newText": "new" }]
    }
  }
}
```

关键判断顺序：

1. 识别可信结构化工具事件，通过会话身份与 callId 关联调用和结果；turn/step 提供时序上下文。
2. 对 `write`/`edit` 等受支持工具验证原始参数；保留原文用于解析，显示摘要截断后不能再用作解析输入。
3. 验证结果状态及 `data.meta.diffs`：数组中每项的 path 为 string、oldText 为 string 或 null、newText 为 string。
4. 使用本地 `diffCardModel` 同等规则，区分运行中的意图与完成后的实际修改。失败工具不能计入“已编辑”。完成 edit 缺少合法实际 diffs 时不能把调用参数猜成成功修改。
5. 本地源码另有 write 创建/相同覆盖时的参数回退，以及 `str_replace_editor` 特定命令的运行态规则；按实际版本对齐，禁止只见名称就认定成功。
6. 若上游确实提供已计算的展示视图，可验证后复用 `card: 'diff'`；该字段由 presenter 生成，不应假定所有原始 `tool/result` 都直接携带它。
7. 非文件工具、非法参数、缺失信息退回现有通用工具行，不静默丢事件。

这些 diff 事件足以识别文件路径、修改意图及实际差异，不会自动获得文件大小、下载身份或到期时间。不能把 diff 路径当作可用下载链接。下载产物仍由已有 `deliver_file` → `listArtifacts` 链路管理，不得与差异卡片混淆。

## 接手 Agent 的执行顺序

先定位用户所指本地卡片的实际组件与聚合模型，再决定远程如何复用；目前找到的 diff 模型是确认的识别基础，不宣称已查明截图中“已编辑 6 个文件”汇总组件的完整算法。

- 检查 snapshot 历史与 live event 两条路径，在安全可读且已授权的脱敏样本中检查上述字段；不读凭证，不向真实远程会话发送提示。
- 追踪 node → coordinator → master 的转发与序列化，先证明缺失发生在哪一层。不要因为当前前端丢弃字段就断言后端完全正确。
- 保留用于卡片的结构化字段，优先在 `wire.ts` 建立防御性纯解析，原始内容与截断展示文本分开；渲染层选择对应卡片。
- 按已定位的本地聚合规则组织紧凑列表。若本地并无汇总算法，应提出聚合范围、同文件重复修改、增删行统计的具体方案供用户确认，不擅自按整个会话相加或挂到最后一条回复。
- 无需要求 `deliver_file` 才显示文件修改卡片。保持原有下载产物区域功能；本期不虚构下载入口，不接入本机打开。
- 不动其他 Agent 正在修改的节点选择器、会话新建与归档；保留用户已有改动，不扩展三仓库协议，除非已经证明必需并另行确认。

## 验收重点

- 真实结构化 write/edit 事件可触发对应卡片；普通 Markdown 文件表格、仅提到路径不能误触发。
- callId 正确配对，不同会话/回合不串数据；历史重放与实时事件行为一致，重复事件不重复累计。
- 长参数超过 800 字符仍可解析；合法 meta.diffs 不被文本提取丢弃。
- 运行意图不冒充已完成；error、isError、非法/缺失 meta 正确回退；同一文件多次修改对齐本地规则。
- 参考图紧凑样式、展开/收起、窄屏、键盘可访问性通过实际检查。
- 现有下载产物链路、空态、失败提示不回归。
- 在实际 package.json 基础上执行必要的 wire/消息渲染/产物回归测试、typecheck、完整测试和 build；当前文档阶段不运行产品验证。
