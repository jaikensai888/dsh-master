/*
 * The connection event this plugin observes, added to Cordis's event table.
 *
 * This lives in its own file, and not in `src/upstream.d.ts`, for a reason worth
 * recording: `@deepseek-ai/cordis` **is installed**, so a `declare module` block for it
 * inside a non-module declaration file is an *ambient module declaration* — it replaces
 * the package's real types wholesale rather than adding to them. The symptom is
 * spectacular and unrelated to the change: `Context.effect`, `.get`, `.provide` and
 * `.inject` all vanish, and every host-side file fails to compile.
 *
 * A file with a top-level `export {}` is a module, and inside one the same block is a
 * *module augmentation* — the real types stay, and this key is added to them.
 */

export {}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The browser reconnected: every generation-scoped fact must be re-read.
     *
     * `hostInfo` re-reads `ctx.remote.$host` here, so the picker's home-directory
     * abbreviation follows a reconnect instead of freezing at the first render's value.
     */
    'connection/reset'(): void
  }
}
