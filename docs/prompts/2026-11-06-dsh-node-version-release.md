# 交给开发 Agent 的 Prompt

复制以下内容到能够读写 dsh-node 仓库的 Agent：

---

请实际完成 dsh-node 的本机版本查询与 GitHub 指定版本构建发布，不要只给建议或再写一份计划。

先完整阅读：

1. `G:/claude_project/code-agent/dsh-master/docs/superpowers/plans/2026-11-06-dsh-node-version-release.md`
2. `G:/claude_project/code-agent/dsh-master/docs/dsh-node-git-push.md`
3. 目标仓库 `G:/claude_project/code-agent/dsh-node` 适用的 AGENTS.md、package.json、构建配置和现有安装说明。

若不是同一台机器，按实际 checkout 定位这些文件；先取得这两份文档，不猜测不存在的接口或安装命令。

用户已经确认的范围：

- package.json 是版本号唯一来源，构建生成 build-info.json 并将同份信息嵌入插件。
- 本机 Agent 能读出安装版本，现有本地状态接口能返回实际运行版本；更换磁盘文件不能使旧进程假装运行新版本。
- GitHub 普通 push 执行 CI；显式版本 Tag 触发测试、构建、标准 tgz 打包、SHA256 校验、产物安装冒烟和 Release 发布。
- 远程 Agent 根据文档安装指定 Release、处理生产依赖、切换指定 profile、重新加载并验证。保留旧版本用于恢复，保留配置、Token、nodeId、会话、附件及统计数据。
- 不开发节点版本上报、Coordinator 版本管理、专用升级工具、自动升级、npm 发布；不改 master/coordinator 业务代码。

按计划逐项实现并补充必要测试，优先复用已有模块。先检查 git 状态和已有改动，保留其他人的工作；不要删除正在使用的 lib，不覆盖带改动的源码 link。

完成后将发布操作流程放到 dsh-node/docs/git-push.md，另写 docs/install-version.md，并在 dsh-node 根 AGENTS.md 中加入 git push、版本发布、版本查询和指定版本安装的读取入口。修正文档中的相对路径，让未来 Agent 只读目标仓库也能执行。

可以完成本地代码、工作流、文档、测试及隔离安装验证。本任务不授权 git commit、git push、创建真实远端 Tag/Release、修改 GitHub 仓库设置、重启或升级用户真实 DSH profile。实际发布版本号尚未指定，不擅自创建 v0.2.0；不因此阻塞本地功能实现。

交付时提供：实际修改清单、关键设计决定、测试与构建/打包/安装冒烟结果、尚未验证的 GitHub 运行或宿主行为，以及后续首次发布需要执行的操作。未经运行的检查明确标为未验证。

---
