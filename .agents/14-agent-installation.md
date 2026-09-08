# Agent 快速安装与兼容性

## 平台矩阵

| 系统 | 架构 | 构建目标 / 服务 | 前提 |
| --- | --- | --- | --- |
| Linux | x86_64、aarch64 | 静态 musl / systemd | root；curl、CA 证书、sha256sum 或 shasum |
| Linux / Alpine | x86_64、aarch64 | 静态 musl / OpenRC supervise-daemon | root；已运行的 OpenRC；同上 |
| macOS 11+ | Intel、Apple silicon | 原生 Mach-O / launchd | sudo/root；Rosetta 终端自动选择 Apple silicon |
| Windows 10 / Server 2016+ | x64、ARM64 | 原生 Windows Service | 管理员 PowerShell 5.1 或 7；.NET Framework 4.7.2+ |

32 位平台不支持。WSL、容器或无 init 的 Linux 不自动安装宿主服务。Windows ARM64 有发布 CI 目标，但不代表在所有 ARM Windows / Server 版本上均经过原生验证。macOS `container` 和 Colima 的检测能力与 Agent 基础安装兼容性分开验收；系统 daemon 不会自动获得登录用户的 Docker/Colima socket 或 HOME。

Linux release CI 使用 musl 工具链，并以 ELF `INTERP` 缺失作为静态链接门禁。macOS release CI 固定最低部署版本为 11.0。构建矩阵须在真实 CI 运行后才能声明对应发行版验证通过；当前脚本 fixture 不等价于原生服务验收。

## 快速安装

在有管理权限的机器页面创建 enrollment token，选择 Shell 或 PowerShell，复制完整命令执行。命令先下载到临时文件并验证页面提供的脚本 SHA-256，再执行安装。脚本也可通过控制面 `/install.sh`、`/install.ps1` 查看。

安装脚本依次执行：

1. 检查 HTTPS origin、系统、架构、必要工具、服务管理器和权限。
2. 检查 binary、identity/config、spool 和服务是否已经存在。存在时停止安装，不停服、不覆盖、不自动消费新 token；升级使用 Agent 的签名 updater。
3. 从部署者控制面 `/agent-release/<target>` 获取不超过 4 KiB 的 manifest。下载仅允许 HTTPS（含每一跳重定向），限制连接/总时间及不超过 64 MiB 的 artifact。
4. 在执行二进制前检查精确长度和 SHA-256，再检查报告版本。首次安装的信任锚是控制面的 HTTPS manifest；它不是脚本本地执行的 TUF 签名验证。部署者应从已验证签名的 release bundle 设置 `AGENT_RELEASE_MANIFEST_JSON`。
5. 保护安装和数据目录，同文件系统 rename 安装，enrollment 后运行 self-test，再创建、启动和检查服务。
6. 安装失败保留 enrollment 状态并输出恢复位置。不要通过删除 SQLite 或 identity 重新安装来绕过错误，这会影响传输 nonce 连续性。

Linux 用 systemd journal 或 OpenRC 服务诊断；launchd 不写无限增长的 stdout/stderr 文件，可通过 `launchctl print system/top.backrunner.alphaping.agent`、self-test 和停止服务后的前台运行诊断。Windows 使用 Service Control Manager 状态和自检。安装 token 为短时一次性凭据，复制命令仍会进入用户自行管理的终端历史。

## 本地存储升级

Agent 启动时收紧 Unix DB/WAL/SHM 权限为 0600，拒绝 symlink spool。SQLite `max_page_count` 为主数据库建立容量限制，预留 8 MiB WAL 空间，并设置 checkpoint 后 journal 的保留上限。现有超限文件不会被强制截断，未 ACK 的 delivery 保留；采样/清理失败不会立即终止上传循环。

敏感 probe configuration 使用独立 HKDF-SHA256 域 `alphaping/v1/local-probe-config`，从稳定的设备 identity secret 派生 AES-256-GCM key，以随机 96-bit nonce 和 revision AAD 加密。启动时将单条旧 plaintext config 原子替换为密文并 checkpoint；其他机器遥测 payload 仍由受限文件权限保护，不应宣称整个 SQLite 文件已加密。身份和 key epoch 不改变，应用配置 API 与 wire protobuf 不变。

本次增加的本地 `probe_config.encrypted` 列向前兼容 SQLite，但旧 Agent 无法解析新的加密配置。升级前保留一致的配置与 spool 备份；回滚应使用能读取此格式的修复版本。不能单独回滚 DB 的 transport sequence，也不能在旧版本上直接重用加密后的 spool。

## 验证

`scripts/installers.test.mjs` 覆盖 systemd、OpenRC、launchd、Windows Service 编排 fixture、四种 Unix OS/arch 选择、已有安装保护、错误 checksum 和不支持架构。Windows fixture 替换平台和下载适配器，在本机 PowerShell 中验证服务编排；尚需发布 CI 的原生安装、重启、自更新和失败恢复验收。
