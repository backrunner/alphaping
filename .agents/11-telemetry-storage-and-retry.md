# 可查询遥测存储与 Agent 补报规范

## 1. 最终技术选择

AlphaPing 按 30 台机器的预期规模使用两个 Cloudflare D1 database。两者在运行时隔离负载，但计费仍按同一账号的 D1 总用量计算。

| 数据 | 存储 | 形式 |
| --- | --- | --- |
| 用户、权限、配置、Agent key metadata | `CONTROL_DB` | 关系表 |
| 机器/容器原始遥测 | `TELEMETRY_DB` | 5 个 60s report slots/条 5m block row |
| 服务检查原始结果 | `TELEMETRY_DB` | 5 个 60s result slots/条 5m block row |
| 持久最新态 | `TELEMETRY_DB` | latest tables |
| 5 分钟和 1 小时汇总 | `TELEMETRY_DB` | rollup tables |
| 10 秒 UI snapshot | Live Hub Durable Object | 非持久 WebSocket broadcast |
| Agent 离线缓冲 | 本地 SQLite WAL | frames + deliveries outbox |
| 用户主动导出/备份文件 | R2 | artifact，不参与在线查询 |

不使用 Durable Objects 保存权威遥测，不使用 Telemetry Queue，不把在线历史沉淀到 R2。Live Hub 只在有 viewer 时请求 Agent 每 10 秒发一个 snapshot；它不写 D1/DO SQLite，失败时回退 D1 latest。拆分 CONTROL_DB/TELEMETRY_DB 是为了让高频保留清理不阻塞登录和配置查询。

## 2. 为什么选择 D1 5 分钟 block row

默认采集/上报：

- Agent 每 10 秒采集一个 machine sample。
- 每 60 秒上报一次 durable report，report 内含 6 个 samples。
- 有 viewer 时每 10 秒发一个可丢失 live snapshot，不从 spool 删除 sample。
- 故障和状态转换使用独立幂等 durable event delivery 立即发送，不占用或覆盖 nominal minute report slot。

服务端将每个 durable report 写入 `telemetry_blocks_5m` 的一个固定分钟 slot：

- `payload` 完整保存 6 个 protobuf samples，因此每个 10 秒点都能查询和还原。
- 当前列表查 latest，普通图表查 5m/1h rollup，不需要解码 raw payload。
- raw 查询先按 machine/time 主键在 D1 选择 blocks，再由 Query Service 解码 slots。
- 每 5 个 report 只有一条过期 block DELETE，将 raw retention 删除写入降低 80%。
- R2 object scan、manifest 和跨存储一致性都不再存在。

这意味着“全部数据可查询”成立，但不要求每个 10 秒点都单独形成一条 SQL row。

## 3. D1 schema

### 3.1 `telemetry_blocks_5m`

```sql
CREATE TABLE telemetry_blocks_5m (
  workspace_pk       INTEGER NOT NULL,
  machine_pk         INTEGER NOT NULL,
  block_start        INTEGER NOT NULL,
  schema_version     INTEGER NOT NULL,
  report_0           BLOB,
  report_1           BLOB,
  report_2           BLOB,
  report_3           BLOB,
  report_4           BLOB,
  PRIMARY KEY (machine_pk, block_start)
) WITHOUT ROWID;
```

- 内部关联使用 integer PK，外部 API 继续使用 UUIDv7/ULID。
- 复合主键支持 machine/time range，不创建额外时间索引。
- 每个 slot 是 canonical `ReportSlot` protobuf，包含 report ID/hash、observed/received time、minute summary 和 bounded zlib `ReportBatch`。
- 单 report hard limit 64 KiB，整行最大 320 KiB，低于 D1 2 MB row limit。
- 同一 slot 重试只能使用相同 report ID/hash；冲突进入 protocol error，不静默覆盖。

### 3.2 `machine_latest`

一台机器一行。每次 report 使用条件 UPSERT：

```sql
... WHERE machine_latest.observed_at <= excluded.observed_at
```

历史补报不会覆盖当前状态。

除 CPU、内存、存储和网络外，latest 保存可空的 `load_1m_milli` 与 `uptime_seconds`。它们来自最后一个 `MetricSample`；旧 Agent 缺省字段时保持未知，不能在查询层伪造为零。

### 3.3 `machine_rollups_5m` / `machine_rollups_1h`

- 每个 5 分钟 bucket 关闭后只写一次。
- 保存 sample count、missing count、CPU avg/max/p95、memory avg/max、storage last、network deltas 和 status。
- 主键 `(workspace_pk, machine_pk, bucket_start)`，使用 `WITHOUT ROWID`。

### 3.4 `check_result_blocks_5m`

- 主键 `(check_pk, block_start) WITHOUT ROWID`，同样使用 `result_0...result_4` 固定 slot。
- 每个 slot 保存 deterministic execution ID、check type、executor、status、latency、failure code、assertion summary 和受限 payload。
- HTTP response body 默认不完整保存，只保留断言需要的受限摘要。

### 3.5 `status_events`

- 主键 `(workspace_pk, resource_type, resource_pk, observed_at, event_id)`。
- 延迟补报保留原始 `observed_at`，但不能在当前时间重复触发告警。

## 4. 查询接口

### 4.1 Machine history

```text
GET /api/workspaces/:wid/machines/:mid/metrics
  ?from=<unix_ms>
  &to=<unix_ms>
  &resolution=raw|5m|1h
  &metrics=cpu,memory,storage,network
  &cursor=<opaque>
```

- `raw`：查询 `telemetry_blocks_5m`，解码 slots/payload，返回每个 10 秒 sample。
- `5m`：查询 `machine_rollups_5m`。
- `1h`：查询 `machine_rollups_1h`。
- raw 单次时间范围默认不超过 24 小时，使用 cursor 查询更长范围。

### 4.2 Container history

```text
GET /api/workspaces/:wid/machines/:mid/containers/:cid/metrics
```

查询对应机器/time blocks，再按稳定 16-byte container key 选择指标。容器名称、镜像和 runtime instance 等维度只在 catalog digest 变化时随 report 发送并同步到 `CONTROL_DB.containers`，不在每个 sample 或每分钟常规 report 重复保存。

### 4.3 Service history

```text
GET /api/workspaces/:wid/services/:sid/checks
GET /api/workspaces/:wid/services/:sid/status-buckets
```

### 4.4 Cross-resource query

- 列表和 workspace 总览按已授权 resource PK 查 D1 latest。
- 单资源历史查询 block/rollup。
- 大规模导出由后台 job 分页查询 D1，然后把最终 artifact 写入 R2。

### 4.5 Live snapshot

- Dashboard SSR/初次进入始终从 D1 latest 起步。
- 只有机器详情 Overview tab 可见时才建立 Live Hub WebSocket；viewer ticket 最长 5 分钟，在 expiry 前 10 秒重连刷新。
- Viewer 每 15 秒刷新 30 秒 demand TTL；有有效 demand 时 Agent 每 10 秒发包含 optional load/uptime 的当前 snapshot。
- 浏览器只接受 observed time 比当前画面新且不超过 20 秒的帧。
- WebSocket 断开或超过 20 秒无帧时，标记 live degraded 并切换到 30 秒 D1 polling；不因 live 断开将机器标记为 offline。

Agent credential 使用 10 分钟稳定 session、最长 15 分钟 ticket。二进制 frame 是 `APL1 | session_id[16] | machine_pk[u64be] | sequence[u64be] | observed_at[u64be] | ciphertext_len[u32be] | AES-GCM ciphertext+tag`；前 44 bytes 为 AAD，nonce 为 4-byte session prefix 加 8-byte sequence，明文为最多 2 KiB 的 protobuf `MetricSample`，整帧最多 16 KiB。

## 5. 写入和确认

```text
Agent local SQLite
  -> Rust Ingest Worker
  -> D1 batch transaction
       UPSERT telemetry_blocks_5m nominal slot
       UPDATE agent_replay_state
       conditional UPSERT machine_latest
       INSERT closed 5m rollup/events if needed
  -> encrypted durable ACK
  -> Agent deletes local delivery
```

规则：

1. Ingest 完成 TLS、AEAD、replay、protobuf 和 size 验证。
2. 一个 D1 transaction/batch 完成 raw slot、replay、latest 和已关闭 rollup/event 写入。
3. 相同 block/slot/report ID/hash 返回 `duplicate_stored`，不产生重复数据；同 slot 不同 hash 是 protocol conflict。
4. TELEMETRY_DB 成功后才返回加密 ACK。
5. TELEMETRY_DB timeout/overloaded/5xx 不 ACK，由 Agent 无限重试。
6. 不使用 `waitUntil()` 假装关键数据已持久化。

`machine_latest.state` 与机器状态转换事件在同一个 TELEMETRY_DB batch 中更新。V1 默认使用 CPU 80/95%、内存 85/95%、存储 85/95% 的 degraded/down 阈值，maintenance window 优先；状态未变化时不写 event，因此不会增加稳态 rows written。

Live WebSocket 不进入上述确认链：它不删除 SQLite frame/delivery，不认定 report 已存储，也不改变 endpoint backoff。

## 6. Agent 本地 SQLite

### 6.1 文件和 PRAGMA

默认文件：

- Linux：`/var/lib/alphaping/spool.db`
- macOS：`/Library/Application Support/AlphaPing/spool.db`
- Windows：`%ProgramData%\AlphaPing\spool.db`

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA auto_vacuum = INCREMENTAL;
```

- Agent 只有一个 SQLite writer task。
- DB/WAL/SHM 文件只允许 service identity 访问。
- payload 使用 local spool key 的 AES-256-GCM 加密。
- `NORMAL` 避免数据库损坏，并接受极端断电时最近 transaction 可能丢失的监控数据取舍。

### 6.2 `spool_frames`

每个 10 秒 sample/check event 先写入：

```sql
CREATE TABLE spool_frames (
  frame_id      TEXT PRIMARY KEY,
  observed_at   INTEGER NOT NULL,
  kind          INTEGER NOT NULL,
  priority      INTEGER NOT NULL,
  payload_nonce BLOB NOT NULL,
  payload       BLOB NOT NULL,
  size_bytes    INTEGER NOT NULL
);
```

采样 task 在 SQLite commit 成功后才认为 sample 已收集。

### 6.3 `deliveries`

```sql
CREATE TABLE deliveries (
  report_id         TEXT PRIMARY KEY,
  bucket_start      INTEGER NOT NULL,
  observed_end      INTEGER NOT NULL,
  priority          INTEGER NOT NULL,
  payload_nonce     BLOB NOT NULL,
  payload           BLOB NOT NULL,
  payload_bytes     INTEGER NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  previous_delay_ms INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   INTEGER NOT NULL,
  last_error_code   TEXT,
  created_at        INTEGER NOT NULL
);
```

准备 delivery 时在一个 transaction 内选择 frames、编码固定 ReportBatch、插入 delivery、删除已纳入 frames。失败时 frames 原样保留。

delivery 一旦尝试发送：

- payload/report ID 保持不变直到 durable ACK。
- 每次 transport retry 使用新的、预先持久化的 sequence/nonce。
- ACK 丢失后相同 report ID 重试，D1 block/slot 与 slot 内 hash 校验完成幂等。

### 6.4 `spool_meta`

保存 transport sequence、endpoint backoff、last success、compaction cursor、dropped/compacted counters 和 last ACK。另在 `meta_blobs/meta` transaction 中保存当前 16-byte live session ID 和已预占 live sequence；同 session 重启后继续递增，新 session 才重置为 1，保证 AES-GCM nonce 不复用。

### 6.5 Agent probe outbox

- `probe_config` 保存最后一个通过 digest/字段预检的完整 snapshot 和 applied revision，重启后直接恢复 scheduler。
- `probe_results` 以确定性 execution ID 为主键，单次 observation 完成后立即 SQLite commit。构建 report 时在同一个 transaction 内插入不可变 delivery payload 并删除已迁入的 observation row；这只是从 frame 表迁移到 outbox，不是确认或丢弃数据。
- durable ACK 前不删除 delivery。断网时 probe 与机器采样继续收集，后续 report 可携带较早 nominal minute 的结果；Ingest 对迟到结果补 raw/rollup，但不允许其倒退 `check_latest/service_latest`。
- 每个 Agent 最多 32 个 enabled task、4 个并发；一分钟最多 512 个 result，协议尺寸测试覆盖 32 task × 5 秒周期的上界。

## 7. 重试分类

### 7.1 无限重试

以下错误不设最大 attempts、不进入 dead-letter、不因时间删除 delivery：

- DNS failure。
- connection refused/reset/unreachable。
- TLS handshake/network timeout。
- HTTP 408、425、429。
- HTTP 500、502、503、504。
- response 截断或无法认证。
- D1 overloaded/timeout 导致的服务端可重试错误。

### 7.2 认证恢复

- 401/403/key epoch rejected：暂停普通 delivery，保留全部数据。
- 最多 5 分钟后再次进行 key/config recovery。
- machine 被明确 revoked 时停止发送，但不静默删除本地 spool。

### 7.3 永久 payload 错误

- 只有服务端认证过的 400/413/415/422 稳定错误码才进入 quarantine。
- Quarantine 不删除，等待 Agent 升级、配置修复或管理员导出。
- 不让一个永远无法解析的 payload 阻塞后续 live data。

### 7.4 成功

- `stored` 和 `duplicate_stored` 都是 durable ACK。
- ACK 的 report ID、payload hash 和 server authentication 全部匹配后才删除 delivery。

## 8. 退避算法

使用 equal-jitter exponential backoff：

```text
base = 1 second
cap(attempt) = min(300 seconds, base * 2^min(attempt, 9))
delay = cap(attempt)/2 + random(0, cap(attempt)/2)
```

典型范围：

```text
0.5-1s, 1-2s, 2-4s, 4-8s, 8-16s, 16-32s,
32-64s, 64-128s, 128-256s, then 150-300s forever
```

规则：

- attempt count 只用于计算和观测，不用于停止。
- 单次等待绝不超过 300 秒。
- authenticated success 将 endpoint backoff 重置为 1 秒。
- OS 网络恢复时，安排 0-5 秒 jitter 后快速尝试。
- Agent 重启后读取持久化 next attempt，超过当前时间 300 秒时 clamp。
- 服务长期不存在时仍至少每 5 分钟尝试一次。

## 9. 恢复和补报顺序

连接恢复后使用双通道公平调度：

1. 先发送包含当前状态和最近转换的 high-priority durable delivery。
2. 再发送最多 4 个 backlog deliveries。
3. 重新检查 current/high-priority frames。
4. 单 Agent concurrency 固定为 1。
5. 默认 catch-up 最大 2 requests/second、512 KiB/second。
6. 服务端 429 时回到统一退避。

历史补报使用原始 observed time，不能覆盖 latest 或重复产生当前告警。

## 10. 磁盘容量和压缩

默认：

- `spool.max_bytes = 512 MiB`。
- `spool.min_free_bytes = max(256 MiB, filesystem_size * 5%)`。
- 不按 attempt count 或普通年龄删除 delivery。

### 70%

- 将 24 小时前、尚未形成 attempted delivery 的 10 秒低优先级 frames 聚合为 1 分钟 frame。

### 85%

- 将 7 天前的 1 分钟低优先级 frames 聚合为 5 分钟 frame。
- 状态转换、check failure/recovery、command result 和 gap event 保持原精度。

### 95%

- 新的常规 machine sample 直接按 5 分钟聚合。
- 高优先级事件仍立即落盘。
- 使用增量 checkpoint/vacuum，不执行阻塞 sampler 的 full vacuum。

### Hard limit

- 先淘汰最旧且从未尝试投递的低优先级 5 分钟聚合。
- 不因空间策略删除已 attempted delivery，除非文件系统已无法写入任何数据。
- 淘汰写入 loss counter；空间恢复后的首个 report 包含 DataGap 时间范围。

无限重试不等于无限磁盘。有限磁盘上不可能在服务永久不可达时同时承诺永不丢数据，产品必须显示 compaction、loss 和剩余容量。

## 11. Retention Worker

- 按 workspace policy 分批删除 D1 raw、rollup、event 和 soft-deleted records。
- 每个 scheduled time 使用确定性 run ID；每个 workspace 先取得 15 分钟 D1 lease，重叠 Cron 不会并行清理同一 workspace。
- 使用 resource/time 主键和 cursor，每次处理有界 rows。某资源 DELETE 命中完整 batch 时 cursor 不越过该资源；只有少于 batch limit、确认本轮旧行耗尽后才前进，因此 crash 或大积压不会跳过数据。
- DELETE 也计入 D1 rows written，成本估算必须同时计算 INSERT 和过期 DELETE。
- Cron 至少一次，所有 batch 幂等可续跑。
- CONTROL_DB 中超过 30 天审计窗口的 terminal/未送达 Agent command 直接删除；近期到期的 `pending|delivered` 命令更新为 `expired`。公告失效 7 天后再物理删除。
- R2 retention 只 list `exports/v1/` 和 `backups/v1/`，每个 prefix 每小时最多 500 object。对象只有带合法 `alphaping-expires-at-ms` custom metadata 且已到期才删除；无元数据对象保留，避免误删旧格式或手工 artifact。prefix cursor 与 5 分钟 lease 保存在 D1，失败后可续跑。

## 12. 成本与扩展摘要

精确价格、CPU、storage 和 30/100/150/200/300 档位计算以 `06-cloudflare-storage-cost.md` 为单一事实源。本文只保留与 Agent 持久语义直接相关的结论。

假设 10 秒采样、60 秒 durable report、raw 7 天、5m rollup 30 天、1h rollup 365 天：

```text
30 machines + 30 one-minute checks
known D1 writes                 9.94536m/month
with 25% margin                12.43170m/month
Paid included                 50.0000m/month
expected total                     5.00 USD/month

100 machines + 100 one-minute checks
known D1 writes                33.12936m/month
with 25% margin                41.41170m/month
Paid included                 50.000m/month
```

100+100 在 payload/CPU 门禁达标时仍可位于 5 USD included usage 内。保守 CPU 模型约增加 0.4512 USD/月；默认 5 个 machine detail session 每天可见 8 小时时 DO requests 仍在 included 内，100 个 topic 每天全部可见 8 小时的 overage 约 0.0697 USD/月。

Live frame 不写 D1，因此 10 秒 UI 实时性不会将 D1 rows written 扩大 6 倍。系统没有 viewer 时停止应用 live frame，但仍每 10 秒采集并每 60 秒生成 durable delivery。

## 13. 存储与 payload 门禁

- 30 台中位物理存储估算约 2.21 GB，保守情况约 3.79 GB。
- 100+100 在常见每机约 10 个容器时要留在 5 GB included 内，machine compressed report fixture 不高于 2 KiB、check result 不高于 512 bytes、rollup 物理平均不高于 320 bytes/row。
- 64 容器硬上限的常规 report fixture 不高于 8 KiB，catalog 变化 report 不高于 16 KiB；100 台全部达到该上限时预计 D1 storage overage 约 4.1048 USD/月，并提前触发 8 GB telemetry 分片评估。
- 容器名称、镜像、磁盘名称和网卡名称放在维度表，block slot 只引用 integer ID，避免重复长字符串。
- 实现后必须用 `meta.rows_read/rows_written` 和 `PRAGMA page_count * page_size` 替换估算。
- 单个 TELEMETRY_DB 达 8 GB、持续 overloaded 或预测含 margin 的月写入达 40m 时启动分片评估。

## 15. 验收测试

- 任意持久化 report/check result 可以按 resource/time API 查询并还原。
- 服务不可达 24 小时，sample 仍持续进入本地 SQLite，Agent 重启后继续。
- 临时失败 attempts 可以超过任意固定次数，delivery 不进入 dead-letter。
- 长期失败期间任意相邻请求间隔不超过 300 秒加调度误差。
- 网络恢复事件在 0-5 秒内唤醒快速尝试。
- D1 写入成功、ACK 丢失后重试只命中同一 block/slot，不追加重复 report。
- 恢复后 live 状态先可见，backlog 随后有界补报。
- 有 viewer demand 时机器快照正常间隔不高于 10 秒，界面数据年龄目标不高于 12 秒。
- Live frame 不删除 spool frame/delivery、不重置 durable backoff，Hub 断开时 Agent 仍持续采集和 60 秒 durable report。
- 70/85/95% 压力策略可重复、崩溃安全并记录 compact/loss counters。
- Retention Worker 删除计入成本模型，重复执行结果一致。
