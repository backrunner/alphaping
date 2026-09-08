# AlphaPing 开发与开源规范

## 1. 工程基线

- 包管理：pnpm，版本写入 root `packageManager` 并锁定 lockfile。
- JavaScript task graph：Turbo。
- Rust：Cargo workspace，提交 `rust-toolchain.toml` 锁定 stable toolchain。
- Web：Svelte 5、SvelteKit、TypeScript strict、Tailwind v4。
- Cloudflare：Wrangler v4、`@sveltejs/adapter-cloudflare`、Workers Static Assets。
- Database：Drizzle schema + versioned D1 migrations。
- Auth：Better Auth SvelteKit integration + Drizzle sqlite adapter。
- Protocol：Protocol Buffers proto3 + prost。

依赖版本在 scaffold 时按官方兼容矩阵选择并锁定，文档不使用浮动 `latest` 作为可重复构建依据。

## 2. Root scripts

Root 至少提供：

```text
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm format:check
pnpm db:generate
pnpm db:migrate:local
pnpm workers:list
pnpm workers:deploy --worker <name> --env production --dry-run
pnpm agent:build
pnpm agent:test
pnpm verify
```

`pnpm verify` 汇总提交前必须通过的静态检查和测试，不执行真实部署。

`pnpm db:validate` 通过 Wrangler 在临时本地 D1 上顺序应用 CONTROL_DB 与 TELEMETRY_DB 全部 migration；`pnpm db:migrate:local` 将同一 migration 链应用到 Web 本地开发状态。

`pnpm db:generate` 从完整 migration 链创建规范化 `packages/db/schema-manifest.json`；`pnpm db:generate:check` 在全新的临时 D1 重建两库并拒绝 manifest 漂移。现有 migration 历史没有 Drizzle Kit snapshot，禁止让 Drizzle Kit 对发布过的目录生成从零建库或 destructive diff。Drizzle schema 保持应用查询的类型来源，D1 migration 链与生成 manifest 是部署 schema 的事实来源。

`pnpm test:e2e` 在临时 D1 和随机本地端口上运行真实 SvelteKit Worker，覆盖首次初始化、Better Auth 登录、受保护 Dashboard 和公开状态投影；不连接远程 Cloudflare 资源。

## 3. TypeScript/Svelte

- `strict: true`，启用 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 和 `noImplicitOverride` 等可用严格选项。
- 禁止显式/隐式 `any`。边界输入先作为 `unknown`，经过 schema/parser 缩窄。
- 禁止 `as unknown as T` 双重断言和为通过类型检查而扩大类型。
- Cloudflare Env 类型由 Wrangler 生成，禁止手写可能漂移的完整 binding interface。
- Svelte route 只协调 service，不直接写 SQL。
- Server-only 模块放在 `$lib/server`，浏览器 bundle 不得包含 secret 逻辑。
- 公共组件 props 和 events 有明确类型，避免布尔参数爆炸，复杂模式使用 discriminated union。
- 所有 Promise 必须 await、return、void 或交给平台 lifecycle API。

## 4. Rust

- `cargo fmt --check`。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`。
- production path 禁止 `unwrap()`、`expect()`、`panic!()`，测试和明确不可达常量可例外并注释。
- 默认 `#![forbid(unsafe_code)]`。确需 unsafe 的 crate 单独隔离、记录 invariant 并增加 Miri/专项测试。
- 错误分为 domain code 和 source chain。对外不暴露内部 chain。
- 使用有界 channel、buffer、retry 和 concurrency。
- 所有网络调用有 timeout，所有循环有退出/取消机制。
- Agent release profile 启用 LTO、strip、合理 codegen units 和 panic abort，实际以 benchmark 验证。
- Worker Wasm 关注 bundle size 和 startup time，不引入重量级 crypto/HTTP crate 的重复实现。

## 5. 模块与依赖

- 依赖方向：UI/routes -> domain services -> repositories/contracts -> platform adapters。
- Worker/Agent 通过 contract 共享，不跨目录导入另一 deployable 的内部模块。
- 新 abstraction 必须消除真实重复、隔离平台边界或建立稳定 contract。
- 禁止无领域含义的 `common`、`misc`、大型 `utils` 包。
- 循环依赖在 CI 中检测。
- 依赖新增必须说明用途、维护状态、bundle/binary 成本和许可证。

## 6. Cloudflare Worker 规范

- 新项目 compatibility date 使用实现当天日期，季度评估更新。
- 需要 Node API 的 Worker 使用 `nodejs_compat`，否则保持最小兼容面。
- 优先 bindings/service bindings，不从 Worker 内调用 Cloudflare REST API 操作绑定资源。
- 大 body/response 使用 streaming 或明确上限，不无界 `text()`/`arrayBuffer()`。
- 不在 module global 保存请求、租户或 mutable cache state。
- `ctx.waitUntil()` 只用于可丢失或有其他持久保证的 post-response work；关键遥测必须在响应前完成 TELEMETRY_DB durable write。
- 后台 Worker `workers_dev=false`、`preview_urls=false`。
- 启用结构化 observability 和合适 sampling，生产不使用 100% verbose logs 作为长期默认。
- Cron 处理幂等，支持 deterministic slot/claim、bounded batch 和 deadline。
- Durable Object 必须使用 Hibernation WebSocket API，不用 `setInterval` 阻止休眠，不用全局单例承载所有 workspace。
- Live snapshot 明确为非权威数据：不写 DO storage、不 ACK Agent spool、不触发告警或命令副作用。

## 7. Wrangler 与 secret

- 提交 `wrangler.<name>.template.toml`，忽略真实 `wrangler.<name>.toml`。
- template 保留 placeholder，不含 account ID、database ID、queue ID、真实域名和 secret。
- `scripts/deploy-workers.mjs` 发现配置而非硬编码列表，支持 `--list`、`--worker`、`--all`、`--env`、`--dry-run`。
- 部署脚本拒绝未替换 placeholder 和不符合 `alphaping-*` 的生产 worker name。
- secret 使用 Wrangler secret/Secrets Store，并维护 `.dev.vars.example` 的变量名说明，不提交值。
- 本地、preview、production 资源明确分离。

## 8. Database

- 所有 schema change 通过 migration。
- migration 文件和对应代码/测试同提交或紧邻提交。
- D1 大数据 backfill 使用有界脚本/Worker，不在 migration 中长时间扫描。
- 删除列/表使用 expand-migrate-contract。
- 高频查询增加 index 前先记录 query pattern 和 rows-read 改善。
- 每个 repository 方法强制 workspace scope。
- destructive remote migration 前执行 D1 backup/export 并记录恢复命令。

## 9. Protobuf contract

- `.proto` review 与 public API review 同等级。
- 删除字段必须 reserve number 和 name。
- 新字段保持旧 reader 可忽略、旧 writer 可被新 reader 接受。
- 生成代码由 deterministic script 生成，不手改。
- CI 检查生成代码无 diff，并运行 breaking-change detector。
- 保存跨版本 golden vectors。

## 10. 测试策略

### Unit

- 状态机、权限、assertion、rollup、nonce/replay、retention cursor。

### Integration

- Better Auth + D1。
- Worker D1/DO/R2 bindings、Cron、Hibernation WebSocket 和 live fallback。
- Agent fake server、spool、config revision、updater。

### Contract

- Protobuf Rust/TypeScript round trip。
- Agent/ingest protocol versions。
- Public projection snapshot。

### E2E

- Setup。
- 登录和邀请。
- 添加机器/安装 token。
- Dashboard 和机器详情。
- 服务检查和 incident。
- RBAC/guest access。

### Non-functional

- Agent CPU/memory benchmark。
- 100/1000/10000 Agent cost/load model。
- Protocol fuzzing。
- Accessibility scan 和 keyboard test。
- Playwright visual regression。

## 11. CI 门禁

Pull request 必须执行：

- formatting。
- lint/typecheck。
- unit/integration/contract tests。
- Rust fmt/clippy/test。
- protobuf breaking/generated check。
- D1 migration validation。
- secret scan。
- dependency/license audit。
- `git diff --check`。

主分支/release 增加：

- E2E。
- multi-platform Agent build。
- SBOM、checksums、签名。
- Worker dry-run deploy。
- binary size/startup/cost regression。

## 12. Commit 规范

格式必须为：

```text
type(scope): description
```

允许 type：`feat`、`fix`、`docs`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`security`。

Scope 使用稳定模块名：`web`、`dashboard`、`auth`、`rbac`、`db`、`ingest`、`telemetry`、`checks`、`retention`、`notifications`、`agent`、`protocol`、`release`、`docs`。

规则：

- description 使用英文祈使/结果短语，小写开头，不加句号。
- 每个提交保持可构建或明确是纯文档/迁移准备提交。
- 开发中滚动提交，不把多个无关模块压成一个提交。
- 不使用 `wip`、`misc`、`updates` 等无信息描述。
- breaking change 在 body 标注 `BREAKING CHANGE:` 并附迁移路径。

本仓库本地 Git 身份：

```text
BackRunner <dev@backrunner.top>
```

## 13. Pull request 规范

PR 描述包含：

- 目标和用户影响。
- 架构/数据/协议变化。
- 权限和公开投影影响。
- Cloudflare 成本影响。
- 测试证据。
- migration、部署、回滚步骤。
- screenshots，仅 UI 变化需要。

高风险变更必须拆分为可独立回滚步骤。

## 14. 安全开发

- 不自创密码算法。
- secret 不出现在日志、fixture、snapshot、URL 和提交历史。
- token/ID 由 CSPRNG 生成。
- authz 在 server service 层执行。
- 用户控制 URL、header、regex、JSONPath 和 payload 都有长度/复杂度限制。
- Installer 和 updater 只执行签名 artifact。
- 发现漏洞按 SECURITY.md 私下报告，不先公开 issue。

## 15. 开源和 Apache-2.0

目标仓库：`BackRunner/alphaping`。

必须包含：

- `LICENSE`：Apache License 2.0 完整文本。
- `NOTICE`：项目版权和需要保留的第三方 notice。
- `README.md`：自托管、架构、安装和安全边界。
- `CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`。
- package/crate metadata 中的 `license = Apache-2.0` 和 repository URL。

发布前检查：

- 没有真实 Cloudflare account/database/queue IDs。
- 没有生产域名、token、私钥、测试账号或内部路径。
- 没有客户数据、真实 IP/hostname 或截图中的敏感信息。
- 依赖许可证与 Apache-2.0 分发兼容。
- vendored/generated 文件保留上游 license/notice。
- 字体、图标和视觉资产有明确可分发许可。
- `.gitignore` 覆盖 `.env*`、`.dev.vars`、真实 wrangler config、build、coverage、local DB、signing material。

默认不要求每个源文件加入冗长 license header。若外部贡献/组织政策要求，使用 SPDX short identifier。

## 16. Release

- SemVer。
- Web/Workers 和 Agent 可以使用独立 artifact version，但 release notes 必须记录兼容矩阵。
- Agent artifacts 覆盖支持的平台和架构，附 SBOM、SHA-256、TUF metadata 和签名。
- Release tag 由 CI 创建并签名。
- 数据库 migration 在 deploy 前备份，deploy 顺序遵循 expand/switch/contract。
- Worker 使用逐服务 dry-run 和 deploy script，不执行一条不可观察的巨型命令。
- Release 后执行 setup/login/report/check/public status smoke test。

## 17. 文档维护

- 产品行为变化更新 `01-requirements.md`。
- 服务/边界变化更新 `02-architecture.md` 和 `03-module-design.md`。
- schema/migration 变化更新 `04-data-model.md`。
- crypto/protocol/update 变化更新 `05-agent-protocol-security.md`。
- 计费假设变化更新 `06-cloudflare-storage-cost.md` 和 `10-research.md`。
- UI token/pattern 变化更新 `07-ui-design-system.md`。
- 阶段完成更新 `09-roadmap.md`。

## 18. Definition of Done

一项功能只有在以下条件都满足时完成：

- 需求和边界明确。
- 实现符合模块所有权和严格类型。
- 授权、错误、loading、empty、stale 状态完整。
- 测试覆盖与风险匹配。
- migration/协议兼容和回滚已验证。
- 成本影响已评估。
- 日志不泄露敏感信息。
- 文档和 skills 未漂移。
- 提交按规范拆分，工作树不包含生成垃圾或 secret。
