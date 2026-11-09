/**
 * The follow list rendered in the sidebar's browsing position.
 *
 * Pure presentation over {@link FollowingRow}: the browser-owned follow records, the
 * local session subscription and the single remote data owner already decided every
 * status. A row that is not `ok` stays visible and cancellable but cannot be opened.
 *
 * @module dsh-master/workspace/FollowingList
 */

import clsx from 'clsx'
import {
  Button,
  IconEllipsisOutlineRegular as IconEllipsisOutline16,
  IconRefreshOutlineRegular as IconRefreshOutline14,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useState, type ReactElement } from 'react'
import { FollowPin } from './follow-pin.js'
import type { FollowingRow, FollowStatus } from './following.js'
import { RowsCss, RemoteSectionCss as css, WorkspaceBrowserCss } from './styles.generated.js'

/** Props of the follow-list body. */
export interface FollowingListProps {
  /** Already filtered rows, in follow-time order. */
  readonly rows: readonly FollowingRow[]
  /** Number of records before filtering, used to pick the empty-state copy. */
  readonly total: number
  readonly query: string
  /** Key of the row matching the currently open local or remote session. */
  readonly selectedKey: string | undefined
  readonly busy: boolean
  readonly error: string | undefined
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly onOpen: (row: FollowingRow) => void
  readonly onUnfollow: (key: string) => void
  readonly onRefresh: () => void
}

/** Localized status label for a row that cannot be opened. */
function statusLabel(status: FollowStatus, t: FollowingListProps['t']): string {
  switch (status) {
    case 'loading': return t('following.loading')
    case 'offline': return t('following.offline')
    case 'source-unavailable': return t('following.sourceUnavailable')
    case 'load-failed': return t('following.loadFailed')
    case 'not-found': return t('following.notFound')
    case 'archived': return t('following.archived')
    case 'ok': return ''
  }
}

/**
 * Render one followed session: title, machine and workspace, with its row menu.
 *
 * @param props.row - compiled row.
 * @param props.selected - this row is the open session.
 * @param props.t - locale seat.
 * @param props.onOpen - open this row when it is usable.
 * @param props.onUnfollow - remove the follow marker.
 * @returns the row element.
 */
export function FollowingRowItem({ row, selected, menuOpen, onMenuOpenChange, t, onOpen, onUnfollow }: {
  readonly row: FollowingRow
  readonly selected: boolean
  readonly menuOpen: boolean
  readonly onMenuOpenChange: (open: boolean) => void
  readonly t: FollowingListProps['t']
  readonly onOpen: (row: FollowingRow) => void
  readonly onUnfollow: (key: string) => void
}): ReactElement {
  const openable = row.status === 'ok'
  const title = row.title.trim() === '' ? t('following.untitled') : row.title
  return (
    <div
      role="treeitem"
      className={clsx(css.followingRow, selected && RowsCss.selected, menuOpen && css.followingRowOpen, !openable && css.followingUnavailable)}
      aria-selected={selected}
      aria-disabled={openable ? undefined : true}
      title={`${title} · ${row.machine} · ${row.workspace}`}
      onClick={() => { if (openable) onOpen(row) }}
    >
      <span className={css.followingPin} aria-hidden="true"><FollowPin filled /></span>
      <span className={css.followingMain}>
        <span className={css.followingTitle}>{title}</span>
        <span className={css.followingMeta}>
          <span className={css.followingMachine}>{row.machine}</span>
          <span aria-hidden="true">·</span>
          <span className={css.followingWorkspace}>{row.workspace}</span>
          {openable ? null : (
            <span className={css.followingStatus} data-status={row.status}>
              {statusLabel(row.status, t)}
            </span>
          )}
        </span>
      </span>
      <span className={css.followingActions}>
        <Menu
          open={menuOpen}
          onClose={() => { onMenuOpenChange(false) }}
          items={[{ id: 'unfollow', label: t('menu.unfollow'), icon: <FollowPin filled /> }]}
          onSelect={(id) => {
            onMenuOpenChange(false)
            if (id === 'unfollow') onUnfollow(row.key)
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={RowsCss.iconButton}
              aria-label={t('following.actions.aria', { name: title })}
              onClick={(event) => { event.stopPropagation(); onMenuOpenChange(!menuOpen) }}
            >
              <IconEllipsisOutline16 />
            </button>
          )}
        />
      </span>
    </div>
  )
}

/**
 * Render the follow list region: header with refresh, status/error, rows and the
 * two distinct empty states.
 *
 * @param props - compiled rows plus the callbacks the region drives.
 * @returns the region element.
 */
export function FollowingList({
  rows, total, query, selectedKey, busy, error, t, onOpen, onUnfollow, onRefresh,
}: FollowingListProps): ReactElement {
  // One menu at a time, keyed by row: a row can unmount (unfollow) while its menu is open.
  const [openMenuKey, setOpenMenuKey] = useState<string | undefined>(undefined)
  return (
    <div className={css.following} data-dsh-following="" role="region" aria-label={t('following.title')}>
      <div className={css.followingHeader}>
        <span className={css.groupTitle}>{t('following.title')}</span>
        <Button
          variant="ghost"
          icon={<IconRefreshOutline14 />}
          disabled={busy}
          onClick={onRefresh}
          aria-label={t('following.refresh')}
          title={t('following.refresh')}
        />
      </div>
      {error === undefined ? null : <div className={css.message} role="alert">{error}</div>}
      <div className={css.followingList} role="tree" aria-label={t('following.title')}>
        {total === 0
          ? <div className={WorkspaceBrowserCss.empty}>{t('following.empty')}</div>
          : rows.length === 0
            ? <div className={WorkspaceBrowserCss.empty}>{t('following.noMatches')}</div>
            : rows.map(row => (
              <FollowingRowItem
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                menuOpen={openMenuKey === row.key}
                onMenuOpenChange={(open) => { setOpenMenuKey(open ? row.key : undefined) }}
                t={t}
                onOpen={onOpen}
                onUnfollow={onUnfollow}
              />
            ))}
      </div>
    </div>
  )
}
