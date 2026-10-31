/**
 * Host primitives for the isolated picker preview.
 *
 * The real `@deepseek-ai/dsh-client-ui-primitives` bundle imports CSS modules,
 * shiki and katex, so it cannot be pulled into a throwaway page. Only the three
 * glyphs `WorkspaceNodeChooser` uses are mocked here, with the exact SVG artwork
 * and stroke weights of the installed DSH runtime (0.2.1-rc.2). Everything else
 * on the page — the chooser component, its generated stylesheet, its locale
 * strings — is the production code.
 */
import React from 'react'
import type { ReactElement } from 'react'

interface IconProps {
  readonly size?: number | undefined
  readonly className?: string | undefined
}

function artwork(size: number, className: string | undefined, children: React.ReactNode): ReactElement {
  return <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">{children}</svg>
}

/** `ic_ds_triangle_right_fill` artwork; consumers rotate it. */
export const IconTriangleRightFillRegular = ({ size = 14, className }: IconProps): ReactElement => artwork(size, className,
  <path fill="currentColor" d="M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z" />)

/** `ic_ds_check_outline` artwork at the runtime's 1px weight. */
export const IconCheckOutlineRegular = ({ size = 16, className }: IconProps): ReactElement => artwork(size, className,
  <path stroke="currentColor" strokeWidth={1} d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" />)

/** `ic_ds_refresh_outline` artwork at the runtime's 1px weight. */
export const IconRefreshOutlineRegular = ({ size = 16, className }: IconProps): ReactElement => artwork(size, className, <>
  <path stroke="currentColor" strokeWidth={1} d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1" />
  <path stroke="currentColor" strokeWidth={1} d="M14.4999 1.5V5.1H10.8999" />
</>)
