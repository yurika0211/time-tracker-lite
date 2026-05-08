# Time Tracker Lite 文档总索引

## 1. 阅读顺序

1. `README.md`
2. `docs/INDEX.md`
3. `docs/requirements/README.md`
4. `docs/requirements/QUEUE.md`
5. `docs/TECH_STACK.md`
6. `docs/ARCHITECTURE_CONSTRAINTS.md`
7. `docs/ARCHITECTURE_OPTIMIZATION.md`
8. `docs/SECURITY_AUDIT.md`
9. `docs/DATA_MIGRATION_AND_BACKUP.md`
10. `docs/TEST_AND_QA_PLAN.md`
11. `docs/PERFORMANCE_AND_CAPACITY.md`
12. `docs/OBSERVABILITY_AND_DIAGNOSTICS.md`
13. `docs/RELEASE_AND_ROLLBACK.md`
14. `docs/RISK_REGISTER.md`
15. `docs/DECISIONS.md`

## 2. 文档分层

### 产品与需求

- `docs/requirements/product-requirements.md`
- `docs/requirements/page-interaction-sketch.md`
- `docs/requirements/implementation-task-breakdown.md`
- `docs/requirements/testing-acceptance-standards.md`
- `docs/requirements/sync-expansion-scheme.md`
- `docs/requirements/toggl-function-map.md`
- `docs/requirements/sqlite-schema-sketch.md`

### 架构与实现

- `docs/TECH_STACK.md`
- `docs/ARCHITECTURE_CONSTRAINTS.md`
- `docs/ARCHITECTURE_OPTIMIZATION.md`
- `docs/API_CONTRACTS.md`
- `docs/DATA_MIGRATION_AND_BACKUP.md`
- `docs/DECISIONS.md`

### 安全与风险

- `docs/SECURITY_AUDIT.md`
- `docs/RISK_REGISTER.md`

### 测试与发布

- `docs/TEST_AND_QA_PLAN.md`
- `docs/PERFORMANCE_AND_CAPACITY.md`
- `docs/OBSERVABILITY_AND_DIAGNOSTICS.md`
- `docs/RELEASE_AND_ROLLBACK.md`

## 3. 当前状态

- 前端原型已迁移到 TypeScript + Vite。
- SQLite 已确定为单一事实来源。
- 本地持久化目前使用 sql.js + `localStorage` 快照。
- 需求队列已经建立，后续按小时继续补写。
- 当前重点是把架构、安全、测试、发布这些大项补完整。

## 4. 维护规则

- 任何 schema 改动先改文档，再改代码。
- 任何安全相关改动先过安全审计，再进实现。
- 任何发布前必须过类型检查、构建和核心验收。
- 新增文档先挂到这个索引，再补到 README。
