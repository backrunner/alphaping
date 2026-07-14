# AlphaPing Cloudflare 存储与成本模型

## 1. 正式决策

30 台机器的 V1 采用以下最小生产架构：

- Workers Paid，月度最低费用 5 USD。
- `CONTROL_DB` D1：Better Auth、RBAC、workspace、machine/service config、Agent key metadata、incident 和公告。
- `TELEMETRY_DB` D1：replay state、raw report/check block、latest、5 分钟/1 小时 rollup、状态事件和 retention cursor。
- Rust Ingest Worker 验证后直接以 D1 batch/transaction 持久化，只在成功后返回加密 durable ACK。
- Live Worker 使用按 workspace 路由的 Durable Object Hibernation WebSocket，Dashboard 有订阅时让 Agent 每 10 秒发一个非持久 live snapshot。
- Checks Worker 每分钟 Cron 扫描 due task，最多 5 并发直接执行 HTTP/TCP 检查。
- Retention Worker 按 resource/time cursor 分批删除 D1 过期行。
- 不使用 Telemetry Queue、Telemetry Worker、Durable Objects 持久遥测或 R2 遥测对象。Durable Object 只是可丢失的 live coordination layer。
- R2 只放用户主动生成的导出和备份 artifact。

这不是为了省钱而取消持久化防护。Agent 本地 SQLite WAL 就是无限重试的 durable source；Queue 在 D1 故障时只能额外缓冲最多 14 天，不能替代 Agent spool。Live hub 丢失任何内存状态都不会丢遥测，Dashboard 会回退到 D1 latest，Agent 仍持续 60 秒 durable report。

## 2. 查询粒度与默认保留

| 数据 | 粒度 | 默认保留 | 在线查询 |
| --- | --- | --- | --- |
| Machine/check raw block | 10 秒 sample，5 个分钟槽一条 5m block row | 7 天 | D1 raw API 解码 protobuf |
| 5 分钟 rollup | 5 分钟 | 30 天 | 日/周/月图表 |
| 1 小时 rollup | 1 小时 | 365 天 | 季度/年度图表 |
| Latest | 每资源一行 | 资源存在期 | 列表和 dashboard 服务端聚合 |
| State events | 状态转换 | 365 天 | incident/时间线 |

所有保留期可配置。分层粒度不会让年度图表丢失可用信息：一年窗口下即使保留 5 分钟点，屏幕也无法显示 105,120 个点。1 小时 rollup 反而降低查询延迟和浏览器解析开销。

每个 report slot 保存全部 6 个 sample。一条 `telemetry_blocks_5m` row 含 5 个固定分钟槽，每次上报只 UPSERT 当前槽；过期时每 5 个 report 只 DELETE 一条 block。因此“可查询”包含：

- 当前指标直接查 latest，5 分钟及以上图表直接查 rollup。
- 任意原始 sample 通过有界 API 解码查询。
- 大型导出分页查 D1，完成后才写 R2 artifact。

5 分钟 block 不降低精度，只降低 row overhead 和 retention delete 次数。每个槽内部带 report ID/hash，相同报告重试覆盖同一槽，不会重复追加。单 report 仍限制为 64 KiB，5 个槽最大 320 KiB，低于 D1 2 MB row 上限。

## 3. 2026-07-15 官方价格基线

### Workers Paid

来源：https://developers.cloudflare.com/workers/platform/pricing/

- 最低 5 USD/月。
- 包含 10 million dynamic requests/月，超出 0.30 USD/million。
- 包含 30 million CPU milliseconds/月，超出 0.02 USD/million CPU-ms。
- 静态资源请求免费；Worker 发出的 subrequest 不单独计 dynamic request。

### D1 Paid

来源：

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/

- 整个账户的所有 D1 合计包含 25 billion rows read/月、50 million rows written/月和 5 GB-month。
- 超出价格为 0.001 USD/million rows read、1.00 USD/million rows written、0.75 USD/GB-month。
- `INSERT`、`UPDATE`、`DELETE` 都计 rows written。更新了索引列时，索引也会增加 rows written。
- Paid 单数据库上限 10 GB，单库按顺序处理查询；这个规模的写入频率远低于其性能边界。
- 拆成两个 D1 只做负载/故障域隔离，不获得两份 included usage。

### 未选主路径产品

- Queues：1 million operations included，超出 0.40 USD/million；正常消息交付通常是 write/read/delete 三次 operation。
- Durable Objects：1 million requests included，超出 0.15 USD/million，另有 duration 和 SQLite storage 费用。AlphaPing 只用 Hibernation WebSocket live hub，不用其 SQLite 保存权威遥测。
- R2：在本架构中不产生遥测主路径费用。

## 4. 30 台机器精确流量

统一假设：30 天计费月，30 台机器，10 秒采样，60 秒上报，每台一个 60 秒中央检查。

```text
seconds/month                         2,592,000
samples/machine/month                  259,200
all machine samples/month            7,776,000
reports/machine/month                   43,200
all machine reports/month            1,296,000
central check executions/month       1,296,000
5m rollups/type/month                  259,200
1h rollups/type/month                   21,600
one-minute Cron invocations/month       43,200
```

30 台机器平均只有 0.5 durable report/second。即使加上补报限流，权威存储也不需要 Queue 或 Durable Object 来协调吞吐；DO 只服务 live broadcast。

## 5. D1 写入账本

以保留窗口已填满后的稳态月份计算，因此同时计入 INSERT 和过期 DELETE。

### Machine report path

```text
telemetry_blocks_5m slot UPSERT      1,296,000
telemetry_blocks_5m DELETE             259,200
machine_latest UPDATE                1,296,000
agent_replay_state UPDATE            1,296,000
machine_rollup_5m INSERT + DELETE      518,400
machine_rollup_1h INSERT + DELETE       43,200
subtotal                             4,708,800
```

### Central check path

```text
check_result_blocks_5m slot UPSERT   1,296,000
check_result_blocks_5m DELETE          259,200
check_latest UPDATE                  1,296,000
check_rollup_5m INSERT + DELETE        518,400
check_rollup_1h INSERT + DELETE         43,200
last_claimed_slot UPDATE             1,296,000
subtotal                             4,708,800
```

```text
combined known rows written          9,417,600/month
25% implementation/retry margin      2,354,400/month
budgeted total                      11,772,000/month
Paid included                       50,000,000/month
remaining headroom                  38,228,000/month
D1 write overage                          0.00 USD
```

中央检查不维护每分钟改变的 `next_run_at` 索引。Checks Worker 每分钟读取少量 enabled check，根据稳定 interval/phase 计算 nominal slot，再用 `UPDATE ... WHERE last_claimed_slot < ?` 原子领取。对 30 个 check，这只增加 1.296m rows read/月，但减少 1.296m index writes/月。

Raw block/latest/replay/rollup 热表通过 rowid alias 或 `WITHOUT ROWID` 复合主键服务查询，不再添加二级索引。Dashboard 从 `CONTROL_DB` 取得已授权 resource PK，再按 `IN (...)` 主键查 `TELEMETRY_DB` latest，不为 `workspace_id` 增加热索引。状态转换、incident、配置变更和少量索引维护被 25% margin 覆盖。

D1 最终计费以每个 query 返回的 `meta.rows_written` 为准。Schema 实现后必须用 30 台合成 fixture 重放一个月并替换本模型中的 margin；在没有实体 schema 前，声称精确到最后一个内部索引写入是不可验证的。

### D1 读取预算

按 5 个 dashboard session、每 30 秒刷新 8 小时/天的假设：

```text
Dashboard latest: 144,000 * 60 rows      8.640m
Scheduler: 43,200 * 30 rows              1.296m
Agent key/config/replay, <= 5 rows/report 6.480m
Retention/history/admin reserve          5.000m
budgeted rows read                       21.416m/month
Paid included                        25,000.000m/month
```

预算只占 D1 included reads 约 0.086%。因此在这个规模下，用主键读取代替频繁更新的汇总/调度索引是明确的成本和性能优化。

## 6. Workers request 和 CPU

主路径 request：

```text
Agent report requests                1,296,000
Cron invocations                        43,200
5 dashboard sessions, 30s polling,
8 hours/day                            144,000
total                                1,483,200/month
Paid included                       10,000,000/month
request overage                           0.00 USD
```

中央 HTTP/TCP 检查产生的 outbound subrequest 不单独计 Workers dynamic request。Dashboard 静态资源也免费。

CPU 建模：

```text
Ingest: 1,296,000 * 10 ms            12.960m CPU-ms
Checks Cron: 43,200 * 60 ms           2.592m CPU-ms
Dashboard: 144,000 * 5 ms             0.720m CPU-ms
modeled total                         16.272m CPU-ms
Paid included                         30.000m CPU-ms
CPU overage                             0.00 USD
```

`fetch` 等待时间不等于 CPU time。在这个 dashboard 假设下，Ingest 平均 CPU 即使上升到 20 ms，总量也约为 29.232m CPU-ms，仍在 included 内。Rust/Wasm 的 AES-GCM、zstd 和 protobuf 基准门禁设为正常 report 平均低于 18 ms，为管理操作和峰值留余量。

### 10 秒实时层

- Agent WebSocket 长连默认保持，但没有 viewer 时只使用不唤醒 DO 的协议 ping/pong，不发应用 live frame。
- 第一个有权限 viewer 连接后，hub 向对应 Agent 发送带 TTL 的 `LIVE_DEMAND_ON`，Agent 每 10 秒发送当前 snapshot。
- 最后一个 viewer 离开后发送 `LIVE_DEMAND_OFF`。Viewer 非正常断开由 WebSocket close/error 事件收敛。
- Live snapshot 只用于 UI，不 ACK 本地 spool、不写 D1/DO SQLite、不触发权威告警。状态转换会立即触发 durable report。
- Agent socket attachment 只保存连接身份、短时 session 和角色，不每帧调用 `serializeAttachment()`。Live snapshot 在内存丢失后等待下一个 10 秒帧或回退 D1。
- Hub 以 workspace 为 coordination atom；单 workspace 超过 500 Agent/viewer connections 或实测达到 CPU 门槛时，再按 workspace + stable shard 拆分。

Cloudflare 对 DO 入站 WebSocket 消息按 20:1 折算 request，出站消息和协议 ping/pong 不计 request。假设一个 workspace 始终有 viewer 的最坏情况：

```text
30 Agents: 7.776m live frames / 20 = 0.3888m DO requests
100 Agents: 25.92m live frames / 20 = 1.296m DO requests
100-Agent request overage = 0.296 * 0.15 = 0.0444 USD
```

按需实时的默认假设是 8 小时/天有 viewer。100 Agent 只产生 8.64m live frames，折算 0.432m DO requests，低于 1 million included。

一个 128 MB workspace DO 即使因持续消息整月不能 hibernate，月 duration 也约为 `2,592,000s * 0.128 = 331,776 GB-s`，低于 400,000 GB-s included。两个整月活跃 hub 共 663,552 GB-s，超额费用约 `(663,552 - 400,000) * 12.50 / 1,000,000 = 3.2944 USD`；从第三个起，每多一个整月不休眠的 hub 再增加约 4.1472 USD/月。按需帧和 Hibernation 是多 workspace 部署的必要成本约束。

如果不做 live/durable 分层，而是每 10 秒都发 HTTP durable report 并写 D1 latest/replay/raw，成本会出现明显拐点：

| 方案 | 30 machines + 30 checks | 100 machines + 100 checks |
| --- | ---: | ---: |
| 按需 10s Live Hub + 60s durable D1 writes | 9.418m | 31.392m |
| 每 10s 全部 durable D1 writes | 28.858m | 96.192m |
| 每 10s 全部 durable 的估算总费 | 约 5.24 USD | 至少 58.20 USD，未计 storage |

因此 10 秒实时性必须是可丢失的显示层，而 60 秒 report 是可补报的权威层。故障/恢复等高优先级转换使用独立幂等 durable event delivery 立即发送，不占用或覆盖 nominal minute report slot。

## 7. D1 存储预算

稳态行数：

```text
7d machine raw 5m blocks                60,480
7d check result 5m blocks               60,480
30d machine 5m rollups                 259,200
30d check 5m rollups                   259,200
365d machine 1h rollups                262,800
365d check 1h rollups                  262,800
```

存储无法只由行数精确推导，因为它取决于 protobuf 内容、SQLite page 填充和实际 schema。可验证的边界为：

| 假设 | 估算值 |
| --- | ---: |
| Machine raw 3 KiB/report，7 天 | 0.93 GB |
| Check raw 1 KiB/result，7 天 | 0.31 GB |
| 1,044,000 rollup rows 平均 450 bytes | 0.47 GB |
| Control/latest/events/index 预留 | 0.50 GB |
| 中位总量 | 约 2.21 GB |
| Raw 扩大到 6/2 KiB、rollup 600 bytes、其他 0.75 GB | 约 3.79 GB |

因此默认 7d raw + 30d 5m + 365d 1h 在保守情况下仍可留在账户级 5 GB included 内。实现后使用 D1 `PRAGMA page_count` 和 `PRAGMA page_size` 的乘积测量每个数据库，并在 70/85/100% 显示预警。

即使实测超出 5 GB，也只按 0.75 USD/GB-month 支付超额，不需要把在线历史迁到 R2。单个 `TELEMETRY_DB` 达到 8 GB 时必须提前分片，不等到 10 GB 硬上限。

## 8. 月度费用结论

| 项目 | 30 台估算 |
| --- | ---: |
| Workers Paid 最低费 | 5.00 USD |
| Workers request overage | 0.00 USD |
| Workers CPU overage | 0.00 USD |
| D1 read/write overage | 0.00 USD |
| D1 storage overage | 0.00 USD |
| Telemetry Queue | 0.00 USD |
| Telemetry R2 | 0.00 USD |
| Live Durable Object | 0.00 USD |
| **预计总额** | **5.00 USD/month** |

这是不影响在线查询、Agent 可靠补报、服务检查和一年历史图表的最低可持续方案。Free 计划每日只有 100,000 D1 rows written，与本项目约 313,920 known rows written/day 不兼容，不能作为 30 台生产方案。

## 9. 其他方案的同规模价格

| 方案 | 额外月费 | 总月费 | 为什么不选 |
| --- | ---: | ---: | --- |
| D1 5m block row 直写 | 0.00 USD | 5.00 USD | 推荐 |
| Queue + D1 | 1.1552 USD | 6.16 USD | 1.296m 消息约 3.888m operations，可靠性已由 Agent spool 提供 |
| Queue + R2 raw | 至少 1.1552 USD | 至少 6.16 USD | 还增加 object/manifest/查询复杂度 |
| Durable Objects 作遥测权威库 | 约 0.04 USD 起 | 约 5.04 USD 起 | 不利于跨资源 SQL 查询；Live hub 仍使用 DO |
| 逐 10 秒 sample/容器/磁盘/网卡正规化行 | 约 6.25 USD 起 | 约 11.25 USD 起 | 写放大且 schema 迭代慢 |

Queue 对比：

```text
1,296,000 messages * 3 operations = 3,888,000
(3,888,000 - 1,000,000) / 1,000,000 * 0.40 = 1.1552 USD
```

Durable Object 对比只计 request：

```text
(1,296,000 - 1,000,000) / 1,000,000 * 0.15 = 0.0444 USD
```

它还需要计算 duration 和 SQLite storage，因此不会比 D1 直写更便宜。

## 10. 规模增长曲线

以 `M` 台机器和 `C` 个 60 秒 centralized checks 计算。“100 个服务”在本节等价为每个服务一个 check；一个服务有三个 check 时必须按三个计费。

### 单位边际增量

| 新增资源 | D1 known writes/月 | Worker requests/月 | 目标 storage |
| --- | ---: | ---: | ---: |
| 1 台 60s report machine | 156,960 | 43,200 | 约 26.2 MB |
| 1 个 60s centralized check | 156,960 | 0 | 约 10.7 MB |

中央 check 的 outbound `fetch`/TCP 是同一 Cron invocation 的 subrequest，因此不增加 Workers request 计费，但会增加 CPU 和 D1 rows。上表 storage 要求：

- Machine compressed report 平均/P95 预算不高于 2 KiB，通过 dimension ID、delta 和 zstd 控制。
- Check raw result 平均不高于 512 bytes，不保存完整 response body。
- Rollup 的实际 SQLite 物理占用平均不高于 320 bytes/row。

### 100 台机器 + 100 个服务

```text
machine reports/check executions      4,320,000 each/month
machine known D1 writes              15,696,000/month
check known D1 writes                15,696,000/month
combined known D1 writes             31,392,000/month
25% margin                            7,848,000/month
budgeted D1 writes                   39,240,000/month
Paid included                        50,000,000/month
headroom                             10,760,000/month
```

Workers requests：

```text
Agent reports                         4,320,000
Cron + same dashboard assumption        187,200
total                                 4,507,200
Paid included                        10,000,000
```

CPU 有两个可验证区间：

| CPU 假设 | 月 CPU-ms | CPU overage | 总价不含 storage overage |
| --- | ---: | ---: | ---: |
| 目标：Ingest 5 ms/report，check 1 ms/execution | 26.64m | 0.00 USD | 5.00 USD |
| 保守：Ingest 10 ms/report，check 2 ms/execution | 52.56m | 0.4512 USD | 5.4512 USD |

存储目标：

```text
7d machine raw at 2 KiB/report         2.064 GB
7d check raw at 512 B/result           0.516 GB
30d 5m + 365d 1h, 3.48m * 320 B       1.114 GB
control/latest/events/index reserve    0.500 GB
total target                           4.194 GB
storage overage                         0.00 USD
```

结论：按上述 payload/rollup 预算、CPU 目标和每天 8 小时有 live viewer 的默认，**100 台机器 + 100 个每分钟服务检查仍可完整覆盖在 5 USD Workers Paid included usage 内**。如果全月始终有 live viewer，DO request overage 约 0.0444 USD；如果 CPU 只达到保守基准，再增加约 0.4512 USD/月。这些结论必须由实际 Worker/DO 基准和 D1 page size fixture 验证。

### 更大规模

下表按每个 service 一个 60 秒 check、每天 8 小时 live viewer、保守 CPU 和上述目标 storage 估算。D1 列显示已知逻辑行，不含 25% margin；生产预算必须另加 margin。

| Machines + checks | D1 known writes | Requests | Target storage | 估算总费 |
| --- | ---: | ---: | ---: | ---: |
| 30 + 30 | 9.42m | 1.48m | 约 1.36 GB | 5.00 USD |
| 100 + 100 | 31.39m | 4.51m | 约 4.19 GB | 5.00-5.45 USD |
| 150 + 150 | 47.09m | 6.67m | 约 6.29 GB | 约 6.94 USD；加 25% write margin 时约 15.80 USD |
| 200 + 200 | 62.78m | 8.83m | 约 8.39 GB | 约 21.83 USD |
| 300 + 300 | 94.18m | 13.15m | 约 12.58 GB | 约 58.33 USD |

增长最终由 D1 rows written 主导，大约在 100+100 之后开始逼近 included 边界。每台机器或每个 60 秒 check 将已知月写入增加 156,960；将 interval 从 60 秒改为 300 秒时，该 check 的请求/CPU/行写入约降为五分之一。

## 11. 性能和扩展门槛

- `CONTROL_DB` 与 `TELEMETRY_DB` 分库，避免 retention/补报影响登录和配置管理。
- Dashboard 只在展开图表时查历史，时间范围与 resource ID 始终走主键。
- Checks Worker 用一个 Cron invocation 执行一分钟内的 due tasks，不为每个 check 创建 Worker request/Queue message。30 台默认扫描全部 enabled check；超过 500 个 central check 时再切换到稳定 schedule shard/bucket。
- 单库持续出现 D1 overloaded、存储达 8 GB 或预测含 margin 的月写入超 40 million 时，启动按 workspace/resource hash 分片评估。分片提升容量和并发，但不会重置账户级 included usage。
- 需要子分钟中央调度时才评估 Durable Objects alarms；一分钟以下 ICMP/HTTP/TCP 优先由 Agent 执行。
- 10 秒 live update 由 Durable Objects WebSocket Hibernation 提供；D1 始终是 60 秒 durable latest/history 的权威回退。
- 系统默认将“含 25% margin 的预测 D1 writes”软上限设为 40 million/月。超出前管理界面必须要求调 check/report 周期、关闭不需要的高分辨率 rollup，或显式接受 overage。单纯缩短保留期只降低 storage，稳态 INSERT/DELETE 频率不会下降。

## 12. 上线前成本验证

1. 用实际 Drizzle migration 创建两个本地 D1。
2. 生成 30 与 100 台、7 天 raw、30 天 5m、365 天 1h 的最坏大小 fixture。
3. 记录每条热查询的 `meta.rows_read`/`meta.rows_written`。
4. 用 `PRAGMA page_count * page_size` 记录实际 storage，包含索引。
5. 对 Rust Ingest 执行 AES-GCM/zstd/protobuf/D1 基准：30 台门禁低于 18 ms，100+100 要留在 CPU included 内则目标低于 5 ms/report 且 1 ms/check result。
6. 对 24 小时离线后的补报进行压测，确认 D1 不 overloaded 且 live data 优先。
7. 在发布门禁中重算 30/100/200/1000 台和对应 check 档位，实测值与本基线偏差超过 20% 时阻止发布。
