---
title: 系统架构
description: Cloudflare 控制面与 Rust Agent 分工协作，持久数据与实时观察各有边界。
order: 1
---

## 部署单元

| 单元          | 主要职责                                   |
| ------------- | ------------------------------------------ |
| Web           | SvelteKit 界面、认证、权限、配置与历史查询 |
| Ingest        | Agent 注册、认证、解密、持久遥测事务与 ACK |
| Live          | 按工作区隔离的 Hibernation WebSocket Hub   |
| Checks        | 定时 HTTP / TCP 服务检查和状态处理         |
| Notifications | 消费状态事件，异步发送通知                 |
| Retention     | 分批清理、保留期与压缩任务                 |
| Docs          | 独立的产品首页和公开文档，不绑定监控数据库 |

## 持久报告

Agent 在本地暂存尚未确认的报告，上传经过认证和加密的 protobuf envelope。Ingest 在 D1 事务成功后返回持久 ACK，Agent 才能清理相应的待发送数据。

每十秒采集的数据被组织到五分钟 D1 block 的固定 slot 中。日常页面通过最新态和聚合表查询，按需读取有界的原始数据。

## 实时快照

页面可见并订阅时，Live Hub 转发十秒级实时快照。实时帧不写 D1 或 Durable Object storage，不确认 Agent spool，也不触发告警或命令副作用。

因此，实时链路用于观察；持久报告仍是历史和机器状态的权威来源。实时中断后，页面明确标记并回退到持久数据。

## 存储边界

`CONTROL_DB` 保存配置、认证与权限；`TELEMETRY_DB` 保存遥测块、状态和聚合。R2 仅保存显式导出和备份，不用于在线遥测主路径。

保留期可配置。部署规模、检查数量、公开访问量与保留时间都会影响费用，见[成本模型](https://github.com/BackRunner/alphaping/blob/main/.agents/06-cloudflare-storage-cost.md)。

## 安全边界

传输使用 TLS 1.3 混合 `X25519MLKEM768` 密钥协商，加上经过认证的应用层加密 envelope。混合后量子密钥协商不代表完整的后量子身份认证。

Agent 命令与更新地址受允许列表和签名元数据约束，不提供任意 shell 执行。公开页面只接收显式数据投影。
