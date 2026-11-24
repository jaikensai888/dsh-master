/**
 * Pure display rules for the archived-session list.
 *
 * An archive is a registry-global **set of session ids**, not a container: the
 * session's workspace accounting, transcript and title all stay exactly where
 * they were. So the list is a projection of three facts that every scope already
 * holds — the archive set, the session summaries, and the workspace membership —
 * and this module is the one place that projection is spelled out.
 *
 * @module dsh-master/workspace/archived
 */

/** The session facts one archived row needs, from either host or a remote node. */
export interface ArchivedSessionFacts {
  readonly sessionId: string
  /** Display title; an untitled session is given one by its caller. */
  readonly title: string
  readonly updatedAt: number
  /** The session is executing a turn right now, when the source can tell. */
  readonly running?: boolean
}

/** One row in the archived list: title, owning workspace, last update. */
export interface ArchivedRow {
  readonly sessionId: string
  readonly title: string
  /** Workspace title, or the caller's ungrouped label when membership is gone. */
  readonly workspace: string
  readonly updatedAt: number
  readonly running: boolean
}

/** The registry facts a caller must supply alongside the archive set. */
export interface ArchivedWorkspaceFacts {
  readonly workspaceId: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

/**
 * Project one scope's archived sessions into display rows, newest first.
 *
 * Only ids present in **both** the archive set and the session summaries become
 * rows: the archive set can outlive a deleted transcript, and a row that cannot
 * be opened would be a dead end. Duplicate ids collapse to one row, and the
 * archive set's order is irrelevant because the list is sorted by recency.
 *
 * @param sessions - the scope's session summaries.
 * @param workspaces - the scope's registered workspaces, for the workspace column.
 * @param archivedSessionIds - the scope's complete archive set.
 * @param ungrouped - label for an archived session with no workspace membership.
 * @returns the display rows, newest update first.
 */
export function archivedRows(
  sessions: readonly ArchivedSessionFacts[],
  workspaces: readonly ArchivedWorkspaceFacts[],
  archivedSessionIds: readonly string[],
  ungrouped: string,
): ArchivedRow[] {
  const archived = new Set(archivedSessionIds)
  const workspaceOf = new Map<string, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, workspace.title)
    }
  }
  const byId = new Map<string, ArchivedSessionFacts>()
  for (const session of sessions) {
    if (!archived.has(session.sessionId) || byId.has(session.sessionId)) continue
    byId.set(session.sessionId, session)
  }
  const rows: ArchivedRow[] = []
  for (const session of byId.values()) {
    rows.push({
      sessionId: session.sessionId,
      title: session.title,
      workspace: workspaceOf.get(session.sessionId) ?? ungrouped,
      updatedAt: session.updatedAt,
      running: session.running === true,
    })
  }
  return rows.sort((left, right) => right.updatedAt - left.updatedAt
    || (left.sessionId < right.sessionId ? -1 : 1))
}

/**
 * Filter archived rows by a case-insensitive title or workspace match.
 *
 * The archived list occupies the same sidebar position as the session tree, so
 * the existing search box filters it too; matching on the workspace column keeps
 * "show me what we archived in this project" one word away.
 *
 * @param rows - rows from {@link archivedRows}.
 * @param query - raw search text; blank means no filter.
 * @returns the matching rows, order preserved.
 */
export function filterArchivedRows(rows: readonly ArchivedRow[], query: string): ArchivedRow[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return [...rows]
  return rows.filter(row => row.title.toLocaleLowerCase().includes(needle)
    || row.workspace.toLocaleLowerCase().includes(needle))
}

/**
 * Install one node's authoritative archive set after a write.
 *
 * The node answers an archive or unarchive with the complete set, so the only
 * correct update is replacement. A missing cached row means nothing has landed
 * for that node yet; the answer is then dropped rather than inventing an empty
 * scope, because the next `session/list` will carry the truth.
 *
 * @param data - per-node session cache.
 * @param nodeId - the node whose set changed.
 * @param archivedSessionIds - the complete set the node reported.
 * @returns the updated cache, or the input when the node is not cached.
 */
export function installArchiveSet<T extends { readonly archivedSessionIds: readonly string[] }>(
  data: Readonly<Record<string, T>>,
  nodeId: string,
  archivedSessionIds: readonly string[],
): Readonly<Record<string, T>> {
  const current = data[nodeId]
  if (current === undefined) return data
  return { ...data, [nodeId]: { ...current, archivedSessionIds: [...archivedSessionIds] } }
}
