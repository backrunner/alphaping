---
title: 关于 AlphaPing
description: AlphaPing 的开发状态、贡献方式与开源许可。
---

## 开发状态

AlphaPing 使用 Rust Agent 采集机器指标、执行服务检查，在 Cloudflare 上提供管理界面、历史查询和公开状态页。

项目处于早期开发阶段。当前采用手动部署，Agent 的原生服务安装、重启与升级需要按平台分别验证。

## 参与开发

仓库使用 pnpm 和 Cargo workspace。获取代码后，可以运行完整的本地验证：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

贡献前请阅读 [CONTRIBUTING](https://github.com/BackRunner/alphaping/blob/main/CONTRIBUTING.md) 与[行为准则](https://github.com/BackRunner/alphaping/blob/main/CODE_OF_CONDUCT.md)。问题反馈和改进建议可以在 [GitHub](https://github.com/BackRunner/alphaping) 中提出。

## 开源许可

AlphaPing 采用 [Apache-2.0](https://github.com/BackRunner/alphaping/blob/main/LICENSE) 许可证，第三方组件遵循各自许可。
