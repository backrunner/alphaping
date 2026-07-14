# AlphaPing 系统架构

## 1. 架构目标

- 控制面完全运行在 Cloudflare Developer Platform。
- Agent 数据面使用 Rust，控制资源消耗并共享协议实现。
- 按独立部署单元拆分 Worker，但通过明确的数据所有权共用 D1、R2 和 Queues。
- 高频遥测不直接形成大量 D1 时序行或 R2 小对象。
- 公共状态页、登录控制台和 Agent API 使用不同入口和权限边界。
- 所有后台处理都能应对至少一次投递、重复 Cron 和部分失败。

## 2. 系统上下文

```text
Browser
  |
  v
SvelteKit Web Worker ----------------------+
  | Better Auth / RBAC / admin API         |
  |                                        |
  +---------- D1 <-------------------------+------------------+
  |          config, auth, latest, rollup, events             |
  |                                                           |
  +---------- R2 <--------------------------------------------+
             raw telemetry blocks, exports, public snapshots  |

Rust Agent -- TLS 1.3 + encrypted protobuf --> Rust Ingest Worker
                                                   |
                                                   +--> D1 auth/replay/config
                                                   +--> Telemetry Queue
                                                             |
                                                             v
                                                  Rust Telemetry Worker
                                                   | latest/rollup/events
                                                   +--> D1
                                                   +--> R2 immutable blocks

Cron --> Check Scheduler --> Check Queue --> Check Executor
          | Agent assignments                 | HTTP/TCP
          +--> D1 config revisions            +--> result queue

Cron --> Retention Worker --> D1/R2 cleanup and compaction
```

## 3. Monorepo 布局

```text
alphaping/
├── apps/
│   └── web/                         # SvelteKit control plane and status pages
├── workers/
│   ├── ingest/                      # Rust public Agent API
│   ├── telemetry/                   # Rust queue consumer and time-series writer
│   ├── check-scheduler/             # TypeScript due-task scheduler
│   ├── check-executor/              # TypeScript HTTP/TCP queue consumer
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
| `web` | TypeScript/Svelte | `apps/web` | HTTP | D1 配置、权限、事件管理 |
| `ingest` | Rust/Wasm | `workers/ingest` | Agent HTTP | D1 replay/config，Telemetry Queue |
| `telemetry` | Rust/Wasm | `workers/telemetry` | Queue batch | D1 latest/rollup/event，R2 raw block |
| `check-scheduler` | TypeScript | `workers/check-scheduler` | Cron 每分钟 | D1 lease/next run，Check Queue |
| `check-executor` | TypeScript | `workers/check-executor` | Queue batch | Check Result Queue 或 D1 结果入口 |
| `retention` | TypeScript | `workers/retention` | Cron | D1/R2 删除、manifest、run log |

可选的 notification Worker 延后到 V1.x，不在 V1 提前创建空服务。

## 5. Cloudflare 绑定

### 5.1 共享资源

- `DB`: 一个 workspace-aware D1 database。
- `TELEMETRY_BUCKET`: 原始时序块、导出和快照。
- `TELEMETRY_QUEUE`: ingest 到 telemetry consumer。
- `CHECK_QUEUE`: scheduler 到 centralized executor。
- `CHECK_RESULT_QUEUE`: centralized executor 到 telemetry/result processor。
- `WORKER_ANALYTICS`: 只记录平台运行指标，不记录需要按租户保留期删除的原始遥测。

### 5.2 服务绑定

- Worker 间同步调用优先使用 service binding，不通过公开 URL。
- `web` 不直接调用 ingest。
- `check-executor` 的结果可以进入 queue，不通过 web API 回写。
- 只有 `web` 和 `ingest` 需要公开路由。后台 Worker 关闭 `workers_dev` 和 preview URL。

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
3. Ingest 在 D1 事务中消费 token，创建 agent identity、key epoch 和 config revision。
4. Ingest 在 PQ hybrid TLS 内返回应用层数据密钥和服务端配置。
5. Agent 安全保存 identity、数据密钥、key epoch 和 sequence 状态。

### 6.2 Agent report

1. Agent 将多个 sample 和任务结果编码为 Protobuf。
2. Agent 压缩 payload，使用 AES-256-GCM 加密并提交到 ingest。
3. Ingest 校验 Agent、key epoch、AAD、sequence、时间和大小。
4. Ingest 解密、做最小 schema 验证，并将规范化 batch 写入 Telemetry Queue。
5. Ingest 响应当前 config revision、待执行命令和可选 key rotation。
6. Telemetry consumer 批量更新 D1 latest/rollup/event，并将多个 report 合并为一个 R2 object。

### 6.3 Dashboard read

1. SvelteKit server loader 解析 session 和 workspace。
2. authz service 生成允许的 resource scope。
3. repository 使用 workspace 和 resource scope 查询 D1 latest/rollup。
4. 默认页面只返回概览和最新态。用户展开图表后才查询 rollup 或 R2 raw API。
5. 浏览器使用 15-30 秒自适应 polling、ETag 和页面可见性暂停刷新。V1 不建立 dashboard WebSocket。

### 6.4 Service checks

1. Cron 每分钟唤醒 scheduler。
2. Scheduler 按 `next_run_at` 索引加载到期任务，并用 lease/claim token 幂等占用。
3. Cloudflare HTTP/TCP 任务进入 Check Queue。
4. Agent 任务写入对应 machine 的 config revision，由 Agent 下次 report 拉取。
5. Executor 或 Agent 产生统一 `CheckResult`，进入结果处理链路。
6. Processor 更新 check latest、time bucket、服务状态和 incident 事件。

### 6.5 Retention

1. Cron 加载启用的 retention policy 和上次游标。
2. 每次只处理有界 workspace/resource/time 范围。
3. 先删除或压缩 D1 rollup/event，再按 manifest 删除 R2 objects。
4. R2 delete 免费，但 list/read/write 会计费，因此禁止全 bucket list。
5. 成功后提交游标。失败时保留 lease 超时，后续运行可重试。

## 7. 一致性模型

- 配置和权限：D1 事务内强一致。
- Agent 最新状态：最终一致，目标延迟不超过一个 report interval 加 15 秒。
- 原始历史：Queue 至少一次，使用 report ID/sequence 幂等去重。
- 服务状态：由不可变结果事件重算，允许短暂延迟，不允许直接由浏览器推断。
- 公告可见性：查询时检查 `starts_at/expires_at`，不依赖物理清理时间。

## 8. 表所有权

共享 D1 不代表任意服务可以写任意表：

- `web`: auth、workspace、membership、dashboard、resource policy、machine/service configuration、incident content。
- `ingest`: enrollment consumption、agent key metadata、replay cursor、config acknowledgement。
- `telemetry`: latest state、rollup、check result、state transition event、R2 manifest。
- `check-scheduler`: schedule lease、next run、execution claim。
- `retention`: retention cursor、soft-delete finalization、manifest deletion state。

跨所有权写入必须通过共享 domain package 中的命令函数或 service/queue contract，不允许复制 SQL。

## 9. 扩展策略

- 单个 D1 达到容量或区域需求前，不做数据库分片。
- workspace ID 已存在于所有主键和对象前缀，未来可按 workspace 迁移到独立 D1/R2。
- 中央检查需要子分钟调度时，再引入 Durable Objects alarms，不在 V1 为所有检查支付状态协调成本。
- 需要 dashboard 亚秒实时性时，再评估 Durable Objects WebSocket Hibernation。
- Analytics Engine 只用于无需租户自定义删除的运维指标，不能替代 D1/R2 权威数据。

## 10. 故障与降级

- D1 暂时失败：ingest 返回可重试错误，Agent 保留本地 batch。
- Queue 写入失败：ingest 不确认 report，Agent 使用同一 report ID 重试。
- Telemetry consumer 部分失败：只 ack 已完成的消息，写入使用幂等键。
- R2 写入失败：D1 manifest 不标记 complete，消息重试不会产生重复可见对象。
- Scheduler 重复执行：claim token 和 lease 阻止重复逻辑副作用。
- Web 读取失败：公开状态页可以返回带时间戳的最近快照，管理操作不得假成功。

## 11. 架构禁止项

- 不允许 Agent 直接访问 D1、R2 或 Cloudflare API。
- 不允许将 enrollment token 当作长期 API key。
- 不允许每个 sample 写一个 R2 object。
- 不允许把所有历史 sample 逐行写入 D1。
- 不允许使用 module global mutable state 保存请求或租户状态。
- 不允许通过 public HTTP 完成可以使用 service binding/queue 的内部调用。
- 不允许在 SvelteKit 浏览器代码中执行权限判定或持有 Agent secret。
