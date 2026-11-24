/**
 * The archived-session list rendered in the sidebar's browsing position.
 *
 * An archive is a registry-global id set, so this list is a pure projection of
 * data each scope already holds ({@link ArchivedRow}); the owner decides which
 * scope the rows belong to, whether the scope is readable, and whether its host
 * can unarchive at all. Every row stays visible while its unarchive is in flight
 * or after it fails, so a refusal never loses the entry it was about.
 *
 * @module dsh-master/workspace/ArchivedList
 */

import clsx from 'clsx'
import {
  Button,
  IconArchiveOutlineRegular as IconArchiveOutline16,
  IconCloseFillRegular as IconCloseFill14,
  IconEllipsisOutlineRegular as IconEllipsisOutline16,
  IconRefreshOutlineRegular as IconRefreshOutline14,
  Menu,
  StateDot,
  relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useState, type ReactElement } from 'react'
import type { ArchivedRow } from './archived.js'
import { RowsCss, RemoteSectionCss, WorkspaceBrowserCss, WorkspaceExtrasCss as css } from './styles.generated.js'

/** The one failure the list reports: which row, and what the host said. */
export interface ArchivedActionError {
  readonly sessionId: string
  readonly message: string
}

/** Props of the archived list body. */
export interface ArchivedListProps {
  /** Rows for the current scope, newest update first. */
  readonly rows: readonly ArchivedRow[]
  /** Reference instant for the relative-time column. */
  readonly now: number
  /** The scope is still being read; rows already present stay visible. */
  readonly loading?: boolean
  /** The scope could not be read (offline node, failed list). */
  readonly error?: string | undefined
  /** The owning host answers archive state but cannot restore sessions. */
  readonly unsupported?: string | undefined
  /** A refresh / verify is in flight. */
  readonly busy?: boolean
  /** Session whose unarchive is in flight; its menu entry stays disabled. */
  readonly pendingId?: string | undefined
  /** The last failed unarchive, tied to its row. */
  readonly actionError?: ArchivedActionError | undefined
  /** Session currently open in the main panel, for the selected row. */
  readonly selectedId?: string | undefined
  /** Rows cannot be opened (stale snapshot): they render muted and inert. */
  readonly nonInteractive?: boolean
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly onOpen: (sessionId: string) => void
  readonly onUnarchive: (sessionId: string) => void
  readonly onRefresh?: (() => void) | undefined
  /** Leave the archived view and return to the ordinary session tree. */
  readonly onClose?: (() => void) | undefined
}

/** The locale's relative time, through the workspace dictionary. */
function timeLabel(updatedAt: number, now: number, t: ArchivedListProps['t']): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/**
 * Render one archived session: title, owning workspace, update time, row menu.
 *
 * @param props.row - the display row.
 * @param props.selected - this row is the open session.
 * @param props.menuOpen - this row's menu is open.
 * @param props.pending - its unarchive is in flight.
 * @param props.unarchiveAvailable - the owning host can unarchive sessions.
 * @param props.nonInteractive - the scope's snapshot is stale.
 * @param props.t - locale seat.
 * @param props.onOpen - open the historical session.
 * @param props.onUnarchive - ask the owning host to restore it.
 * @param props.onMenuOpenChange - own the single open menu.
 * @returns the row element.
 */
export function ArchivedRowItem({ row, now, selected, menuOpen, pending, unarchiveAvailable, nonInteractive, t, onOpen, onUnarchive, onMenuOpenChange }: {
  readonly row: ArchivedRow
  /** Reference instant for the relative-time column. */
  readonly now: number
  readonly selected: boolean
  readonly menuOpen: boolean
  readonly pending: boolean
  readonly unarchiveAvailable: boolean
  readonly nonInteractive: boolean
  readonly t: ArchivedListProps['t']
  readonly onOpen: (sessionId: string) => void
  readonly onUnarchive: (sessionId: string) => void
  readonly onMenuOpenChange: (open: boolean) => void
}): ReactElement {
  const title = row.title.trim() === '' ? t('session.new') : row.title
  const time = timeLabel(row.updatedAt, now, t)
  const menuItems = [{
    id: 'unarchive',
    label: t('menu.unarchiveSession'),
    icon: <IconArchiveOutline16 size={16} />,
    disabled: pending || !unarchiveAvailable,
  }]
  return (
    <div
      role="treeitem"
      className={clsx(css.archivedRow, selected && RowsCss.selected, menuOpen && css.archivedRowOpen, nonInteractive && css.archivedUnavailable)}
      aria-selected={selected}
      aria-disabled={nonInteractive ? true : undefined}
      title={`${title} · ${row.workspace} · ${time}`}
      onClick={() => { if (!nonInteractive) onOpen(row.sessionId) }}
    >
      <span className={css.archivedMain}>
        <span className={css.archivedTitleText}>{title}</span>
        <span className={css.archivedMeta}>
          <span className={css.archivedWorkspace}>{row.workspace}</span>
          {time === '' ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span className={css.archivedAge}>{time}</span>
            </>
          )}
        </span>
      </span>
      {row.running ? (
        <span className={css.archivedRunning} role="img" aria-label={t('status.running')} title={t('status.running')}>
          <StateDot state="ongoing" />
        </span>
      ) : null}
      <span className={css.archivedActions}>
        <Menu
          open={menuOpen}
          onClose={() => { onMenuOpenChange(false) }}
          items={menuItems}
          onSelect={(id) => {
            onMenuOpenChange(false)
            if (id === 'unarchive') onUnarchive(row.sessionId)
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={RowsCss.iconButton}
              aria-label={t('actions.session.aria', { name: title })}
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
 * Render the archived region: header, load/capability states, rows, and the one
 * failure line a refused unarchive leaves behind.
 *
 * @param props - projected rows plus the callbacks the region drives.
 * @returns the region element.
 */
export function ArchivedList({
  rows, now, loading = false, error, unsupported, busy = false, pendingId, actionError, selectedId,
  nonInteractive = false, t, onOpen, onUnarchive, onRefresh, onClose,
}: ArchivedListProps): ReactElement {
  // One menu at a time: a row can leave the list (unarchived) while its menu is open.
  const [openMenuId, setOpenMenuId] = useState<string | undefined>(undefined)
  const unarchiveAvailable = unsupported === undefined
  return (
    <div className={css.archived} data-dsh-archived="" role="region" aria-label={t('archived.title')}>
      <div className={css.archivedHeader}>
        <span className={css.archivedTitle}>{t('archived.title')}</span>
        {rows.length === 0 ? null : <span className={css.archivedCount}>{t('sessions.count.other', { n: rows.length })}</span>}
        {onRefresh === undefined ? null : (
          <Button
            variant="ghost"
            icon={<IconRefreshOutline14 />}
            disabled={busy}
            onClick={onRefresh}
            aria-label={t('archived.refresh')}
            title={t('archived.refresh')}
          />
        )}
        {onClose === undefined ? null : (
          <button
            type="button"
            className={RowsCss.iconButton}
            aria-label={t('archived.close')}
            title={t('archived.close')}
            onClick={onClose}
          >
            <IconCloseFill14 />
          </button>
        )}
      </div>
      {error === undefined ? null : <div className={RemoteSectionCss.message} role="alert">{error}</div>}
      {unsupported === undefined ? null : (
        <div className={RemoteSectionCss.message} role="status">{unsupported}</div>
      )}
      {actionError === undefined ? null : (
        <div className={css.archivedActionError} role="alert">{actionError.message}</div>
      )}
      <div className={css.archivedList} role="tree" aria-label={t('archived.title')}>
        {rows.length === 0
          ? (
            <div className={WorkspaceBrowserCss.empty}>
              {loading ? t('archived.loading') : t('archived.empty')}
            </div>
          )
          : rows.map(row => (
            <ArchivedRowItem
              key={row.sessionId}
              row={row}
              now={now}
              selected={row.sessionId === selectedId}
              menuOpen={openMenuId === row.sessionId}
              pending={pendingId === row.sessionId}
              unarchiveAvailable={unarchiveAvailable}
              nonInteractive={nonInteractive}
              t={t}
              onOpen={onOpen}
              onUnarchive={onUnarchive}
              onMenuOpenChange={(open) => { setOpenMenuId(open ? row.sessionId : undefined) }}
            />
          ))}
      </div>
      <span className={WorkspaceBrowserCss.fade} />
    </div>
  )
}
