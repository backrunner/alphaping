# AlphaPing V1 实现证据

本文把 `01-requirements.md` 第 15 节的 V1 验收标准映射到代码、自动化测试和仍需目标环境完成的外部验收。记录日期为 2026-07-18。所有命令从仓库根目录执行。

## 1. 验收矩阵

| # | 状态 | 实现与证据 |
| --- | --- | --- |
| 1 | 通过 | `apps/web/src/lib/server/setup.ts` 使用 constant-time digest 比较 setup secret，并在同一 D1 batch 中以 `UPDATE ... WHERE value = 0` CAS 分配初始 workspace sequence，再创建 installation、管理员、workspace、membership、dashboard 和 retention policy；并发失败请求不会在事务外消耗 sequence。`scripts/test-web-e2e.mjs` 在真实临时 Worker/D1 上验证错误 token、环境 readiness、两个并发 setup 中恰好一个 303/一个 409、完成页和顺序重放 409。 |
| 2 | 通过 | `resources.ts` 创建 machine 和一次性 enrollment token；`install.sh`/`install.ps1` 提供 Linux、macOS、Windows 自启动服务；Web E2E 验证脚本分发、机器创建和新 latest 立即进入 dashboard。`scripts/installers.test.mjs` 验证 artifact hash/length/version、enroll 参数、权限、systemd/launchd/SCM recovery。Ingest E2E 验证真实 Agent enrollment 与首个加密 report。 |
| 3 | 通过 | Checks Worker 的 liveness 收敛与 Ingest 的资源阈值状态机写幂等 `state_events`。Ingest E2E 从 `offline -> healthy -> down`，并验证 reason 分别为 `agent_report_received` 和 `resource_threshold`；状态不变不重复写事件。 |
| 4 | 部分通过，目标环境阻塞 | Docker、Colima Docker/containerd 和 Apple container 适配器有 fixture/unit tests；加密 Ingest E2E 验证四种 runtime 状态、container catalog、latest JSON 和 Web 详情投影。本机 Apple container 1.0.0 已真实识别为 `Available` 并读取运行容器。本机 Docker endpoint 为 `Stopped`、Colima 为 `Absent`，因此尚不能声称在这两种运行中 runtime 上完成真实 `Available` 验收。目标机器运行 `cargo run --quiet -p alphaping-agent -- diagnose-runtimes` 即可补证，不需要启动控制面。 |
| 5 | 通过 | Web E2E 通过真实 server action 创建带 secret header 和 response-header assertion 的 Cloudflare HTTP check、同一服务的第二个 TCP check，以及两个 Agent TCP/ICMP check；验证检查策略编辑、0-3 次 retry、关键/非关键聚合、executor Agent、secret wrapping、assignment revision，且 Agent-backed 服务删除/恢复会推进 machine desired revision。check target/policy/delete/maintenance 与 `service_state_sync_jobs` 在同一 CONTROL_DB transaction 提交；DB/Web tests 验证 TELEMETRY_DB 失败后 job 保留、15 分钟在途结果重复校正、超过处理批次上限的 job 公平轮转、maintenance 延迟重放和较新 mutation token 保护。并发 target replacement 以旧 `config_revision` 领取主行，并用本次 sync token 约束 assertion、secret 和 audit 子写入；D1 race test 验证陈旧的“保留 secret”请求不能覆盖已提交的新 target、删除新 assertion、恢复已删除 secret 引用或额外推进 Agent revision。长 maintenance job 在保护窗后按 `next_attempt_at` 休眠并在窗口到期时重算，测试验证无新检查结果也不会永久滞留 maintenance。中央与 Agent check persistence 都在同一 D1 batch 内先写 check latest、再聚合一次当前服务 latest；并发 D1 test 同时恢复旧故障 check 并故障另一 check，验证最终 `service_latest` 仍为 down，并覆盖首个结果、stale revision 和忽略重复 event 后不重放旧转换。中央检查的 claim、执行后验证、execution ID 和 latest 都绑定单调 `config_revision`；旧 batch 注入新 revision 后不能覆盖新 check/service latest，manifest-backed trigger test 验证旧 writer 滚动兼容且 scheduler claim 不误增 revision。编译器拒绝 Cloudflare ICMP，并限制周期、timeout、header/body/payload/assertion 大小。 |
| 6 | 通过 | 公共状态页查询层执行时间有效性与 public projection；Web E2E 验证 capsule 页面、incident 创建与追加更新、有效公告展示、过期公告即时隐藏、30 秒 public cache，并扫描页面不含 host、secret header value 和过期公告。 |
| 7 | 通过 | `@alphaping/authz` 与服务端 loader/action 共用授权。Web E2E 验证 admin、未授权 member、machine view、service manage、显式 deny 和 guest；直接访问页面/API 返回非枚举 404，公共资源仍需独立 allow policy。 |
| 8 | 通过 | Ingest E2E 使用 Agent 生产 `EnrollmentProof`、protobuf、HKDF directional keys 和 AES-256-GCM envelope；验证 ciphertext 不含业务 marker，D1 commit 后才返回携带 payload hash 的加密 ACK，Agent 只接受 report ID、sequence 和 payload hash 全部匹配的 ACK，并拒绝过期/撤销/复用 token、transport replay、tampered ciphertext 和 revoked key。Agent 在发送前原子持久化 sequence、attempt count 和下次 retry；1024-value 高水位先写受限配置，spool 回退时跳过已预留范围，spool 缺失则 fail closed。Ingest 还要求精确 protobuf media type，流式限制 enrollment/report body，使用 Cloudflare 原生 rate-limit bindings、短时 AEAD 冷却和原子 63-bit replay window。30 天到期路径会在旧 s2c AEAD ACK 中稳定返回下一 epoch，D1 只保存 MWK 包裹后的 key；Agent 验证 epoch/material/validity 后原子保存并切换 uploader，新 epoch 首次成功 report 后旧 epoch 才收敛到 24 小时 overlap。生产 Agent `pq_client()` 仍只允许 TLS 1.3 `X25519MLKEM768`；单测和 release 进程启动门禁验证 reqwest 接受该预配置 rustls backend。 |
| 9 | 通过 | Retention Worker 按 workspace lease 和 resource/time cursor 分批清理 raw block、5m/1h rollup、status bucket、event、audit、announcement、command 和 soft delete。CONTROL_DB cleanup 通过结构化 JSON tree 保留 header/body/TCP 引用，每轮只删除 50 个超过 24 小时的 orphan `check_secrets`；Miniflare test 覆盖 malformed JSON、workspace 隔离和跨轮收敛。`artifact-retention.test.ts` 使用真实 Miniflare R2 验证只扫描 `exports/v1/`/`backups/v1/`、显式 expiry、500-object 有界游标、lease、无元数据保留和幂等重跑。CONTROL_DB migration 已验证至 `0020_service_state_sync_schedule.sql`，TELEMETRY_DB 已验证至 `0011_central_check_revision.sql`，共 31 条 migration；schema manifest 和 Worker production dry-run 无漂移。 |
| 10 | 通过 | updater 集成测试通过本地 HTTP 服务完成 threshold-signed targets、signed snapshot/timestamp、metadata hash/expiry/version、平台选择和 artifact length/SHA-256 全链；安装测试验证 pre/post health check、原子替换与失败回滚。release script tests 验证六平台 artifact、SBOM、双签 metadata 和损坏拒绝。Web + Ingest E2E 验证管理员强制检查命令、加密下发和结果持久化。 |

Agent 本地 credential 也遵循平台保护：Windows 配置使用 DPAPI LocalMachine；macOS enrollment 和旧配置迁移优先写 `/Library/Keychains/System.keychain`，data key 按 epoch 使用独立 account，配置文件只保留 storage 标记和 nonce prefix。Keychain 无权限或不可用时保留 0600 restricted file 并输出结构化 capability warning。macOS 自动化使用临时 keychain 验证二进制 secret 往返，不向宿主 System Keychain 写测试项；配置测试验证旧格式默认回退和 Keychain 模式不序列化 identity/data key。真实 System Keychain 写入仍需在 root LaunchDaemon 安装验收中确认。

非功能目标有直接门禁：Agent spool 测试持久化 1,441 分钟、8,646 个 10 秒 samples，模拟失败后关闭并重开 SQLite，再验证网络 wake、按 nominal minute 补报和逐 ACK 清空；`scripts/check-agent-resources.mjs` 先创建有效 resource spool fixture，再启动真实 release Agent，预热后测量 30 秒，记录为 12.48 MiB peak RSS 和 0.129% 单核 CPU。采样器仍每 10 秒刷新已发现磁盘容量，但只每 60 秒重新枚举 mount。Web E2E 在临时双 D1 中创建 500 台 active machines 和 latest rows，分块读取全部授权 latest 计算汇总后只 SSR 12 台问题优先预览；20 次测量要求 p95 低于 500 ms、HTML 不超过 250 KiB，并验证预览边界内外的机器分别出现与省略。

## 2. 本轮安全与可靠性加固

| Commit | 已验证的改动 |
| --- | --- |
| `c035472` | `security(protocol): harden durable report channel`：认证 ACK 绑定 payload hash；Agent spool 缺失 fail closed；发送状态在网络调用前持久化。 |
| `8abf00c` | `security(ingest): enforce abuse and replay controls`：严格 protobuf media type、有界流式 body、Cloudflare 原生 rate limits、AEAD 冷却、原子 replay window，以及 control `0014`/telemetry `0008` migration。 |
| `868dac4` | `security(web): enforce browser security policy`：SvelteKit nonce CSP、HSTS、Permissions-Policy、COOP/CORP、frame/referrer/content-type 防护和显式 CSRF origin policy；Web E2E 检查响应头。 |
| `be81c9b` | `test(protocol): add bounded adversarial properties`：随机 envelope/protobuf parser 输入、未知字段、解压炸弹、尺寸边界和 assertion evaluator property tests。 |
| `aa5280c` | `test(agent): initialize resource spool fixture`：资源门禁使用有效 SQLite spool 启动真实 release Agent，避免把启动失败误计为空闲资源。 |
| `edc9bdf` | `fix(agent): reserve sequences and reduce idle work`：1024-value sequence 高水位预留与回退跳过；sequence/attempt/retry 原子持久化；降低 macOS 空闲 mount 枚举频率。 |
| `ef9d9d9` | `fix(setup): allocate initial workspace atomically`：初始 workspace sequence 在 setup D1 batch 内 CAS 分配。 |
| `5288412` | `test(performance): measure a real SSR p95`：500-machine SSR 样本从 9 增至 20，使 nearest-rank p95 不再退化为样本最大值。 |

Agent 38 项测试通过；协议对抗测试对随机输入保持有界且无 panic。Ingest E2E 覆盖 enrollment、加密 report/ACK、重复 slot、重放、篡改、key rotation、deleted workspace、revoked Agent、D1 block/container/state 和新增滥用控制。Web E2E 覆盖 setup、management、RBAC、dashboard、public status、浏览器安全头和 500-machine 性能。

## 3. 最便宜存储方案证据

- 权威配置在 `CONTROL_DB`，所有 latest/raw/rollup/event 在 `TELEMETRY_DB`，Dashboard 不查询 R2。
- Agent 默认 10 秒采样、60 秒 durable report；一个 5 分钟 D1 block 使用 5 个固定 minute slots，每个 slot 保留 6 个 sample。
- 10 秒实时层只在 viewer 存在时使用 Hibernation WebSocket，不写 D1/DO storage；断开回退 D1 latest。
- Agent SQLite WAL delivery 无限重试；equal-jitter 从 1 秒开始，绝对上限 300 秒，只有认证 ACK 才删除 delivery。
- Agent key rotation 复用 `agent_keys`，每个 Agent 每 30 天至多新增一行，并在新 epoch 激活时对旧行执行一次有条件 update；不增加稳态遥测 rows written 或 Worker request。
- R2 只存主动导出/备份。每小时 retention 对两个固定 prefix 各做一次 bounded list，即 1,440 Class A/月；DeleteObject 免费，正常落在 R2 included usage。
- `pnpm cost:check` 的当前模型显式计算公开状态页 30 秒 Cache API、8 个分页 key 和 per-data-center fanout。一个持续活跃 edge location 下，30+30 为 12.546m budgeted D1 writes、2.437b reads、1.634 GB、2.334m Worker requests、0 USD overage；100+100 为 41.526m writes、6.491b reads、4.280 GB、5.660m requests、0 USD overage。100+100 扩展到 5/20 个持续活跃 location 时平台 overage 分别约 7.17/106.08 USD。所有档位都显式包含每月 14,400 D1 retention/cursor writes 和 1,440 R2 Class A list。

## 4. 可复现命令

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
pnpm agent:benchmark
cargo deny check
cargo run --quiet -p alphaping-agent -- diagnose-runtimes
```

`pnpm verify` 包含 format、ESLint、TypeScript/Svelte、全部 JS/Worker tests、D1 migration/schema drift、成本门禁、Rust fmt/clippy/test、release Agent 资源门禁、全部 build、500-machine Web E2E、所有 Worker production dry-run 和 whitespace 检查。`pnpm test:e2e` 额外运行 Rust Ingest 的完整加密协议流程。

## 5. 未关闭的外部验收

V1 发布 tag 前仍有以下外部前置项，任何本地单测、E2E 或代码复核都不能替代：

1. 在 Docker daemon 正在运行且 Agent service account 可读 socket 的目标环境保存 `diagnose-runtimes` 输出，并确认至少一个容器的名称、镜像、状态和资源摘要进入机器详情页。
2. 在 Colima profile 正在运行的目标环境分别覆盖 Docker socket 和 containerd/nerdctl 路径，保存同等证据。
3. 以 root LaunchDaemon 完成一次 macOS 安装验收，确认真实 `/Library/Keychains/System.keychain` 的 identity 和 epoch data key 写入、读取、重启恢复与卸载行为；临时 keychain 自动化不替代该验收。
4. 按 `05-agent-protocol-security.md` 第 15 节，在 V1 稳定发布前完成至少一次独立第三方密码学与威胁模型评审，并闭环其阻塞发现。本轮属于仓库实现审计，不是第三方安全评审。

当前主机只能证明 unavailable 状态分类正确，不能替代上述 `Available` 路径。Apple container 1.0.0 的真实路径已经完成。

## 6. 最终审计记录

2026-07-18 本地最终审计结果：

- `pnpm verify` exit 0，包含全部单测、22 条 D1 migration/schema、成本门禁、Rust workspace、release Agent 资源门禁、build、Web E2E 和所有 Worker production dry-run。
- `pnpm test:e2e` exit 0，完整 Web 与加密 Rust Ingest 流程通过；该轮 500-machine SSR 20 样本 p95/max 为 125.2/142.9 ms。
- `cargo-deny 0.20.2 check` exit 0：advisories、bans、licenses、sources 全部通过；只输出允许的上游重复版本 warning。
- Linux `x86_64-unknown-linux-gnu` Agent check 在 `RUSTFLAGS=-Dwarnings` 下通过。
- tracked-file 扫描未发现 `.env`、`.dev.vars`、真实 Wrangler config、private key、Cloudflare token 或非 placeholder D1 ID。
- `diagnose-runtimes` 确认 Apple container 1.0.0 为 `Available` 并读取运行容器；Docker 为 `Stopped`，Colima Docker/containerd 为 `Absent`，后两项保持目标环境阻塞。
- CodeGraph 为 301 files、3,435 nodes、8,870 edges，索引 up to date。
- 本轮验证覆盖 `c035472`、`8abf00c`、`868dac4`、`be81c9b`、`aa5280c`、`edc9bdf`、`ef9d9d9` 和 `5288412`；提交均为 `BackRunner <dev@backrunner.top>` 且符合 `type(scope): description`，工作树 clean。
