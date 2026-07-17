# AlphaPing V1 实现证据

本文把 `01-requirements.md` 第 15 节的 V1 验收标准映射到代码、自动化测试和仍需目标环境完成的外部验收。记录日期为 2026-07-17。所有命令从仓库根目录执行。

## 1. 验收矩阵

| # | 状态 | 实现与证据 |
| --- | --- | --- |
| 1 | 通过 | `apps/web/src/lib/server/setup.ts` 使用 constant-time digest 比较 setup secret，并以 D1 batch 创建 installation、管理员、workspace、membership、dashboard 和 retention policy。`scripts/test-web-e2e.mjs` 在真实临时 Worker/D1 上验证错误 token、环境 readiness、两个并发 setup 中恰好一个 303/一个 409、完成页和顺序重放 409。 |
| 2 | 通过 | `resources.ts` 创建 machine 和一次性 enrollment token；`install.sh`/`install.ps1` 提供 Linux、macOS、Windows 自启动服务；Web E2E 验证脚本分发、机器创建和新 latest 立即进入 dashboard。`scripts/installers.test.mjs` 验证 artifact hash/length/version、enroll 参数、权限、systemd/launchd/SCM recovery。Ingest E2E 验证真实 Agent enrollment 与首个加密 report。 |
| 3 | 通过 | Checks Worker 的 liveness 收敛与 Ingest 的资源阈值状态机写幂等 `state_events`。Ingest E2E 从 `offline -> healthy -> down`，并验证 reason 分别为 `agent_report_received` 和 `resource_threshold`；状态不变不重复写事件。 |
| 4 | 部分通过，目标环境阻塞 | Docker、Colima Docker/containerd 和 Apple container 适配器有 fixture/unit tests；加密 Ingest E2E 验证四种 runtime 状态、container catalog、latest JSON 和 Web 详情投影。本机 Apple container 1.0.0 已真实识别为 `Available` 并读取运行容器。本机 Docker endpoint 为 `Stopped`、Colima 为 `Absent`，因此尚不能声称在这两种运行中 runtime 上完成真实 `Available` 验收。目标机器运行 `cargo run --quiet -p alphaping-agent -- diagnose-runtimes` 即可补证，不需要启动控制面。 |
| 5 | 通过 | Web E2E 通过真实 server action 创建带 secret header 和 response-header assertion 的 Cloudflare HTTP check，以及两个 5 秒 Agent TCP/ICMP check；校验 executor Agent、request config、secret wrapping、assignment revision 和 machine desired revision。编译器拒绝 Cloudflare ICMP，并限制周期、timeout、header/body/payload/assertion 大小。 |
| 6 | 通过 | 公共状态页查询层执行时间有效性与 public projection；Web E2E 验证 capsule 页面、incident 创建与追加更新、有效公告展示、过期公告即时隐藏、30 秒 public cache，并扫描页面不含 host、secret header value 和过期公告。 |
| 7 | 通过 | `@alphaping/authz` 与服务端 loader/action 共用授权。Web E2E 验证 admin、未授权 member、machine view、service manage、显式 deny 和 guest；直接访问页面/API 返回非枚举 404，公共资源仍需独立 allow policy。 |
| 8 | 通过 | Ingest E2E 使用 Agent 生产 `EnrollmentProof`、protobuf、HKDF directional keys 和 AES-256-GCM envelope；验证 ciphertext 不含业务 marker，D1 commit 后才返回加密 ACK，并拒绝过期/撤销/复用 token、transport replay、tampered ciphertext 和 revoked key。生产 Agent `pq_client()` 仍只允许 TLS 1.3 `X25519MLKEM768`。 |
| 9 | 通过 | Retention Worker 按 workspace lease 和 resource/time cursor 分批清理 raw block、5m/1h rollup、status bucket、event、audit、announcement、command 和 soft delete。`artifact-retention.test.ts` 使用真实 Miniflare R2 验证只扫描 `exports/v1/`/`backups/v1/`、显式 expiry、500-object 有界游标、lease、无元数据保留和幂等重跑。D1 migration/schema/dry-run 已验证。 |
| 10 | 通过 | updater 集成测试通过本地 HTTP 服务完成 threshold-signed targets、signed snapshot/timestamp、metadata hash/expiry/version、平台选择和 artifact length/SHA-256 全链；安装测试验证 pre/post health check、原子替换与失败回滚。release script tests 验证六平台 artifact、SBOM、双签 metadata 和损坏拒绝。Web + Ingest E2E 验证管理员强制检查命令、加密下发和结果持久化。 |

## 2. 最便宜存储方案证据

- 权威配置在 `CONTROL_DB`，所有 latest/raw/rollup/event 在 `TELEMETRY_DB`，Dashboard 不查询 R2。
- Agent 默认 10 秒采样、60 秒 durable report；一个 5 分钟 D1 block 使用 5 个固定 minute slots，每个 slot 保留 6 个 sample。
- 10 秒实时层只在 viewer 存在时使用 Hibernation WebSocket，不写 D1/DO storage；断开回退 D1 latest。
- Agent SQLite WAL delivery 无限重试；equal-jitter 从 1 秒开始，绝对上限 300 秒，只有认证 ACK 才删除 delivery。
- R2 只存主动导出/备份。每小时 retention 对两个固定 prefix 各做一次 bounded list，即 1,440 Class A/月；DeleteObject 免费，正常落在 R2 included usage。
- `pnpm cost:check` 的当前模型：30+30 为 12.420m budgeted D1 writes、1.634 GB、1.643m Worker requests、0 USD overage；100+100 为 41.400m、4.280 GB、4.969m requests、0 USD overage，两档预计都只有 Workers Paid 的 5 USD/月。

## 3. 可复现命令

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
cargo deny check
cargo run --quiet -p alphaping-agent -- diagnose-runtimes
```

`pnpm verify` 包含 format、ESLint、TypeScript/Svelte、全部 JS/Worker tests、D1 migration/schema drift、成本门禁、Rust fmt/clippy/test、全部 build、Web E2E、所有 Worker production dry-run 和 whitespace 检查。`pnpm test:e2e` 额外运行 Rust Ingest 的完整加密协议流程。

## 4. 未关闭的外部验收

V1 发布 tag 前仍需在以下实际环境各保存一次 `diagnose-runtimes` 输出，并确认至少一个容器的名称、镜像、状态和资源摘要进入机器详情页：

1. Docker daemon 正在运行且 Agent service account 可读 socket。
2. Colima profile 正在运行，分别覆盖 Docker socket 和 containerd/nerdctl 路径。

当前主机只能证明 unavailable 状态分类正确，不能替代上述 `Available` 路径。Apple container 1.0.0 的真实路径已经完成。
