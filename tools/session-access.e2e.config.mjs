// Source-level integration needs sibling checkouts and the harness's locked dev dependencies.
import ts from '../../deepseek-harness/node_modules/typescript/lib/typescript.js'
import { standardDecoratorPlugin } from '../../deepseek-harness/vitest.shared.ts'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const harness = fileURLToPath(new URL('../../deepseek-harness/', import.meta.url))
const options = ts.readConfigFile(resolve(harness, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions
const alias = Object.entries(options.paths).map(([key, targets]) => ({
  find: key.includes('*') ? new RegExp('^' + key.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*)') + '$') : key,
  replacement: resolve(harness, targets[0]).replace('*', '$1'),
}))

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias },
  plugins: [standardDecoratorPlugin()],
  test: { pool: 'forks', include: ['tools/session-access.e2e.test.ts'], testTimeout: 20000, hookTimeout: 20000 },
  define: { __DSH_NODE_BUILD_INFO_JSON__: JSON.stringify(JSON.stringify({ version: JSON.parse(readFileSync(new URL('../../dsh-node/package.json', import.meta.url), 'utf8')).version, channel: 'dev', commit: null, dirty: null, builtAt: new Date().toISOString() })) },
}
