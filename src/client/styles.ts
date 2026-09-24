/**
 * Panel styling.
 *
 * Everything here reads DSH's own design tokens (`--dsw-*`, `--dsh-*`, `--dsl-*`), and
 * the geometry copies the shipped clients rather than being invented:
 *
 * - user bubble: `--dsw-specific-bubble`, `border-radius:22px`, `padding:10px 16px` —
 *   the rule `ui-chat` gives its own bubble;
 * - code surfaces: `--dsl-code-block-background` with `--ds-font-family-code`;
 * - hairline dividers: `.5px solid var(--dsw-alias-border-l2)`.
 *
 * The first version of this file derived its colours from `currentColor` with
 * `color-mix`, because the token names had not been read yet. That lands *somewhere
 * near* the theme in both light and dark and exactly right in neither; a token is the
 * only thing that follows a theme switch or a font-size change.
 *
 * The style tag is owned, not leaked: the client-modules loader tracks the tags its own
 * records created, so {@link disposeStyles} exists and the plugin entry wires it to its
 * effect. {@link ensureStyles} rewrites the text every time, which is what makes a
 * client HMR reload pick up edited rules instead of leaving the old ones winning.
 *
 * @module dsh-master/client/styles
 */

const TAG_ID = 'dsh-master/styles'

const CSS = `
.dsh-master-root {
  display: flex;
  height: 100%;
  min-height: 0;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.dsh-master-log { scrollbar-width: thin; }
.dsh-master-log::-webkit-scrollbar { width: 8px; }
.dsh-master-log::-webkit-scrollbar-thumb {
  background: var(--dsh-scrollbar-thumb, transparent);
  border-radius: 4px;
}
.dsh-master-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.dsh-master-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
}
.dsh-master-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-meta {
  flex: none;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-hint {
  padding: 4px 8px 8px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-error {
  margin: 0 8px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}
.dsh-master-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  flex: none;
  padding: 0 12px;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.dsh-master-head .dsh-master-label {
  flex: 0 1 auto;
  font-size: var(--dsh-content-font-size, 14px);
  font-weight: 600;
}
.dsh-master-log {
  flex: 1 1 auto;
  overflow: auto;
  padding: 16px 20px 8px;
}
.dsh-master-turn { margin: 0 0 14px; }
.dsh-master-turn[data-role='user'] { display: flex; flex-direction: column; align-items: flex-end; }
.dsh-master-role {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
  margin-bottom: 2px;
}
.dsh-master-text {
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.dsh-master-bubble {
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * .702), 82%);
  background: var(--dsw-specific-bubble);
  border-radius: 22px;
  padding: 10px 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
}
.dsh-master-code {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: var(--dsl-code-block-border-radius, 8px);
  border: .5px solid var(--dsw-alias-border-l2);
  background: var(--dsl-code-block-background, var(--dsw-alias-bg-layer-2));
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
}
.dsh-master-tool { margin: 0 0 10px; }
.dsh-master-tool[data-failed='true'] .dsh-master-code {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-master-tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-master-tool[data-failed='true'] .dsh-master-tool-head {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-master-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-composer {
  flex: none;
  border-top: .5px solid var(--dsw-alias-border-l2);
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-master-composer textarea {
  box-sizing: border-box;
  width: 100%;
  font: inherit;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-input-major, transparent);
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 8px 12px;
  resize: vertical;
  min-height: 56px;
}
.dsh-master-composer textarea::placeholder { color: var(--dsw-alias-label-caption); }
.dsh-master-composer textarea:focus-visible {
  outline: 1.5px solid var(--dsw-alias-button-info-fill, var(--dsw-alias-brand-primary));
  outline-offset: -1px;
}
.dsh-master-composer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-master-composer-actions .dsh-master-label { flex: 1 1 auto; }
.dsh-master-modes { display: inline-flex; gap: 4px; }
`

/**
 * Append the panel stylesheet, or rewrite it when it is already there.
 *
 * Rewriting unconditionally is what lets a client HMR reload pick up an edited rule:
 * the module is re-executed in place, and a tag left untouched would keep the previous
 * declarations winning the cascade.
 *
 * @returns the style element, or `undefined` in a non-browser context.
 */
export function ensureStyles(): HTMLStyleElement | undefined {
  if (typeof document === 'undefined') return undefined
  const existing = document.getElementById(TAG_ID)
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== CSS) existing.textContent = CSS
    return existing
  }
  const tag = document.createElement('style')
  tag.id = TAG_ID
  tag.dataset['plugin'] = 'dsh-master'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return tag
}

/** Remove the panel stylesheet. Safe to call when it was never added. */
export function disposeStyles(): void {
  if (typeof document === 'undefined') return
  document.getElementById(TAG_ID)?.remove()
}
