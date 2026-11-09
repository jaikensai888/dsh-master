# dsh-node 版本与 GitHub 发布实施计划

> **For agentic workers:** 使用可用的 executing-plans 技能逐项执行；用户已选择交给其他 Agent 开发，本次不实施功能。

**Goal:** 本机 Agent 能确认已安装/实际运行版本，并从 GitHub 安装指定版本的已构建插件。

**Architecture:** package.json 是版本号唯一来源；构建时生成并嵌入元数据，本地状态接口返回运行中构建的信息。版本 Tag 触发 GitHub Actions 生成 Release；远程 Agent 根据文档完成指定版本安装，无专用升级工具。

**Tech Stack:** 现有 TypeScript、tsdown、Vitest、pnpm、GitHub Actions/Releases。

**Spec:** 本文“已确认需求与约束”及 [发布流程](../../dsh-node-git-push.md)。

## 已确认需求与约束

- 仅实施 `G:/claude_project/code-agent/dsh-node`。本文及 Prompt 暂存在 dsh-master，不修改 master/coordinator 业务代码。
- 不增加节点版本上报、Coordinator 版本管理、最新版本轮询、专用更新工具、自动远程升级或 npm 发布。
- 本机 Agent 读取文件查询安装版本，通过现有本地状态接口查询实际运行版本；不能用磁盘包版本代替进程版本。
- 继续使用现有路由和访问围栏，不新增入站监听，不绕过本地鉴权，不返回 Token、用户目录或环境秘密。
- 普通 push 只运行 CI；明确发布指定版本时推送 `vX.Y.Z` Tag，发布已编译安装包。
- 保留配置、Token、nodeId、会话、附件与用量数据；不能直接覆盖带改动的 link 源码目录。
- 当前包要求 Node.js >=20；开发时结合构建依赖确认 CI Node.js/pnpm 版本，固定版本并记录，不随意提升运行要求。
- 首次发布版本未指定。完成本地实现无需等待版本决定；实际创建 Tag/发布前再确认。开发任务不包含提交、推送、真实节点重启或实际发布授权。

## 现有依据与文件范围

已核对：`package.json.version` 与 `src/index.ts` 的 `PLUGIN_VERSION` 均为 `0.1.0`；`src/http-api.ts` 的 `NodeStatusView` 已有 `pluginVersion`。
`src/protocol.ts` 的 `dsh.version` 表示 DSH 宿主版本，保持原义，不改 WS 协议。
`tsdown.config.ts` 输出 `lib/index.js` 和浏览器包，宿主外置 `ws`/`schemastery`。
README 当前通过 `dsh plugin --profile desktop add dsh-node@link:<绝对路径>` 安装；具体切换/移除方式实施前检查真实 DSH CLI，不能编造命令。

| 文件（均相对 dsh-node） | 责任 |
| --- | --- |
| `package.json`、`pnpm-lock.yaml`（必要时） | 构建脚本、打包白名单、固定包管理器 |
| `tools/build-info.mjs`（新增） | 生成元数据并校验发布版本 |
| `tsdown.config.ts`、`src/index.ts` | 嵌入构建信息，移除手工版本常量 |
| `src/http-api.ts` | 扩展本地状态响应类型 |
| `test/build-info.test.ts`（新增）及既有状态/集成测试 | 版本来源、运行快照和兼容性 |
| `.github/workflows/ci.yml`、`release.yml`（新增） | 普通 CI 与 Tag 发布 |
| `tools/verify-package.mjs`（新增） | 实际安装包冒烟 |
| `README.md`、`docs/git-push.md`、`docs/install-version.md`、`AGENTS.md` | 长期操作入口与 Agent 安装步骤 |

文件名为本计划建议；如已有等价模块优先复用，交付时说明实际位置。

## 构建信息契约

安装包根目录 `build-info.json` 固定包含：

```json
{
  "version": "0.2.0",
  "commit": "完整提交 SHA",
  "builtAt": "UTC ISO 8601",
  "channel": "stable",
  "dirty": false
}
```

- `version` 只来自 package.json；`channel` 为 stable/preview/dev。非发布构建一律 dev；预发布 Tag 为 preview，正式 Tag 为 stable。
- 发布构建要求合法语义版本、Tag 精确匹配、源码干净、commit 存在；Git 检查必须在生成文件之前完成，不能把构建输出当源码改动。
- 非发布构建缺少 Git 元数据可用 `commit: null`、`dirty: null`，明确未知，不能冒充正式构建；dirty 开发构建必须可识别。
- builtAt 为实际构建时间。同次构建生成文件与嵌入宿主 bundle 的信息必须一致；不得从仍运行进程动态读取可被替换的磁盘文件。
- 本地状态保留 `pluginVersion: string`，新增 `buildInfo` 对象，其 version 与 pluginVersion 一致。响应包裹形状与原路由保持兼容。
- 如果没有可运行宿主，本机 Agent 只能确认安装信息，必须明确“运行版本未验证”。

## Review Focus

1. 包已更新、旧进程仍运行：状态返回旧构建，安装文件返回新构建，不能误报升级完成。
2. 无 Git、脏源码、错误 Tag：开发信息明确未知；正式发布失败且不产生可见 Release。
3. 外置依赖、打包遗漏、残留 lib：干净构建与实际 tgz 安装验证发现错误。
4. link 目录带用户改动、多个 profile：先识别，保留源码与数据，只切换指定 profile。
5. GitHub/重启失败：分别报告发布、安装、运行验证状态，旧版本可保留或恢复，不覆盖正式历史。

## Task 1：统一版本来源与本机运行查询

**Interfaces:** tools/build-info.mjs 生成上述 JSON；构建将同一对象作为常量嵌入宿主；NodeStatusView 消费常量。

- [ ] 在 `test/build-info.test.ts` 写失败测试：生成 version 等于 package.json；错误 Tag 拒绝；dirty 发布拒绝；无 Git 开发构建 channel=dev 且 commit=null；同次 JSON 与嵌入信息一致。
- [ ] 运行新增测试确认因功能缺失失败，而非环境问题。
- [ ] 实现元数据生成及构建接入，版本源只有一处；避免新添纯工具依赖。更新打包 files 白名单和生成文件忽略规则。
- [ ] 修改 index/http-api：运行状态使用已嵌入常量；保留 pluginVersion。更新原来约束硬编码常量的测试。
- [ ] 扩展既有 HTTP/集成测试：替换磁盘 build-info 后旧实例仍返回旧值；模拟加载新 bundle 后新实例返回新值；错误请求和脱敏行为不变。
- [ ] 运行新测试、相关状态/集成测试和 typecheck，确认通过。

## Task 2：构建安装包及其校验

**Interfaces:** 产物 `dsh-node-X.Y.Z.tgz`、`SHA256SUMS`；包内含上面的 build-info.json，外置依赖仍由生产依赖安装处理。

- [ ] 为包验证工具添加失败用例：缺少 lib/client.js、build-info.json、package.json 或版本不一致均失败。
- [ ] 实现干净临时目录构建/打包路径；本机正在使用的 lib 不可直接递归删除，CI 必须从干净 checkout 构建。
- [ ] 用 pnpm pack 生成标准插件包，检查文件列表，不打包 node_modules、配置、Token、测试日志或无关文件；生成 SHA256SUMS。
- [ ] 实现 tools/verify-package.mjs：在临时目录安装实际 tgz 和必要 peer/生产依赖，验证导出入口、客户端文件、元数据和插件可加载；不可只校验源目录文件存在。
- [ ] 校验生产依赖包含 ws/schemastery，客户端仍依赖宿主模块表，保持原 bundle 约定；修改包/校验值的用例应失败。
- [ ] 执行完整 typecheck、test、build、pack 和实际 tgz 冒烟，记录命令及结果。

## Task 3：GitHub CI 与指定版本发布

**Interfaces:** ci.yml 消费普通分支/PR；release.yml 消费 `push.tags: ['v*']`，只接受合法完整版本；附件使用 Task 2 产物。

- [ ] 新增 ci.yml：固定 Node.js/pnpm，frozen-lockfile 安装，typecheck/test/build/pack/冒烟；PR 任务无发布权限。
- [ ] 新增 release.yml：checkout 精确 Tag（可获得 commit/Tag），校验 Tag 与版本，重复执行验证；采用并发控制避免同 Tag 重复发布。
- [ ] 发布前全部验证成功；在同一工作流内创建草稿、上传 tgz/SHA256SUMS、校验附件后发布。不要依赖该工作流所创建 Release 再触发另一个工作流。
- [ ] GITHUB_TOKEN 权限限制为发布所需 contents:write；Actions 固定到核实过的版本/commit，不使用浮动 main。
- [ ] rc/alpha/beta 等版本标记 prerelease 且不设为 latest；发布历史旧版本不能覆盖较新正式版的 latest，使用语义版本规则。
- [ ] 同 Tag 已发布则拒绝替换；中断仅可对相同 commit 的未发布草稿重试；附件失败不得留下已公开的半成品。
- [ ] 验证 YAML、Tag 正则、正式/预览/历史版策略和失败路径；本地不能验证的 GitHub 权限及托管运行列为待验证，不伪造线上结果。

## Task 4：Agent 安装升级文档与长期入口

**Interfaces:** 根 AGENTS.md 遇到 git push/发布读取 docs/git-push.md；遇到查询版本/指定版本安装读取 docs/install-version.md。

- [ ] 将当前发布流程复制到目标仓库 docs/git-push.md，修正文档相对链接及“待实现”状态，保留普通 push 与发布的区别。
- [ ] 创建 docs/install-version.md，给出 Agent 可实际运行的 Windows PowerShell 与 Linux/macOS 命令；通过真实 CLI 帮助验证 profile 查询与安装切换语法。
- [ ] 文档覆盖：定位目标 profile 的实际插件路径、读安装元数据、查询 GET /dsh-node/api/status、旧节点缺字段处理；端口/鉴权按现有宿主配置确定，不硬编码或绕过围栏。
- [ ] 覆盖指定 Release 下载、SHA256 校验、兼容性检查、独立版本目录安装生产依赖、保留旧目录、切换指定 profile、重载/重启及运行版本+commit 验证。
- [ ] 覆盖源码 link 本地改动、重复安装、多个 profile、网络失败、校验失败、宿主离线及恢复旧版本；运行/流量繁忙时说明影响，按任务授权决定重启，不自动中断会话。
- [ ] 首次从旧源码链接切换需记录原路径与配置引用；不删除 DSH_HOME 中身份、配置、会话、附件或统计数据。不承诺不兼容数据迁移后的任意降级。
- [ ] 在隔离测试 profile/临时目录验证可验证的步骤；未授权不得对用户真实运行实例升级或重启。
- [ ] 更新 README 版本查询/指定版本安装入口及根 AGENTS.md；已有规则保留，不能整文件替换。

## 最终验收与交付

- [ ] package.json 与嵌入元数据同源；tgz 的 version/commit/hash 正确且可安装。
- [ ] 本地状态保持兼容，正确区分安装与运行版本；不新增 WS 上报或监听端口。
- [ ] 普通 push 无 Release；合法 Tag 才发布，错误 Tag 拒绝，正式与预览版正确分类。
- [ ] 文档能让无上下文 Agent 完成指定版本安装和验证，并保留原身份与数据。
- [ ] 汇总实际文件、验证命令/结果、未完成项；交付差异供用户审阅，不擅自提交、推送或发布。

常用验证命令（在 dsh-node 执行）：

```text
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false test
pnpm --config.verify-deps-before-run=false build
```

pack/冒烟命令由本次实现后补入 README 与发布流程；网络/权限受限不能跳过后宣称通过。
