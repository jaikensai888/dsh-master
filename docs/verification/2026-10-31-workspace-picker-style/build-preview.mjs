/**
 * Bundle the isolated picker preview.
 *
 * Only `@deepseek-ai/dsh-client-ui-primitives` is aliased, because the shipped
 * package imports CSS modules plus shiki/katex. The chooser component, the
 * generated stylesheet and the locale strings come from `src/`.
 *
 * Usage: node docs/verification/2026-10-31-workspace-picker-style/build-preview.mjs
 */
import { build } from 'tsdown'
import { resolve } from 'node:path'

const dir = 'docs/verification/2026-10-31-workspace-picker-style'

await build({
  config: false,
  entry: { 'preview-bundle': `${dir}/preview.tsx` },
  outDir: dir,
  format: 'iife',
  platform: 'browser',
  clean: false,
  dts: false,
  noExternal: () => true,
  alias: {
    '@deepseek-ai/dsh-client-ui-primitives': resolve(dir, 'preview-primitives.tsx'),
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
})
