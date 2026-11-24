/**
 * The path-entry dialog for adding a workspace when no composed directory
 * picker is available.
 *
 * The shipped add flow depends on a `sidebar.workspaces.directoryFlow` occupant:
 * a native chooser driver or an in-app browser. That occupant is composed by a
 * separate plugin, and there are real compositions where it is absent (the
 * official `ui-workspace` still owning the surface, or a profile without any
 * picker package). Rather than hiding the add affordance in those cases, this
 * dialog takes an absolute path and hands it to the owning host — the host
 * canonicalizes it and refuses a directory that does not exist, so the browser
 * never has to guess.
 *
 * The same dialog serves a remote node: there the path is resolved on that node,
 * not on this machine.
 *
 * @module dsh-master/workspace/AddWorkspaceDialog
 */

import { useEffect, useState, type ReactElement } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorkspaceExtrasCss as css } from './styles.generated.js'

/** Props of the path-entry dialog. */
export interface AddWorkspaceDialogProps {
  readonly open: boolean
  /** Where the path will be resolved: the host label or a node name. */
  readonly target: string
  readonly busy: boolean
  /** Failure from the owner's create call, already described for display. */
  readonly error: string | undefined
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly onSubmit: (path: string) => void
  readonly onClose: () => void
}

/**
 * Render the path-entry dialog.
 *
 * @param props - visibility, target label, submit state and callbacks.
 * @returns the dialog element.
 */
export function AddWorkspaceDialog({ open, target, busy, error, t, onSubmit, onClose }: AddWorkspaceDialogProps): ReactElement {
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  // Each opening starts from an empty field: a previous attempt's path is not a
  // suggestion for this one, and a stale value would be re-submitted by Enter.
  useEffect(() => {
    if (!open) return
    setDraft('')
    setComposing(false)
  }, [open])
  const trimmed = draft.trim()
  const submit = (): void => {
    if (busy || trimmed === '') return
    onSubmit(trimmed)
  }
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose() }}
      closeLabel={t('close')}
      title={t('addWorkspace.title')}
      description={t('addWorkspace.desc', { target })}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy || trimmed === ''} onClick={submit}>
            {busy ? t('addWorkspace.pending') : t('addWorkspace.submit')}
          </Button>
        </>
      )}
    >
      <div className={css.addForm}>
        <label className={css.addLabel} htmlFor="dsh-master-add-workspace-path">{t('addWorkspace.label')}</label>
        <input
          id="dsh-master-add-workspace-path"
          className={css.addInput}
          value={draft}
          placeholder={t('addWorkspace.placeholder')}
          autoFocus
          spellCheck={false}
          disabled={busy}
          onChange={(event) => { setDraft(event.target.value) }}
          onCompositionStart={() => { setComposing(true) }}
          onCompositionEnd={() => { setComposing(false) }}
          onKeyDown={(event) => {
            // Enter submits, except while an IME composition is still choosing candidates.
            if (event.key !== 'Enter' || composing) return
            event.preventDefault()
            submit()
          }}
        />
        <div className={css.addHint}>{t('addWorkspace.hint', { target })}</div>
        {error === undefined ? null : <div className={css.addError} role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
