/** Same preference key, minimum and edge budget as official ConversationWidthControls. */
export function conversationWidth(column: number, stored: string | null): number {
  const preference = stored === null ? NaN : Number(stored)
  if (Number.isFinite(preference) && preference > 0) {
    return Math.min(Math.max(preference, 640), Math.max(640, column - 176))
  }
  return Math.max(680, Math.min(column * .64, 920))
}

/** The remote panel has no local ConversationWidthControls ancestor to publish this axis. */
export function observeConversationWidth(element: HTMLElement): () => void {
  const measure = (): void => {
    let preference: string | null = null
    try { preference = localStorage.getItem('dsh.conversation.contentWidth') } catch { /* Storage can be unavailable. */ }
    element.style.setProperty('--dsh-chat-content-width', `${conversationWidth(element.offsetWidth, preference)}px`)
  }
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  window.addEventListener('storage', measure)
  measure()
  return () => { observer.disconnect(); window.removeEventListener('storage', measure) }
}
