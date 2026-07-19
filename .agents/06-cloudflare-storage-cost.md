# AlphaPing Cloudflare 存储与成本模型

## 1. 正式决策

30 台机器的 V1 采用以下最小生产架构：

- Workers Paid，月度最低费用 5 USD。
- `CONTROL_DB` D1：Better Auth、RBAC、workspace、machine/service config、Agent key metadata、incident 和公告。
- `TELEMETRY_DB` D1：replay state、raw report/check block、latest、5 分钟/1 小时 rollup、状态事件和 retention cursor。
- Rust Ingest Worker 验证后直接以 D1 batch/transaction 持久化，只在成功后返回加密 durable ACK。
- Live Worker 使用按 workspace 路由的 Durable Object Hibernation WebSocket，Dashboard 有订阅时让 Agent 每 10 秒发一个非持久 live snapshot。
- Checks Worker 每分钟 Cron 扫描 due task，最多 5 并发直接执行 HTTP/TCP 检查。
- Retention Worker 按 resource/time cursor 分批删除 D1 过期行，并按两个固定 prefix 清理显式到期的 R2 artifact。
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
- R2 Standard 包含 10 GB-month、1 million Class A 和 10 million Class B；Class A 超出后为 4.50 USD/million，`DeleteObject` 免费。Retention 每小时只做两次 `ListObjects`。

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
service status bucket INSERT + DELETE  518,400
last_claimed_slot UPDATE             1,296,000
subtotal                             5,227,200
```

Agent executor 即使配置 5/10 秒周期，也把同一 check/minute 的 observation 合并到一个 `check_result_blocks_5m` slot，因此 raw/latest/rollup 写入与 60 秒中央检查相同。Agent path 不写 `last_claimed_slot`，上表把所有检查都按更贵的 central path 计算，属于保守上界；任务创建、重指派和 config revision 写入是低频管理写，不随 probe 周期增长。

```text
machine/check known rows written     9,936,000/month
check scheduler cursor writes           86,400/month
fixed retention/cursor writes           14,400/month
combined known rows written         10,036,800/month
25% implementation/retry margin      2,509,200/month
budgeted total                      12,546,000/month
Paid included                       50,000,000/month
remaining headroom                  37,454,000/month
D1 write overage                          0.00 USD
```

中央检查不维护每分钟改变的 `next_run_at` 索引。Checks Worker 每分钟读取少量 enabled check，根据稳定 interval/phase 计算 nominal slot，再用 `UPDATE ... WHERE last_claimed_slot < ?` 原子领取。对 30 个 check，这只增加 1.296m rows read/月，但减少 1.296m index writes/月。

Raw block/latest/replay/rollup 热表通过 rowid alias 或 `WITHOUT ROWID` 复合主键服务查询，不再添加二级索引。Dashboard 从 `CONTROL_DB` 取得已授权 resource PK，再按 `IN (...)` 主键查 `TELEMETRY_DB` latest，不为 `workspace_id` 增加热索引。状态转换、incident、配置变更和少量索引维护被 25% margin 覆盖。

D1 最终计费以每个 query 返回的 `meta.rows_written` 为准。Schema 实现后必须用 30 台合成 fixture 重放一个月并替换本模型中的 margin；在没有实体 schema 前，声称精确到最后一个内部索引写入是不可验证的。

### D1 读取预算

先按 5 个 dashboard session、每 30 秒刷新 8 小时/天计算非公开页控制面读取：

```text
Dashboard latest: 144,000 * 60 rows      8.640m
Scheduler + post-execution revision fence:
           2 * 43,200 * 30 rows          2.592m
Agent key/config/replay, <= 5 rows/report 6.480m
Machine liveness, 2 * 43,200 * 30 rows   2.592m
Retention/history/admin reserve          5.000m
budgeted rows read                       25.304m/month
Paid included                        25,000.000m/month
```

这部分只占 D1 included reads 约 0.101%。因此在这个规模下，用主键读取代替频繁更新的汇总/调度索引是明确的成本和性能优化，但不能据此忽略公开状态页的历史投影。

Authenticated workspace layout 的动态导航只执行一个返回单行的 `EXISTS` 查询。Admin 从 workspace resource 索引确认 machine/service 是否存在；member 从 `(workspace_id, subject_user_id, resource_type)` grant 索引出发 join 活跃资源并应用 deny-wins，不把 workspace 的全部 resource ID 或用户全部 grant 返回到 Worker 内存。该读取已包含在 `Retention/history/admin reserve`，不会随页面响应体线性放大。

Authenticated dashboard、machine/service collection 和 incident center 在 D1 内应用 active membership、resource allow 与 deny-wins 后才执行既有的 500/200/100 行上限，避免 workspace-wide 排序截断隐藏成员稀疏授权的资源。Dashboard 不再把用户全部 grant 返回 Worker，而是只把固定上限内的可见 resource 和 incident 投影送入后续 latest/history 主键查询；这些控制面读取仍包含在 `Retention/history/admin reserve`。

#### 公开状态页读取

公开状态页使用 Cache API 保存不超过 5 分钟的故障 fallback，其中前 30 秒可直接作为 fresh response。Cloudflare Cache API 内容不会复制到其他数据中心，而且 Cache API 命中仍会执行 Worker，因此模型必须按活跃 edge location 和 route cache key 分别计算。当前路由最多接受 8 个 `servicePage` key；每个 live projection 都读取全部公开 machine/service current state，只有 25 个当前页 service 读取 24 小时 5 分钟时间桶。5 分钟也是 D1 故障期间公开 dashboard/resource policy 撤销的最大旧投影窗口。

模型使用以下保守边界：

- 一个完整页最多读取 `25 * 289 = 7,225` 个 `status_buckets` rows；289 包含 24 小时的 288 个完整区间和 SQL inclusive boundary 最多一行。
- machine/service 各最多 200，container 查询考虑 90 项 D1 bind batch 和每批 500 行上限。
- incident 最多 20 个、每个最多 20 个受影响 service；公开 update 每个 incident 最多读取 20 条候选后全局合并 200 条；announcement 最多 20。
- 每个活跃 edge location 的 8 个允许 cache key 在每个 30 秒窗口各触发一次 live projection；同一窗口的额外 fresh-cache hit 只增加 Worker request。并发过期造成多次 live projection 时，以 `publicStatusRefreshesPerWindow` 线性放大。

按上述最坏 route-key fanout：

| 规模与持续活跃位置 | Public D1 reads | 全部 D1 reads | Worker requests | 平台 overage，不含 5 USD 基础费/CPU |
| --- | ---: | ---: | ---: | ---: |
| 30+30，1 edge location | 2.411b | 2.437b | 2.334m | 0.00 USD |
| 100+100，1 edge location | 6.418b | 6.491b | 5.660m | 0.00 USD |
| 100+100，5 edge locations | 32.092b | 32.165b | 8.425m | 7.17 USD |
| 100+100，20 edge locations | 128.370b | 128.442b | 18.793m | 106.08 USD |

一个 location 的 30+30 模型在一个 30 秒窗口内最多读取 27,908 行，100+100 为 74,288 行；每月各有 86,400 个窗口。这里的 location 是“8 个分页 key 每 30 秒都至少收到一次请求的数据中心”，不是访问者人数。真实流量只访问实际分页时会更低，但跨区域流量、cache expiry burst 或蓄意轮询会更高。发布后必须用 D1 `meta.rows_read` 和 Worker Analytics 分别观测 live projection 与 fresh-cache hit，不能把 5 分钟 fallback TTL 当成全球共享的读取缓存或即时撤销机制。

中央检查执行结束后按 check 主键验证 `config_revision,last_claimed_slot`，防止配置替换期间的在途旧结果覆盖 latest；30/100 个每分钟检查分别增加 1.296m/4.32m rows read/月，不增加 Worker request 或稳态 rows written。Agent command delivery 在每个 report 增加一次 `(agent_id,state,not_before)` 有界索引读取，空队列不产生写入。100 台 Agent 按每分钟一个 report 约增加 4.32m rows read/月，仍只占 Paid 25bn included reads 的 0.0173%。Agent 版本合并进既有 `last_seen_at` 更新，不增加稳态 D1 write；只有创建、实际投递和完成命令时才新增低频 writes。

服务状态并发收敛把原有事务外 `check_latest WHERE service_pk` 读取移动到 check latest 条件写之后的同一 D1 batch，并使用单次 `MAX(severity rank)` 扫描；event/service 后续只按现有复合主键点查。它不新增服务集合扫描、Worker request、稳态 service latest/event write 或热表二级索引，因此上述 rows-read/write 基线不变。

机器离线收敛复用 Checks Worker 现有每分钟 Cron，不增加 Worker request。每台每分钟最多读取一条 CONTROL_DB 配置和一条 TELEMETRY_DB latest；100 台增加 8.64m rows read/月。按 100+100 的 dashboard、scheduler、中央 revision fence、Agent path、liveness 和 5m reserve，非公开页控制面合计约 72.68m rows read/月；加入一个持续活跃 edge location 的公开状态页后为 6.491b，占 Paid included reads 的 25.96%。离线/恢复只在状态转换时写 latest/event，低频写入由 25% margin 覆盖。

`service_state_sync_jobs` 复用 Checks Worker 的既有每分钟 Cron，不增加 Worker request。每次 check target/policy/delete/maintenance mutation 写一个按 check 或 service 合并的 CONTROL_DB job，并在 15 分钟保护窗内重复重放；扫描和处理每轮上限 50，每次尝试在同一行更新 `next_attempt_at,last_attempted_at` 以轮转积压。长维护窗口在保护窗成功收敛后休眠到结束时间，不产生窗口全程的每分钟写入。该负载只随人工配置 mutation 产生，不随 report/check 周期增长，因此不进入稳态账本，由 25% 配置/重试 margin 覆盖。

Retention 每个 workspace 每小时最多写 7 个 resource cursor、1 次 workspace lease claim 和 1 次 lease release，即 `9 * 720 = 6,480` cursor rows written/月。一个常见单 workspace 部署只占 30 台模型 2.484m margin 的 0.261%。Agent command expiry/completion partial indexes 只随低频管理命令变化，不进入稳态遥测账本。

Check secret orphan cleanup 复用同一 hourly workspace lease 和 CONTROL_DB invocation，不增加 Worker request。每轮结构化扫描当前 check secret references，并最多删除 50 个创建超过 24 小时的未引用行；正常无 orphan 时不产生 D1 write，历史异常行的有界 DELETE 属于一次性收敛负载并由 25% 配置/retention margin 覆盖。

`retention_runs` 保留 30 天。稳态每小时的 run insert、completion update、到期 delete 及主键/`started_at` 索引维护按保守上界计 `7 * 720 = 5,040` rows written/月；旧版本积压每小时最多额外删除 100 行，属于有界迁移期负载，不进入长期稳态基线。

R2 artifact retention 每小时对 `exports/v1/` 和 `backups/v1/` 各执行一次最多 500 object 的 list，并为每个 prefix 做一次 D1 lease claim 和 release。固定成本为每月 `2 * 720 = 1,440` Class A 和 `4 * 720 = 2,880` D1 cursor writes；分别只占 R2 included Class A 的 0.144% 和 D1 write margin 的 0.116%。DeleteObject 免费。该成本不随 machine/service 数量增长，只随积压 artifact 跨更多 hourly cursor 周期收敛。

软删除 finalizer 复用同一 hourly invocation 和 workspace lease。无待删除资源时只增加有界候选读取；物理删除只发生在用户删除资源之后，并替代该资源未来的常规 retention DELETE，因此不进入稳态按月写入基线，也不新增 Worker request。

## 6. Workers request 和 CPU

主路径 request：

```text
Agent report requests                1,296,000
Agent live session upgrades            129,600
Cron invocations                        43,200
5 dashboard sessions, 30s polling,
8 hours/day                            144,000
Viewer ticket + socket refresh          29,794
Public status, 1 edge location,
8 keys * one request/30s                691,200
total                                2,333,794/month
Paid included                       10,000,000/month
request overage                           0.00 USD
```

中央 HTTP/TCP 检查产生的 outbound subrequest 不单独计 Workers dynamic request。Dashboard 静态资源也免费。公开状态的 691,200 是让每个 cache key 保持持续活跃所需的最低 request 数；同一 30 秒窗口内更多访问仍执行 Worker，必须额外计 request，但 fresh snapshot 会跳过 D1。

CPU 建模：

```text
Ingest: 1,296,000 * 10 ms            12.960m CPU-ms
Checks Cron: 43,200 * 60 ms           2.592m CPU-ms
Dashboard: 144,000 * 5 ms             0.720m CPU-ms
modeled total                         16.272m CPU-ms
Paid included                         30.000m CPU-ms
CPU overage                             0.00 USD
```

`fetch` 等待时间不等于 CPU time。在这个 dashboard 假设下，Ingest 平均 CPU 即使上升到 20 ms，总量也约为 29.232m CPU-ms，仍在 included 内。Rust/Wasm 的 AES-GCM、zlib、protobuf 和 probe minute batch 基准门禁设为正常 report 平均低于 18 ms，为管理操作和峰值留余量。

### 10 秒实时层

- Agent WebSocket 长连默认保持，但没有 viewer 时只使用不唤醒 DO 的协议 ping/pong，不发应用 live frame。
- 第一个有权限 viewer 连接后，hub 向对应 Agent 发送带 TTL 的 `LIVE_DEMAND_ON`，Agent 每 10 秒发送当前 snapshot。
- 最后一个 viewer 离开后发送 `LIVE_DEMAND_OFF`。Viewer 非正常断开由 WebSocket close/error 事件收敛。
- Live snapshot 只用于 UI，不 ACK 本地 spool、不写 D1/DO SQLite、不触发权威告警。状态转换会立即触发 durable report。
- Agent socket attachment 只保存连接身份、短时 session 和角色，不每帧调用 `serializeAttachment()`。Live snapshot 在内存丢失后等待下一个 10 秒帧或回退 D1。
- Hub 以 workspace 为 coordination atom；单 workspace 超过 500 Agent/viewer connections 或实测达到 CPU 门槛时，再按 workspace + stable shard 拆分。

Cloudflare 对 DO 入站 WebSocket 消息按 20:1 折算 request；WebSocket upgrade 本身按一次 request 计，出站消息和协议 ping/pong 不计。当前 Agent session 每 10 分钟轮换；viewer ticket 为 5 分钟，浏览器提前 10 秒刷新并在每次连接时立即发送一次 demand，随后每 15 秒刷新。这些请求必须计入。

默认 5 个可见 machine detail session、每天 8 小时的模型：

```text
30 Agent session upgrades              129,600
100 Agent session upgrades             432,000
5 viewer upgrades                       14,897
5 topics: 0.432m live frames / 20       21,600
5 viewers: 0.303m demand / 20           15,145
30-machine total DO requests            181,242
100-machine total DO requests           483,642
```

因此默认 30/100 规模都低于 1 million DO requests included。更保守地假设 100 台的每个 topic 每天同时可见 8 小时，DO requests 为 1.464829m，overage 约 0.0697 USD/月；若 100 个 topic 整月持续可见，则为 3.530484m，overage 约 0.3796 USD/月。10 秒 frame 仍不写 D1。

一个 128 MB workspace DO 即使因持续消息整月不能 hibernate，月 duration 也约为 `2,592,000s * 0.128 = 331,776 GB-s`，低于 400,000 GB-s included。两个整月活跃 hub 共 663,552 GB-s，超额费用约 `(663,552 - 400,000) * 12.50 / 1,000,000 = 3.2944 USD`；从第三个起，每多一个整月不休眠的 hub 再增加约 4.1472 USD/月。按需帧和 Hibernation 是多 workspace 部署的必要成本约束。

如果不做 live/durable 分层，而是每 10 秒都发 HTTP durable report 并写 D1 latest/replay/raw，成本会出现明显拐点：

| 方案 | 30 machines + 30 checks | 100 machines + 100 checks |
| --- | ---: | ---: |
| 按需 10s Live Hub + 60s durable D1 writes | 10.037m | 33.221m |
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

这是在一个 edge location 持续访问全部 8 个公开状态分页 key 的保守模型下，不影响在线查询、Agent 可靠补报、服务检查和一年历史图表的最低可持续方案。30+30 的公开页及控制面总 D1 reads 约 2.437b/月，仍在 25b included 内。Free 计划每日只有 100,000 D1 rows written，与本项目约 331,200 known rows written/day 不兼容，不能作为 30 台生产方案。

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
| 1 个 60s centralized check | 174,240 | 0 | 约 11.6 MB |

中央 check 的 outbound `fetch`/TCP 是同一 Cron invocation 的 subrequest，因此不增加 Workers request 计费，但会增加 CPU 和 D1 rows。上表 storage 要求：

- 常见每机约 10 个容器时，完整 machine compressed report 的确定性 fixture 上限为 2 KiB；通过 16-byte stable container key、catalog-on-change 和压缩控制。
- optional 1 分钟 load 与 uptime 只给每个 machine sample 增加两个有界 varint，仍必须包含在同一 2 KiB/8 KiB report fixture 门禁内；系统 hostname/OS/kernel 只在 enrollment 写入 CONTROL_DB，不进入每分钟 raw payload。
- 64 个容器的硬上限 fixture 将常规 report 限制在 8 KiB，catalog 变化 report 限制在 16 KiB；catalog 只在上次认证 ACK 后发生变化时重发。
- Check raw result 平均不高于 512 bytes，不保存完整 response body。
- Rollup 的实际 SQLite 物理占用平均不高于 320 bytes/row。

### 100 台机器 + 100 个服务

```text
machine reports/check executions      4,320,000 each/month
machine known D1 writes              15,696,000/month
check known D1 writes                17,424,000/month
combined known D1 writes             33,120,000/month
check scheduler cursor writes            86,400/month
fixed retention/cursor writes            14,400/month
combined deployment writes           33,220,800/month
25% margin                            8,305,200/month
budgeted D1 writes                   41,526,000/month
Paid included                        50,000,000/month
headroom                              8,474,000/month
```

Workers requests：

```text
Agent reports                         4,320,000
Agent live session upgrades             432,000
Cron + same dashboard assumption        187,200
Viewer ticket + socket refresh           29,794
Public status, 1 edge location           691,200
total                                 5,660,194
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
service status buckets                 0.090 GB
control/latest/events/index reserve    0.500 GB
total target                           4.284 GB
storage overage                         0.00 USD
```

结论：按上述 payload/rollup 预算、CPU 目标、5 个 machine detail session 每天可见 8 小时，并让全部 8 个公开状态分页 key 在一个 edge location 持续活跃，**100 台机器 + 100 个每分钟服务检查仍可完整覆盖在 5 USD Workers Paid included usage 内**。5 个持续活跃 location 会让 D1 read overage 增至约 7.17 USD/月；20 个 location 的平台 overage 约 106.08 USD/月，因此 5 USD 结论不能外推到全球持续流量。即使 100 个 topic 每天都持续可见 8 小时，DO request overage 也约为 0.0697 USD；若 CPU 只达到保守基准，再增加约 0.4512 USD/月。这些结论必须由实际 Worker/DO 基准、D1 page size fixture 和公开页 edge 分布验证。

### 容器密度的存储拐点

上面的 100+100 结论已经包含常见每台约 10 个容器的 2 KiB machine report。容器状态复用现有每分钟 report、`machine_latest` 和 5 分钟 block，因此不会增加 Workers request、replay/latest row write 或 retention delete 行数。

如果 100 台机器全部达到 64 容器硬上限，并且每个常规 report 都达到 8 KiB fixture 门禁：

```text
7d machine raw at 8 KiB/report         8.258 GB
7d check raw at 512 B/result           0.516 GB
30d 5m + 365d 1h rollups               1.114 GB
status/control/latest reserve           0.585 GB
total target                           10.473 GB
storage over 5 GB included              5.473 GB
D1 storage overage at 0.75 USD/GB       4.1048 USD/month
```

这个极端档位的总费约为 9.10 USD/月，加上保守 CPU 约为 9.56 USD/月；同时单 TELEMETRY_DB 会在到达硬上限前触发 8 GB 分片门槛。产品必须在预测接近该档位时缩短 raw retention、限制单机高频容器数或按 workspace/resource hash 分片，不能等到 D1 10 GB 硬上限。

即使按每台 64 个容器每天发生一次完整 catalog 变化，100 台每月最多约增加 387,000 CONTROL_DB logical writes（每次最多 64 upsert、soft-delete sweep 更新 64 行，再更新一次 machine digest），仍被 100+100 的 8.30m 写入 margin 覆盖。catalog report 相比常规 report 的额外存储上限约 24.6 MB/月，不改变上述价格档位。

### 更大规模

下表按每个 service 一个 60 秒 check、每天 8 小时 live viewer、保守 CPU 和上述目标 storage 估算。D1 列显示已知逻辑行，不含 25% margin；生产预算必须另加 margin。

| Machines + checks | D1 known writes | Requests | Target storage | 估算总费 |
| --- | ---: | ---: | ---: | ---: |
| 30 + 30 | 10.037m | 2.33m | 约 1.63 GB | 5.00 USD |
| 100 + 100 | 33.221m | 5.66m | 约 4.28 GB | 5.00-5.45 USD |
| 150 + 150 | 49.781m | 8.04m | 约 6.17 GB | 约 19.09 USD，含 25% write margin 与保守 CPU |
| 200 + 200 | 66.341m | 10.41m | 约 8.06 GB | 约 41.85 USD，含 25% write margin、请求与保守 CPU |
| 300 + 300 | 99.461m | 15.16m | 约 11.84 GB | 约 88.63 USD，含 25% write margin、请求与保守 CPU |

增长最终由 D1 rows written 主导，大约在 100+100 之后开始逼近 included 边界。每台 60 秒 machine report 将已知月写入增加 156,960；每个 60 秒 centralized check 因增加可直接查询的 5 分钟 service status bucket，将已知月写入增加 174,240。将 interval 从 60 秒改为 300 秒时，该 check 的执行、CPU 和主要写入约降为五分之一。

## 11. 性能和扩展门槛

- `CONTROL_DB` 与 `TELEMETRY_DB` 分库，避免 retention/补报影响登录和配置管理。
- Dashboard 只在展开图表时查历史，时间范围与 resource ID 始终走主键。
- Checks Worker 用一个 Cron invocation 执行一分钟内的 due tasks，不为每个 check 创建 Worker request/Queue message。SQL 在 500 行上限前过滤 due task，并用持久化 stable telemetry PK cursor 轮转 central checks；机器离线收敛也用独立 cursor 轮转每批最多 1000 台机器。singleton lease 防止重叠 Cron 并行放大，acquire/release 的保守上界为每月 86,400 D1 writes。
- 单库持续出现 D1 overloaded、存储达 8 GB 或预测含 margin 的月写入超 40 million 时，启动按 workspace/resource hash 分片评估。分片提升容量和并发，但不会重置账户级 included usage。
- 需要子分钟中央调度时才评估 Durable Objects alarms；一分钟以下 ICMP/HTTP/TCP 优先由 Agent 执行。
- 10 秒 live update 由 Durable Objects WebSocket Hibernation 提供；D1 始终是 60 秒 durable latest/history 的权威回退。
- 公开状态页 Cache API 是 per-data-center 缓存。100+100 在 5 个持续活跃 edge location 时已经产生约 7.17 USD D1 read overage；观测到更多 location、30 秒窗口内重复 live projection 或持续访问多个分页 key 时，必须提高 freshness TTL、合并分页快照刷新或引入可验证的全局 single-flight，不能假设 Cache API 自动跨区域去重。不能为了节省读取成本再次把 stale fallback 放宽到小时级，因为那会扩大公开策略撤销窗口。
- 系统默认将“含 25% margin 的预测 D1 writes”软上限设为 40 million/月。超出前管理界面必须要求调 check/report 周期、关闭不需要的高分辨率 rollup，或显式接受 overage。单纯缩短保留期只降低 storage，稳态 INSERT/DELETE 频率不会下降。

## 12. 上线前成本验证

1. 用实际 Drizzle migration 创建两个本地 D1。
2. 生成 30 与 100 台、7 天 raw、30 天 5m、365 天 1h 的最坏大小 fixture。
3. 记录每条热查询的 `meta.rows_read`/`meta.rows_written`，并分别测量公开状态 page 1/last page 的 live projection。
4. 用 `PRAGMA page_count * page_size` 记录实际 storage，包含索引。
5. 对 Rust Ingest 执行 AES-GCM/zlib/protobuf/D1 基准：30 台门禁低于 18 ms，100+100 要留在 CPU included 内则目标低于 5 ms/report 且 1 ms/check minute batch。
6. 对 24 小时离线后的补报进行压测，确认 D1 不 overloaded 且 live data 优先。
7. 用 Worker Analytics 记录公开状态 live/cache/snapshot source、活跃 edge location、cache expiry burst 和每个分页 key 的请求量。
8. 在发布门禁中重算 30/100/200/1000 台和对应 check 档位，以及 100+100 的 1/5/20 edge location 档位；实测值与本基线偏差超过 20% 时阻止发布。
