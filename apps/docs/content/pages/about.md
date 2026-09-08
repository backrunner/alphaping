---
title: 关于 AlphaPing
description: 一个开源、自托管的基础设施监控项目，为个人、团队和小型组织而建。
---

## 项目方向

AlphaPing 把轻量 Rust Agent、Cloudflare 控制面和可定制的公开状态页连接起来。我们希望让运行状态易于阅读，让数据和访问边界清楚可控。

项目处于早期开发阶段。当前采用手动部署，Agent 的原生服务安装、重启与升级需要按平台分别验证。

## 参与开发

仓库使用 pnpm 和 Cargo workspace。获取代码后，可以运行完整的本地验证：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

贡献前请阅读 [CONTRIBUTING](https://github.com/BackRunner/alphaping/blob/main/CONTRIBUTING.md) 与[行为准则](https://github.com/BackRunner/alphaping/blob/main/CODE_OF_CONDUCT.md)。问题反馈和改进建议可以在 [GitHub](https://github.com/BackRunner/alphaping) 中提出。

## 文档与许可

文档站使用 svedocs，主题遵循 AlphaPing 的设计系统。站点只发布经过整理的公开使用说明，不自动发布内部评审记录。

AlphaPing 采用 [Apache-2.0](https://github.com/BackRunner/alphaping/blob/main/LICENSE) 许可证，第三方组件遵循各自许可。
