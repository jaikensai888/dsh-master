import { MASTER_SETTINGS_NAMESPACE, MASTER_SETTINGS_TOKEN_REF } from '../settings-constants.js'

export { MASTER_SETTINGS_NAMESPACE, MASTER_SETTINGS_TOKEN_REF } from '../settings-constants.js'

/** Card copy keyed by DSH's active locale. */
export const masterSettingsLocale = {
  zh: {
    title: 'dsh-master',
    description: '远程工作区所连接的 dsh-coordinator。',
    coordinatorUrl: 'Coordinator 地址',
    coordinatorUrlHint: '填写 HTTP(S) 地址；保存到当前 profile，后续请求立即生效。',
    allowPrompt: '允许远程发送消息',
    allowPromptHint: '开启后可向远程会话发送消息，Agent 可能修改远程文件和运行命令。保存后立即生效。',
    apiToken: 'API Token',
    apiTokenHint: '留空表示不更改；新 token 仅存入凭据存储，不写入设置文件。',
    tokenConfigured: '已配置',
    tokenUnset: '未配置',
    tokenReadOnly: '凭据服务不可写或未连接，当前无法修改 token。',
    invalidUrl: '请输入有效的 HTTP(S) 地址，不要在地址中嵌入账号、密码或查询参数。',
    readOnly: '当前部署的设置为只读。',
    unsaved: '未保存',
    save: '保存',
    saving: '保存中…',
    discard: '放弃修改',
    saveFailed: '保存未完成；请检查设置与凭据服务后重试。',
  },
  en: {
    title: 'dsh-master',
    description: 'Coordinator connection for the remote workspace.',
    coordinatorUrl: 'Coordinator URL',
    coordinatorUrlHint: 'Enter an HTTP(S) URL. Saved in the current profile and used by subsequent requests.',
    allowPrompt: 'Allow sending remote messages',
    allowPromptHint: 'Enables messages to remote sessions. The agent may edit remote files and run commands. Takes effect after saving.',
    apiToken: 'API token',
    apiTokenHint: 'Leave blank to keep the current token. A new token is stored outside the settings file.',
    tokenConfigured: 'Configured',
    tokenUnset: 'Not configured',
    tokenReadOnly: 'The credentials service is unavailable or read-only; the token cannot be changed.',
    invalidUrl: 'Enter a valid HTTP(S) URL without embedded credentials or query parameters.',
    readOnly: 'Settings are read-only in this deployment.',
    unsaved: 'Unsaved',
    save: 'Save',
    saving: 'Saving…',
    discard: 'Discard changes',
    saveFailed: 'The save did not complete. Check settings and credentials access, then retry.',
  },
} as const

const DEFAULT_COORDINATOR_URL = 'http://127.0.0.1:39472'

/** The non-secret settings fields this card edits. */
export interface MasterSettingsValue {
  coordinatorUrl?: string
  allowPrompt?: boolean
}

/** Minimal settings-scope face used by the card. */
export interface MasterSettingsScope {
  getSnapshot(): {
    status: 'ready' | 'loading' | 'unavailable'
    value: MasterSettingsValue | undefined
    user: unknown
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean | void>
  unset(field: string): Promise<boolean | void>
}

/** Credential operations available to a write-only secret field. */
export interface MasterSettingsCredentials {
  describe(refs: string[]): Promise<{
    ok: boolean
    value?: Record<string, { configured?: boolean; writable?: boolean } | undefined>
  }>
  set(ref: string, value: string): Promise<unknown>
}

/** Redacted settings mirror; it reports legacy secret presence, never its value. */
export interface MasterSettingsDescribeFace {
  getSnapshot(): {
    view?: {
      namespaces: readonly {
        ns: string
        secrets?: readonly { path: readonly string[]; set: boolean }[]
      }[]
    }
  }
  subscribe(listener: () => void): () => void
}

/** State rendered by the DSH plugin settings card. */
export interface MasterSettingsCardState {
  available: boolean
  writable: boolean
  coordinatorUrl: string
  allowPrompt: boolean
  apiToken: string
  credentialAvailable: boolean
  credentialConfigured: boolean
  legacyTokenConfigured: boolean
  credentialWritable: boolean
  dirty: boolean
  invalidUrl: boolean
  saving: boolean
  failed: boolean
}

/** Normalize and validate an HTTP(S) coordinator base URL without user-info or query secrets. */
export function normalizeCoordinatorUrl(input: string): string | undefined {
  const value = input.trim().replace(/\/+$/u, '')
  if (value === '') return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      return undefined
    }
    return value
  } catch {
    return undefined
  }
}

/** Staged settings form backed by DSH settings and the write-only credentials API. */
export class MasterSettingsCardController {
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeScope: () => void
  private readonly unsubscribeDescribe: (() => void) | undefined
  private urlDraft: string | undefined
  private allowPromptDraft: boolean | undefined
  private tokenDraft = ''
  private credentialAvailable = false
  private credentialConfigured = false
  private credentialWritable = false
  private credentialReadGeneration = 0
  private saving = false
  private failed = false
  private state: MasterSettingsCardState

  constructor(
    private readonly scope: MasterSettingsScope,
    private readonly credentials?: MasterSettingsCredentials,
    private readonly describe?: MasterSettingsDescribeFace,
  ) {
    this.state = this.project()
    this.unsubscribeScope = scope.subscribe(() => { this.publish() })
    this.unsubscribeDescribe = describe?.subscribe(() => { this.publish() })
    void this.refreshCredential()
  }

  getSnapshot = (): MasterSettingsCardState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  editCoordinatorUrl(value: string): void {
    this.urlDraft = value
    this.failed = false
    this.publish()
  }

  editApiToken(value: string): void {
    this.tokenDraft = value
    this.failed = false
    this.publish()
  }

  editAllowPrompt(value: boolean): void {
    this.allowPromptDraft = value
    this.failed = false
    this.publish()
  }

  discard(): void {
    this.urlDraft = undefined
    this.allowPromptDraft = undefined
    this.tokenDraft = ''
    this.failed = false
    this.publish()
  }

  async refreshCredential(ref = MASTER_SETTINGS_TOKEN_REF): Promise<void> {
    if (ref !== MASTER_SETTINGS_TOKEN_REF) return
    const generation = ++this.credentialReadGeneration
    if (this.credentials === undefined) {
      this.credentialAvailable = false
      this.credentialConfigured = false
      this.credentialWritable = false
      this.publish()
      return
    }
    try {
      const response = await this.credentials.describe([MASTER_SETTINGS_TOKEN_REF])
      if (generation !== this.credentialReadGeneration) return
      const item = response.ok ? response.value?.[MASTER_SETTINGS_TOKEN_REF] : undefined
      this.credentialAvailable = item !== undefined
      this.credentialConfigured = item?.configured === true
      this.credentialWritable = item?.writable === true
    } catch {
      if (generation !== this.credentialReadGeneration) return
      this.credentialAvailable = false
      this.credentialConfigured = false
      this.credentialWritable = false
    }
    this.publish()
  }

  async save(): Promise<void> {
    const before = this.project()
    const nextUrl = this.urlDraft === undefined ? undefined : normalizeCoordinatorUrl(this.urlDraft)
    const token = this.tokenDraft.trim()
    if (!before.available || !before.writable || before.invalidUrl || before.saving || !before.dirty) return
    if (token !== '' && (!this.credentialAvailable || !this.credentialWritable)) return

    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      if (nextUrl !== undefined && nextUrl !== this.currentCoordinatorUrl()) {
        const accepted = await this.scope.set('coordinatorUrl', nextUrl)
        landed = accepted !== false && this.currentCoordinatorUrl() === nextUrl
        if (landed) this.urlDraft = undefined
      }
      if (landed && this.allowPromptDraft !== undefined && this.allowPromptDraft !== this.currentAllowPrompt()) {
        const nextAllowPrompt = this.allowPromptDraft
        const accepted = await this.scope.set('allowPrompt', nextAllowPrompt)
        landed = accepted !== false && this.currentAllowPrompt() === nextAllowPrompt
        if (landed) this.allowPromptDraft = undefined
      }
      if (landed && token !== '' && this.credentials !== undefined) {
        await this.credentials.set(MASTER_SETTINGS_TOKEN_REF, token)
        await this.refreshCredential()
        landed = this.credentialConfigured
        if (landed) this.tokenDraft = ''
      }
    } catch {
      landed = false
    }
    this.failed = !landed
    this.saving = false
    this.publish()
  }

  dispose(): void {
    this.unsubscribeScope()
    this.unsubscribeDescribe?.()
    this.listeners.clear()
  }

  private currentCoordinatorUrl(): string {
    const configured = this.scope.getSnapshot().value?.coordinatorUrl
    return normalizeCoordinatorUrl(configured ?? '') ?? DEFAULT_COORDINATOR_URL
  }

  private currentAllowPrompt(): boolean {
    return this.scope.getSnapshot().value?.allowPrompt === true
  }

  private project(): MasterSettingsCardState {
    const snapshot = this.scope.getSnapshot()
    const currentUrl = normalizeCoordinatorUrl(snapshot.value?.coordinatorUrl ?? '') ?? DEFAULT_COORDINATOR_URL
    const coordinatorUrl = this.urlDraft ?? currentUrl
    const normalizedDraft = this.urlDraft === undefined ? currentUrl : normalizeCoordinatorUrl(this.urlDraft)
    const invalidUrl = this.urlDraft !== undefined && normalizedDraft === undefined
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      coordinatorUrl,
      allowPrompt: this.allowPromptDraft ?? this.currentAllowPrompt(),
      apiToken: this.tokenDraft,
      credentialAvailable: this.credentialAvailable,
      credentialConfigured: this.credentialConfigured,
      legacyTokenConfigured: this.legacyTokenConfigured(),
      credentialWritable: this.credentialWritable,
      dirty: (this.urlDraft !== undefined && normalizedDraft !== currentUrl)
        || (this.allowPromptDraft !== undefined && this.allowPromptDraft !== this.currentAllowPrompt())
        || this.tokenDraft.trim() !== '',
      invalidUrl,
      saving: this.saving,
      failed: this.failed,
    }
  }

  private legacyTokenConfigured(): boolean {
    const view = this.describe?.getSnapshot().view
    const section = view?.namespaces.find(namespace => namespace.ns === MASTER_SETTINGS_NAMESPACE)
    return section?.secrets?.some(secret => secret.set
      && secret.path.length === 1 && secret.path[0] === 'apiToken') ?? false
  }

  private publish(): void {
    this.state = this.project()
    for (const listener of this.listeners) listener()
  }
}
