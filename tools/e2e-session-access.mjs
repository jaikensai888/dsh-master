/** Exercise real host services, Gateway, node socket, Coordinator and master HTTP on loopback. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const runner = fileURLToPath(new URL('../../deepseek-harness/node_modules/vitest/vitest.mjs', import.meta.url))
const config = fileURLToPath(new URL('./session-access.e2e.config.mjs', import.meta.url))
const child = spawn(process.execPath, [runner, 'run', '--config', config], { cwd: root, stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
