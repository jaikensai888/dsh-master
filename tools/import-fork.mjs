/**
 * Import the upstream workspace browser as a starting point for this plugin's fork.
 *
 * ## Why a script instead of a copy
 *
 * The fork is upstream code, and the one thing that must stay checkable is **how it
 * differs**. This script is the record: it copies the named files and applies exactly
 * the mechanical rewrites listed in {@link rewrite}, nothing else. Re-running it gives
 * the same result, so a reviewer can see the whole transformation instead of trusting
 * a hand-edited copy.
 *
 * ## Source
 *
 * `deepseek-harness/packages/client/ui-workspace/src` at **0.1.2-rc.1**, MIT,
 * Copyright (c) 2026 DeepSeek. The running DSH is **0.1.5-rc.2** and ships no source
 * (`@deepseek-ai/*` publishes zero `.d.ts` and no `src/`), so this older tree is the
 * only readable implementation. The version delta is reconciled in
 * `src/workspace/upstream.d.ts` and recorded in `docs/GROUND-TRUTH.md`.
 *
 * ## Not imported
 *
 * - `src/index.ts` — upstream's host half is an empty `apply()`; ours is real.
 * - `tests/` — upstream's suite targets upstream's internals, not this fork's.
 * - `WorkspacePicker.module.css` — see {@link CSS_MODULES}; the picker component comes
 *   across but its stylesheet is generated on the same footing as the other two.
 *
 * Usage: `node tools/import-fork.mjs` (writes) or `--check` (verifies, exits non-zero
 * on drift). `--check` compares only the rewritten prefix, because local edits after
 * the import are this repository's own and must not be flagged as drift.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = 'G:/claude_project/code-agent/deepseek-harness/packages/client/ui-workspace/src'
const DEST_DIR = 'src/workspace'
const UPSTREAM_VERSION = '0.1.2-rc.1'

/** Upstream paths (relative to `SRC`) that this fork carries, with their local names. */
const FILES = [
  ['client/contract/slots.ts', 'contract/slots.ts'],
  ['client/tree.ts', 'tree.ts'],
  ['client/navigation.ts', 'navigation.ts'],
  ['client/stores.ts', 'stores.ts'],
  ['client/subagent-lineage.ts', 'subagent-lineage.ts'],
  ['client/locales.ts', 'locales.ts'],
  ['client/WorkspacePicker.tsx', 'WorkspacePicker.tsx'],
  ['client/rows/Rows.tsx', 'rows/Rows.tsx'],
  ['client/rows/WorkspaceBrowser.tsx', 'rows/WorkspaceBrowser.tsx'],
]

/**
 * CSS modules carried across, and the identifier each is exported as.
 *
 * Upstream imports these directly and its bundler turns them into a hashed class map
 * plus an injected `<style>`. This repository has no CSS loader, so
 * `tools/build-styles.mjs` pre-generates the same thing into `styles.generated.ts` and
 * the import below is rewritten to point at it.
 */
const CSS_MODULES = [
  ['client/rows/Rows.module.css', 'RowsCss'],
  ['client/rows/WorkspaceBrowser.module.css', 'WorkspaceBrowserCss'],
  ['client/WorkspacePicker.module.css', 'WorkspacePickerCss'],
]

/**
 * The relative prefix that reaches `styles.generated.ts` from a destination file.
 *
 * The depth is the number of **directory** segments in the destination path: a file
 * directly under `src/workspace/` needs `./`, one under `src/workspace/rows/` needs
 * `../`. Getting this wrong still type-checks nothing and still bundles — it fails
 * only at page load, which is the failure mode this whole plugin keeps having to
 * design around.
 *
 * @param destination - repository-relative destination path.
 * @returns `./` or `../` repeated to depth.
 */
function stylesPrefix(destination) {
  const depth = destination.split('/').length - 1
  return `${'../'.repeat(depth) || './'}`
}

/**
 * Apply the mechanical rewrites to one upstream file.
 *
 * @param raw - upstream file text.
 * @param destination - repository-relative destination path (decides relative prefixes).
 * @param cssNames - upstream CSS-module basenames mapped to their exported identifier.
 * @returns the rewritten text.
 */
function rewrite(raw, destination, cssNames) {
  const prefix = stylesPrefix(destination)
  return raw
    // 1. NodeNext requires an emitted import to name the `.js` it resolves to;
    //    upstream writes `.ts`/`.tsx` because its own resolver accepts them.
    .replace(/(from\s+')(\.[^']*?)\.tsx?(')/gu, '$1$2.js$3')
    // 2. `@deepseek-ai/dsh-util-workspace-path` is the fork's only runtime dependency
    //    that is NOT in the shell's frozen platform module table, so it could never
    //    resolve in the page. Two pure path helpers are inlined instead.
    .replace(/from '@deepseek-ai\/dsh-util-workspace-path'/gu, `from '${prefix}workspace-path.js'`)
    // 3. CSS modules resolve to the generated module instead of the stylesheet.
    .replace(/import css from '\.{1,2}\/([A-Za-z]+)\.module\.css'/gu, (_match, name) => {
      const identifier = cssNames.get(`${name}.module.css`)
      if (identifier === undefined) throw new Error(`unmapped CSS module ${name}.module.css in ${destination}`)
      return `import { ${identifier} as css } from '${prefix}styles.generated.js'`
    })
}

/**
 * The provenance banner every imported file carries.
 * @param upstreamPath - the file's path inside the upstream package.
 * @returns the banner text.
 */
function banner(upstreamPath) {
  return `/*
 * FORKED from @deepseek-ai/dsh-client-ui-workspace (MIT, Copyright (c) 2026 DeepSeek).
 * Upstream: packages/client/ui-workspace/${upstreamPath} @ ${UPSTREAM_VERSION}
 * Regenerate the mechanical part with: node tools/import-fork.mjs
 * Local edits are expected and preserved — the --check mode compares only the
 * rewritten import header, never the body.
 */
`
}

/** How many leading lines `--check` compares. */
const CHECK_LINES = 24

const check = process.argv.includes('--check')
const cssNames = new Map(CSS_MODULES.map(([path, identifier]) => [path.split('/').pop(), identifier]))
const problems = []
let written = 0
let skipped = 0

for (const [upstreamPath, destinationPath] of FILES) {
  const destination = join(ROOT, DEST_DIR, destinationPath)
  const next = `${banner(upstreamPath)}${rewrite(readFileSync(join(SRC, upstreamPath), 'utf8'), destinationPath, cssNames)}`

  if (check) {
    const current = existsSync(destination) ? readFileSync(destination, 'utf8') : undefined
    const expectedHeader = next.split('\n').slice(0, CHECK_LINES).join('\n')
    if (current === undefined || !current.startsWith(expectedHeader)) {
      problems.push(relative(ROOT, destination).split(sep).join('/'))
    }
    continue
  }

  if (existsSync(destination)) {
    // Local edits live in these files; overwriting would silently discard them.
    console.log(`skip (exists): ${relative(ROOT, destination).split(sep).join('/')}`)
    skipped += 1
    continue
  }
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, next, 'utf8')
  written += 1
  console.log(`imported: ${relative(ROOT, destination).split(sep).join('/')}`)
}

if (check) {
  if (problems.length > 0) {
    console.error(`drift in ${String(problems.length)} file(s):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`ok: ${String(FILES.length)} imported files reproduce the transform`)
} else {
  console.log(`done: ${String(written)} written, ${String(skipped)} skipped (already present)`)
}
