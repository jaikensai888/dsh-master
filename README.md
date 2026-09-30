# dsh-master

DSH 插件：连上一台 `dsh-coordinator`，把它旗下的所有 `dsh-node` 及其会话带进本地 Web GUI，作为与「本地工作」并列的**远程工作区**。

它是**管理面消费方**——不监听端口、不持有节点凭据、不主动连节点。出站只做一件事：用 operator token 调 coordinator 的 HTTP API。

```
dsh-node（远程机器） ──拨出 WS──► dsh-coordinator ──/api──► dsh-master（本机插件）──► 本地 GUI
```

> **接手这个仓库？先读 [`PLAN.md`](PLAN.md)** —— 当前进度、待办、环境操作手册、以及一批踩过的坑都在那里。
> 事实依据见 [`docs/GROUND-TRUTH.md`](docs/GROUND-TRUTH.md)，设计取舍见 [`docs/design.md`](docs/design.md)。

## 现状

宿主 API、远程面板和本地工作区 fork 已在桌面实例使用；本地与远程工作区平级且可分别折叠，独立的「远程」快捷入口已移除。**这次侧栏交互尚待当前 UI 截图复验**。

| 能力 | 状态 |
| --- | --- |
| 节点列表与在线状态 | ✅ 已实现 |
| 某节点的会话列表 | ✅ 已实现 |
| 左侧远程工作区组（刷新、展开、5 条会话 overflow） | ✅ 已实现；待当前 UI 肉眼复验 |
| 打开会话：历史快照 + 实时事件 | ✅ 已实现，覆盖文本 / 工具调用 / 工具结果 / 少量事件 |
| 工具调用与结果展示 | ✅ 按 `callId` 合并为一条可折叠记录；显示工具名和结果摘要，展开查看输入 / 输出，失败结果标记为错误 |
| 发送消息（queue / steer） | ✅ 已实现，**默认关闭**，需显式开启 |
| `ask_user_question` 提问交互 | ✅ 远程表单与原始调用结构化应答；需升级 `dsh-node` |
| 工具授权审批 | ❌ 未实现（与 `ask_user_question` 是不同通道） |
| 会话生命周期通知（远程新建会话自动出现） | ❌ 未通，需手动刷新 |
| diff / 队列 / 模型切换 / 向上翻页 | ❌ 未实现 |

纯结构化 `tool-call` 内容不会再作为助手正文重复显示。

设计取舍、体验一致的边界、以及每个上游事实的依据，见 [`docs/design.md`](docs/design.md) 与 [`docs/GROUND-TRUTH.md`](docs/GROUND-TRUTH.md)。

## 安装

插件按 DSH 的常规方式挂进 profile：`$DSH_HOME/profiles/<profile>/node_modules/dsh-master` 指向本仓库，并在该 profile 的 `cordis.patch.yml` 里应用仓库自带的 patch。它会先禁用官方 `ui-workspace`，再插入 `dsh-master`，避免两个插件重复注册 `uiWorkspace`：

```yaml
- id: ui-workspace
  disabled: true

- insert:
    - id: dsh-master
      name: 'dsh-master'
```

先构建，再挂载——`lib/` 不进版本库，缺 bundle 时宿主会直接报错：

```powershell
pnpm install
pnpm build
dsh --profile desktop --dump-config   # 退出码 0，且 `- id: dsh-master` 恰好出现 1 次
```

之后重启或刷新 DSH Desktop。左侧工作区树中的本地与「远程工作区」是平级可折叠组；本地搜索、添加入口保留。点击远程会话会打开 `dsh-master` 面板，不再显示独立的「远程」图标入口。

## 配置

写在 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-master
  name: 'dsh-master'
  config:
    coordinatorUrl: 'http://127.0.0.1:39472'
    apiToken: '<coordinator 的 operator token>'
    trustedHosts: []
    allowPrompt: false
    requestTimeoutMs: 30000
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `coordinatorUrl` | `http://127.0.0.1:39472` | coordinator 的 origin，末尾斜杠会被去掉 |
| `apiToken` | 无 | coordinator 的 **operator** token（不是节点 token）。只作为请求头发送，不进任何响应或日志 |
| `trustedHosts` | `[]` | 额外允许访问本插件路由的 authority。回环地址始终允许 |
| `allowPrompt` | `false` | **发消息会在远程机器上真实跑一个 agent 回合**（可改文件、执行工具）。默认关闭，关闭时在读请求体之前就拒绝 |
| `requestTimeoutMs` | `30000` | 单次 coordinator 调用的截止时间 |

## HTTP 路由

全部挂在 `/dsh-master` 前缀下，先过信任围栏（DNS rebinding / 跨站防护），响应是 `{ok:true,value}` / `{ok:false,error:{code,message,details}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-master/api/status` | coordinator 可达性与节点数 |
| GET | `/dsh-master/api/nodes` | 节点列表 |
| GET | `/dsh-master/api/sessions?nodeId=` | 某节点的会话列表 |
| GET | `/dsh-master/api/session/questions?nodeId=&sessionId=` | 读取待答问题；当前远程会话打开时每 5 秒续租查看状态，存在未完成的 `ask_user_question` 时每 1.5 秒轮询 |
| GET | `/dsh-master/api/session/follow?nodeId=&sessionId=` | NDJSON 长流：`open` → `data`… → `end`，失败为 `error` 记录 |
| POST | `/dsh-master/api/session/question-answer` | `{nodeId, sessionId, requestId, answer}`；把选项和自定义文本返回给原问题调用，不创建新消息 |
| POST | `/dsh-master/api/session/question-cancel` | `{nodeId, sessionId, requestId}`；取消原问题调用 |
| POST | `/dsh-master/api/session/prompt` | `{nodeId, sessionId, text, mode?}`；`allowPrompt` 为假时返回 403 `master/prompt-disabled` |

节点与 coordinator 的业务错误码原样保留（例如 `session/not-found`、`coordinator/node-offline`），本插件自己的拒绝用 `master/*`。

## 开发

```powershell
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest，需先 pnpm build（bundle 不变式测试读 lib/client.js）
pnpm build       # 声明文件 + 两个 bundle
pnpm dev         # tsdown --watch
```

### 几个不能忘的约定

- `package.json` 的 `exports` **必须**导出 `"./package.json"`。缺了这一行，宿主定位不到插件清单，会把整个包**静默跳过**——宿主一切正常，浏览器里什么都没有，且没有任何日志。
- client bundle 只能 `require` shell 冻结的平台表里的模块（`react` / `react-dom` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-client-ui-primitives` / `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-dockkit`）。多要一个同样是静默失败。
- 不要注册 `root` slot：它是 single，后注册者 priority 更低，会把整个 AppFrame 顶掉。
- 跨插件 slot 依赖必须用 `ctx.slots.inject(key, cb)`；`dsh.client.inject` 只控制 bundle 到达顺序，不构成 apply 顺序。`dsh-master` 替代官方 `ui-workspace`，因此也保留了官方声明的会话、工作区、远程服务及 UI 前置模块。

`test/manifest.test.ts` 与 `test/client-bundle.test.ts` 守着前两条。

## 下一步

1. 刷新当前桌面 UI，截图确认新增远程节点组的官方风格、节点状态、会话 overflow 和面板跳转。
2. 面板选中态持久化——`main` 的选择不持久化，刷新会回到对话页。
3. 工具授权审批仍未实现；它不同于已支持的 `ask_user_question`，需要单独的节点侧应答通道。

## License

MIT
