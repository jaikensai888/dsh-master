#!/usr/bin/env node
/**
 * Replay one real remote session through the wire parser.
 *
 * It reads the opening snapshot of `session/follow` from a running dsh-master
 * (loopback, no token) and prints how the panel would group it: one line per
 * conversation item, with the turn status, elapsed time and row counts. Use it
 * when a screenshot and the local conversation disagree — the question is
 * usually whether the node sent the facts or the panel dropped them.
 *
 *   node tools/replay-remote-session.mjs --node <nodeId> --session <sessionId>
 *   node tools/replay-remote-session.mjs --node … --session … --base http://127.0.0.1:52166
 *
 * Read-only: it fetches a snapshot, writes nothing, and stops before the live tail.
 */
import { conversationItems, readSnapshot } from '../src/client/wire.ts'

/** Parse `--name value` pairs. */
function options(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!key?.startsWith('--') || argv[index + 1] === undefined) return undefined
    values.set(key.slice(2), argv[index + 1])
  }
  return values
}

const args = options(process.argv.slice(2))
const nodeId = args?.get('node')
const sessionId = args?.get('session')
if (args === undefined || nodeId === undefined || sessionId === undefined) {
  console.error('usage: node tools/replay-remote-session.mjs --node <nodeId> --session <sessionId> [--base <url>]')
  process.exit(2)
}
const base = args.get('base') ?? 'http://127.0.0.1:52166'

const controller = new AbortController()
const url = `${base}/dsh-master/api/session/follow?nodeId=${encodeURIComponent(nodeId)}&sessionId=${encodeURIComponent(sessionId)}`
const response = await fetch(url, { signal: controller.signal })
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${await response.text()}`)
  process.exit(1)
}

/** Read NDJSON frames until the snapshot arrives; the live tail is not needed. */
async function readSnapshotFrame(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line === '') continue
      const record = JSON.parse(line)
      if (record.type === 'data' && record.value?.type === 'snapshot') return record.value
    }
  }
  return undefined
}

const value = await readSnapshotFrame(response.body)
controller.abort()
if (value === undefined) {
  console.error('the follow stream carried no snapshot')
  process.exit(1)
}

const view = readSnapshot(value)
if (view === undefined) {
  console.error('the snapshot did not parse')
  process.exit(1)
}
const kinds = {}
for (const row of view.rows) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1
console.log(`records=${String(value.records.length)} rows=${String(view.rows.length)} `
  + `turnEvents=${String(view.turnEvents.length)} unrendered=${String(view.unrendered)}`)
console.log(`kinds=${JSON.stringify(kinds)}`)
console.log('')
for (const [index, item] of conversationItems(view.rows, view.turnEvents).entries()) {
  if (item.kind !== 'turn-group') {
    console.log(`#${String(index)} ${item.kind.padEnd(10)} ${item.text.slice(0, 80).replace(/\n/gu, ' ')}`)
    continue
  }
  const seconds = item.durationMs === undefined ? '-' : String(Math.round(item.durationMs / 1000))
  console.log(`#${String(index)} turn-group status=${item.status} seconds=${seconds} `
    + `process=${String(item.process.length)} answer=${String(item.answer.length)} `
    + `visible=${String(item.visible.length)}${item.compatibility === undefined ? '' : ' (incomplete)'}`)
  for (const row of item.process.slice(0, 4)) {
    console.log(`             ${row.kind.padEnd(10)} ${row.text.slice(0, 72).replace(/\n/gu, ' ')}`)
  }
}
