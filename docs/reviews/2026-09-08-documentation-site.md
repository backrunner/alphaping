# AlphaPing 文档站

新增独立的 `apps/docs`，使用 svedocs 0.2.1 管理内容与路由，以 AlphaPing
设计系统定制 landing、导航、文档侧栏、阅读布局、主题切换与页脚。中英文各 14
个页面覆盖首页、部署、Agent、机器和容器、服务检查、公开状态页、权限与技术参考。

## 设计与交互

沿用 Iris 紫色、暖白／炭灰底色、Geist 本地字体、玻璃回波 Logo、大圆角和两层柔和阴影。
首页使用静态品牌轨道与已标注示例数据的产品截图，截图压缩为本地 WebP，明暗两张合计约 124 KiB。

文档采用三栏布局，手机使用折叠导航和正文上方的页内目录。保留 svedocs 的本地搜索、
键盘选择、代码复制、上一篇／下一篇、编辑链接、Markdown twins 和 llms 接口。
正文链接持续显示下划线；长代码在生成 HTML 时加入 tabindex，允许键盘横向滚动。
首次访问跟随系统；主题按钮点击后直接切换浅色／深色并保存选择，不使用下拉菜单。reduced motion 下关闭非必要动画。

顶部导航后续调整为悬浮圆角栏：桌面距顶部 20 px，手机 10–12 px，半透明表面搭配背景模糊与柔和阴影。
导航选中项使用 Iris 圆角背景，搜索采用次级表面。手机菜单在栏下方独立展开，不推移正文，菜单内容可滚动。
在 320、390、768、820、1280、1440 px 宽度的明暗模式下检查首页与文档页，共 24 个组合，无导航溢出或 axe 导航违规；
搜索、Escape、手机页面切换、菜单展开位置稳定和目录跳转均通过，类型检查与构建也通过。
见[悬浮导航截图](assets/2026-09-08-docs-floating-navbar/home-desktop-light.webp)、[手机菜单](assets/2026-09-08-docs-floating-navbar/mobile-menu.webp)和[验证记录](assets/2026-09-08-docs-floating-navbar/checks.json)。

## 2026-09-09 交互细节

- 删除表格 `display: table` 覆盖，恢复 svedocs 默认的独立滚动容器。390 px 视口下，服务检查页的页面宽度由 548 px 恢复为 390 px。
- 为可滚动表格增加边缘渐变遮罩，按剩余滚动距离显示；到达边缘时消失。窗口变宽、字体加载和客户端页面切换后重新计算；溢出表格可聚焦并使用方向键滚动。
- 主题切换使用原生按钮与 svedocs 控制器，图标和可访问名称表示目标模式；中英文、刷新后的偏好持久化与手机点击均通过验证。
- 导航玻璃层使用半透明底色、24 px 背景模糊、饱和度增强与边缘高光，底部另设 12 px 模糊的渐隐层；装饰层不拦截点击。320、390、1440 px 明暗模式、搜索、手机菜单以及减少透明效果偏好通过浏览器验证。
- 上述修改通过文档类型／内容检查、相关 ESLint、格式检查、Cloudflare 构建和 Wrangler dry-run。

最新效果：[桌面浅色](assets/2026-09-09-docs-refinements/navbar-1440-light.webp)、[桌面深色](assets/2026-09-09-docs-refinements/navbar-1440-dark.webp)、[手机浅色](assets/2026-09-09-docs-refinements/navbar-390-light.webp)、[手机深色](assets/2026-09-09-docs-refinements/navbar-390-dark.webp)、[手机菜单](assets/2026-09-09-docs-refinements/navbar-390-menu.webp)。

## 中文与英文

中文保留 `/`、`/docs` 与 `/about`，英文对应 `/en`、`/docs/en` 与 `/en/about`。
英文 Markdown 与中文保持相同的相对文件路径，完整翻译 frontmatter 和正文；landing、导航、侧栏、
页脚、主题选择、搜索和错误提示也跟随页面语言。维护者规范仍链接到仓库，英文参考页注明这些规范目前使用中文。

悬浮导航新增紧凑的语言入口，切换到同一文章并保留查询参数。译文保持相同的章节结构与顺序时，
章节链接跳到对应译文标题；未知或不匹配的正文 fragment 被丢弃。缺失译文不提供可点击入口，
404 页则明确指向另一语言首页。搜索始终按当前语言筛选，包括 404 页。
980 px 以下收起顶部主导航，560 px 以下使用文字语言入口，为手机上的搜索、主题和菜单保留空间。

`checks.translations: true` 启用严格覆盖检查，中文消息通过 TypeScript 与英文消息键对齐。
服务端在输出 HTML 时设置 `lang` 与 `dir`；svedocs 生成各语言的标题、描述、canonical、
互相对应的 hreflang、JSON-LD `inLanguage` 与 sitemap alternates。

本次双语验证：

- `pnpm docs:check`：28 pages / 136 search records，类型与严格内容检查均为 0 errors / 0 warnings。
- 带测试 origin 的 Cloudflare 生产构建与 Wrangler dry-run 通过；浏览器直接访问本地 Worker 的生产产物。
- 320、390、768、820、981、1024、1280、1440 px × 中英 × 首页／部署指南 × 明暗，共 64 组无横向溢出、导航越界、标题溢出或页面异常。
- 320 与 1440 px 的中英首页和文档页、缺失路由通过 axe WCAG 2/2.1/2.2 A/AA 标签扫描。
- 14 对页面双向切换、13 对正文的章节切换、查询参数、首页章节、导航与正文链接均通过。
- 中文与英文文档和 404 的搜索范围、空结果、Escape，手机菜单与页面切换、手机搜索、主题跨语言保留和跟随系统、代码复制均通过。
- 28 页的原始 HTML 语言、canonical、相互 hreflang，以及 28 个 Markdown twins、sitemap、llms 与 robots 通过。
- 使用内存中的缺失译文清单验证语言入口不可用与严格检查报错；共享 query/hash 和显式 locale 链接解析通过。

见[布局记录](assets/2026-09-08-docs-bilingual/layout-checks.json)、[交互与元数据记录](assets/2026-09-08-docs-bilingual/interaction-checks.json)、[缺失译文与链接契约](assets/2026-09-08-docs-bilingual/contract-checks.json)。

双语截图：[英文桌面浅色](assets/2026-09-08-docs-bilingual/home-1440-light.webp)、[英文桌面深色](assets/2026-09-08-docs-bilingual/home-1440-dark.webp)、[英文手机首页](assets/2026-09-08-docs-bilingual/home-390-light.webp)、[英文文档](assets/2026-09-08-docs-bilingual/docs-1440-light.webp)、[手机深色文档](assets/2026-09-08-docs-bilingual/docs-390-dark.webp)、[320 px 菜单](assets/2026-09-08-docs-bilingual/mobile-menu.webp)。

## 验证

标题修复：中英文首页使用独立 `seoTitle`，浏览器标题分别为
`AlphaPing · 开源自托管监控` 和 `AlphaPing · Self-hosted infrastructure monitoring`；
文章继续使用 `Page title | AlphaPing`。标题通过 svedocs 同步到 Open Graph、Twitter 和 JSON-LD。
语言切换组件的运行时导入改为 `svedocs/routes`，避免开发模式预打包 `svedocs/core` 时引入
Node.js `os` / `fast-glob` 并中断 hydration。开发浏览器已验证首页、文档和语言切换，
每页仅一个 title，初始化与客户端导航无异常。

发布准备：生产域名通过被忽略的真实 Wrangler 配置和 `DOCS_SITE_URL` 注入。
Turbo build 显式传递并缓存此变量。使用 Cloudflare Custom Domain 管理 DNS 与证书，
Worker 保持独立部署。补充 svedocs、Lucide / Feather notice，并生成部署产物的依赖许可证文件。
审计发现 `sharp` 0.34.5 继承的 libvips 漏洞（GHSA-f88m-g3jw-g9cj），已用作用于 svedocs
的 override 固定到 0.35.4；更新后的文档生产依赖审计为 0 漏洞。Gitleaks 文档目录扫描无泄露，
Cargo deny 的 advisories、bans、licenses、sources 均通过。

全仓 `pnpm verify` **未全部通过**：Agent 的
`capacity_pressure_preserves_recent_unassigned_samples` 与
`capacity_pressure_compacts_old_samples_to_one_per_minute` 两项未修改的 spool 测试失败，
串行复测仍失败。单独继续执行的 Web 性能 E2E 在本地 CONTROL_DB fixture 查询时被 SIGTERM
终止，Ingest E2E 遇到 Wrangler fetch failed。其余 Rust workspace 测试、类型、JS/Worker 测试、
D1 migration/schema、成本模型、Rust fmt/clippy、Agent 资源检查和全工作区构建通过。
Live WebSocket 测试曾出现一次消息超时，独立复测和后续完整运行均通过。
这些结果保留在[标题与发布检查记录](assets/2026-09-08-docs-bilingual/title-release-checks.json)。

文档站通过独立的生产预检并部署到 Cloudflare Custom Domain，仅绑定 ASSETS。
线上 HTTPS 首页及英文首页均为 HTTP 200；逐页验证 28 个页面的唯一 title、对应语言文案、
canonical、hreflang、Open Graph / Twitter 标题、SPA 语言切换、章节、搜索、404、
手机菜单、主题、复制、Markdown、sitemap 和许可证文件，共 23 组交互检查，无浏览器异常。
见[线上验证记录](assets/2026-09-08-docs-bilingual/live-checks.json)。域名、版本 ID、构建摘要与部署时间
保存在被忽略的 `apps/docs/.wrangler/docs-deployment.json`。该 Worker 的后续更新可按 Cloudflare
部署版本独立回滚；本次是首次生产部署，没有之前的文档生产版本。

- `pnpm docs:check`：Svelte 检查 0 errors / 0 warnings；svedocs 严格检查 28 pages / 136 search records / 0 errors / 0 warnings。
- `pnpm format:check`、`pnpm lint`、`git diff --check`：通过。
- `node --test scripts/deploy-workers.test.mjs`：通过；部署发现包含独立 docs 应用。
- `pnpm docs:build`：Cloudflare 生产构建与 Wrangler dry-run 通过。
- `pnpm workers:deploy --worker docs --env production --dry-run`：通过，部署脚本先重建 SvelteKit。
- Chromium：1440×900、1280×720、768×1024、390×844，明暗模式下检查首页、部署指南、独立关于页、404；32 个组合无横向溢出，各有一个 main 和 h1，axe WCAG 2/2.1/2.2 A/AA 标签扫描无违规。
- 搜索快捷键、搜索结果与空结果、Escape、代码复制、主题持久化和系统变化、手机导航及目录跳转通过；浏览器未记录页面异常。
- Wrangler 本地运行生产产物：HTML、中文搜索键盘选择、代码 tabindex、canonical、sitemap、robots、llms 和 Markdown 接口通过，缺失页面返回 HTTP 404。

[浏览器记录](assets/2026-09-08-docs/browser-checks.json)与[生产产物记录](assets/2026-09-08-docs/production-checks.json)。
可访问性扫描是本次验证结果，不代替完整的人工作品审计或所有浏览器的平台验证。

## 2026-09-09 提交前复验

本次重新执行 `pnpm verify`，全流程通过：格式、lint、全仓类型检查与测试、D1 migration/schema、成本模型、Rust fmt/clippy/workspace tests、Agent 资源检查、全部应用构建、Web E2E 和所有 Worker 的部署 dry-run。上方 spool 与 E2E 失败保留为此前运行记录，本次未复现。

另行执行 Ingest E2E，通过 enrollment、加密上报、ACK、重放和篡改拒绝、配置与更新命令、密钥轮换及 D1 状态验证。

文档站使用生产 origin 单独构建和执行部署 dry-run，通过且仅绑定 ASSETS。生产依赖审计为 0 漏洞；Cargo deny 的 advisories、bans、licenses、sources 均通过。暂存的 116 个文件通过 Gitleaks 扫描，并检查未包含真实 Wrangler 配置、账号 ID、生产域名、机器路径和私钥。

本次仅发布独立的文档 Worker，无数据库迁移、控制面或 Agent 发布。部署前已读取当前文档版本用于回滚；生产版本与线上检查结果继续保存到被忽略的本地部署记录。

## 截图

- [首页浅色桌面](assets/2026-09-08-docs/home-desktop-light.webp)
- [首页深色桌面](assets/2026-09-08-docs/home-desktop-dark.webp)
- [首页手机](assets/2026-09-08-docs/home-mobile-light.webp)
- [文档桌面](assets/2026-09-08-docs/docs-desktop-light.webp)
- [文档深色手机](assets/2026-09-08-docs/docs-mobile-dark.webp)

## 部署边界

仅支持 Cloudflare Workers + Static Assets，页面预渲染，搜索在浏览器本地完成。
唯一绑定为 ASSETS，不增加 D1、DO、R2、认证或遥测访问；无数据库迁移、协议或权限变化。
实际 hostname 由部署者配置，`DOCS_SITE_URL` 在构建时生成绝对元数据；测试使用 example.com 占位域名。
文档站可独立发布和回滚，已完成首次文档生产部署；全仓校验的剩余问题见上方记录。
