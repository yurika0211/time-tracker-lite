# Time Tracker Lite

一个 Toggl 风格的轻量计时工具，当前进入 TypeScript + SQLite 重构阶段。

## 当前技术选型

- 语言：TypeScript
- 包管理：npm
- 构建：Vite
- 数据库：SQLite
- 目标：保留现有计时体验，同时把数据层改成结构化存储

## 当前状态

- 原型界面仍保留
- 需求文档与任务队列已建立
- 后续会按小时持续补写需求
- 代码迁移阶段还在准备中

## 文档入口

- `docs/INDEX.md`
- `docs/TECH_STACK.md`
- `docs/ARCHITECTURE_CONSTRAINTS.md`
- `docs/requirements/README.md`
- `docs/requirements/product-requirements.md`
- `docs/requirements/page-interaction-sketch.md`
- `docs/requirements/implementation-task-breakdown.md`
- `docs/requirements/testing-acceptance-standards.md`
- `docs/requirements/sync-expansion-scheme.md`
- `docs/requirements/QUEUE.md`
- `docs/requirements/toggl-function-map.md`
- `docs/requirements/sqlite-schema-sketch.md`

## 说明

- 现阶段先把需求和数据模型写完整
- 代码层会按队列逐步迁移到 TypeScript
- SQLite 方案会优先服务本地 MVP，后续再看是否补同步能力

