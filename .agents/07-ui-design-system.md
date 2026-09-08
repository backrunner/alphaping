# AlphaPing UI 设计系统

文档站 `apps/docs` 沿用本文件当前优先的 Iris 明暗配色、Geist 字体、回波 Logo、大圆角与柔和阴影。产品 landing 使用宽幅 Hero、静态品牌轨道和明确标注的示例截图；阅读区采用分组侧栏、白色圆角文章表面和页内目录。顶部导航采用居中悬浮圆角栏，与视口顶部和两侧保留间距，使用轻微半透明表面、背景模糊与柔和阴影；导航选中态使用 Iris 胶囊。移动端菜单在导航下方独立展开，不推移正文。搜索、明暗切换、代码复制与键盘焦点保持可用。主题定制通过 svedocs 公共组件接口接入，不复制内容发现、路由或搜索逻辑。

文档站主题按钮点击后直接在浅色与深色之间切换，不使用下拉菜单。首次访问跟随系统，手动切换后在浏览器保存选择；按钮图标与可访问名称表示下一次切换的目标模式。

文档表格保持 svedocs 的独立滚动容器。横向还有内容时，对应边缘显示渐变遮罩；到达边缘或表格不再溢出时取消遮罩。滚动表格可通过键盘聚焦，明暗主题与窗口尺寸变化后保持正确提示。

文档站悬浮导航使用液态玻璃表面：半透明底色、背景模糊与饱和度增强、细边缘高光，以及向下渐隐的底部模糊层。装饰层不拦截点击，导航文字保持清晰；减少透明效果偏好或不支持背景滤镜时使用实色表面。

## 1. Design read

AlphaPing 面向个人用户、团队与公开探针访客。采用明快、精致、有层次的消费级产品视觉：公开探针页优先品牌表达和浏览体验，管理后台保留必要信息密度并统一柔和表面、排版和控件。

- `DESIGN_VARIANCE: 6`
- `MOTION_INTENSITY: 3`
- `VISUAL_DENSITY: public 5 / console 7`

含义：清晰的视觉层次、适度留白、柔和立体感；状态与数值保持可信，动效用于反馈并尊重 reduced motion。

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
4. 表面有层次：品牌区、重复资源和重要指标可使用柔和卡片；卡片内部用间距和分隔线组织。
5. 颜色有语义：品牌 accent 用于操作、选择和品牌表达，状态色表示健康状态。
6. 不靠颜色：状态同时有文字、图标、形状和 ARIA label。
7. 友好明确：公开页语言轻松自然，操作和错误说明保持具体，不夸大可用性或性能。

## 4. Color tokens

### 4.1 Light

| Token | Value | 用途 |
| --- | --- | --- |
| `--bg` | `#f7f7f4` | 页面背景 |
| `--surface` | `#ffffff` | 主表面 |
| `--surface-subtle` | `#f0f1ed` | hover/次级分组 |
| `--surface-strong` | `#e4e7e1` | selected/pressed |
| `--text` | `#252923` | 主文本 |
| `--text-muted` | `#5f665d` | 次级文本 |
| `--text-faint` | `#666e64` | 辅助时间和占位 |
| `--border` | `#e1e5dd` | 边框 |
| `--border-strong` | `#b5bdb1` | focus/active boundary |
| `--accent` | `#6550d5` | 主操作、选中 |
| `--accent-hover` | `#5540be` | hover |

### 4.2 Dark

| Token | Value | 用途 |
| --- | --- | --- |
| `--bg` | `#151716` | 页面背景 |
| `--surface` | `#1e211f` | 主表面 |
| `--surface-subtle` | `#272c28` | hover/次级分组 |
| `--surface-strong` | `#343b35` | selected/pressed |
| `--text` | `#eef1eb` | 主文本 |
| `--text-muted` | `#b8c0b5` | 次级文本 |
| `--text-faint` | `#a7b2a3` | 辅助时间和占位 |
| `--border` | `#343b35` | 边框 |
| `--border-strong` | `#616d5d` | focus/active boundary |
| `--accent` | `#b5a6ff` | 主操作、选中 |
| `--accent-hover` | `color-mix(in srgb, #b5a6ff 80%, white)` | hover |

### 4.3 Status

| 状态 | Light/Dark 基色 | 非颜色表达 |
| --- | --- | --- |
| healthy/online | `#187859` / `#6ad9aa` | Check 图标、`正常` |
| degraded | `#925c13` / `#efc377` | Triangle 图标、`降级` |
| down/fault | `#b83552` / `#ff91a6` | X 图标、`故障` |
| offline | `#626981` / `#b2bad3` | WifiOff 图标、`离线` |
| maintenance | `#7550ad` / `#c4a4ff` | Wrench 图标、`维护` |
| unknown | `#626981` / `#b2bad3` | CircleHelp 图标、`未知` |

状态背景使用独立的柔和明暗 token，文字和图标必须满足 WCAG AA。不要在大面积背景上使用高饱和状态色。

## 5. Typography

- UI：自托管 Geist Sans，fallback 为系统 sans。
- 数字和技术标识：Geist Mono，fallback 为系统 monospace。
- 所有指标数字使用 `font-variant-numeric: tabular-nums`。
- 字距固定为 0，不使用负 letter-spacing。
- 公开首页状态标题 42 px、手机 32 px；详情标题 34 px，section 标题 22 px，机器卡片标题 17 px。站点名位于导航，不在首屏重复。
- 控制台标题 26 px；正文 14 px，次级正文 13 px，辅助文字 12 px。详情指标 22–26 px，最窄手机 18 px。
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
- Default：36 px。
- Comfortable：40–44 px，用于公开导航、搜索、登录和关键表单。
- Icon button：36x36 px，紧凑场景可降至 28–32 px 并保留足够目标间距。

公开页外边距：mobile 18 px、tablet 24 px、desktop 32 px，容器最大 1160 px；控制台按内容密度采用 16–28 px。公开区段间距 32–40 px。

## 7. Shape、border 和 elevation

- Card radius：24 px；重复资源 hover 使用边框和阴影反馈，不移动卡片。
- Input/menu radius：14 px，dialog/panel radius：32 px；公开 Hero 为 36 px，手机端为 28 px。
- Tooltip radius：12 px。
- Button radius：12 px。
- Status capsule、tag、segmented control item 可以使用 full pill。
- 控制台与公开页使用同一形状语言，通过间距与字号区分密度。
- 默认使用 1 px border 表达分组。
- Popover、menu、dialog 使用明确 elevation；资源卡、公开 Hero 和摘要面板使用接触阴影与扩散阴影形成柔和层次，深色模式采用独立阴影 token。
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

- 左侧导航列宽 244 px，内置 12 px 外边距的圆角浮动导航。
- 顶栏高 72 px，包含 workspace switcher、全局搜索、主题和用户菜单。
- 主内容占满剩余区域，最大内容宽度不强制限制到 marketing-style 1200 px。
- 页面标题行包含标题、简短状态和主要操作，不使用巨大空白。

### 9.2 Mobile

- 顶栏 60 px，使用菜单按钮打开 260 px 导航抽屉。
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

总览使用四列柔和指标卡片，窄屏使用两列；重要状态数字可直接进入筛选：

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

## 2026-09 交互修正

安装命令使用可选择、滚动和调整高度的只读文本框，复制失败显示就地提示。平台选择为 pressed button group，避免未实现完整键盘语义的伪 tablist；完整命令包含脚本 checksum 验证。顶部搜索随可用机器/服务导航切换，空工作区隐藏；移动导航切换到桌面断点时必须解除 inert。状态时间线按真实桶数量分配轨道，不固定为 48 列。

未上报的机器以缺失值和等待首次上报提示表示，不显示伪造的零值。安装平台切换或复制失败时清除先前的 Copied 反馈。紧凑状态徽标使用带名称的图像语义，不逐个设为 live region；容器指标的说明属于对应的 `dd`。

## 2026-09-08 公开产品视觉重构（最新设计基准）

用户明确要求从原有扁平 ToB 风格转向现代、明快、面向游客的 ToC 风格；本节优先于上文遗留的紧凑视觉限制。允许静态柔和渐变、品牌状态图形、表面层次和较大留白，不引入持续动画、WebGL、远程字体或装饰性网络请求。

- 公开首页：站点品牌导航、整体状态 hero、可访问的状态图形、公开资源计数、机器卡片、服务时间线和事件区。数值与图形仅表达真实公开数据，缺失数据不伪造。
- 主题预设：Iris、Ocean、Mint、Sunset、Rose，均有明暗 token；舒适/紧凑两种公开资源布局。
- 管理员在 Appearance 页面保存站点标题、介绍、配色、默认明暗和密度，实时预览。写入 `dashboards.appearance_json`，仅 admin 可变更，包含审计与最终写入权限复核。
- 游客可选择站点默认或个人配色、明暗和密度，个人选项只在浏览器保存，不增加 D1 写入；SSR 直接应用站点默认主题。
- 所有公开路由与自定义域入口共用品牌/主题容器，公开投影与快照仅包含校验后的主题字段，禁止自定义 HTML、JavaScript、CSS 或外部追踪资源。
- 主题升级不改变公开策略；查询复用已有 dashboard join，缓存 TTL 保持 30 秒 fresh / 5 分钟 fallback。

## 2026-09-08 视觉精修：降低模板感（历史调整）

用户进一步要求减少 AI 模板感、提升 UI 品质。保留现代、明快和可定制的公开体验，采用中性背景、精确排版和真实状态构成页面层次。

- 删除大面积氛围渐变、轨道/卫星等装饰图形、重复的图标底座和口号式文案。
- 公开首页以状态作为主标题，站点名只在导航中出现；介绍由站点管理员提供，缺省时不填充营销文案。
- 使用暖白/炭灰中性表面。五套配色作为有限的品牌强调，不染色整页或将指标绘制成装饰性色带。
- 重复资源卡片圆角 12 px，面板 16 px，控件 8 px；阴影保持轻微，悬停以边框和文字变化反馈，不整体漂浮。
- 机器卡片优先设备身份和指标，移除重复的服务器装饰图标。服务以连续分隔的列表展示，让时间线可比较，减少同构卡片堆叠。
- 品牌、状态、资源标题和指标采用明确的字号层级；辅助文字保持可读。主题设置使用直接的字段名称，不使用星光图标、编号步骤或宣传标题。
- 保留五套配色、明暗模式、舒适/紧凑选择以及现有权限、缓存和查询行为；没有新 schema 或部署资源。

## 2026-09-08 用户视觉偏好校准（当前优先）

用户明确喜欢此前的大块 Hero，并希望尽量使用大圆角和阴影。这一偏好优先于上一轮收紧圆角、阴影与 Hero 的规则。保留直接文案、清晰排版和真实数据表达。

- 公开首页恢复宽幅 Hero 面板，桌面圆角 36 px、手机 28 px；柔和静态渐变和状态图标形成重点。
- 用户进一步要求恢复 Hero 的轨道效果：状态图标外使用双层细圆环和三个装饰节点，配色跟随主题；轨道保持静态，手机端隐藏，不表示遥测或资源数量。
- 轨道下不添加文字说明。Navbar 使用探测中心、两层回波圆弧与信号节点组成的原创图标 Logo，不使用字母；favicon 与之同步。提供管理员自定义图片地址和实时预览；图片有固定尺寸，透明背景按 contain 显示，加载失败回退默认标志。仅允许公开 HTTPS 或站内路径，SVG 作为图片加载，不插入用户 SVG 标记。
- 所有产品品牌展示统一复用 `SiteLogo`：Dashboard/管理后台侧栏、登录、工作区、邀请、初始化、错误页与公开页署名；不再以字母 A 或 Lucide Activity 图标代替品牌。公开导航继续支持已验证的自定义 Logo；产品署名始终使用 AlphaPing 默认 Logo。
- Logo 保留已接受的回波图形，以静态 SVG 渐变、玻璃边缘高光、底部折射光和轻微浮雕表现立体质感。16 px 仍须辨识主体，不使用持续动画、实时背景采样或模糊滤镜。
- 共享资源卡片圆角 24 px、面板 32 px、控件 14 px、按钮 12 px。阴影使用近处接触阴影和远处柔和扩散两层，明暗模式各自调节。
- 公开详情标题区、主题预览和服务列表容器沿用圆角表面；服务内部继续用对齐的连续行组织数据。
- 不恢复宣传口号、重复图标底座、持续动画或虚构遥测。五套配色及游客偏好继续有效。
- 本轮为 UI 样式与状态图标调整，不改变数据、权限、缓存或部署要求。
