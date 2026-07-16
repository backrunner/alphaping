# Agent 协议与安全设计

## 1. 安全目标

- 抵抗窃听、篡改、重放、伪造 Agent、token 泄露后的长期滥用和服务端数据库泄露。
- 对今天被录制的链路流量提供 harvest-now-decrypt-later 防护。
- 上报 payload 在 Cloudflare TLS 终止之后仍以应用层密文形式进入 ingest 处理。
- 允许密钥轮换、Agent 撤销、协议升级和离线补报。
- 不提供任意远程代码执行或任意 URL 更新能力。

非目标：

- 不宣称 V1 已具备完整的后量子身份认证。Cloudflare visitor-to-edge TLS 当前支持 PQ hybrid key agreement，但边缘证书签名仍以经典算法为主。
- 不自创 ML-KEM 组合、Noise variant 或未经审计的握手协议。
- 不将配置的机器 IP 当作身份认证。

## 2. 威胁模型

| 威胁 | 防护 |
| --- | --- |
| 被动抓包并未来解密 | TLS 1.3 `X25519MLKEM768` hybrid key agreement |
| TLS 终止后内部误读 payload | 应用层 AES-256-GCM envelope |
| enrollment token 被数据库读取 | 仅存 HMAC/digest、短时、一次性 |
| report 重放 | key epoch + 单调 sequence + replay window |
| nonce 重用 | 每个方向独立 key、固定 nonce prefix + 64-bit sequence |
| D1 泄露 Agent key | root secret 由 versioned master wrapping key 加密 |
| 恶意 command | 固定 command enum、严格 payload schema、过期时间和签名更新策略 |
| 恶意更新包 | TUF 风格元数据、hash、长度、签名、版本策略、回滚 |
| HTTP 检查 SSRF | 地址分类、DNS 重绑定复核、私网/metadata deny、端口限制 |
| 大 payload 资源耗尽 | body、protobuf field、decompress ratio、response body 上限 |

## 3. 密码算法

### 3.1 传输层

- TLS 1.3。
- 默认 key exchange group 只启用或最高优先 `X25519MLKEM768`。
- Rust Agent 使用 rustls 0.23.27 或更高版本，并以 aws-lc-rs provider 提供该 hybrid group。
- 服务端使用 Cloudflare Worker custom domain 或 `workers.dev`。Cloudflare 对 visitor-to-edge TLS 1.3 支持 `X25519MLKEM768`。
- V1 的兼容回退到经典 X25519 必须通过显式配置开启，并在管理界面显示持续安全警告和 Agent capability。

### 3.2 应用层

- Root secret：256-bit CSPRNG 随机值，每个 Agent/key epoch 独立。
- KDF：HKDF-SHA-256。
- AEAD：AES-256-GCM。
- Digest/HMAC：SHA-256/HMAC-SHA-256。
- Agent identity：Ed25519，用于设备连续性和 enrollment request 签名。
- 随机源：Rust `getrandom`/OS CSPRNG，Worker `crypto.getRandomValues()` 或 workers-rs 安全绑定。

AES-256 和 SHA-256 在量子攻击模型下仍提供合理对称安全余量。后量子重点是密钥协商从经典 ECDH 升级为 hybrid ML-KEM。

### 3.3 V1 明确不做

- 不在应用层再次实现 ML-KEM 握手。TLS hybrid 已由成熟库和 Cloudflare 边缘实现。
- 不使用 RSA 包裹数据密钥。
- 不使用 ECB、CBC、固定 IV、自增但不持久化的 nonce 或 `Math.random()`。
- 不复用同一 AEAD key 处理两个方向的数据。

## 4. 密钥层级

```text
Server master wrapping key (MWK, Worker secret, versioned)
  |
  +-- wraps Agent epoch root secret (ARS)
        |
        +-- HKDF "alphaping/v1/c2s/report"  -> client_to_server_key
        +-- HKDF "alphaping/v1/s2c/control" -> server_to_client_key
        +-- HKDF "alphaping/v1/c2s/nonce"   -> c2s 32-bit nonce prefix
        +-- HKDF "alphaping/v1/s2c/nonce"   -> s2c 32-bit nonce prefix
```

- MWK 为 32 bytes，存储于 Worker secret/Secrets Store，不进入 D1、日志或 source。
- D1 `agent_keys.wrapped_data_key` 保存使用 MWK 加密的 ARS。
- MWK rotation 使用 `wrapping_key_id`。新写入使用新 MWK，旧 MWK 在重包裹完成前只读保留。
- ARS 默认每 30 天轮换，也可以在 Agent 重装、sequence 状态丢失、疑似泄露或管理员撤销时立即轮换。
- 轮换允许最多 24 小时旧 epoch overlap，以支持在途和离线 batch。撤销事件不提供 overlap。

## 5. Enrollment

### 5.1 Token

- 生成 32 random bytes，以 base64url 无填充编码。
- 默认 15 分钟过期，单次成功使用后立即标记 `used_at`。
- 服务端保存 `HMAC-SHA256(enrollment_pepper, token)`，不保存 token 原文。
- 创建响应只显示一次 token。重新打开页面只允许撤销并生成新的 token。

### 5.2 Agent identity

- 首次启动生成 Ed25519 keypair。
- Linux identity file 权限 0600 且由 service user/root 拥有。
- macOS 优先 System Keychain，无法使用时退回受限文件并显示 capability。
- Windows 使用 DPAPI LocalMachine 保护私钥和 ARS。
- Agent identity private key永不上传。

### 5.3 请求

`EnrollmentRequest` 包含：

- enrollment token
- machine claim ID
- Agent identity public key
- request nonce
- platform、arch、Agent version
- supported protocol versions
- supported TLS/PQ capability
- 对上述 canonical bytes 的 Ed25519 signature

### 5.4 响应

Ingest 在 D1 事务中：

1. 校验 token digest、expiry、unused、machine 和 workspace。
2. 检查 machine 是否已有 active Agent，并应用替换策略。
3. 创建 Agent ID 和 key epoch。
4. 生成 ARS 和 directional nonce prefixes。
5. 使用 MWK 包裹 ARS 后写入 D1。
6. 标记 token used。

响应在 PQ hybrid TLS 内返回：

- agent ID
- key epoch
- ARS
- 初始 client/server sequence 起点
- protocol/config revision
- server time 和允许偏差
- report/size/interval limits

ARS 不再通过任何管理 API 返回。

## 6. Report envelope

### 6.1 外层字段

以下 header 保持明文，以便路由和查 key，但全部作为 AEAD AAD：

- magic: `APNG`
- envelope version
- agent ID
- key epoch
- sequence `uint64`
- sent_at Unix milliseconds
- compression enum
- ciphertext length
- report ID
- 12-byte nonce，必须等于派生 prefix + big-endian sequence

Ciphertext 解密后是 `ReportBatch` protobuf。

### 6.2 Nonce

AES-GCM nonce 固定 96 bits：

```text
32-bit direction-specific prefix || 64-bit sequence
```

- c2s 与 s2c 使用不同 key 和 prefix。
- sequence 必须持久化，不能只存在内存。
- Agent 如果检测到 sequence 文件丢失或回退，停止上报并重新 enrollment/key rotation，禁止从 0 继续使用旧 epoch。
- sequence 接近上限时必须提前轮换。

### 6.3 压缩

- 顺序固定为 protobuf encode -> bounded zlib/DEFLATE compress -> AEAD encrypt。压缩算法属于协议版本，未来切换不得静默复用 V1。
- 解密后先检查声明长度和最大解压比，再解压。
- V1 单个 HTTP envelope hard limit 为 64 KiB，使 D1 5 分钟 block 的 5 个 report slots 理论最大仍只有 320 KiB。
- 大量离线数据拆为多个 batch，不能提交超大 envelope。

## 7. 重放和时间验证

- 服务端按 agent/key epoch 维护 highest sequence 和有界滑动窗口。
- 默认允许有限乱序以支持并发/重试，但同一 sequence 只接受一次。
- report ID 作为 processor 幂等键，不能替代 cryptographic replay check。
- `sent_at` 默认允许正负 10 分钟偏差。离线补报以 sample observed_at 表达历史，不伪造 envelope sent_at。
- 服务端响应包含 server time，Agent 用于诊断时钟偏差，不直接修改系统时间。

## 8. Server response 和配置下发

成功 report 的响应使用 s2c key 加密 `ServerControlBatch`：

- ack report ID/sequence
- desired config revision
- full config 或 delta
- pending allowlisted commands
- key rotation proposal
- server time 和 next report guidance

配置 snapshot 包含 revision、created_at、完整内容 BLAKE3 digest 和最多 32 个结构化 probe task。Secret 只在 Ingest 内存中从 CONTROL_DB 解密，再放入 s2c AEAD 明文；日志、D1 telemetry 和 Web 投影都不得包含 secret value。Agent 先验证 digest、任务归属字段、周期、timeout 和 payload 上限，再以 SQLite transaction 替换 last-known-good config，并在后续 report 回报 applied revision。

每个 probe result 必须绑定 `check_id/check_pk/service_pk/workspace_pk`、执行 Agent ID、assignment revision、确定性 execution ID 和 nominal slot。Ingest 重新查询当前 assignment；重指派前的 Agent、旧 revision、错误 phase 或跨 workspace 结果一律拒绝。

HTTP 状态码只表达 transport/auth 大类。详细错误码必须避免泄露 Agent 是否存在、token 是否匹配特定机器或密钥版本细节。

### 8.1 Live WebSocket 安全

Live channel 是独立、非权威的实时加速层，不复用 durable report key/sequence：

1. Rust Ingest 在已认证 durable response 中签发 Agent live credential。Session ID/key/nonce prefix 由至少 32-byte `LIVE_TICKET_SECRET`、Agent/machine scope 和 10 分钟 slot 使用域分离 HMAC-SHA-256 派生；同一 slot 稳定、跨 slot 不复用，expiry 为 slot 起点加 15 分钟。
2. Credential 的 32-byte session key 只存在 durable AEAD 明文中；HMAC-signed ticket 只含 workspace、Agent、topic、session ID、4-byte nonce prefix、not-before/expiry 和 projection，不包含 ARS、MWK、durable directional key 或 live session key。
3. Web 必须先完成 machine-level RBAC，再签发最长 5 分钟的 viewer ticket；ticket 只允许一个 `machine:<pk>` topic 和 `machine-summary` projection。Ticket 通过 `Sec-WebSocket-Protocol` 传递，不进入 URL、访问日志或浏览器持久存储。
4. Agent frame 固定为：`APL1` magic 4 bytes、session ID 16 bytes、machine PK big-endian u64、sequence big-endian u64、observed-at big-endian u64、ciphertext length big-endian u32、AES-256-GCM ciphertext/tag。前 44 bytes 是 AAD；nonce 为 4-byte session prefix + 8-byte sequence；明文是最多 2 KiB 的 protobuf `MetricSample`，整帧最多 16 KiB。
5. Agent 在 SQLite transaction 中先持久化 session ID 和下一个 sequence，再构造 frame；同一 session 重启后继续单调递增，新 session 才从 1 开始，单 session 上限 1,000,000，避免崩溃后 nonce reuse。
6. Hub 对 session/machine scope、sequence replay/jump、20 秒 freshness 和 5 秒 future skew fail closed。Hibernation 后内存 highest sequence 可以丢失，但持久 Agent sequence、短 session 和 freshness 共同限制重放；Live 帧不能触发持久、告警或命令副作用。
7. Hub 只下发 30 秒 TTL demand 和协议错误，不传送管理命令、更新指令或 config secret。Viewer 每 15 秒刷新 demand；没有有效 demand 时 Agent 不生成应用 frame。
8. Viewer 只收到经过固定字段投影的 JSON summary；公开 viewer 不得获得 IP、Agent ID、容器内部 ID 或详细错误。

WebSocket 连接仍使用 TLS 1.3 `X25519MLKEM768`。Live channel 失败不改变 Agent 的采集、SQLite spool、durable report 或退避状态。

## 9. Command 安全

允许的命令类型：

- `REFRESH_CONFIG`
- `CHECK_UPDATE`
- `UPDATE_TO_VERSION`
- `REDETECT_CONTAINERS`
- `ROTATE_KEY`
- `ENTER_MAINTENANCE`/`EXIT_MAINTENANCE`，如需要 Agent 行为

禁止：

- shell command
- arbitrary executable
- arbitrary download URL
- 任意文件读写
- 任意环境变量回传

每个 command 包含 ID、not-before、expires-at、attempt limit 和 payload schema version。Agent 保存最近 command ID，重复投递返回已有结果而不是再次执行副作用。

## 10. Agent 自动更新

### 10.1 信任模型

- GitHub Releases 只作为分发渠道，不作为唯一信任根。
- Agent 内置 TUF 风格 root metadata 和离线 root keys。
- Release pipeline 生成 timestamp、snapshot、targets metadata，包含版本、平台、长度、SHA-256 和签名。
- Root/targets key 与在线 timestamp key 分离，root 使用 threshold signatures。
- 元数据有 expiry，防止 freeze attack。

### 10.2 检查

- 默认 6 小时加 0-30 分钟抖动。
- 使用 GitHub API/静态 metadata 的 ETag 和 `If-None-Match`。
- 面板强制检查可显式绕过时间间隔与 rollout 百分比，不绕过签名、expiry、版本存在性、平台或 hash。
- 支持 stable channel 和显式 pinned version。
- Release origin 固定为 `alkinum/alphaping` 的 versioned assets，Agent command 不包含 URL；`bypass_rollout` 只绕过灰度百分比，不能绕过 metadata expiry、threshold signature、长度或 hash。
- Production build 必须通过 `ALPHAPING_UPDATE_ROOT_JSON` 编译期嵌入 public root；缺少 root 时监控继续运行，但所有更新 fail closed。

### 10.3 安装和回滚

1. 下载到同文件系统临时路径。
2. 验证 TUF metadata、长度、hash、签名和二进制版本。
3. fsync 文件和目录。
4. 停止/切换 service，原子替换或使用版本目录 + current pointer。
5. 启动新版本并等待本地 health check。
6. 超时或崩溃则恢复上一版本并记录 command result。

Windows 使用独立 updater helper 完成正在运行 executable 的替换。

命令通过加密 `DurableAck.commands` 下发，Agent 在删除 report 前写入 SQLite。结果通过后续 `MachineReport.command_results` 回报并得到 durable ACK 后才清除本地 command ID。服务端和 Agent 都只接受固定 protobuf 字段，不接受 shell、任意 URL、stdout/stderr 或自由文件路径。

## 11. 中央 HTTP/TCP 检查安全

- URL 只允许 `http`/`https`。
- 解析 DNS 后拒绝 loopback、link-local、multicast、unspecified、Cloudflare metadata 和 RFC1918/ULA 地址，除非未来由明确私网产品提供。
- 重定向每一跳重新执行地址分类，防止 DNS rebinding/redirect SSRF。
- 禁止用户控制 Host 以访问内部目标，除非与目标域名规则一致。
- response headers/body 有总大小上限，超限返回明确 failure code。
- regex 使用线性时间引擎或设置复杂度/长度限制。
- TCP 目标端口可以由用户配置，但必须阻止平台禁止端口和内部地址。

Agent 执行器允许访问其本地网络，但管理员界面必须说明这是远程网络访问能力，普通 `manage` 用户能否创建私网目标由 workspace policy 控制。

## 12. 数据最小化

- 机器样本不包含进程列表、命令行、用户列表或文件内容。
- 容器样本不包含环境变量、secret、日志正文和挂载文件内容。
- HTTP 检查结果只保存 assertion 摘要、状态、延迟和受限诊断，不默认保存完整响应 body。
- 自定义请求 header/body secret 只保存包裹密文，读取 API 永不回显。
- 公共投影默认隐藏 IP、内部域名、Agent ID、版本细节和 failure stack。

## 13. 速率和滥用防护

- enrollment 按 IP、machine claim 和 token digest 限速。
- report 按 Agent ID 和 workspace 设 token bucket，允许合理离线补报 burst。
- hard limit 先于 protobuf decode 和解压。
- 连续 AEAD 失败触发短时冷却和安全事件，但避免可被利用的永久锁死。
- workspace 设置最大 Agent 数、最大检查数、最短周期和每日中央检查预算。

## 14. 日志与错误

允许记录：

- correlation ID、workspace/agent opaque ID、route、result code、duration、payload bytes、key epoch。

禁止记录：

- token、ARS、MWK、完整 ciphertext/plaintext、Authorization/Cookie、检查 secret、完整 URL query。

错误日志中的目标 URL 必须去除 userinfo、query 和 fragment，必要时只记录 hostname hash。

## 15. 安全验证

- 协议 golden vectors 跨 Rust/TypeScript 一致。
- property/fuzz tests 覆盖 envelope parser、protobuf limits 和 assertion evaluator。
- 重放窗口测试乱序、重复、epoch 切换、sequence 回退和并发。
- enrollment 并发消费测试保证只有一个成功。
- SSRF 测试覆盖 IPv4/IPv6、整数/八进制表达、DNS 重绑定和 redirect。
- 更新测试覆盖过期元数据、rollback、freeze、hash mismatch、错误平台和失败回滚。
- 定期第三方密码学与威胁模型评审，V1 稳定发布前至少完成一次。

## 16. 后量子声明边界

对外文档只能声明：

> AlphaPing Agent 在兼容环境中使用 TLS 1.3 X25519MLKEM768 混合密钥协商，保护传输密钥免受 harvest-now-decrypt-later 风险，并对 Protobuf payload 使用独立的 AES-256-GCM 应用层加密。

不能声明“全链路完全后量子认证”，直到 visitor-to-edge 证书认证、Agent identity 和更新签名都完成可验证的 PQ signature 迁移。
