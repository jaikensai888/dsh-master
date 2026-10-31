/**
 * File-change cards for a remote conversation.
 *
 * Two surfaces, both drawn from the structured facts `wire.ts` kept — never from
 * paths mentioned in assistant prose, and never with a download affordance (a diff
 * path is not an artifact id):
 *
 * - {@link FileChangeCard}: one `write`/`edit` call, with its hunks behind a native
 *   disclosure so the process stays scannable;
 * - {@link TurnChangesCard}: the compact roll-up of one turn's changed files, whose
 *   visual matches the reference card (icon tile, `已编辑 N 个文件`, `+a -d`, folded
 *   4-row list with a `全部 N 个文件` toggle).
 *
 * Opening, previewing and editing a changed file are deliberately absent: the remote
 * side has no file-resource route, so a clickable path would promise something this
 * iteration cannot do.
 *
 * @module dsh-master/client/FileChangeCard
 */

import { useId, useState } from 'react'
import type { ReactElement } from 'react'
import {
  FILE_CHANGE_COLLAPSE_ARIA,
  COPY,
  fileChangeAll,
  fileChangeEdited,
  fileChangeExpandAria,
  fileChangesTitle,
} from './copy.js'
import {
  changeStats,
  contentLines,
  displayName,
  displayPath,
  type ChangedFile,
  type FileChange,
  type FileChangeSummary,
} from './file-changes.js'

/** Rows shown before the turn roll-up folds its list, matching the shipped card. */
export const COLLAPSED_FILE_ROWS = 4

/** Diff body rows drawn before the card stops and says so. */
export const MAX_DIFF_ROWS = 400

/** The file-glyph tile both cards share. */
function ChangeTile(): ReactElement {
  return (
    <span className="dsh-master-change-tile" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
        <path
          d="m6.2 5.2-2.6 2.8 2.6 2.8M9.8 5.2l2.6 2.8-2.6 2.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** `+a -d`, or the oversized marker when the hunk was too large to count. */
function ChangeCounts({ added, deleted, oversized }: {
  readonly added: number
  readonly deleted: number
  readonly oversized?: true | undefined
}): ReactElement {
  if (oversized === true) {
    return <span className="dsh-master-change-oversized">{COPY.fileChangeOversized}</span>
  }
  return (
    <>
      <span className="dsh-master-change-added">+{added}</span>
      <span className="dsh-master-change-deleted">-{deleted}</span>
    </>
  )
}

/** One rendered diff-body line. */
interface DiffRow {
  readonly kind: 'path' | 'del' | 'add' | 'gap'
  readonly text: string
}

/**
 * Flatten one change's hunks into body rows.
 *
 * A second hunk of the same file opens with `⋯` rather than repeating the path, the
 * same convention the shipped diff block uses.
 * @param change - the call's change.
 * @param cwd - session workspace root, used to shorten a canonical recorded path.
 * @returns the body rows.
 */
export function diffRows(change: FileChange, cwd?: string): DiffRow[] {
  const rows: DiffRow[] = []
  let previous: string | undefined
  for (const hunk of change.diffs) {
    const shown = displayPath(hunk.path, cwd)
    rows.push(shown === previous ? { kind: 'gap', text: '⋯' } : { kind: 'path', text: shown })
    previous = shown
    for (const line of contentLines(hunk.oldText)) rows.push({ kind: 'del', text: line })
    for (const line of contentLines(hunk.newText)) rows.push({ kind: 'add', text: line })
  }
  return rows
}

/** The verb a call's title uses, keyed on the wire tool name. */
function changeVerb(tool: string): string {
  if (tool === 'write') return COPY.fileChangeWrite
  if (tool === 'str_replace_editor') return COPY.fileChangeReplace
  return COPY.fileChangeEdit
}

/**
 * Render one call's file change.
 * @param props - the change plus the session workspace root for path shortening.
 * @returns the card.
 */
export function FileChangeCard(props: { readonly change: FileChange; readonly cwd?: string | undefined }): ReactElement {
  const { change, cwd } = props
  const stats = changeStats(change)
  const rows = diffRows(change, cwd)
  const shown = rows.slice(0, MAX_DIFF_ROWS)
  const path = displayPath(change.path, cwd)
  return (
    <details className="dsh-master-change" data-tool={change.tool} data-phase={change.phase}>
      <summary className="dsh-master-change-head">
        <ChangeTile />
        <span className="dsh-master-change-title">{changeVerb(change.tool)}</span>
        <span className="dsh-master-change-path" title={path}>{path}</span>
        <span className="dsh-master-change-counts">
          {change.phase === 'intent'
            ? <span className="dsh-master-change-running">{COPY.toolRunning}</span>
            : <ChangeCounts added={stats.added} deleted={stats.deleted} oversized={stats.oversized} />}
        </span>
        <span className="dsh-master-change-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className="dsh-master-change-body">
        {shown.map((row, index) => (
          <div key={index} className="dsh-master-change-line" data-kind={row.kind}>{row.text}</div>
        ))}
        {rows.length <= MAX_DIFF_ROWS ? null : (
          <div className="dsh-master-change-note">{COPY.fileChangeTruncated}</div>
        )}
      </div>
    </details>
  )
}

/**
 * Render one turn's changed files as the compact roll-up card.
 *
 * A single-file turn uses only the header, as the shipped card does. A longer list
 * folds to {@link COLLAPSED_FILE_ROWS} rows behind a real button carrying
 * `aria-expanded`/`aria-controls`, so it is reachable and announced from the keyboard.
 *
 * @param props - the turn's summary, the workspace root for path shortening, and an
 *   optional initial state used by the visual-check harness.
 * @returns the card.
 */
export function TurnChangesCard(props: {
  readonly summary: FileChangeSummary
  readonly cwd?: string | undefined
  /** Preview/test convenience: open the folded list on first render. */
  readonly defaultExpanded?: boolean | undefined
}): ReactElement {
  const { summary, cwd } = props
  const [expanded, setExpanded] = useState(props.defaultExpanded === true)
  const listId = useId()
  const single: ChangedFile | undefined = summary.total === 1 ? summary.files[0] : undefined
  const foldable = summary.files.length > COLLAPSED_FILE_ROWS
  const rows = foldable && !expanded ? summary.files.slice(0, COLLAPSED_FILE_ROWS) : summary.files
  return (
    <div className="dsh-master-changes" data-changes="" data-total={summary.total} data-single={single === undefined ? undefined : 'true'}>
      <div className="dsh-master-changes-head">
        <ChangeTile />
        <div className="dsh-master-changes-titles">
          <span className="dsh-master-changes-title">
            {single === undefined
              ? fileChangesTitle(summary.total)
              : fileChangeEdited(displayName(single.path))}
          </span>
          <span className="dsh-master-changes-counts">
            {single === undefined
              ? <ChangeCounts added={summary.added} deleted={summary.deleted} />
              : (
                <>
                  <ChangeCounts added={single.added} deleted={single.deleted} oversized={single.oversized} />
                  <span className="dsh-master-changes-sep" aria-hidden="true">·</span>
                  <span className="dsh-master-changes-path" title={displayPath(single.path, cwd)}>
                    {displayPath(single.path, cwd)}
                  </span>
                </>
              )}
          </span>
        </div>
      </div>
      {single !== undefined ? null : (
        <ul className="dsh-master-changes-list" id={listId}>
          {rows.map((file: ChangedFile) => (
            <li key={file.path} className="dsh-master-changes-row">
              <span className="dsh-master-changes-row-path" title={displayPath(file.path, cwd)}>
                {displayPath(file.path, cwd)}
              </span>
              <span className="dsh-master-changes-row-counts">
                <ChangeCounts added={file.added} deleted={file.deleted} oversized={file.oversized} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {foldable ? (
        <button
          type="button"
          className="dsh-master-changes-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={expanded ? FILE_CHANGE_COLLAPSE_ARIA : fileChangeExpandAria(summary.files.length)}
          onClick={() => { setExpanded(value => !value) }}
        >
          <span>{expanded ? COPY.fileChangesCollapse : fileChangeAll(summary.files.length)}</span>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
            <path
              d={expanded ? 'm4.5 9.5 3.5-3.5 3.5 3.5' : 'm4.5 6.5 3.5 3.5 3.5-3.5'}
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
