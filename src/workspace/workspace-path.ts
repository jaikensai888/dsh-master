/**
 * The two path helpers the forked browser needs, inlined.
 *
 * Upstream imports these from `@deepseek-ai/dsh-util-workspace-path`. That package is
 * **not** in the shell's frozen platform module table, so a client bundle that
 * `require()`d it would fail at materialisation — silently, with the panel simply
 * never appearing. Inlining two pure functions is the whole fix; the rest of that
 * package (the `dsh-resource://file/…` address grammar) is host-facing and unused here.
 *
 * Both functions are copied from `@deepseek-ai/dsh-util-workspace-path@0.1.5-rc.2`
 * (MIT, Copyright (c) 2026 DeepSeek) so the fork's display behaviour matches the
 * official rows exactly — including the Windows special cases, which are easy to get
 * subtly wrong and impossible to notice on one machine.
 *
 * @module dsh-master/workspace/workspace-path
 */

/** Whether a path uses a Windows drive or UNC prefix. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/u.test(value) || value.startsWith('\\\\')
}

/**
 * Abbreviate a POSIX home directory for display.
 *
 * Windows paths are deliberately left alone: `~` is a POSIX convention, and a drive
 * path has no single-segment equivalent to collapse.
 *
 * @param path - absolute or already-short display path.
 * @param home - host account home; absent or empty skips abbreviation.
 * @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
 */
export function abbreviateHomePath(path: string, home?: string): string {
  if (home === undefined || home === '') return path
  if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path
  const root = home.replace(/\/+$/u, '')
  if (root === '' || root === '/') return path
  if (path.replace(/\/+$/u, '') === root) return '~'
  if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`
  return path
}

/**
 * Read the final non-empty segment of a workspace path, for use as its label.
 *
 * @param path - workspace directory path using POSIX or Windows separators.
 * @returns the final segment, or an empty string for a separator-only path.
 */
export function workspaceTitleOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/u, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}
