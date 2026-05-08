# SQLite 表结构草案

## 总体原则

- 时间字段统一使用毫秒时间戳
- 业务事实写入 SQLite，展示状态不作为事实保存
- 运行中的 active timer 只允许一条
- 删除优先采用软删除或归档语义，避免直接抹掉历史
- 所有可枚举字段都应保留未来扩展空间

## 1. clients

- `id`：主键
- `name`：客户名称，非空
- `is_archived`：是否归档
- `created_at`：创建时间
- `updated_at`：更新时间

### 约束

- `name` 建议唯一
- 归档客户仍保留历史关联

## 2. projects

- `id`：主键
- `name`：项目名称，非空
- `client_id`：所属客户，可空
- `color`：项目颜色，可空
- `billable_default`：默认计费标记
- `is_archived`：是否归档
- `created_at`：创建时间
- `updated_at`：更新时间

### 约束

- `name` 不能为空或全空白
- 项目改名不能破坏历史记录
- 归档项目不应默认出现在快捷选择中
- 建议对 `client_id + name` 建唯一约束或唯一索引

## 3. tags

- `id`：主键
- `name`：标签名称，非空
- `created_at`：创建时间
- `updated_at`：更新时间

### 约束

- 标签名称去空格后保存
- 标签值建议唯一

## 4. time_entries

- `id`：主键
- `description`：任务名称
- `project_id`：项目标识，可空
- `client_id`：客户标识，可空
- `billable`：是否计费
- `started_at`：开始时间
- `ended_at`：结束时间
- `duration_ms`：时长
- `source`：来源，默认 `timer`
- `created_at`：创建时间
- `updated_at`：更新时间

### 约束

- `ended_at` 必须大于等于 `started_at`
- `duration_ms` 必须等于两者差值或其归一化结果
- 历史记录不依赖 active timer
- 建议建立 `started_at`、`project_id` 索引

## 5. time_entry_tags

- `entry_id`：时间条目标识
- `tag_id`：标签标识

### 约束

- `(entry_id, tag_id)` 组成联合主键
- 删除时间条目时级联删除关联关系
- 标签可复用，不做重复存储

## 6. active_timer

- `id`：单例主键
- `description`：当前任务名称
- `project_id`：当前项目，可空
- `client_id`：当前客户，可空
- `billable`：是否计费
- `started_at`：最初开始时间
- `segment_started_at`：当前片段开始时间
- `elapsed_ms`：已累计时长
- `running`：是否运行中
- `created_at`：创建时间
- `updated_at`：更新时间

### 约束

- 仅保留一行
- `running = 0` 时 `segment_started_at` 可为空
- 刷新恢复时以此表恢复运行态

## 7. settings

- `key`：设置项主键
- `value`：设置值
- `updated_at`：更新时间

### 约束

- 用于保存 UI 偏好、默认选项、导出偏好
- 不存放业务事实

## 8. migrations

- `version`：版本号
- `name`：迁移名称
- `applied_at`：应用时间
- `checksum`：迁移校验值，可选

### 约束

- 每次 schema 变更必须有迁移记录
- 升级失败时可以回退到上一个稳定版本

## 9. 索引建议

- `time_entries(started_at DESC)`
- `time_entries(project_id, started_at DESC)`
- `time_entries(client_id, started_at DESC)`
- `time_entry_tags(tag_id)`
- `tags(name)`
- `projects(name)`
- `clients(name)`

## 10. 迁移原则

- 先兼容旧数据，再切换新结构
- 派生统计不落盘
- 导出字段与表结构同步演进
- 任何字段新增都要先补文档，再补迁移，再补代码
