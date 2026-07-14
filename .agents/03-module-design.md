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
├── queue/
├── limits/
└── error.rs
```

职责：

- 严格 content type 和 body size。
- token/agent/key lookup。
- AEAD decrypt 和 replay/time validation。
- protobuf decode 与字段上限验证。
- queue publish。
- 在 report response 中返回 revision、commands 和 key rotation。

禁止执行 rollup、状态页查询和复杂历史写入。

## 7. `workers/telemetry`

- 消费 Telemetry Queue 和 Check Result Queue。
- 使用 `report_id`、`agent_id`、`key_epoch`、`sequence` 形成幂等键。
- 对 batch 内 sample 计算 latest 和 5 分钟聚合。
- 状态机生成 machine/service transition events。
- 将多个 queue message 合并为单个 R2 immutable block，目标 object 256 KiB 到 4 MiB。
- 写入 R2 成功后才提交 complete manifest。
- 单批失败隔离到 message，避免一个坏 payload 阻塞整个 batch。

## 8. `workers/check-scheduler`

- Cron 每分钟执行。
- 查询 `next_run_at <= now` 且 lease 可用的任务。
- 使用原子条件 update 领取 lease，生成 deterministic execution ID。
- Agent 任务写入 assignment/config revision。
- Cloudflare 任务写入 Check Queue。
- 根据固定周期计算下一次 nominal run，避免执行延迟累积漂移。
- 限制每次扫描和 dispatch 数量，通过游标继续。

## 9. `workers/check-executor`

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
- `r2-manifest-pruner`
- `soft-delete-finalizer`
- `compactor`
- `run-recorder`

每个动作接收 batch limit、deadline 和 cursor。运行接近 wall/CPU budget 时主动保存游标退出。

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

### 11.2 本地 spool

- 使用 append-only segments 或轻量 SQLite，设置总字节上限和最旧数据淘汰。
- 每条 batch 有 report ID 和 sequence。
- 只有服务端确认后删除。
- 队列满时优先保留状态转换、check failure 和较新的聚合，丢弃最旧高频 sample。

### 11.3 Container adapters

- `docker`: Docker Engine API，优先已有 context/socket。
- `colima`: 发现 profile 和 runtime，Docker 使用 Engine API，containerd 使用受限 CLI/API 适配。
- `apple-container`: 检测 macOS 26 Apple silicon 和 `container` service，使用官方 CLI/API 的结构化输出。
- adapter 返回统一模型和可诊断错误，不把权限不足变成空列表。

## 12. 安装器

- Shell installer 识别 OS、arch、init system，下载对应 release artifact。
- PowerShell installer 创建 Windows Service。
- 校验签名、hash、版本和下载长度后才安装。
- 默认配置目录与二进制目录分离，升级不覆盖 identity。
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
