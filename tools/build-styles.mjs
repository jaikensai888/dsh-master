/**
 * Compile the forked CSS modules into a TypeScript module.
 *
 * Upstream ships `.module.css` files and lets its bundler produce a hashed class map
 * plus an injected `<style>`. This repository has no CSS loader, and adding one for
 * four stylesheets would mean a plugin in the build for every future reader to
 * understand. So the compilation happens once, here, into
 * `src/workspace/styles.generated.ts` — which is committed, because `pnpm typecheck`
 * and `pnpm test` must work on a checkout that has not run the generator.
 *
 * The transform mirrors what the shipped bundle contains, verified against it: a
 * class `.foo` becomes `.<hash>_foo`, and a `@keyframes bar` becomes
 * `@keyframes <hash>_bar` together with every `animation:`/`animation-name:` reference
 * to it — without that prefix the two modules' animations would collide in one
 * document, which is exactly the bug the official hash avoids.
 *
 * Usage: `node tools/build-styles.mjs` (writes) or `--check` (fails on drift).
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UPSTREAM = 'G:/claude_project/code-agent/deepseek-harness/packages/client/ui-workspace/src/client'
const LOCAL = join(ROOT, 'src/workspace')
const OUTPUT = 'src/workspace/styles.generated.ts'
const TAG_ID = 'dsh-master/workspace.css'

/** The stylesheets carried across, in cascade order, with their generated identifiers. */
const MODULES = [
  { file: 'rows/Rows.module.css', identifier: 'RowsCss', source: 'upstream' },
  { file: 'rows/WorkspaceBrowser.module.css', identifier: 'WorkspaceBrowserCss', source: 'upstream' },
  { file: 'LocalSection.module.css', identifier: 'LocalSectionCss', source: 'local' },
  { file: 'WorkspacePicker.module.css', identifier: 'WorkspacePickerCss', source: 'upstream' },
  { file: 'RemoteSection.module.css', identifier: 'RemoteSectionCss', source: 'local' },
]

/**
 * The scope prefix for one stylesheet.
 *
 * Derived from the module path rather than its contents so that editing a rule does
 * not rewrite every class name in the generated file — a diff should show the rule
 * that changed, not the whole map.
 *
 * **It always starts with a letter, and that is the whole point.** A CSS class
 * selector may not begin with a digit: `.5c9b35_projectRow{…}` is a parse error, and a
 * browser drops the rule it appears in. Two of the three hashes here used to begin with
 * a digit, so two of the three stylesheets were dead on arrival and the sidebar rendered
 * as unstyled HTML — correct data, default buttons, default inputs, no indentation.
 * Prefixing with `dsh` costs three characters and removes the failure mode entirely.
 *
 * @param file - module path relative to the upstream `client` directory.
 * @returns an identifier-safe prefix.
 */
function scopeOf(file) {
  return `dsh${createHash('sha256').update(`dsh-master/workspace/${file}`).digest('hex').slice(0, 5)}`
}

/**
 * Whether a name is usable as a CSS identifier.
 *
 * The guard below runs it over every class and keyframe this script emits, because the
 * failure it catches is silent: invalid selectors do not throw, they are skipped, and
 * the result looks like "the stylesheet did not load" rather than "one character is
 * wrong".
 *
 * @param name - a class or keyframe name.
 * @returns true when the name is a valid unescaped identifier.
 */
function isCssIdentifier(name) {
  return /^-?[A-Za-z_][\w-]*$/u.test(name)
}

/**
 * Compile one stylesheet.
 *
 * @param source - the `.module.css` text.
 * @param scope - the class prefix.
 * @returns the scoped CSS and the class map.
 */
function compile(source, scope) {
  const keyframes = new Set(
    [...source.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/gu)].map(match => match[1]),
  )
  const classes = new Set(
    [...source.matchAll(/\.([A-Za-z_][\w-]*)/gu)].map(match => match[1]),
  )

  let css = source
  for (const name of classes) {
    css = css.replace(new RegExp(`\\.${name}(?![\\w-])`, 'gu'), `.${scope}_${name}`)
  }
  for (const name of keyframes) {
    // The declaration and every reference, so `animation: row-in …` still resolves.
    css = css.replace(new RegExp(`(@keyframes\\s+)${name}(?![\\w-])`, 'gu'), `$1${scope}_${name}`)
    css = css.replace(new RegExp(`(animation(?:-name)?\\s*:[^;]*?)\\b${name}\\b`, 'gu'), `$1${scope}_${name}`)
  }

  const map = [...classes].sort().map(name => `    ${JSON.stringify(name)}: '${scope}_${name}',`).join('\n')

  // Fail here rather than in a browser. An invalid selector is not an error a page
  // reports — it is a rule that quietly does not exist, which reads as "the stylesheet
  // never loaded".
  for (const name of classes) {
    if (!isCssIdentifier(`${scope}_${name}`)) {
      throw new Error(`${source.slice(0, 0)}class ".${scope}_${name}" is not a valid CSS identifier`)
    }
  }
  for (const name of keyframes) {
    if (!isCssIdentifier(`${scope}_${name}`)) {
      throw new Error(`keyframes "${scope}_${name}" is not a valid CSS identifier`)
    }
  }

  return { css: css.trim(), map, count: classes.size }
}

const compiled = MODULES.map((module) => {
  const root = module.source === 'local' ? LOCAL : UPSTREAM
  const source = readFileSync(join(root, module.file), 'utf8')
  return { ...module, ...compile(source, scopeOf(module.file)) }
})

const allCss = compiled.map(entry => entry.css).join('\n\n')

const output = `/*
 * GENERATED by tools/build-styles.mjs — do not edit by hand.
 *
 * Compiled from @deepseek-ai/dsh-client-ui-workspace (MIT, Copyright (c) 2026 DeepSeek),
 * out of packages/client/ui-workspace/src/client at version 0.1.2-rc.1.
 * Regenerate with: node tools/build-styles.mjs
 */

${compiled.map(entry => `/** Class map for \`${entry.file}\`. */\nexport const ${entry.identifier} = {\n${entry.map}\n} as const\n`).join('\n')}
/**
 * The concatenated stylesheets, in cascade order.
 *
 * One \`<style>\` for all five: their selectors are already scoped, so separate tags
 * would only add five DOM nodes and five chances to leak one on unload.
 */
export const WORKSPACE_CSS = ${JSON.stringify(allCss)}

/** The tag id this module owns, so a reload can find and rewrite it. */
export const WORKSPACE_CSS_TAG_ID = ${JSON.stringify(TAG_ID)}

/**
 * Inject the stylesheets, or rewrite them when they are already present.
 *
 * Rewriting unconditionally is what lets a client HMR reload pick up an edited rule:
 * the module is re-executed in place, and a tag left untouched would keep the previous
 * declarations winning the cascade.
 *
 * @returns the style element, or \`undefined\` in a non-browser context.
 */
export function ensureWorkspaceStyles(): HTMLStyleElement | undefined {
  if (typeof document === 'undefined') return undefined
  const existing = document.getElementById(WORKSPACE_CSS_TAG_ID)
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== WORKSPACE_CSS) existing.textContent = WORKSPACE_CSS
    return existing
  }
  const tag = document.createElement('style')
  tag.id = WORKSPACE_CSS_TAG_ID
  tag.dataset['pluginCss'] = WORKSPACE_CSS_TAG_ID
  tag.textContent = WORKSPACE_CSS
  document.head.appendChild(tag)
  return tag
}

/** Remove the injected stylesheet. Safe to call when it was never added. */
export function disposeWorkspaceStyles(): void {
  if (typeof document === 'undefined') return
  document.getElementById(WORKSPACE_CSS_TAG_ID)?.remove()
}
`

const destination = join(ROOT, OUTPUT)
if (process.argv.includes('--check')) {
  const current = readFileSync(destination, 'utf8')
  if (current !== output) {
    console.error(`${OUTPUT} is stale — run: node tools/build-styles.mjs`)
    process.exit(1)
  }
  console.log(`ok: ${OUTPUT} matches the CSS modules`)
} else {
  writeFileSync(destination, output, 'utf8')
  const classes = compiled.reduce((total, entry) => total + entry.count, 0)
  console.log(`wrote ${OUTPUT}: ${String(compiled.length)} stylesheets, ${String(classes)} classes, ${String(allCss.length)} bytes`)
}
