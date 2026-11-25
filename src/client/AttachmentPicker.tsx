/**
 * The remote composer's "＋" attachment control.
 *
 * Presentational on purpose: the parent owns uploads, cancellation, and the
 * session key. This component only renders the picker and the selected rows, so
 * its markup can be tested without a DOM.
 *
 * The hidden input's value is reset after every change. Without that, picking
 * the same file twice in a row produces no `change` event, and a user who
 * removed a file could not add it back.
 *
 * @module dsh-master/client/AttachmentPicker
 */

import { IconPlusOutlineRegular as IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRef } from 'react'
import type { ReactElement } from 'react'
import type { LocalAttachment } from './attachments.js'
import { uploadProgress } from './attachments.js'
import { COPY, formatBytes } from './copy.js'

/** Props for {@link AttachmentPicker}. */
export interface AttachmentPickerProps {
  readonly attachments: readonly LocalAttachment[]
  /** True when uploading is unavailable (no support, disabled prompts, or at capacity). */
  readonly disabled: boolean
  /** Why the control is disabled; shown as the title. */
  readonly disabledReason?: string | undefined
  /** Whether another file may be added (count limit). */
  readonly canAdd: boolean
  readonly onSelect: (files: readonly File[]) => void
  readonly onRemove: (localId: string) => void
  readonly onRetry: (localId: string) => void
}

/** Describe one row's state in the user's language. */
export function attachmentStatusText(attachment: LocalAttachment): string {
  switch (attachment.status) {
    case 'selected':
      return COPY.attachmentSelected
    case 'uploading':
      return `${COPY.attachmentUploading} ${formatBytes(attachment.received)} / ${formatBytes(attachment.size)}`
    case 'ready':
      return COPY.attachmentReady
    case 'failed':
      return attachment.error === undefined ? COPY.attachmentFailed : `${COPY.attachmentFailed}：${attachment.error}`
  }
}

/** The composer's picker control alone: hidden input plus the "＋" button. */
export interface AttachmentButtonProps {
  readonly disabled: boolean
  readonly disabledReason?: string | undefined
  readonly canAdd: boolean
  readonly onSelect: (files: readonly File[]) => void
}

/**
 * Render the attachment trigger.
 *
 * @param props - disabled state and the selection sink.
 * @returns the control.
 */
export function AttachmentButton(props: AttachmentButtonProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const blocked = props.disabled || !props.canAdd
  return (
    <>
      <input
        ref={inputRef}
        className="dsh-master-attachment-input"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = event.currentTarget.files
          if (files !== null && files.length > 0) props.onSelect([...files])
          // Allow selecting the same file again after removing it.
          event.currentTarget.value = ''
        }}
      />
      <button
        type="button"
        className="dsh-master-toolbar-icon"
        data-control="attachment"
        aria-label={COPY.attachmentAdd}
        title={blocked ? (props.disabledReason ?? COPY.attachmentLimit) : COPY.attachmentAdd}
        disabled={blocked}
        onClick={() => { inputRef.current?.click() }}
      >
        <IconPlusOutline16 />
      </button>
    </>
  )
}

/** The selected files, as one chip row above the draft. */
export interface AttachmentChipsProps {
  readonly attachments: readonly LocalAttachment[]
  readonly onRemove: (localId: string) => void
  readonly onRetry: (localId: string) => void
}

/**
 * Render the selected attachments.
 *
 * @param props - rows and their row actions.
 * @returns the chip list, or null when nothing is selected.
 */
export function AttachmentChips({ attachments, onRemove, onRetry }: AttachmentChipsProps): ReactElement | null {
  if (attachments.length === 0) return null
  return (
    <ul className="dsh-master-attachments" aria-label={COPY.attachmentList}>
      {attachments.map(attachment => (
        <li
          className="dsh-master-attachment"
          data-status={attachment.status}
          data-local-id={attachment.localId}
          key={attachment.localId}
        >
          <span className="dsh-master-attachment-name" title={attachment.name}>{attachment.name}</span>
          <span className="dsh-master-attachment-meta">{attachmentStatusText(attachment)}</span>
          {attachment.status === 'uploading' ? (
            <span
              className="dsh-master-attachment-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(uploadProgress(attachment) * 100)}
            >
              <span style={{ width: `${String(Math.round(uploadProgress(attachment) * 100))}%` }} />
            </span>
          ) : null}
          {attachment.status === 'failed' ? (
            <button
              type="button"
              className="dsh-master-attachment-action"
              onClick={() => { onRetry(attachment.localId) }}
            >
              {COPY.attachmentRetry}
            </button>
          ) : null}
          <button
            type="button"
            className="dsh-master-attachment-action"
            aria-label={`${COPY.attachmentRemove} ${attachment.name}`}
            onClick={() => { onRemove(attachment.localId) }}
          >
            {attachment.status === 'uploading' ? COPY.attachmentCancel : COPY.attachmentRemove}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Render the picker and the selected attachments as one block.
 *
 * The composer uses the two halves separately (trigger in the toolbar, chips
 * above the draft), so they are exported above; this composition stays for
 * surfaces that want both in place and for the markup tests.
 *
 * @param props - rows, disabled state, and callbacks.
 * @returns the control.
 */
export function AttachmentPicker(props: AttachmentPickerProps): ReactElement {
  return (
    <div className="dsh-master-attachment-picker">
      <AttachmentButton
        disabled={props.disabled}
        canAdd={props.canAdd}
        onSelect={props.onSelect}
        {...props.disabledReason === undefined ? {} : { disabledReason: props.disabledReason }}
      />
      <AttachmentChips attachments={props.attachments} onRemove={props.onRemove} onRetry={props.onRetry} />
    </div>
  )
}
