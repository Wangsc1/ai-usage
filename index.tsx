import {
  Button, EditButton, ForEach, Form, Group, HStack, Spacer, LabeledContent, Navigation, NavigationLink, NavigationStack, Picker, Script, Section,
  SecureField, Text, TextField, Widget, VStack, useState, useEffect,
  ScrollView, LazyVGrid, ReorderableForEach, RoundedRectangle, modifiers, useObservable,
} from "scripting"
import { getStatisticsSource, saveStatisticsSource, StatisticsSource, getSub2APIConfig, saveSub2APIConfig, clearSub2APIConfig, getConfig, saveConfig, loadUsage, Account, cachedAccounts, managementAccounts, sortAccounts, getRefreshMinutes, saveRefreshMinutes, REFRESH_OPTIONS, getSource, saveSource, DataSource, getWidgetName, saveWidgetName } from "./api"
import { beginDeviceLogin, checkDeviceLogin, cancelDeviceLogin, DeviceLogin, officialAccounts, logoutOfficial, saveAccountOrder, addDeepSeekAccount } from "./api"
import { beginClaudeLogin, finishClaudeLogin, cancelClaudeLogin, ClaudeLogin, claudeCooldownUntil, claudeCooldownMessage } from "./api"

const VERSION = "1.10.21"
// EditButton/ForEach.onMove come from the official runnable example views/list/editable_list/index.tsx.
// Guard their presence so a runtime without these exports keeps the long-press sub-page instead of failing to render.
const NATIVE_SORT = typeof EditButton !== "undefined" && EditButton != null && typeof ForEach !== "undefined" && ForEach != null
const accountLabel = (a: Account, i: number) => `${i + 1}. ${a.provider === "deepseek" ? "DeepSeek" : a.provider === "claude" ? "Claude" : "Codex"} · ${a.name}`

// Separate ScrollView page: Scripting docs recommend ReorderableForEach outside List/Form (built-in long-press drag).
function AccountOrderPage({ source, onSaved }: { source: DataSource; onSaved: (next: Account[]) => void }) {
  const data = useObservable<Account[]>(() => managementAccounts())
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
const UNSUPPORTED_BROWSER = "当前Scripting不支持WebViewController临时浏览器，请更新Scripting"
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
      timer = setTimeout(() => reject(new Error("授权页面加载超时，请重试")), 20000)
    })
    const shown = browser.present({ fullscreen: true, navigationTitle: "官方授权（临时会话）" })
    const loading = browser.loadURL(url).then(ok => {
      if (timer != null) clearTimeout(timer)
      if (!ok && !released) throw new Error("授权页面加载失败，请重试")
      return new Promise<void>(() => {}) // Loading success is NOT dismissal or authorization success.
    })
    await Promise.race([shown, loading, failure, cancelled])
  } finally {
    if (timer != null) clearTimeout(timer)
    release()
    register?.(null)
  }
}
// One foreground check after the authorization browser closes, no polling loop.
async function checkAfterBrowser(d: DeviceLogin, active: () => boolean,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  present: () => Promise<void> = () => presentIsolatedAuthorization()) {
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
function maskedKey(value: string): string {
  const chars = Array.from(value)
  return chars.length > 4 ? chars.slice(0, 4).join("") + "*".repeat(chars.length - 4) : "*".repeat(chars.length)
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
  const [subKeyEditing, setSubKeyEditing] = useState(false)
  const [subTimezone, setSubTimezone] = useState(subCur.timezone)
  const [hasSubKey, setHasSubKey] = useState(!!subCur.adminKey)
  const cur = getConfig()
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "")
  const [key, setKey] = useState("")
  const [keyEditing, setKeyEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [browserError, setBrowserError] = useState("")
  const [refreshMinutes, setRefreshMinutes] = useState(String(getRefreshMinutes()))
  const [accounts, setAccounts] = useState<Account[]>(cachedAccounts())

  useEffect(() => () => { auth.alive = false; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.device) cancelDeviceLogin(auth.device); auth.device = null; if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; auth.epoch++ }, [])

  async function changeSource(value: string) {
    stopAuth()
    saveSource(value as DataSource)
    setSource(value as DataSource)
    setAccounts(cachedAccounts())
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
    } catch { /* begin failure leaves the add button available for retry */ }
    finally { auth.running = false; if (auth.alive && epoch === auth.epoch) setBusy(false) }
  }

  function startClaude(manual = false) {
    if (auth.running) return
    if (claudeCooldownUntil()) return
    stopAuth(); setBrowserError("")
    try {
      const d = beginClaudeLogin(() => { if (auth.claude === d && auth.alive) void completeClaude(d) }, () => {
        if (auth.claude === d && auth.alive) { stopAuth(); setBusy(false) }
      }, manual, stage => {
        // Completed account identity is rendered only by the shared login row, never a second Text.
        if (auth.claude === d && auth.alive && getSource() === "official" && !stage.startsWith("Claude ")) setClaudeProgress(stage)
      })
      auth.claude = d; setClaude(d); setClaudeCode(""); setClaudeProgress(d.progress)
    } catch (e: any) { setBrowserError(e.message) }
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
        setBrowserError(e.message)
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
  async function openClaude() {
    const d = auth.claude
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.claude === d && auth.epoch === epoch && getSource() === "official"
    auth.running = true; setBusy(true); setBrowserError("")
    try {
      await presentIsolatedAuthorization(release => { auth.releaseBrowser = release }, d.url)
      if (valid() && !d.consumed && d.code) await completeClaude(d)
    } catch (e: any) { if (valid()) {
      const message = e?.message === UNSUPPORTED_BROWSER || e?.message?.startsWith("授权页面加载") ? e.message : "无法打开Claude授权页，请重试"
      setBrowserError(message)
    } }
    finally {
      // Closing the browser must not unlock an exchange/profile request still in flight.
      if (auth.alive && epoch === auth.epoch && !(auth.claude === d && d.consumed && !d.cancelled)) {
        auth.running = false; setBusy(false)
      }
    }
  }

  async function checkOfficial(browser = false) {
    const d = auth.device
    if (!d || auth.running) return
    auth.running = true
    setBusy(true)
    const epoch = auth.epoch
    const active = () => auth.alive && auth.device === d && auth.epoch === epoch && getSource() === "official"
    if (browser) setBrowserError("")
    try {
      const result = browser ? await checkAfterBrowser(d, active, undefined,
        () => presentIsolatedAuthorization(release => { auth.releaseBrowser = release })) : await checkDeviceLogin(d)
      if (!active() || result == null) return
      if (result !== "pending") {
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
      }
    } finally { auth.running = false; if (auth.alive && epoch === auth.epoch) setBusy(false) }
  }

  async function test() {
    const requestSource = getSource(), requestStats = getStatisticsSource()
    setBusy(true)
    try {
      const r = await loadUsage()
      // A late refresh from the previous source must not replace this source's account list.
      if (!auth.alive || getSource() !== requestSource || getStatisticsSource() !== requestStats) return
      if (r.data) {
        setAccounts(r.data.accounts)
        await Widget.reloadAll()
      }
    } catch { /* failures keep the existing cached list */ }
    setBusy(false)
  }

  // Same remove-then-insert contract as the official editable_list onMove example; persisted by stable ID.
  function moveLogins(indices: number[], newOffset: number) {
    if (busy || device || claude || getSource() !== "official") return
    const current = sortAccounts(logins, "official")
    if (!indices.length || new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= current.length) || !Number.isInteger(newOffset)) return
    const moving = indices.map(i => current[i])
    const next = current.filter((_, i) => !indices.includes(i))
    // newOffset is a destination in the ORIGINAL list (SwiftUI move semantics): drop the moved items that sit before it.
    const at = newOffset - indices.filter(i => i < newOffset).length
    next.splice(Math.max(0, Math.min(at, next.length)), 0, ...moving)
    if (next.every((a, i) => a.id === current[i].id)) return
    saveAccountOrder(next.map(a => a.id), "official")
    setLogins(next)
    setAccounts(cachedAccounts())
    void Widget.reloadAll()
  }

  async function save() {
    const finalKey = key.trim() || cur.managementKey || ""
    if (!baseUrl.trim() || !finalKey) return
    saveConfig(baseUrl, finalKey)
    setKey("")
    setKeyEditing(false)
    await test()
  }

  const loginRow = (a: ReturnType<typeof officialAccounts>[number], i: number) => <HStack key={a.id} trailingSwipeActions={{ allowsFullSwipe: false, actions: [
          <Button title="删除" role="destructive" disabled={busy || !!device || !!claude} action={async () => {
          try {
            logoutOfficial(a.id)
            setLogins(officialAccounts())
            setAccounts(cachedAccounts())
            await test()
            await Widget.reloadAll()
          } catch { /* local removal failure leaves the row in place */ }
        }} />
        ] }}>
          <NavigationLink destination={<WidgetNamePage account={managementAccounts().find(item => item.id === a.id)!} source="official" onSaved={() => setAccounts(cachedAccounts())} />}>
            <VStack alignment="leading" spacing={3}>
              <Text fixedSize={{ horizontal: false, vertical: true }}>{`${i + 1}. ${a.provider === "deepseek" ? "DeepSeek" : a.provider === "claude" ? "Claude" : "Codex"} ${a.provider === "claude" ? a.email || "邮箱未提供" : a.name}`}</Text>
              <Text font={12} foregroundStyle="secondaryLabel">小组件用户名：{getWidgetName(a.id, "official") || "使用原名（点此设置）"}</Text>
            </VStack>
          </NavigationLink>
          <Spacer />
        </HStack>

  return <NavigationStack>
    <Form
      navigationTitle={"AI 用量"}
      navigationBarTitleDisplayMode={"inline"}
      toolbar={{
        cancellationAction: <Button title={"完成"} action={dismiss} />,
      }}
    >
      <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>数据来源</Text><Spacer /><Text>{VERSION}</Text></HStack>}>
        <Picker title={"账号来源"} value={source} onChanged={changeSource} disabled={busy}>
          <Text tag={"parrot"}>Parrot</Text>
          <Text tag={"official"}>Codex,Claude,DeepSeek</Text>
          <Text tag="sub2api">Sub2API</Text>
        </Picker>
        <Picker title="统计来源" value={statisticsSource} disabled={busy} onChanged={async value => {
          saveStatisticsSource(value as StatisticsSource); setStatisticsSource(value as StatisticsSource); await test()
        }}>
          <Text tag="parrot">Parrot</Text><Text tag="sub2api">Sub2API</Text>
        </Picker>
      </Section>
      {source === "parrot" || statisticsSource === "parrot" ? <Section header={<Text>Parrot 连接</Text>}>
        <TextField title={"地址"} value={baseUrl} onChanged={setBaseUrl} prompt={"填写你自己的 Parrot 地址"} />
        <TextField title={"管理密钥"} value={keyEditing ? key : maskedKey(key || cur.managementKey || "")} onFocus={() => { setKey(""); setKeyEditing(true) }} onBlur={() => setKeyEditing(false)} onChanged={value => { if (keyEditing && value !== maskedKey(cur.managementKey || "")) setKey(value) }} prompt="managementKey" />
        <Button title={busy ? "处理中…" : "保存并测试"} action={save} disabled={busy} />
      </Section> : null}
      {statisticsSource === "sub2api" || source === "sub2api" ? <Section header={<Text>Sub2API连接</Text>}>
        <TextField title="Sub2API地址" value={subUrl} onChanged={setSubUrl} prompt="https://你的部署地址" />
        <TextField title="Sub2API管理员密钥" value={subKeyEditing ? subKey : maskedKey(subKey || subCur.adminKey || "")} onFocus={() => { setSubKey(""); setSubKeyEditing(true) }} onBlur={() => setSubKeyEditing(false)} onChanged={value => { if (subKeyEditing && value !== maskedKey(subCur.adminKey || "")) setSubKey(value) }} prompt="Admin API Key" />
        <Button title="保存并测试" disabled={busy} action={async () => {
          try { saveSub2APIConfig(subUrl, subKey.trim() || getSub2APIConfig().adminKey || "", subTimezone); setSubKey(""); setSubKeyEditing(false); setHasSubKey(true); setAccounts(cachedAccounts()); await test() }
          catch { /* invalid configuration is not saved */ }
        }} />
        {hasSubKey ? <Button title="清除Sub2API配置" disabled={busy} action={async () => { clearSub2APIConfig(); setSubKey(""); setSubKeyEditing(false); setSubUrl(""); setHasSubKey(false); setAccounts(cachedAccounts()); await test() }} /> : null}
      </Section> : null}

      {source === "official" ? <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>登录账号</Text><Spacer />{NATIVE_SORT && logins.length > 1 ? <EditButton /> : null}</HStack>}>
        <HStack frame={{ maxWidth: "infinity" }}>
          {loginProvider !== "deepseek" && !device && !claude
            ? <Button title={"添加账号"} action={addOfficial} disabled={busy || (loginProvider === "claude" && claudeCooling)} />
            : <Text foregroundStyle="secondaryLabel">{loginProvider === "deepseek" ? "API Key" : "授权进行中"}</Text>}
          <Spacer />
          <Picker title="" pickerStyle="menu" value={loginProvider} onChanged={value => { stopAuth(); setLoginProvider(value); setBusy(false); setBrowserError("") }} disabled={busy}>
            <Text tag="codex">Codex</Text><Text tag="claude">Claude</Text><Text tag="deepseek">DeepSeek</Text>
          </Picker>
        </HStack>
        {loginProvider === "claude" && claudeCooling ? <Text>{claudeCooldownMessage()}</Text> : null}
        {loginProvider === "claude" && claudeProgress ? <Text>{claudeProgress}</Text> : null}
        {claude ? <>
          <Text>{claude.manual ? "Claude官方手动授权码：完成授权后粘贴完整code#state" : "Claude本机回调：完成网页授权后自动保存账号"}</Text>
          {claude.fallback ? <Text font={12} foregroundStyle="secondaryLabel">{claude.fallback}</Text> : null}
          <Button title="打开Claude授权页" action={() => openClaude()} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          {claude.manual ? <>
            <SecureField title="本次完整授权码" value={claudeCode} onChanged={setClaudeCode} prompt="code#state" />
            <Button title="完成Claude授权" action={() => completeClaude()} disabled={busy || !claudeCode.trim()} />
          </> : <Button title="改用手动授权码" action={() => startClaude(true)} disabled={busy} />}
          <Button title="取消Claude登录" action={() => { stopAuth(); setBusy(false) }} />
        </> : null}
        {device ? <>
          <HStack frame={{ maxWidth: "infinity" }}>
          <Text contextMenu={{ menuItems: <Group>
            <Button title="复制代码" action={async () => {
              // A retained menu action must not copy an old, cancelled or expired attempt.
              if (!auth.alive || auth.device !== device || device.cancelled || Date.now() >= device.expiresAt || getSource() !== "official") return
              await Pasteboard.setString(device.code)
            }} disabled={device.cancelled || Date.now() >= device.expiresAt} />
          </Group> }}>一次性代码：{device.code}</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">{`有效期${Math.max(0, Math.ceil((device.expiresAt - Date.now()) / 60000))}分钟`}</Text>
          </HStack>
          <Button title={"打开官方授权页"} action={() => checkOfficial(true)} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          <Button title={"检查授权"} action={() => checkOfficial()} disabled={busy} />
          <Button title={"取消登录"} action={() => { stopAuth(); setBusy(false) }} />
        </> : null}
        {!device && !claude && browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
        {NATIVE_SORT ? <ForEach count={logins.length} onMove={moveLogins} itemBuilder={i => loginRow(sortAccounts(logins, "official")[i], i)} />
          : sortAccounts(logins, "official").map(loginRow)}
        {!NATIVE_SORT && logins.length > 1 ? <NavigationLink destination={<AccountOrderPage key="official" source="official" onSaved={next => { setAccounts(cachedAccounts()); setLogins(sortAccounts(officialAccounts(), "official")) }} />}>
          <Text>账号排序</Text>
        </NavigationLink> : null}
        <Button title={"刷新额度"} action={test} disabled={busy || !!device || !!claude} />
      </Section> : null}
      {source === "official" && loginProvider === "deepseek" ? <Section header={<Text>添加DeepSeek</Text>}>
        <TextField title="DeepSeek账号名称" value={dsName} onChanged={setDSName} />
        <SecureField title="DeepSeek凭据" value={dsToken} onChanged={setDSToken} prompt="填入api key" />
        <Button title="保存" disabled={busy || !!device || !!claude} action={async () => {
          try { addDeepSeekAccount(dsName, "api", dsToken); setDSToken(""); setDSName(""); setLogins(officialAccounts()); await test() }
          catch { /* invalid input is not saved */ }
        }} />
      </Section> : null}

      {source !== "official" ? <Section header={<Text>目前账号</Text>}>
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
      </Section> : null}

      <Section header={<Text>组件刷新</Text>}>
        <Picker title={"刷新间隔"} value={refreshMinutes} onChanged={async (value: string) => {
          setRefreshMinutes(value)
          saveRefreshMinutes(Number(value))
          await Widget.reloadAll()
        }}>
          {REFRESH_OPTIONS.map(m => <Text tag={String(m)}>{m}分钟</Text>)}
        </Picker>
      </Section>

      <Section header={<Text>预览组件</Text>}>
        <Button title="预览组件" action={() => Widget.preview({ family: "systemSmall" })} />
      </Section>


    </Form>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
