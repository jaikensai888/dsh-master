# 当前仓库的 Agent 入口

遵循上级规则；修改前检查现有文件和用户改动。

## Git push 与 dsh-node 发布

用户提到 `git push`、推送、Tag、Release 或 dsh-node 版本发布时，先阅读
`docs/dsh-node-git-push.md`，根据目标仓库和普通推送/版本发布的区别执行。

本仓库是 **dsh-master**。发布流程针对相邻的 **dsh-node**；不得因为在此看到流程而误推送当前仓库或自动切到其他仓库。
普通 `git push` 不隐含创建版本 Tag 或发布 Release。文档里的未来功能必须先检查是否已实现。

## dsh-node 版本管理交接

- 实施计划：`docs/superpowers/plans/2026-11-06-dsh-node-version-release.md`
- 开发交接 Prompt：`docs/prompts/2026-11-06-dsh-node-version-release.md`

这些文件目前暂存在 dsh-master；开发 Agent 应将适用的长期操作文档和入口规则落到 dsh-node 仓库。
