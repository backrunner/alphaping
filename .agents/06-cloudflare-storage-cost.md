# Cloudflare 存储与成本设计

## 1. 核对基线

本文件价格和限制按 2026-07-15 官方文档核对。Cloudflare 价格会变化，发布前和每季度必须重新核对 `10-research.md` 中的链接。

## 2. 当前关键价格

### Workers Paid

- 基础费用：每账号每月 5 USD。
- 10 million dynamic requests/month included，超出后 0.30 USD/million。
- 30 million CPU milliseconds/month included，超出后 0.02 USD/million CPU ms。
- 静态资源请求免费且不限量。
- WebSocket 初次 Upgrade 计一个 request，消息本身不按 request 计费。

### D1 Paid

- 前 25 billion rows read/month included，之后 0.001 USD/million rows。
- 前 50 million rows written/month included，之后 1.00 USD/million rows。
- 前 5 GB storage included，之后 0.75 USD/GB-month。
- index 写入也会增加 rows written。

### R2 Standard

- 10 GB-month storage free，之后 0.015 USD/GB-month。
- 1 million Class A operations/month free，之后 4.50 USD/million。
- 10 million Class B operations/month free，之后 0.36 USD/million。
- Internet egress free。
- DeleteObject 免费。

### Queues Paid

- 1 million operations/month included，之后 0.40 USD/million operations。
- 小于等于 64 KB 的消息，正常投递通常产生 write/read/delete 三个 operations。
- operations 按 message 计，不按 batch invocation 计。

### Analytics Engine

- 文档预告价：10 million data points/month included，之后 0.25 USD/million；1 million reads included，之后 1.00 USD/million。
- 2026-07 文档仍说明当前尚未实际计费。
- 数据固定保留三个月，不能用于需要按 workspace 自定义删除的权威租户遥测。

## 3. 为什么不能只用 D1

假设一台 Agent 每 30 秒上报一次：

```text
reports_per_agent_month = 30 days * 86400 / 30 = 86,400
```

1000 台机器每月 86.4 million reports。若每个 sample 写一行，尚未计算 index 就超过 50 million included rows written。若再为时间、workspace、status 建索引，实际 rows written 会进一步放大。

因此：

- D1 只保存 latest、状态事件、5 分钟 rollup、manifest 和配置。
- 原始 10-60 秒 sample 批量写入 R2。
- Dashboard 总览读取 summary/latest，不扫描原始时序。

## 4. 为什么不能每个 report 写一个 R2 object

1000 台机器每 60 秒上报：

```text
reports/month = 1000 * 30 * 86400 / 60 = 43.2 million
```

每 report 一个 PutObject 会产生 43.2 million Class A operations，约有 42.2 million billable，单 Class A 成本约 189.90 USD/月，远高于存储本身。

因此 telemetry consumer 必须把多条 Queue message 合并为一个 R2 object。目标每 object 100-1000 reports，或 256 KiB 到 4 MiB。

## 5. 推荐数据分层

| 层 | 存储 | 粒度 | 默认保留 | 用途 |
| --- | --- | --- | --- | --- |
| Latest | D1 | 每资源一行 | 资源存在期 | 列表、总览、当前状态 |
| Summary | D1 | 每 workspace 一行 | 持续 | Dashboard 总计数 |
| Hot rollup | D1 | 5 分钟 | 30 天 | 常用图表和状态胶囊 |
| Events | D1 | 状态转换 | 180 天 | 时间线、incident 关联 |
| Raw telemetry | R2 | 10-60 秒 batch | 7 或 30 天 | 细粒度诊断、导出 |
| Public snapshot | R2/Cache | revision | 短期 | 公开状态页降级读取 |
| Worker ops metrics | Analytics Engine | datapoint | 固定 3 个月 | 平台运行和成本指标 |

默认值是产品建议，不应硬编码。workspace 可以在系统允许范围内调整。

## 6. 默认采样和上报

- 本地 sample：10 秒。
- 正常 report：60 秒，包含最近 6 个 sample。
- 故障/状态转换：允许立即提前 report，但加入最小间隔和抖动。
- 服务检查结果可与机器 report 合并。
- envelope hard limit 64 KiB，超过时拆分。
- 每个 Queue message 尽量小于 64 KB，避免按多个 operation chunk 计费。

这种设计保留 10 秒局部精度，同时把 Workers request 和 Queue message 控制在每 Agent 每分钟一次。

## 7. 月度估算公式

设：

- `N`：Agent 数量。
- `R`：report interval seconds。
- `S`：平均加密 report bytes。
- `B`：每个 R2 object 合并的 report 数。

```text
reports = N * 2,592,000 / R
worker_billable_requests = max(0, reports - 10,000,000)
queue_operations = reports * 3
r2_puts = ceil(reports / B)
raw_storage_gb_30d = reports * S / 1,000,000,000
rollup_rows = N * 30 * 24 * 12
```

实际还要增加浏览器/API 请求、重试、检查任务、index 写入和 CPU。

## 8. 示例成本

假设：

- 60 秒 report。
- report 小于 64 KB。
- 每个 R2 object 合并 100 reports。
- 平均压缩加密 report 1.5 KB。
- 只估 Agent ingest 主路径，未计 Web 流量、中央检查和 CPU 超额。

### 100 Agents

```text
reports              4.32 million/month
Workers overage      0
Queue operations     12.96 million
Queue estimate       (12.96 - 1) * 0.40 = 4.784 USD
R2 puts              43,200, within free Class A
Raw 30d storage      about 6.48 GB, within free storage
5m rollup rows       864,000/month
```

基础 Worker 计划加 Queue 主路径约 9.78 USD/月，D1/R2 在该假设下通常仍在 included usage 内。

### 1000 Agents

```text
reports              43.2 million/month
Workers overage      (43.2 - 10) * 0.30 = 9.96 USD
Queue operations     129.6 million
Queue estimate       (129.6 - 1) * 0.40 = 51.44 USD
R2 puts              432,000, within free Class A
Raw 30d storage      about 64.8 GB
R2 storage estimate  (64.8 - 10) * 0.015 = 0.822 USD
5m rollup rows       8.64 million/month
```

主路径粗估约 67.22 USD/月，加上 CPU、检查任务、D1 index 写入和读取预算。此处显示 Queue operations 是 1000 Agent 级别的主要可变成本，应持续评估更大 batch、report 周期和直接有界处理的取舍。

### 敏感性

- report 从 60 秒改为 30 秒，Workers、Queue 和原始存储大致翻倍。
- report 平均 4 KB 时，1000 Agent 的 30 天 raw 约 172.8 GB，R2 storage 约 2.44 USD，仍远低于大量小 object 的 Class A 成本。
- R2 batch 从 100 降到 10，1000 Agent 的 puts 变成 4.32 million，产生约 14.94 USD Class A overage。

## 9. D1 写入预算

### 9.1 Latest

若每个 60 秒 report 都更新 `machine_latest`，1000 Agent 每月 43.2 million base row writes，已接近 50 million included，且 index 可能增加写入。

策略：

- `machine_latest` 不给高频值建索引。
- 每个 report 更新 latest，但在规模接近预算时允许 60-120 秒 latest write coalescing。
- 状态转换和故障 report 不合并，立即写入。
- workspace count 使用 summary 增量更新，而不是给 latest status 建多个索引。

### 9.2 Rollup

5 分钟 rollup：

- 100 Agent：864,000 rows/month。
- 1000 Agent：8.64 million rows/month。

即使考虑必要索引，也显著低于逐 sample 写入。

### 9.3 Index

- 每个 index 都必须写明服务的查询。
- 高频表优先复合索引，避免多个单列索引。
- CI 性能 fixture 读取 query `meta.rows_read`/`rows_written`，超过预算则失败或报警。

## 10. R2 object 策略

- 使用 Standard storage 保存短保留 raw 数据。Infrequent Access 有 30 天最短存储期和读取费用，不适合 7-30 天频繁诊断数据。
- object 只追加不修改，避免 read-modify-write。
- Queue consumer batch 按 workspace/resource/time 合并。
- 小流量 resource 在 5-15 分钟 flush，避免长时间不可查询。
- manifest 先 pending，R2 put 成功后 complete。
- DeleteObject 免费，但清理前不要执行不必要的 Head/Get/List。

## 11. Retention Worker

### 11.1 为什么需要独立 Worker

- 每个 workspace 保留期不同，R2 bucket lifecycle 只能按 prefix/age 配置，最多 1000 rules，不适合作为无限 workspace 的动态策略引擎。
- D1 rollup、events、soft deletes 和 R2 manifest 必须一致推进。
- 独立 Worker 可以限制 CPU、批次、日志和部署权限，不把维护逻辑放进 web 请求。

### 11.2 调度

- 每小时运行轻量过期扫描。
- 每日运行 raw/R2 清理。
- 每周运行 manifest 校验和孤儿对象审计。
- Cron 使用 UTC，执行至少一次，所有动作幂等。

### 11.3 批处理

- 每个 invocation 有最大 workspace 数、rows、objects 和 wall time。
- 使用 `retention_runs.cursor_json` 恢复。
- R2 delete 使用批量 API 能力时仍记录每个 manifest 结果。
- 先把 manifest 标为 `delete_pending`，删除成功后标 `deleted`。
- 对 pending 超时 object 进行补偿，不立即假定数据丢失。

## 12. Analytics Engine 使用边界

可以写入：

- Worker route latency 和 result code。
- Queue lag、batch size、retry count。
- D1/R2 operation estimate。
- Agent version/capability 的聚合，不带可识别 payload。

禁止作为：

- 机器/容器原始时序权威存储。
- 服务检查结果唯一存储。
- 需要在 7/30 天精确删除的数据。

原因是数据固定保留三个月且不能按 workspace 主动删除。

## 13. HTTP 与 WebSocket 成本取舍

Cloudflare Workers 对 WebSocket 只对初始 Upgrade 计 request，消息不计 request；Durable Objects Hibernation 也能减少 idle duration 成本。但 V1 仍选择 HTTPS/HTTP2：

- Agent 每 30-60 秒才有数据，非亚秒实时场景。
- HTTP 无常驻连接状态，NAT、代理、休眠和网络切换恢复更简单。
- report response 可以同时完成 command/config pull，无额外 polling request。
- Workers request overage 仅 0.30 USD/million，1000 Agent/60 秒示例中约 9.96 USD。
- WebSocket 若用于双向路由通常需要 Durable Object 协调、连接迁移和更多故障状态。

未来出现低延迟控制或高频数据需求时，再用真实负载对 Hibernation WebSocket 进行 A/B 成本测试。

## 14. 中央检查预算

每个 Cloudflare HTTP/TCP 检查都会消耗 scheduler/queue/executor 使用量。Workspace 必须有：

- 最短 60 秒 centralized interval。
- 每日最大 check executions。
- HTTP response body 上限。
- TCP timeout 和并发上限。
- 预算预测：`checks * 2,592,000 / interval`。

需要 5-30 秒周期的检查优先交给 Agent，不让一分钟 Cron 模拟不可靠的子分钟调度。

## 15. 成本护栏

管理后台系统设置展示：

- 当前 Agent 数和 report interval。
- 预测 Workers requests、Queue operations、D1 writes、R2 puts/storage。
- 本月实际 Cloudflare 指标或用户填入的 usage snapshot。
- 70%、85%、100% 预算阈值。
- Top workspace/resource 贡献者。

自动保护动作只能在管理员启用后执行，例如延长非故障 report interval 或降低 raw retention。禁止在没有审计和通知的情况下静默丢数据。

## 16. 成本回归检查

任何修改以下路径的 PR 必须附成本差异：

- report interval 或 batch size。
- Queue message fan-out。
- D1 index 或高频写入。
- R2 object flush 策略。
- centralized check interval。
- public status polling/cache。

至少运行 100、1000、10000 Agent 三档模型，并注明消息大小、重试率、索引倍数和保留期假设。
