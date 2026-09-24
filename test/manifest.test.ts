import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The parsed `package.json`. */
async function manifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
}

describe('DSH plugin manifest', () => {
  it('exports ./package.json, without which the client half is silently dropped', async () => {
    // `@deepseek-ai/dsh-client-modules` locates a plugin's manifest with
    // `createRequire(baseUrl).resolve('<name>/package.json')`. A package with an
    // `exports` map seals that subpath unless it is exported explicitly, resolution
    // fails, and the host skips the package **with no log line at all** — the plugin
    // runs on the host and never appears in the browser. `dsh-node` lost its own UI
    // to this exact omission.
    const exports = (await manifest())['exports'] as Record<string, unknown>
    expect(exports['./package.json']).toBe('./package.json')
  })

  it('declares a web client bundle and the slot registry it injects', async () => {
    const dsh = (await manifest())['dsh'] as Record<string, unknown>
    const client = dsh['client'] as Record<string, unknown>
    expect(client['platform']).toBe('web')
    expect(client['inject']).toContain('@deepseek-ai/dsh-client-ui-slots')
    const exports = (await manifest())['exports'] as Record<string, unknown>
    expect(exports['./client']).toBeDefined()
  })

  it('points dsh.bundle.patch at a file that exists', async () => {
    const dsh = (await manifest())['dsh'] as Record<string, unknown>
    const bundle = dsh['bundle'] as Record<string, unknown>
    const patch = bundle['patch'] as string
    const text = await readFile(join(ROOT, patch), 'utf8')
    expect(text).toContain('id: dsh-master')
  })

  it('disables the shipped workspace entry before installing the fork', async () => {
    const dsh = (await manifest())['dsh'] as Record<string, unknown>
    const bundle = dsh['bundle'] as Record<string, unknown>
    const patch = bundle['patch'] as string
    const text = await readFile(join(ROOT, patch), 'utf8')
    expect(text).toMatch(/- id: ui-workspace\s+disabled: true/gu)
  })

  it('names the plugin the same in package.json and in the module', async () => {
    const name = (await manifest())['name']
    const source = await readFile(join(ROOT, 'src/index.ts'), 'utf8')
    expect(source).toContain(`export const name = '${String(name)}'`)
  })

  it('declares no runtime dependency it does not use', async () => {
    // The host bundle keeps `schemastery` external, so it has to be a real dependency
    // rather than a dev one — otherwise the plugin installs and then fails to load.
    const dependencies = (await manifest())['dependencies'] as Record<string, string>
    const source = await readFile(join(ROOT, 'src/config.ts'), 'utf8')
    expect(source).toContain("from 'schemastery'")
    expect(dependencies['schemastery']).toBeDefined()
  })
})
