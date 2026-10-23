# AlphaPing 项目审查与依赖升级（2026-10-23）

从干净的 `b636386` 工作区开始，审查 Web、文档、共享权限与数据库包、Workers、Rust Agent、安装更新和 CI。已完成依赖升级、SvelteKit 3 迁移和本地验证；当前没有发现尚未处理的可复现阻断问题。这是代码审查和测试的结论，不代表证明项目不存在任何缺陷。本轮未提交、推送、发布或修改生产环境。

## 已处理的问题

| 问题                                                     | 处理                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 依赖审计报告 25 条告警：11 high、11 moderate、3 low      | 升级直接依赖和受影响的传递依赖，原始审计降为 1 high；剩余项通过下述本地补丁处理，保留可见告警                                                                            |
| svedocs 0.3 依赖 SvelteKit 3，无法只修改版本号           | 同步迁移 Web 和 Docs 的 Vite 配置、原生 `#lib` 子路径导入、`$app/tsconfig`、环境和页面状态 API；Web 使用 `cloudflare:workers` 原生 bindings，保留 CSP、CSRF 与请求体上限 |
| 新版本搜索消息目录增加关闭按钮文案                       | 补齐中文 `search.close`，完成严格文档检查和浏览器搜索验证                                                                                                                |
| Kit 3 的失败 action 响应状态与旧 E2E 预期不同            | 更新 E2E helper，仅对 failure 使用 action 状态，保留重定向协议的 HTTP 200 预期；Web 全流程通过                                                                           |
| Agent release 路由测试依赖已移除的 `event.platform` mock | 将 manifest 校验和响应生成提取为独立 server helper，路由读取原生 env，原有成功和非法 manifest 测试继续覆盖                                                               |
| 根验证流程未包含依赖安全审计和 Ingest E2E                | 将两项加入 `pnpm verify`，后续 CI 随完整验证执行                                                                                                                         |

`braces@3.0.3` 的 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 尚无上游修复版本。`patches/braces@3.0.3.patch` 限制 parser、compile、expand、stringify 的嵌套深度。三项回归直接加载 svedocs 实际使用的安装包，验证深层花括号、圆括号、不完整输入、直接 AST 和正常文档 glob。

`pnpm audit:dependencies` 只接受这条 advisory、准确版本和文档扫描依赖路径，并先运行已安装补丁的回归；其他漏洞、审计失败或缺失详情均使检查失败。原始 `pnpm audit` 仍返回 1 条 high，不能描述为原始审计零漏洞。上游发布修复后应升级并移除补丁和例外。

## 依赖版本

| 范围   | 升级结果                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档   | svedocs / svedocs-cli **0.3.0**（检查时最新稳定版）                                                                                                                 |
| Svelte | Kit **3.1.0**、adapter-cloudflare **8.0.1**、Svelte **5.57.2**、Vite **8.3.5**、svelte-check **4.7.7**                                                              |
| Web    | Better Auth **1.7.12**、Bits UI **2.20.0**、Drizzle **0.45.4**、Lucide **1.61.0**                                                                                   |
| 工具   | Vitest **5.0.5**、Wrangler **4.151.3**、ESLint **10.13.0**、Prettier **3.9.10**、Turbo **2.11.10**                                                                  |
| Rust   | rustls **0.23.46**、reqwest **0.13.5**、Tokio **1.54.1**、worker / worker-build **0.8.7**、wasm-bindgen **0.2.129**，以及其他可更新的 workspace crates 和锁文件依赖 |
| CI     | setup-node **7.1.0**、rust-cache **2.9.3**、upload-artifact **7.0.2**、download-artifact **8.0.2**、更新 rust-toolchain action；全部保持完整 SHA 固定               |

安装后的 `pnpm outdated -r --format json` 仅列出 TypeScript：保留 **6.0.3**，因为 Kit 3.1.0 要求 `^6.0.0`、svelte-check 尚不支持 7.x、typescript-eslint 要求 `<6.1.0`。不强行安装 7.0.2。`pnpm peers check` 无冲突；`runed` 使用兼容 Kit 3 的 0.38.0。Node 最低要求升到 **22.17**，CI 保持 Node 24，Rust 工具链保持 1.96。

迁移依据：[svedocs 0.3.0 发布说明](https://github.com/backrunner/svedocs/releases/tag/v0.3.0)、[SvelteKit 3 迁移指南](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)。具体版本以仓库 manifests 和两个锁文件为准。

## 审查与验证证据

- 认证与权限：检查请求体限制、初始化/登录、workspace 归属、资源级授权、拒绝优先和公开投影；真实本地 D1 的 Web E2E 验证管理、跨工作区拒绝和公开状态页。
- Agent 与 Ingest：检查方向密钥、nonce/持久化 sequence、spool 事务、认证后重放领取、落库后 ACK、更新签名/哈希与大小边界。Rust 测试和本地 Wasm E2E 覆盖注册、坏 token、加密报告、重复/重放/篡改、配置、命令、密钥轮换和 ACK 附件失败隔离。
- Workers：检查 Live 短期票据、topic/投影隔离、消息大小与 sequence 边界；检查服务请求的地址/重定向/超时/响应限制、通知租约与重试、保留期批处理。现有相关单元/集成测试全部通过。
- `pnpm verify` **完整通过**：格式、Lint、类型、21 项脚本测试、307 项 TypeScript 测试、依赖审计、两库迁移链、schema manifest、成本模型、Rust fmt/clippy、97 项 Rust 测试、资源基准、生产构建、Web E2E、Ingest E2E、7 个 Worker production dry-run、diff whitespace。
- 测试包曾以 `turbo run test --force --concurrency=2` 强制运行，迁移修复后再次运行 Web 测试及完整验证；最终验证允许复用本轮有效缓存。`pnpm install --frozen-lockfile`、`pnpm peers check`、`actionlint` 和 `cargo deny check` 均通过。cargo-deny 的 advisories、bans、licenses、sources 通过，仍有重复 crate 的提示。
- 文档严格检查：**28 pages / 136 search records / 0 errors / 0 warnings**。HTTP 检查覆盖 28 个 HTML 页面、28 个 Markdown 镜像和 3 个文本端点，全部返回 200，未知路径返回 404。
- Edge 浏览器检查：文档桌面/390px 手机宽度、中英文切换、明暗主题、菜单、中文搜索；控制台真实登录、SPA 导航、机器 Config 标签、手机菜单和页面切换。稳定渲染后没有横向溢出，检查期间没有捕获到 console warning/error。没有把人工冒烟检查描述为完整 axe 或跨浏览器测试。
- 对 Git 跟踪文件和未忽略的新增文件进行脱敏 Gitleaks 扫描：20 个 generic-api-key 命中逐项核实为示例占位符或明确的合成测试凭据，没有确认的真实凭据泄漏。此次未重新扫描全部历史提交。
- npm 许可清单检查了 434 个安装条目，无 UNKNOWN/UNLICENSED 项；Geist 字体通知继续保留。`sharp-libvips` 的 LGPL 依赖用于文档构建，不能将整个依赖树描述为纯 MIT/Apache。构建保留第三方许可证文件；此检查不等同于法律意见。

## 本地资源结果

最终完整验证的 macOS arm64 release Agent：10 秒预热后测量 **30.2 秒 / 31 点**，最大 RSS **15.70 MiB**、平均 CPU **0.099%**（单核）。场景为关闭容器监控的离线上报，不代表全部探测任务或长期运行上限。

本地合成数据：500 台机器控制台 SSR p95 **22.3 ms**；200 台机器/200 项服务公开状态页 SSR **19.5 ms**。这些是本机请求耗时，不含公网延迟，也不能替代 Cloudflare 生产负载或计费验证。成本模型的 30/100/200/1000 机器场景和边界场景通过，本轮没有修改写入频率或数据保留策略。

## 发布与验证边界

本轮没有更改 protobuf schema 或 D1 migrations。后续部署需使用 Node 22.17+ 的完整构建，Web 和 Docs 分别发布；回滚应恢复对应源码、manifests 和锁文件后重建，不能混用 Kit 2 配置和 Kit 3 依赖。Agent 发布仍需六平台构建、签名和真实安装/更新验证。

未运行远程 GitHub Actions、Cloudflare 生产部署/计费压测、Linux/Windows 原生安装重启更新、Safari/Firefox/实体手机矩阵或 24h+ soak。当前本地通过不能替代这些发布门槛。`braces` 上游告警保持记录，后续持续跟踪修复版本。
