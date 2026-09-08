# AlphaPing 项目审查与修复（2026-09-08）

本轮从干净的 `f9e90d0` 开始，审查 Web、数据库、各 Worker、Agent、安装/更新链路和发布配置。已修复下列问题；结论基于代码审查、真实 D1/网络回归、浏览器及构建检查，不等于证明项目不存在任何缺陷。未操作生产环境。

修复提交：`66c6143`（通知/存储）、`f6cf4dc`（Agent）、`647f7c6`（Web）。

## 已修复的问题

| 范围             | 原问题与影响                                                                        | 修复与证据                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通知事件发现     | 按事件时间推进全局 cursor，迟到的 Agent/检查事件会永久漏发                          | 在 `state_events` 同事务 trigger 中写入单调序号队列，先持久化 outbox，再推进 cursor、清理 receipt；覆盖乱序、重复插入、失败重试、并发初始化和级联删除                               |
| 通知批量查询     | 100 个资源触发的规则查询需要 102 个绑定参数，超过 D1 的 100 参数上限                | 每批最多 24 个完整资源/维度键，总计不超过 97 个参数；真实 Miniflare 100 资源回归通过                                                                                                |
| 通知投递租约     | 多批投递共用开始时刻，后面的批次可能领取到已过期租约；第六次尝试崩溃后仍可重复领取  | 每次领取使用当前时间，原子封顶 6 次并转为终态；覆盖重叠发送、慢批次与耗尽租约                                                                                                       |
| 通知权限与成本   | 已入队事件未再次检查已关闭规则或已删除资源；复核若只按 workspace 查规则又会放大读取 | 发送前检查 workspace、资源、规则和渠道归属/状态；按资源 PK 与完整规则索引查找，[查询计划](assets/2026-09-08-project-review/notification-query-plan.txt) 已确认                      |
| 通知存储         | sent/dead delivery 没有保留期，长期积累                                             | 按 workspace 的 `audit_log_days` 和终态 `updated_at` 清理；每状态每批最多 200 条，保留 pending/delivering；增加对应索引                                                             |
| Agent 更新内存   | 带 ETag 的版本二进制进入长期 metadata cache，随更新版本积累                         | 只允许三个固定 metadata 文件进入缓存，总上限 3 × 256 KiB；真实 HTTP ETag/304 回归覆盖同大小二进制不得入缓存                                                                         |
| Agent 采样与上传 | 主循环直接等待上传，慢网络阻塞采样和 probe 落盘；Live 写入也没有截止时间            | 最多一个独立上传 task，主循环独占 spool/nonce/ACK/config/key rotation；取消不删除未 ACK 数据；Live 写入设置 5 秒 deadline。慢 HTTP 测试验证等待期间继续生成报告、限制并发和保留数据 |
| Web 机器切换     | SvelteKit 复用页面组件时，机器 B 可能沿用机器 A 的指标、tab 或子组件状态            | 按资源重建详情子树，让初始指标/tab 随页面数据更新；真实浏览器验证 SPA 切换和旧 WebSocket 回调隔离                                                                                   |
| Web 请求生命周期 | ticket/fallback/history 无完整超时，fallback 可堆积，旧响应可能更新已切换的页面     | ticket/fallback/handshake 15 秒截止，fallback 最多一个 in-flight；历史分页总计 30 秒截止；隐藏/离开页面取消实时请求，资源切换/销毁面板取消历史请求；超时恢复 Retry 控件             |

通知内部使用确定性 delivery ID 去重。外部 provider 如果没有幂等键能力，在对方已收到但 ACK 丢失时仍可能重复发送；文档已移除无法兑现的外部 exactly-once 承诺。

## 验证结果

- `pnpm verify` 完整通过：格式、lint、类型、18 项脚本测试、307 项 TypeScript 单元/集成测试、D1 全量迁移/schema manifest、成本模型、Rust fmt/clippy、92 项 Rust 测试、Agent 资源门禁、生产构建、Web E2E 和 6 个 Worker production dry-run。最后的通知索引查找调整另通过完整通知测试、类型、lint 和最终 Worker dry-run。
- `node scripts/test-ingest-e2e.mjs` 通过：注册、加密报告/ACK、重复/重放/篡改、配置与命令下发、密钥轮换、权限撤销、容器目录、机器状态与 block slot 落库，使用包含新增 trigger 的真实本地 D1。
- 通知 Worker 的 24 项测试、Retention 的 25 项测试通过。新回归覆盖的通知漏发、参数上限、失效规则和租约问题均在修复前复现过。
- Chromium 在生产构建上通过 6 项生命周期回归和 16 组明暗页面检查（含桌面、笔记本、平板和手机）；[浏览器结果](assets/2026-09-08-project-review/browser-checks.json) 包含实际路由、视口和 axe 结果。未发现页面运行时错误、横向溢出或稳定渲染后的 WCAG A/AA 违规。颜色切换须等待原有 120ms transition 完成再采集对比度。
- `pnpm audit --json`、`cargo audit --json` 无已知漏洞；`cargo deny check` 的 advisories/licenses/sources/bans 均通过。文本凭证模式扫描覆盖 531 个文件，无私钥或实际 token 命中；这不是完整渗透测试。
- 安装器模拟回归覆盖 systemd、launchd、Windows Service、OpenRC、支持架构、坏下载、非法 origin、保留已有身份/服务；发布测试验证六平台 artifact 装配、SPDX SBOM 和 threshold-signed metadata。
- 所有历史提交的 author/committer 均为 `BackRunner <dev@backrunner.top>`，本次继续使用此身份。

## 资源和成本

本机 macOS release Agent，容器监控关闭，离线上报场景测量 30.3 秒/31 点：最大 RSS **15.67 MiB**，平均 CPU **0.132%**（单核）。这是短时样本，不代表全部探测任务、容器数量或原生平台的长时间上限。

500 台机器的本地控制台 SSR p95 **30.1ms**，最大 31.9ms；200 台机器/200 项服务的公开状态页 SSR **25.6ms**。不包含公网延迟，也不能代替 Cloudflare 生产压测。

通知 queue 只在状态转换时写入；不增加常规 sample/report/Live 写入频率。模型计入 queue、序号、索引、投递和终态删除，默认 30+30 场景预算写入 12.639m/月、存储 1.634GB；100+100 为 41.710m/月、4.280GB。两者在模型默认负载下仍无 Workers Paid 基础月费以外的预估超额费用；高观看并发、重试、通知突发和大型容器库存仍会增加费用。

## 迁移和回滚

1. 在更新 Notifications/Retention Worker 前，先应用 TELEMETRY_DB `0012_notification_event_queue.sql` 与 CONTROL_DB `0025_notification_delivery_progress.sql`。两库迁移不宣称原子性，必须确认两边均成功。
2. 保持现有数据备份流程。迁移是添加表/trigger、cursor 列和索引，不回填旧状态事件。已有部署会消费迁移后新增的 receipt；全新通知实例首次运行跳过初始化前历史，并用条件更新固定初始化边界。
3. 更新 Notifications/Retention Worker，然后观察发现数、pending/dead 数、失败日志和保留期清理。任何失败都不能先推进 cursor 或删除未持久化的 receipt。
4. 需要回滚时保留新增 schema，先回滚 Worker。旧通知代码会恢复原有事件时间 cursor 的已知限制；不要通过手动回退 cursor 或清空 outbox 掩盖问题。新增 receipt 的源事件外键仍允许普通 retention 回收。
5. 本轮 Agent 未改变 protobuf 或 spool schema；部署 Agent 二进制仍须通过现有六平台 CI 和签名发布流程。此次未创建 tag、签名 release 或部署。

## 验证边界

审查覆盖服务归属、认证/RBAC/公开投影、nonce/ACK/重试、缓存/存储、通知和页面生命周期，并运行了已有安全、安装和更新测试。仍未在本轮执行 24h+ 断网 soak、Cloudflare 生产计费/并发压测、各原生系统的真实安装/重启/升级，或 Safari/Firefox 真机矩阵。后续上线应按这些环境继续验证；当前没有发现尚未处理的可复现阻断性问题。
