# ai-usage · 1.7.3

基于 [Scripting](https://apps.apple.com/app/id6479691128) 的 iPhone 桌面小组件。App 可选择 **Parrot密钥** 或 **OpenAI/Codex官方OAuth**；两个来源的配置、缓存、勾选与排序独立保存，切换不会删除另一来源的数据。

## 显示内容

浅色/深色自适应渐变背景、数码管剩余百分比、分段进度条与重置倒计时。

| 尺寸 | 内容 |
| --- | --- |
| 小 | 双账号保持上下排列；最终只选1个账号时顶部增加今日/本月四项统计，下方保留5 h/每周额度 |
| 中 | 2×2，最多四个账号 |
| 大 | 最多四个账号纵向排列；Parrot 顶部保留今日/本月统计，官方模式标明统计未提供 |

- **小号单账号**（包括数字参数最终仅选中1个账号）：顶部今日/本月均为 **缓存、缓存率、Token、花费**，共用四个等宽 `LazyVGrid` 列（列间距2），标题/数值 leading 对齐。标题7、数值9号字并允许单行缩放，下方沿用原单账号额度字号，底部刷新时间保留。选2个账号时不增加统计，原布局完全保留；中大号布局不变。
- 单账号小号统计仍是 **Parrot 全部账号今日/月汇总**，不是所选账号的单独用量；缓存=缓存读+缓存写，缓存率=缓存读÷（输入+缓存读+缓存写），Token/费用与大号同口径及精度。官方OAuth没有今日/月统计时只显示紧凑“今日/本月统计未提供”，不填0、不混入Parrot数据。
- 大号今日/本月六列依次为：**输入、输出、缓存、缓存率、Token、估算花费**。Token 用 `totalTokens`（输入+输出+缓存读+缓存写），缓存列为缓存读+缓存写。今日/本月共用六个等宽 `LazyVGrid` 列定义（列间距4），标题与数值均靠列左侧对齐，两期同列起点一致，不随文本长度改变。标签与数值保持单行，可缩放适配。花费保留一位小数并四舍五入（如1.15→$1.2、0.05→$0.1），仅格式化，不修改统计数据。
- 底部刷新符号使用双箭头循环 `arrow.triangle.2.circlepath`（保持原尺寸），显示最后成功取得数据的时间；失败时保留该来源缓存并显示断网图标，App 状态区显示错误。
- 剩余额度 >60% 绿色、21%–60% 橙色、≤20% 红色；未知显示 `--`。
- 重置卡有权威数量时显示 `重置:N`（包括真实的0）；未知不伪造数量，App 标明“重置卡未提供”。不兑换、不消耗重置卡。
- 默认每15分钟请求刷新，可选5、15、30、60分钟；这是两个来源共用的刷新设置，实际时间由 iOS 调度，可能延后。

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

1. 选择“OpenAI/Codex官方OAuth”，无需填写 Parrot 地址或密钥。
2. 按 [OpenAI 官方说明](https://developers.openai.com/codex/auth/) 在 ChatGPT 安全设置启用 **device code login**；组织账号可能需管理员在工作区权限启用。此流程仍为 beta，某些账号、组织或网络环境可能不可用。
3. 点“添加官方账号”，记住脚本显示的15分钟有效一次性代码。
4. 点“打开官方授权页”，在 `https://auth.openai.com/codex/device` 登录目标账号并输入代码。只输入你自己在此脚本发起的代码，不输入别人给你的代码。
5. 关闭浏览器回到脚本，点“检查授权”。若仍等待授权，完成官方页面操作后再次检查；脚本遵守服务器返回的最短检查间隔。为避免 iOS 挂起浏览器切换期间的轮询，**不使用后台自动登录轮询**。
6. 成功后显示匿名“官方账号 N”，可以继续添加不同账号。浏览器可能记住上一个账号，添加前请在官方页面切换目标账号；重复登录同一账号更新原登录，不增加重复项或改变其位置。
7. “刷新官方额度”手动读取；小组件正常按刷新设置读取。访问令牌到期或遇到401时尝试官方续期，保存轮换后的 refresh token；续期失效需重新添加该账号。

“取消登录”、离开设置页或15分钟超时不会保存该次登录。退出只删除指定账号的**本机登录**、其缓存条目、勾选与排序，不删除其他官方账号、Parrot 配置或浏览器登录，也不是全局撤销 OpenAI 会话。

### 官方数据与真实限制

- 使用官方 Codex device-auth 协议：申请代码、检查授权、用官方返回的 PKCE verifier 换令牌；交换使用官方规定的 `https://auth.openai.com/deviceauth/callback`。不把 Scripting 的 `scripting://oauth_callback/...` 伪装成 localhost 回调，不绕过认证，不复制其他应用的登录文件。
- 只向 OpenAI 官方主机直接请求：`auth.openai.com` 和 `chatgpt.com`。额度来自只读 `GET /backend-api/wham/usage`；按窗口时长识别5小时/每周，缺少时长时兼容 primary/secondary 语义；月度或其他自定义窗口不会冒充5小时或每周。
- 重置卡优先使用额度响应中的 `rate_limit_reset_credits.available_count`，缺失时尝试只读 `GET /backend-api/wham/rate-limit-reset-credits` 的 `available_count`。不以最多10条详情的长度代替真实数量；无权限、不支持或字段缺失时保持未知。充值余额不是重置卡数量。
- 这些额度接口**未提供与 Parrot 对等的今日/本月 Token 和花费**，不显示 `$0`、0 Token 或虚构统计，也不混入另一来源的统计。
- 当前不支持要求专用路由的 FedRAMP 账号；授权信息不完整、设备授权不可用或服务拒绝请求时明确报错，不回退到假登录/复制凭据方案。
- 本项目是第三方脚本，不是 OpenAI 官方客户端。公开 Codex 协议不代表 OpenAI 对第三方 Scripting 客户端的兼容性承诺；接口、权限和风控可能变化。

公开协议依据：[device_code_auth.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs)、[OAuth client](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs)、[客户端ID及刷新](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)、[额度与重置卡 GET](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[窗口模型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs)。

## 账号排序、勾选与参数

- App 列表长按账号行文字区域启动系统拖拽，拖到目标行后松手排序：向上移动插到目标前，向下移动插到目标后。无需进入编辑模式，不使用上移/下移按钮；开关仍用于勾选。编号随排序变化。按稳定账号ID持久化，两种来源各自独立；新出现账号排末尾，成功刷新时移除已删除账号的顺序与失效勾选。
- 交互依据为本地官方文档 `view_modifiers/ondrag_and_ondrop/zh.md` 的 `onDrag` / `onDrop` 与 `item_provider/zh.md` 的 `ItemProvider.fromText/loadText`。不是仅在编辑模式显示拖动把手的 `List/ForEach.onMove`：原生拖拽挂在账号行视图上。松手后才保存顺序，取消拖动不改变排序；只接受本设置页面发起、同来源的账号拖动。真实长按响应、与Toggle/滚动的手势协调须在手机验证。
- 最多勾选四个账号，含 Parrot 已停用账号。**小组件按列表排序显示，不按勾选先后**；未设置勾选时取列表前四个已启用账号。选择/排序不启用或停用 Parrot 账号。
- 长按桌面小组件 → 编辑 → 参数，可填排序后列表序号（从1开始），英文/中文逗号或空格分隔。参数优先于默认勾选，并保留指定序列：`3,1` 显示排序后第三、第一。排序后数字参数代表的账号可能变化，请按需调整。
- 小号显示选择序列前两个，中号和大号显示前四个。设置页可预览三种尺寸。
- 大号标签仍等宽、两行倒计时对齐，仅收窄标签到分隔点 `·` 的间距；小中号布局不变。

## 更新与安全

App“更新” → “检查更新”，从本仓库下载 `api.ts`、`widget.tsx`、`index.tsx`，全部下载成功后写入。官方数据层内联在 `api.ts`，兼容1.6.9三文件更新器；配置与凭据不在代码中。更新后退出并重新运行。代码版本与 `script.json` 均为1.7.3；本机 `script.json` 不覆盖，以保留导入元数据。

- 地址、Parrot 管理密钥/会话以及独立官方 token 都只存本机脚本隔离 Keychain，默认不开启 iCloud 同步。官方使用独立钥匙串条目；缓存/排序只有匿名ID、编号和额度，不存邮箱或 token。
- 不向 Parrot、GitHub 或第三方发送官方 token，不将凭据写入日志/源码。Parrot 管理密钥具有完整管理权限，勿分享填好凭据的脚本或钥匙串数据。
- “清除Parrot配置”保留原清除行为（含共用刷新间隔恢复默认），不退出官方账号；普通来源切换不清除配置。

## 本地验证边界

`tests/mock.cjs` 使用虚构凭据、内存 Keychain/Storage 和模拟 fetch，不连接账号服务。需 Node.js 及 TypeScript：

```sh
TYPESCRIPT_PATH=/path/to/typescript node tests/mock.cjs
```

覆盖等待授权403/404、检查间隔、过期、取消/在途取消、成功与重复登录、令牌续期/401重试/轮换保存、窗口反序与月度排除、重置卡缺失/0/权威总数、来源隔离与单账号退出、排序与参数、三种尺寸组件树、大号六列及标签间距、版本与旧更新器兼容；模拟原生拖放回调的数据加载作用域、上下移动、取消/自身放置/无效数据/跨来源拒绝以及一位小数舍入边界，以及两期共享等宽列/leading对齐、不同内容长度和三种尺寸双箭头刷新图标、小号单账号四列口径与缺失提示/双账号不增加统计，并作 TypeScript 语法转译检查。

**这些测试不是 iPhone 真机验收，也不是实际官方登录成功的证明。** 未在服务器代用户登录或请求账号授权；首轮实际授权、组织权限、手机网络及像素级布局仍需用户在 Scripting 手机上操作确认；本轮小号新增统计只验证组件树和官方布局API，尚未进行真机像素及窄屏适配验收。验收截图不包含在公开项目文件中。
