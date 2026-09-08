# 品牌 Logo 统一（2026-09-08）

Dashboard/管理后台侧栏、登录、工作区、邀请、初始化与错误页改为复用 `SiteLogo`，移除旧字母 A、Activity 品牌占位和配套的实色底框。公开页的四处 Powered by 署名通过共享组件使用同款小 Logo。默认图形继续来自 `apps/web/src/lib/assets/alphaping.svg`，与 favicon 一致。

公开导航的自定义 Logo 和外观预览继续使用既有校验、固定尺寸、contain 显示与失败回退；产品署名保留 AlphaPing 标志。未新增依赖或修改数据接口。

- `pnpm --filter @alphaping/web check`、`pnpm lint`、`pnpm format:check`、Web 生产构建及本地 Worker E2E 通过。
- Chromium 检查 11 个页面 × 桌面浅色/320px 手机深色，共 22 组；所有品牌图像可见、解码成功且使用同一默认 SVG，无页面错误、横向溢出或 axe WCAG A/AA 违规。
- 自定义 Logo 预览成功和坏图片回退通过。测试仅使用本地合成数据。

[浏览器检查结果](assets/2026-09-08-brand-consistency/browser-checks.json) · [Dashboard 桌面](assets/2026-09-08-brand-consistency/dashboard-desktop.png) · [手机导航](assets/2026-09-08-brand-consistency/dashboard-mobile.png) · [登录页](assets/2026-09-08-brand-consistency/login-mobile.png)
