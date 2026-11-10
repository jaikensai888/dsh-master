import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeConversationTail } from '../src/client/conversation-scroll.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('remote conversation scroll', () => {
  it('follows new content only while at the bottom and can return there explicitly', () => {
    const viewport = Object.assign(new EventTarget(), {
      scrollHeight: 1000,
      clientHeight: 300,
      scrollTop: 0,
      firstElementChild: {},
    })
    let resize = (): void => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe = observe
      disconnect = disconnect
    })

    const onDetached = vi.fn()
    const tail = observeConversationTail(viewport as unknown as HTMLElement, onDetached)
    expect(observe.mock.calls).toEqual([[viewport], [viewport.firstElementChild]])
    expect(viewport.scrollTop).toBe(1000)

    viewport.scrollTop = 400
    viewport.dispatchEvent(new Event('scroll'))
    expect(onDetached).toHaveBeenLastCalledWith(true)
    viewport.scrollHeight = 1200
    resize()
    expect(viewport.scrollTop).toBe(400)

    tail.jump()
    expect(viewport.scrollTop).toBe(1200)
    expect(onDetached).toHaveBeenLastCalledWith(false)
    viewport.scrollHeight = 1400
    resize()
    expect(viewport.scrollTop).toBe(1400)

    tail.dispose()
    expect(disconnect).toHaveBeenCalledOnce()
    onDetached.mockClear()
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll'))
    expect(onDetached).not.toHaveBeenCalled()
  })
})
