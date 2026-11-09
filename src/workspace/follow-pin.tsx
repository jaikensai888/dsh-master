/**
 * The follow marker glyph.
 *
 * Inline rather than an icon-package import: the shipped atom library's follow/pin
 * icons are not part of the surface this plugin already consumes, and a deliberate
 * pin glyph keeps the marker identifiable in both row menus without adding a runtime
 * dependency on an export that a host upgrade could rename.
 *
 * @module dsh-master/workspace/follow-pin
 */

import type { ReactElement } from 'react'

/** Props of the marker: filled means "currently followed". */
export interface FollowPinProps {
  readonly filled?: boolean
  readonly size?: number
}

/**
 * Render the pin outline (follow) or solid form (unfollow).
 *
 * @param props - fill state and rendered size.
 * @returns the glyph, hidden from assistive technology (its menu row carries the label).
 */
export function FollowPin({ filled = false, size = 16 }: FollowPinProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7.1 1.9a1 1 0 0 1 1.8 0l1.4 3.3 3.6.4a1 1 0 0 1 .6 1.7l-2.7 2.4.8 3.5a1 1 0 0 1-1.5 1.1L8 12.6l-3.1 1.7a1 1 0 0 1-1.5-1.1l.8-3.5-2.7-2.4a1 1 0 0 1 .6-1.7l3.6-.4 1.4-3.3Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
