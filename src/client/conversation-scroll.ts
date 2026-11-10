/** Follow the transcript until the reader scrolls away from its tail. */
export function observeConversationTail(viewport: HTMLElement, onDetached: (detached: boolean) => void): {
  jump: () => void
  dispose: () => void
} {
  let detached = false
  const track = (): void => {
    const next = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 24
    if (next === detached) return
    detached = next
    onDetached(detached)
  }
  const jump = (): void => {
    viewport.scrollTop = viewport.scrollHeight
    detached = false
    onDetached(false)
  }
  const observer = new ResizeObserver(() => {
    if (detached) track()
    else viewport.scrollTop = viewport.scrollHeight
  })
  viewport.addEventListener('scroll', track, { passive: true })
  observer.observe(viewport)
  if (viewport.firstElementChild !== null) observer.observe(viewport.firstElementChild)
  jump()

  return {
    jump,
    dispose: () => {
      viewport.removeEventListener('scroll', track)
      observer.disconnect()
    },
  }
}
