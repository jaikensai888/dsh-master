import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const runtime = process.env['DSH_RUNTIME_ROOT']

describe.skipIf(runtime === undefined)('installed DSH runtime contract', () => {
  it('exports every primitive imported by the plugin (including icons)', async () => {
    const upstream = await readFile(join(runtime!, '@deepseek-ai/dsh-client-ui-primitives/lib/index.js'), 'utf8')
    const exported = upstream.match(/export \{([^}]+)\}/gu)?.at(-1) ?? ''
    const missing = new Set<string>()
    async function inspect(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { await inspect(path); continue }
        if (!/\.tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) continue
        const file = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
        for (const statement of file.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== '@deepseek-ai/dsh-client-ui-primitives') continue
          const clause = statement.importClause
          if (clause?.isTypeOnly || clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue
          for (const symbol of clause.namedBindings.elements) {
            if (symbol.isTypeOnly) continue
            const name = (symbol.propertyName ?? symbol.name).text
            if (!new RegExp(`\\b${name}\\b`, 'u').test(exported)) missing.add(name)
          }
        }
      }
    }
    await inspect('src')
    expect([...missing]).toEqual([])
  })
})
