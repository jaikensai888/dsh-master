import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutlineRegular,
  IconRefreshOutlineRegular,
  IconTriangleRightFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MasterNode } from '../protocol.js'
import type { WorkspaceBrowseScope } from './stores.js'
import { nodeChoices, browseNavigationKey } from './browse-scope.js'
import { RemoteSectionCss as css } from './styles.generated.js'

interface Props {
  nodes: readonly MasterNode[]
  scope: WorkspaceBrowseScope
  onChange: (scope: WorkspaceBrowseScope) => void
  busy: boolean
  error: string | undefined
  t: (key: string, params?: Record<string, unknown>) => string
  onRefresh: () => void
  currentNodeId?: string | undefined
  rail?: boolean | undefined
  onExpand?: (() => void) | undefined
  requestOpen?: boolean | undefined
  onOpened?: (() => void) | undefined
}

/**
 * The popover width, mirrored from `.chooserPopup` in RemoteSection.module.css.
 *
 * The horizontal clamp has to use the width the popover actually renders at, so the
 * two must change together: `min(400px, 100vw - 16px)` on both sides.
 */
const CHOOSER_WIDTH = 400
/** Keep the popover this far from either viewport edge, matching the CSS `100vw - 16px` cap. */
const VIEWPORT_GUTTER = 8

/** Shares the roster with RemoteSection; browsing never invokes session navigation. */
export function WorkspaceNodeChooser({ nodes, scope, onChange, busy, error, t, onRefresh, currentNodeId, rail, onExpand, requestOpen, onOpened }: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (requestOpen && !rail) { setOpen(true); setQuery(''); onOpened?.() }
  }, [requestOpen, rail, onOpened])
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 360 })
  const name = scope.kind === 'local' ? t('browse.local')
    : nodes.find(n => n.nodeId === scope.nodeId)?.nodeName ?? scope.nodeId
  const status = (n: MasterNode) => t(n.revoked ? 'browse.revoked' : n.state === 'ready' ? 'browse.online' : n.state === 'offline' ? 'browse.offline' : 'browse.connecting')
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(CHOOSER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2)
      const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 180))
      setPosition({ top, left: Math.max(VIEWPORT_GUTTER, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GUTTER)), maxHeight: Math.max(140, Math.min(400, window.innerHeight - top - 12)) })
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    place(); input.current?.focus()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  const choose = (next: WorkspaceBrowseScope) => { onChange(next); close() }
  return <>
    <button ref={trigger} type="button" className={css.chooserTrigger} aria-label={t('browse.choose')}
      aria-haspopup="dialog" aria-expanded={open} title={`${t('browse.choose')} · ${name}`}
      onClick={() => { if (rail) { onExpand?.(); return }; setQuery(''); setOpen(!open) }}>
      <IconTriangleRightFillRegular className={css.chooserArrow} />
    </button>
    {open && createPortal(<div ref={popup} className={css.chooserPopup} role="dialog" aria-label={t('browse.choose')}
      style={position} onKeyDown={event => {
        if (!browseNavigationKey(event.nativeEvent)) return
        if (event.key === 'Escape') { event.preventDefault(); close() }
        if (event.key === 'Tab') { setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const buttons = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[data-browse-option]') ?? [])
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }
        if (event.key === 'Enter' && event.target === input.current) popup.current?.querySelector<HTMLButtonElement>('[data-browse-option]')?.click()
      }}>
      <input ref={input} className={css.chooserSearch} value={query} onChange={e => { setQuery(e.target.value) }} placeholder={t('browse.search')} aria-label={t('browse.search')} />
      <div className={css.chooserOptions}>
        {(t('browse.local').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || query.trim() === '') && <button type="button" data-browse-option="" className={`${css.chooserOption} ${css.chooserLocal}`} data-selected={scope.kind === 'local'} aria-pressed={scope.kind === 'local'} onClick={() => { choose({ kind: 'local' }) }}>
          <span className={css.chooserText}>{t('browse.local')}</span>
          <span className={css.chooserTick}>{scope.kind === 'local' && <IconCheckOutlineRegular size={14} />}</span>
        </button>}
        {nodeChoices(nodes, query).map(n => <button key={n.nodeId} type="button" data-browse-option="" className={`${css.chooserOption} ${css.chooserRemote}`}
          data-selected={scope.kind === 'remote' && scope.nodeId === n.nodeId}
          aria-pressed={scope.kind === 'remote' && scope.nodeId === n.nodeId}
          title={`${n.nodeName ?? n.nodeId} · ${n.nodeId} · ${status(n)}`} onClick={() => { choose({ kind: 'remote', nodeId: n.nodeId }) }}>
          <span className={css.chooserText}>
            <span className={css.chooserName}>{n.nodeName ?? n.nodeId}</span>
            <span className={css.chooserMeta}><span>{status(n)}</span><span aria-hidden="true">·</span><span className={css.chooserId}>{n.nodeId}</span></span>
          </span>
          {currentNodeId === n.nodeId && <span className={css.chooserTag}>{t('browse.currentSession')}</span>}
          <span className={css.chooserTick}>{scope.kind === 'remote' && scope.nodeId === n.nodeId && <IconCheckOutlineRegular size={14} />}</span>
        </button>)}
      </div>
      {busy && <div role="status" className={css.message}>{t('remote.loading')}</div>}
      {error && <div role="alert" className={css.message}>{error}</div>}
      <div className={css.chooserFooter}>
        <button type="button" className={css.chooserRefresh} disabled={busy} onClick={onRefresh}>
          <IconRefreshOutlineRegular className={css.chooserRefreshIcon} size={13} />
          <span>{t('remote.refresh')}</span>
        </button>
      </div>
    </div>, document.body)}
  </>
}
