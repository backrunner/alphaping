# AlphaPing 模块设计

## 1. 模块边界原则

- 一个模块只拥有一类业务变化原因。
- 路由、UI、领域逻辑、存储访问和平台绑定必须分层。
- Worker 入口只做适配和 orchestration，不包含大段 SQL 或状态机。
- 共享包提供稳定 contract，不通过深层相对路径跨服务导入内部实现。
- TypeScript 禁止 `any`，Rust production path 禁止 `unwrap()`/`expect()`。

## 2. `apps/web`

### 2.1 目录

```text
apps/web/src/
├── hooks.server.ts
├── lib/
│   ├── components/
│   │   ├── ui/                 # shadcn-svelte owned source
│   │   ├── dashboard/
│   │   ├── machines/
│   │   ├── services/
│   │   ├── status/
│   │   └── admin/
│   ├── server/
│   │   ├── auth/
│   │   ├── authz/
│   │   ├── db/
│   │   ├── services/
│   │   ├── public-projection/
│   │   └── validation/
│   ├── state/
│   ├── charts/
│   └── utils/
└── routes/
    ├── (setup)/setup/
    ├── (auth)/login/
    ├── (app)/[workspace]/
    ├── status/[slug]/
    └── api/
```

### 2.2 Server hook

`hooks.server.ts` 按顺序执行：

1. correlation ID 和安全 headers。
2. installation 状态检查。
3. Better Auth session 解析并填充 `event.locals`。
4. workspace context 解析。
5. Better Auth SvelteKit handler。

业务 route 不重复解析 cookie 或 session。

### 2.3 页面模块

- Dashboard：总览指标、动态模块导航、跨资源筛选。
- Machines：compact grid、机器详情、事件和配置。
- Services：服务列表、检查编辑器、断言 builder、状态历史。
- Status：游客投影、capsule timeline、incident timeline。
- Admin：用户、grant、机器 enrollment、保留策略、系统和 Agent 更新。
- Setup：环境检查、token、管理员、workspace 和默认设置。

### 2.4 服务端领域服务

- `installation-service`: 初始化状态和 setup transaction。
- `machine-service`: machine CRUD、token、revision、维护窗口。
- `service-monitor-service`: service/check/assertion CRUD 和状态规则。
- `incident-service`: incident 和 append-only updates。
- `access-service`: admin/member/guest 授权和 public projection。
- `retention-policy-service`: 校验保留期和估算成本。
- `agent-command-service`: 创建受限 command，不生成任意执行 payload。

所有 mutation 使用 Zod/Valibot 等 schema 验证，并在 service 层再次执行授权。

## 3. `packages/db`

- 唯一 Drizzle schema 来源。
- 提供 D1 migration，不允许应用启动时自动修改 schema。
- repository 按领域拆分，不导出裸 `db` 给 UI route。
- 常用查询必须有 query plan 测试和索引说明。
- Better Auth schema 与业务 schema 处于同一 migration 系列，避免双工具争夺 migration 顺序。
- 生成 auth schema 后必须人工审查，再转换为项目 migration。

## 4. `packages/authz`

核心接口示意：

```ts
type Capability = 'view' | 'manage';
type ResourceType = 'dashboard' | 'machine' | 'container' | 'service' | 'incident';

interface AuthorizationQuery {
  workspaceId: string;
  principal: AuthenticatedPrincipal | GuestPrincipal;
  capability: Capability;
  resource: { type: ResourceType; id: string };
}
```

模块提供：

- `authorize(query)`：单资源判定。
- `buildScope(...)`：构建列表查询可用的 resource scope。
- `projectPublicResource(...)`：生成游客可见字段，不能直接序列化内部 entity。
- deny precedence、容器继承和 admin bypass 的纯函数测试。

## 5. `proto` 与 `crates/protocol`

### 5.1 Canonical messages

- `EnrollmentRequest/Response`
- `ReportEnvelope`
- `ReportBatch`
- `MachineSample`
- `DiskSample`
- `NetworkSample`
- `RuntimeSnapshot`
- `ContainerCatalogEntry`
- `ContainerSnapshot`
- `CheckResult`
- `AgentConfig`
- `AgentCommand`
- `CommandResult`

`.proto` 是 contract 单一来源。Rust 使用 prost 生成，TypeScript 只在测试、调试或必要 API 中生成。

### 5.2 兼容规则

- 不复用已删除 field number 或 field name，必须 `reserved`。
- 新字段默认 optional 或有可解释默认值。
- enum 第一个值为 `UNSPECIFIED = 0`。
- breaking change 提升 protocol major，并提供双版本过渡。
- envelope 版本和 protobuf message 版本分离。

## 6. `workers/ingest`

### 6.1 路由

- `POST /v1/enroll`
- `POST /v1/report`
- `POST /v1/command-result`
- `GET /healthz`

不提供浏览器管理 API。

### 6.2 内部分层

```text
src/
├── lib.rs
├── routes/
├── auth/
├── envelope/
├── replay/
├── config/
├── telemetry/
├── limits/
└── error.rs
```

职责：

- 严格 content type 和 body size。
- token/agent/key lookup。
- AEAD decrypt 和 replay/time validation。
- protobuf decode 与字段上限验证。
- 使用稳定 report ID/hash 幂等 UPSERT `TELEMETRY_DB` 5 分钟 block 的 nominal minute slot。
- 在同一 D1 batch/transaction 中更新 replay cursor、latest、已闭合 rollup 和状态事件。
- 在 report response 中返回 revision、commands 和 key rotation。

关键遥测必须在响应前完成 D1 持久化，禁止用 `waitUntil()` 延后写入。Ingest 不提供 dashboard/历史查询，也不执行大范围历史重算。

## 7. 遥测存储模块

- 代码位于 `workers/ingest/src/telemetry` 与 `packages/db` 的 telemetry repository，V1 不部署独立 Telemetry Worker。
- `telemetry_blocks_5m` 每行提供 5 个固定分钟 slot；每个 60 秒 report 写一个 slot，完整保存 6 个 10 秒 sample。
- latest 和 5m/1h rollup 服务常用查询；raw API 解码 block slots 还原所有 10 秒点。
- 采用按 resource/time 排序的 `WITHOUT ROWID` 复合主键，不为高频 raw/latest 列添加二级索引。
- 正常路径在 block 闭合时生成一条 5m rollup；迟到补报只重算受影响的 bucket。
- 容器目录只在发现变化时写关系行；容器当前快照存在 machine latest payload，避免每容器每分钟写行。

## 8. `workers/live`

- TypeScript Worker + SQLite-class Durable Object，使用 Hibernation WebSocket API。SQLite class 只是 DO 创建要求，不把 live snapshot 写入 storage。
- 入口 Worker 在进入 DO 前验证 Upgrade、ticket envelope、body/query 上限和基本路由。
- Agent credential 由 Rust Ingest 放入加密 durable ACK：10 分钟槽内 session ID/key/nonce prefix 保持稳定，ticket 最长 15 分钟有效且不包含 session key 或 ARS。
- Viewer ticket 由 Web 按 RBAC/公开投影签发，最长 5 分钟，包含允许的 resource PK/topic 和 projection profile。
- Socket attachment 仅保存身份、角色、ticket expiry 和必要 session metadata，严格低于 16,384 bytes。
- 不使用 `setInterval`/周期 alarm，不阻止 hibernation。Protocol ping/pong 由 runtime 自动处理。
- 第一个 viewer 进入时发 `LIVE_DEMAND_ON`，最后一个 viewer 离开时发 `LIVE_DEMAND_OFF`；demand 自带 TTL，Agent 不依赖 close event 才停止。
- Live frame 最多 16 KiB，使用 live-specific AES-256-GCM 和 20 秒 freshness window；Agent 在 SQLite transaction 中按 session 持久化并预占 sequence 后才加密，只广播不写 D1/DO storage。
- 当前快照可在内存丢失；viewer 连接后最多等一个 10 秒帧，期间使用 D1 latest。这是对“persist first”的明确非权威例外。
- DO 按 workspace 命名；超过 500 connections 后才按 stable shard 拆分，不使用全局单例。

## 9. `workers/checks`

- Cron 每分钟执行。
- 30 台规模直接读取 enabled task，按 interval/phase 计算当前 nominal slot；读取额度远大于写入额度。
- 使用 `UPDATE ... WHERE last_claimed_slot < ?` 原子领取 due task 并生成 deterministic execution ID。
- 不维护高频变化的 `next_run_at` 索引；超过 500 个 central check 后才评估稳定 schedule bucket/shard。
- Agent 任务写入 `assignment_revision`；机器 `desired_config_revision` 在创建或重指派时单调递增。
- Rust Ingest 仅在 desired 高于 Agent 回报的 applied revision 时构建最多 32 个任务的完整 protobuf snapshot，展开 secret 后放入已认证的 s2c ACK。Agent 验证 revision、created time、完整内容 digest 和字段上限，SQLite commit 后才切换 scheduler。
- Cloudflare HTTP/TCP 任务在同一 Cron invocation 内以最多 5 并发有界执行，30 台目标规模不使用 Queue。
- 结果以 D1 batch 写入 `check_result_blocks_5m` slot、`check_latest`、已闭合 rollup 和状态事件。
- 以固定 epoch、interval 和 phase 计算 nominal slot，避免执行延迟累积漂移。
- 限制每次扫描和执行数量，通过游标继续。

### 9.1 HTTP executor

- 使用 `fetch`，有绝对 timeout、redirect 上限和 response body 上限。
- 禁止访问 localhost、link-local、metadata IP 和私网地址，除非未来增加明确的私网产品能力。
- 敏感 header 只在内存中从 secret reference 展开，不写日志。
- JSONPath、header 和 status assertion 使用结构化 evaluator。

### 9.2 TCP executor

- 使用 `cloudflare:sockets` 出站 `connect()`。
- 每个 invocation 同时连接数不得超过平台限制，并设置自己的更低并发上限。
- 支持 connect、可选 TLS/startTLS 和有限 payload exchange。
- 不支持 ICMP，不显示伪造的 ping 时间。

## 10. `workers/retention`

模块：

- `policy-loader`
- `d1-pruner`
- `artifact-pruner`
- `soft-delete-finalizer`
- `compactor`
- `run-recorder`

每个动作接收 batch limit、deadline 和 cursor。Cron 使用确定性 scheduled run ID；workspace 先取得 15 分钟 lease，防止重叠执行。资源 DELETE 删满一批时 cursor 停在当前资源之前，只有确认该资源没有剩余过期行才前进。CONTROL_DB 中近期到期 Agent command 转为 `expired`，超过 30 天审计窗口的 terminal/未送达命令直接分批删除，公告在失效 7 天后物理删除。运行接近 wall/CPU budget 时主动保存游标退出。

## 11. `crates/agent`

```text
src/
├── main.rs
├── config/
├── identity/
├── sampler/
│   ├── cpu.rs
│   ├── memory.rs
│   ├── disk.rs
│   └── network.rs
├── probes/
│   ├── icmp.rs
│   ├── tcp.rs
│   └── http.rs
├── containers/
├── transport/
├── spool/
├── updater/
├── service/
└── observability/
```

### 11.1 Runtime

- Tokio current-thread runtime 为默认，只有需要时使用有限 worker threads。
- 采样、probe 和 upload 使用独立有界 channel，防止慢网络阻塞采样。
- 所有周期加入随机抖动，避免大量 Agent 同时请求。
- 动态配置通过 revision 原子替换，失败时继续使用 last-known-good。
- Agent probe 按 epoch/interval/phase 对齐，最多 32 个任务、4 个并发；HTTP/TCP/ICMP 均有绝对 timeout 和 payload/response 上限。
- 5/10 秒 probe observation 逐条先写本地 SQLite；durable report 按 check/minute 批量携带，D1 仍只写一个固定 minute slot，不能为了秒级周期把写入放大 6-12 倍。

### 11.2 本地 spool

- 固定使用 SQLite WAL，每个 sample/check event 先 commit 后才视为已采集。
- 每条 batch 有 report ID 和 sequence。
- 只有服务端返回经认证的 D1 durable ACK 后删除。
- 临时失败无限重试，equal-jitter 指数退避从 1 秒起且永不超过 300 秒。
- 默认 512 MiB 上限，并保留 256 MiB 或磁盘 5% 空闲；按 70/85/95% 阈值聚合未尝试的低优先级数据。
- 已尝试 delivery 不因 attempt count 或普通保留期删除，硬容量不足时必须记录 DataGap。

### 11.3 Container adapters

- `docker`: Docker Engine API，优先已有 context/socket。
- `colima`: 发现 profile 和 runtime，Docker 使用 Engine API，containerd 使用受限 CLI/API 适配。
- `apple-container`: 检测 macOS 26 Apple silicon 和 `container` service，使用官方 CLI/API 的结构化输出。
- adapter 返回统一模型和可诊断错误，不把权限不足变成空列表。

## 12. 安装器

- Shell installer 识别 OS、arch、init system，下载对应 release artifact。
- PowerShell installer 创建 Windows Service。
- 安装脚本由 control-plane origin 提供，并从同一 origin 获取固定 release manifest；校验下载长度、SHA-256 和二进制自报版本后才安装，GitHub 只承载 versioned artifact。
- 默认配置目录与二进制目录分离，升级不覆盖 identity。
- Linux 使用 `/opt/alphaping/bin` + systemd，macOS 使用 `/Library/Application Support/AlphaPing` + LaunchDaemon，Windows binary 的 `service` 子命令实现 SCM ServiceMain。
- 卸载默认保留 identity 需显式选择，完全卸载才撤销并删除。
- 安装 token 可能出现在命令历史，因此短时、一次性并允许立即撤销。

## 13. API 设计

- 浏览器管理 API 使用 JSON，错误采用稳定 `code` + 本地化 message key。
- Agent API 使用 `application/x-protobuf` 外层二进制 envelope。
- 时间统一使用 Unix milliseconds 或 protobuf Timestamp，文档必须明确。
- 字节量使用 `uint64`，速率使用 bytes per second。
- 百分比在协议中用 basis points 或明确范围的整数，避免浮点跨语言歧义。
- 所有 list API 使用 cursor pagination。

## 14. 测试模块

- `packages/testkit`: D1 fixture、fake auth principal、fake clock、public projection snapshot。
- Rust protocol golden vectors：正常、旧版本、未知字段、错误 nonce、重放和尺寸边界。
- Worker integration：Miniflare/Wrangler 本地绑定和 queue/cron handler。
- Agent integration：fake ingest server、网络中断、spool、更新回滚。
- Browser E2E：setup、添加机器、权限、服务检查、incident 和游客状态页。

## 15. 文件规模约束

- Svelte component 超过约 250 行时评估拆分 view model、子组件或 schema。
- TypeScript/Rust 模块超过约 400 行时评估按职责拆分，测试 fixture 除外。
- 不以行数机械拆分，但禁止 route、Worker entrypoint 或 `main.rs` 成为业务逻辑容器。
- 公共 helper 必须有明确领域名称，禁止 `utils.ts`/`helpers.rs` 无边界膨胀。
