import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

/**
 * Whether a source path belongs to a browser half of the plugin.
 *
 * Two directories, not one: `src/client/` is this plugin's own UI, and
 * `src/workspace/` is the forked upstream workspace browser. Both end up in
 * `lib/client.js` and neither may touch a Node builtin — or, for that matter, be
 * counted as host code by the DOM guard below, which would fail on the fork's own
 * `document`-using style injector.
 *
 * @param file - repository-relative path.
 * @returns true when the file is bundled into the browser half.
 */
function isBrowserHalf(file: string): boolean {
  return file.startsWith('src/client/') || file.startsWith('src/workspace/')
}

/**
 * Every source file under `src`, as repo-relative POSIX paths.
 * @returns the file list.
 */
async function sourceFiles(): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        found.push(relative(ROOT, full).split('\\').join('/'))
      }
    }
  }
  await walk(SRC)
  return found.sort()
}

describe('host half stays free of browser globals', () => {
  it('never reaches for a DOM global outside src/client', async () => {
    const files = await sourceFiles()
    const client = files.filter(isBrowserHalf)
    const host = files.filter(file => !isBrowserHalf(file))

    // If the browser files are not found, the guard below passes vacuously after a
    // rename — which is exactly how a guard like this stops protecting anything.
    expect(client.length).toBeGreaterThanOrEqual(15)
    expect(host.length).toBeGreaterThanOrEqual(6)

    // A dot followed by an identifier, so prose that says "…window." is not a hit.
    const domUse = /\b(document|window|navigator|localStorage|HTMLElement|HTMLStyleElement)\s*\./u
    const offenders: string[] = []
    for (const file of host) {
      const text = await readFile(join(ROOT, file), 'utf8')
      if (domUse.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('keeps the browser halves from reaching for Node built-ins', async () => {
    const files = (await sourceFiles()).filter(isBrowserHalf)
    const offenders: string[] = []
    for (const file of files) {
      const text = await readFile(join(ROOT, file), 'utf8')
      // A browser script that imports a `node:` builtin fails to resolve when the page
      // materialises it, and DSH reports nothing when that happens.
      if (/from\s+'node:/u.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
