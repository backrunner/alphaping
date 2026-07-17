# D1 备份与恢复

## 1. 恢复层级

AlphaPing 的在线遥测继续只使用 D1。备份不参与 Dashboard 查询，也不向上报热路径增加 Worker、D1 或 R2 请求。

1. 生产事故发生在 30 天内时，Cloudflare Workers Paid 自带的 D1 Time Travel 是首选。Time Travel 始终启用且没有额外费用，但恢复会覆盖目标数据库，因此只能由管理员在确认恢复点后手工执行。
2. 需要超过 30 天的恢复窗口，或者执行 destructive migration 前，使用本仓库的显式 SQL export。export 包含 schema 和 data；备份 artifact 可以保存在访问受限的离线存储或私有 R2。
3. SQL export 不自动恢复到生产数据库。标准流程是导入新建的替代 D1，验证后再切换 Worker binding。

官方限制以执行时的 Cloudflare 文档为准：D1 export 期间会阻塞该数据库的其他请求，单个 import 文件最大 5 GiB，export/import 对超过 JavaScript 52-bit 安全范围的整数存在精度注意事项。

资料：

- <https://developers.cloudflare.com/d1/best-practices/import-export-data/>
- <https://developers.cloudflare.com/d1/reference/time-travel/>

## 2. 创建可验证备份

先从 `packages/db/wrangler.db.template.toml` 创建被 Git 忽略的真实配置，例如 `packages/db/wrangler.db.toml`，并填入两个生产 D1 的真实 ID。然后在低流量窗口执行：

```bash
pnpm db:backup -- --remote \
  --config packages/db/wrangler.db.toml \
  --output backups/d1/2026-07-17T000000Z
```

脚本有以下强制行为：

- 必须显式传入 `--remote`、真实 Wrangler config 和全新的输出目录。
- 拒绝 template、placeholder 和被 Git 跟踪的真实 Wrangler config。
- 依次导出 `TELEMETRY_DB` 和 `CONTROL_DB`，避免两个数据库同时阻塞。
- SQL 文件权限设为 `0600`，目录权限设为 `0700`。
- `manifest.json` 只记录逻辑 binding、文件名、大小、SHA-256、导出时间、Git commit 和 Wrangler 版本，不记录 D1 ID 或 secret。
- 两份 SQL 和 manifest 在发布到目标目录前会重新校验。

SQL dump 本身包含账号、session、密码 hash、包裹后的 Agent/check key 和业务数据，必须视为敏感数据。不要提交到 Git，也不要放到公共 R2 bucket。manifest 的 SHA-256 用于发现意外损坏，不替代独立签名或存储访问控制。

## 3. 恢复演练

每次备份以及至少每季度执行一次本地恢复演练：

```bash
pnpm db:restore:verify -- --backup backups/d1/2026-07-17T000000Z
```

验证脚本会：

1. 检查 manifest 格式、文件大小和 SHA-256。
2. 创建两个全新的临时本地 D1。
3. 分别导入 telemetry/control SQL。
4. 运行 SQLite `quick_check`，检查关键表存在并可查询。
5. 无论成功或失败都删除临时数据库。

该命令不接受 `--remote`，不能修改 Cloudflare 数据。

## 4. 生产恢复顺序

### 30 天内

1. 停止会修改目标 D1 的管理、checks 和 retention 流量；Agent 继续写本地 SQLite spool。
2. 分别查询 CONTROL_DB 和 TELEMETRY_DB 可用的 Time Travel 恢复点，选择同一事故前窗口。
3. 先恢复 CONTROL_DB，再恢复 TELEMETRY_DB。
4. 运行安装状态、管理员、RBAC、机器/服务数量、latest/history 查询和合成 Agent report smoke test。
5. 恢复 checks/retention；Agent 会按幂等 report ID 补报未 ACK 数据。

Time Travel 是 destructive 操作，执行前必须记录当前 bookmark/恢复点并由第二位管理员复核。不要把 Time Travel restore 放入无人值守脚本。

### SQL 长期备份

1. 创建两个新的 replacement D1 database，不删除或覆盖原数据库。
2. 使用 `wrangler d1 execute <replacement> --remote --file <dump.sql>` 导入，保持两份原 SQL 不变。
3. 针对 replacement 数据库执行完整 schema、用户/RBAC、包裹密钥、最新状态和历史查询 smoke test。
4. 更新被 Git 忽略的真实 Wrangler configs，将所有 Worker 的 `CONTROL_DB`/`TELEMETRY_DB` binding 一致切换到 replacement ID。
5. 先 dry-run，再部署 web/checks/retention/live/ingest；确认健康后恢复流量。Agent 在 ingest 不可用期间继续本地收集并无限重试，间隔不超过 300 秒。
6. 原数据库保持只读回退窗口。若验证失败，恢复旧 binding config 并重新部署；确认新数据库稳定后再按变更流程删除旧库。

两个 D1 不能形成跨数据库原子快照。备份脚本在 manifest 中记录每个 export 的开始和完成时间，恢复时必须审阅这个窗口；需要严格事故点恢复时应优先使用 Time Travel 并选择相邻恢复点。

## 5. 周期与成本

- 日常 30 天恢复由 Paid 已包含的 Time Travel 覆盖，不创建日常 SQL export。
- 建议每月一次长期 export，并在 destructive migration 前额外执行一次。
- 备份保留 3 个或 90 天作为默认起点，按组织合规要求调整。
- 私有 R2 Standard 的前 10 GB-month、每月 1 million Class A 和 10 million Class B 在 included usage 内；备份只产生少量对象操作。超过 included 后按当前 R2 价格计费。
- 上传到私有 R2 时给每个 backup object 写入 `alphaping-expires-at-ms` custom metadata。Retention Worker 每小时只扫描 `backups/v1/`/`exports/v1/` 的有界页并删除显式到期对象；无 metadata 对象不会自动删除。
- R2 lifecycle 可以作为 90 天 age-based 灾备兜底，但不能替代 Worker 的精确到期元数据。两者都不扫描或存放在线 telemetry object。
