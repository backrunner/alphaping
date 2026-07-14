# AlphaPing 数据模型

## 1. 设计原则

- D1 保存关系、权限、最新态、状态事件和压缩汇总，不保存无限增长的原始 sample 行。
- R2 保存按时间和租户分区的不可变原始块。
- 所有表包含 `workspace_id` 或能通过不可变外键唯一归属 workspace。
- 外部 ID 使用 UUIDv7/ULID 字符串，热点表可以保留内部 integer rowid。
- 时间以 Unix milliseconds `INTEGER` 保存，展示层转换时区。
- secret 和 Agent data key 只保存密文、key ID 和元数据。

## 2. 身份与初始化

Better Auth 核心表由其 schema 生成并纳入统一 migration：

- `users`
- `sessions`
- `accounts`
- `verifications`

项目表：

### `installations`

- `id`
- `state`: `pending|complete`
- `created_at`
- `completed_at`
- `schema_version`

全局只允许一条 active installation。初始化完成前业务 route 不可用。

### `workspaces`

- `id`, `slug`, `name`
- `created_at`, `updated_at`, `deleted_at`
- `default_dashboard_id`

索引：唯一 `slug`，`deleted_at`。

### `memberships`

- `workspace_id`, `user_id`
- `role`: `admin|member`
- `status`: `invited|active|suspended`
- `created_at`, `updated_at`

唯一键：`workspace_id,user_id`。

## 3. Dashboard 与授权

### `dashboards`

- `id`, `workspace_id`, `slug`, `name`, `description`
- `visibility`: `private|authenticated|public`
- `created_by`, `created_at`, `updated_at`, `deleted_at`

### `dashboard_resources`

- `dashboard_id`
- `resource_type`: `machine|service`
- `resource_id`
- `sort_order`
- `public_override`: `inherit|allow|deny`

### `resource_grants`

- `id`, `workspace_id`
- `subject_user_id`
- `resource_type`
- `resource_id`
- `capability`: `view|manage`
- `effect`: `allow|deny`
- `created_by`, `created_at`

唯一键：subject/resource/capability。列表查询索引：`workspace_id,subject_user_id,resource_type`。

### `resource_public_policies`

- `workspace_id`, `resource_type`, `resource_id`
- `effect`: `allow|deny`
- `projection_profile`: `summary|detailed`
- `updated_at`

游客查询必须先由 dashboard visibility 允许，再应用资源 policy 和 projection profile。

## 4. 机器和 Agent

### `machines`

- `id`, `workspace_id`, `name`, `description`
- `expected_host`, `labels_json`
- `sampling_interval_seconds`
- `report_interval_seconds`
- `offline_after_seconds`
- `container_monitoring_enabled`
- `maintenance_until`
- `desired_config_revision`
- `created_at`, `updated_at`, `deleted_at`

索引：`workspace_id,deleted_at`。不要给每次报告都会变化的字段建立多余索引。

### `agent_enrollment_tokens`

- `id`, `workspace_id`, `machine_id`
- `token_digest`
- `expires_at`, `used_at`, `revoked_at`
- `created_by`, `created_at`

索引：唯一 `token_digest`，`expires_at`。token 原文只在创建响应中出现一次。

### `agents`

- `id`, `workspace_id`, `machine_id`
- `identity_public_key`
- `platform`, `arch`, `agent_version`, `protocol_version`
- `status`: `active|revoked`
- `applied_config_revision`
- `created_at`, `last_seen_at`, `revoked_at`

一台 machine 在 V1 只允许一个 active Agent，保留历史 revoked identity。

### `agent_keys`

- `agent_id`, `key_epoch`
- `wrapped_data_key`
- `wrapping_key_id`
- `nonce_prefix`
- `valid_from`, `valid_until`, `revoked_at`

唯一键：`agent_id,key_epoch`。

### `agent_replay_state`

- `agent_id`, `key_epoch`
- `highest_sequence`
- `window_bitmap` 或等价有界 replay window
- `updated_at`

只由 ingest 写入。

### `agent_commands`

- `id`, `workspace_id`, `agent_id`
- `type`: allowlist enum
- `payload_json`
- `state`: `pending|delivered|succeeded|failed|expired`
- `not_before`, `expires_at`
- `created_by`, `created_at`, `delivered_at`, `completed_at`

命令类型只允许配置刷新、立即检查更新、更新到允许版本、重新探测 runtime 等固定动作。

## 5. 最新机器状态

### `machine_latest`

一台机器一行：

- `machine_id`, `workspace_id`, `agent_id`
- `observed_at`, `received_at`
- `status`, `status_reason`
- `cpu_basis_points`
- `load_1m_milli`
- `memory_used_bytes`, `memory_total_bytes`
- `storage_used_bytes`, `storage_total_bytes`
- `network_rx_bps`, `network_tx_bps`
- `network_rx_total_bytes`, `network_tx_total_bytes`
- `uptime_seconds`
- `agent_version`, `config_revision`
- `summary_blob`，只放非查询热点扩展字段

主键 `machine_id`。在线/故障总数由 workspace summary 表维护，避免频繁扫描和索引 `observed_at`。

### `workspace_status_summary`

- `workspace_id`
- machine total/online/degraded/fault/offline counts
- service healthy/degraded/down counts
- current rx/tx bps
- active incident count
- `updated_at`

由 telemetry processor 增量维护并定期重算校正。

## 6. 机器历史汇总

### `machine_rollup_5m`

一台机器每 5 分钟一行：

- `workspace_id`, `machine_id`, `bucket_start`
- `sample_count`, `missing_count`
- CPU avg/max/p95 basis points
- memory avg/max bytes
- storage used last/max bytes
- network rx/tx avg/max bps
- network rx/tx delta bytes
- `extra_blob` 用于非热点扩展指标

唯一键：`machine_id,bucket_start`。

索引：

- `workspace_id,bucket_start`
- 主键/唯一键用于单机时间范围查询

5 分钟 row 代替每 10-30 秒 sample row。最近原始图表需要更细粒度时从 R2 raw block 读取。

## 7. 容器

### `containers`

- `id`, `workspace_id`, `machine_id`
- `runtime`, `runtime_container_id`
- `name`, `image`, `first_seen_at`, `last_seen_at`
- `deleted_at`

唯一键：`machine_id,runtime,runtime_container_id`。

### `container_latest`

- `container_id`, `workspace_id`, `machine_id`
- `observed_at`
- `state`, `health`, `restart_count`
- `cpu_basis_points`
- `memory_used_bytes`, `memory_limit_bytes`
- `network_rx_bps`, `network_tx_bps`
- `ports_json`
- `started_at`, `exit_code`

不保存环境变量和 secret。

### `container_rollup_5m`

结构与 machine rollup 类似，仅保存容器 CPU、内存、网络和 restart delta。

## 8. 服务监控

### `services`

- `id`, `workspace_id`, `name`, `slug`, `description`
- `aggregation_policy`
- `status`, `status_since`
- `maintenance_until`
- `created_at`, `updated_at`, `deleted_at`

### `service_checks`

- `id`, `workspace_id`, `service_id`
- `name`, `type`: `http|tcp|icmp`
- `executor_type`: `cloudflare|agent`
- `executor_agent_id` nullable
- `interval_seconds`, `timeout_ms`
- `failure_confirmations`, `recovery_confirmations`
- `next_run_at`, `enabled`
- `config_json`
- `secret_refs_json`
- `created_at`, `updated_at`

索引：`enabled,next_run_at`，`workspace_id,service_id`。

### `check_assertions`

- `id`, `check_id`, `sort_order`
- `source`: `status|latency|header|jsonpath|body`
- `operator`
- `selector`
- `expected_json`
- `severity`: `degraded|down`

结构化行便于编辑和审计，执行时可缓存为 compiled config。

### `check_execution_leases`

- `check_id`
- `execution_id`
- `scheduled_for`
- `lease_until`
- `claimed_by`

用于 Cron 至少一次和并发 scheduler 的幂等。

### `check_latest`

- `check_id`, `workspace_id`, `service_id`
- `execution_id`, `observed_at`
- `status`, `latency_ms`
- `failure_code`, `failure_summary`
- `consecutive_failures`, `consecutive_successes`

### `check_rollup_5m`

- `check_id`, `workspace_id`, `service_id`, `bucket_start`
- success/degraded/down/unknown counts
- latency avg/max/p95
- `last_failure_code`

### `status_buckets`

状态页预计算桶：

- `resource_type`, `resource_id`
- `bucket_start`, `bucket_seconds`
- `status`, `availability_basis_points`
- `latency_p50_ms`, `latency_p95_ms`
- `summary_code`

允许公开页面一次查询得到胶囊时间线，不扫描原始结果。

## 9. 事件、Incident 和公告

### `state_events`

- `id`, `workspace_id`
- `resource_type`, `resource_id`
- `from_status`, `to_status`, `reason_code`
- `observed_at`, `created_at`
- `source_execution_id` 或 `source_report_id`

不可变。唯一幂等键防止重复 queue 生成重复转换。

### `incidents`

- `id`, `workspace_id`, `title`, `summary`
- `severity`, `status`
- `started_at`, `resolved_at`
- `created_by`, `created_at`, `updated_at`, `deleted_at`

### `incident_resources`

- `incident_id`, `resource_type`, `resource_id`, `impact`

### `incident_updates`

- `id`, `incident_id`, `status`, `message`
- `published_at`, `created_by`, `created_at`

追加式记录。修正内容通过新 update 或审计记录完成。

### `announcements`

- `id`, `workspace_id`, `title`, `body`, `severity`
- `starts_at`, `expires_at`
- `visibility`, `created_by`, `created_at`, `updated_at`, `deleted_at`

查询必须包含时间窗口和 visibility。

## 10. 保留和审计

### `retention_policies`

- `workspace_id`
- `raw_telemetry_days`
- `rollup_5m_days`
- `state_event_days`
- `audit_log_days`
- `expired_announcement_grace_days`
- `soft_delete_grace_days`
- `updated_at`

### `retention_runs`

- `id`, `workspace_id`, `kind`
- `cursor_json`, `lease_until`
- `deleted_rows`, `deleted_objects`, `deleted_bytes`
- `state`, `started_at`, `finished_at`, `error_code`

### `audit_logs`

- `id`, `workspace_id`, `actor_user_id`
- `action`, `resource_type`, `resource_id`
- `before_digest`, `after_digest`
- `metadata_json`, `created_at`

禁止把 secret 或完整敏感 payload 放入审计日志。

## 11. R2 对象布局

```text
telemetry/v1/workspace=<wid>/machine=<mid>/date=YYYY-MM-DD/hour=HH/<ulid>.pb.zst
checks/v1/workspace=<wid>/service=<sid>/date=YYYY-MM-DD/hour=HH/<ulid>.pb.zst
exports/v1/workspace=<wid>/<export-id>/...
public-snapshots/v1/dashboard=<did>/<revision>.json.br
```

原始 object 内容：

- header：schema version、workspace、resource、min/max observed time、report count。
- records：长度分隔 protobuf batch。
- 压缩：zstd level 1 或经基准测试后的等价低 CPU 配置。
- object 目标 256 KiB 到 4 MiB，低流量租户允许按时间上限提前 flush。

### `telemetry_manifests`

- `id`, `workspace_id`, `resource_type`, `resource_id`
- `object_key`
- `min_observed_at`, `max_observed_at`
- `record_count`, `size_bytes`, `sha256`
- `state`: `pending|complete|delete_pending|deleted`
- `created_at`, `deleted_at`

历史查询和清理只查 manifest，不使用 R2 list 发现业务对象。

## 12. Secret 引用

HTTP 检查的敏感 header/body 字段：

- `check_secrets`: `id, workspace_id, name, wrapped_value, wrapping_key_id, created_at, rotated_at`。
- `service_checks.secret_refs_json` 只保存 secret ID 和目标字段。
- 管理 API 返回 masked metadata，不返回明文。
- 编辑 secret 时视为替换，不能读取旧值。

## 13. Migration 规则

- migration 只前进，不重写已发布 migration。
- destructive change 分为 expand、backfill、switch、contract 四步。
- 每个 migration 提供本地和远程 dry-run/backup 指令。
- 大表 backfill 通过 Worker/脚本有界批处理，不在单个 D1 migration 中执行长事务。
- schema version 记录在 installation 和 Agent protocol contract 中分别管理。

## 14. 查询与索引护栏

- 每个 workspace list 查询必须有 `workspace_id` 前缀索引。
- 高频写表避免对每个变化字段建索引。
- 状态计数使用 summary 表，不在每次 dashboard 请求中全表聚合。
- `SELECT *` 只允许 migration/调试，不进入 production repository。
- 历史查询必须同时带 resource ID 和 bounded time range。
- 在测试中读取 D1 query metadata，设置 rows-read 预算回归阈值。
