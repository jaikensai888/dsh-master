/**
 * Draft rules for the remote `/` Skill picker.
 *
 * The menu is a drafting aid: it only rewrites the first token of the draft and
 * never sends anything. Keeping the rules pure lets the composer tests cover the
 * trigger, the filter and the completion without a DOM.
 *
 * A trigger is the *first* token and only while it looks like a skill reference:
 * `/`, `/rev`, `/rev some args`. Text before it (`请看 /rev`), a path
 * (`/usr/bin`), or a slash later in the line never open the menu.
 *
 * @module dsh-master/client/skill-picker
 */

import type { MasterSkillEntry } from '../protocol.js'

/** The leading `/token` that opens the picker. */
export interface SkillTrigger {
  /** Lowercased text after the slash; the filter prefix. */
  readonly prefix: string
  /** Index just past the token, where its arguments begin. */
  readonly tokenEnd: number
}

/**
 * Read the skill trigger a draft carries.
 * @param draft - the whole composer draft.
 * @returns the trigger, or `undefined` when the draft is not addressed to a skill.
 */
export function skillTrigger(draft: string): SkillTrigger | undefined {
  const match = /^\/([a-zA-Z0-9-]*)(?=\s|$)/u.exec(draft)
  if (match === null) return undefined
  return { prefix: (match[1] ?? '').toLowerCase(), tokenEnd: match[0].length }
}

/**
 * Replace the trigger token with the chosen skill, keeping the arguments.
 *
 * `/rev 检查改动` becomes `/review 检查改动`; a bare `/rev` becomes `/review `
 * so the next keystroke is the argument, not a continued name.
 * @param draft - the whole composer draft.
 * @param name - the chosen skill name.
 * @returns the rewritten draft (unchanged when there is no trigger).
 */
export function completeSkill(draft: string, name: string): string {
  const trigger = skillTrigger(draft)
  if (trigger === undefined) return draft
  const rest = draft.slice(trigger.tokenEnd).replace(/^[ \t]+/u, '')
  return rest === '' ? `/${name} ` : `/${name} ${rest}`
}

/**
 * Filter skills by the typed prefix.
 * @param skills - the session's catalog.
 * @param prefix - lowercase text after the slash.
 * @returns every skill when the prefix is empty, otherwise the prefix matches.
 */
export function filterSkills(
  skills: readonly MasterSkillEntry[],
  prefix: string,
): MasterSkillEntry[] {
  const lower = prefix.toLowerCase()
  if (lower === '') return [...skills]
  return skills.filter(skill => skill.name.toLowerCase().startsWith(lower))
}

/**
 * Status codes that mean "this node cannot answer the catalog", not "the call
 * failed". They are permanent for the node and must not invite a retry loop.
 */
const UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'node/capability-unavailable',
  'gateway/method-unavailable',
  'gateway/service-unavailable',
  'gateway/definition-unavailable',
  'gateway/invocation-unavailable',
])

/**
 * Classify a catalog failure for the menu.
 * @param code - the `ApiError` code, when the failure had one.
 * @returns `unsupported` for a missing capability, `error` for anything else.
 */
export function skillFailureKind(code: string | undefined): 'unsupported' | 'error' {
  return code !== undefined && UNSUPPORTED_CODES.has(code) ? 'unsupported' : 'error'
}
