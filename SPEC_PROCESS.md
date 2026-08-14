# DDL Radar 规格与计划协作过程

## 1. brainstorming 关键节点

本轮设计发生于 2026-08-11 至 2026-08-14。主开发智能体为 Codex；在实现开始前，另用 OpenCode 新会话做陌生智能体冷启动。本文只记录已经发生并能由当前对话、文件或 Git 历史核对的事实，不补写不存在的实现结果。

### 1.1 从“做什么”收敛到 DDL 冲突规划

最初没有既定产品方向。主智能体围绕课程项目的工程深度、核心算法是否可测试、单人能否在期限内完成等约束提出候选方案。用户对第三个方案的反馈是：“DDL 冲突规划器有点意思，展开说说”，随后确认该方向。

这个问题促使设想从普通待办清单转为一个可验证的决策产品：输入任务、截止时间、剩余工时和可用时间，输出累计容量冲突、风险等级以及可执行日程。普通 CRUD 只是支撑，核心价值落在确定性冲突分析与排程。

### 1.2 用三个问题冻结原型边界

智能体分别询问平台、交互范围和完成度。用户确认：网页应用、一个核心流程、精致产品界面。由此把 MVP 固定为“可用时间 → 任务录入 → 冲突分析 → 生成计划”的单一闭环，不扩张到移动端、多用户协作或自主智能体。

### 1.3 让用户决定视觉方向

用户明确要求在具体 UI 设计时自行决策美术风格。首轮方案被用户以“不好看”否决，并提供“仿生有机 2.0”参考图。之后同时制作 A“视觉型”和 B“平衡型”供比较，用户最终选择 B。这个决策把视觉目标固定为 Organic Productive：保留柔和有机感，但优先保障高密度规划页面的扫描效率。

## 2. 关键迭代

### 迭代 1：产品定位从待办工具改为容量冲突解释器

**对话节选**

> 用户：我是不知道要做什么产品，你有推荐的 idea 吗？
>
> 用户：第三个 DDL 冲突规划器有点意思，展开说说。

**处理决策**：采纳 DDL Radar，但否定“只按截止日期排序”的轻量做法。产品必须回答“当前时间是否足够、最早在哪里不够、哪些任务共同造成缺口、该怎样排进日历”。因此 SPEC 增加累计容量节点、红黄绿风险和解释输出。

### 迭代 2：把模糊时间估算改成确定性算法

**讨论焦点**：如果智能体自行选择时间粒度、缓冲和同分条件，测试会不稳定，不同实现也可能都声称符合需求。

**处理决策**：采用 30 分钟时间块；任务分钟数使用 `Math.ceil(minutes / 30)` 向上取整；可用容量先扣除 10% 缓冲并向下取整；按每个截止节点比较累计需求与累计容量；同等条件使用固定排序。向上取整在冷启动反馈中再次被确认，不属于缺陷。

### 迭代 3：否决第一版 UI，并选择 B 平衡型

**对话节选**

> 用户：不好看，按这个美术风格来。
>
> 用户：把视觉型和平衡型都做出来我看下。
>
> 用户：B。

**处理决策**：不保留第一版视觉语言，以参考图中的半透明浅色卡片、深植物绿、柔和渐变和有机圆角为基础重新设计。A 强调编辑感和大标题；B 采用三栏工作区、紧凑任务列表和七天时间块。用户选择 B 后，SPEC 与 PLAN 只把 B 作为正式实现方向。

### 迭代 4：人工识别 Open Design 预览的 CSS 丢失

第一次通过 Open Design 查看 A/B 页面时，预览接近浏览器默认样式，用户反馈“我看不了”。检查生成文件后发现，Open Design 往返处理改变了样式块结构，且预览环境对 `oklch()` / `color-mix()` 的支持不完整。处理方式是保留原型源文件，修复样式块顺序，并增加同色板的十六进制/rgba 兼容回退，而不是把无样式预览误认为设计方案本身。该事件直接促使 PLAN 要求锁定色彩 token，并在真实浏览器中做渲染验证。

## 3. AI 建议的采纳、推翻与修正

- **采纳**：用累计容量而非单任务剩余时间判断冲突。原因是多个 DDL 会竞争同一段时间，累计模型能给出可测试的最早冲突节点。
- **采纳**：同时展示 A/B 两个有机风格变体。原因是视觉偏好需要用户看到具体界面后决策。
- **推翻**：第一版通用仪表盘视觉。原因是没有响应用户提供的仿生有机参考，且信息层级过于模板化。
- **修正**：不把 Open Design 的一次渲染结果当作浏览器真值。原因是工具往返可能改变 CSS，必须保留源文件并进行兼容回退和截图核验。
- **修正**：不允许实现者自行猜测 `firstConflict.taskIds`。原因是“造成冲突的任务”既可理解为当前节点新到期任务，也可理解为累计占用容量的任务；现在已明确为后者。

## 4. 冷启动验证

### 4.1 设置与证据边界

- 日期：2026-08-14。
- 主开发智能体：Codex。
- 陌生智能体：OpenCode；底层模型未在本次反馈中记录。
- 上下文：按用户描述使用陌生会话，目标是仅依据 `SPEC.md` 与 `PLAN.md` 检查或推进早期 Task；反馈覆盖 Task 1–3。
- 结果边界：本次没有提供 OpenCode 的 commit hash、完整日志或可归属的完成实现，因此不能记录为“成功实现 1–2 个 Task”。当前主工作区存在未跟踪的实现/构建产物，本轮规格修订没有修改或提交它们。

### 4.2 暂停点、分类与处理

| OpenCode 反馈 | 分类 | 人工判断与处理 |
|---|---|---|
| Vitest 3.2.7 在无测试文件时退出码为 1，但 PLAN 要求根 `npm test` 退出 0 | PLAN 可执行性缺口 | 属实。Task 1 的 frontend 不再提前声明 `test`；Task 9 创建首个前端测试时再加入。根脚本保留 `--if-present`，不使用掩盖问题的 `--passWithNoTests`。 |
| `tsconfig.json` 项目引用缺少 `composite: true` | PLAN 结构遗漏 | 反馈揭示 PLAN 没说明是否采用 project references。最终决策是不采用引用：根配置只提供共享 `compilerOptions`，各 workspace 直接 `extends`，因此无需 `composite`。 |
| 空 `src/` 导致 TypeScript `No inputs were found` | Task 顺序边缘情况 | 属实。domain workspace 延后到 Task 2，并与第一批源码和测试同时创建，TypeScript 不再检查空输入集。 |
| Task 3 的 `makeInput`、`task`、`blocksBefore` 未定义 | PLAN 遗漏 | 属实。PLAN 新增 `packages/domain/test/fixtures.ts`，给出三个辅助函数的完整签名与实现草图，并在测试中显式导入。 |
| `toBlockCount` 是否向上取整 | 解读确认 | 与原意一致：任何不足 30 分钟的正剩余工作仍占一个完整规划块。保留 `Math.ceil` 和边界用例 `[1,1]`、`[31,2]`。 |
| `firstConflict.taskIds` 只返回当前节点任务，还是全部造成冲突的任务 | SPEC 语义歧义 | 采用累计语义：包含截止时间不晚于首个冲突节点、状态为 active 且剩余工时大于 0 的全部任务，并稳定排序。SPEC、类型注释、实现步骤和测试同时修订。 |

### 4.3 修订前后

#### A. 无测试文件与根命令

修订前：Task 1 同时创建前端和 domain workspace，却没有同步创建它们的测试；仍要求根 `npm test` 退出 0。

修订后：Task 1 只有已有 health test 的 backend 声明 `test`；Task 2 创建 domain 的首个测试时加入 domain test 脚本；Task 9 创建前端首个测试时加入 frontend test 脚本。根命令通过 npm workspace 的 `--if-present` 只运行真实存在的测试套件。

#### B. TypeScript 配置

```diff
- 根 tsconfig 与 workspace 的引用关系未说明
- Task 1 创建空的 packages/domain 目录和配置
+ 根 tsconfig.base.json 只包含共享 compilerOptions，不包含 references
+ workspace tsconfig 直接 extends 根配置，不启用 composite
+ domain 配置与首批 src/test 文件在 Task 2 同时创建
```

#### C. Task 3 测试夹具

```diff
- analyzeConflicts(makeInput({ tasks: [task(...)], availability: blocksBefore(...) }))
- // makeInput、task、blocksBefore 没有定义或导入
+ Create: packages/domain/test/fixtures.ts
+ import { blocksBefore, makeInput, task } from "./fixtures.js";
```

#### D. 冲突贡献任务语义

```diff
- firstConflict.taskIds 可能只包含首个冲突节点新到期的任务
+ firstConflict.taskIds 包含截止时间 <= 首个冲突节点的全部 active 未完成任务
+ 排序：deadline 升序、priority 为 high > medium > low、createdAt 升序、taskId 升序
+ 新增 earlier + current 共同造成 30 分钟缺口的测试
```

### 4.4 产出与预期差距

首次冷启动没有形成可直接合并且带 commit 证据的 1–2 个完整 Task，因此当时的实现产出低于课程所述理想结果；但它准确暴露了四个会阻塞执行的 PLAN 缺口和一个关键语义歧义。基于这些修订，随后进行了下面记录的第二次陌生会话复跑。

### 4.5 修订后的陌生智能体复跑

2026-08-14，在独立 worktree `C:\Users\Admin\Desktop\Application\.worktrees\opencode-cold-start` 和分支 `codex/opencode-cold-start` 中启动全新 OpenCode 1.18.18 会话，底层模型为 `deepseek-v4-pro (njuse/deepseek-v4-pro)`，起始 commit 为 `dd37792`。提示词要求只读取 `SPEC.md` 与 `PLAN.md`，只实现 Task 1–2，遇到歧义立即暂停。

OpenCode 没有提出新的规格问题，产出两个独立 commit：

- `f5752c7 chore: bootstrap DDL Radar workspaces`：Task 1 的测试、类型检查和构建均报告退出码 0，但实现与测试一次性写入，首次测试即通过，未保留 PLAN 要求的 RED 阶段。这是流程偏差，不能记录成完整 TDD 红—绿证据。
- `bff5200 feat(domain): define planning types and time blocks`：Task 2 的 RED 为 6 个测试因函数不存在而失败、退出码 1；实现后 15 个测试通过且 typecheck 退出码 0，具有完整红—绿证据。

主智能体随后独立检查提交并重跑验证：根 `npm test` 共通过 backend 1 个与 domain 15 个测试；根 `npm run typecheck` 的三个 workspace 均无错误；根 `npm run build` 在 Codex 受限沙箱中因 esbuild 无权读取上级路径而失败，在获准的普通 Windows 环境中以同一代码和命令重跑后退出码 0，确认属于验证环境权限差异。

代码评审发现 OpenCode 在 Task 1 中整体覆盖 `.gitignore`，删除了冷启动准备阶段已有的 `.worktrees/`。原因是 PLAN 仍将该文件标为 “Create”，没有说明准备阶段已经存在。主智能体没有改写原始 OpenCode commit，而是在同一分支增加 `2df21e4 fix: preserve worktree ignore rule`，并将 PLAN 改为 “Modify” 且明确要求保留已有规则。这是一次有证据的人工审查与修正。

最终判断：Task 1–2 的功能结果通过独立验证，冷启动实现目标已完成；Task 1 的 TDD RED 证据缺失作为明确流程偏差保留，不追溯伪造。原始回报与复核结果保存在 `evidence/cold-start/opencode-task-1-2-result.md`。

## 5. 对 brainstorming 的阶段性反思

做得好的部分是：通过逐个冻结平台、交互范围、完成度和视觉方向，把“做个课程项目”收敛成了可实现的单一核心流程；确定性规则也让后续 TDD 有明确断言。让人不满的部分是：早期对开发脚手架的推演不够机械，关注了产品语义，却遗漏了 Vitest 空套件退出码、TypeScript 空输入和测试夹具来源。这说明 brainstorming 能发现“做什么”的歧义，但不能替代陌生环境中的逐命令冷启动。后续计划评审必须同时检查产品语义、文件创建顺序和每条验证命令的可执行前置条件。
