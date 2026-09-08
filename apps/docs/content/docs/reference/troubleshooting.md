---
title: 排查问题
description: 从最近一次成功状态入手，区分安装、报告、实时连接与执行器故障。
order: 2
---

## 机器一直等待首次上报

检查系统服务是否启动，安装令牌是否过期，以及控制面与 Ingest 的 HTTPS 配置是否可达。对照安装器输出查看自检结果与恢复位置。

如果机器已经完成注册，不要反复重新生成令牌或删除 identity。保留注册状态，先定位服务或网络问题。

## 实时连接中断，但机器仍在线

这是两个不同的观察结果。WebSocket 可能因网络切换、代理或浏览器休眠中断；机器在线状态依据最近的持久报告判断。

查看最近成功更新时间，确认页面已回退到持久数据，再检查 Live Worker 与浏览器网络连接。

## 服务检查失败

1. 确认检查类型和执行器。Cloudflare 不支持 ICMP。
2. 从实际执行位置核对目标可达性；本机可达不代表 Cloudflare 可达。
3. 检查预期状态码、超时、TLS、重定向和响应断言。
4. 查看连续失败确认次数，区分单次失败与已确认故障。

Cloudflare 检查有目标地址与响应大小限制，不应将检查器当作任意内网请求代理。

## 容器列表出现权限错误

确认 Agent 服务账户能访问对应 runtime socket。系统 daemon 不会自动继承登录用户的 HOME、Docker 或 Colima 运行环境。

权限错误不表示容器列表为空。调整权限后检查运行时连接状态，而不是通过扩大公开范围处理。

## 安装器拒绝覆盖已有安装

这是对现有身份、配置和 spool 的保护。升级走签名 updater；失败恢复按安装器提供的位置操作，不能通过删除 SQLite 绕过。

参考[Agent 安装与恢复规范](https://github.com/BackRunner/alphaping/blob/main/.agents/14-agent-installation.md)。

## 提交反馈

在 [GitHub Issues](https://github.com/BackRunner/alphaping/issues) 中描述版本、平台、复现步骤和可观察的错误。删除令牌、cookies、私钥以及敏感目标地址后再附日志。

安全漏洞请通过[私密安全报告](https://github.com/BackRunner/alphaping/security/advisories/new)提交。
