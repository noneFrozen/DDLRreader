# OpenCode 冷启动提示词：Task 1–2

复制下方完整内容到一个全新的 OpenCode session。不要附加此前与 Codex 的聊天记录、memory、`SPEC_PROCESS.md` 内容或口头解释。

---

你是 DDL Radar 项目的陌生冷启动实现智能体。请在以下已经准备好的 Git worktree 中工作：

`C:\Users\Admin\Desktop\Application\.worktrees\opencode-cold-start`

这是一次规格可执行性验证，不是开放式探索。严格遵守以下约束：

1. 先确认当前目录、分支和状态：
   - `git rev-parse --show-toplevel`
   - `git branch --show-current`
   - `git status --short`
   预期分支为 `codex/opencode-cold-start`，状态为空。若不一致，立即暂停并报告，不要自行切换分支、清理文件或创建另一个 worktree。
2. 需求上下文只允许来自根目录的 `SPEC.md` 与 `PLAN.md`。开始前完整阅读这两个文件；不要读取 `SPEC_PROCESS.md`、其他需求文档、其他智能体聊天记录、memory 或主工作区中的未跟踪文件。
3. 只执行 `PLAN.md` 的 Task 1 和 Task 2，严格按顺序进行；不要提前执行 Task 3，也不要自行扩展产品范围。
4. 使用 Superpowers 流程：先检测当前 worktree 隔离状态，然后按计划执行；实现行为必须遵循 test-driven-development。不要再创建 worktree。
5. 遇到任何不确定、矛盾、缺失前置条件或有多种合理解释之处，立即暂停并向我提问，不得凭猜测继续。提问时指出：文件位置、相关原文、至少两种可能解释、你需要我决定什么。
6. 不得修改 `SPEC.md` 或 `PLAN.md`。若发现文档缺陷，只记录并暂停等待决定。
7. 每个 Task 单独提交，沿用 PLAN 中规定的 commit message：
   - Task 1：`chore: bootstrap DDL Radar workspaces`
   - Task 2：`feat(domain): define planning types and time blocks`
   不要 squash、rebase、amend 或强制推送。
8. Task 1 完成前运行 PLAN 指定的完整验证；Task 2 完成前运行 domain 测试和 typecheck。必须报告每条命令的实际退出码，不能只说“通过”。
9. Task 2 必须保留 TDD 的红—绿证据：先运行失败测试并记录预期失败原因，再实现最小代码并重新运行直到通过。若失败原因不是 PLAN 预期原因，先停下分析，不要直接绕过。
10. 不得通过 `--passWithNoTests`、跳过测试、放宽 TypeScript 检查、删除断言或改写需求来取得绿色结果。
11. 不读取或复制 `C:\Users\Admin\Desktop\Application` 主工作区内的 `apps/`、`packages/`、`tests/`、`node_modules/` 等未跟踪内容。所有实现必须仅从当前 worktree 的 `SPEC.md`、`PLAN.md` 和你在本次执行中创建的文件推导。

执行过程中请逐项保存以下事实，最终回复按该格式输出：

```text
## 环境
- OpenCode 版本：
- 底层模型及版本：
- worktree 路径：
- 分支：
- 起始 commit：

## Task 1
- RED 命令、关键输出、退出码：
- GREEN/最终验证命令、关键输出、退出码：
- 生成/修改文件：
- commit hash：

## Task 2
- RED 命令、关键输出、退出码：
- GREEN/最终验证命令、关键输出、退出码：
- 生成/修改文件：
- commit hash：

## 暂停问题或规格缺陷
- 若无，明确写“无”；若有，逐项附原文和位置。

## 最终状态
- `git status --short` 的完整输出：
- `git log -3 --oneline` 的完整输出：
- 是否完整完成 Task 1–2：是/否
```

现在开始。先只报告环境检查结果以及你从 `SPEC.md`、`PLAN.md` 理解到的 Task 1–2 边界；确认无阻塞后再写代码。

