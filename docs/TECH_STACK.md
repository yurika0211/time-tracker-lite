# Time Tracker Lite 技术栈说明

- 语言：TypeScript
- 包管理：npm
- 构建：Vite
- 数据库：SQLite
- 当前运行时：sql.js + `localStorage` 快照

## 设计方向

- 单页原型先保留。
- 业务逻辑逐步从 `src/main.ts` 下沉。
- SQLite 作为单一事实来源。
- `localStorage` 只保存快照，不保存业务真值。
- 后续同步、账号、多端能力先留接口，不进当前 MVP。

## 文档联动

- 架构约束见 `docs/ARCHITECTURE_CONSTRAINTS.md`
- 架构优化见 `docs/ARCHITECTURE_OPTIMIZATION.md`
- 安全审计见 `docs/SECURITY_AUDIT.md`
- 迁移备份见 `docs/DATA_MIGRATION_AND_BACKUP.md`
- 接口契约见 `docs/API_CONTRACTS.md`
- 测试计划见 `docs/TEST_AND_QA_PLAN.md`
