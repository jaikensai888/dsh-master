# dsh-node Git push 与版本发布流程

日期：2026-11-06。适用仓库：`https://github.com/jaikensai888/dsh-node`。

## 当前状态

这是约定与待实现流程，不代表发布自动化已上线。检查时本地 dsh-node 的包版本与源码常量都是 `0.1.0`，未发现 `.github` 工作流。
本文暂存在 dsh-master；实施时复制为 dsh-node 的 `docs/git-push.md`，并在其根 AGENTS.md 中加入触发入口。不要将本文的相对路径直接复制为错误入口。

## 收到用户指令时如何判断

| 用户指令 | 执行动作 |
| --- | --- |
| git push / 推送代码 | 推送目标仓库当前分支已有提交；不默认提交工作区内容，不创建 Tag |
| 提交并推送 | 审查并提交本任务相关改动，完成验证，再推送当前分支 |
| 发布 vX.Y.Z / 构建并发布指定版本 | 按下方完整发布流程执行，创建版本 Tag 并跟踪 Release |
| 升级到 vX.Y.Z | 按安装升级文档操作本机目标 profile；不创建发布版本 |

优先从当前任务、cwd、remote 和分支确认目标；只有不能可靠判断时才询问。用户说“git push”不自动授权跨仓库操作。
本流程采用显式发布：普通分支推送执行 CI，版本 Tag 推送才发布 Release。

## 普通推送

1. 在目标仓库读取 AGENTS.md；检查 `git status --short`、`git diff`、`git diff --cached`、`git branch -vv`、`git remote -v`。
2. 保留用户已有改动，不使用 `git add .` 收进无关文件；没有要求提交时不自行创建提交。
3. 检查目标 upstream、待推送提交及其验证证据。相关代码改动没有有效验证时，运行对应检查；文档改动检查路径、内容和 diff。
4. 执行普通 `git push`；无 upstream 时确认目标后显式设置。禁止默认使用 `--force`、`--tags`、`--mirror`。
5. 若被拒绝，先检查分支分歧和远端状态，不自动重写历史或破坏本地工作。
6. 报告仓库、分支、提交和推送结果；若有 CI，则查看并报告结果，失败不能宣称全部完成。

Git 所有权检查失败时不要修改全局安全配置；报告阻碍，按环境允许方式解决后继续，不能把失败视为检查通过。

## 指定版本发布

以下流程在实施计划完成后生效。示例 `0.2.0` 仅作格式说明，不是已批准的首发版本。

1. 确认用户给出的目标版本；未指定且无法推断时询问，不擅自决定版本号。检查工作区、目标提交、远端 Tag 和既有 Release。
2. 将 `package.json.version` 更新为目标语义版本，编写对应更新说明；版本不带 `v`，Tag 带 `v`。预览版如 `0.3.0-rc.1`。
3. 按仓库固定的 Node.js/pnpm 版本及锁文件安装，执行 typecheck、test、build、打包和安装包冒烟。不得仅凭 typecheck 通过发布。
4. 审查只包含本次版本相关文件的 diff。提交并推送目标分支；默认发布 main 上的提交，其他分支需任务明确指定。
5. 在已验证提交创建 annotated Tag，例如 `git tag -a v0.2.0 -m 'dsh-node v0.2.0'`，再显式 `git push origin v0.2.0`。
6. 跟踪该 Tag 对应 Actions：校验 Tag/包版本 → 测试 → 构建 → 打包 → 冒烟 → 创建草稿 Release → 上传附件 → 发布。
7. 验证 Release 非草稿、版本/commit 正确、附件齐全且可下载，校验值与产物一致，正式版与预览版标记正确。
8. 返回 Tag、commit、Actions 和 Release 链接、验证结果；发布成功不等于任何远端节点已经升级。

## 发布产物与失败处理

- `dsh-node-X.Y.Z.tgz`：通过包管理器打包的插件，含 `lib`、`build-info.json`、`package.json`、必要资源和文档。
- `SHA256SUMS`：上述安装包的 SHA-256；通过可信 GitHub Release 获取，校验只证明内容一致，不代替来源信任。
- Release Notes：更新内容、Node.js/DSH 要求、安装和重启提示。
- 当前 `ws`、`schemastery` 是外置运行依赖；安装指南必须处理生产依赖，不能只解压 `lib` 就宣称安装完成。
- CI 失败：保留诊断；不发布缺少附件的正式 Release。相同提交允许重试未发布流程；需要改代码则使用新版本，不移动已发布 Tag、不替换已发布产物。
- 启用不可变 Release 时必须先草稿、上传齐全后再发布；禁止先发布再补附件。
- GitHub 访问失败、权限不足、无法完成下载验证时，明确报告未完成项，不声称成功。

## 参考

- [GitHub Release 管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [GitHub Actions 触发事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
