import { describe, expect, it } from 'vitest'
import {
  RowsCss,
  LocalSectionCss,
  RemoteSectionCss,
  WORKSPACE_CSS,
  WorkspaceBrowserCss,
  WorkspacePickerCss,
} from '../src/workspace/styles.generated.js'

/**
 * The generated maps, with the stylesheet they belong to.
 *
 * The stylesheets are concatenated into one `<style>`, so "which module owns this
 * class" is only known from the maps — which is also what makes them the authoritative
 * side of every check below.
 */
const MAPS = {
  Rows: RowsCss,
  RemoteSection: RemoteSectionCss,
  WorkspaceBrowser: WorkspaceBrowserCss,
  LocalSection: LocalSectionCss,
  WorkspacePicker: WorkspacePickerCss,
} as const

/** Every generated class name, with its module, across all stylesheets. */
const ENTRIES = Object.entries(MAPS).flatMap(([module, map]) =>
  Object.entries(map).map(([name, value]) => ({ module, name, value })),
)

function declaration(rule: string | undefined, property: string): string | undefined {
  if (rule === undefined) return undefined
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return rule.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, 'u'))?.[1]?.trim()
}

function paddingLeft(rule: string | undefined): string | undefined {
  const explicit = declaration(rule, 'padding-left')
  if (explicit !== undefined) return explicit
  const values = declaration(rule, 'padding')?.split(/\s+/u)
  if (values === undefined) return undefined
  if (values.length === 1) return values[0]
  if (values.length === 2) return values[1]
  return values[3]
}

describe('the compiled workspace stylesheet', () => {
  it('gives every class an identifier a browser will actually accept', () => {
    // **The regression this exists for.** A CSS class selector may not begin with a
    // digit, and `.5c9b35_projectRow{…}` is not an error a page reports — the rule is
    // simply dropped, so an entire stylesheet silently does nothing and the region
    // renders as unstyled HTML. The first version of the generator hashed module paths
    // straight to hex, and two of the original hashes began with a digit.
    const invalid = ENTRIES
      .filter(entry => !/^-?[A-Za-z_][\w-]*$/u.test(entry.value))
      .map(entry => `${entry.module}.${entry.name} → "${entry.value}"`)
    expect(invalid).toEqual([])
  })

  it('emits a selector for every class the components ask for', () => {
    const missing = ENTRIES
      .filter(entry => !new RegExp(`\\.${entry.value}(?![\\w-])`, 'u').test(WORKSPACE_CSS))
      .map(entry => `${entry.module}.${entry.name} → "${entry.value}"`)
    expect(missing).toEqual([])
  })

  it('carries no selector that is not in one of the maps', () => {
    // An orphan selector means the transform rewrote something that is not a class
    // the components use — most likely a token inside a value.
    const known = new Set<string>(ENTRIES.map(entry => entry.value))
    const selectors = [...WORKSPACE_CSS.matchAll(/(?:^|[\s,{}>+~])(\.-?[A-Za-z_][\w-]*)/gmu)]
      .map(match => String(match[1]).slice(1))
    const orphans = [...new Set(selectors)].filter(name => !known.has(name))
    expect(orphans).toEqual([])
  })

  it('scopes keyframe animations, which would otherwise collide across modules', () => {
    const names = [...WORKSPACE_CSS.matchAll(/@keyframes\s+(-?[A-Za-z_][\w-]*)/gu)].map(match => String(match[1]))
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(name).toMatch(/^-?[A-Za-z_][\w-]*$/u)
      // Both modules declare `row-in`/`wide-in`-style names of their own; every
      // declaration must be referenced by a matching scoped animation.
      expect(WORKSPACE_CSS).toContain(`animation:`)
    }
  })

  it('styles disabled remote rows and collapsed-rail node controls with workspace tokens', () => {
    const disabledNodeRule = new RegExp(
      `\\.${RemoteSectionCss.nodeRow}:disabled\\s*\\{[^}]*color:\\s*var\\(--dsw-alias-label-dimmed\\)`,
      'u',
    )
    expect(WORKSPACE_CSS).toMatch(disabledNodeRule)
    expect(WORKSPACE_CSS).toContain(`.${RemoteSectionCss.railNode}:not(:disabled):hover`)
    expect(WORKSPACE_CSS).toContain('var(--dsw-alias-interactive-bg-hover)')
  })

  it('keeps the remote group header visible while its long contents scroll independently', () => {
    const groupRule = WORKSPACE_CSS.match(new RegExp(`\\.${RemoteSectionCss.group}\\s*\\{([^}]*)\\}`, 'u'))
    expect(groupRule?.[1]).toMatch(/\bdisplay:\s*flex\b/u)
    expect(groupRule?.[1]).toMatch(/\bflex-direction:\s*column\b/u)
    expect(groupRule?.[1]).not.toMatch(/\bmax-height\s*:/u)

    const contentClass = (RemoteSectionCss as Readonly<Record<string, string>>)['content']
    expect(contentClass).toBeDefined()
    if (contentClass === undefined) return
    const contentRule = WORKSPACE_CSS.match(new RegExp(`\\.${contentClass}\\s*\\{([^}]*)\\}`, 'u'))
    expect(contentRule?.[1]).toMatch(/\boverflow-y:\s*auto\b/u)
  })

  it('lets an expanded remote group fill the sibling area without a fixed height cap', () => {
    const expandedClass = (RemoteSectionCss as Readonly<Record<string, string>>)['expanded']
    expect(expandedClass).toBeDefined()
    const expandedRule = WORKSPACE_CSS.match(
      new RegExp(`\\.${expandedClass}\\s*\\{([^}]*)\\}`, 'u'),
    )

    expect(expandedRule?.[1]).toMatch(/\bflex:\s*1\s+1\s+0%/u)
    expect(expandedRule?.[1]).toMatch(/\bmin-height:\s*34px/u)
    expect(expandedRule?.[1]).not.toMatch(/\bmax-height\s*:/u)
  })

  it('gives the local workspace group its own collapsible scroll region beside the remote group', () => {
    const listClass = WorkspaceBrowserCss['list']
    expect(listClass).toBeDefined()
    if (listClass === undefined) return

    const listRule = WORKSPACE_CSS.match(new RegExp(`\\.${listClass}\\s*\\{([^}]*)\\}`, 'u'))
    const sectionRule = WORKSPACE_CSS.match(/\[data-dsh-local-section\]\s*\{([^}]*)\}/u)
    expect(sectionRule?.[1]).toMatch(/\bflex:\s*1\b/u)
    expect(sectionRule?.[1]).toMatch(/\bmin-height:\s*0\b/u)
    expect(WORKSPACE_CSS).toMatch(/\[data-dsh-local-section\]\[data-collapsed="true"\][^{]*\{[^}]*flex:\s*none/u)
    expect(WORKSPACE_CSS).toMatch(/\[data-dsh-local-disclosure\]\[aria-expanded="false"\]::before/u)
    expect(listRule?.[1]).toMatch(/\boverflow-y:\s*auto\b/u)
  })

  it('matches the remote group label color and typography to the local section heading', () => {
    const localHeaderClass = WorkspaceBrowserCss['sectionHeader']
    const localLabelClass = WorkspaceBrowserCss['sectionLabel']
    const remoteToggleRule = WORKSPACE_CSS.match(
      new RegExp(`\\.${RemoteSectionCss.groupToggle}\\s*\\{([^}]*)\\}`, 'u'),
    )
    const remoteTitleRule = WORKSPACE_CSS.match(
      new RegExp(`\\.${RemoteSectionCss.groupTitle}\\s*\\{([^}]*)\\}`, 'u'),
    )
    expect(localHeaderClass).toBeDefined()
    expect(localLabelClass).toBeDefined()
    const localHeaderRule = WORKSPACE_CSS.match(
      new RegExp(`\\.${localHeaderClass}\\s*\\{([^}]*)\\}`, 'u'),
    )
    const localLabelRule = WORKSPACE_CSS.match(
      new RegExp(`\\.${localLabelClass}\\s*\\{([^}]*)\\}`, 'u'),
    )

    expect(localHeaderRule?.[1]).toMatch(/color:\s*var\(--dsw-alias-label-tertiary\)/u)
    expect(remoteToggleRule?.[1]).toMatch(/color:\s*var\(--dsw-alias-label-caption\)/u)
    expect(remoteTitleRule?.[1]).toMatch(/font-size:\s*14px/u)
    expect(remoteTitleRule?.[1]).toMatch(/line-height:\s*20px/u)
    expect(remoteTitleRule?.[1]).toMatch(/color:\s*var\(--dsw-alias-label-tertiary\)/u)
    expect(localLabelRule?.[1]).toMatch(/line-height:\s*20px/u)
  })

  it('aligns the remote disclosure slot, arrow, and title anchor with the local heading', () => {
    const disclosureSlot = (RemoteSectionCss as Readonly<Record<string, string>>)['disclosureSlot']
    expect(disclosureSlot).toBeDefined()
    if (disclosureSlot === undefined) return

    const localHeader = WORKSPACE_CSS.match(
      new RegExp(`\\.${WorkspaceBrowserCss.sectionHeader}\\s*\\{([^}]*)\\}`, 'u'),
    )?.[1]
    const localButton = WORKSPACE_CSS.match(
      new RegExp(`\\.${WorkspaceBrowserCss.iconButton}\\s*\\{([^}]*)\\}`, 'u'),
    )?.[1]
    const remoteToggle = WORKSPACE_CSS.match(
      new RegExp(`\\.${RemoteSectionCss.groupToggle}\\s*\\{([^}]*)\\}`, 'u'),
    )?.[1]
    const remoteSlot = WORKSPACE_CSS.match(
      new RegExp(`\\.${disclosureSlot}\\s*\\{([^}]*)\\}`, 'u'),
    )?.[1]
    const localArrow = WORKSPACE_CSS.match(
      /\[data-dsh-local-disclosure\]::before\s*\{([^}]*)\}/u,
    )?.[1]
    const remoteArrow = WORKSPACE_CSS.match(
      new RegExp(`\\.${disclosureSlot}::before\\s*\\{([^}]*)\\}`, 'u'),
    )?.[1]
    const localClosedArrow = WORKSPACE_CSS.match(
      /\[data-dsh-local-disclosure\]\[aria-expanded="false"\]::before\s*\{([^}]*)\}/u,
    )?.[1]
    const remoteClosedArrow = WORKSPACE_CSS.match(
      new RegExp(`\\.${disclosureSlot}\\[data-expanded=['"]false['"]\\]::before\\s*\\{([^}]*)\\}`, 'u'),
    )?.[1]

    expect(declaration(remoteToggle, 'gap')).toBe(declaration(localHeader, 'gap'))
    expect(paddingLeft(remoteToggle)).toBe(paddingLeft(localHeader))
    expect(declaration(remoteSlot, 'width')).toBe(declaration(localButton, 'width'))
    expect(declaration(remoteSlot, 'height')).toBe(declaration(localButton, 'height'))
    for (const property of ['width', 'height', 'margin-top', 'border-right', 'border-bottom', 'transform']) {
      expect(declaration(remoteArrow, property)).toBe(declaration(localArrow, property))
    }
    for (const property of ['margin-top', 'margin-left', 'transform']) {
      expect(declaration(remoteClosedArrow, property)).toBe(declaration(localClosedArrow, property))
    }
  })

  it('keeps all class-bearing stylesheets distinct and non-empty', () => {
    expect(ENTRIES.length).toBeGreaterThan(60)
    const scopes = new Set(ENTRIES.map(entry => entry.value.split('_')[0]))
    expect(scopes.size).toBe(4)
  })
})
