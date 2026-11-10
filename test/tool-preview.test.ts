import { describe, expect, it } from 'vitest'
import { TOOL_PREVIEW_LIMIT, resultPreview, toolPreview } from '../src/client/tool-preview.js'

describe('tool call previews', () => {
  it('shows the command a bash call ran', () => {
    expect(toolPreview(JSON.stringify({ command: 'uv venv --seed .venv' }))).toBe('uv venv --seed .venv')
  })

  it('collapses a multi-line command to the one line the row has room for', () => {
    const args = JSON.stringify({ command: 'set -e\n\nuv pip install -e .\n' })
    expect(toolPreview(args)).toBe('set -e uv pip install -e .')
  })

  it('prefers the path of a file call over its operation field', () => {
    expect(toolPreview(JSON.stringify({ file_path: 'src/client/wire.ts', limit: 40 })))
      .toBe('src/client/wire.ts')
    expect(toolPreview(JSON.stringify({ path: 'C:\\work\\a.ts', command: 'str_replace' })))
      .toBe('C:\\work\\a.ts')
  })

  it('shows the pattern of a search call', () => {
    expect(toolPreview(JSON.stringify({ pattern: 'TOOL_PREVIEW_LIMIT', include: '*.ts' })))
      .toBe('TOOL_PREVIEW_LIMIT')
  })

  it('caps the preview so one minified line cannot become the row', () => {
    const command = `grep -o "[0-9a-f]" ${'x'.repeat(TOOL_PREVIEW_LIMIT * 2)}`
    const preview = toolPreview(JSON.stringify({ command }))
    expect(preview).toBeDefined()
    expect(preview!.length).toBe(TOOL_PREVIEW_LIMIT + 1)
    expect(preview!.endsWith('…')).toBe(true)
  })

  it('reads the field out of an argument string that was cut before its end', () => {
    // The display preview is a fixed-length cut, so a long call hands over invalid JSON;
    // the field is still readable and must not be replaced by a dump of the fragment.
    const truncated = '{"command":"grep -o \\"0x[0-9a-f]*\\" /tmp/app.js | head -c 200","timeout":'
    expect(toolPreview(truncated)).toBe('grep -o "0x[0-9a-f]*" /tmp/app.js | head -c 200')
  })

  it('keeps a bare argument string as the preview', () => {
    expect(toolPreview('ls -la')).toBe('ls -la')
  })

  it('returns nothing when the arguments describe nothing', () => {
    expect(toolPreview(undefined)).toBeUndefined()
    expect(toolPreview('   ')).toBeUndefined()
    expect(toolPreview(JSON.stringify({ foo: 'bar' }))).toBeUndefined()
    expect(toolPreview(JSON.stringify({ command: '   ' }))).toBeUndefined()
  })

  it('previews a result that arrived without its call from its first line', () => {
    expect(resultPreview('The file src/a.ts has been updated.\nsecond line'))
      .toBe('The file src/a.ts has been updated.')
    expect(resultPreview('\n\n')).toBeUndefined()
    expect(resultPreview(`first ${'y'.repeat(TOOL_PREVIEW_LIMIT * 2)}`))
      .toHaveLength(TOOL_PREVIEW_LIMIT + 1)
  })
})
