# AlphaPing 项目基线

本目录是 AlphaPing 的产品、架构、设计和工程规范单一事实源。文档基于 2026-07-15 可获取的官方资料编写，进入实现后，任何改变安全边界、数据模型、计费模型、公开权限或部署拓扑的修改都必须同步更新这里。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [01-requirements.md](./01-requirements.md) | 产品需求、角色、功能范围、验收标准 |
| [02-architecture.md](./02-architecture.md) | Monorepo、服务边界、运行时和部署拓扑 |
| [03-module-design.md](./03-module-design.md) | Web、Worker、Agent 与共享模块设计 |
| [04-data-model.md](./04-data-model.md) | CONTROL_DB/TELEMETRY_DB 领域模型、热表主键、查询与权限模型 |
| [05-agent-protocol-security.md](./05-agent-protocol-security.md) | Agent 协议、后量子信道、密钥轮换、更新安全 |
| [06-cloudflare-storage-cost.md](./06-cloudflare-storage-cost.md) | Cloudflare 计费依据、存储分层、容量估算和清理策略 |
| [07-ui-design-system.md](./07-ui-design-system.md) | Design token、信息架构、页面和组件规范 |
| [08-engineering-standards.md](./08-engineering-standards.md) | TypeScript/Rust、测试、提交、开源和供应链规范 |
| [09-roadmap.md](./09-roadmap.md) | 分阶段路线图、依赖关系和阶段退出条件 |
| [10-research.md](./10-research.md) | 官方资料、调研结论和关键取舍 |
| [11-telemetry-storage-and-retry.md](./11-telemetry-storage-and-retry.md) | 可查询遥测主存储、Agent 本地缓冲、补报与退避 |
| [12-release-and-agent-updates.md](./12-release-and-agent-updates.md) | 发布密钥仪式、签名元数据、首次安装信任、更新命令与回滚 |
| [13-d1-backup-and-recovery.md](./13-d1-backup-and-recovery.md) | D1 Time Travel、可验证 SQL 备份、恢复演练与生产切换顺序 |
| [14-implementation-evidence.md](./14-implementation-evidence.md) | V1 验收标准到代码、测试、成本和外部环境证据的映射 |
| [skills](./skills) | 项目内 Codex skills，约束后续实现和评审 |

## 已确定的核心决策

1. 使用 pnpm workspace、Turbo 和 Cargo workspace 组成单仓库。
2. `apps/web` 仅部署到 Cloudflare Workers Static Assets，使用 SvelteKit、shadcn-svelte、Bits UI、Better Auth、Drizzle 和 D1。
3. Agent 数据入口和配置下发由 Rust `workers-rs` Worker 处理。
4. Agent 每 60 秒通过 HTTPS/HTTP2 发送 durable report，并在响应中拉取配置和命令。另外保持 Hibernation WebSocket，只在 Dashboard 有 viewer 时每 10 秒发非持久 live snapshot。
5. Cloudflare 侧支持 HTTP 和 TCP 检查，不承诺 ICMP。ICMP Ping 由 Agent 执行。
6. `CONTROL_DB` 保存 Better Auth、RBAC 和配置，`TELEMETRY_DB` 保存最新状态、状态事件和可查询时序数据。每个 60 秒 report 写入 5 分钟 block 的一个固定 slot，完整保留其中 6 个 10 秒 samples。
7. R2 不作为在线遥测主存储，只保存用户主动生成的导出或备份 artifact。独立 retention Worker 负责 `TELEMETRY_DB` 分批清理和两个固定 R2 artifact prefix 的到期删除。
8. Agent 到 Cloudflare 使用 TLS 1.3 `X25519MLKEM768` 混合密钥协商，并用轮换的 AES-256-GCM 应用数据密钥加密 Protobuf 报文。
9. 权限模型包含管理员、普通用户和游客。普通用户获得资源级 `view`/`manage` 权限，游客只能访问显式公开的投影数据。
10. 项目使用 Apache-2.0 发布，目标仓库为 `alkinum/alphaping`，开发提交身份为 `BackRunner <dev@backrunner.top>`。
11. Agent 使用 SQLite WAL 本地 outbox 持续收集。网络失败无限重试，equal-jitter 指数退避绝对上限为 5 分钟。
12. Agent 更新使用编译期嵌入的离线 public root、threshold-signed metadata 和固定 GitHub versioned artifacts；未嵌入 production root 的构建必须拒绝更新。

## 规范用词

- `必须`：实现和评审不可绕过。
- `应该`：默认执行，偏离时必须在 PR 中记录理由。
- `可以`：按范围和成本选择。
- `V1`：首个可自托管且可公开发布的稳定版本。

## 变更规则

- 新功能先更新需求和模块文档，再进入代码。
- 新 Cloudflare 产品或计费假设必须在 `10-research.md` 中补充官方来源和核对日期。
- 修改 Agent 协议必须先更新 `.proto`、协议文档和兼容性策略。
- 修改公开权限必须增加游客视角测试，防止 IP、请求头、容器敏感字段或内部名称泄露。
- 路线图阶段可以拆分，但不得跳过安全、迁移、备份和回滚退出条件。
