# AlphaPing Roadmap

## 1. 交付原则

- 每个阶段必须产生可运行、可测试、可回滚的增量。
- 安全协议、迁移和权限不允许作为最后补丁加入。
- 先完成一条垂直链路，再扩展监控类型和视觉细节。
- 阶段退出条件没有满足时，不进入依赖它的后续阶段。

## 2. 阶段总览

| 阶段 | 目标 | 主要产物 |
| --- | --- | --- |
| M0 | 工程基础 | Monorepo、CI、规范、Cloudflare 本地开发 |
| M1 | 初始化与身份 | Setup、Better Auth、workspace、RBAC |
| M2 | 安全 Agent 链路 | Agent、enrollment、加密 Protobuf、Rust ingest Worker |
| M3 | 机器监控闭环 | 最新态、历史数据、dashboard、事件 |
| M4 | 服务监控与状态页 | HTTP/TCP/ICMP、断言、胶囊时间线、incident |
| M5 | 容器与跨 Agent 探针 | runtime 探测、容器 tab、指定 Agent 执行 |
| M6 | 更新、保留和发布 | 静默更新、清理 Worker、成本护栏、开源发布 |

## 3. M0 工程基础

### 范围

- 初始化 pnpm workspace、Turbo 和 Cargo workspace。
- 创建 `apps/web`、`workers/*`、`crates/*`、`packages/*` 和 `tooling/*` 边界。
- SvelteKit 使用 `@sveltejs/adapter-cloudflare` 和 Workers Static Assets。
- 建立 wrangler template 配置、部署脚本、D1 migration 和本地 Miniflare/Wrangler 流程。
- 配置 TypeScript strict、ESLint、Prettier、Rustfmt、Clippy、cargo-deny、测试和 CI。
- 添加 Apache-2.0 LICENSE、NOTICE、SECURITY、CONTRIBUTING 和基础 `.gitignore`。

### 退出条件

- `pnpm turbo run lint typecheck test build` 在空功能骨架上通过。
- Rust workspace 的 `cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test --workspace` 通过。
- Web 和每个 Worker 的本地 smoke test 可运行。
- 模板配置中没有真实 Cloudflare ID、域名或 secret。

## 4. M1 初始化、身份与 RBAC

### 范围

- Better Auth + Drizzle + D1 schema。
- 安全 setup token 流程和首个管理员创建。
- workspace、membership、invite、session 和审计日志。
- 统一授权服务和资源级 `view`/`manage` grant。
- Dashboard/资源 public policy 和游客投影。
- 管理后台基础布局、导航和空状态。

### 退出条件

- 未初始化、初始化中、已初始化三种状态均有集成测试。
- setup token 错误、过期、重放和并发抢占均被拒绝。
- 管理员、普通用户、游客权限矩阵全部通过。
- API 直接访问不能绕过页面隐藏逻辑。

## 5. M2 安全 Agent 链路

### 范围

- 定义 protobuf 协议和兼容性规则。
- 实现 Rust Agent 最小守护进程和跨平台身份存储。
- 实现 Rust ingest Worker 的 enrollment、report、config response 和 replay protection。
- TLS 1.3 PQ hybrid 配置、应用层 AES-256-GCM、key epoch 和轮换。
- Agent 本地 SQLite WAL outbox、无限重试、300 秒退避上限、磁盘压力压缩和健康日志。
- D1 `telemetry_blocks_5m`、`check_result_blocks_5m`、latest、5m/1h rollup 和 retention tables。
- Linux systemd、macOS launchd 和 Windows Service 安装器骨架。

### 退出条件

- Agent 在 Linux/macOS/Windows CI 或对应测试环境完成注册和加密上报。
- 抓包只看到加密 payload，协议 fuzz test 不触发 panic 或无界分配。
- 重复 sequence、错误 AAD、旧 key epoch、撤销 Agent 和超大 payload 均被拒绝。
- 断网 24 小时以上仍持续收集并补报，任意两次网络重试间隔不超过 300 秒。
- 服务端只在 D1 batch/latest transaction 完成后确认；ack 丢失后的重复 report 不产生重复数据。
- SQLite 缓冲达到阈值时按 10 秒到 1 分钟再到 5 分钟顺序压缩，并准确上报丢失/聚合计数。

## 6. M3 机器监控闭环

### 范围

- Agent 采集 CPU、内存、磁盘、网络、运行时间和系统信息。
- Ingest 使用 D1 transaction 写入可查询 5 分钟 raw block、最新态和关闭的 5 分钟/1 小时 rollup。
- Live Worker 使用 Durable Object Hibernation WebSocket，有 viewer 时向机器 Dashboard 提供 10 秒 snapshot。
- Dashboard 总览、机器 compact grid、筛选和排序。
- 机器详情概览、折叠历史图表、事件和配置 revision。
- 离线、降级、故障、维护和恢复状态机。
- retention Worker 首个版本。

### 退出条件

- 30/100/200/1000 Agent 及对应 check 的合成负载模型完成并记录 Workers/D1/DO 成本。
- 页面可见且 live 健康时，最新状态延迟不高于 12 秒；Live 断开时正确回退 D1 而不误报 offline。
- 图表折叠时不请求历史数据。
- 清理 Worker 可从中断游标恢复并幂等重复执行。

## 7. M4 服务监控与状态页

### 范围

- Service、check、assertion、schedule 和 result 模型。
- Cloudflare HTTP/TCP executor 和 Agent ICMP/HTTP/TCP executor。
- Due-task scheduler、`last_claimed_slot`、确定性 execution ID 和重复执行幂等。
- HTTP header/body/JSONPath 断言和安全限制。
- 服务状态聚合、确认窗口、维护窗口和事件。
- 公开/私有状态页、胶囊时间线、incident 和定时公告。

### 退出条件

- 每种检查的成功、超时、DNS/TLS/连接失败和断言失败均有测试。
- Cloudflare executor 不显示 ICMP 选项，并清楚说明执行位置不固定。
- Incident 更新顺序稳定，公告在 `expires_at` 后立即不可见。
- 公共页面快照不包含 secret、内部 header、payload 或私有资源。

## 8. M5 容器与跨 Agent 探针

### 范围

- Docker API 适配器。
- Colima Docker/containerd profile 探测。
- Apple `container` CLI/API 适配器。
- 容器状态、资源和网络指标归一化。
- 容器详情列表和机器详情子 tab。
- 指定 source Agent 探测目标机器或服务。

### 退出条件

- runtime 不存在、未启动、权限不足和 API 不兼容状态可区分。
- 默认采集不包含环境变量和 secret。
- 跨 Agent 任务更换执行器后 revision 和结果来源正确。
- 容器继承与覆盖权限通过测试。

## 9. M6 更新、保留和开源发布

### 范围

- TUF 风格 release metadata、签名发布、自动更新和回滚。
- 面板下发立即检查/强制更新命令。
- 完整保留策略、软删除、D1 block/rollup 清理和备份恢复演练。
- Worker 请求/CPU、D1 rows/storage、DO request/duration 和 export R2 的预算告警。
- 安装脚本矩阵、release artifacts、SBOM、checksums 和签名。
- 文档站、示例配置、升级指南和安全披露流程。

### 退出条件

- 旧版本 Agent 可以跨至少两个协议 minor 版本平滑升级。
- 更新包损坏、签名错误、健康检查失败均自动回滚。
- 备份恢复演练能重建用户、配置、授权、密钥包裹记录和可查询历史。
- 开源扫描没有 secret、真实 Cloudflare ID、测试用户凭据或不兼容许可证。
- `alkinum/alphaping` 发布 Apache-2.0 的首个签名 tag。

## 10. V1.x 后续候选

- Email、Webhook、Slack、Telegram 等通知渠道。（已提前进入当前实现：Resend、SMTP HTTPS relay、Discord、Telegram、Slack、Bark。）
- Durable Objects 子分钟中央调度。
- 多地域专用探针网络。
- Kubernetes/CRI 集群级监控。
- SLO、错误预算和告警抑制。
- R2 Data Catalog/Parquet 分析层，需重新评估成本和成熟度。
- PQ 签名成熟后，将 Agent 身份和更新元数据升级为 ML-DSA 双签名。

## 11. 滚动提交建议

每个阶段按可审阅增量提交，格式必须为 `type(scope): description`：

- `docs(product): define monitoring requirements`
- `feat(auth): add secure first-run setup`
- `feat(agent): encrypt protobuf report batches`
- `feat(dashboard): add compact machine grid`
- `fix(rbac): enforce container visibility override`
- `perf(storage): pack telemetry into five-minute blocks`
- `chore(release): publish signed agent artifacts`

禁止把整个阶段压成单个超大提交。数据库 migration、协议变更和生成代码必须和对应实现处于同一提交或紧邻提交。
