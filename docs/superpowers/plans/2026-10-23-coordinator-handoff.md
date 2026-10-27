# DSH Coordinator 完整实施交接包

日期：2026-10-23。用途：交给未参与本轮讨论的 Agent 实现。当前仅有方案与演示原型，未实现业务代码、未迁移数据库、未发布服务器。

## 1. 从这里开始阅读

| 顺序 | 文件 | 解决什么问题 |
|---|---|---|
| 1 | [设计说明](../specs/2026-10-23-node-usage-design.md) | 已确认目标、架构、统计边界、数据恢复与登录方案 |
| 2 | [接口与数据契约](../specs/2026-10-23-node-usage-contracts.md) | 字段、类型、Remote、HTTP、数据库、鉴权和错误行为 |
| 3 | [实施计划](2026-10-23-coordinator-console-usage.md) | 11个有依赖的任务、文件责任、接口、测试和部署交接 |
| 4 | [登录及控制台原型](../specs/2026-10-23-coordinator-console-login.html) | 登录、退出、会话过期与进入用量页的布局参考 |
| 5 | [独立用量原型](../specs/2026-10-23-coordinator-usage.html) | 概览、节点详情、日期与趋势切换参考 |

这些 HTML 是可视化片段，有示例数据，不能直接替换生产 UI。浏览器中演示的假导航、假账号、假汇总必须在实现中换成真实功能。主实施文档在当前 dsh-master 目录保存，实施前复制进 Coordinator 文档并记录正式入口，不能仅携带其中一份计划而丢失契约。

文档冲突优先级：用户后续明确要求 > 本交接包确认范围 > 同日 contracts/implementation plan 的具体定义 > 早期 design 概述 > 原型示例数据。若 contracts 与 implementation plan 实质冲突，先纠正两份文档并报告，不自行分叉两套协议。

## 2. 已确认的交付范围

1. Coordinator统一SQLite保存节点登记、operator/node凭据、登记规则、单管理员、会话、用量及同步游标；迁移旧coordinator-state.json且保留备份，后续不双写。
2. 单管理员用户名/密码登录，无公开注册；服务器本地初始化/重置，浏览器用HttpOnly Cookie，localhost同样需要认证。
3. 通过 `http://192.168.0.13:8101` 访问管理端；它是局域网地址，不代表公网可达。本轮不新增域名、HTTPS或穿透；HTTP无链路加密要明确说明。
4. Node统计所有经过DSH runtime的模型调用，包括节点本地、Coordinator发起、原生子调用、压缩和标题生成；外部独立客户端不自动覆盖。
5. 输入、缓存读写、输出Token、模型调用次数和调用状态；unknown单独显示；重试按调用计；不做费用、历史自动补录、预算、多用户和HA。
6. Node本地落盘→Coordinator分页拉取→事务入库→ACK→安全清理；重连/ACK丢失不重复累计，数据缺口不能当零。
7. 完整登录、节点管理、用量概览、节点详情、调用筛选分页、退出与修改密码；保留原来可用的节点/会话操作。

## 3. 代码与部署上下文

| 项目 | 本地路径 | 本轮责任 |
|---|---|---|
| dsh-node | G:/claude_project/code-agent/dsh-node | runtime采集、队列、三个nodeUsage Remote、诊断 |
| dsh-coordinator | G:/claude_project/code-agent/dsh-coordinator | 统一DB、迁移、同步、聚合API、认证、Web UI、部署文档 |
| dsh-master | G:/claude_project/code-agent/dsh-master | 本交接文档存放处，首期不要求改其业务代码 |
| deepseek-harness | G:/claude_project/code-agent/deepseek-harness | 只读核对宿主API；不能预先修改核心 |

发布事实源为 `G:/claude_project/code-agent/dsh-coordinator/docs/fabu.md`，通过 fabu 的 registry 找到；不要拿其他项目的发布地址代替。

文档记录：SSH `pc@192.168.0.13`，目录 `~/dsh-coordinator`，`systemd --user` 服务 `dsh-coordinator.service`，`0.0.0.0:8101`，当前 `/ui` 代码仅允许loopback。Node24.12.0/pnpm10.30.3为发布文档基线，本轮未远程核验。旧部署使用 `--state-file` 且安装包含 `--ignore-scripts`；这两项必须纳入迁移和SQLite兼容性测试。每个实际Node宿主的位置与ABI尚未确认，不能假定都在这台Linux服务器。

## 4. 可直接复制给实施 Agent 的提示词

> 请实现 DSH Coordinator 管理登录、统一 SQLite 与按节点统计模型用量的完整功能。
>
> 先完整阅读 `G:/claude_project/code-agent/dsh-master/docs/superpowers/plans/2026-10-23-coordinator-handoff.md`，再按其中顺序阅读设计说明、接口契约、实施计划及两份原型。检查 dsh-node、dsh-coordinator 的 AGENTS.md、git状态及用户已有改动。不要只读原型就写页面，也不要只写计划；按 Task 0→10 完成本地实现、必要测试、构建和运维文档。
>
> 先验证真实DSH宿主的LLM观察入口与SQLite驱动ABI/安装。若采集覆盖或驱动不能满足要求，提供具体证据和最小调整建议；禁止用模拟通过代替真机验证，禁止未经确认升级用户宿主或悄悄缩小统计范围。
>
> 实现范围为 dsh-node 与 dsh-coordinator，首期不改 dsh-master 业务和 DSH 核心。保留已有 Node/Coordinator token；用户名密码与node-token、operator-token分开。旧JSON迁移到唯一SQLite真源；Cookie会话鉴权覆盖localhost；保留机器Bearer客户端兼容。所有接口字段以contracts为准。
>
> 如使用多个Agent，请按计划的文件责任分工，先冻结公共契约；明确告知各Agent他们并非独占代码库，禁止回滚他人修改。server.ts/http-api.ts/cli.ts由集成负责人合并，避免并发编辑冲突。分仓库提交改动，提交时仅包含本任务文件。
>
> 不要把原型的demo-pass、示例节点、模拟趋势或假导航带入产品。所有管理导航需可用，未知用量与离线缺口不能显示为已知零。实现后台轮询不续期、改密/退出关闭原会话长流、Node保存配置不会重复采集。
>
> 当前只授权本地实现与验证及部署准备；不要修改192.168.0.13运行配置、重启服务、设置真实密码或发布。完成后给我两个仓库的commit/版本、实际SQLite驱动与宿主验证矩阵、测试/类型检查/构建结果、登录/概览/详情截图、迁移/恢复证据，以及未完成项。线上发布需在这些结果可审查后另获明确授权。不要索取明文管理员密码，初始化时由我在服务器TTY输入。

## 5. 如何判断实现没有遗漏

- [ ] 首次启动能原样迁移旧节点/撤销状态/token；坏JSON不部分导入，同目录多个JSON不串库；二次启动不重复导入。
- [ ] SQLite写失败不产生“内存已允许、磁盘未保存”的握手/配置成功；native依赖在真实DSH宿主和Linux部署环境能加载。
- [ ] 单管理员初始化、登录、错误密码限速、退出、30分钟空闲/12小时绝对到期、改密/重置与会话撤销都可验证；没有公开建号口子。
- [ ] 匿名或错凭据不能访问管理数据和流，localhost无免认证；有效旧operator客户端及node握手仍可工作。
- [ ] Node调用、重试、压缩、标题和原生子调用按已验证路径采集；暂停网络仍采集、设置保存不重复挂观察器、进程重启保留已知usage。
- [ ] Node断网补传、Coordinator重启、ACK丢失及同批重放不重复；同seq不同内容停同步；备份缺口可解释且可继续。
- [ ] Token计算精确，缺字段不冒充零；总量可空，已知桶仍入下界；后台图表/表格/明细一致，模型分布基于全部结果。
- [ ] 真正接入API的登录/概览/节点详情与原有节点管理可用，320/736/1024宽度和键盘交互通过；原型中的假数据已移除。
- [ ] 两仓库完整test/typecheck/build通过，真机与fixture证据分开记录，没有未经证实的“线上已发布”。
- [ ] 交付可操作的迁移、备份、Node部署、服务器管理员初始化、发布验证和回滚步骤。

## 6. 已知限制与实施前置

SQLite具体版本和DSH宿主ABI还需 Task0 实测；安全审计后的依赖版本不能由计划猜测。供应商未返回usage、落盘前崩溃、磁盘损坏无法承诺与供应商账单完全一致。旧JSON备份与统一数据库都包含敏感凭据，不能上传或贴入报告。原型只验证布局和本地演示交互；真实鉴权、统计和线上运行尚不存在。

本轮交接完整性检查：本文件引用的设计、契约、计划和两个原型均需实际存在；实施Agent即使拿不到原聊天也应能理解范围、接口、任务顺序与发布边界。
