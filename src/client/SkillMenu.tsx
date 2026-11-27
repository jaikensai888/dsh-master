/**
 * The remote composer's `/` Skill menu.
 *
 * Presentational on purpose: the draft rules live in `skill-picker.ts` and the
 * request in `SessionView`, so this component only paints the current state and
 * reports the chosen entry. It stays a `listbox` the textarea points at, which
 * keeps the options reachable by a screen reader while focus never leaves the
 * draft.
 *
 * @module dsh-master/client/SkillMenu
 */

import type { ReactElement } from 'react'
import type { MasterSkillEntry } from '../protocol.js'
import { COPY } from './copy.js'

/** What the menu is showing right now. */
export type SkillMenuStatus = 'loading' | 'ready' | 'empty' | 'error' | 'unsupported'

/** Props for {@link SkillMenu}. */
export interface SkillMenuProps {
  /** DOM id the composer's `aria-controls` points at. */
  readonly id: string
  readonly status: SkillMenuStatus
  /** Already filtered by the typed prefix. */
  readonly skills: readonly MasterSkillEntry[]
  readonly activeIndex: number
  readonly onChoose: (skill: MasterSkillEntry) => void
  readonly onHover: (index: number) => void
}

/**
 * Paint the Skill candidates and their loading/empty/failure states.
 * @param props - status, filtered entries, and interaction callbacks.
 * @returns the listbox element.
 */
export function SkillMenu(props: SkillMenuProps): ReactElement {
  const { id, status, skills, activeIndex } = props
  const active = skills.length === 0 ? -1 : Math.min(activeIndex, skills.length - 1)
  return (
    <div
      className="dsh-master-skill-menu"
      id={id}
      role="listbox"
      aria-label={COPY.skillMenuTitle}
      // Keep focus in the textarea: a mousedown that moves focus would blur the
      // composer and close the menu before the click lands.
      onMouseDown={(event) => { event.preventDefault() }}
    >
      {status === 'loading' ? <div className="dsh-master-skill-status" role="status">{COPY.skillLoading}</div> : null}
      {status === 'error' ? <div className="dsh-master-skill-status" role="alert">{COPY.skillLoadFailed}</div> : null}
      {status === 'unsupported' ? <div className="dsh-master-skill-status">{COPY.skillUnsupported}</div> : null}
      {status === 'empty' ? <div className="dsh-master-skill-status">{COPY.skillEmpty}</div> : null}
      {status === 'ready' && skills.length === 0 ? (
        <div className="dsh-master-skill-status" role="status">{COPY.skillNoMatch}</div>
      ) : null}
      {skills.map((skill, index) => (
        <div
          key={skill.name}
          id={`${id}-${String(index)}`}
          role="option"
          aria-selected={index === active}
          className="dsh-master-skill-option"
          onMouseEnter={() => { props.onHover(index) }}
          onClick={() => { props.onChoose(skill) }}
        >
          <span className="dsh-master-skill-name">/{skill.name}</span>
          <span className="dsh-master-skill-description">{skill.description}</span>
          {skill.whenToUse === undefined
            ? null
            : <span className="dsh-master-skill-when">{skill.whenToUse}</span>}
        </div>
      ))}
    </div>
  )
}
