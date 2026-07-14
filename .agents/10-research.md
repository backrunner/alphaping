# AlphaPing 调研记录

## 1. 调研方法

- 优先使用产品官方文档和标准组织资料。
- 数字、限制、价格和兼容性按 2026-07-15 核对。
- 本地 `../skillscat` 仅用于参考多 Worker 仓库组织和部署脚本，不复制其业务逻辑或 secret。
- 价格和平台能力会变化，实施和发布前必须再次核对。

## 2. Cloudflare 平台

### Workers pricing

来源：https://developers.cloudflare.com/workers/platform/pricing/

结论：

- Paid 最低 5 USD/月。
- 10 million requests 和 30 million CPU ms included。
- 超出 request 0.30 USD/million，CPU 0.02 USD/million ms。
- WebSocket 只对初始 Upgrade 计 request，消息不计 request。
- 静态资源请求免费。

影响：V1 使用低频 HTTP batch 足够经济，不因 request 单价提前引入 WebSocket 状态复杂度。

### Workers limits

来源：https://developers.cloudflare.com/workers/platform/limits/

结论：

- 每 isolate 128 MB memory。
- Paid HTTP CPU 上限可提高到 5 分钟，默认 30 秒。
- Cron/Queue invocation 最大 wall time 15 分钟。
- 每 invocation 同时等待的出站连接限制为 6。

影响：检查 executor 必须限制并发，Retention/Queue consumer 必须有 deadline 和 cursor。

### D1 pricing

来源：https://developers.cloudflare.com/d1/platform/pricing/

结论：

- Paid 含 25 billion rows read、50 million rows written、5 GB storage。
- index 写入会增加 rows written。
- 按行而非行大小计数。

影响：不逐 sample 写 D1；使用 latest、summary 和 5 分钟 rollup。

### R2 pricing

来源：https://developers.cloudflare.com/r2/pricing/

结论：

- Standard 10 GB-month、1 million Class A、10 million Class B included。
- Standard storage 0.015 USD/GB-month，Class A 4.50 USD/million。
- DeleteObject 免费，Internet egress 免费。
- Infrequent Access 有读取费和 30 天最短存储期。

影响：高频遥测必须批量形成较大 immutable object；短保留 raw 使用 Standard。

### R2 lifecycle

来源：https://developers.cloudflare.com/r2/buckets/object-lifecycles/

结论：

- lifecycle 可以按 prefix 和 age 删除/转层。
- rule 上限 1000，应用后删除通常在 24 小时内完成。

影响：可作为粗粒度兜底，不适合作为无限 workspace 自定义保留策略的唯一实现。

### Queues pricing

来源：https://developers.cloudflare.com/queues/platform/pricing/

结论：

- Paid 含 1 million operations，之后 0.40 USD/million。
- 小于 64 KB 的消息正常交付通常是 write/read/delete 三个 operations。
- 按 message 而非 batch 计费。

影响：Queue 是 1000 Agent 级别主要可变成本；report 要 batch 且保持 64 KB 内。

### Analytics Engine

来源：

- https://developers.cloudflare.com/analytics/analytics-engine/pricing/
- https://developers.cloudflare.com/analytics/analytics-engine/limits/

结论：

- 适合高 cardinality metrics，写入点和查询按次数计费。
- 文档说明当前尚未实际计费，但已公布未来价格。
- 数据固定保留三个月。

影响：只记录平台运维 metrics，不保存需要按 workspace 7/30 天删除的权威遥测。

### Rust Workers

来源：https://developers.cloudflare.com/workers/languages/rust/

结论：

- Cloudflare 官方通过 `workers-rs` 支持 Rust/Wasm。
- bindings 覆盖 D1、R2、Queues、service bindings 等。
- `event` macro 支持 fetch、scheduled 和 queue。
- release profile 和 wasm-opt 对 binary size/startup 重要。

影响：ingest 和 telemetry consumer 可以使用 Rust，并共享 prost/crypto crate。

### TCP sockets

来源：https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

结论：

- Workers 提供出站 TCP `connect()`。
- 不支持 inbound TCP，私网/localhost/Cloudflare IP 等目标受限。
- 每个 socket 计入同时出站连接限制。

影响：Cloudflare executor 可以做 TCP connect/有限协议检查，但不能承诺 ICMP Ping。

### Cron 和 Durable Objects alarms

来源：

- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/durable-objects/api/alarms/

结论：

- Cron 使用 UTC、分钟级表达式、在 underutilized machines 执行，配置传播可达 15 分钟。
- Alarms 支持更细粒度时间和至少一次执行，每个 Durable Object 一个 alarm。

影响：V1 central checks 最短 60 秒，Cron 每分钟扫描 due tasks。子分钟中央调度留到需要时再引入 DO。

### WebSocket Hibernation

来源：https://developers.cloudflare.com/durable-objects/best-practices/websockets/

结论：

- Hibernation 可在客户端保持连接时让 DO 休眠，休眠期间不累计 duration。
- 高频小消息仍有上下文切换开销，官方建议 batching。

影响：作为未来低延迟通道候选，不是 V1 默认 Agent transport。

## 3. Post-quantum security

### Cloudflare PQC overview/products/support

来源：

- https://developers.cloudflare.com/ssl/post-quantum-cryptography/
- https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-cloudflare-products/
- https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-support/

结论：

- Cloudflare visitor-to-edge TLS 1.3 支持 `X25519MLKEM768` hybrid key agreement。
- 该能力覆盖 Workers custom domains 和 `workers.dev`。
- rustls 0.23.27 起默认支持 PQ key agreement，rustls-post-quantum/aws-lc-rs 提供实现。
- visitor-to-edge PQ signatures 仍在规划，不能宣称完全 PQ authentication。

影响：Agent 默认强制 hybrid TLS；应用层使用 directional AES-256-GCM；对外准确描述 key agreement 与 signature 边界。

### NIST standards

来源：

- ML-KEM FIPS 203：https://csrc.nist.gov/pubs/fips/203/final
- ML-DSA FIPS 204：https://csrc.nist.gov/pubs/fips/204/final

影响：协议只采用标准算法命名，不使用旧 Kyber draft 名称作为新实现。

## 4. Web stack

### SvelteKit on Cloudflare

来源：

- https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/
- https://svelte.dev/docs/kit/adapter-cloudflare

结论：

- 使用 `@sveltejs/adapter-cloudflare` 构建 Workers Static Assets。
- `adapter-cloudflare-workers` 已 deprecated。
- bindings 通过 SvelteKit `event.platform` 提供，本地可由 platform proxy 模拟。

影响：Web 只面向 Cloudflare Worker，不维护 Node adapter 分支。

### Better Auth

来源：

- https://www.better-auth.com/docs/integrations/svelte-kit
- https://www.better-auth.com/docs/adapters/drizzle

结论：

- 使用 `svelteKitHandler` 挂载到 server hook。
- session 需要显式填入 `event.locals`。
- Server Action cookies 使用 `sveltekitCookies(getRequestEvent)`，要求兼容的 SvelteKit 版本。
- Drizzle adapter 使用 sqlite provider，并支持 schema generation/migration。

影响：Better Auth schema 纳入项目统一 D1 migration，不让运行时自动迁移。

### Drizzle D1

来源：https://orm.drizzle.team/docs/connect-cloudflare-d1

结论：Drizzle 官方支持 Cloudflare D1/Workers 和 D1 binding driver。

影响：schema/repository 放入 `packages/db`，业务 route 不直接访问裸 DB。

### UI primitives

来源：

- https://www.shadcn-svelte.com/docs/installation/sveltekit
- https://www.bits-ui.com/docs/introduction

结论：shadcn-svelte 提供 owned component source，Bits UI 提供 Svelte headless primitives。

影响：以 shadcn-svelte 组件源码为表层、Bits UI 为交互 primitive，统一 AlphaPing token，不引入第二视觉体系。

## 5. Agent 与容器

### Apple container

来源：https://github.com/apple/container

结论：

- Apple 官方 `container` 运行 OCI images，使用轻量 VM。
- 支持 macOS 26 和 Apple silicon。
- 项目 1.0 前 minor version 可能 breaking。

影响：Agent adapter 必须做 capability/version detection，不能假设稳定 Docker API 兼容。

### Colima

来源：https://github.com/abiosoft/colima

结论：Colima 支持 Docker、containerd 和 Incus，多 profile/runtime。

影响：先探测 profile/runtime；Docker 走 Engine API，containerd 使用独立适配，不把 Colima 等同于单一 socket。

### Docker Engine API

来源：

- https://docs.docker.com/engine/api/
- https://docs.docker.com/reference/api/engine/version-history/

结论：Docker Engine API 有版本协商和稳定的容器 list/inspect/stats 能力。

影响：Agent 使用 API version negotiation，默认只读 endpoints，并区分 permission denied 与 empty list。

## 6. Protocol 与更新

### Protocol Buffers proto3

来源：https://protobuf.dev/programming-guides/proto3/

结论：未知字段支持演进，已删除 field number/name 必须 reserve，低 field number 编码更紧凑。

影响：建立 protocol compatibility 和 breaking check，禁止复用字段。

### The Update Framework

来源：https://theupdateframework.io/specification/latest/

结论：TUF 的 root、timestamp、snapshot、targets、threshold 和 expiry 模型用于抵抗 key compromise、rollback 和 freeze。

影响：GitHub Releases 只做 artifact hosting，Agent 内置信任 root metadata。

## 7. 本地 Skillscat 参考

核对位置：`../skillscat`

观察到的可复用模式：

- 多个 `wrangler.<worker>.toml` 独立部署。
- `scripts/deploy-workers.mjs` 支持发现 Worker、按 name/all 部署和 dry-run。
- 真实 wrangler config 被 gitignore，提交 example/template。
- 后台 Worker 关闭 `workers_dev` 和 preview URL。
- Cron、Queue、D1、R2、KV/DO bindings 按服务最小化配置。

AlphaPing 的调整：

- 使用 Turbo + Cargo 双 workspace。
- 新开源仓库采用 `wrangler.<name>.template.toml`，让 `.toml` 保持扩展名结尾并可 dry-run parse。
- 不复制 Skillscat 当前真实 ID、环境值、业务 worker 数量或业务代码。

## 8. 仍需在实施阶段验证

- rustls 对“只启用 X25519MLKEM768 并 fail closed”的具体配置 API 和平台兼容测试。
- workers-rs queue/D1/R2 API 在锁定版本下的类型和 batch 行为。
- Rust Worker 中 AES-GCM/zstd/prost 的 Wasm bundle size、startup 和 CPU。
- Apple `container` 当前结构化输出/API 的稳定接口。
- Colima containerd 多 profile 的最低权限读取方案。
- shadcn-svelte 与 Bits UI 锁定版本的 Svelte 5 兼容矩阵。
- Cloudflare 价格、Cron/Queue limits 和 Analytics Engine 实际计费状态。
