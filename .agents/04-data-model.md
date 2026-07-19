# AlphaPing 数据模型

## 1. 设计原则

- `CONTROL_DB` 保存 Better Auth、RBAC、workspace、资源配置、Agent key metadata、incident 和公告。
- `TELEMETRY_DB` 保存 replay state、完整 raw report/check batch、latest、5 分钟 rollup、状态桶/事件和 retention cursor。
- 每个 60 秒 report 保存在 5 分钟 block row 的一个固定分钟槽中，内含全部 6 个 10 秒 sample；禁止默认拆成每 sample/磁盘/网卡/容器一行。
- R2 只保存用户显式生成的 export/backup artifact，不保存 dashboard 在线遥测。
- 所有表包含 `workspace_id` 或能通过不可变外键唯一归属 workspace。
- 外部 ID 使用 UUIDv7/ULID；遥测热表使用内部 integer resource PK 和定长 binary report ID。
- 热表优先使用按 resource/time 排序的 `WITHOUT ROWID` 复合主键，只为已定义的查询添加二级索引。
- 时间以 Unix milliseconds `INTEGER` 保存，展示层转换时区。
- secret 和 Agent data key 只保存密文、key ID 和元数据。

两个 D1 数据库不能使用跨库事务。资源和 key 的源数据在 `CONTROL_DB`，遥测表使用对应 integer PK 的不可变副本；删除使用 soft-delete 与 retention 最终收敛。

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
- `purge_started_at`，恢复窗口结束后由 Retention 原子领取；非空时禁止恢复
- `default_dashboard_id`
- `default_sampling_interval_seconds`，新机器表单的 workspace 默认值

索引：唯一 `slug`，`deleted_at`。

### `memberships`

- `workspace_id`, `user_id`
- `role`: `admin|member`
- `status`: `invited|active|suspended`
- `created_at`, `updated_at`

唯一键：`workspace_id,user_id`。

数据库触发器保证并发更新或删除也不能移除 workspace 最后一个活动管理员；应用层的友好校验不是唯一保护。

### `workspace_invitations`

- `id`, `workspace_id`, `email`, `role`
- `token_digest`，只保存带域分离的 HMAC-SHA-256，不保存邀请令牌原文
- `expires_at`, `accepted_at`, `revoked_at`
- `created_by`, `created_at`

同一 workspace/email 只允许一个未接受且未撤销的邀请。管理员重新生成邀请时先撤销旧记录；邀请默认 7 天过期，只能成功使用一次。新邮箱可以在邀请页创建 Better Auth credential，已有邮箱必须先登录匹配账号再接受，公开 Better Auth sign-up 始终关闭。

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

- `id`, `workspace_id`, `public_slug`, `name`, `description`
- `expected_host`, `labels_json`
- `sampling_interval_seconds`
- `report_interval_seconds`
- `offline_after_seconds`
- `container_monitoring_enabled`
- `maintenance_until`
- `desired_config_revision`
- `created_at`, `updated_at`, `deleted_at`
- `purge_started_at`，跨 D1 物理清理开始前的恢复 fencing claim
- `purge_agent_cursor`，Retention 已确认清理完 replay state 的最后一个历史 Agent ID

索引：`workspace_id,deleted_at`。不要给每次报告都会变化的字段建立多余索引。

`public_slug` 是与内部 machine ID 无关的随机稳定标识，只用于显式公开的 guest resource URL。

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
- `hostname`, `os_name`, `os_version`, `kernel_version`，只在 enrollment 时采集有界系统标识
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

该表属于 `TELEMETRY_DB`；其余本节配置和 key 表属于 `CONTROL_DB`。

### `agent_commands`

- `id`, `workspace_id`, `agent_id`
- `type`: allowlist enum
- `payload_json`
- `state`: `pending|delivered|succeeded|failed|expired`
- `not_before`, `expires_at`
- `attempt_limit`, `payload_schema_version`, `delivery_count`
- `result_code`, `result_json`
- `created_by`, `created_at`, `delivered_at`, `completed_at`

命令类型只允许配置刷新、立即检查更新、更新到允许版本、重新探测 runtime 等固定动作。`result_json` 只允许 bounded schema，不保存 stdout/stderr。Ingest 每次 report 通过 `(agent_id,state,not_before)` 索引读取至多 8 个命令；空队列不写 CONTROL_DB。Retention Worker 通过 partial expiry/completion indexes 将到期的 `pending|delivered` 命令标记为 `expired`，并在 30 天审计窗口后分批物理删除 terminal 或从未送达的旧命令。

## 5. 最新机器状态

### `telemetry_blocks_5m`

每台机器每 5 分钟最多一行：

- `machine_pk`, `workspace_pk`, `block_start`
- `report_0` ... `report_4` 可空 BLOB，分别对应 block 内第 0-4 分钟
- `received_0` ... `received_4` 服务端接收时间，可放入 slot envelope 以减少列数
- `schema_version`, `flags`

每个 report slot 内含定长 report ID、payload hash、observed range、sample count、常用 minute summary 和压缩 protobuf payload。Payload 包含完整 machine/disk/NIC/container/Agent-check samples。

主键：`PRIMARY KEY (machine_pk, block_start) WITHOUT ROWID`。

- Ingest 根据 nominal minute 选择五个固定 UPSERT statement 之一，只修改对应 slot。
- 重试必须保持 machine、block/slot、report ID 和 payload 不变；同一 slot 已有不同 report ID/hash 时拒绝覆盖并记录 protocol conflict。
- 紧急状态转换可以提前发送，但写独立幂等 `state_events`；每台机器每 nominal minute 只有一个 raw slot。
- 单 report hard limit 64 KiB，整个 block 理论上限 320 KiB，低于 D1 2 MB row limit。
- 不建立全局 timestamp 索引。Retention Worker 按 machine/time 主键每五个 report 删一行，降低 D1 rows written。
- raw API 按 resource/time 分页读取 block 并解码各 slot，所有原始点仍可查询。

### `machine_latest`

一台机器一行：

- `machine_id`, `workspace_id`, `agent_id`
- `observed_at`, `received_at`
- `status`, `status_reason`
- `cpu_permille`
- `load_1m_milli`
- `memory_used_bytes`, `memory_total_bytes`
- `storage_used_bytes`, `storage_total_bytes`
- `network_rx_bps`, `network_tx_bps`
- `network_rx_total`, `network_tx_total`
- `uptime_seconds`
- `agent_version`, `config_revision`
- `container_inventory_json`，只放经过边界校验的当前 runtime/container 投影；不含 runtime 内部 container ID、环境变量、secret、日志或挂载内容

主键 `machine_id`。Dashboard 先从 `CONTROL_DB` 取得已授权 machine PK，再以主键 `IN (...)` 查询 latest 并计算总览。30 台规模不写 `workspace_status_summary`；对 500 台目标也只需分块读取 500 行，在实测证明有瓶颈前不增加高频汇总写入。

`load_1m_milli` 与 `uptime_seconds` 是可空兼容字段：旧 Agent 的报告保持可接受，界面明确显示未知；新 Agent 在 durable report 和按需 live frame 中发送 optional 标量。Ingest 从每个 durable report 的最后一个样本计算 `healthy|degraded|down|maintenance`，其中 `degraded/down` 分别映射 UI 的“降级/故障”。计算发生在已有 latest UPSERT 内，不增加稳态 D1 写；只有状态发生变化时才向 `state_events` 追加一条由 report ID 幂等约束的事件。

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

主键：`PRIMARY KEY (machine_pk, bucket_start) WITHOUT ROWID`。

5 分钟 row 用于默认历史图表。最近原始图表从 `telemetry_blocks_5m` 读取并还原 10 秒 sample。不添加全局时间索引，retention 按 machine/time 主键执行。

### `machine_rollup_1h`

一台机器每小时一行，指标与 5 分钟 rollup 对应，主键为 `PRIMARY KEY (machine_pk, bucket_start) WITHOUT ROWID`。用于 90 天以上图表。

## 7. 容器

### `containers`

- `id`, `workspace_id`, `machine_id`，其中 `id` 是 Agent 根据 runtime/instance/runtime container ID 生成的稳定 16-byte key 的 hex 表示
- `runtime`, `runtime_instance`, `runtime_container_id`
- `name`, `image`, `first_seen_at`, `last_seen_at`
- `deleted_at`

唯一键：`machine_id,runtime,runtime_instance,runtime_container_id`。Agent 每分钟 report 只发送稳定 key 和动态指标；完整 catalog 仅在目录 digest 与上次认证 ACK 不同时发送。Ingest 只在 `machines.container_catalog_digest` 改变时同步本表，因此稳态不产生逐容器 CONTROL_DB 写入。

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

V1 不在每次 report 逐容器 upsert 该表；当前容器快照从 `machine_latest.container_inventory_json` 读取。`container_latest` 仅在后续实测证明独立 SQL 指标查询值得额外写入时启用。

### `container_rollup_5m`

结构与 machine rollup 类似，仅保存容器 CPU、内存、网络和 restart delta。

V1 默认不生成每容器长保留 rollup。七天内原始容器数据由 machine block slot payload 查询；后续启用时必须有独立保留期和成本预算。

## 8. 服务监控

### `services`

- `id`, `workspace_id`, `name`, `slug`, `description`
- `aggregation_policy`
- `maintenance_until`
- `created_at`, `updated_at`, `deleted_at`
- `purge_started_at`，跨 D1 物理清理开始前的恢复 fencing claim
- `purge_check_cursor`，Retention 已确认清理完 telemetry 的最后一个 check integer PK

V1 的 active collection 护栏为每个 workspace 最多 200 个未删除 service，以及这些 service 下合计 1,000 个 check。创建 service/check 时先执行有界友好校验，并在同一最终 mutation 中用 `NOT EXISTS ... LIMIT 1 OFFSET <limit-1>` 复核，防止并发创建越过上限。软删除 service 的 check 不计 active collection 上限，但仍由 retention 完成物理清理。

### `service_checks`

- `id`, `workspace_id`, `service_id`
- `name`, `type`: `http|tcp|icmp`
- `executor_type`: `cloudflare|agent`
- `executor_agent_id` nullable
- `config_revision`：任何 target/policy 变化时单调递增；中央执行领取、结果 ID 和 latest 写入必须绑定该 revision
- `assignment_revision`：该任务最后一次分配/变更时目标机器的 desired config revision；旧 Agent 或旧 revision 的结果必须拒绝
- `config_bytes`：管理写入时计算的保守快照占用；同一 Agent enabled task 合计不得超过 44 KiB
- `interval_seconds`, `timeout_ms`, `retry_count`（0-3 次）
- `critical`：关键检查失败形成服务故障；非关键检查失败只把服务降级
- `failure_confirmations`, `recovery_confirmations`
- `schedule_phase_seconds`, `last_claimed_slot`, `enabled`
- `config_json`
- `secret_refs_json`
- `created_at`, `updated_at`

对 30 台目标规模不建 `enabled/next_run_at` 索引。Checks Worker 读取 enabled rows 并在应用层计算 nominal slot，用 `last_claimed_slot` 条件 update 幂等领取。`workspace_id,service_id` 索引仅服务配置页查询，高频 claim 不修改其列。

CONTROL migration 使用窄 compatibility trigger 为滚动部署中的旧 Web writer 补增 `config_revision`；trigger 只监听 target/policy 字段，scheduler 的 `last_claimed_slot` 更新不触发，新 Web 显式递增也不会双增。独立 monotonic trigger 拒绝 revision 回退。

### `service_state_sync_jobs`

- `job_key`, `sync_token`
- `workspace_id`, `workspace_pk`, `service_id`, `service_pk`
- `check_id`, `check_pk`，maintenance job 两列都为空
- `reason_code`, `protect_until`, `next_attempt_at`, `last_attempted_at`, `updated_at`

Web 在 check target/policy/delete/maintenance 的 CONTROL_DB mutation transaction 内 upsert job。外部 ID 和 telemetry PK 固定在 job 中，Checks Worker 仍重新读取 CONTROL_DB 当前 enabled/critical/config revision/maintenance 状态后才修改 TELEMETRY_DB。每分钟按 `next_attempt_at,last_attempted_at,job_key` 最多处理 50 个 due job，并在每次成功或失败尝试后用 `job_key,sync_token` 条件轮转；job 在 15 分钟在途保护窗内重复校正，越过保护窗的最后一次同步成功后用同一条件删除，较新的 mutation 不会被旧执行清除。未来结束的 maintenance job 至少保留到 `maintenance_until`，保护窗成功收敛后不再每分钟执行，而是在到期时重算服务状态。

### `check_assertions`

- `id`, `check_id`, `sort_order`
- `source`: `status|latency|header|jsonpath|body`
- `operator`
- `selector`
- `expected_json`
- `severity`: `degraded|down`

结构化行便于编辑和审计，执行时可缓存为 compiled config。

不单独创建每次执行的 lease row。`config_revision`、`last_claimed_slot` 和确定性 `execution_id = hash(check_id, config_revision, nominal_slot)` 共同处理 Cron 至少一次语义。

### `check_latest`

- `check_id`, `workspace_id`, `service_id`
- `execution_id`, `observed_at`
- `status`, `latency_ms`
- `failure_code`, `failure_summary`
- `consecutive_failures`, `consecutive_successes`
- `critical`，随结果投影保存，供中央和 Agent 结果使用同一聚合规则
- `config_revision`，中央检查保存执行时 revision；Agent 行保持 0 并继续由 assignment revision 在 Ingest 入口验证

### `check_result_blocks_5m`

- `check_pk`, `workspace_pk`, `service_pk`
- `block_start`
- `result_0` ... `result_4` 可空 BLOB，每个 slot 保存 execution ID、observed/received time、status、latency、failure code、assertion summary 和有界 payload。Cloudflare executor 保存一次分钟执行；Agent executor 的同一 slot 在顶层保存分钟判定，并在 `samples` 中保留该分钟所有 5/10 秒 observation。

主键：`PRIMARY KEY (check_pk, block_start) WITHOUT ROWID`。Cloudflare 与 Agent 执行器都写入同一 contract。Agent minute batch ID 绑定 check、executor、assignment revision 和 nominal minute；相同 ID/hash 是幂等重复，不同 hash 是冲突。

### `check_rollup_5m`

- `check_id`, `workspace_id`, `service_id`, `bucket_start`
- success/degraded/down/unknown counts
- latency avg/max/p95
- `last_failure_code`

主键：`PRIMARY KEY (check_pk, bucket_start) WITHOUT ROWID`。

### `check_rollup_1h`

字段与 5 分钟 rollup 对应，主键为 `PRIMARY KEY (check_pk, bucket_start) WITHOUT ROWID`，用于 90 天以上状态页和图表。

### `service_latest`

- `service_pk`, `workspace_pk`
- `status`, `status_since`, `reason_code`
- `last_transition_at`, `updated_at`

属于 `TELEMETRY_DB`，只在服务聚合状态转换时写入，不因每次成功检查重写。

中央和 Agent check persistence 不在 D1 batch 外预计算服务状态。每个结果先条件更新自己的 `check_latest`，再在同一 batch 对该服务当前 latest 做一次 severity-rank 聚合；若状态转换，先写以 result ID 幂等的 `state_events`，随后只有本批实际插入的 event 才能按复合主键更新 `service_latest`。因此同服务多 check 并发提交时，最后一个 batch 必然基于已提交 latest 集合重算，结果重试也不能重放已经被后续转换取代的旧 event。

### `status_buckets`

状态页预计算桶：

- `resource_type`, `resource_id`
- `bucket_start`, `bucket_seconds`
- `status`, `availability_basis_points`
- `latency_p50_ms`, `latency_p95_ms`
- `summary_code`

允许公开页面一次查询得到胶囊时间线，不扫描原始结果。

Checks Worker 只在五分钟 block 闭合时写一次 service bucket。同一服务的多个 check 按关键性策略合并状态，并使用最低可用率和最高延迟幂等合并；关键检查 `down` 形成服务 `down`，非关键检查 `down` 形成服务 `degraded`，因此并发 Cron 不需要额外 lease row。该写入和 retention delete 已作为每个 60 秒 centralized check 每月额外 17,280 rows written 纳入成本门禁。

## 9. 事件、Incident 和公告

### `state_events`

- `id`, `workspace_id`
- `resource_type`, `resource_id`
- `from_status`, `to_status`, `reason_code`
- `observed_at`, `created_at`
- `source_execution_id` 或 `source_report_id`

不可变。唯一幂等键防止 report/Cron 重试生成重复转换。

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

`incident_id,COALESCE(published_at,created_at),id` 时间线索引支持按 incident 倒序读取。管理中心每个 incident 最多读取最新 50 条后全局合并 500 条；公开状态页每个 incident 最多读取 20 条后全局合并 200 条。历史记录仍完整保留，查询 loader 不再为全局排序扫描所选 incident 的全部 update。

### `announcements`

- `id`, `workspace_id`, `title`, `body`, `severity`
- `starts_at`, `expires_at`
- `visibility`, `created_by`, `created_at`, `updated_at`, `deleted_at`

查询必须包含时间窗口和 visibility。

## 10. 保留和审计

### `notification_channels`

- `id`, `workspace_id`, `name`, `kind`, `enabled`
- `config_nonce`, `config_ciphertext`，AES-GCM 加密且 AAD 绑定 workspace/channel
- `created_by`, `created_at`, `updated_at`, `deleted_at`

### `notification_rules`

- `id`, `workspace_id`, `resource_type`, `resource_id`, `dimension`, `channel_id`
- `send_recovery`, `enabled`, `created_by`, `created_at`, `updated_at`
- 唯一 `(workspace_id,resource_type,resource_id,dimension,channel_id)`

### `notification_event_cursors`

- 每 workspace 保存 `occurred_at,resource_type,resource_pk,event_id_hex` 复合 cursor。
- 首个渠道创建时从当前时间初始化，不追发创建前的历史状态事件。

### `notification_deliveries`

- deterministic `id`, `workspace_id`, `channel_id`, `event_id_hex`
- `resource_type`, `resource_id`, `dimension`, `previous_state`, `current_state`, `reason_code`, `occurred_at`
- `state`, `attempt_count`, `next_attempt_at`, `claim_until`, `last_error_code`, `sent_at`
- 唯一 `(channel_id,event_id_hex)`，due index 只服务 bounded retry scan。

### `retention_policies`

- `workspace_id`
- `raw_telemetry_days`
- `rollup_5m_days`
- `rollup_1h_days`
- `state_event_days`
- `audit_log_days`
- `expired_announcement_grace_days`
- `soft_delete_grace_days`
- `updated_at`

系统默认为 raw telemetry/check result 7 天、5 分钟 rollup 30 天、1 小时 rollup 365 天、state event 365 天。管理员可调整，界面必须先显示预测存储和写入费用。

### `retention_runs`

- `run_id`, `started_at`, `completed_at`
- `deleted_rows`, `error_code`
- `workspace_cursor`，成功 run 保存下一轮 policy scan 的 workspace telemetry PK；失败 run 不推进

每小时 run 最多处理 100 个 workspace，并读取第 101 个候选判断是否保存 cursor。扫描到末尾后 cursor 归零，避免固定 `LIMIT` 永久饿死较大主键的 workspace。重叠 run 因已有 lease 跳过任何 workspace，或 run 达到 12 分钟工作预算时保留原 cursor，下一轮重试该页，不能越过未处理的 workspace；剩余 3 分钟用于全局清理和持久化 run 结果。

运行历史保留 30 天。Retention 先保存当前成功 run 和 `workspace_cursor`，再按 `started_at,run_id` 索引每小时最多删除 100 条旧成功、失败或中断记录；历史清理失败不反转已经持久化的成功 cursor，下一轮继续重试。

### `audit_logs`

- `id`, `workspace_id`, `actor_user_id`
- `action`, `resource_type`, `resource_id`
- `before_digest`, `after_digest`
- `metadata_json`, `created_at`

禁止把 secret 或完整敏感 payload 放入审计日志。

邀请、成员角色/状态、资源 grant、dashboard/resource public policy 和保留策略的每次 mutation 都必须写一条 audit row。邀请邮件地址和令牌不进入 `metadata_json`；审计只保存资源 ID、动作以及变更前后的规范化摘要。

## 11. 查询、导出与备份

- latest API 按已授权 resource PK 查 `machine_latest`/`check_latest`/`service_latest`，在服务端计算 workspace 总览。
- 默认图表按 resource/time 查 `*_rollup_5m`，不扫 raw batch。
- raw API 强制单个 resource、有界 time range、cursor 和 point 上限，服务端解码 protobuf 后返回结构化点。
- 大型导出通过后台 job 分页读取 D1，完成后才将导出 artifact 写入 `EXPORT_BUCKET`。
- R2 key 仅使用 `exports/v1/workspace=<wid>/<export-id>/...` 和 `backups/v1/<database>/<backup-id>/...`，不存在 telemetry/check object prefix 或 manifest table。
- D1 Time Travel 用于 Paid 计划 30 天运营恢复；开源部署的长期备份是显式管理任务，不在上报热路径中执行。

## 12. Secret 引用

HTTP 检查的敏感 header/body 字段：

- `check_secrets`: `id, workspace_id, name, wrapped_value, wrapping_key_id, created_at, rotated_at`。
- `service_checks.secret_refs_json` 只保存 secret ID 和目标字段。
- 管理 API 返回 masked metadata，不返回明文。
- 编辑 secret 时视为替换，不能读取旧值。
- Retention Worker 在 workspace lease 内按结构化 JSON 引用检查，每小时最多删除 50 个创建超过 24 小时且未被任何 check 引用的孤儿 secret；malformed 引用不能阻断有界清理。

## 13. Migration 规则

- migration 只前进，不重写已发布 migration。
- destructive change 分为 expand、backfill、switch、contract 四步。
- 每个 migration 提供本地和远程 dry-run/backup 指令。
- 大表 backfill 通过 Worker/脚本有界批处理，不在单个 D1 migration 中执行长事务。
- schema version 记录在 installation 和 Agent protocol contract 中分别管理。

## 14. 查询与索引护栏

- 每个 workspace list 查询必须有 `workspace_id` 前缀索引。
- 高频写表避免对每个变化字段建索引。
- Dashboard 状态计数只聚合 authz 返回的已授权 latest PK，不扫描全租户历史表。
- `SELECT *` 只允许 migration/调试，不进入 production repository。
- 历史查询必须同时带 resource ID 和 bounded time range。
- 在测试中读取 D1 query metadata，设置 rows-read 预算回归阈值。
