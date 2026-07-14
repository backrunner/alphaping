# AlphaPing UI 设计系统

## 1. Design read

AlphaPing 是面向 SRE、运维人员和开发者的高密度技术控制台。视觉语言必须安静、克制、可信、便于扫描，接近成熟基础设施产品，而不是营销 landing page。

- `DESIGN_VARIANCE: 3`
- `MOTION_INTENSITY: 2`
- `VISUAL_DENSITY: 9`

含义：布局可预测，动效只解释状态变化，数据密度高，数字和状态优先于装饰。

## 2. 技术基础

- Svelte 5 + SvelteKit。
- Tailwind CSS v4。
- shadcn-svelte 作为 owned component source，必须根据 AlphaPing token 定制，不保留默认主题。
- Bits UI 提供 headless primitives、可访问交互和组合能力。
- Lucide Svelte 作为唯一图标家族，默认 stroke width 1.75。
- 图表库在实现阶段通过 bundle、SSR 和可访问性评估选择，禁止为了简单 sparkline 引入重量级全量库。

shadcn-svelte 和 Bits UI 是同一套组件体系的 source/primitives 层，不再混入另一套视觉 design system。

## 3. 设计原则

1. 状态优先：异常、离线、延迟和更新时间必须比装饰更醒目。
2. 扫描优先：同类数据对齐、数字等宽、标签稳定，不让动态值推动布局。
3. 逐层披露：列表显示最新态，详情显示诊断，图表默认折叠。
4. 少用卡片：只给机器、服务等重复实体使用卡片。页面区段和卡片内部指标不用二次套卡。
5. 颜色有语义：品牌 accent 只表示操作和选择，状态色只表示健康状态。
6. 不靠颜色：状态同时有文字、图标、形状和 ARIA label。
7. 专业文案：使用具体动词和可行动错误，不写营销口号或拟人化空话。

## 4. Color tokens

### 4.1 Light

| Token | Value | 用途 |
| --- | --- | --- |
| `--bg` | `#f6f7f9` | 页面背景 |
| `--surface` | `#ffffff` | 主表面 |
| `--surface-subtle` | `#f0f2f5` | hover/次级分组 |
| `--surface-strong` | `#e7eaee` | selected/pressed |
| `--text` | `#191c20` | 主文本 |
| `--text-muted` | `#626a73` | 次级文本 |
| `--text-faint` | `#858d97` | 辅助时间和占位 |
| `--border` | `#d9dee5` | 边框 |
| `--border-strong` | `#b7c0ca` | focus/active boundary |
| `--accent` | `#2463eb` | 主操作、选中 |
| `--accent-hover` | `#1d4ed8` | hover |

### 4.2 Dark

| Token | Value | 用途 |
| --- | --- | --- |
| `--bg` | `#101214` | 页面背景 |
| `--surface` | `#171a1e` | 主表面 |
| `--surface-subtle` | `#1e2227` | hover/次级分组 |
| `--surface-strong` | `#282d33` | selected/pressed |
| `--text` | `#f1f3f5` | 主文本 |
| `--text-muted` | `#a7afb8` | 次级文本 |
| `--text-faint` | `#7e8791` | 辅助时间和占位 |
| `--border` | `#30363d` | 边框 |
| `--border-strong` | `#4b5561` | focus/active boundary |
| `--accent` | `#5b8cff` | 主操作、选中 |
| `--accent-hover` | `#7aa2ff` | hover |

### 4.3 Status

| 状态 | Light/Dark 基色 | 非颜色表达 |
| --- | --- | --- |
| healthy/online | `#16864b` / `#35b86b` | Check 图标、`正常` |
| degraded | `#a8660b` / `#d79a38` | Triangle 图标、`降级` |
| down/fault | `#c83a3a` / `#ef6262` | X 图标、`故障` |
| offline | `#5f6873` / `#8b949e` | WifiOff 图标、`离线` |
| maintenance | `#6f55b5` / `#a78bfa` | Wrench 图标、`维护` |
| unknown | `#7a828c` / `#929aa4` | CircleHelp 图标、`未知` |

状态背景使用基色的低透明度 tint，文字和图标必须满足 WCAG AA。不要在大面积背景上使用高饱和状态色。

## 5. Typography

- UI：自托管 Geist Sans，fallback 为系统 sans。
- 数字和技术标识：Geist Mono，fallback 为系统 monospace。
- 所有指标数字使用 `font-variant-numeric: tabular-nums`。
- 字距固定为 0，不使用负 letter-spacing。
- 页面标题 20-24 px，section 标题 14-16 px，卡片标题 13-14 px，正文 13-14 px，辅助文字 11-12 px。
- 不在 dashboard 使用 hero-scale 字号。
- 单位与数值分开降权，例如主值 `812`，单位 `MiB/s` 使用 muted token。

## 6. Spacing 与尺寸

基础 spacing unit 为 4 px：

- `1`: 4 px
- `2`: 8 px
- `3`: 12 px
- `4`: 16 px
- `5`: 20 px
- `6`: 24 px
- `8`: 32 px

控件高度：

- Compact：28 px。
- Default：32 px。
- Comfortable：36 px，只用于 setup 和少量表单。
- Icon button：28x28 或 32x32，尺寸固定。

页面外边距：mobile 12 px，tablet 16 px，desktop 20-24 px。高密度页面不使用 64 px 以上区段留白。

## 7. Shape、border 和 elevation

- Card radius：6 px。
- Input/menu/dialog radius：6 px。
- Tooltip radius：4 px。
- Button radius：5 px。
- Status capsule、tag、segmented control item 可以使用 full pill。
- 禁止 12-24 px 大圆角卡片。
- 默认使用 1 px border 表达分组。
- 阴影只用于 popover、menu、dialog 和拖浮层，不给普通 dashboard card 加浮夸阴影。
- 禁止 card inside card。卡片内部用 grid、divider 和 spacing 分组。

## 8. Layer tokens

```text
base       0
sticky     20
dropdown   40
popover    50
overlay    60
dialog     70
toast      80
```

组件只使用 token，不出现随意的 `z-[9999]`。

## 9. App shell

### 9.1 Desktop

- 左侧导航宽 216 px，可折叠为 52 px icon rail。
- 顶栏高 48 px，包含 workspace switcher、全局搜索、时间范围、主题和用户菜单。
- 主内容占满剩余区域，最大内容宽度不强制限制到 marketing-style 1200 px。
- 页面标题行包含标题、简短状态和主要操作，不使用巨大空白。

### 9.2 Mobile

- 顶栏 48 px，使用 familiar menu icon 打开 sheet navigation。
- 机器 grid 单列，metric cell 仍保持 2 列或横向滚动，不把每项变成超高卡片。
- 筛选器进入 bottom sheet/drawer。
- 表格切换为 priority columns + row details，不水平压缩不可读文本。

## 10. Navigation

- 顶层模块按 workspace 实际配置动态显示：Dashboard、Machines、Services、Admin。
- Containers 不作为顶层模块，只在 machine detail 中显示。
- 用户没有 `manage` 权限时不显示配置入口，但服务端仍执行授权。
- 导航选中态使用 accent 左边线或背景 tint，不使用发光效果。
- 图标按钮必须有 tooltip 和 accessible name。

## 11. Dashboard

### 11.1 Overview band

总览是全宽 metric strip，不做一排互不相关的大卡片：

```text
Machines 48 | Online 44 | Problems 3 | Offline 1 | Down 238 Mbps | Up 71 Mbps | Traffic 4.8 TB
```

- 每个 metric 是可点击筛选。
- 数字固定宽度，不因状态变化移动相邻项目。
- 在窄屏变成 2-3 列 grid，而不是横向挤压。

### 11.2 Machine grid

- Desktop 采用 `repeat(auto-fill, minmax(300px, 1fr))`，通常 3-4 列。
- 卡片固定最小高度和内部 track，loading/value changes 不改变布局。
- Header：状态、名称、标签、最后上报。
- Body：CPU、memory、disk 三列 compact meter；network rx/tx 两行；累计流量一行。
- Meter 使用数值 + 小型 inline bar，不使用大背景 progress track。
- 卡片整块可进入详情，右上角只放 overflow menu。

### 11.3 排序与筛选

- 默认异常优先，其次名称。
- 支持 status、tag、OS、Agent version、container enabled。
- 搜索和筛选状态写入 URL query，刷新/分享后保持。
- 批量操作只对有 manage 权限的选中资源显示。

## 12. Machine detail

- Header 紧凑显示名称、状态、最后上报、版本和操作。
- 主 tab 使用 Bits UI Tabs，track 高度固定。
- 概览首屏使用无边框 metric grid 和 sparse dividers。
- 历史图表放在 Disclosure/Collapsible 中，默认关闭。
- 展开前只渲染图表 skeleton 占位，不请求数据。
- Ping/HTTP/TCP task 结果使用一致图表语言，并标记执行器。

## 13. Service monitoring

### 13.1 Service list

- 每行显示服务名、汇总状态、最近延迟、24h availability、检查数和最近变更。
- 列表适合比较，不把每个服务都做成大营销卡。
- 状态变化用短暂 background tint transition，不使用持续 pulse。

### 13.2 Check editor

- 使用类型 segmented control：HTTP、TCP、ICMP。
- 执行器使用 select，选择 Cloudflare 时隐藏/禁用 ICMP。
- Header、body、assertion 使用可增删 rows，但每行字段对齐。
- Secret input 只显示 `已设置`/`替换`，不显示旧值。
- Advanced settings 使用 disclosure，默认不展开。
- 保存前在右侧或底部展示人类可读 summary。

### 13.3 Status capsules

- 每个 capsule 表示固定时间桶，宽高稳定，推荐 6-10 px 宽、20-28 px 高、2 px gap。
- 状态：healthy、degraded、down、maintenance、unknown。
- 当前时间在右侧，过去在左侧。
- Keyboard focus 可以逐项浏览，tooltip 展示区间、状态、availability、latency 和摘要。
- 大范围时聚合 bucket，不在 DOM 渲染数千个 item。
- 状态条下方标注起止时间和整体 availability。

### 13.4 Incident timeline

- Incident 标题、状态、影响范围在 timeline 顶部。
- 更新按时间倒序或正序必须全站一致，推荐最新在上、状态页保留清晰时间。
- 时间轴使用细线和语义图标，不使用 card 套 card。
- 过期公告完全不渲染，不显示“已过期”。

## 14. Admin

- Admin 是任务型控制台：左侧二级导航，右侧表单/表格。
- 机器创建完成后立即显示安装命令、token expiry、复制、重新生成和撤销。
- RBAC editor 使用资源表格 + capability checkbox/segmented control，不使用自由文本 policy editor。
- 保留期设置同时显示估算存储/请求影响。
- 危险操作集中在页面底部 danger zone，二次确认展示具体资源名和影响。

## 15. Setup

- Setup 是唯一允许更舒适间距的流程，但仍是实际安装界面，不做 landing hero。
- 使用 5-6 步 stepper：环境、验证、管理员、workspace、保留策略、完成。
- 每步只有一个主要动作。
- 环境检查显示 D1 binding、migration、secret 和 Worker capability 的明确结果。
- setup token 输入使用 password field，不写 URL、不持久化到 localStorage。

## 16. Charts

- 数字和图线颜色来自 semantic chart tokens，不复用 status red/green 表达非状态系列。
- CPU、memory、disk 使用不同线型/明度，不能只靠色相。
- Network rx/tx 使用成对但可区分的颜色，单位自动切换但 axis 稳定。
- 时间范围：1h、6h、24h、7d、30d、自定义。
- 数据缺口显示 gap，不连接成虚假连续线。
- Hover tooltip 使用同一时间 crosshair。
- 图表必须提供当前、平均、峰值文本摘要。

## 17. Interaction states

每个数据表面必须实现：

- Loading：与最终 grid/row 同形 skeleton。
- Empty：说明缺少什么，并提供唯一下一步操作。
- Error：上下文内错误、重试按钮和 correlation ID。
- Stale：显示最近成功更新时间，不把 stale 数据当 live。
- Live：页面可见时正常每 10 秒更新；超过 20 秒无 live frame 显示克制的“实时连接已中断”状态并回退持久数据。
- Live 中断不等于 machine offline。机器在线状态只由 durable report/offline threshold 判定。
- Permission denied：不泄露资源是否存在。

Toast 只用于短暂结果。表单错误留在字段附近，后台处理状态留在对应资源行。

## 18. Motion

- 只使用 120-180 ms 的 opacity、transform 和 background-color transition。
- 状态变更可以一次性淡入，不持续呼吸或闪烁。
- Dialog/Popover 使用 Bits UI 默认可访问 transition 并尊重 reduced motion。
- 禁止 scroll hijack、parallax、marquee、磁性按钮和装饰性 canvas。
- `prefers-reduced-motion: reduce` 下关闭非必要 transition。

## 19. 可访问性

- WCAG 2.2 AA。
- Focus ring 使用 2 px accent + 1 px surface offset。
- Icon-only button 必须有 `aria-label` 和 tooltip。
- Status badge 有可读文本，胶囊有 `aria-label`。
- 表格 header、sort state、row selection 使用正确语义。
- Dialog focus trap、Escape、return focus 由 Bits UI primitive 保证。
- Live updates 使用克制的 `aria-live=polite` summary，不逐个朗读每个 sample。

## 20. 文案规则

- 使用“添加机器”“重新生成令牌”“立即检查更新”等具体命令。
- 错误说明发生了什么、是否重试、需要什么权限。
- 时间显示相对值和绝对 tooltip，例如 `2 分钟前` + ISO timestamp。
- 网络统一用 upload/download 或 tx/rx 的一种可见表达，面向用户默认“上传/下载”。
- 示例数据必须标记为示例，禁止伪造精确 SLA 或客户数据。

## 21. 视觉验收

实现阶段每个主要页面至少检查：

- 1440x900 desktop。
- 1280x720 compact laptop。
- 768x1024 tablet。
- 390x844 mobile。
- Light/Dark。
- 默认、loading、empty、error、live healthy/degraded、stale、permission denied。

使用 Playwright screenshot 进行回归。检查文本溢出、状态重叠、动态数字引起的 layout shift、键盘导航和图表展开后的尺寸稳定性。
