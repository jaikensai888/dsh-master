import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutlineRegular,
  IconFolderCloseRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTriangleRightFillRegular,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MasterNode } from '../protocol.js'
import type { WorkspaceBrowseScope } from './stores.js'
import {
  browseNavigationKey,
  browseScopeName,
  chooserPlacement,
  nodeChoices,
  nodeDisplayName,
} from './browse-scope.js'
import { FollowPin } from './follow-pin.js'
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
  const [position, setPosition] = useState<ReturnType<typeof chooserPlacement>>()
  const name = browseScopeName(nodes, scope, t('browse.localWorkspace'), t('browse.following'))
  const term = query.trim().toLocaleLowerCase()
  const showLocal = t('browse.localWorkspace').toLocaleLowerCase().includes(term)
  const showFollowing = t('browse.following').toLocaleLowerCase().includes(term)
  const choices = open ? nodeChoices(nodes, query) : []
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    const button = trigger.current
    if (!open || rail || button === null) return
    const sidebar = button.closest('[data-dsh-workspace-browser]') ?? button.parentElement
    const place = () => {
      const rect = button.getBoundingClientRect()
      const bounds = sidebar?.getBoundingClientRect() ?? { left: rect.left, right: rect.left + 280 }
      setPosition(chooserPlacement(rect, bounds, { width: window.innerWidth, height: window.innerHeight }))
    }
    const outside = (event: Event) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !button.contains(event.target)) setOpen(false)
    }
    const observer = new ResizeObserver(place)
    if (sidebar !== null) observer.observe(sidebar)
    place()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, rail])
  const showPopup = open && !rail && position !== undefined
  useEffect(() => {
    if (showPopup) input.current?.focus({ preventScroll: true })
  }, [showPopup])
  const choose = (next: WorkspaceBrowseScope) => { onChange(next); close() }
  return <>
    <button ref={trigger} type="button"
      className={rail ? css.chooserTrigger : `${css.chooserTrigger} ${css.chooserTitleTrigger}`}
      aria-label={t('browse.titleAria', { name })}
      aria-haspopup="dialog" aria-expanded={open} title={`${name} · ${t('browse.choose')}`}
      onClick={() => { if (rail) { onExpand?.(); return }; setQuery(''); setOpen(!open) }}>
      {rail ? null : <span className={css.chooserTitleText}>{name}</span>}
      <IconTriangleRightFillRegular className={css.chooserArrow} />
    </button>
    {showPopup && createPortal(<div ref={popup} className={css.chooserPopup} role="dialog" aria-label={t('browse.choose')}
      style={position} onKeyDown={event => {
        if (!browseNavigationKey(event.nativeEvent)) return
        if (event.key === 'Escape') { event.preventDefault(); close() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const buttons = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[data-browse-option]') ?? [])
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          if (buttons.length === 0) return
          const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? buttons.length - 1 : index - 1
          buttons[(next + buttons.length) % buttons.length]?.focus()
        }
        if (event.key === 'Enter' && event.target === input.current) popup.current?.querySelector<HTMLButtonElement>('[data-browse-option]')?.click()
      }}>
      <div className={css.chooserHeading}>
        <span>{t('browse.choose')}</span>
        <button type="button" className={css.chooserRefresh} disabled={busy} aria-label={t('remote.refresh')}
          title={t('remote.refresh')} onClick={() => { input.current?.focus(); onRefresh() }}>
          <IconRefreshOutlineRegular size={16} />
        </button>
      </div>
      <label className={css.chooserSearchField}>
        <IconSearchOutlineRegular size={15} />
        <input ref={input} className={css.chooserSearch} value={query} onChange={e => { setQuery(e.target.value) }} placeholder={t('browse.search')} aria-label={t('browse.search')} />
      </label>
      <div className={css.chooserOptions}>
        {showLocal && <button type="button" data-browse-option="" className={css.chooserOption} data-selected={scope.kind === 'local'} aria-pressed={scope.kind === 'local'} onClick={() => { choose({ kind: 'local' }) }}>
          <IconFolderCloseRegular size={16} />
          <span className={css.chooserName}>{t('browse.localWorkspace')}</span>
          <span className={css.chooserTick}>{scope.kind === 'local' && <IconCheckOutlineRegular size={14} />}</span>
        </button>}
        {showFollowing && <button type="button" data-browse-option="" className={css.chooserOption} data-selected={scope.kind === 'following'} aria-pressed={scope.kind === 'following'} onClick={() => { choose({ kind: 'following' }) }}>
          <FollowPin />
          <span className={css.chooserName}>{t('browse.following')}</span>
          <span className={css.chooserTick}>{scope.kind === 'following' && <IconCheckOutlineRegular size={14} />}</span>
        </button>}
        {(term === '' || choices.length > 0) && <div className={css.chooserGroupLabel}
          data-separated={showLocal || showFollowing}>{t('browse.remoteNodes')}</div>}
        {choices.map(n => <button key={n.nodeId} type="button" data-browse-option="" className={`${css.chooserOption} ${css.chooserRemote}`}
          data-selected={scope.kind === 'remote' && scope.nodeId === n.nodeId}
          aria-pressed={scope.kind === 'remote' && scope.nodeId === n.nodeId}
          title={`${nodeDisplayName(n)} · ${n.nodeId} · ${t('browse.online')}`} onClick={() => { choose({ kind: 'remote', nodeId: n.nodeId }) }}>
          <StateDot state="done" size={8} />
          <span className={css.chooserName}>{nodeDisplayName(n)}</span>
          {currentNodeId === n.nodeId && <span className={css.chooserTag}>{t('browse.currentSession')}</span>}
          {scope.kind === 'remote' && scope.nodeId === n.nodeId && <span className={css.chooserTick}><IconCheckOutlineRegular size={14} /></span>}
        </button>)}
        {busy && <div role="status" className={css.message}>{t('remote.loading')}</div>}
        {error && <div role="alert" className={css.message}>{error}</div>}
        {!busy && !error && choices.length === 0 && (term === '' || !showLocal && !showFollowing) && (
          <div role="status" className={css.message}>{t(term === '' ? 'browse.noOnlineNodes' : 'empty.noMatches')}</div>
        )}
      </div>
    </div>, document.body)}
  </>
}
