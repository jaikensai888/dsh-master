import { useState } from 'react'
import type { MasterSettingsCardState } from './settings-card.js'

interface Props {
  t: (key: string) => string
  useMasterSettings: <Selection>(selector: (state: MasterSettingsCardState) => Selection) => Selection
  editCoordinatorUrl: (value: string) => void
  editApiToken: (value: string) => void
  save: () => void
  discard: () => void
}

/** The coordinator connection form rendered in DSH Settings → Plugins. */
export function MasterSettingsCard(props: Props) {
  const [open, setOpen] = useState(false)
  const state = props.useMasterSettings(snapshot => snapshot)
  const t = props.t
  if (!state.available) return null
  const tokenBlocked = !state.credentialAvailable || !state.credentialWritable
  const saveBlocked = !state.dirty || !state.writable || state.invalidUrl || state.saving
    || (state.apiToken.trim() !== '' && tokenBlocked)
  return (
    <li className={`dsh-master-settings-card${open ? ' dsh-master-settings-card-open' : ''}`}>
      <button
        type="button"
        className="dsh-master-settings-header"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className="dsh-master-settings-heading">
          <span className="dsh-master-settings-title">{t('title')}</span>
          <span className="dsh-master-settings-description">{t('description')}</span>
        </span>
        {state.dirty ? <span className="dsh-master-settings-unsaved">{t('unsaved')}</span> : null}
        <span className={`dsh-master-settings-chevron${open ? ' dsh-master-settings-chevron-open' : ''}`} aria-hidden="true">⌄</span>
      </button>
      {open
        ? (
          <div className="dsh-master-settings-body">
            {!state.writable ? <p className="dsh-master-settings-hint" role="status">{t('readOnly')}</p> : null}
            <label className="dsh-master-settings-label" htmlFor="dsh-master-coordinator-url">{t('coordinatorUrl')}</label>
            <input
              id="dsh-master-coordinator-url"
              className={`dsh-master-settings-input${state.invalidUrl ? ' dsh-master-settings-input-invalid' : ''}`}
              type="url"
              autoComplete="url"
              value={state.coordinatorUrl}
              disabled={!state.writable || state.saving}
              aria-invalid={state.invalidUrl}
              onChange={event => { props.editCoordinatorUrl(event.target.value) }}
            />
            <p className={state.invalidUrl ? 'dsh-master-settings-error' : 'dsh-master-settings-hint'}>
              {state.invalidUrl ? t('invalidUrl') : t('coordinatorUrlHint')}
            </p>
            <div className="dsh-master-settings-separator" />
            <div className="dsh-master-settings-label-row">
              <label className="dsh-master-settings-label" htmlFor="dsh-master-api-token">{t('apiToken')}</label>
              <span className={state.credentialConfigured || state.legacyTokenConfigured ? 'dsh-master-settings-badge' : 'dsh-master-settings-badge-muted'}>
                {state.credentialConfigured || state.legacyTokenConfigured ? t('tokenConfigured') : t('tokenUnset')}
              </span>
            </div>
            <input
              id="dsh-master-api-token"
              className="dsh-master-settings-input"
              type="password"
              autoComplete="new-password"
              value={state.apiToken}
              disabled={tokenBlocked || !state.writable || state.saving}
              onChange={event => { props.editApiToken(event.target.value) }}
            />
            <p className="dsh-master-settings-hint">
              {tokenBlocked ? t('tokenReadOnly') : t('apiTokenHint')}
            </p>
            <div className="dsh-master-settings-footer">
              {state.failed ? <p className="dsh-master-settings-error" role="status">{t('saveFailed')}</p> : null}
              <button
                type="button"
                className="dsh-master-settings-discard"
                disabled={!state.dirty || state.saving}
                onClick={props.discard}
              >
                {t('discard')}
              </button>
              <button
                type="button"
                className="dsh-master-settings-save"
                disabled={saveBlocked}
                onClick={props.save}
              >
                {t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
