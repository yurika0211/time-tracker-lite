# 应用层契约与接口设计

## 1. 目标

- 把 UI 和存储解耦。
- 让每个用例都有稳定输入、输出和错误语义。
- 给后续同步、报表和导出留统一接口。

## 2. 契约原则

- 输入和输出都要显式。
- 用例应尽量幂等。
- 失败要返回明确错误码，不要静默吞掉。
- 领域层不依赖 UI，也不依赖具体存储实现。
- 所有契约都应支持测试替身。

## 3. 核心契约

### 3.1 时间源

- `Clock.now(): number`
- 用途：生成开始时间、计算当前片段、驱动展示刷新。
- 约束：业务逻辑只接受时间参数，不直接取系统时间。

### 3.2 计时仓储

- `loadState()`：读取完整状态。
- `saveState(state)`：保存完整状态。
- `clearState()`：清空本地数据。
- `restoreSnapshot(bytes)`：恢复指定快照。

### 3.3 项目仓储

- `listProjects()`
- `createProject(payload)`
- `renameProject(id, payload)`
- `archiveProject(id)`
- `updateProjectSettings(id, payload)`

### 3.4 时间记录仓储

- `listEntries(filters)`
- `createEntry(payload)`
- `updateEntry(id, payload)`
- `deleteEntry(id)`
- `duplicateEntry(id)`

### 3.5 导出服务

- `exportCsv(snapshot)`
- `exportReport(range, filters)`
- `buildFilename(date)`

### 3.6 迁移服务

- `ensureSchema()`
- `migrateToLatest()`
- `validateSchemaVersion()`
- `repairOrReject()`

### 3.7 校验服务

- `normalizeProjectName(value)`
- `normalizeTags(value)`
- `validateTimeRange(startedAt, endedAt)`
- `validateEntryPayload(payload)`

## 4. 错误语义

建议把错误分成这些类别：

- `INVALID_INPUT`：字段为空、格式不对、时间区间非法。
- `SCHEMA_MISMATCH`：结构版本不兼容。
- `STORAGE_UNAVAILABLE`：浏览器存储不可用或写入失败。
- `EXPORT_FAILED`：导出过程失败。
- `CONFLICT_DETECTED`：未来同步时发现冲突。
- `UNKNOWN_ERROR`：兜底错误。

## 5. 输出要求

- 成功结果要能直接驱动下一步渲染。
- 失败结果要能直接驱动用户提示。
- 不要把 UI 文案和业务错误混在一起。
- 不要让仓储层返回半成品状态。

## 6. 未来同步预留接口

后续如果接入网络同步，可沿用这些接口形态：

- `GET /sync/bootstrap`
- `POST /sync/push`
- `GET /sync/pull?cursor=...`
- `POST /sync/resolve`

同步契约需要额外保证：

- 版本号显式。
- 操作可回放。
- 冲突不静默覆盖。
- 本地写入优先，远端只是增量协作者。

## 7. 兼容规则

- 旧 payload 进入领域层前必须归一化。
- 新字段必须默认可空或有默认值。
- 删除字段要先做过渡期，再真正移除。
- 任何契约变更都要同步更新测试和文档。

## 8. 设计结果

通过这套契约，UI 只关心“发起动作”和“展示状态”，存储层只关心“读写数据”，领域层只关心“规则是否正确”。
