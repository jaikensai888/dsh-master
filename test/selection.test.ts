import { afterEach, describe, expect, it } from 'vitest'
import {
  getRemoteSelection,
  openLocalSession,
  openRemoteSession,
  setRemoteSelection,
  subscribeRemoteSelection,
} from '../src/client/selection.js'

afterEach(() => { setRemoteSelection(undefined) })

describe('remote session selection', () => {
  it('returns to the conversation panel before opening a local session', () => {
    const events: string[] = []
    const layout = { selectPanel: (id: string) => { events.push(`panel:${id}`) } }
    const sessions = { open: (sessionId: string) => { events.push(`open:${sessionId}`) } }
    setRemoteSelection({ nodeId: 'node-1', sessionId: 'remote-1' })

    openLocalSession(layout, sessions, 'local-1')

    expect(events).toEqual(['panel:conversation', 'open:local-1'])
    expect(getRemoteSelection()).toBeUndefined()
  })

  it('opens the dsh-master panel before publishing the selected session', () => {
    const events: string[] = []
    const stop = subscribeRemoteSelection(() => {
      const selection = getRemoteSelection()
      events.push(selection === undefined ? 'empty' : `${selection.nodeId}/${selection.sessionId}`)
    })
    const layout = { selectPanel: (id: string) => { events.push(`panel:${id}`) } }

    openRemoteSession(layout, 'node-1', 'session-1', 'my-desktop', '插件设计')

    expect(events).toEqual(['panel:dsh-master', 'node-1/session-1'])
    expect(getRemoteSelection()).toEqual({
      nodeId: 'node-1',
      sessionId: 'session-1',
      nodeName: 'my-desktop',
      sessionTitle: '插件设计',
    })
    stop()
  })

  it('does not notify subscribers when the selected identity did not change', () => {
    const listener = (): void => { throw new Error('unchanged selection notified') }
    setRemoteSelection({ nodeId: 'node-1', sessionId: 'session-1' })
    const stop = subscribeRemoteSelection(listener)

    setRemoteSelection({ nodeId: 'node-1', sessionId: 'session-1' })

    expect(getRemoteSelection()).toEqual({ nodeId: 'node-1', sessionId: 'session-1' })
    stop()
  })

  it('updates display labels when the selected session identity stays the same', () => {
    let notifications = 0
    setRemoteSelection({ nodeId: 'node-1', sessionId: 'session-1', nodeName: 'old-name' })
    const stop = subscribeRemoteSelection(() => { notifications += 1 })

    setRemoteSelection({ nodeId: 'node-1', sessionId: 'session-1', nodeName: 'new-name' })

    expect(notifications).toBe(1)
    expect(getRemoteSelection()?.nodeName).toBe('new-name')
    stop()
  })
})
