# DDL Radar 统计看板与日程交互增强 设计文档

状态：待用户复核
日期：2026-08-15
基线：`codex/implementation`（HEAD `4515435`）

## 1. 背景与目标

DDL Radar 已实现四步核心流程（可用时间 → 任务录入 → 冲突分析 → 生成计划）。本次在既有实现上新增两组功能：

1. **统计看板**：让用户在规划之外，看到任务完成情况、优先级分布与每日负载，形成"规划 + 复盘"的闭环。
2. **日程交互增强**：把当前"选择 / 锁定 / 用输入框改时间"的周时间线，升级为可视化时间轴 + 拖拽移动 + 块状态操作 + 撤销重做 + 拆分合并。

约束沿用 `SPEC.md`：确定性算法、30 分钟粒度、键盘可达、不引入付费 API 或 LLM、有机设计系统（Biomimetic Organic — Balanced）、图表不新增第三方依赖。

## 2. 非目标

- 不新增多用户、云端同步、移动端原生、推送通知。
- 不引入图表库（recharts 等）；图表全部手写 SVG/CSS。
- 不做风险趋势（多版本对比）与截止日期时间线（用户本次未选择）。
- 拖拽仅为移动入口；键盘移动（方向键微调 + datetime-local 输入）必须等价可用，延续 `SPEC.md §14` 的既有决策。

## 3. 功能一：统计看板

### 3.1 数据来源

新增 `GET /api/stats` 后端聚合端点。理由：

- "每日负载图"需要对比每日可用容量，必须复用后端已有的 `resolveAvailability`（`apps/backend/src/services/availability.ts`）。
- 符合项目"业务规则在后端、可单测"的既有风格。
- 前端只消费一个聚合结果，避免把容量解析逻辑散落进组件。

聚合逻辑放入 `apps/backend/src/services/stats.ts`，作为**纯函数**（输入任务、最新计划、已解析可用块、时区、当前时间），不直接依赖数据库，便于单元测试。路由 `apps/backend/src/routes/stats.ts` 负责从仓储与 `resolveAvailability` 装配输入。

### 3.2 响应结构

```ts
type StatsResponse = {
  taskSummary: {
    activeCount: number;          // 状态 active 的任务数
    completedCount: number;       // 状态 completed 的任务数
    overdueCount: number;         // active 且 deadline < now 的任务数
    totalRemainingMinutes: number;// active 任务剩余工时总和
    dueThisWeekCount: number;     // deadline 落在 [now, now+7d) 内的 active 任务数
    completionRate: number;       // completed / (completed + active)，0..1
  };
  priorityDistribution: Array<{
    priority: "high" | "medium" | "low";
    count: number;
    remainingMinutes: number;     // 仅 active 任务的剩余工时
  }>;
  dailyWorkload: Array<{
    date: string;                 // 计划时区下的 YYYY-MM-DD
    scheduledMinutes: number;     // 当日已排块的分钟数（无计划时为 0）
    capacityMinutes: number;      // 当日可用容量分钟数
  }>;
};
```

规则：

- `priorityDistribution` 始终包含 low/medium/high 三项（无任务时计数与分钟为 0），保证环形图稳定。
- `dailyWorkload` 覆盖 `plan.rangeStart..rangeEnd` 的每一天；无最新计划时，范围退化为 `[now, now+7d)`，仅返回容量。
- `completionRate` 分母为 0 时返回 0。
- 所有分钟按 30 分钟块粒度（`BLOCK_MINUTES`）计算，避免浮点误差；展示时换算小时。

### 3.3 前端呈现

- 新增 `apps/frontend/src/features/stats/`：
  - `StatsDashboard.tsx`：容器，拉取 `/api/stats`，组合三个子视图。
  - `PriorityDonut.tsx`：SVG 环形图展示优先级分布（数量 + 剩余工时）。
  - `DailyLoadBars.tsx`：SVG 柱状图，每日已排工时柱 + 可用容量参照线；容量不足的日期柱用赭黄/砖红区分。
- 复用现有 `--color-risk-*`、`--color-surface` 等 token；图表文字使用 `--font-body`，对比度满足 WCAG AA。
- 每个图表都有可见文字标签与 `role="img"` + `aria-label`，不依赖颜色单独传达信息。
- 数据加载中显示 `aria-busy`；失败显示重试入口。

### 3.4 导航接入

新增第 5 步"统计看板"。`StepNavigation` 与 `App` 状态调整：

- 生成计划后（`plan` 存在）解锁第 5 步；第 5 步始终可回看，不阻塞前面的流程。
- 前端 API 客户端新增 `getStats()`；`Plan` 与 `Task` 类型保持不变。

## 4. 功能二：日程交互增强

### 4.1 时间轴可视化布局

重写 `apps/frontend/src/features/plan/WeekTimeline.tsx`：

- 每天渲染一列纵向时间轴，范围 06:00–24:00，30 分钟刻度。
- 块按 `startAt/endAt` 定位（`top = (startMinutes - 360) / scale`、`height = duration / scale`），空闲区留白、重叠/冲突在数据层已被禁止。
- 窄屏（<768px）退化为块列表（保留可读性，不强制横向滚动）。
- 天标题继续使用 `<h3>`；每个块仍是可聚焦按钮，保留 `aria-label`（标题、起止时间、状态、锁定）。

### 4.2 拖拽移动

- 指针事件（Pointer Events）实现拖动：`pointerdown` 记录块内偏移，`pointermove` 更新半透明预览位置（吸附 30 分钟），`pointerup` 计算新起止并调用既有 `PATCH /api/schedule-blocks/:id`。
- 移动失败（409：冲突/不可用/截止）复用现有错误文案，预览回退到原位置。
- 键盘等价：块聚焦时方向键微调 ±30 分钟（Shift+方向键 ±60 分钟），Enter 提交移动；保留现有 `datetime-local` 输入作为精确回退。
- 锁定块不可拖动；移动仍走现有后端校验（不可用时间、锁定冲突、截止时间二次确认）。

### 4.3 块状态操作

每个块增加状态操作，映射既有 `PATCH` 的 `status` 字段：

| 操作 | 前置状态 | 效果 | 请求 |
|---|---|---|---|
| 开始 | planned | 标记进行中 | `PATCH { status: "started" }` |
| 完成 | planned / started | 打开 ProgressDialog，记录完成分钟 | `PATCH { completedMinutes: 60 }` |
| 跳过 | planned / started | 标记跳过 | `PATCH { status: "skipped" }` |
| 恢复 | skipped | 回到 planned | `PATCH { status: "planned" }` |

- 完成沿用现有 `ProgressDialog`，不改动其逻辑。
- 状态操作对锁定块仍然可用（进度反映真实世界，与位置锁定正交）；移动 / 拆分 / 合并对锁定块禁用。

### 4.4 撤销 / 重做

- 在 `PlanStep` 内维护操作栈，深度 20；每次提交成功的一次变更（移动、状态、锁定、拆分、合并）记录一个可逆动作。
- 逆操作：移动/状态/锁定通过反向 `PATCH` 恢复前值；拆分通过合并两个结果块恢复；合并通过按原拆分点重新拆分恢复。
- 快捷键 Ctrl+Z / Ctrl+Shift+Z（macOS 为 Meta+Z / Meta+Shift+Z），同时提供可见的"撤销 / 重做"按钮。
- 生成新计划或重新规划后清空栈。
- 实现为 `useUndoHistory` hook，纯客户端逻辑，可用 jsdom 单测。

### 4.5 拆分 / 合并

#### 领域层（纯函数，`packages/domain/src/schedule-editing.ts`）

```ts
// 输入块 + 拆分点(UTC)；校验后可拆，返回两段（id 由调用方提供）
splitBlock(block: ScheduleBlock, at: IsoUtc, leftId: string, rightId: string): [ScheduleBlock, ScheduleBlock];
// 合并两个相邻同任务块，返回合并结果（id 沿用左侧块）
mergeBlocks(left: ScheduleBlock, right: ScheduleBlock): ScheduleBlock;
```

规则：

- `splitBlock`：`at` 必须严格落在 `startAt..endAt` 内，且与 `startAt` 相差为 30 分钟整数倍；拆分后两段均 ≥ 30 分钟；仅 `task.splittable` 为真且块时长 ≥ 2×`minimumBlockMinutes` 时允许（由路由结合任务校验）。两段继承原状态、锁定与 taskId。
- `mergeBlocks`：两块的 `taskId` 相同、`endAt === startAt`、`locked` 一致，且两块 `status` 相同且均为 `planned` 或 `started`；结果为左块 `startAt` 到右块 `endAt`。
- 违反任一规则抛出带错误码的 `RangeError`，路由转为 409。

#### 后端路由

- `POST /api/schedule-blocks/:id/split`，body `{ at?: string }`（省略时取中点并吸附 30 分钟）；返回 `{ blocks: [left, right] }`。
- `POST /api/schedule-blocks/:id/merge`，body `{ with?: "next" | "prev" }`（默认 next）；返回 `{ block }`。
- 两者复用最新计划、校验块与任务存在、锁定块拒绝、在事务内持久化。

#### 仓储

`PlanRepository` 新增 `replaceBlocks(planId, blocks)`：在事务内重写该计划全部块并重算 `ordinal`，复用 `assertValidBlocks` 保证无重叠。拆分（插入一块）与合并（删除一块）都通过它落地。

### 4.6 类型与 API 客户端

- 领域新增 `splitBlock` / `mergeBlock` 导出；`types.ts` 无需新增实体（拆分/合并仍产出 `ScheduleBlock`）。
- 前端 `client.ts` 新增 `getStats()`、`splitScheduleBlock(id, at?)`、`mergeScheduleBlock(id, with?)` 及对应响应类型。

## 5. 错误处理

- `/api/stats` 无数据时不报错，返回空统计（任务概览全 0、分布全 0、负载仅容量）。
- 拆分/合并错误沿用统一 `{ code, message, details? }` 结构：`SPLIT_NOT_ALLOWED`、`MERGE_NOT_ADJACENT`、`SCHEDULE_BLOCK_NOT_FOUND`、`SCHEDULE_BLOCK_LOCKED` 等。
- 拖拽/移动失败展示既有冲突文案并回滚预览；撤销/重做失败展示错误并清空后续栈。

## 6. 测试策略（红—绿—重构）

- 领域：`schedule-editing.test.ts` 覆盖拆分对齐/边界/不可拆、合并邻接/状态/锁定一致性、分钟守恒。
- 后端：`stats-api.test.ts`（聚合正确性、空数据、时区分日、完成率边界）；`schedule-editing-api.test.ts`（拆分/合并 201/409、事务回滚、ordinal 重排）。
- 前端：`stats-dashboard.test.tsx`（卡片、环形图、柱状图可访问性与内容）；更新 `plan-step.test.tsx`（状态操作、撤销/重做、键盘微调）。拖拽的指针细节在 jsdom 中不可靠，放入 e2e。
- e2e：在 `e2e/` 增加统计看板展示与键盘移动/状态变更路径；拖拽可用性在真实浏览器验证。
- 既有测试（`plan-step.test.tsx`、`app-shell.test.tsx` 等）因 `WeekTimeline` 重写需同步更新，保持全绿。

## 7. 验收标准

1. 生成计划后第 5 步可进入，任务概览、优先级分布、每日负载三项均正确渲染，空状态不报错。
2. 统计数据与后端 `GET /api/stats` 一致；每日负载的容量与 `resolveAvailability` 结果吻合。
3. 块可拖拽移动且吸附 30 分钟；锁定块不可拖动；移动冲突时预览回退并显示原因。
4. 键盘可完成移动（方向键 + Enter）、状态切换与撤销/重做；焦点顺序清晰。
5. 拆分/合并遵循 30 分钟对齐、任务可拆分、相邻同任务等约束，违反时返回明确错误。
6. 撤销/重做能逆回移动、状态、锁定、拆分、合并，且生成新计划后清空。
7. `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e` 全部通过。
8. 未引入新运行时依赖；首屏产物仍符合既有体积目标。

## 8. 实施顺序（供 writing-plans 细化）

1. 领域 `schedule-editing`（拆分/合并纯函数 + 测试）。
2. 后端统计服务与 `/api/stats`（+ 测试）。
3. 后端拆分/合并路由与 `replaceBlocks`（+ 测试）。
4. 前端 API 客户端扩展（getStats / split / merge）。
5. 前端统计看板（导航第 5 步 + 图表组件 + 测试）。
6. 前端日程交互（时间轴重写、拖拽、状态操作、撤销重做、拆分合并入口 + 测试）。
7. e2e 与文档（README、SPEC.md/PLAN.md 增量更新）。
