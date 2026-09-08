---
title: 开始使用
description: 从准备环境到接入第一台机器，建立自己的监控实例。
order: 1
---

## 准备工作

你需要一个 Cloudflare 账户、可用的 Worker 与 D1 资源，以及一台准备安装 Agent 的受支持机器。

当前部署需要操作命令行、配置 Wrangler 和管理 secrets。先在评估环境确认流程，再部署到自己的正式环境。

## 接入顺序

1. [部署控制面](/docs/start/deployment)，完成数据库迁移与首次初始化。
2. [安装 Agent](/docs/start/agent)，等待机器首次成功上报。
3. [添加服务检查](/docs/guides/services)，选择执行器与故障确认次数。
4. [配置公开状态页](/docs/guides/status-pages)，明确哪些资源可以对外展示。

## 只监控服务

如果只需要从 Cloudflare 执行 HTTP 或 TCP 检查，可以先部署控制面并创建服务，无须先接入机器。ICMP 检查需要选择 Agent 执行器。
