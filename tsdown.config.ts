import type { UserConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-master'

/**
 * Specifiers a DSH client bundle may `require()` at runtime.
 *
 * This is the platform module table of `@deepseek-ai/dsh-client-modules`, verified
 * against the shipped shell's own factory (`dsh-web-frontend/dist/assets/index-*.js`
 * seeds `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
 * `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`,
 * `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives` and
 * `@deepseek-ai/dsh-client-ui-dockkit`). Anything else must be bundled in: a specifier
 * outside the table throws when the page materialises the factory, and DSH reports
 * nothing when that happens — the client half simply never appears. `dsh-node` lost a
 * footer row to exactly this.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is the shipped atom library (`Button`,
 * `StateDot`, `Pill`, `MarkdownText`, `TerminalBlock`, `DiffBlock`, `Menu`, `Modal`,
 * ~70 icons). It is an external here so the panel uses the same controls, icons and
 * `--dsw-*` tokens as the rest of the app instead of a second visual language.
 * `test/client-bundle.test.ts` asserts the built bundle requires nothing outside this
 * list.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Build the classic-script client bundle.
 *
 * The banner/intro/footer trio is the whole protocol: `lib/client.js` must be a
 * `window.__ModuleLoader__.load({...})` call whose factory only *registers* the
 * module — component code runs when the factory is materialised, not at parse time.
 *
 * @param entryFile - output file name inside `outDir`.
 * @param moduleId - the id the page's module system keys this bundle by.
 * @returns the tsdown config for the client half.
 */
function clientBundle(entryFile: string, moduleId: string): UserConfig {
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    // Never clean: DSH Desktop holds `lib/*.js` open, and in-place overwrite is
    // what lets the client HMR watcher hot-swap the half.
    clean: false,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: entryFile,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(moduleId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/**
 * Two halves, two bundles.
 *
 * The host half is ESM for Node and keeps `schemastery` a real import: bundling it
 * would inline a schema validator and hide a runtime dependency from `files`.
 *
 * `clean` is false on purpose — DSH Desktop holds `lib/*.js` open while the profile
 * is mounted, so removing the directory fails with EPERM on Windows.
 */
export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['schemastery'],
  },
  clientBundle('client.js', PACKAGE_ID),
] satisfies UserConfig[]
