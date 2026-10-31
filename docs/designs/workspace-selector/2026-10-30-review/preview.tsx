// Isolated QA: real sidebar components, mocked host services. Never sends a prompt.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceBrowser } from '../../../../src/workspace/rows/WorkspaceBrowser.js'
import { RemoteSection } from '../../../../src/workspace/RemoteSection.js'
import { ensureWorkspaceStyles } from '../../../../src/workspace/styles.generated.js'
import { setRemoteSelection } from '../../../../src/client/selection.js'
import { zh } from '../../../../src/workspace/locales.js'

const t = (key: string, params: Record<string, unknown> = {}) => Object.entries(params).reduce((s,[k,v]) => s.replaceAll(`{${k}}`,String(v)), (zh as Record<string,string>)[key] ?? key)
const sessionState = { ids: ['local1'], byId: { local1: { id: 'local1', displayTitle: '本地构建配置', updatedAt: Date.now(), blank: false, running: false } }, current: 'local1', phase: 'ready' }
const workspaces = { items: [{workspaceId:'local-w', title:'dsh-master', path:'G:/claude_project/code-agent/dsh-master', sessionIds:['local1'], createdAt:Date.now()}], archivedSessionIds: [], phase:'ready' }
const nodes = [{ nodeId:'office',nodeName:'offiec1',state:'ready' },{nodeId:'desktop',nodeName:'my-desktop',state:'ready'},{nodeId:'ou',nodeName:'ou',state:'offline'},{nodeId:'long',nodeName:'studio-render-node-production-east-01',state:'ready'}]
let slowOffice = false
const calls: string[]=[]
const nativeFetch=window.fetch.bind(window)
window.fetch=async (input,init)=>{
  const url=String(input);calls.push(url)
  if(!url.includes('/dsh-master/api/'))return nativeFetch(input,init)
  if(url.includes('/status'))return Response.json({ok:true,value:{coordinator:{url:'mock',reachable:true},nodeCount:nodes.length,promptEnabled:false}})
  if(url.includes('/nodes'))return Response.json({ok:true,value:{coordinator:{url:'mock',reachable:true},nodes}})
  const id=new URL(url,location.href).searchParams.get('nodeId')??'office'
  if(slowOffice&&id==='office')await new Promise(resolve=>setTimeout(resolve,350))
  const sessions=Array.from({length:12},(_,i)=>({sessionId:`${id}-${i}`,title:`${id} 会话 ${i+1}`,updatedAt:Date.now(),running:i===0,blank:false}))
  return Response.json({ok:true,value:{sessions,workspaces:[{workspaceId:'same',title:id==='desktop'?'dsh-master':'readvideo',path:`/projects/${id}`,sessionIds:sessions.map(s=>s.sessionId)},{workspaceId:'empty',title:'empty-project',path:'/empty',sessionIds:[]}],archivedSessionIds:[]}})
}
function App(){
  const [view,setView]=useState<any>({browseScope:{kind:'local'},groupBy:'workspace',orderBy:'manual',groupExpansion:{},sessionOrderByAccount:{},sessionUpdatedAtByAccount:{},localExpanded:true,remoteExpanded:true,remoteNodeExpansion:{},remoteWorkspaceExpansion:{}})
  const [wide,setWide]=useState(true)
  const [opened,setOpened]=useState('本地 / 本地构建配置')
  const [draft,setDraft]=useState('这段草稿不会因切换浏览节点而改变')
  const actions:any={
    setBrowseScope:(scope:any)=>setView((s:any)=>({...s,browseScope:scope})),
    setGroupBy:(groupBy:any)=>setView((s:any)=>({...s,groupBy})),
    setOrderBy:(orderBy:any)=>setView((s:any)=>({...s,orderBy})),
    setLocalExpanded:(localExpanded:any)=>setView((s:any)=>({...s,localExpanded})),
    setRemoteNodeExpanded:(id:string,value:boolean)=>setView((s:any)=>({...s,remoteNodeExpansion:{...s.remoteNodeExpansion,[id]:value}})),
    setRemoteWorkspaceExpanded:(id:string,value:boolean)=>setView((s:any)=>({...s,remoteWorkspaceExpansion:{...s.remoteWorkspaceExpansion,[id]:value}})),
    setGroupExpanded:(id:string,value:boolean)=>setView((s:any)=>({...s,groupExpansion:{...s.groupExpansion,[id]:value}})),
    retainAccountKeys:()=>{},syncSessionOrderAccount:()=>{},setSessionOrder:()=>{},
  }
  // Stable action functions are important to the same effects as the real store.
  const actionsRef=React.useRef(actions);Object.assign(actionsRef.current,actions)
  const props:any={wide,expandSidebar:()=>setWide(true),useSessions:(s:any)=>s(sessionState),useSessionPendingInteraction:(s:any)=>s(new Map()),useWorkspaces:(s:any)=>s(workspaces),useStore:(s:any)=>s(view),actions:actionsRef.current,
    open:()=>{setRemoteSelection(undefined);setOpened('本地 / 本地构建配置')},
    openRemoteSession:(nodeId:string,sessionId:string,nodeName:string,title:string)=>{setRemoteSelection({nodeId,sessionId,nodeName,sessionTitle:title});setOpened(`${nodeName} / ${title}`)},
    useHostInfo:(s:any)=>s({home:'G:/'}),useDirectoryFlow:(s:any)=>s(true),renderSlot:()=>null,
    searchSessions:async()=>({items:[],hasMore:false}),searchResultLimit:20,
    renderRemoteSection:(p:any)=><RemoteSection {...p}/>,t,
    startSession:()=>{},renameSession:async()=>{},forkSession:()=>{},renameWorkspace:async()=>{},deleteWorkspace:async()=>{},insertWorkspaceBefore:async()=>{},archiveSession:async()=>{},insertSessionBefore:async()=>{},createWorkspace:async()=>{},
  }
  return <><header>真实组件隔离验收 · 模拟数据 · 无 DSH 连接 <button onClick={()=>setWide(!wide)}>切换窄栏</button><button onClick={()=>{slowOffice=!slowOffice}}>模拟慢响应</button></header><div className="app"><aside style={{width:wide?280:60}}><h3>deepseek HARNESS</h3><div>插件</div><div>自动化任务</div><WorkspaceBrowser {...props}/></aside><main><h3 data-current-session="">{opened}</h3><p>切换工作区标题后的三角只更改左侧列表，右侧模拟会话和草稿应保持。</p><textarea aria-label="验收草稿" value={draft} onChange={e=>setDraft(e.target.value)}/><pre>{JSON.stringify(view.browseScope)}</pre></main></div></>
}
ensureWorkspaceStyles();createRoot(document.getElementById('root')!).render(<App/>);
