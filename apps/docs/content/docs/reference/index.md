---
title: 技术参考
description: 了解控制面与 Agent 的边界，以及部署和运行中的排查方法。
order: 3
---

## 系统与排查

- [系统架构](/docs/reference/architecture)：理解持久报告、实时快照、存储与权限边界。
- [排查问题](/docs/reference/troubleshooting)：处理未上报、实时中断、服务检查和安装问题。

## 仓库规范

更详细的维护文档保留在仓库中：

- [协议与安全](https://github.com/BackRunner/alphaping/blob/main/.agents/05-agent-protocol-security.md)
- [Cloudflare 成本模型](https://github.com/BackRunner/alphaping/blob/main/.agents/06-cloudflare-storage-cost.md)
- [签名发布与自动更新](https://github.com/BackRunner/alphaping/blob/main/.agents/12-release-and-agent-updates.md)
- [D1 备份与恢复](https://github.com/BackRunner/alphaping/blob/main/.agents/13-d1-backup-and-recovery.md)

这些规范随实现更新。需要具体环境变量、发布命令或恢复流程时，请以对应规范和提交中的配置模板为准。
