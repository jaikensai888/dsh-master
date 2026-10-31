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

/** The panel stylesheet. Exported so a preview harness can render the real rules. */
export const PANEL_CSS = `
.dsh-master-root {
  --dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width, 0px) * .64), 920px));
  --dsh-composer-side-clearance: 16px;
  display: flex;
  height: 100%;
  min-height: 0;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
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
  scrollbar-width: thin;
  padding: 16px calc(var(--dsh-composer-side-clearance) + 16px) 8px;
}
.dsh-master-log-column {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--dsh-chat-content-width);
  margin: 0 auto;
}
.dsh-master-turn { margin: 0 0 14px; }
.dsh-master-turn-group { min-width: 0; margin: 8px 0 16px; }
.dsh-master-process-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  width: fit-content;
  max-width: 100%;
  padding: 2px 0;
  list-style: none;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
}
.dsh-master-process-summary::-webkit-details-marker { display: none; }
.dsh-master-process-summary svg { flex: none; width: 14px; height: 14px; }
.dsh-master-process[open] > .dsh-master-process-summary > svg { transform: rotate(180deg); }
.dsh-master-process-summary:focus-visible,
.dsh-master-reasoning > summary:focus-visible,
.dsh-master-context > summary:focus-visible { outline: 1.5px solid var(--dsw-focus-ring-color); outline-offset: 3px; }
.dsh-master-process-body { padding: 8px 0; }
.dsh-master-turn-group[data-state='error'] > .dsh-master-process > summary { color: var(--dsw-alias-state-error-primary); }
.dsh-master-response { margin-top: 8px; padding-top: 16px; border-top: .5px solid var(--dsw-alias-border-l2); }
.dsh-master-response > .dsh-master-turn { margin-bottom: 0; }
.dsh-master-reasoning { margin: 4px 0 10px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-master-reasoning > summary { cursor: pointer; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 24px; }
.dsh-master-reasoning[open] > summary { margin-bottom: 8px; }
.dsh-master-context { margin: 2px 0 8px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dsh-master-context > summary { cursor: pointer; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 22px; }
.dsh-master-context[open] > summary { margin-bottom: 6px; }
.dsh-master-context-body {
  padding: 0 0 0 10px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
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
.dsh-master-tool { display: flex; flex-direction: column; margin: 0 0 4px; }
.dsh-master-tool-row {
  position: relative;
  display: flex;
  align-items: center;
  height: calc(24px + var(--dsh-content-font-delta, 0px));
  min-width: 0;
  overflow: hidden;
  list-style: none;
}
.dsh-master-tool-row::-webkit-details-marker { display: none; }
.dsh-master-tool[data-expandable] .dsh-master-tool-row { cursor: pointer; }
.dsh-master-tool-marker {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(16px + var(--dsh-content-font-delta, 0px));
  height: calc(16px + var(--dsh-content-font-delta, 0px));
  margin-right: 6px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-tool-marker svg { width: 14px; height: 14px; }
.dsh-master-tool-marker::after {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
  content: '›';
  font-size: 20px;
  line-height: 16px;
  opacity: 0;
  transition: opacity 100ms ease;
}
.dsh-master-tool:hover .dsh-master-tool-marker::after,
.dsh-master-tool[open] .dsh-master-tool-marker::after { opacity: 1; }
.dsh-master-tool[open] .dsh-master-tool-marker::after { content: '⌄'; font-size: 12px; }
.dsh-master-tool:hover .dsh-master-tool-marker > *,
.dsh-master-tool[open] .dsh-master-tool-marker > * { opacity: 0; }
.dsh-master-tool-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--dsw-alias-label-caption); }
.dsh-master-tool-title {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-weight: 400;
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
}
.dsh-master-tool-separator {
  flex: none;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
}
.dsh-master-tool-summary {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-tool[data-state='error'] .dsh-master-tool-summary { color: var(--dsw-alias-state-error-primary); }
.dsh-master-tool-body { display: flex; flex-direction: column; }
.dsh-master-tool-section {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 14px;
  align-items: baseline;
  max-height: 150px;
  margin: 4px 0 4px 4px;
  padding: 10px 14px;
  overflow: auto;
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2));
}
.dsh-master-tool-caption {
  position: sticky;
  top: 0;
  align-self: start;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
}
.dsh-master-tool-content {
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-master-tool-content[data-error] { color: var(--dsw-alias-state-error-primary); }
.dsh-master-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-question {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.dsh-master-question-heading {
  margin-bottom: 2px;
  font-size: var(--dsh-content-font-size, 14px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-master-question-item {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 4px 0;
  border: 0;
}
.dsh-master-question-item legend {
  padding: 0;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-master-question-header,
.dsh-master-question-detail {
  margin: 3px 0 7px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 19px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-question-options { display: grid; gap: 6px; margin: 8px 0; }
.dsh-master-question-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 11px;
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  cursor: pointer;
}
.dsh-master-question-option:has(input:checked) {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
}
.dsh-master-question-option input { margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }
.dsh-master-question-option-copy { display: flex; flex-direction: column; min-width: 0; }
.dsh-master-question-option .dsh-master-question-detail { margin: 2px 0 0; }
.dsh-master-question-custom { display: grid; gap: 5px; margin-top: 8px; }
.dsh-master-question-custom > span {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-question-custom textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  resize: vertical;
}
.dsh-master-question-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  min-height: 36px;
}
.dsh-master-question-pager { display: flex; align-items: center; gap: 6px; flex: none; }
.dsh-master-question-pager span {
  padding: 0 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 24px;
  white-space: nowrap;
}
.dsh-master-question-pager button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-master-question-pager button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-master-question-pager button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-master-question-previous svg { transform: rotate(180deg); }
.dsh-master-question-actions { display: flex; justify-content: flex-end; gap: 8px; flex: none; }
.dsh-master-question-actions button {
  min-height: 32px;
  padding: 0 12px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}
.dsh-master-question-actions button[type='submit'] {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-on-brand, #fff);
}
.dsh-master-question-actions button:disabled,
.dsh-master-question-custom textarea:disabled { opacity: .55; cursor: not-allowed; }
.dsh-master-question-error,
.dsh-master-question-compatibility {
  margin: 8px 0;
  padding: 9px 11px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 19px;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-master-question-error { margin: 0; }
.dsh-master-composer {
  flex: none;
  width: calc(100% - 32px);
  max-width: calc(var(--dsh-chat-content-width) + 32px);
  box-sizing: border-box;
  margin: 8px auto 20px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 20px;
  padding: 10px 12px 8px;
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-2));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-master-question-composer {
  max-height: min(60vh, 520px);
  overflow: hidden;
  overscroll-behavior: contain;
}
.dsh-master-composer-input {
  box-sizing: border-box;
  width: 100%;
  font: inherit;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  border: 0;
  border-radius: 8px;
  padding: 2px 4px 8px;
  resize: vertical;
  min-height: 64px;
  max-height: 220px;
  outline: none;
}
.dsh-master-composer-input::placeholder { color: var(--dsw-alias-label-caption); }
.dsh-master-composer-input:disabled { opacity: .58; cursor: not-allowed; }
.dsh-master-composer-input:focus-visible {
  outline: 1.5px solid var(--dsw-alias-button-info-fill, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}
.dsh-master-composer-toolbar,
.dsh-master-composer-leading,
.dsh-master-composer-trailing,
.dsh-master-attachment-controls {
  display: flex;
  align-items: center;
}
.dsh-master-composer-toolbar {
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
}
.dsh-master-composer-leading,
.dsh-master-composer-trailing {
  gap: 8px;
}
.dsh-master-composer-leading { min-width: 0; }
.dsh-master-composer-trailing { flex: none; }
.dsh-master-attachment-controls { gap: 6px; }
.dsh-master-toolbar-icon,
.dsh-master-toolbar-select {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  box-sizing: border-box;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
}
.dsh-master-toolbar-icon {
  width: 32px;
  padding: 0;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-master-toolbar-select {
  padding: 0 8px;
  font-size: 12px;
  line-height: 18px;
}
.dsh-master-toolbar-icon:disabled,
.dsh-master-toolbar-select:disabled {
  opacity: .48;
  cursor: not-allowed;
}
.dsh-master-model-select { max-width: 172px; }
.dsh-master-model-select span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-modes { display: inline-flex; flex: none; gap: 4px; }
.dsh-master-mode-pill { font-size: 12px; }
.dsh-master-send {
  width: 36px;
  min-width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-master-send-hint { white-space: nowrap; }

.dsh-master-settings-card {
  list-style: none;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3);
}
.dsh-master-settings-card-open {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh-master-settings-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-master-settings-heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dsh-master-settings-title { font-size: 15px; font-weight: 600; }
.dsh-master-settings-description {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
}
.dsh-master-settings-chevron {
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s;
}
.dsh-master-settings-chevron-open { transform: rotate(180deg); }
.dsh-master-settings-unsaved,
.dsh-master-settings-badge,
.dsh-master-settings-badge-muted {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
}
.dsh-master-settings-unsaved,
.dsh-master-settings-badge {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.dsh-master-settings-badge-muted { color: var(--dsw-alias-label-tertiary); }
.dsh-master-settings-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 16px;
  padding: 12px 0;
  border-top: .5px solid var(--dsw-alias-border-l2);
}
.dsh-master-settings-label-row { display: flex; align-items: center; gap: 8px; }
.dsh-master-settings-checkbox { width: 16px; height: 16px; margin: 0; flex: none; accent-color: var(--dsw-alias-brand-primary); }
.dsh-master-settings-label {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}
.dsh-master-settings-input {
  width: 100%;
  height: 34px;
  box-sizing: border-box;
  padding: 0 12px;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dsh-master-settings-input:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-master-settings-input:disabled { color: var(--dsw-alias-label-tertiary); }
.dsh-master-settings-input-invalid { border-color: var(--dsw-alias-state-error-primary); }
.dsh-master-settings-hint,
.dsh-master-settings-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.dsh-master-settings-hint { color: var(--dsw-alias-label-tertiary); }
.dsh-master-settings-error { color: var(--dsw-alias-state-error-primary); }
.dsh-master-settings-separator { height: .5px; margin: 4px 0; background: var(--dsw-alias-border-l2); }
.dsh-master-settings-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  border-top: .5px solid var(--dsw-alias-border-l2);
}
.dsh-master-settings-footer .dsh-master-settings-error { flex: 1; }
.dsh-master-settings-discard,
.dsh-master-settings-save {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh-master-settings-discard {
  border-color: var(--dsw-alias-border-l2);
  background: none;
  color: var(--dsw-alias-label-secondary);
}
.dsh-master-settings-save {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}
.dsh-master-settings-discard:disabled,
.dsh-master-settings-save:disabled { opacity: .4; cursor: default; }
.dsh-master-settings-header:focus-visible,
.dsh-master-settings-discard:focus-visible,
.dsh-master-settings-save:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

/* --------------------------------------------------------------- attachments */

.dsh-master-attachment-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.dsh-master-attachment-input { display: none; }
.dsh-master-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}
.dsh-master-attachment {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 340px;
  padding: 3px 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  font-size: 12px;
  line-height: 18px;
}
.dsh-master-attachment[data-status='failed'] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-master-attachment[data-status='ready'] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent);
}
.dsh-master-attachment-name {
  min-width: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}
.dsh-master-attachment-meta {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}
.dsh-master-attachment-progress {
  flex: none;
  width: 56px;
  height: 3px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
}
.dsh-master-attachment-progress > span {
  display: block;
  height: 100%;
  background: var(--dsw-alias-brand-primary);
  transition: width .15s linear;
}
.dsh-master-attachment-action {
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-master-attachment-action:hover { color: var(--dsw-alias-label-primary); }
.dsh-master-attachment-errors {
  margin: 0 0 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh-master-attachment-errors ul { margin: 2px 0 0; padding-left: 18px; }

/* ----------------------------------------------------------------- artifacts */

.dsh-master-artifacts {
  flex: none;
  width: calc(100% - 64px);
  max-width: var(--dsh-chat-content-width);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 auto 8px;
}
.dsh-master-artifacts[data-empty='true'] .dsh-master-hint {
  margin: 0;
  padding: 0;
  font-size: 12px;
  line-height: 20px;
}
.dsh-master-artifacts-title {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-artifact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
}
.dsh-master-artifact-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.dsh-master-artifact-name {
  min-width: 0;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--dsh-content-font-size, 14px);
}
.dsh-master-artifact-meta,
.dsh-master-artifact-state {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-artifact[data-state='expired'] .dsh-master-artifact-name,
.dsh-master-artifact[data-state='missing'] .dsh-master-artifact-name {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}
.dsh-master-artifact-download {
  flex: none;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  text-decoration: none;
}
.dsh-master-artifact-download[aria-disabled='true'] {
  opacity: .5;
  cursor: default;
}

/*
 * File-change cards. Geometry follows the reference card: one rounded container, an
 * icon tile, a single header line with the +/- counts, then the file rows and the
 * all-files toggle. Colours are tokens only, so a theme switch keeps the green/red
 * pair legible.
 */
.dsh-master-change {
  margin: 4px 0 6px 4px;
  overflow: hidden;
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base));
}
.dsh-master-change-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px;
  list-style: none;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
}
.dsh-master-change-head::-webkit-details-marker { display: none; }
.dsh-master-change-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-master-change-head:focus-visible,
.dsh-master-changes-toggle:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color);
  outline-offset: -2px;
}
.dsh-master-change-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dsh-master-change-tile svg { width: 14px; height: 14px; }
.dsh-master-change-title {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-master-change-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-change-counts,
.dsh-master-changes-counts,
.dsh-master-changes-row-counts {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
}
.dsh-master-change-added { color: var(--dsw-alias-state-success-primary); }
.dsh-master-change-deleted { color: var(--dsw-alias-state-error-primary); }
.dsh-master-change-oversized,
.dsh-master-change-running { color: var(--dsw-alias-label-caption); }
.dsh-master-change-chevron {
  flex: none;
  display: inline-flex;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-master-change-chevron svg { display: block; transition: transform 120ms ease; }
.dsh-master-change[open] .dsh-master-change-chevron svg { transform: rotate(180deg); }
.dsh-master-change-body {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  padding: 6px 0 10px;
  overflow: auto;
  border-top: .5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-markdown-code-block, transparent);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
}
.dsh-master-change-line {
  padding: 0 12px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-master-change-line[data-kind='path'] {
  color: var(--dsw-alias-label-tertiary);
  font-weight: 500;
}
.dsh-master-change-line[data-kind='gap'] { color: var(--dsw-alias-label-caption); }
.dsh-master-change-line[data-kind='del'] { color: var(--dsw-alias-state-error-primary); }
.dsh-master-change-line[data-kind='add'] { color: var(--dsw-alias-state-success-primary); }
.dsh-master-change-line[data-kind='del']::before { content: '- '; }
.dsh-master-change-line[data-kind='add']::before { content: '+ '; }
.dsh-master-change-note {
  padding: 2px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
}
.dsh-master-changes {
  margin: 10px 0 4px;
  overflow: hidden;
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base));
}
.dsh-master-changes-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.dsh-master-changes-titles {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  gap: 2px;
}
.dsh-master-changes-title {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-changes-counts { color: var(--dsw-alias-label-tertiary); }
.dsh-master-changes-sep { color: var(--dsw-alias-label-caption); }
.dsh-master-changes-path {
  min-width: 0;
  overflow: hidden;
  font-family: var(--ds-font-family-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-changes-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: .5px solid var(--dsw-alias-border-l1);
}
.dsh-master-changes-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  font-size: 12px;
  line-height: 20px;
}
.dsh-master-changes-row-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-master-changes-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 14px;
  border: 0;
  border-top: .5px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.dsh-master-changes-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.dsh-master-changes-toggle svg { flex: none; width: 14px; height: 14px; }

@media (max-width: 720px) {
  .dsh-master-composer { margin-bottom: 12px; }
  .dsh-master-composer-toolbar { align-items: flex-end; flex-wrap: wrap; }
  .dsh-master-composer-leading { flex-wrap: wrap; }
  .dsh-master-composer-trailing { gap: 6px; margin-left: auto; }
  .dsh-master-send-hint { display: none; }
  .dsh-master-question-footer { align-items: flex-start; flex-wrap: wrap; }
  .dsh-master-question-actions { margin-left: auto; gap: 5px; }
  .dsh-master-change-title { display: none; }
  .dsh-master-changes-row { gap: 8px; padding: 6px 10px; }
  .dsh-master-changes-head { padding: 8px 10px; }
  .dsh-master-changes-toggle { padding: 8px 10px; }
}
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
    if (existing.textContent !== PANEL_CSS) existing.textContent = PANEL_CSS
    return existing
  }
  const tag = document.createElement('style')
  tag.id = TAG_ID
  tag.dataset['plugin'] = 'dsh-master'
  tag.textContent = PANEL_CSS
  document.head.appendChild(tag)
  return tag
}

/** Remove the panel stylesheet. Safe to call when it was never added. */
export function disposeStyles(): void {
  if (typeof document === 'undefined') return
  document.getElementById(TAG_ID)?.remove()
}
