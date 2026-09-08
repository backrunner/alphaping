---
title: 部署控制面
description: 准备 Cloudflare 资源，配置独立 Worker，并安全地创建第一个工作区。
order: 1
---

## 环境要求

| 工具或资源 | 要求                                                                 |
| ---------- | -------------------------------------------------------------------- |
| Node.js    | 22.12 或更新版本；仓库 CI 使用 Node.js 24                            |
| pnpm       | 12.3.4，与根目录 packageManager 一致                                 |
| Rust       | 1.96，包含 wasm32-unknown-unknown target                             |
| Cloudflare | Workers、两个 D1 数据库、WebSocket Durable Object；导出和备份使用 R2 |

控制面采用 Cloudflare 原生部署。各个 Worker 使用独立配置，并通过 bindings 连接资源。

## 获取代码

```bash
git clone https://github.com/BackRunner/alphaping.git
cd alphaping
pnpm install --frozen-lockfile
```

仓库包含可提交的配置模板，真实配置和本地 secrets 被 Git 忽略。

## 配置资源与凭据

在 `apps/web` 和 `workers/*` 中，将对应的 `wrangler.<name>.template.toml` 复制为 `wrangler.<name>.toml`，替换模板中的资源 ID、域名和绑定。生产 Worker 名称使用 `alphaping-<name>-production`。

- `CONTROL_DB`：账户、工作区、资源配置与权限。
- `TELEMETRY_DB`：遥测块、最新状态、聚合与状态事件。
- `LIVE_HUBS`：按工作区隔离的实时 WebSocket Hub。
- `EXPORT_BUCKET`：显式导出与备份产物。

对照每个服务的 `.dev.vars.example` 配置变量，使用 Wrangler secret 设置生产 secrets。首次初始化需要高熵 setup token，不能直接开放为“第一个访问者成为管理员”。

具体绑定与服务对应关系以仓库的[架构规范](https://github.com/BackRunner/alphaping/blob/main/.agents/02-architecture.md)和[安全协议配置](https://github.com/BackRunner/alphaping/blob/main/.agents/05-agent-protocol-security.md)为准。

> 文档站 `apps/docs` 是独立的公开站点，不需要绑定你的监控数据库。部署监控实例时可以仅选择所需的控制面 Worker。

## 验证与数据库迁移

先运行本地验证，确认依赖、代码和迁移链可用：

```bash
pnpm db:validate
pnpm build
pnpm workers:list
pnpm workers:deploy --all --env production --dry-run
```

`--dry-run` 只检查构建与部署配置，不会创建线上资源或执行数据库迁移。为两个 D1 数据库配置好 migration 目录后，在自己的环境中按顺序应用对应 migration 链。已有实例升级前先备份，不能跳过迁移直接部署新代码。

迁移文件位于 `packages/db/migrations`。使用[备份与恢复指南](https://github.com/BackRunner/alphaping/blob/main/.agents/13-d1-backup-and-recovery.md)核对备份、迁移和恢复流程。

## 部署与初始化

使用真实 Wrangler 配置完成各个服务的部署。部署脚本可按服务执行，例如：

```bash
pnpm workers:deploy --worker web --env production
```

这条命令会真正部署 Web Worker；运行前需要已经准备好依赖资源、服务和迁移。其他 Worker 同样按 `pnpm workers:list` 中的名称部署。

打开控制面 `/setup`，按提示验证环境和 setup token，创建管理员、工作区与默认 dashboard，设置保留期和公开策略。初始化完成后关闭公开注册，后续成员通过管理员邀请加入。

## 下一步

完成[生产 Agent 签名发布配置](https://github.com/BackRunner/alphaping/blob/main/.agents/12-release-and-agent-updates.md)后，[安装 Agent](/docs/start/agent)。也可以先[添加 Cloudflare 服务检查](/docs/guides/services)。
