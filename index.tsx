import {
  Button, Form, Group, HStack, Spacer, LabeledContent, Navigation, NavigationLink, NavigationStack, Picker, Script, Section,
  SecureField, Text, TextField, Widget, VStack, useState, useEffect,
  ScrollView, LazyVGrid, ReorderableForEach, RoundedRectangle, modifiers, useObservable,
} from "scripting"
import { getStatisticsSource, saveStatisticsSource, StatisticsSource, getSub2APIConfig, saveSub2APIConfig, clearSub2APIConfig, getConfig, saveConfig, loadUsage, fmtUsd, fmtTokens, fmtPct, Account, cachedAccounts, getRefreshMinutes, saveRefreshMinutes, REFRESH_OPTIONS, getSource, saveSource, DataSource, getWidgetName, saveWidgetName } from "./api"
import { beginDeviceLogin, checkDeviceLogin, cancelDeviceLogin, DeviceLogin, officialAccounts, logoutOfficial, saveAccountOrder, addDeepSeekAccount, deepSeekSummary } from "./api"
import { beginClaudeLogin, finishClaudeLogin, cancelClaudeLogin, ClaudeLogin, claudeCooldownUntil, claudeCooldownMessage } from "./api"

const VERSION = "1.10.3"
const accountLabel = (a: Account, i: number) => `${i + 1}. ${a.provider === "deepseek" ? "DeepSeek" : a.provider === "claude" ? "Claude" : "Codex"} · ${a.name}`

// Separate ScrollView page: Scripting docs recommend ReorderableForEach outside List/Form (built-in long-press drag).
function AccountOrderPage({ source, onSaved }: { source: DataSource; onSaved: (next: Account[]) => void }) {
  const data = useObservable<Account[]>(() => cachedAccounts())
  const active = useObservable<Account | null>(null)
  const onMove = (indices: number[], newOffset: number) => {
    // A page opened for one source must never write after the app switched source.
    if (getSource() !== source) return
    const current = data.value
    if (!indices.length || indices.some(i => i < 0 || i >= current.length)) return
    // Standard implementation from views/reorderable_foreach documentation.
    const movingItems = indices.map(index => current[index])
    const newValue = current.filter((_, index) => !indices.includes(index))
    newValue.splice(Math.max(0, Math.min(newOffset, newValue.length)), 0, ...movingItems)
    if (newValue.every((a, i) => a.id === current[i].id)) return
    data.setValue(newValue)
    saveAccountOrder(newValue.map(a => a.id), source)
    onSaved(newValue)
    void Widget.reloadAll()
  }
  return <ScrollView navigationTitle={"账号排序"} navigationBarTitleDisplayMode={"inline"}>
    <VStack alignment="leading" spacing={10} padding>
      <Text font={13} foregroundStyle={"secondaryLabel"}>长按账号卡片拖到新位置，松手即保存。小号默认显示前2个、中大号前4个；数字参数按此序号。</Text>
      {data.value.length ? <LazyVGrid columns={[{ size: { type: "flexible" } }]} spacing={8}>
        <ReorderableForEach
          active={active}
          data={data.value}
          builder={(a, i) => <VStack
            key={a.id}
            modifiers={modifiers()
              .frame({ maxWidth: "infinity", alignment: "leading" as any })
              .padding({ horizontal: 14, vertical: 12 })
              .background(<RoundedRectangle cornerRadius={12}
                fill={active.value?.id === a.id ? "tertiarySystemFill" : "secondarySystemGroupedBackground"} />)
              .contentShape({ kind: "dragPreview", shape: { type: "rect", cornerRadius: 12 } })}
          >
            <Text>{accountLabel(a, i)}</Text>
          </VStack>}
          onMove={onMove}
        />
      </LazyVGrid> : <Text>连接成功后显示账号列表</Text>}
    </VStack>
  </ScrollView>
}

function WidgetNamePage({ account, source, onSaved }: { account: Account; source: DataSource; onSaved: () => void }) {
  const close = Navigation.useDismiss()
  const [name, setName] = useState(getWidgetName(account.id, source))
  const [saved, setSaved] = useState(false)
  async function save() {
    saveWidgetName(account.id, name, source)
    setName(name.trim())
    setSaved(true)
    onSaved()
    await Widget.reloadAll()
  }
  return <Form navigationTitle="小组件用户名" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>{account.name}</Text>} footer={<Text>仅修改本机小组件显示，所有尺寸共用。留空保存恢复原名；不修改远端账号。三种额度来源独立保存。</Text>}>
      <TextField title="小组件用户名" value={name} onChanged={value => { setName(value); setSaved(false) }} prompt="留空使用原名" />
      <Button title="保存" action={save} />
      {saved ? <Text>已保存</Text> : null}
    </Section>
    <Button title="完成" action={close} />
  </Form>
}

const DEVICE_URL = "https://auth.openai.com/codex/device"
const UNSUPPORTED_BROWSER = "当前Scripting不支持WebViewController临时浏览器，请更新Scripting或使用Safari备用"
async function presentIsolatedAuthorization(register?: (release: (() => void) | null) => void, url = DEVICE_URL) {
  // loadURL resolves on navigation completion, not on initiating the load. Present BEFORE waiting
  // for a login/redirect page, otherwise its pending navigation can hide the modal indefinitely.
  // WebViewController is a GLOBAL API in the official WebView example, not a scripting module export.
  if (typeof WebViewController !== "function") throw new Error(UNSUPPORTED_BROWSER)
  const browser = new WebViewController({ ephemeral: true })
  let released = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop!: () => void
  const cancelled = new Promise<void>(resolve => { stop = resolve })
  const release = () => { if (!released) { released = true; stop(); browser.dispose() } }
  register?.(release)
  try {
    const failure = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("授权页面加载超时，请使用Safari备用或外部无痕浏览器")), 20000)
    })
    const shown = browser.present({ fullscreen: true, navigationTitle: "官方授权（临时会话）" })
    const loading = browser.loadURL(url).then(ok => {
      if (timer != null) clearTimeout(timer)
      if (!ok && !released) throw new Error("授权页面加载失败，请使用Safari备用或外部无痕浏览器")
      return new Promise<void>(() => {}) // Loading success is NOT dismissal or authorization success.
    })
    await Promise.race([shown, loading, failure, cancelled])
  } finally {
    if (timer != null) clearTimeout(timer)
    release()
    register?.(null)
  }
}
// One foreground check after either browser closes, no polling loop.
async function checkAfterSafari(d: DeviceLogin, active: () => boolean,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  present: () => Promise<void> = () => Safari.present(DEVICE_URL)) {
  try { await present() }
  catch (e: any) {
    throw new Error((e?.message === UNSUPPORTED_BROWSER || e?.message?.startsWith("授权页面加载")) ? e.message : "无法打开官方授权页，请稍后重试")
  }
  if (!active() || d.cancelled) return null
  const remaining = Math.max(0, d.nextPoll - Date.now())
  if (remaining) await wait(Math.min(remaining, Math.max(0, d.expiresAt - Date.now())))
  if (!active() || d.cancelled) return null
  return checkDeviceLogin(d)
}
function SettingsView() {
  const close = Navigation.useDismiss()
  const [source, setSource] = useState<DataSource>(getSource())
  const [device, setDevice] = useState<DeviceLogin | null>(null)
  const [loginProvider, setLoginProvider] = useState("codex")
  const [claude, setClaude] = useState<ClaudeLogin | null>(null)
  const [claudeCode, setClaudeCode] = useState("")
  const [claudeProgress, setClaudeProgress] = useState("")
  const [cooldownTick, setCooldownTick] = useState(0)
  const claudeCooling = claudeCooldownUntil() > 0
  useEffect(() => {
    if (source !== "official" || loginProvider !== "claude" || !claudeCooldownUntil()) return
    const timer = setTimeout(() => setCooldownTick(cooldownTick + 1), 1000)
    return () => clearTimeout(timer)
  }, [source, loginProvider, cooldownTick, claudeCooling])
  const [dsName, setDSName] = useState("")
  const [dsToken, setDSToken] = useState("")
  const [logins, setLogins] = useState(officialAccounts())
  const [auth] = useState({ device: null as DeviceLogin | null, alive: true, running: false, epoch: 0, claude: null as ClaudeLogin | null, releaseBrowser: null as (() => void) | null })
  const stopAuth = () => { auth.epoch++; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.device) cancelDeviceLogin(auth.device); auth.device = null; setDevice(null); if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; setClaude(null); setClaudeCode(""); setClaudeProgress("") }
  const dismiss = () => { auth.alive = false; stopAuth(); close() }
  const [statisticsSource, setStatisticsSource] = useState<StatisticsSource>(getStatisticsSource())
  const subCur = getSub2APIConfig()
  const [subUrl, setSubUrl] = useState(subCur.baseUrl ?? "")
  const [subKey, setSubKey] = useState("")
  const [subTimezone, setSubTimezone] = useState(subCur.timezone)
  const [hasSubKey, setHasSubKey] = useState(!!subCur.adminKey)
  const cur = getConfig()
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "")
  const [key, setKey] = useState("")
  const [hasKey, setHasKey] = useState(!!cur.managementKey)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(hasKey ? "已配置，可点“测试连接”" : "未配置：填写后点“保存并测试”")
  const [browserError, setBrowserError] = useState("")
  const [lines, setLines] = useState<string[]>([])
  const [refreshMinutes, setRefreshMinutes] = useState(String(getRefreshMinutes()))
  const [accounts, setAccounts] = useState<Account[]>(cachedAccounts())

  useEffect(() => {
    if (getSource() === "official" || getSource() === "sub2api" && subCur.adminKey || cur.managementKey) test()
  }, [])

  useEffect(() => () => { auth.alive = false; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.device) cancelDeviceLogin(auth.device); auth.device = null; if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; auth.epoch++ }, [])

  async function changeSource(value: string) {
    stopAuth()
    saveSource(value as DataSource)
    setSource(value as DataSource)
    setAccounts(cachedAccounts())
    setLines([])
    await test()
    await Widget.reloadAll()
  }

  async function addOfficial() {
    if (loginProvider === "claude") { startClaude(); return }
    if (auth.running) return
    setBrowserError("")
    auth.running = true
    const epoch = auth.epoch
    setBusy(true)
    try {
      const d = await beginDeviceLogin()
      if (!auth.alive || epoch !== auth.epoch || getSource() !== "official") { cancelDeviceLogin(d); return }
      auth.device = d
      setDevice(d)
      setStatus("请打开官方授权页输入一次性代码；关闭网页后自动检查，也可手动检查")
    } catch (e: any) { if (auth.alive) setStatus(e.message) }
    finally { auth.running = false; if (auth.alive && epoch === auth.epoch) setBusy(false) }
  }

  function startClaude(manual = false) {
    if (auth.running) return
    if (claudeCooldownUntil()) { setStatus(claudeCooldownMessage()); return }
    stopAuth(); setBrowserError("")
    try {
      const d = beginClaudeLogin(() => { if (auth.claude === d && auth.alive) void completeClaude(d) }, () => {
        if (auth.claude === d && auth.alive) { stopAuth(); setBusy(false); setStatus("Claude授权已过期，请重新开始") }
      }, manual, stage => {
        // Completed account identity is rendered only by the shared login row, never a second Text.
        if (auth.claude === d && auth.alive && getSource() === "official" && !stage.startsWith("Claude ")) setClaudeProgress(stage)
      })
      auth.claude = d; setClaude(d); setClaudeCode(""); setClaudeProgress(d.progress)
      setStatus(d.fallback || (d.manual ? "请完成Claude官方页面授权并粘贴完整code#state" : "请打开Claude授权页；本机回调成功后自动检查并保存"))
    } catch (e: any) { setStatus(e.message); setBrowserError(e.message) }
  }
  async function completeClaude(attempt = auth.claude) {
    if (!attempt || attempt.consumed) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.claude === attempt && auth.epoch === epoch && getSource() === "official"
    if (!valid()) return
    auth.running = true; setBusy(true); setBrowserError("")
    try {
      await finishClaudeLogin(attempt, claudeCode, valid)
      if (!valid()) return
      auth.claude = null; setClaude(null); setClaudeCode(""); setClaudeProgress("")
      auth.releaseBrowser?.(); auth.releaseBrowser = null
      setLogins(officialAccounts()); await test()
    } catch (e: any) {
      if (valid()) {
        setStatus(e.message); setBrowserError(e.message)
        if (attempt.consumed || attempt.cancelled) setClaudeProgress(e.message?.startsWith("Claude授权交换失败（HTTP 429")
          ? "Claude授权已结束：令牌交换受限（HTTP 429），请勿立即重试"
          : "Claude授权未完成，请查看错误提示")
        if (attempt.consumed || attempt.cancelled) {
          setClaudeCode("")
          auth.claude = null; setClaude(null); auth.releaseBrowser?.(); auth.releaseBrowser = null
        }
      }
    } finally { auth.running = false; if (auth.alive && epoch === auth.epoch) setBusy(false) }
  }
  async function openClaude(safari: boolean) {
    const d = auth.claude
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.claude === d && auth.epoch === epoch && getSource() === "official"
    auth.running = true; setBusy(true); setBrowserError(""); setStatus("正在打开Claude官方授权页…")
    try {
      if (safari) await Safari.present(d.url)
      else await presentIsolatedAuthorization(release => { auth.releaseBrowser = release }, d.url)
      if (valid() && !d.consumed) {
        if (d.code) await completeClaude(d)
        else setStatus(d.manual ? "请粘贴本次完整code#state后完成Claude授权" : "尚未收到Claude回调，可重试或重新发起手动授权码流程")
      }
    } catch (e: any) { if (valid()) {
      const message = e?.message === UNSUPPORTED_BROWSER || e?.message?.startsWith("授权页面加载") ? e.message : "无法打开Claude授权页，请重试或使用Safari备用"
      setBrowserError(message); setStatus(message)
    } }
    finally {
      // Closing the browser must not unlock an exchange/profile request still in flight.
      if (auth.alive && epoch === auth.epoch && !(auth.claude === d && d.consumed && !d.cancelled)) {
        auth.running = false; setBusy(false)
      }
    }
  }

  async function checkOfficial(browser: boolean | "safari" = false) {
    const d = auth.device
    if (!d || auth.running) return
    auth.running = true
    setBusy(true)
    const epoch = auth.epoch
    const active = () => auth.alive && auth.device === d && auth.epoch === epoch && getSource() === "official"
    if (browser) { setBrowserError(""); setStatus("正在打开官方授权页…；加载失败时可改用Safari备用") }
    try {
      const result = browser ? await checkAfterSafari(d, active, undefined,
        browser === "safari" ? () => Safari.present(DEVICE_URL) : () => presentIsolatedAuthorization(release => { auth.releaseBrowser = release })) : await checkDeviceLogin(d)
      if (!active() || result == null) return
      if (result === "pending") setStatus("等待授权：请完成官方页面操作后再次检查（15分钟内有效）")
      else {
        auth.device = null
        setDevice(null)
        setLogins(officialAccounts())
        await test()
      }
    } catch (e: any) {
      if (active()) {
        // A browser presentation failure is retryable; it says nothing about the device authorization.
        const presentationFailed = e.message === UNSUPPORTED_BROWSER || e.message === "无法打开官方授权页，请稍后重试" || e.message.startsWith("授权页面加载")
        if (presentationFailed) setBrowserError(e.message)
        if (!presentationFailed) {
          cancelDeviceLogin(d)
          auth.device = null
          setDevice(null)
        }
        setStatus(e.message)
      }
    } finally { auth.running = false; if (auth.alive && epoch === auth.epoch) setBusy(false) }
  }

  async function test() {
    const requestSource = getSource(), requestStats = getStatisticsSource()
    const statsName = requestStats === "sub2api" ? "Sub2API" : "Parrot"
    setBusy(true)
    setStatus("连接中…")
    setLines([])
    try {
      const r = await loadUsage()
      // A late refresh from the previous source must not replace this source's account list/status.
      if (!auth.alive || getSource() !== requestSource || getStatisticsSource() !== requestStats) return
      if (r.data) {
        setAccounts(r.data.accounts)
      }
      if (r.data) {
        const d = r.data
        setStatus(r.stale ? "❌ 额度使用缓存：" + (r.error ?? "读取失败") : d.accounts.some(a => a.balance?.error || a.readError) || d.providerErrors?.length ? "⚠️ 部分账号读取失败或使用缓存，见下方详情" : d.statistics?.error ? `⚠️ 额度已刷新；${statsName}统计独立读取失败` : "✅ 连接成功")
        setLines([
          `统计：${statsName}全部账号汇总；额度：${requestSource === "official" ? "官方（Codex/Claude OAuth、DeepSeek）" : requestSource === "sub2api" ? "Sub2API" : "Parrot"}`,
          ...(d.statistics ? [d.statistics.fetchedAt == null ? `${statsName}统计未提供` : `${statsName}统计${d.statistics.stale ? "缓存" : "更新时间"}：${new Date(d.statistics.fetchedAt).toLocaleString()}`,
            ...(d.statistics.error ? [`${statsName}统计错误：${d.statistics.error}`] : [])] : []),
          ...(d.today && d.month ? [
            `今日 ${fmtUsd(d.today.costUsd)} · ${fmtTokens(d.today.totalTokens)} tok · ${d.today.requests} 次`,
            `本月 ${fmtUsd(d.month.costUsd)} · ${fmtTokens(d.month.totalTokens)} tok`,
          ] : [`${statsName}今日/本月Token及花费统计未提供`]),
          ...(d.providerErrors ?? []),
          ...d.accounts.map(a => a.provider === "deepseek" ? `${a.name}：${deepSeekSummary(a)}` : `${a.provider === "deepseek" ? "DeepSeek" : a.provider === "claude" ? "Claude" : "Codex"} ${a.name}：5 h 余 ${fmtPct(a.fiveHour.remainingPercent)}、每周余 ${fmtPct(a.sevenDay.remainingPercent)}${a.resetCredits == null ? " · 重置卡未提供" : ` · 重置:${a.resetCredits}`}`),
        ])
        await Widget.reloadAll()
      } else {
        setStatus("❌ " + (r.error ?? "未知错误"))
      }
    } catch (e: any) {
      setStatus("❌ " + String(e?.message ?? e))
    }
    setBusy(false)
  }

  async function save() {
    const finalKey = key.trim() || cur.managementKey || ""
    if (!baseUrl.trim() || !finalKey) {
      setStatus("❌ 地址和管理密钥都不能为空")
      return
    }
    saveConfig(baseUrl, finalKey)
    setKey("")
    setHasKey(true)
    await test()
  }

  return <NavigationStack>
    <Form
      navigationTitle={"AI 用量"}
      navigationBarTitleDisplayMode={"inline"}
      toolbar={{
        cancellationAction: <Button title={"完成"} action={dismiss} />,
      }}
    >
      <Section header={<Text>数据来源</Text>} footer={<Text>切换不删除另一来源的配置、账号或选择。普通 API Key 不能查询 Parrot 管理接口。</Text>}>
        <LabeledContent title="当前脚本版本" value={VERSION} />
        <Picker title={"账号来源"} value={source} onChanged={changeSource} disabled={busy}>
          <Text tag={"parrot"}>Parrot</Text>
          <Text tag={"official"}>官方（Codex/Claude OAuth、DeepSeek）</Text>
          <Text tag="sub2api">Sub2API</Text>
        </Picker>
      </Section>

      <Section header={<Text>统计来源</Text>} footer={<Text>与额度来源独立，Parrot/Sub2API二选一不合计。均为该服务全部账号汇总，不按小组件账号过滤；重置卡只跟随额度来源。切换不清除配置或凭据。</Text>}>
        <Picker title="统计来源" value={statisticsSource} disabled={busy} onChanged={async value => {
          saveStatisticsSource(value as StatisticsSource); setStatisticsSource(value as StatisticsSource); setLines([]); await test()
        }}>
          <Text tag="parrot">Parrot</Text><Text tag="sub2api">Sub2API</Text>
        </Picker>
      </Section>
      {statisticsSource === "sub2api" || source === "sub2api" ? <Section header={<Text>Sub2API连接</Text>} footer={<Text>额度与统计共用部署根地址和Admin API Key（不是普通用户Key）。统计为全站汇总，花费为actual_cost实际扣费；时区决定今日/自然月边界。管理员凭据仅存本机钥匙串，权限较高，建议HTTPS。只GET查询，不兑换重置卡、不重置额度。自动发现Claude OAuth/SetupToken、Codex OAuth和DeepSeek余额账号；缺少字段显示未知。</Text>}>
        <TextField title="Sub2API地址" value={subUrl} onChanged={setSubUrl} prompt="https://你的部署地址" />
        <SecureField title="Sub2API管理员密钥" value={subKey} onChanged={setSubKey} prompt={hasSubKey ? "已保存，留空沿用" : "Admin API Key"} />
        <TextField title="统计时区" value={subTimezone} onChanged={setSubTimezone} prompt="Asia/Shanghai" />
        <Button title="保存Sub2API并测试" disabled={busy} action={async () => {
          try { saveSub2APIConfig(subUrl, subKey.trim() || getSub2APIConfig().adminKey || "", subTimezone); setSubKey(""); setHasSubKey(true); setAccounts(cachedAccounts()); await test() }
          catch (e: any) { setStatus(String(e?.message ?? "Sub2API配置无效")) }
        }} />
        {hasSubKey ? <Button title="测试Sub2API连接" action={test} disabled={busy} /> : null}
        {hasSubKey ? <Button title="清除Sub2API配置" disabled={busy} action={async () => { clearSub2APIConfig(); setSubKey(""); setSubUrl(""); setHasSubKey(false); setLines([]); setAccounts(cachedAccounts()); await test() }} /> : null}
      </Section> : null}

      {source === "official" ? <Section header={<Text>官方账号（独立登录）</Text>} footer={<Text>登录服务可选Codex、Claude或DeepSeek。DeepSeek使用官方API Key直接添加并验证，不是OAuth。Codex/Claude默认临时会话不保留登录Cookie，便于添加不同账号；支持独立Codex与Claude登录。Claude自动接收本机回调，无法使用时可重新发起手动授权码流程。Google/Apple等可能限制嵌入登录，可用Safari备用（可能复用旧会话）。Codex也可在外部无痕窗口打开下方网址输入本次代码后返回检查；Claude可重新发起手动授权码流程。Token仅存本机钥匙串；账号显示官方授权中已有的完整邮箱，仅本机保存；未提供邮箱时需重新登录尝试获取。退出只移除此账号的本机登录。</Text>}>
        <Picker title="登录服务" value={loginProvider} onChanged={value => { stopAuth(); setLoginProvider(value); setBusy(false); setBrowserError("") }} disabled={busy}>
          <Text tag="codex">Codex</Text><Text tag="claude">Claude</Text><Text tag="deepseek">DeepSeek</Text>
        </Picker>
        {loginProvider !== "deepseek" && !device && !claude ? <Button title={"添加官方账号"} action={addOfficial} disabled={busy || (loginProvider === "claude" && claudeCooling)} /> : null}
        {loginProvider === "claude" && claudeCooling ? <Text>{claudeCooldownMessage()}</Text> : null}
        {loginProvider === "claude" && claudeProgress ? <Text>{claudeProgress}</Text> : null}
        {claude ? <>
          <Text>{claude.manual ? "Claude官方手动授权码：完成授权后粘贴完整code#state" : "Claude本机回调：完成网页授权后自动保存账号"}</Text>
          {claude.fallback ? <Text font={12} foregroundStyle="secondaryLabel">{claude.fallback}</Text> : null}
          <Button title="打开Claude授权页" action={() => openClaude(false)} disabled={busy} />
          <Button title="Safari备用Claude授权页" action={() => openClaude(true)} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          {claude.manual ? <>
            <SecureField title="本次完整授权码" value={claudeCode} onChanged={setClaudeCode} prompt="code#state" />
            <Button title="完成Claude授权" action={() => completeClaude()} disabled={busy || !claudeCode.trim()} />
          </> : <Button title="改用手动授权码" action={() => startClaude(true)} disabled={busy} />}
          <Button title="取消Claude登录" action={() => { stopAuth(); setBusy(false); setStatus("已取消Claude登录") }} />
        </> : null}
        {device ? <>
          <Text contextMenu={{ menuItems: <Group>
            <Button title="复制代码" action={async () => {
              // A retained menu action must not copy an old, cancelled or expired attempt.
              if (!auth.alive || auth.device !== device || device.cancelled || Date.now() >= device.expiresAt || getSource() !== "official") return
              await Pasteboard.setString(device.code)
            }} disabled={device.cancelled || Date.now() >= device.expiresAt} />
          </Group> }}>一次性代码：{device.code}</Text>
          <Text>仅输入你自己在此脚本发起的代码，有效期15分钟。</Text>
          <Button title={"打开官方授权页"} action={() => checkOfficial(true)} disabled={busy} />
          <Button title={"Safari备用授权页"} action={() => checkOfficial("safari")} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          <Text font={12} foregroundStyle="secondaryLabel">外部无痕授权网址：https://auth.openai.com/codex/device；输入本次代码后返回点“检查授权”。无需退出已授权账号。</Text>
          <Button title={"检查授权"} action={() => checkOfficial()} disabled={busy} />
          <Button title={"取消登录"} action={() => { stopAuth(); setBusy(false); setStatus("已取消登录") }} />
        </> : null}
        {!device && !claude && browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
        {logins.map(a => <HStack key={a.id}>
          <Text fixedSize={{ horizontal: false, vertical: true }}>{`${a.provider === "deepseek" ? "DeepSeek" : a.provider === "claude" ? "Claude" : "Codex"} ${a.provider === "claude" ? a.email || "邮箱未提供" : a.name}`}</Text>
          <Spacer />
          <Button title="点击退出" buttonStyle="borderless" fixedSize={{ horizontal: true, vertical: true }} disabled={busy || !!device || !!claude} action={async () => {
          try {
            logoutOfficial(a.id)
            setLogins(officialAccounts())
            setAccounts(cachedAccounts())
            await test()
            await Widget.reloadAll()
          } catch (e: any) { setStatus(e.message) }
        }} />
        </HStack>)}
        <Button title={"刷新官方额度"} action={test} disabled={busy || !!device || !!claude} />
      </Section> : null}
      {source === "official" && loginProvider === "deepseek" ? <Section header={<Text>添加DeepSeek官方账号</Text>} footer={<Text>不是OAuth：新增账号使用官方API Key查询余额。已有网页Token账号保留原查询能力，失效需更新；此处不再提供新增网页Token入口。无订阅接口。凭据仅保存本机钥匙串，不自动读取其他脚本。每次添加独立账号，退出仅移除该账号。</Text>}>
        <TextField title="DeepSeek账号名称" value={dsName} onChanged={setDSName} />
        <SecureField title="DeepSeek凭据" value={dsToken} onChanged={setDSToken} prompt="填入api key" />
        <Button title="添加DeepSeek账号" disabled={busy || !!device || !!claude} action={async () => {
          try { addDeepSeekAccount(dsName, "api", dsToken); setDSToken(""); setDSName(""); setLogins(officialAccounts()); await test() }
          catch { setStatus("DeepSeek添加失败，请检查名称、API Key和钥匙串权限") }
        }} />
      </Section> : null}
      {source === "parrot" || statisticsSource === "parrot" ? <Section header={<Text>Parrot 连接</Text>} footer={<Text>密钥只保存在本机钥匙串。已保存过密钥时可留空。</Text>}>
        <TextField title={"地址"} value={baseUrl} onChanged={setBaseUrl} prompt={"填写你自己的 Parrot 地址"} />
        <SecureField title={"管理密钥"} value={key} onChanged={setKey} prompt={hasKey ? "已保存，留空沿用" : "managementKey"} />
        <Button title={busy ? "处理中…" : "保存并测试"} action={save} disabled={busy} />
        {hasKey ? <Button title={"测试连接"} action={test} disabled={busy} /> : null}
      </Section> : null}

      <Section header={<Text>状态</Text>}>
        <Text>{status}</Text>
        {lines.map(l => <Text font={13}>{l}</Text>)}
      </Section>

      <Section header={<Text>小组件账号</Text>} footer={<Text>保留列表全部账号，不改变远端状态。点“账号排序”进入单独页面，长按账号卡片拖动排序，松手即保存。默认按此列表顺序显示，小号前2个、中大号前4个，不按启用状态过滤。数字参数按排序后序号映射，参数顺序仍有效（如3,1显示第三、第一）。三种额度来源的排序独立保存。</Text>}>
        {accounts.map((a, i) => <NavigationLink key={a.id}
          destination={<WidgetNamePage account={a} source={source} onSaved={() => setAccounts(cachedAccounts())} />}>
          <VStack alignment="leading" spacing={3}>
            <Text>{accountLabel(a, i)}</Text>
            <Text font={12} foregroundStyle="secondaryLabel">小组件用户名：{getWidgetName(a.id, source) || "使用原名（点此设置）"}</Text>
          </VStack>
        </NavigationLink>)}
        {accounts.length > 1 ? <NavigationLink destination={<AccountOrderPage key={source} source={source} onSaved={setAccounts} />}>
          <Text>账号排序</Text>
        </NavigationLink> : null}
        {!accounts.length ? <Text>连接成功后显示账号列表</Text> : null}
      </Section>

      <Section header={<Text>小组件刷新</Text>} footer={<Text>这是请求刷新间隔，实际时间由iOS调度，可能延后。更短间隔会增加网络请求与耗电。</Text>}>
        <Picker title={"刷新间隔"} value={refreshMinutes} onChanged={async (value: string) => {
          setRefreshMinutes(value)
          saveRefreshMinutes(Number(value))
          await Widget.reloadAll()
        }}>
          {REFRESH_OPTIONS.map(m => <Text tag={String(m)}>{m}分钟</Text>)}
        </Picker>
      </Section>

      <Section header={<Text>预览小组件</Text>}>
        <Button title="预览小组件" action={() => Widget.preview({ family: "systemSmall" })} />
      </Section>


    </Form>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
