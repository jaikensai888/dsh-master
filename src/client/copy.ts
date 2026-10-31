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
  attachmentAdd: '添加附件',
  attachmentLimit: '已达到每条消息的附件上限',
  attachmentList: '已选择的附件',
  attachmentSelected: '等待上传',
  attachmentUploading: '上传中',
  attachmentReady: '已就绪',
  attachmentFailed: '上传失败',
  attachmentRemove: '移除',
  attachmentCancel: '取消',
  attachmentRetry: '重试',
  attachmentUnsupported: '此远程节点版本较旧，不支持文件附件。请升级 dsh-node 后刷新页面。',
  attachmentCheckFailed: '无法读取节点文件能力，附件暂不可用。',
  attachmentRejected: '以下文件未加入',
  attachmentNeedReady: '请等待所有附件上传完成后再发送',
  attachmentUploadDisabled: '发送已被关闭，无法上传附件',
  sendUncertain: '发送结果未确认，请先查看会话后再决定是否重发。',
  confirmPromptRetry: '已检查会话，允许重新发送',
  artifactSection: '本次会话的交付文件',
  artifactEmpty: '尚无交付文件。发送「请生成并交付一个可下载的文件」即可开始。',
  artifactDeliveryUnavailable: '此节点尚未启用文件交付工具，请升级或检查 dsh-node 后重试。',
  artifactDownload: '保存到本地',
  artifactUnavailable: '不可下载',
  artifactExpired: '已过期',
  artifactMissing: '文件已失效',
  artifactExpires: '到期',
  artifactLoadFailed: '读取交付文件失败',
  fileChangeWrite: '写入',
  fileChangeEdit: '编辑',
  fileChangeReplace: '替换',
  fileChangeOversized: '过大',
  fileChangeTruncated: '差异过长，仅显示前 400 行。',
  fileChangesCollapse: '收起',
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
  contextInjection: '上下文注入',
  interrupted: '（已中断）',
  approvalWaiting: '等待授权',
  approvalDecided: '授权结果',
} as const

/**
 * Title of a multi-file change card, matching the shipped client's wording.
 * @param count - distinct files the turn changed.
 * @returns the heading text.
 */
export function fileChangesTitle(count: number): string {
  return `已编辑 ${String(count)} 个文件`
}

/**
 * Title of a single-file change card.
 * @param name - the file's trailing path segment.
 * @returns the heading text.
 */
export function fileChangeEdited(name: string): string {
  return `已编辑 ${name}`
}

/**
 * Expand toggle copy for a folded file list.
 * @param count - distinct files the turn changed.
 * @returns the button text.
 */
export function fileChangeAll(count: number): string {
  return `全部 ${String(count)} 个文件`
}

/**
 * Accessible label for the expand toggle when the list is folded.
 * @param count - distinct files the turn changed.
 * @returns the aria-label.
 */
export function fileChangeExpandAria(count: number): string {
  return `展开全部 ${String(count)} 个改动文件`
}

/** Accessible label for the expand toggle once the whole list is visible. */
export const FILE_CHANGE_COLLAPSE_ARIA = '收起改动文件列表'

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

/**
 * Format a byte count with binary units.
 *
 * The node advertises bytes, and 20 MiB is a binary limit; showing decimal MB
 * would make a file that is accepted look over the limit.
 * @param bytes - non-negative byte count.
 * @returns a short human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${String(Math.round(bytes))} B`
  const units = ['KiB', 'MiB', 'GiB'] as const
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`
}

/**
 * Format an ISO timestamp in the browser's local time.
 * @param iso - ISO-8601 string from node metadata.
 * @returns `YYYY-MM-DD HH:mm`, or the input when it is not a valid date.
 */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return iso
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
