# AlphaPing 系统架构

## 1. 架构目标

- 控制面完全运行在 Cloudflare Developer Platform。
- Agent 数据面使用 Rust，控制资源消耗并共享协议实现。
- 按独立部署单元拆分 Worker，通过 `CONTROL_DB` 和 `TELEMETRY_DB` 两个 D1 binding 共享逻辑数据并隔离负载。
- 持久遥测按 60 秒 report 写入 D1 5 分钟 block 的固定 slot，完整 payload 可查询，避免每个 10 秒 sample 形成独立写入。
- 机器 dashboard 在有 viewer 时通过 Durable Object Hibernation WebSocket 获得不高于 10 秒的 live snapshot，D1 仍是权威持久回退。
- 公共状态页、登录控制台和 Agent API 使用不同入口和权限边界。
- 所有后台处理都能应对至少一次投递、重复 Cron 和部分失败。

## 2. 系统上下文

```text
Browser
  | HTTP/admin                    | live WebSocket
  v                               v
SvelteKit Web Worker          Live Worker --> Workspace Live Hub DO
  | Better Auth / RBAC / admin API         |
  |                                        |
  +---------- CONTROL_DB <-----------------+------------------+
  |          auth, RBAC, config, incidents                    |
  +---------- TELEMETRY_DB <----------------------------------+
  |          report blocks, latest, rollup, events            |
  |                                                           |
  +---------- R2                                              |
             explicit exports and backups only                |

Rust Agent -- TLS 1.3 + encrypted protobuf --> Rust Ingest Worker
                                                   |
                                                   +--> D1 transaction
                                                        raw block/latest/rollup
                                                   +--> encrypted durable ACK

Rust Agent -- live-specific AEAD WebSocket --> Live Worker / Hub DO
              10s snapshot only while viewers subscribe

Cron --> Checks Worker --> HTTP/TCP targets
          | CONTROL_DB schedule/claim
          +--> TELEMETRY_DB check batches/latest/rollup

Cron --> Retention Worker --> bounded D1 cleanup and compaction
```

## 3. Monorepo 布局

```text
alphaping/
├── apps/
│   └── web/                         # SvelteKit control plane and status pages
├── workers/
│   ├── ingest/                      # Rust public Agent API
│   ├── live/                        # TypeScript Hibernation WebSocket/DO
│   ├── checks/                      # TypeScript scheduled HTTP/TCP checker
│   └── retention/                   # TypeScript scheduled cleanup worker
├── crates/
│   ├── agent/                       # Installed Rust service
│   ├── protocol/                    # prost messages and envelope validation
│   ├── crypto/                      # key envelope, nonce and replay primitives
│   └── runtime-adapters/            # Docker/Colima/Apple container adapters
├── packages/
│   ├── db/                          # Drizzle schema, migrations, repositories
│   ├── authz/                       # shared server-side authorization policy
│   ├── contracts/                   # TypeScript API and generated protobuf types
│   ├── ui/                          # owned shadcn-svelte/Bits UI components
│   ├── config/                      # shared lint/tsconfig/tokens
│   └── testkit/                     # fixtures, fake clock, Worker/Agent harness
├── proto/                           # canonical .proto source
├── scripts/                         # setup, deployment, release and verification
├── tooling/                         # build images and CI helpers
├── turbo.json
├── pnpm-workspace.yaml
└── Cargo.toml                       # Cargo workspace
```

Turbo 负责 JavaScript/TypeScript 任务图，并通过每个 Rust deployable 目录中的轻量 `package.json` 调用 Cargo。Cargo workspace 负责 Rust crate 依赖、测试和 release profile。禁止用 Turbo 替代 Cargo 的依赖图。

## 4. 部署单元

| 服务 | 语言 | 入口 | 触发方式 | 主要写入 |
| --- | --- | --- | --- | --- |
| `web` | TypeScript/Svelte | `apps/web` | HTTP | CONTROL_DB 配置/权限，TELEMETRY_DB 查询 |
| `ingest` | Rust/Wasm | `workers/ingest` | Agent HTTP | TELEMETRY_DB replay/raw/latest/rollup，CONTROL_DB config read |
| `live` | TypeScript | `workers/live` | Agent/browser WebSocket | 无权威存储；DO socket attachment 只保存连接身份/session |
| `checks` | TypeScript | `workers/checks` | Cron 每分钟 | CONTROL_DB `last_claimed_slot`，TELEMETRY_DB check result/rollup 与机器离线事件 |
| `retention` | TypeScript | `workers/retention` | Cron | TELEMETRY_DB 分批删除、cursor、run log |

Ingest 暴露不访问 D1 的 `GET|HEAD /healthz` liveness。数据库读写健康由独立的合成 enrollment/report smoke test 判断，避免健康检查增加 D1 请求或因依赖抖动触发级联重启。

可选的 notification Worker 延后到 V1.x，不在 V1 提前创建空服务。

## 5. Cloudflare 绑定

### 5.1 共享资源

- `CONTROL_DB`: Better Auth、workspace、RBAC、machine/service config、Agent keys 和 incident 内容。
- `TELEMETRY_DB`: replay state、report/check blocks、latest、rollup、status buckets/events 和 retention state。
- `LIVE_HUBS`: 按 workspace deterministic name 路由的 Hibernation Durable Object binding。
- `EXPORT_BUCKET`: 用户显式生成的导出和备份 artifact，不保存在线 telemetry。
- `WORKER_ANALYTICS`: 只记录平台运行指标，不记录需要按租户保留期删除的原始遥测。

### 5.2 服务绑定

- Worker 间同步调用优先使用 service binding，不通过公开 URL。
- `web` 不直接调用 ingest；它只签发短时 viewer ticket 并连接 live hub。
- `checks` Worker 直接读取 CONTROL_DB due tasks，以最多 5 并发执行后写入 TELEMETRY_DB，不通过 web API 回写。
- `web`、`ingest` 和 `live` 需要公开路由。Checks/retention 关闭 `workers_dev` 和 preview URL。

### 5.3 Wrangler 配置

- 每个 deployable 使用独立 `wrangler.<name>.toml`。
- 开源仓库只提交 `wrangler.<name>.template.toml`，真实配置被 gitignore。
- 生产环境名称固定为 `alphaping-<name>-production`。
- secret 通过 `wrangler secret` 或 Secrets Store 配置，禁止写入 `[vars]`。
- 新项目 compatibility date 使用实施当天日期，并由季度维护任务评估升级。

## 6. 核心数据流

### 6.1 Agent enrollment

1. Web 创建 machine 和一次性 token，只保存 token 校验值。
2. Agent 连接 ingest，提交 token、设备 identity public key、平台和协议能力。
3. Ingest 在 CONTROL_DB 事务中消费 token，创建 agent identity、key epoch 和 config revision。
4. Ingest 在 PQ hybrid TLS 内返回应用层数据密钥和服务端配置。
5. Agent 安全保存 identity、数据密钥、key epoch 和 sequence 状态。

### 6.2 Workspace invitation

1. Workspace admin 创建带邮箱和角色约束的高熵一次性邀请，Web 只保存域分离 HMAC digest。
2. 邀请链接只展示掩码邮箱；已有账号必须登录同一邮箱，新账号只能通过有效邀请创建 credential。
3. 接受邀请在一个 D1 batch 中领取邀请、创建或绑定 membership 并写审计记录；并发或重放只有一次成功。
4. Better Auth 公共注册保持关闭，普通 `/api/auth/sign-up` 不能绕过邀请。

### 6.3 Agent report

1. Agent 将多个 sample 和任务结果编码为 Protobuf。
2. Agent 压缩 payload，使用 AES-256-GCM 加密并提交到 ingest。
3. Ingest 校验 Agent、key epoch、AAD、sequence、时间和大小。
4. Ingest 解密并验证 schema，在一个 TELEMETRY_DB transaction/batch 中写 replay state、UPSERT `telemetry_blocks_5m` 的 nominal minute slot、条件更新 latest，并写入已关闭的 rollup/event。
5. TELEMETRY_DB 完成持久化后，Ingest 从 CONTROL_DB 读取 config/commands 并返回加密 durable ACK。控制面暂时不可读时仍可 ACK 已持久化的 report，并让 Agent 下次继续拉取配置。
6. ACK 丢失时 Agent 使用稳定 report ID 重试，同一 block/slot 的 report ID/hash 校验返回 duplicate 而不重复追加。

### 6.4 Live machine snapshot

1. Ingest 在已认证、加密的 durable report 响应中下发短时 live credential。Agent session 按 10 分钟槽稳定派生，ticket 最长 15 分钟有效；ticket 只含 session ID/nonce prefix 等验证信息，32-byte live key 只存在加密 ACK 内，不暴露 ARS。
2. Agent 用 ticket 连接 `live` Worker，路由到 workspace Live Hub DO。Viewer 使用 `web` 按 RBAC/公开投影签发的 5 分钟 ticket 连接同一 hub。
3. 没有 viewer 时 Agent 不发应用 live frame；有 viewer 时 hub 下发 30 秒 TTL demand，viewer 每 15 秒刷新，Agent 每 10 秒发送一个 AES-GCM live snapshot。
4. Hub 只广播给 ticket 授权的 viewer。Live frame 不写 D1/DO SQLite、不产生 durable ACK、不从 Agent spool 删除 sample。
5. Hub 被驱逐、WebSocket 中断或 20 秒没有新帧时，Dashboard 标记 live degraded，并使用带 ETag 的 30 秒 D1 latest polling；Agent 的 60 秒 durable report 不受影响。

### 6.5 Dashboard read

1. SvelteKit server loader 解析 session 和 workspace。
2. authz service 生成允许的 resource scope。
3. repository 从 CONTROL_DB 获得 resource scope，再以允许的 integer resource PK 查询 TELEMETRY_DB latest/rollup。
4. 默认页面只返回概览和 D1 latest。用户展开图表后才查询 TELEMETRY_DB rollup 或 bounded block rows；raw API 解码 slots 还原 10 秒 samples。
5. 浏览器在页面可见时建立 live WebSocket，正常延迟不高于一个 10 秒 sample interval。断线后使用带 ETag 的 30 秒 D1 polling，恢复后停止 fallback polling。

### 6.6 Service checks

1. Cron 每分钟唤醒 checks Worker。
2. 30 台目标规模下，Worker 读取少量 enabled task，根据稳定 interval/phase 计算 nominal slot。
3. 对 due task 使用 `UPDATE ... WHERE config_revision = ? AND last_claimed_slot < ?` 原子领取，避免为每分钟改变的 `next_run_at` 维护二级索引；执行结束后再次验证 revision/claim，配置替换期间的旧执行不得写成新配置的 latest。
4. V1 以最多 5 个并发直接执行 Cloudflare HTTP/TCP 任务；不为 30 台规模引入 Queue。
5. Agent 任务写入对应 machine 的 config revision，由 Agent 下次 report 拉取。
6. Checks Worker 或 Agent 产生统一 `CheckResult`，通过共享 domain repository 写入 TELEMETRY_DB。
7. 同一写入流程更新 check latest、time bucket、服务状态和 incident 事件。
8. 同一 Cron 以有界主键批次比较机器 `received_at` 和离线阈值；只在状态转换时条件更新 latest 并写确定性离线事件，不新增调度请求。
9. Web 的 check target/policy/delete/maintenance mutation 在同一 CONTROL_DB 事务写 `service_state_sync_jobs`。Web 立即尝试同步，Checks Worker 在检查执行结束后每分钟按 `next_attempt_at` 重放最多 50 个 due job，并在 15 分钟在途保护窗内重复校正；job 按中央检查 `config_revision` 删除迟到旧 latest。长维护窗口在保护窗结束后休眠到 `maintenance_until`，到期即使没有新检查结果也会重算服务状态；TELEMETRY_DB 短时失败不能丢失配置 mutation 或永久留下旧 service state。

### 6.7 Retention

1. Cron 加载启用的 retention policy 和上次游标。
2. 每次只处理有界 workspace/resource/time 范围。
3. 按复合主键范围分批删除 TELEMETRY_DB raw/rollup/event，DELETE rows 同样计入 D1 write cost。
4. 只对到期的 export/backup artifact 执行 R2 删除，不扫描 R2 查找 telemetry。
5. 成功后提交游标。失败时保留 lease 超时，后续运行可重试。
6. 软删除恢复窗口到期后，先按资源主键分批清空 TELEMETRY_DB；确认无剩余后再物理删除 CONTROL_DB 资源。删除 workspace 时先收敛全部子资源，最后删除 workspace summary/cursor 和控制面记录。

## 7. 一致性模型

- 配置和权限：CONTROL_DB 事务内强一致。
- Agent report、replay state、latest 和关闭的 rollup：同一 TELEMETRY_DB transaction/batch 完成后 ACK。
- 原始历史：Agent 至少一次投递，使用 block/slot 主键与 slot 内 report ID/hash 幂等去重。
- Live snapshot：非权威、可丢失、不持久；必须带 observed time，浏览器不能用它覆盖更新的 D1 数据。
- 服务状态：由不可变结果事件重算，允许短暂延迟，不允许直接由浏览器推断。
- 配置驱动的服务状态：CONTROL_DB job 是跨库同步的持久依据；job 只在保护窗结束、最后一次 TELEMETRY_DB 同步成功且 token 未被新 mutation 取代后删除。
- 公告可见性：查询时检查 `starts_at/expires_at`，不依赖物理清理时间。

## 8. 表所有权

共享 D1 不代表任意服务可以写任意表：

- `web`/CONTROL_DB: auth、workspace、invitation、membership、dashboard、resource policy、audit、machine/service configuration、incident content。
- `ingest`/CONTROL_DB: enrollment consumption、agent key metadata、config acknowledgement。
- `ingest`/TELEMETRY_DB: replay cursor、machine telemetry block/latest/rollup，以及新报告触发的恢复事件。
- `live`/DO: WebSocket 连接、非持久 snapshot broadcast 和 demand state；不写权威业务表。
- `checks`/CONTROL_DB: stable schedule config、`last_claimed_slot` execution claim 和通过共享 repository 消费 `service_state_sync_jobs`。
- `checks`/TELEMETRY_DB: centralized check result/latest/rollup/event，以及由缺少报告触发的机器离线转换。
- `retention`/TELEMETRY_DB: workspace lease、retention cursor、raw/rollup/event cleanup。
- `retention`/CONTROL_DB: 过期公告和 Agent command 状态/审计期清理。

跨所有权写入必须通过共享 domain package 中的命令函数或 service/queue contract，不允许复制 SQL。

## 9. 扩展策略

- TELEMETRY_DB 达到 8 GB、持续 overload 或预测含 margin 的月写入达到 40 million 时，启动数据库分片评估。
- workspace/machine integer PK 已存在所有时序行，未来可按 workspace 或 resource hash 迁移到独立 telemetry D1 database。
- 中央检查需要子分钟调度时，再引入 Durable Objects alarms，不在 V1 为所有检查支付状态协调成本。
- Live Hub 以 workspace 为 coordination atom；单 workspace 超过 500 connections 或基准 CPU 阈值时按 stable shard 拆分。
- Analytics Engine 只用于无需租户自定义删除的运维指标，不能替代 D1 权威数据。

## 10. 故障与降级

- CONTROL_DB 暂时失败：已有 key 的 report 仍可按安全缓存/绑定读取策略处理；无法认证时不 ACK，Agent 保留本地 batch。
- TELEMETRY_DB 暂时失败或 transaction 回滚：不返回 ACK，整个 batch 由 Agent 使用同一 report ID 重试。
- ACK 丢失：TELEMETRY_DB duplicate detection 后安全重放 ACK，不产生重复 telemetry。
- Live Hub 故障：Agent 保持 SQLite 采集和 durable report，Dashboard 降级到 D1 latest/polling，界面标记 live 已中断而不误报 machine offline。
- Scheduler 重复执行：确定性 nominal slot 和条件 claim update 阻止重复逻辑副作用。
- Web 配置已提交但 TELEMETRY_DB 同步失败：返回已成功的配置 mutation，保留同步 job 并记录 deferred 告警；Checks Worker 每分钟有界重试并覆盖 mutation 前已领取的迟到中央检查结果。
- Web 读取失败：公开状态页可以返回带时间戳的最近快照，管理操作不得假成功。

## 11. 架构禁止项

- 不允许 Agent 直接访问 D1、R2 或 Cloudflare API。
- 不允许将 enrollment token 当作长期 API key。
- 不允许使用 R2 保存在线 telemetry 或要求 dashboard 扫描 object。
- 默认不把 report 内每个 10 秒 sample 拆成独立 D1 row；如启用 normalized-sample 模式，必须先通过成本和容量门禁。
- 不允许使用 module global mutable state 保存请求或租户状态。
- 不允许通过 public HTTP 完成可以使用 service binding/queue 的内部调用。
- 不允许在 SvelteKit 浏览器代码中执行权限判定或持有 Agent secret。
