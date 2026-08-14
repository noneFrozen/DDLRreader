# DDL Radar

## 项目简介

DDL Radar 是一个面向学生的 DDL 冲突规划工具。输入课程任务、截止时间、剩余工时和每周可用时间段，系统自动分析容量冲突、生成风险等级，并提供可执行的 7–14 天日程安排。支持进度更新、重排、锁定时间块以及导出 ICS 日历文件。

核心算法使用确定性 30 分钟块调度、10% 容量缓冲和稳定排序（最少余量、最早截止、更高优先级、更早创建时间），保证相同输入始终产生相同输出。

## 安装

```bash
git clone https://github.com/noneFrozen/DDLRreader.git
cd DDLRreader
npm install
```

需要 Node.js 22+。

## 运行

### 本地开发

```bash
npm run dev
```

后端运行在 `http://localhost:3000`，前端运行在 `http://localhost:5173`。

### 生产构建

```bash
npm run build
PUBLIC_DIR=apps/frontend/dist node apps/backend/dist/server.js
```

## 分发

### Docker

```bash
docker build -t ddl-radar:latest .
docker run --rm -p 3000:3000 -v ddl-radar-data:/data ddl-radar:latest
```

镜像基于 Node 22 slim，以非 root 用户运行，暴露端口 3000，包含健康检查 `/health`。

### 验证命令

```bash
npm test              # 运行所有单元测试和集成测试
npm run test:e2e      # 运行 Playwright E2E 测试
npm run typecheck     # TypeScript 类型检查
npm run build         # 生产构建
node scripts/container-smoke.mjs  # 容器烟雾测试
```

## 目录结构

```text
.
├── apps/
│   ├── backend/          # Fastify + SQLite API 服务
│   │   ├── src/
│   │   │   ├── db/       # 数据库连接与迁移
│   │   │   ├── http/     # 错误处理
│   │   │   ├── repositories/  # 数据访问层
│   │   │   ├── routes/   # REST API 路由
│   │   │   └── services/ # 应用服务
│   │   └── test/
│   └── frontend/         # React/Vite 前端
│       ├── src/
│       │   ├── api/      # API 客户端
│       │   ├── app/      # 应用入口
│       │   ├── components/  # 通用组件
│       │   ├── features/ # 功能模块
│       │   └── styles/   # 样式令牌
│       └── test/
├── packages/
│   └── domain/           # 领域逻辑（框架无关）
│       ├── src/          # 时间、冲突、规划、重排
│       └── test/
├── e2e/                  # Playwright E2E 测试
├── scripts/              # 构建与检查脚本
├── .github/workflows/    # GitHub Actions CI
├── Dockerfile
├── SPEC.md               # 产品规格
├── PLAN.md               # 实现计划
├── SPEC_PROCESS.md       # 协作过程文档
├── AGENT_LOG.md          # 智能体执行日志
└── REFLECTION.md         # 学生反思报告
```

## 安全边界

- 单用户 MVP，无身份认证
- 无第三方 API 密钥或付费服务
- 无 LLM 或自主智能体
- 数据存储在本地 SQLite 文件中
- 不采集学校系统数据，不进行日历同步
- 测试重置端点仅在 `NODE_ENV=test` 时启用

## 已知限制

- 单用户，无多用户或协作功能
- 规划粒度为 30 分钟块
- 不支持移动端原生应用
- 课程标签仅为本地 UI 标识，不持久化课程数据
- Docker 镜像需要挂载 `/data` 卷以持久化数据库

## CI/CD

本项目使用 GitHub Actions 进行持续集成。`.github/workflows/ci.yml` 定义了 `unit-test` 和 `container-build` 两个作业，在 push 和 pull request 时自动运行。

## 许可证

课程项目，仅供教学使用。