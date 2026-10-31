/**
 * Isolated QA page: the real `WorkspaceNodeChooser` with mock node data.
 *
 * It never talks to a coordinator and never invokes session navigation; the only
 * production behaviour under test is the picker itself. Run `build-preview.mjs`
 * to rebuild the bundle, then open `preview.html`.
 */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { MasterNode } from '../../../src/protocol.js'
import { WorkspaceNodeChooser } from '../../../src/workspace/WorkspaceNodeChooser.js'
import { ensureWorkspaceStyles } from '../../../src/workspace/styles.generated.js'
import { zh } from '../../../src/workspace/locales.js'
import type { WorkspaceBrowseScope } from '../../../src/workspace/stores.js'

const t = (key: string, params: Record<string, unknown> = {}) =>
  Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), (zh as Record<string, string>)[key] ?? key)

const OFFICE1 = 'node-2d78325c8c0ec940a080aafee4e5b4c6'
const OFFICE2 = 'node-9f1c0a77b2e84d55a0c3f6e21b7d4a88'

/** The design frame: one online node, plus the states that must not be offered. */
const designNodes: MasterNode[] = [
  { nodeId: OFFICE1, nodeName: 'office1', state: 'ready' },
  { nodeId: 'node-offline-0001', nodeName: 'lab-desktop', state: 'offline' },
  { nodeId: 'node-closing-0002', nodeName: 'closing-node', state: 'closing' },
  { nodeId: 'node-unknown-0003', nodeName: 'pending-node', state: 'unknown' },
  { nodeId: 'node-revoked-0004', nodeName: 'revoked-node', state: 'ready', revoked: true },
]

/** Enough eligible nodes to force the candidate list to scroll inside the popover. */
const manyNodes: MasterNode[] = [
  ...designNodes,
  { nodeId: OFFICE2, nodeName: 'office2', state: 'ready' },
  { nodeId: 'node-4a1d8e2c6b9f0a73d5c8e1b4f7a2d6c9', nodeName: 'studio-render-node-production-east-01', state: 'ready' },
  { nodeId: 'node-55d0b8e2a4c16f93b7d1e5a8c2f4b6d8', nodeName: 'build-farm', state: 'ready' },
  { nodeId: 'node-77c9a1e3f5b7d9246a8c0e2f4b6d8a13', nodeName: '测试节点', state: 'ready' },
  { nodeId: 'node-88b2c4d6e8f0a1357c9e1b3d5f7a9c20', nodeName: 'my-desktop', state: 'ready' },
  { nodeId: 'node-99e3f5a7c9b1d2468e0a2c4f6b8d0e31', nodeName: 'ou', state: 'ready' },
  { nodeId: 'node-a0f4b6c8d0e2a3579b1d3f5a7c9e0b42', nodeName: 'gpu-box', state: 'ready' },
  { nodeId: 'node-b1a5c7d9e0f2b4680c1e3a5f7b9d2c53', nodeName: 'laptop', state: 'ready' },
  { nodeId: 'node-c2b6d8e0f1a3c5791d2f4a6b8c0e3d64', nodeName: 'workstation', state: 'ready' },
]

/** A name and an ID long enough to prove both ellipsize inside their own column. */
const longNodes: MasterNode[] = [
  { nodeId: OFFICE1, nodeName: 'office1', state: 'ready' },
  { nodeId: 'node-2d78325c8c0ec940a080aafee4e5b4c6-2d78325c8c0ec940a080aafee4e5b4c6', nodeName: 'a-very-long-remote-node-name-that-should-ellipsize-inside-the-picker', state: 'ready' },
]

function App(): React.ReactElement {
  const [many, setMany] = useState(false)
  const [long, setLong] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [scope, setScope] = useState<WorkspaceBrowseScope>({ kind: 'remote', nodeId: OFFICE1 })
  const [refreshes, setRefreshes] = useState(0)

  const nodes = long ? longNodes : many ? manyNodes : designNodes
  const currentNodeId = mismatch ? OFFICE2 : OFFICE1

  const button = (label: string, active: boolean, onClick: () => void) =>
    <button type="button" className={active ? 'control control-active' : 'control'} onClick={onClick}>{label}</button>

  return <>
    <div className="toolbar">
      {button('设计稿场景', !many && !long, () => { setMany(false); setLong(false) })}
      {button('多节点滚动', many && !long, () => { setMany(true); setLong(false) })}
      {button('长名称 / 长 ID', long, () => { setMany(false); setLong(true); setScope({ kind: 'remote', nodeId: OFFICE1 }) })}
      {button('当前会话在 office2', mismatch, () => { setMismatch(!mismatch) })}
      {button('加载中', busy, () => { setBusy(!busy) })}
      {button('错误', error !== undefined, () => { setError(error === undefined ? 'E_COORDINATOR: 连接 coordinator 失败' : undefined) })}
    </div>
    <div className="app">
      <aside className="sidebar">
        <h3 className="brand">deepseek HARNESS</h3>
        <div className="nav-item">插件</div>
        <div className="nav-item">自动化任务</div>
        <div className="heading">
          <span>工作区</span>
          <WorkspaceNodeChooser nodes={nodes} scope={scope} onChange={setScope} busy={busy} error={error}
            t={t} currentNodeId={currentNodeId} onRefresh={() => { setRefreshes(n => n + 1) }} />
        </div>
        <div className="tree">本地工作区与远程目录在此处，选择器不改变它们。</div>
      </aside>
      <main>
        <h3>真实组件隔离预览 · 模拟节点数据 · 无 coordinator 连接</h3>
        <p>左侧“工作区”后的三角是生产触发器；弹层、搜索、键盘与焦点逻辑均为生产代码。刷新次数：<strong data-refreshes="">{refreshes}</strong></p>
        <pre data-scope="">{JSON.stringify(scope)}</pre>
        <p className="fine">图标由本目录的 mock 提供（SVG 几何与已安装 DSH runtime 一致）；主题只复制了选择器用到的 --dsw-* 变量。</p>
      </main>
    </div>
  </>
}

ensureWorkspaceStyles()
createRoot(document.getElementById('root')!).render(<App />)
