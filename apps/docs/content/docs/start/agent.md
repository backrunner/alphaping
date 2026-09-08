---
title: 安装 Agent
description: 使用控制面生成的一次性安装命令，将 Linux、macOS 或 Windows 机器接入监控。
order: 2
---

## 支持的平台

| 系统                      | 架构                     | 服务管理          |
| ------------------------- | ------------------------ | ----------------- |
| Linux                     | x86_64、ARM64；静态 musl | systemd 或 OpenRC |
| macOS 11+                 | Intel、Apple silicon     | launchd           |
| Windows 10 / Server 2016+ | x64、ARM64               | Windows Service   |

安装需要管理员或 root 权限。Windows 需要 PowerShell 5.1 或 7，以及兼容的 .NET Framework。32 位平台不支持；没有 init 的 Linux 容器或 WSL 不会自动安装宿主服务。

## 创建机器与令牌

1. 在控制面选择 **添加机器**，填写名称、标签和采样配置。
2. 创建 enrollment token，选择 Shell 或 PowerShell 平台。
3. 检查目标机器和命令内容，复制页面生成的完整安装命令。
4. 在目标机器的管理员终端运行，完成后等待首次成功上报。

令牌默认在 15 分钟后过期，只能成功使用一次。已过期或撤销的令牌需要重新生成。安装命令包含敏感凭据，请按自己的终端历史管理方式妥善处理。

## 安装过程验证什么

控制面提供的命令先下载脚本并验证 SHA-256，脚本随后检查系统、架构、权限和已有安装，再下载并校验 Agent 的长度、哈希和版本，注册后执行自检并启动系统服务。

首次安装的信任锚是控制面 HTTPS manifest；后续自动升级使用签名元数据。部署者需要先完成[签名发布配置](https://github.com/BackRunner/alphaping/blob/main/.agents/12-release-and-agent-updates.md)，不能把普通 CI 产物直接视为生产更新源。

## 检查是否成功

机器第一次成功上报后，页面会展示资源指标、Agent 版本和最后上报时间。尚未上报时显示等待状态；缺失指标不会显示为虚构的零值。

如果失败，先查看安装器提供的恢复位置和系统服务状态。不要删除 identity 或 SQLite spool 强行重装；身份、密钥与传输序号需要保持一致。

## 容器与权限

Agent 可探测 Docker、Colima 提供的运行时和 Apple container。以系统服务启动的 Agent 不会自动拥有登录用户的容器 socket 权限。连接失败会显示为连接或权限问题，详见[机器与容器](/docs/guides/machines)。

完整平台限制、服务恢复与本地存储兼容性见[安装与恢复规范](https://github.com/BackRunner/alphaping/blob/main/.agents/14-agent-installation.md)。
