# AI 用量小组件 · Parrot / Sub2API / 官方 OAuth

**独立选择账号额度与重置卡来源，以及 Parrot / Sub2API 今日与本月汇总统计**

基于 [Scripting](https://apps.apple.com/app/id6479691128) 的 iPhone 桌面小组件。App 的额度来源可选 **Parrot / 官方OAuth（Codex/Claude）/ Sub2API**，统计来源另选 **Parrot / Sub2API**，二选一不合计。账号配置、缓存、排序与用户名按额度来源隔离；重置卡只属于当前额度来源的该账号，不从统计来源或另一额度来源补齐。切换不删除配置或凭据。旧配置默认继续使用Parrot统计。

## 显示内容

默认浅色/深色自适应渐变背景（日间左上近白，右下冰蓝渐变）、数码管剩余百分比、分段进度条与重置倒计时。

App“小组件背景”可选 **渐变背景（默认） / 玻璃背景（Dock样式）**。选择仅保存在此脚本并请求重载主屏小组件，不更改系统全局外观，锁屏不受影响。Dock样式使用Scripting文档支持的系统`ultraThinMaterial`作为`widgetBackground`（形状`containerRelative`），再叠加极轻白色渐变提亮与顶部更亮的细白色渐变描边；不使用UIGlass，不改文字、图标、颜色、字号或布局。

Material是否透出壁纸、透明程度以及系统着色模式下的背景显示由iOS决定，不保证完全透明；深色壁纸或深色模式下的可读性需真机确认。切回渐变即可恢复默认外观。依据Scripting公开[ShapeStyle Material](https://scriptingapp.github.io/guide/Types/ShapeStyle.md)、[widgetBackground](https://scriptingapp.github.io/guide/View%20Modifiers/widgetBackground.md)与[Shapes](https://scriptingapp.github.io/guide/Views/Shapes/index.md)契约。

| 尺寸 | 内容 |
| --- | --- |
| 小 | 双账号保持上下排列；最终只选1个账号时顶部增加今日/本月四项统计，下方保留5 h/每周额度 |
| 中 | 最多四个账号；恰好2个时上半整行显示今日/月六项统计（输入、输出、缓存、缓存率、Token、花费），下半左右依序显示账号，竖线仅在下半；恰好3个时左上显示同口径四项统计，以紧凑间距排版，上排统计与右侧每周条共用底对齐锚点和横线前留白，账号依序位于右上、左下、右下；缺统计时显示未提供提示 |
| 大 | 最多四个账号纵向排列；顶部显示所选统计来源的今日/本月统计；未配置或无可用统计时显示未提供 |
| 锁屏 | 只显示一个账号：参数/排序后的第一个。矩形为服务图标＋用户名及5 h/每周两行百分比与分段条；圆形显示5 h剩余百分比环；单行（如支持）显示服务与5 h/每周百分比。不显示统计、分隔线、背景或底栏刷新按钮，由系统按锁屏样式着色 |

- 小号单账号顶部显示今日/本月 **缓存、缓存率、Token、花费**；双账号显示上下两个账号的额度。单双账号共用分割线和下方账号位置。
- 大号今日/本月显示 **输入、输出、缓存、缓存率、Token、花费**，下方纵向显示账号额度。进度条与时间左对齐，并延伸到百分比下方。
- 今日/本月同列标题和数值上下对齐，统计区两侧边距对称，列间均匀。空间不足时统一缩放统计字号。
- 统计来自所选 **Parrot / Sub2API 全部账号汇总**，不按小组件所选账号过滤，不跨服务相加。缓存为缓存读加缓存写；缓存率为缓存读÷（输入＋缓存读＋缓存写）；Parrot Token为输入、输出、缓存读、缓存写之和，Sub2API沿用上游`total_tokens`。花费：Parrot估算金额，Sub2API实际扣费`total_actual_cost`，均四舍五入保留一位小数。
- 额度与统计完全独立：例如官方OAuth额度＋Sub2API统计、Sub2API额度＋Parrot统计。统计失败不阻止任何来源额度刷新；沿用该统计来源缓存并单独报告错误与时效。未配置、字段缺失或无缓存时显示未提供，不填零。Sub2API单账号查询失败保留该来源账号与可用缓存，不丢整份列表；App明确报告失败账号及请求路径。
- 小号和中号的 `5 h`、`每周`及剩余时间使用相同字号；倒计时中的数字等宽。
- 在 App“小组件账号”中点账号，填写“小组件用户名”并保存；所有组件尺寸共用，留空保存恢复原名。仅去除首尾空白，Emoji等内容保留；App及排序页仍显示原名。别名按稳定账号ID和来源分别本机保存，刷新、更新、排序不丢失；官方退出仅清除此账号别名，清除Parrot配置同时清除Parrot别名，不影响另一来源。
- 小组件统一按账号的明确停用状态将Codex/Claude标题与图标置灰；App账号列表保持正常颜色。Parrot来自`enabled`，Sub2API来自`status=disabled`。官方OAuth当前公开额度接口及本机凭据没有已确认的账号停用字段，无法据此识别远端禁用；额度耗尽、429、请求失败或暂不可用不会冒充停用。三种来源共用同一标题/图标renderer，不显示“已停用”文字，也不修改远端状态。
- 剩余额度 >60% 绿色、21%–60% 橙色、≤20% 红色；未知显示 `--`。
- 重置卡位于账号标题行右端，右边对齐百分比，与用户名同字号、垂直居中对齐；有无重置卡时标题均保持相同的垂直对齐。只有明确有效数量大于0时显示 `RE:N`；0、未知或未提供时隐藏。所有尺寸保持一致，不兑换或消耗重置卡。
- 底部保留唯一额度刷新时间与可点击的双箭头刷新按钮（图标字号9、点击框12×12，与旁边时间同字号），不显示Wi-Fi图标。点击按钮通过AppIntent直接读取当前额度来源及所选统计来源的汇总统计并重载小组件，不打开设置、不改变小组件其他区域的点击行为；失败沿用缓存及原成功时间。App状态区继续显示独立统计错误与完整更新时间。
- 默认请求15分钟后刷新，可选5、15、30、60分钟；全部来源共用并持久保存。修改后请求iOS重载时间线，每次组件生成时向Scripting传入“当前时间＋所选分钟数”的`reloadPolicy: { policy: "after", date }`日期；这是系统时间线请求，不是精确后台定时器，iOS可能延后或合并。手动刷新不改间隔，随后重新生成的时间线以该次生成时间为起点。Claude服务冷却独立于组件间隔，冷却期间仍使用额度缓存且保留原成功时间；统计也有独立缓存时效，时间未变化不等于间隔设置未保存。

## 安装与 Parrot 配置

在 iPhone 上导入（交互按钮需要iOS 17+及支持AppIntent的Scripting）：

```
https://scripting.fun/import_scripts?urls=["https%3A%2F%2Fgithub.com%2FWangsc1%2Fai-usage"]
```

1. 运行脚本，账号来源选择“Parrot”。
2. 填写你自己的 Parrot 地址（初次留空，不预置私人服务器）和配置里的 **`managementKey`**；已保存的密钥可留空沿用。
3. 点“保存并测试”。普通 OpenAI API Key **不是** Parrot 管理密钥，不能用来查询管理接口。
4. 添加 Scripting 桌面小组件，长按 → 编辑 → 选择本脚本。

Parrot 保留原管理会话登录、账号列表（含已停用账号）、统计与缓存路径，不读取 Parrot 的官方账号 OAuth 凭据。管理接口尚未稳定提供重置卡只读字段；详情若提供 `resetCreditCount` 则显示，否则保持未知。

## 独立官方账号登录

选择“官方OAuth（Codex/Claude）”，再在“登录服务”选择Codex或Claude。登录及额度不依赖Parrot地址或密钥；今日/本月统计需要另外配置所选Parrot或Sub2API服务。两类账号可混合添加、排序与显示，重复登录同一身份更新原记录。

### Codex

1. 登录服务选择Codex。
2. 按 [OpenAI 官方说明](https://developers.openai.com/codex/auth/) 在 ChatGPT 安全设置启用 **device code login**；组织账号可能需管理员在工作区权限启用。此流程仍为 beta，某些账号、组织或网络环境可能不可用。
3. 点“添加官方账号”，记住脚本显示的15分钟有效一次性代码；长按代码行选“复制代码”只复制代码值。取消或授权失效后不能再复制旧代码。
4. 点“打开官方授权页”，每次使用独立临时会话，在 `https://auth.openai.com/codex/device` 登录目标账号并输入代码；关闭后释放Cookie，不影响已授权账号或系统浏览器登录。打开时显示状态；打开失败会在按钮附近提示。若Scripting未提供临时浏览器API，请更新Scripting或使用备用方式；导航加载超过20秒会报告超时并释放临时会话，可重试或使用备用方式。Google/Apple等可能限制嵌入登录，可点“Safari备用授权页”（可能复用旧会话），或自行在外部浏览器无痕窗口打开上述网址，输入本次代码后返回点“检查授权”。只输入你自己在此脚本发起的代码，不输入别人给你的代码。
5. 关闭授权网页后自动检查一次，成功即刷新额度与账号列表；关闭太快时仅按剩余最短间隔等待一次。若仍等待授权，可继续完成网页操作或点“检查授权”手动检查；关闭网页不代表授权成功，不使用后台轮询。取消、退出设置或切换来源会终止本次授权。
6. App官方账号行左侧显示“Codex/Claude 完整邮箱”，右侧独立“点击退出”按钮只移除该账号本机登录；邮箱文字不触发退出。账号列表及排序页显示官方授权提供的完整邮箱；小组件默认显示邮箱前缀（与Parrot相同），已设置“小组件用户名”时优先使用自定义名。缺少真实邮箱时显示“账号 N（邮箱未提供）”，可重新登录尝试获取，不用姓名冒充邮箱。可继续添加不同账号。使用Safari备用时浏览器可能记住上一个账号，确认页面中的目标账号；重复登录同一账号更新原登录，不增加重复项或改变其位置。
7. “刷新官方额度”手动读取；小组件正常按刷新设置读取。访问令牌到期或遇到401时尝试官方续期，保存轮换后的 refresh token；续期失效需重新添加该账号。

### Claude

1. 登录服务选择Claude，点“添加官方账号”。使用官方Claude Code OAuth客户端与PKCE，授权页为 `https://claude.com/cai/oauth/authorize`；请求与目标授权页面相应的五项官方权限：`user:profile`（资料）、`user:inference`（订阅推理）、`user:sessions:claude_code`（Claude Code会话）、`user:mcp_servers`（连接器管理/使用）、`user:file_upload`（文件上传）。不请求org API-key管理、plugins或projects额外权限；脚本仅进行登录、账号资料与额度读取，不实际使用推理、会话、连接器或上传业务功能。已有凭据保留实际授予的scope，续期不自动升级权限；获得新权限需要重新授权。权限调整不保证解决HTTP429。
2. 点“打开Claude授权页”，在独立临时会话登录目标订阅账号。Scripting支持本机回调时，脚本只监听 `127.0.0.1`，以Scripting官方HTTP示例的非零端口8080启动；启动失败不扩大到LAN、不盲试其他端口，授权完成通过官方支持的 `http://localhost:端口/callback` 返回；校验本次state后交换令牌、读取真实账号资料并自动刷新。未完成令牌交换和资料读取前不算登录成功。授权区显示固定阶段：等待回调、收到并通过校验（或未通过）、交换令牌、读取资料及保存；不显示code/state/URL。完成后仅显示统一账号行“Claude 完整邮箱”，右侧独立“点击退出”，不另加重复成功行或“已保存”；缺邮箱明确显示“Claude 邮箱未提供”。自动与手动成功共用同一处理，退出只移除该行ID。关闭网页不代表授权完成：没收到回调时继续等待，交换或资料请求尚未结束时保持忙碌，不重复提交。回调handler同步返回HTTP响应，不等待token/profile网络请求；原生响应发送、localhost解析及邮箱外跳后的脚本存活仍需真机验收。网页spinner本身不能证明回调已到达，请仅提供返回App后显示的阶段。
3. 本机回调API缺失或无法启动时使用官方手动授权码页；也可在打开前点“改用手动授权码”，取消旧尝试并生成新的PKCE/state。完成网页授权后，将页面提供的**完整code#state**粘贴到“本次完整授权码”，点“完成Claude授权”。手动回调为 `https://platform.claude.com/oauth/code/callback`；只接受本次state，不粘贴别人的代码。空输入不能提交；输入为空、缺少#、格式错误与state不匹配分别提示，可重试的校验错误保留遮蔽输入，不发送令牌交换。回调初始化失败只显示安全阶段（构造、地址配置、注册handler、启动、端口或缺API），启动失败进一步显示返回错误/抛异常及白名单类别（端口占用、权限、不支持参数或未知），并显示stop之前的安全启动快照：返回类型/null性/布尔值、对象code/message是否为字符串、官方state枚举、端口有效性及IPv4布尔值；仅对本机start初始化返回的错误字符串显示经过控制字符清理、最多240字符的描述；含URL、查询参数或凭据敏感模式时隐藏描述并保留类别，不显示网络响应body、异常原文或登录秘密，也不记录或持久保存。只需点击“添加官方账号”查看该诊断，不必打开授权页或完成真实授权；这是诊断，不代表回调已修复。端口占用或其他失败时保留手动备用；不自动重试授权码交换。非零端口兼容性与邮箱确认外跳后的回调存活仍需真机验收，不保证解决HTTP429。诊断时可提供“数据来源”中的当前脚本版本及阶段/错误类别，无需发送完整授权码、state或token。
4. 临时浏览器或嵌入登录不兼容时，可用明确的“Safari备用Claude授权页”（可能复用系统登录）；自动回调无法完成时返回脚本取消并重新发起手动流程。不要把旧自动流程的代码用于新手动流程。
5. 本次授权15分钟后失效；取消、切换来源/登录服务、退出设置会清理回调监听、PKCE及输入的代码。Claude与Codex凭据使用不同Keychain条目，App显示真实完整邮箱，小组件使用邮箱前缀或自定义用户名。Claude仅映射官方 `five_hour` 与 `seven_day` 汇总额度，模型专属周限额和额外付费用量不冒充汇总周额度；未提供的窗口显示未知。Claude重置卡读取官方usage响应的`cedar_ember.grants[].resets_left`并按官方CLI规则加总；普通usage未带该状态时，同一账号最多每小时额外只读一次`GET /api/oauth/usage?cedar_ember=1&skip_spend=1`，其间沿用本机计数。每次刷新先发一次普通`GET /api/oauth/usage`；同一进程并发刷新共享这次请求。该请求返回429/403时，按`Retry-After`（无有效值时官方默认5分钟、上限1小时）在本机记住该账号冷却截止时间，期间不再请求、不自动重试，保留已有额度缓存并显示真实请求路径和剩余时间；重置卡追加查询受限只会让重置卡保持未知或缓存，不会标为额度失败。本机只存账号ID对应的截止时间与重置卡数量，不存token。沿用已有profile权限，不额外扩scope；未提供、格式无效或查询失败保持未知，不妨碍主额度显示。数量是剩余reset总数，不表示所有grant当前可兑换；不调用兑换/重置POST，额外付费余额不当作重置卡。

Claude首次令牌交换通过Scripting全局fetch发送JSON，显式使用`Accept: application/json`及诚实的`User-Agent: ai-usage/当前版本`作标准HTTP兼容；不伪装浏览器或官方CLI，不改变OAuth client ID/权限，不复制WebView Cookie，不增加代理或重试。此受控兼容调整尚未证明能消除429；只需一次新授权观察结果，已有凭据续期不改变headers。

Claude令牌交换遇到HTTP429时结束本次流程，不自动重试一次性授权码。只显示响应格式（JSON/HTML/other）与白名单错误类别，不回显body/message/URL；格式与类别不能单独证明限流来源。有有效`Retry-After`秒数或HTTP日期时，按服务截止时间禁用重新发起Claude授权，显示北京时间截止时间与剩余秒数；本机仅保存非秘密冷却截止时间，重开设置也有效，到期后需重新授权。缺失或无效等待时间不编造时长，提示稍后再试，勿连续点击。Codex登录及已授权账号不受此登录冷却影响；这不保证恢复官方token服务。

“取消登录”、离开设置页或15分钟超时不会保存该次登录。退出只删除指定账号的**本机登录**、别名、缓存条目与排序，不删除其他Codex/Claude账号、Parrot配置或浏览器登录，也不是全局撤销官方会话。

### Sub2API 配置与权限

[Sub2API](https://github.com/Wei-Shaw/sub2api) 的额度与统计共用一份本机配置：部署根地址、**Admin API Key**、统计IANA时区（默认`Asia/Shanghai`）。在App独立选择额度和统计来源，选中任一Sub2API选项即可填写。密钥输入已保存时可留空沿用；地址、密钥或时区改变会清理Sub2API旧统计、额度及重置卡缓存，避免混用。普通用户API Key不具备管理员账号查询权限；这里不使用账号密码、JWT或普通Key，不保存上游账号OAuth凭据。

- 认证为`x-api-key`管理员密钥，仅存本机Keychain。权限高于只读查询，请使用可信部署及HTTPS，勿分享密钥；HTTP会明文传输凭据。配置清除只影响Sub2API，不删除其他服务的凭据。
- 统计只GET `/api/v1/admin/usage/stats`，不传用户、Key、账号、模型或分组过滤，沿上游全站汇总口径。今日为所选统计时区当日；本月显式从自然月1日至今日，不使用上游滚动一个月的`period=month`。`total_actual_cost`为实际扣费，不是标准费`total_cost`或上游账号成本`total_account_cost`。
- 分页读取`GET /api/v1/admin/accounts?lite=true`；额度只显示真实支持的Anthropic OAuth/SetupToken及OpenAI Codex OAuth账号。其他平台、普通Key余额和订阅余额不映射成5 h/每周。
- Claude额度读取`GET /api/v1/admin/accounts/:id/usage`的`five_hour`/`seven_day`；OAuth重置卡读取`GET .../:id/claude/reset-credits`的`available_count`，同账号追加重置卡查询最多每小时一次。SetupToken重置卡未知。
- Codex读取`GET /api/v1/admin/openai/accounts/:id/quota`，仅将窗口长度18000/604800秒映射为5 h/每周，重置卡为`rate_limit_reset_credits.available_count`。字段缺失保持未知；模型专属、钱包余额不充当汇总额度或重置卡。
- 客户端对Sub2API只发送GET，不调用兑换、重置或写入刷新POST；部分GET会由Sub2API查询上游额度，限流与时效仍由服务器决定。App、小组件及刷新按钮同一进程的并发加载共用请求，跨进程由iOS独立执行。
- 接口依据上游源码提交`3a6fd1c9db07203ca308aaba69e502bc1f35b307`。较旧部署缺接口时按未知/缓存处理并显示错误，不承诺兼容所有版本；请在自部署服务上验收连接、时区与真实额度。

## 官方数据与真实限制

- 使用官方 Codex device-auth 协议：申请代码、检查授权、用官方返回的 PKCE verifier 换令牌；交换使用官方规定的 `https://auth.openai.com/deviceauth/callback`。不把 Scripting 的 `scripting://oauth_callback/...` 伪装成 localhost 回调，不绕过认证，不复制其他应用的登录文件。
- Codex授权与额度只向 OpenAI 官方主机直接请求：`auth.openai.com` 和 `chatgpt.com`。额度来自只读 `GET /backend-api/wham/usage`；按窗口时长识别5小时/每周，缺少时长时兼容 primary/secondary 语义；月度或其他自定义窗口不会冒充5小时或每周。
- 重置卡优先使用额度响应中的 `rate_limit_reset_credits.available_count`，缺失时尝试只读 `GET /backend-api/wham/rate-limit-reset-credits` 的 `available_count`。不以最多10条详情的长度代替真实数量；无权限、不支持或字段缺失时保持未知。充值余额不是重置卡数量。
- 这些额度接口**未提供与 Parrot 对等的今日/本月 Token 和花费**；今日/本月Token、花费及请求次数来自所选Parrot/Sub2API的全部账号汇总，不表示官方账号的单独用量。官方账号额度缓存不保存其他服务账号或统计；统计按来源独立缓存。
- 当前不支持要求专用路由的 FedRAMP 账号；授权信息不完整、设备授权不可用或服务拒绝请求时明确报错，不回退到假登录/复制凭据方案。
- Claude令牌交换/续期向 `platform.claude.com/v1/oauth/token` 发起JSON请求；真实身份来自只读 `api.anthropic.com/api/oauth/profile`，额度来自只读 `/api/oauth/usage`，使用OAuth Bearer与官方beta header。不提取网页Cookie，不新增外部服务，不将Scripting URL Scheme冒充官方回调。续期失败需重新添加该账号；某账号失败时保留完整官方缓存，不把部分账号假称全部已刷新。
- [Claude官方说明](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)允许Agent SDK、claude -p和third-party apps使用订阅限制，但不保证本脚本在每种Scripting/iOS或账号环境都可授权。本项目是第三方脚本，不是OpenAI或Anthropic官方客户端；公开协议不代表具体第三方客户端兼容性承诺，接口、权限和风控可能变化。

公开协议依据：[device_code_auth.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs)、[OAuth client](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs)、[客户端ID及刷新](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)、[额度与重置卡 GET](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[窗口模型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs)。

Claude协议依据：官方npm发行包 [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) 中的OAuth常量、授权参数、手动code#state、刷新、profile、usage及cedar_ember重置状态实现（`j_`只读selector、`Xn/Bn`状态/grant schema、`Ue`剩余加总；2.1.295，交叉核对2.1.80）。Scripting契约：[Crypto](https://scriptingapp.github.io/guide/Utilities/Crypto.md)、[HttpServer](https://scriptingapp.github.io/guide/Utilities/HttpServer/HttpServer/index.md)、[HttpRequest](https://scriptingapp.github.io/guide/Utilities/HttpServer/HttpRequest.md)、[WebView示例](https://scriptingapp.github.io/guide/Views/WebView.md)。本机回调和临时浏览器仍须手机验收。

## 账号排序与参数

- App 账号排序：**设置页 → “小组件账号”下的“账号排序” → 长按账号卡片拖到新位置**，松手即保存，无需编辑按钮。设置页本身只读显示“编号. 提供商 · 账号名”列表，没有开关或勾选限制；编号随排序变化。按稳定账号ID持久化，三种额度来源各自独立；排序页面只写打开时的来源，切换来源后旧页面不会写入。新出现账号排末尾，成功刷新时移除已删除账号的顺序。
- **无数字参数时按完整排序列表取前面的账号，包含已停用账号**：小号前2个、中号/大号前4个。列表本身不限4个账号。只影响本机显示，绝不启用或停用远端账号。
- 长按桌面小组件 → 编辑 → 参数，可填排序后列表序号（从1开始），英文/中文逗号或空格分隔。参数优先于默认前列账号，并保留指定序列：`3,1` 显示排序后第三、第一。排序后数字参数代表的账号可能变化，请按需调整。
- 小号显示最终序列前两个，中号和大号显示前四个。单个有效数字参数（例如 `3`）仍触发小号单账号的今日/本月四项统计；默认列表只有1个账号时也一样。设置页可预览三种尺寸。

## 更新与安全

App“更新” → “检查更新”，从本仓库下载 `api.ts`、`app_intents.tsx`、`widget.tsx`、`index.tsx`，全部下载成功后写入。AppIntent必须定义于`app_intents.tsx`，由Scripting在`app_intents`环境执行；旧三文件更新器首次升级后退出并重新运行，再点一次“强制重新下载”，或直接重新导入完整脚本，确保新增文件齐全。配置与凭据不在代码中。更新后退出并重新运行。本机 `script.json` 不覆盖，以保留导入元数据。交互执行受iOS后台时长与网络调度限制，点击后的真机刷新及钥匙串可用性需要设备验收。

- 地址、Parrot 管理密钥/会话、Sub2API管理员密钥及统计时区以及独立官方 token 都只存本机脚本隔离 Keychain，默认不开启 iCloud 同步。Codex与Claude使用分别隔离的钥匙串条目；排序只存账号ID；额度缓存仅保存显示所需的邮箱或未提供提示，不缓存token。Codex解析已授权token中的邮箱声明；Claude使用官方profile获取真实账号UUID、组织UUID和邮箱。授权码、state与PKCE只在本次内存流程中使用，不写日志或持久存储。
- Claude授权与额度冷却截止提示统一以北京时间`YYYY-MM-DD HH:mm:ss`显示，不跟随设备时区、不加时区后缀；内部截止仍为epoch毫秒，不改变Sub2API自选统计时区。
- 不向 Parrot、GitHub 或第三方发送官方 token，不将凭据写入日志/源码。Parrot 管理密钥具有完整管理权限，勿分享填好凭据的脚本或钥匙串数据。
- “清除Parrot配置”保留原清除行为（含共用刷新间隔恢复默认），不退出官方账号；普通来源切换不清除配置。

## 本地验证边界

`tests/mock.cjs` 使用虚构凭据、内存 Keychain/Storage 和模拟 fetch，不连接账号服务。需 Node.js 及 TypeScript：

```sh
TYPESCRIPT_PATH=/path/to/typescript node tests/mock.cjs
```

模拟测试覆盖授权与续期、额度映射、重置卡、来源隔离、账号排序与数字参数、费用格式及组件结构，并检查 TypeScript 语法。

**模拟测试不等于 iPhone 真机验收，也不代表实际官方登录成功。** 实际授权、账号权限、网络、拖动手势及不同尺寸的字体和布局需在 Scripting 手机上确认。
