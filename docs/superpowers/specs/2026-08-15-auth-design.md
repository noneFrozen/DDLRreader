# DDL Radar 多用户账号系统 设计文档

状态：待用户复核
日期：2026-08-15
基线：`codex/implementation`（HEAD 将随前置提交推进）

## 1. 背景与目标

DDL Radar 原为单用户 MVP（`SPEC.md` 明确"不提供账户系统"）。本次将其升级为**多用户账号系统**：每个用户用邮箱 + 密码注册登录，各自的任务、可用时间、冲突分析、计划与统计完全隔离。这是对 `SPEC.md §2.2/§9/§14` 既定"单用户"决策的正式修订。

本模块是后续「统计看板 + 日程交互增强」的前置：这两组功能落地时也必须按用户隔离。

## 2. 非目标

- 不做邮箱验证、找回密码、第三方 OAuth（GitHub/Google）。
- 不做速率限制、审计日志、管理员后台、角色权限。
- 不加密任务正文（明文存本地 SQLite，沿用单用户时期的数据边界）。
- 不迁移历史单用户数据（见 §3.3）。

## 3. 数据模型

### 3.1 新增表

```text
users
  id            TEXT PRIMARY KEY   -- UUID
  email         TEXT NOT NULL UNIQUE  -- 存储时小写
  password_hash TEXT NOT NULL      -- "salt:hash"（scrypt）
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL

sessions
  id          TEXT PRIMARY KEY     -- 随机 token（crypto.randomBytes(32).hex）
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  created_at  TEXT NOT NULL
  expires_at  TEXT NOT NULL
```

### 3.2 现有表加 `user_id`

- `tasks`、`plans` 各加 `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`。
- `task_dependencies`：经由任务间接归属，无需直接加列；查询时通过任务过滤。
- `availability_settings`：改为 `user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` + `timezone`（去掉原 `id INTEGER PRIMARY KEY CHECK(id=1)`）。
- `availability_rules`、`availability_exceptions`：各加 `user_id`，唯一约束从单列 `ordinal UNIQUE` 改为 `(user_id, ordinal) UNIQUE`；`id` 保持全局唯一（生成时已含用户维度前缀）。
- `schedule_blocks`：经由 `plan` 间接归属，无需直接加列。

索引：`sessions(user_id)`、`sessions(expires_at)`、`tasks(user_id, deadline)`、`availability_rules(user_id, weekday)`、`availability_exceptions(user_id, date)`、`plans(user_id, version)`。

### 3.3 迁移与数据取舍

- 迁移 `migrate.ts` 新增版本：创建 `users`/`sessions`，为规划表重建带 `user_id` 的新结构。
- 单用户历史数据无法归属任何账号，**迁移时清空** tasks / availability / plans（保留表结构与后续约束）。README 在"已知限制"中注明。
- `schedule_blocks` 的 `ordinal` 与 `(plan_id, id)` 主键保持不变。

## 4. 认证流程与 API

所有时间以 UTC ISO 存储；`email` 比较时统一小写并去首尾空格。

- `POST /api/auth/register`，body `{ email, password }`
  - 校验：email 格式、password 至少 8 位。
  - 邮箱已存在 → 409 `{ code: "EMAIL_TAKEN", message: "该邮箱已注册" }`。
  - 成功：建用户 + 会话，`Set-Cookie: sid=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`，返回 201 `{ user: { id, email, createdAt } }`。
- `POST /api/auth/login`，body `{ email, password }`
  - 邮箱或密码错误 → 401 `{ code: "INVALID_CREDENTIALS", message: "邮箱或密码错误" }`（不区分哪个错误）。
  - 成功：建会话、种 Cookie、返回 200 `{ user }`。
- `POST /api/auth/logout`：删除当前会话、清 Cookie、200 `{ status: "ok" }`。
- `GET /api/auth/me`：未登录 401 `{ code: "UNAUTHENTICATED" }`；已登录返回 `{ user }`。

### 4.1 会话与 Cookie

- token = `crypto.randomBytes(32).toString("hex")`，有效期 7 天，过期即失效。
- Cookie 名 `sid`，`HttpOnly`、`SameSite=Lax`、`Path=/`、`Secure`（仅生产）；不存于前端 JS 可读处。
- 登录/注册成功后每次新开会话；旧会话保留到过期（不强制单会话）。

### 4.2 认证中间件

- Fastify `onRequest` 钩子放行 `/health`、`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`（logout 在处理器内尽力清除 Cookie，无需登录态）。
- 其余 `/api/*`（含 `/api/auth/me` 及全部业务路由）：解析 `sid` Cookie → 查 `sessions` → 校验未过期 → 加载 `users` → 挂 `request.user = { id, email }`；任一失败返回 401 `{ code: "UNAUTHENTICATED", message: "请先登录" }`。
- `/api/test/reset`（仅 `NODE_ENV=test`）追加清空 `users`、`sessions`。

## 5. 数据隔离

- 所有仓储方法新增 `userId` 首参，SQL 增加 `WHERE user_id = ?`（或等价的 JOIN 过滤）：
  - `TaskRepository`: `listActive(userId)`、`listPlanning(userId)`、`listDependencies(userId)`、`courseExists(userId, id)`、`get(userId, id)`、`save(userId, task)`、`saveWithDependencies(userId, task, deps)`、`delete(userId, id)`。
  - `AvailabilityRepository`: `replace(userId, input)`、`get(userId)`。
  - `PlanRepository`: `savePlan(userId, plan)`、`getById(userId, id)`、`getLatest(userId)`、`updateBlock(userId, planId, block)`、`replaceBlocks(userId, planId, blocks)`。
- 新增 `UserRepository`（`create`、`findByEmail`、`getById`）与 `SessionRepository`（`create`、`get`、`delete`、`deleteExpired`）。
- domain 纯函数（`analyzeConflicts`/`generatePlan`/`replan`/`buildStats`/`splitBlock`/`mergeBlocks`）签名不变，只接收已按用户取出的数据，不感知 `user_id`。
- 路由从 `request.user.id` 取出 userId 传给仓储。

## 6. 安全

- 密码：Node 内置 `crypto.scrypt`，每用户 16 字节随机盐，`scrypt` 参数固定（`N=16384, r=8, p=1, keylen=64`），存储 `salt:hash`，比较用 `crypto.timingSafeEqual`。不引入 bcrypt/argon2 等原生依赖。
- 会话：随机 256-bit token、httpOnly Cookie、服务端过期校验。
- 登录失败返回统一 401，不泄露邮箱是否已注册。
- 不记录密码或会话 token 到日志。

## 7. 前端

- 新增 `AuthGate`：启动时调 `GET /api/auth/me` 判定登录态；未登录渲染登录/注册切换页，登录后渲染主应用（四步流程 + 第 5 步统计）。
- 新增 `LoginForm` / `RegisterForm`：字段校验、错误与字段关联（`aria-describedby`）、提交态禁用。
- 头部新增「登出」按钮 + 当前邮箱；登出后回到门禁页。
- API 客户端新增 `register`、`login`、`logout`、`me`；`request` 已用 `fetch` 默认携带同源 Cookie（`credentials: "same-origin"` 为默认，无需改动）。
- 视觉沿用 Biomimetic Organic 设计 token；门禁页居中卡片，主操作深植物绿。

## 8. 测试策略（红—绿—重构）

- 后端 `auth-api.test.ts`：注册 201 + 种 Cookie；重复邮箱 409；登录成功/密码错 401；登出后 `me` 401；`me` 返回当前用户；字段校验 400。
- 后端 `isolation.test.ts`：用户 A 建任务/可用时间/计划后，用户 B 的 `GET /api/tasks`、`GET /api/plans`、`GET /api/stats` 均为空，且 B 无法 PATCH A 的计划块（404）。
- 现有 backend/frontend/e2e 测试全部改为「先注册并登录」夹具；`/api/test/reset` 同步清空 users/sessions。
- 前端 `auth-gate.test.tsx`：未登录显示门禁；登录成功进入主应用；登出回到门禁。
- e2e：注册 → 录任务 → 生成计划 → 登出 → 未登录访问受保护页面被拒。

## 9. 验收标准

1. 新用户能用邮箱 + 密码注册并自动登录。
2. 已注册用户能登录、登出；错误密码给出统一 401。
3. 两个用户的数据（任务、可用时间、计划、统计）完全隔离，互不可见、不可操作。
4. 未登录访问任何受保护 API 返回 401；前端展示登录门禁。
5. 密码以 scrypt 哈希存储，任何查询/日志不回显明文或哈希。
6. Cookie 为 httpOnly + SameSite=Lax，会话 7 天过期。
7. `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e` 全部通过。
8. 不新增原生依赖（使用 Node 内置 `crypto`）。

## 10. 实施顺序（供 writing-plans 细化）

1. 迁移与仓储：users/sessions 表 + 规划表加 `user_id` + UserRepository/SessionRepository + 现有仓储加 `userId`。
2. 认证服务与路由：scrypt 哈希、register/login/logout/me、认证中间件、Cookie。
3. 路由隔离：所有现有路由改从 `request.user` 取 userId 传仓储。
4. 测试改造：现有 backend 测试加登录夹具 + 隔离测试。
5. 前端门禁与表单：AuthGate/LoginForm/RegisterForm + 客户端方法 + 登出。
6. 前端测试与 e2e 更新。
7. 文档（README/SPEC/PLAN 更新：撤销"单用户"表述、说明多用户与迁移取舍）。
