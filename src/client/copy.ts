/**
 * Every user-facing string and label map this plugin renders.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` cannot read the application locale — each
 * primitive takes its copy as props — so the label objects live here rather than
 * inline at the call sites. The markdown map is deliberately the **complete**
 * interface (`{ code: { copyLabel, copiedLabel }, footnotes }`), which is what the
 * official chat builds in `markdownLabels(t)`; a missing key there renders
 * `undefined` inside a code fence header rather than failing loudly.
 *
 * @module dsh-master/client/copy
 */

/** Complete label map for `MarkdownText` and the `CodeBlock` it renders inside fences. */
export const MARKDOWN_LABELS = {
  code: {
    copyLabel: '复制',
    copiedLabel: '已复制',
  },
  footnotes: '脚注',
} as const

/** Panel copy. */
export const COPY = {
  pickSomething: '从左侧远程工作区选择一个会话。',
  emptyConversation: '这个会话还没有可显示的消息。',
  loadOlderPending: '前面还有更早的消息，本版本尚未实现向上翻页。',
  connecting: '连接中…',
  live: '已连接',
  ended: '流已结束',
  failed: '失败',
  streaming: '输出中…',
  composerPlaceholder: '发给这个远程会话…',
  composerDisabled: '发送已被配置关闭（allowPrompt: false）',
  send: '发送',
  sending: '发送中…',
  queue: '排队',
  steer: '插话',
  sendHint: '⌘/Ctrl + Enter 发送',
  attachmentUnavailable: '附件（暂不支持远程会话）',
  permissionUnavailable: '权限（暂不支持远程会话）',
  modelUnavailable: '模型（暂不支持远程会话）',
  questionHeading: '需要你回答',
  questionCustom: '自定义回答（可选）',
  questionSubmit: '提交答案',
  questionPager: '问题进度',
  questionPrevious: '上一题',
  questionNext: '下一题',
  questionSkip: '跳过',
  questionCancel: '取消',
  questionRequired: '请回答所有问题后再提交。',
  questionSubmitting: '正在提交…',
  questionCompatibility: '此远程节点版本较旧，不支持远程问题回答。请更新 dsh-node 后重试。',
  questionLoadFailed: '读取远程问题失败',
  unavailableShort: '暂不可用',
  roleUser: '你',
  roleAssistant: '助手',
  roleToolCall: '工具调用',
  roleToolResult: '工具结果',
  toolInput: '输入',
  toolOutput: '输出',
  toolRunning: '运行中…',
  roleNotice: '事件',
  interrupted: '（已中断）',
  approvalWaiting: '等待授权',
  approvalDecided: '授权结果',
} as const

/**
 * Render an age as a short Chinese phrase.
 *
 * Written here rather than taken from the primitives' `relativeTime`, whose
 * formatter contract is not published in the installed package (there are no
 * `.d.ts`). A wrong call would render `undefined` in the row, so the skeleton
 * carries its own four-line version until the contract can be read.
 *
 * @param time - epoch milliseconds, as the node reports it.
 * @param now - current epoch milliseconds.
 * @returns a phrase such as `3 分钟前`.
 */
export function timeAgo(time: number, now: number): string {
  if (!Number.isFinite(time) || time <= 0) return ''
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  return `${String(Math.round(hours / 24))} 天前`
}
