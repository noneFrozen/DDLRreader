# DDL Radar 项目反思报告

## AI 辅助说明

本报告由我提供个人观点与项目事实后，使用 Codex 辅助整理和润色。核心判断包括：Superpowers 很消耗 token；本项目中 Codex 比 OpenCode 更适合作为主开发协作者；如果重做，我会更早做架构设计。报告中的 commit、task、冷启动和评审事实来自 `SPEC_PROCESS.md`、`AGENT_LOG.md`、`PLAN.md` 与 Git 历史。

这次项目最开始其实不是从一个清楚的产品想法开始的。我一开始只是知道要做软件开发课程的大作业，但不知道什么产品既有真实价值，又能体现工程深度。最后选择 DDL Radar，是因为它不是又做一个普通待办清单，而是尝试回答一个更具体的问题：在多个 deadline 同时逼近时，我到底有没有足够的可用时间，最早的冲突在哪里，是哪些任务共同造成了这个缺口。这个问题对学生很真实，也比较适合测试，因为它可以转化成确定性的容量分析、排程和风险判断。

Superpowers 里最有用的部分，我认为是 brainstorming、writing-plans、TDD 和 review 这几层连在一起的工作流。brainstorming 把“做什么”从模糊状态收敛到网页应用、一个核心流程、精致产品界面；writing-plans 又把它拆成可以派给 subagent 的任务。后面真正证明有价值的是 review。比如 Task 10 中，前端已经能保存可用时间和任务，但 reviewer 发现刷新后没有从后端恢复状态、timezone fallback 不够健壮、后端字段错误可能不显示。Task 11 中，reviewer 又发现红色风险确认按钮可以重复点击，从而重复创建计划；失败的生成请求还会造成 unhandled rejection。这些都不是“页面看起来能用”就能发现的问题。

最烦的一点也很明确：这个流程非常消耗 token。每个 task 都要 brief、report、review package、fix report、re-review，再加上 controller 自己的验证和记录，整个过程很重。尤其是前端任务，测试输出、diff、组件代码和 CSS 都很长，等一轮 review 经常会消耗大量上下文。这个成本有时让我觉得形式感很强。但做完之后我也承认，它不是纯粹的形式主义。AI 很擅长快速写代码，也很擅长自信地说完成了；如果没有这些流程，很容易把边界 bug、错误处理和验证环境差异直接带到后面。

TDD 在这个项目里总体是放大器，不是阻碍。它确实拖慢速度，尤其 UI 测试遇到 jsdom、异步状态和 Vite/esbuild sandbox 权限时，会多出很多与业务无关的成本。但 TDD 让很多“看似简单”的规则有了证据。例如 Task 2 的时间块函数先因为函数不存在而 RED，再实现通过；Task 3-5 用测试固定累计容量、依赖顺序、冻结块和进度扣减语义；Task 6-8 用测试覆盖 SQLite 迁移、事务回滚、DST、ICS 和计划更新；Task 9-11 则用 Testing Library 锁定可访问性、payload、错误显示和关键交互。OpenCode 在 Task 1 中测试和实现一次性写入，首次运行就通过，这件事被记录为流程偏差，也让我意识到“有测试”和“有先红后绿证据”不是一回事。

Subagent-driven workflow 的效果取决于 task 颗粒度。领域层 Task 3-5 最适合交给 subagent，因为输入输出清楚，测试也容易表达。后端 Task 6-8 虽然重，但可以按持久化、REST API、计划编排来分层。前端 Task 9-11 就明显复杂一些，因为 UI 状态、API client、CSS、可访问性和异步行为会互相影响。Task 11 尤其大，包含冲突分析、计划生成、进度更新、锁定、移动和 ICS 导出。如果重做，我会把它拆成“冲突分析 UI”和“计划管理 UI”两个 task，避免一个 subagent 在一个任务里处理太多状态。

SPEC 和 PLAN 的质量直接影响实现质量。冷启动 OpenCode 暴露了几个很典型的问题：Vitest 在无测试文件时退出码为 1，但早期 PLAN 却要求根 `npm test` 通过；空 `src/` 会导致 TypeScript `No inputs`；Task 3 的测试辅助函数没有定义；`firstConflict.taskIds` 到底表示当前节点任务还是累计造成冲突的任务也不清楚。这些不是实现能力问题，而是规约没有写完整。后来我发现，对 AI 来说，没有写进 SPEC/PLAN 的隐性假设基本等于不存在。每次预检先把跨层契约写进 PLAN，再派发实现，效果明显更稳。

我最有效的 prompt/context 策略是减少上下文，但提高边界密度。实现者不需要完整聊天历史，只需要 task brief、相关接口、禁止事项和 report contract；reviewer 也不需要整个仓库，只需要 brief、report、diff package 和全局约束。这样做比把所有背景都塞进去更有效，因为它减少了模型在无关信息里漂移的机会。OpenCode 冷启动时只允许读 SPEC/PLAN，也正因为没有共享之前的对话，才暴露了真实的计划缺口。主开发中我更偏向 Codex，因为 Codex 在长链路协调、review 修复和持续记录方面更稳定；OpenCode 适合做陌生智能体冷启动验证，但 Task 1 中缺少 RED 证据，说明它对流程纪律的执行没有 Codex 稳。

Open Design 的经历也很有代表性。最初的 UI 方向我不满意，后来提供了“仿生有机 2.0”的参考图，再比较 A 视觉型和 B 平衡型，最终选择 B Organic Productive。Open Design 对探索风格很有帮助，但它不是生产真值。中间出现过预览接近默认浏览器样式的问题，原因和 CSS 往返、`oklch()` / `color-mix()` 兼容有关。最后 Task 9 通过 hex fallback、OKLCH token、响应式布局、对比度和可访问性测试把视觉方向固定下来。这个过程让我认识到，AI 可以帮助生成视觉方案，但审美判断和真实浏览器验证还是必须由人负责。

如果重做，我最想提前做的是架构设计。更早确定领域层、API 层、持久化层、前端状态、测试边界、CI/CD 和部署之间的关系。比如 availability 到底由 repository 解析还是应用服务解析，schedule block 的 ID 是否跨 plan 复用，前端课程是否需要真实 course API，这些问题如果晚一点才发现，就会让后面的任务反复修 PLAN。

我对 Superpowers 的总体看法是：它很重，很贵，也很消耗 token，但在这个项目里大部分成本是值得的。它假设需求可以逐步冻结、任务可以拆分、reviewer 能独立发现问题。这个假设在领域算法和后端 API 中基本成立，在复杂前端和视觉设计中则需要更多人工判断。它不能替我决定做什么，也不能替我判断什么叫做好；它真正提供的是一套防止 AI 协作失控的工程护栏。做完这个项目后，我对“AI 时代工程师的价值”有了更具体的理解：价值不在于手写每一行代码，而在于定义问题、冻结语义、拆分任务、审查输出、识别工具幻觉，并对最终系统负责。
