# ai-usage

基于 [Scripting](https://apps.apple.com/app/id6479691128) 的 iPhone 桌面小组件。App 可选择 **Parrot密钥** 或 **官方OAuth（Codex/Claude）** 作为账号额度来源；账号配置、缓存与排序独立保存，切换不会删除另一来源的数据。今日/本月统计始终读取已配置的Parrot全部账号汇总，与额度来源无关。

## 显示内容

浅色/深色自适应渐变背景（日间左上近白，右下冰蓝渐变）、数码管剩余百分比、分段进度条与重置倒计时。

| 尺寸 | 内容 |
| --- | --- |
| 小 | 双账号保持上下排列；最终只选1个账号时顶部增加今日/本月四项统计，下方保留5 h/每周额度 |
| 中 | 最多四个账号；恰好2个时上半整行显示今日/月六项统计（输入、输出、缓存、缓存率、Token、花费），下半左右依序显示账号，竖线仅在下半；恰好3个时左上显示同口径四项统计，以紧凑间距排版，上排统计与右侧每周条共用底对齐锚点和横线前留白，账号依序位于右上、左下、右下；缺统计时显示未提供提示 |
| 大 | 最多四个账号纵向排列；顶部显示Parrot今日/本月统计；未配置或无可用统计时显示未提供 |

- 小号单账号顶部显示今日/本月 **缓存、缓存率、Token、花费**；双账号显示上下两个账号的额度。单双账号共用分割线和下方账号位置。
- 大号今日/本月显示 **输入、输出、缓存、缓存率、Token、花费**，下方纵向显示账号额度。进度条与时间左对齐，并延伸到百分比下方。
- 今日/本月同列标题和数值上下对齐，统计区两侧边距对称，列间均匀。空间不足时统一缩放统计字号。
- 统计来自 **Parrot 全部账号汇总**，不是所选账号的单独用量。缓存为缓存读加缓存写；缓存率为缓存读÷（输入＋缓存读＋缓存写）；Token 为输入、输出、缓存读、缓存写之和。花费按 Parrot 提供的估算金额显示，四舍五入保留一位小数。
- 使用独立Codex或Claude额度时，也读取Parrot统计，不按官方账号或小组件所选账号过滤。先在Parrot来源保存地址与管理密钥，再切回官方OAuth即可。统计失败不阻止官方额度刷新；有Parrot统计缓存时保留并标明缓存时效，无缓存或未配置时显示未提供，不填零。
- 小号和中号的 `5 h`、`每周`及剩余时间使用相同字号；倒计时中的数字等宽。
- 在 App“小组件账号”中点账号，填写“小组件用户名”并保存；所有组件尺寸共用，留空保存恢复原名。仅去除首尾空白，Emoji等内容保留；App及排序页仍显示原名。别名按稳定账号ID和来源分别本机保存，刷新、更新、排序不丢失；官方退出仅清除此账号别名，清除Parrot配置同时清除Parrot别名，不影响另一来源。
- 小组件中账号停用时，Codex/Claude 标题与图标置灰；App 账号列表保持正常颜色。不显示“已停用”文字，也不修改远端账号状态。
- 剩余额度 >60% 绿色、21%–60% 橙色、≤20% 红色；未知显示 `--`。
- 重置卡位于账号标题行右端，右边对齐百分比，与用户名同字号、垂直居中对齐；有无重置卡时标题均保持相同的垂直对齐。只有明确有效数量大于0时显示 `RE:N`；0、未知或未提供时隐藏。所有尺寸保持一致，不兑换或消耗重置卡。
- 底部显示账号额度最后成功刷新时间和双箭头循环图标；额度请求失败时保留当前来源缓存并显示断网图标。官方模式另显示“统计P”及Parrot统计时间，统计失败时显示橙色“缓存”及距今分钟/小时/天数，或“未提供”；App状态区显示独立统计错误与完整更新时间。
- 默认每15分钟刷新，可选5、15、30、60分钟；两个来源共用此设置，实际刷新由 iOS 调度，可能延后。

## 安装与 Parrot 配置

在 iPhone 上导入：

```
https://scripting.fun/import_scripts?urls=["https%3A%2F%2Fgithub.com%2FWangsc1%2Fai-usage"]
```

1. 运行脚本，数据来源选择“Parrot密钥”。
2. 填写你自己的 Parrot 地址（初次留空，不预置私人服务器）和配置里的 **`managementKey`**；已保存的密钥可留空沿用。
3. 点“保存并测试”。普通 OpenAI API Key **不是** Parrot 管理密钥，不能用来查询管理接口。
4. 添加 Scripting 桌面小组件，长按 → 编辑 → 选择本脚本。

Parrot 保留原管理会话登录、账号列表（含已停用账号）、统计与缓存路径，不读取 Parrot 的官方账号 OAuth 凭据。管理接口尚未稳定提供重置卡只读字段；详情若提供 `resetCreditCount` 则显示，否则保持未知。

## 独立官方账号登录

选择“官方OAuth（Codex/Claude）”，再在“登录服务”选择Codex或Claude。登录及额度不依赖Parrot地址或密钥；今日/本月统计需要另外配置Parrot。两类账号可混合添加、排序与显示，重复登录同一身份更新原记录。

### Codex

1. 登录服务选择Codex。
2. 按 [OpenAI 官方说明](https://developers.openai.com/codex/auth/) 在 ChatGPT 安全设置启用 **device code login**；组织账号可能需管理员在工作区权限启用。此流程仍为 beta，某些账号、组织或网络环境可能不可用。
3. 点“添加官方账号”，记住脚本显示的15分钟有效一次性代码；长按代码行选“复制代码”只复制代码值。取消或授权失效后不能再复制旧代码。
4. 点“打开官方授权页”，每次使用独立临时会话，在 `https://auth.openai.com/codex/device` 登录目标账号并输入代码；关闭后释放Cookie，不影响已授权账号或系统浏览器登录。打开时显示状态；打开失败会在按钮附近提示。若Scripting未提供临时浏览器API，请更新Scripting或使用备用方式；导航加载超过20秒会报告超时并释放临时会话，可重试或使用备用方式。Google/Apple等可能限制嵌入登录，可点“Safari备用授权页”（可能复用旧会话），或自行在外部浏览器无痕窗口打开上述网址，输入本次代码后返回点“检查授权”。只输入你自己在此脚本发起的代码，不输入别人给你的代码。
5. 关闭授权网页后自动检查一次，成功即刷新额度与账号列表；关闭太快时仅按剩余最短间隔等待一次。若仍等待授权，可继续完成网页操作或点“检查授权”手动检查；关闭网页不代表授权成功，不使用后台轮询。取消、退出设置或切换来源会终止本次授权。
6. App官方账号行左侧显示“Codex/Claude 完整邮箱”，右侧独立“点击退出”按钮只移除该账号本机登录；邮箱文字不触发退出。账号列表及排序页显示官方授权提供的完整邮箱；小组件默认显示邮箱前缀（与Parrot相同），已设置“小组件用户名”时优先使用自定义名。缺少真实邮箱时显示“账号 N（邮箱未提供）”，可重新登录尝试获取，不用姓名冒充邮箱。可继续添加不同账号。使用Safari备用时浏览器可能记住上一个账号，确认页面中的目标账号；重复登录同一账号更新原登录，不增加重复项或改变其位置。
7. “刷新官方额度”手动读取；小组件正常按刷新设置读取。访问令牌到期或遇到401时尝试官方续期，保存轮换后的 refresh token；续期失效需重新添加该账号。

### Claude

1. 登录服务选择Claude，点“添加官方账号”。使用官方Claude Code OAuth客户端与PKCE，授权页为 `https://claude.com/cai/oauth/authorize`；仅请求profile/inference scope，脚本不发送模型推理请求。
2. 点“打开Claude授权页”，在独立临时会话登录目标订阅账号。Scripting支持本机回调时，脚本只监听 `127.0.0.1` 随机端口，授权完成通过官方支持的 `http://localhost:端口/callback` 返回；校验本次state后交换令牌、读取真实账号资料并自动刷新。未完成令牌交换和资料读取前不算登录成功。
3. 本机回调API缺失或无法启动时使用官方手动授权码页；也可在打开前点“改用手动授权码”，取消旧尝试并生成新的PKCE/state。完成网页授权后，将页面提供的**完整code#state**粘贴到“本次完整授权码”，点“完成Claude授权”。手动回调为 `https://platform.claude.com/oauth/code/callback`；只接受本次state，不粘贴别人的代码。空输入不能提交；输入为空、缺少#、格式错误与state不匹配分别提示，可重试的校验错误保留遮蔽输入，不发送令牌交换。回调初始化失败只显示安全阶段（构造、地址配置、注册handler、启动、端口或缺API），不显示原始异常或登录秘密。诊断时可提供“数据来源”中的当前脚本版本及阶段/错误类别，无需发送完整授权码、state或token。
4. 临时浏览器或嵌入登录不兼容时，可用明确的“Safari备用Claude授权页”（可能复用系统登录）；自动回调无法完成时返回脚本取消并重新发起手动流程。不要把旧自动流程的代码用于新手动流程。
5. 本次授权15分钟后失效；取消、切换来源/登录服务、退出设置会清理回调监听、PKCE及输入的代码。Claude与Codex凭据使用不同Keychain条目，App显示真实完整邮箱，小组件使用邮箱前缀或自定义用户名。Claude仅映射官方 `five_hour` 与 `seven_day` 汇总额度，模型专属周限额和额外付费用量不冒充汇总周额度；未提供的窗口显示未知，Claude不虚构重置卡。

“取消登录”、离开设置页或15分钟超时不会保存该次登录。退出只删除指定账号的**本机登录**、别名、缓存条目与排序，不删除其他Codex/Claude账号、Parrot配置或浏览器登录，也不是全局撤销官方会话。

### 官方数据与真实限制

- 使用官方 Codex device-auth 协议：申请代码、检查授权、用官方返回的 PKCE verifier 换令牌；交换使用官方规定的 `https://auth.openai.com/deviceauth/callback`。不把 Scripting 的 `scripting://oauth_callback/...` 伪装成 localhost 回调，不绕过认证，不复制其他应用的登录文件。
- Codex授权与额度只向 OpenAI 官方主机直接请求：`auth.openai.com` 和 `chatgpt.com`。额度来自只读 `GET /backend-api/wham/usage`；按窗口时长识别5小时/每周，缺少时长时兼容 primary/secondary 语义；月度或其他自定义窗口不会冒充5小时或每周。
- 重置卡优先使用额度响应中的 `rate_limit_reset_credits.available_count`，缺失时尝试只读 `GET /backend-api/wham/rate-limit-reset-credits` 的 `available_count`。不以最多10条详情的长度代替真实数量；无权限、不支持或字段缺失时保持未知。充值余额不是重置卡数量。
- 这些额度接口**未提供与 Parrot 对等的今日/本月 Token 和花费**；今日/本月Token、花费及请求次数始终来自已配置Parrot的全部账号汇总，不表示官方账号的单独用量。官方账号额度缓存不保存Parrot账号或统计；统计独立缓存。
- 当前不支持要求专用路由的 FedRAMP 账号；授权信息不完整、设备授权不可用或服务拒绝请求时明确报错，不回退到假登录/复制凭据方案。
- Claude令牌交换/续期向 `platform.claude.com/v1/oauth/token` 发起JSON请求；真实身份来自只读 `api.anthropic.com/api/oauth/profile`，额度来自只读 `/api/oauth/usage`，使用OAuth Bearer与官方beta header。不提取网页Cookie，不新增外部服务，不将Scripting URL Scheme冒充官方回调。续期失败需重新添加该账号；某账号失败时保留完整官方缓存，不把部分账号假称全部已刷新。
- [Claude官方说明](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)允许Agent SDK、claude -p和third-party apps使用订阅限制，但不保证本脚本在每种Scripting/iOS或账号环境都可授权。本项目是第三方脚本，不是OpenAI或Anthropic官方客户端；公开协议不代表具体第三方客户端兼容性承诺，接口、权限和风控可能变化。

公开协议依据：[device_code_auth.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs)、[OAuth client](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs)、[客户端ID及刷新](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)、[额度与重置卡 GET](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[窗口模型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs)。

Claude协议依据：官方npm发行包 [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) 中的OAuth常量、授权参数、手动code#state、刷新、profile和usage实现（2.1.295，交叉核对2.1.80）。Scripting契约：[Crypto](https://scriptingapp.github.io/guide/Utilities/Crypto.md)、[HttpServer](https://scriptingapp.github.io/guide/Utilities/HttpServer/HttpServer/index.md)、[HttpRequest](https://scriptingapp.github.io/guide/Utilities/HttpServer/HttpRequest.md)、[WebView示例](https://scriptingapp.github.io/guide/Views/WebView.md)。本机回调和临时浏览器仍须手机验收。

## 账号排序与参数

- App 账号排序：**设置页 → “小组件账号”下的“账号排序” → 长按账号卡片拖到新位置**，松手即保存，无需编辑按钮。设置页本身只读显示“编号. 提供商 · 账号名”列表，没有开关或勾选限制；编号随排序变化。按稳定账号ID持久化，两种来源各自独立；排序页面只写打开时的来源，切换来源后旧页面不会写入。新出现账号排末尾，成功刷新时移除已删除账号的顺序。
- **无数字参数时按完整排序列表取前面的账号，包含 Parrot 已停用账号**：小号前2个、中号/大号前4个。列表本身不限4个账号。只影响本机显示，绝不启用或停用远端账号。
- 长按桌面小组件 → 编辑 → 参数，可填排序后列表序号（从1开始），英文/中文逗号或空格分隔。参数优先于默认前列账号，并保留指定序列：`3,1` 显示排序后第三、第一。排序后数字参数代表的账号可能变化，请按需调整。
- 小号显示最终序列前两个，中号和大号显示前四个。单个有效数字参数（例如 `3`）仍触发小号单账号的今日/本月四项统计；默认列表只有1个账号时也一样。设置页可预览三种尺寸。

## 更新与安全

App“更新” → “检查更新”，从本仓库下载 `api.ts`、`widget.tsx`、`index.tsx`，全部下载成功后写入。配置与凭据不在代码中。更新后退出并重新运行。本机 `script.json` 不覆盖，以保留导入元数据。

- 地址、Parrot 管理密钥/会话以及独立官方 token 都只存本机脚本隔离 Keychain，默认不开启 iCloud 同步。Codex与Claude使用分别隔离的钥匙串条目；排序只存账号ID；额度缓存仅保存显示所需的邮箱或未提供提示，不缓存token。Codex解析已授权token中的邮箱声明；Claude使用官方profile获取真实账号UUID、组织UUID和邮箱。授权码、state与PKCE只在本次内存流程中使用，不写日志或持久存储。
- 不向 Parrot、GitHub 或第三方发送官方 token，不将凭据写入日志/源码。Parrot 管理密钥具有完整管理权限，勿分享填好凭据的脚本或钥匙串数据。
- “清除Parrot配置”保留原清除行为（含共用刷新间隔恢复默认），不退出官方账号；普通来源切换不清除配置。

## 本地验证边界

`tests/mock.cjs` 使用虚构凭据、内存 Keychain/Storage 和模拟 fetch，不连接账号服务。需 Node.js 及 TypeScript：

```sh
TYPESCRIPT_PATH=/path/to/typescript node tests/mock.cjs
```

模拟测试覆盖授权与续期、额度映射、重置卡、来源隔离、账号排序与数字参数、费用格式及组件结构，并检查 TypeScript 语法。

**模拟测试不等于 iPhone 真机验收，也不代表实际官方登录成功。** 实际授权、账号权限、网络、拖动手势及不同尺寸的字体和布局需在 Scripting 手机上确认。
