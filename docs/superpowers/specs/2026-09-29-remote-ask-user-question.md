# 远程会话中的 ask_user_question

## 目标

在 `dsh-master` 打开的远程会话里，正确呈现远程 Agent 发出的 `ask_user_question`，并把用户选择作为结构化答案交回原始等待中的调用。不能把答案伪装成新 prompt，也不修改 DSH 核心源码或 `dsh-coordinator`。

## 根因

`ask_user_question` 调用 `ctx.userQuestions.ask()`，通过 `user-questions/request` waterfall 等待 answerer 返回 `{ answers: [...] }`。`dsh-node` 当前只代理 Typert unary/stream Remotes，不转发这个 Cordis 交互事件。因此 `dsh-master` 的 session follow 只能显示工具调用记录，不能弹出问题表单，也没有完成该 Promise 的回答通道。

## 方案

1. `dsh-node` 增加一个远程问题 answerer：先把请求交给现有 answerer（`next()`）；只有以 `NO_PROVIDER` 结束时，才将问题挂到远程待答队列。队列记录随机 request ID、Agent/session ID、问题字段及取消信号；不传输 Agent 对象或 AbortSignal。
2. `dsh-node` 通过现有 Typert 注册机制暴露 `nodeQuestions/pending`、`nodeQuestions/answer`、`nodeQuestions/cancel` 三个窄接口。查询按 session ID 过滤；回答和取消按 request ID 一次性结算；请求取消或插件卸载时清理并拒绝等待项。
3. `dsh-master` 复用 coordinator 已有的 `/api/invoke`，增加自己的只读查询与 answer/cancel API。Coordinator 无需新增 endpoint 或协议。
4. 远程会话收到尚未完成的 `ask_user_question` 工具调用时，才轮询该 session 的 pending questions；会话切换或组件卸载立即停止请求。旧版 node 不支持新接口时，显示兼容性提示，不阻塞普通会话功能。
5. 在远程会话面板内显示 DSH 风格的问题表单：问题标题/说明、单选、多选、自定义文字、多个问题和取消；提交 `{ answers: [{ id, selected, custom? }] }`。问题保持在原 session 中，工具完成后由现有 follow 流更新记录。

## 生命周期与兼容性

- 只允许已认证 coordinator 调用 `nodeQuestions/*`；查询仅返回指定 session 的问题。
- Answer、cancel、AbortSignal 和插件卸载竞争时只允许一个终态生效；失效 request ID 返回明确错误。
- 远程节点未升级时，问题请求仍按原 DSH 行为报错；master 显示节点不支持提示，不合成答案、不发送新 prompt。
- 仅覆盖绑定到 live Agent/session 的交互；不支持没有 Agent/session 身份的全局提问。

## 验收

- 远程 `ask_user_question` 能在对应会话弹出问题表单；切换到其他 session 不串题。
- 单选、多选、自定义回答和多个问题均返回原始问题 ID 对应的结构化 answer；工具结果随后出现在会话记录中。
- 用户取消、Agent abort、节点插件卸载均会结算待答项并释放资源；重复 answer/cancel 不会二次结算。
- 本地 workspace/session、普通远程 prompt、工具调用渲染不受影响。
- `dsh-node` 与 `dsh-master` 各自测试与类型检查通过；不修改 DSH 核心和 coordinator。

## 明确不做

- 不把选择写成 `session/steer` 或普通文本消息。
- 不新增 coordinator 专用 API、持久化存储、跨节点广播或离线队列。
- 不改动本地会话提问 UI。
