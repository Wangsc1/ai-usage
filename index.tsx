import { accountScope, hiddenAccountIds, hideAccount, restoreHiddenAccounts, saveVisibleAccountOrder } from "./api"
import { ANTIGRAVITY_MODES, AntigravityMode, getAntigravityMode, saveAntigravityMode, projectAntigravityAccount, antigravityModeHint, requestAntigravityWidgetProjection, antigravityBrandImage, AntigravityLogin, beginAntigravityLogin, finishAntigravityLogin, cancelAntigravityLogin } from "./api"
import {
  Button, EditButton, ForEach, Form, HStack, Spacer, Navigation, NavigationStack, Picker, Script, Section,
  SecureField, SVG, Image, Text, TextField, Widget, VStack, useState, useEffect,
  ScrollView, LazyVGrid, ReorderableForEach, RoundedRectangle, modifiers, useObservable,
} from "scripting"
import { VERSION, getStatisticsSource, saveStatisticsSource, StatisticsSource, getSub2APIConfig, saveSub2APIConfig, clearSub2APIConfig, getConfig, saveConfig, loadUsage, Account, CLAUDE_SVG, OPENAI_SVG, DEEPSEEK_SVG, cachedAccounts, managementAccounts, sortAccounts, getRefreshMinutes, saveRefreshMinutes, REFRESH_OPTIONS, getSource, saveSource, DataSource, getWidgetName, saveWidgetName } from "./api"
import { beginCodexBrowserLogin, finishCodexBrowserLogin, cancelCodexBrowserLogin, CodexBrowserLogin, officialAccounts, logoutOfficial, saveAccountOrder, addDeepSeekAccount } from "./api"
import { workBuddyBrandImage, fmtDeepSeekMoney, fmtWorkBuddyNumber, fmtWorkBuddyUsed, fmtWorkBuddyCheckin, WorkBuddyLogin, beginWorkBuddyLogin, finishWorkBuddyLogin, cancelWorkBuddyLogin } from "./api"
import { beginClaudeLogin, finishClaudeLogin, cancelClaudeLogin, ClaudeLogin, claudeCooldownUntil, claudeCooldownMessage } from "./api"

// EditButton/ForEach.onMove come from the official runnable example views/list/editable_list/index.tsx.
// Guard their presence so a runtime without these exports keeps the long-press sub-page instead of failing to render.
const NATIVE_SORT = typeof EditButton !== "undefined" && EditButton != null && typeof ForEach !== "undefined" && ForEach != null
// Same brand marks as the widget (shared constants from ./api); codex/openai accounts use the OpenAI mark.
const ICON_SIZE = 17
function providerIconCode(provider: string) {
  return provider === "claude" ? CLAUDE_SVG : provider === "deepseek" ? DEEPSEEK_SVG : provider === "codex" || provider === "openai" ? OPENAI_SVG : null
}
function providerWord(provider: string) { return provider === "antigravity" ? "Antigravity" : provider === "workbuddy" ? "WorkBuddy" : provider === "deepseek" ? "DeepSeek" : provider === "claude" ? "Claude" : "Codex" }
// "1. [icon] name"; unknown icon falls back to the original text label.
function AccountLine({ index, provider, name, fixed = false }: { index: number; provider: string; name: string; fixed?: boolean }) {
  const code = providerIconCode(provider)
  const nameText = <Text fixedSize={fixed ? { horizontal: false, vertical: true } : undefined}>{name}</Text>
  if (!code && provider !== "workbuddy" && provider !== "antigravity") return <Text fixedSize={fixed ? { horizontal: false, vertical: true } : undefined}>{`${index + 1}. ${providerWord(provider)} ${name}`}</Text>
  return <HStack spacing={4}>
    <Text>{`${index + 1}.`}</Text>
    {provider === "antigravity" ? <Image image={antigravityBrandImage()} renderingMode="original" resizable frame={{ width: ICON_SIZE, height: ICON_SIZE }} /> : provider === "workbuddy"
      ? <Image image={workBuddyBrandImage()} renderingMode="original" resizable frame={{ width: ICON_SIZE, height: ICON_SIZE }} />
      : <SVG code={code!} resizable frame={{ width: ICON_SIZE, height: ICON_SIZE }} />}
    {nameText}
  </HStack>
}
const accountLabel = (a: Account, i: number) => `${i + 1}. ${providerWord(a.provider)} · ${a.name}`

// Independent native full-screen presentations: slide up on entry, dismiss down.
function FullScreenPage({ children }: { children: any }) {
  const close = Navigation.useDismiss()
  return <NavigationStack>
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toolbar={{ cancellationAction: <Button title="关闭" systemImage="xmark" action={close} /> }}>
      {children}
    </VStack>
  </NavigationStack>
}

function FullScreenLink({ destination, children }: { destination: any; children: any }) {
  return <Button buttonStyle="plain" action={async () => {
    await Navigation.present({ element: <FullScreenPage>{destination}</FullScreenPage>, modalPresentationStyle: "fullScreen" })
  }}>
    <HStack>
      {children}
      <Spacer />
      <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
    </HStack>
  </Button>
}

// Separate ScrollView: ReorderableForEach stays outside List/Form.
function AccountOrderPage({ source, onSaved, expectedScope }: { source: DataSource; onSaved: (next: Account[]) => void; expectedScope?: number }) {
  const data = useObservable<Account[]>(() => managementAccounts())
  const active = useObservable<Account | null>(null)
  const scope = useObservable(() => expectedScope ?? accountScope(source))
  const onMove = (indices: number[], newOffset: number) => {
    // A page opened for one source must never write after the app switched source.
    if (getSource() !== source || accountScope(source) !== scope.value) return
    const current = data.value
    if (!indices.length || new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= current.length) || !Number.isInteger(newOffset)) return
    // Standard implementation from views/reorderable_foreach documentation.
    const movingItems = indices.map(index => current[index])
    const newValue = current.filter((_, index) => !indices.includes(index))
    newValue.splice(Math.max(0, Math.min(newOffset, newValue.length)), 0, ...movingItems)
    if (newValue.every((a, i) => a.id === current[i].id)) return
    if (!saveVisibleAccountOrder(newValue.map(a => a.id), source, scope.value)) return
    data.setValue(newValue)
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
            {a.provider === "workbuddy" || a.provider === "antigravity" ? <AccountLine index={i} provider={a.provider} name={a.provider === "workbuddy" ? `WorkBuddy · ${a.name}` : a.name} /> : <Text>{accountLabel(a, i)}</Text>}
          </VStack>}
          onMove={onMove}
        />
      </LazyVGrid> : <Text>连接成功后显示账号列表</Text>}
    </VStack>
  </ScrollView>
}

function WidgetNamePage({ account, source, onSaved, expectedScope }: { account: Account; source: DataSource; onSaved: () => void; expectedScope?: number }) {
  const close = Navigation.useDismiss()
  const [name, setName] = useState(getWidgetName(account.id, source))
  const [scope] = useState(expectedScope ?? accountScope(source))
  const [quotaMode, setQuotaMode] = useState<AntigravityMode>(account.provider === "antigravity" ? getAntigravityMode(account.id, source) : "summary")
  const detailAccount = account.provider === "antigravity" && source === "official" && getSource() === source
    ? managementAccounts().find(a => a.id === account.id) ?? account : account
  async function save() {
    if (getSource() !== source || accountScope(source) !== scope || (source !== "official" && !cachedAccounts().some(a => a.id === account.id))) return
    saveWidgetName(account.id, name, source)
    setName(name.trim())
    onSaved()
    await Widget.reloadAll()
    close()
  }
  return <Form navigationTitle="账号详情" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>小组件用户名</Text>}>
      <TextField title="自定义小组件用户名" value={name} onChanged={setName} prompt="留空使用原名" />
      <Button title="保存" action={save} />
    </Section>
    {account.provider === "antigravity" ? <Section header={<Text>小组件额度显示</Text>}>
      {source === "official" ? <Picker title="显示额度" value={quotaMode} onChanged={async value => {
        if (getSource() !== source || !officialAccounts().some(a => a.id === account.id)) return
        const mode = ANTIGRAVITY_MODES.find(m => m.value === value)?.value
        if (!mode) return
        saveAntigravityMode(account.id, mode, source); setQuotaMode(mode)
        requestAntigravityWidgetProjection()
        onSaved()
        await Widget.reloadAll()
      }}>
        {ANTIGRAVITY_MODES.map(mode => <Text key={mode.value} tag={mode.value}>{mode.label}</Text>)}
      </Picker> : null}
      {source !== "official" ? <Text>{antigravityModeHint(detailAccount, source)}</Text> : null}
    </Section> : null}
    <AccountCacheSections account={detailAccount} source={source} />
  </Form>
}

// Shared detail content consumes only the passed cached account and source-local cache timestamps.
function AccountCacheSections({ account, source = getSource() }: { account: Account; source?: DataSource }) {
  account = projectAntigravityAccount(account, source)
  const beijingTime = (at: number) => {
    const d = new Date(at + 8 * 3600000), p = (n: number, w = 2) => String(n).padStart(w, "0")
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  }
  const iso = (at: number | null | undefined) => {
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > 8640000000000000) return "未提供"
    return beijingTime(at)
  }
  const cnTime = (v: string | null | undefined) => {
    if (!v) return "未提供"
    const at = Date.parse(v)
    if (!Number.isFinite(at)) return v
    return beijingTime(at)
  }
  if (account.provider === "workbuddy") return <>
          <Section header={<Text>WorkBuddy个人积分</Text>}>
            <Text>{account.credits?.reliable ? `剩余积分 ${fmtWorkBuddyNumber(account.credits.remaining)}` : "积分未可靠提供"}</Text>
            <Text>{fmtWorkBuddyUsed(account.credits?.used, account.credits?.capacity)}</Text>
            <Text>{fmtWorkBuddyCheckin(account.credits?.checkin)}</Text>
            {account.credits?.error || account.readError ? <Text>{account.credits?.error || account.readError}</Text> : null}
          </Section>
          {(account.credits?.packages ?? []).map((p, i) => <Section key={String(i)} header={<Text>{p.name}</Text>}>
            <Text>{`剩余 ${fmtWorkBuddyNumber(p.remaining)} · ${fmtWorkBuddyUsed(p.used, p.capacity)}`}</Text>
            <Text>{`资源到期 ${cnTime(p.expiresAt)}`}</Text>
            <Text>{`周期结束 ${cnTime(p.cycleEnd)}（不等同资源到期）`}</Text>
          </Section>)}
  </>
  if (account.provider === "deepseek") {
    const b = account.balance
    return <>
      <Section header={<Text>DeepSeek余额</Text>}>
        <Text>{`认证方式 ${b?.auth || "未提供"}`}</Text>
        <Text>{`可用状态 ${b?.available == null ? "未提供" : b.available ? "可用" : "不可用"}`}</Text>
        <Text>{`余额采集时间 ${iso(b?.fetchedAt)}`}</Text>
        {b?.stale ? <Text>此前余额缓存</Text> : null}
        {b?.error || account.readError ? <Text>{b?.error || account.readError}</Text> : null}
        {!b?.money?.length ? <Text>余额未提供</Text> : null}
      </Section>
      {(b?.money ?? []).map((m, i) => <Section key={String(i)} header={<Text>{m.currency}</Text>}>
        <Text>{`账户余额 ${fmtDeepSeekMoney(m.currency, m.total)}`}</Text>
        <Text>{`充值余额 ${fmtDeepSeekMoney(m.currency, m.toppedUp)}`}</Text>
        <Text>{`赠送余额 ${fmtDeepSeekMoney(m.currency, m.granted)}`}</Text>
        {b?.auth === "网页Token" || m.weekCost != null ? <>
          <Text>{`近7日消费 ${fmtDeepSeekMoney(m.currency, m.weekCost)}`}</Text>
          <Text>{`7日消费采集时间 ${iso(b?.weekFetchedAt)}`}</Text>
          {b?.weekStale ? <Text>此前7日消费缓存</Text> : null}
        </> : null}
      </Section>)}
    </>
  }
  const percent = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? `${account.provider === "antigravity" ? Math.round(v) : v}%` : "未提供"
  return <>
    {account.readError ? <Section><Text>{account.readError}</Text></Section> : null}
    {([["5 h", account.fiveHour], ["7 d", account.sevenDay]] as const).map(([label, w]) => <Section key={label} header={<Text>{label}</Text>}>
      <Text>{`剩余额度 ${percent(w?.remainingPercent)}`}</Text>
      <Text>{`已用额度 ${percent(w?.usedPercent)}`}</Text>
      <Text>{`重置时间 ${cnTime(w?.resetsAt)}`}</Text>
    </Section>)}
    {account.provider === "antigravity" ? <>
      <Section header={<Text>Antigravity AI Credits</Text>}>
        <Text>{`套餐 ${account.antigravity?.tier || "未提供"}`}</Text>
        <Text>{`剩余 ${account.antigravity?.creditAmount ?? "未提供"}`}</Text>
        <Text>{`最低可用额度 ${account.antigravity?.minimumCreditAmount ?? "未提供"}`}</Text>
      </Section>
      {(account.antigravity?.groups ?? []).map((g, i) => <Section key={String(i)} header={<Text>{g.name}</Text>}>
        {g.buckets.map((b, j) => <VStack key={String(j)} alignment="leading">
          <Text>{`${b.name} · ${b.window || "窗口未提供"} · 剩余 ${typeof b.remainingPercent === "number" && Number.isFinite(b.remainingPercent) ? `${Math.round(b.remainingPercent)}%` : "未提供"}`}</Text>
          <Text>{`重置时间 ${cnTime(b.resetsAt)}`}</Text>
        </VStack>)}
      </Section>)}
    </> : <Section header={<Text>重置卡</Text>}>
      <Text>{typeof account.resetCredits === "number" && Number.isFinite(account.resetCredits) && account.resetCredits >= 0 ? `可用重置卡 ${account.resetCredits}` : "可用重置卡 未提供"}</Text>
    </Section>}
  </>
}

const UNSUPPORTED_BROWSER = "当前Scripting不支持WebViewController临时浏览器，请更新Scripting"
async function presentIsolatedAuthorization(register: ((release: (() => void) | null) => void) | undefined, url: string) {
  // loadURL resolves on navigation completion, not on initiating the load. Present BEFORE waiting
  // for a login/redirect page, otherwise its pending navigation can hide the modal indefinitely.
  // WebViewController is a GLOBAL API in the official WebView example, not a scripting module export.
  if (typeof WebViewController !== "function") throw new Error(UNSUPPORTED_BROWSER)
  const browser = new WebViewController({ ephemeral: true })
  let released = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop!: () => void
  const cancelled = new Promise<void>(resolve => { stop = resolve })
  const release = () => { if (!released) {
    released = true; stop()
    // Documented dismiss(): void closes presentation; dispose() also dismisses if still shown.
    // Guard for older runtimes and always release resources exactly once.
    try { if (typeof browser.dismiss === "function") browser.dismiss() } finally { browser.dispose() }
  } }
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
function maskedKey(value: string): string {
  const chars = Array.from(value)
  return chars.length > 4 ? chars.slice(0, 4).join("") + "*".repeat(chars.length - 4) : "*".repeat(chars.length)
}
function SettingsView() {
  const close = Navigation.useDismiss()
  const [source, setSource] = useState<DataSource>(getSource())
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
  const [codexBrowser, setCodexBrowser] = useState<CodexBrowserLogin | null>(null)
  const [workbuddy, setWorkbuddy] = useState<WorkBuddyLogin | null>(null)
  const [wbPreparing, setWBPreparing] = useState(false)
  const [dsToken, setDSToken] = useState("")
  const [dsAdding, setDSAdding] = useState(false)
  const [logins, setLogins] = useState(officialAccounts())
  const [auth] = useState({ antigravity: null as AntigravityLogin | null, codex: null as CodexBrowserLogin | null, alive: true, running: false, epoch: 0, workbuddy: null as WorkBuddyLogin | null, claude: null as ClaudeLogin | null, releaseBrowser: null as (() => void) | null })
  const stopAuth = () => { if (auth.antigravity) cancelAntigravityLogin(auth.antigravity); auth.antigravity = null; setAGBrowser(null); auth.running = false; setWBPreparing(false); if (auth.workbuddy) cancelWorkBuddyLogin(auth.workbuddy); auth.workbuddy = null; setWorkbuddy(null); if (auth.codex) cancelCodexBrowserLogin(auth.codex); auth.codex = null; setCodexBrowser(null); setDSAdding(false); setDSToken(""); auth.epoch++; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; setClaude(null); setClaudeCode(""); setClaudeProgress("") }
  const dismiss = () => { auth.alive = false; stopAuth(); close() }
  const [statisticsSource, setStatisticsSource] = useState<StatisticsSource>(getStatisticsSource())
  const subCur = getSub2APIConfig()
  const [subUrl, setSubUrl] = useState(subCur.baseUrl ?? "")
  const [subKey, setSubKey] = useState("")
  const [subKeyEditing, setSubKeyEditing] = useState(false)
  const [hasSubKey, setHasSubKey] = useState(!!subCur.adminKey)
  const cur = getConfig()
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "")
  const [key, setKey] = useState("")
  const [keyEditing, setKeyEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [browserError, setBrowserError] = useState("")
  const [refreshMinutes, setRefreshMinutes] = useState(String(getRefreshMinutes()))
  const [, setAccounts] = useState<Account[]>(cachedAccounts())
  const listScope = accountScope(source)
  const visible = getSource() === source ? cachedAccounts() : []
  const hiddenCount = hiddenAccountIds(source).length
  const [agBrowser, setAGBrowser] = useState<AntigravityLogin | null>(null)

  useEffect(() => () => { if (auth.antigravity) cancelAntigravityLogin(auth.antigravity); auth.antigravity = null; if (auth.workbuddy) cancelWorkBuddyLogin(auth.workbuddy); auth.workbuddy = null; if (auth.codex) cancelCodexBrowserLogin(auth.codex); auth.codex = null; auth.alive = false; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; auth.epoch++ }, [])

  async function changeSource(value: string) {
    stopAuth()
    saveSource(value as DataSource)
    setSource(value as DataSource)
    setAccounts(cachedAccounts())
    await test()
    await Widget.reloadAll()
  }

  async function addOfficial() {
    if (loginProvider === "deepseek") {
      if (!auth.alive || auth.running || busy || auth.claude || getSource() !== "official") return
      setDSToken(""); setDSAdding(true); return
    }
    if (loginProvider === "workbuddy") { await startWorkBuddy(); return }
    if (loginProvider === "claude") { startClaude(); return }
    if (loginProvider === "antigravity") { startAG(); return }
    if (auth.running || busy) return
    stopAuth(); setBrowserError("")
    if (typeof WebViewController !== "function") { setBrowserError("Codex浏览器登录缺少WebViewController，请重新登录"); return }
    try {
      const d = beginCodexBrowserLogin(() => { if (auth.codex === d) void completeCodex(d) }, () => {
        if (auth.codex === d) { stopAuth(); auth.running = false; setBusy(false); setBrowserError("Codex本次本机登录等待超时，请重新登录") }
      }, () => { if (auth.codex === d) { stopAuth(); auth.running = false; setBusy(false); setBrowserError("Codex官方授权未完成，请重新登录") } })
      auth.codex = d; setCodexBrowser(d)
    } catch (e: any) { setBrowserError(e.message) }
  }
  async function startWorkBuddy() {
    if (!auth.alive || auth.running || busy || getSource() !== "official") return
    stopAuth(); setBrowserError("")
    if (typeof WebViewController !== "function") { setBrowserError(UNSUPPORTED_BROWSER); return }
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.epoch === epoch && getSource() === "official"
    auth.running = true; setBusy(true); setWBPreparing(true)
    try {
      const d = await beginWorkBuddyLogin(valid)
      if (!valid()) { cancelWorkBuddyLogin(d); return }
      auth.workbuddy = d; setWorkbuddy(d)
    } catch (e: any) { if (valid()) setBrowserError(e.message || "WorkBuddy登录准备失败") }
    finally { if (valid()) { auth.running = false; setBusy(false); setWBPreparing(false) } }
  }
  async function openWorkBuddy() {
    const d = auth.workbuddy
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.epoch === epoch && auth.workbuddy === d && getSource() === "official"
    let saved = false
    auth.running = true; setBusy(true); setBrowserError("")
    try {
      // Presentation starts before polling; its own ephemeral cookies are never copied into fetch.
      const shown = presentIsolatedAuthorization(release => { auth.releaseBrowser = release }, d.url)
      const completed = finishWorkBuddyLogin(d, valid).then(() => {
        if (!valid()) return
        saved = true; setLogins(officialAccounts()); auth.releaseBrowser?.(); auth.releaseBrowser = null
      })
      await Promise.all([completed, shown.then(() => { if (!saved && valid()) throw new Error("WorkBuddy登录已取消，请重新登录") })])
      if (valid() && saved) { auth.workbuddy = null; setWorkbuddy(null); await test() }
    } catch (e: any) {
      if (valid()) { cancelWorkBuddyLogin(d); auth.workbuddy = null; setWorkbuddy(null); setBrowserError(e.message || "WorkBuddy登录失败，请重试"); auth.releaseBrowser?.(); auth.releaseBrowser = null }
    } finally { if (auth.alive && epoch === auth.epoch) { auth.running = false; setBusy(false) } }
  }
  async function completeCodex(d: CodexBrowserLogin) {
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.codex === d && auth.epoch === epoch && getSource() === "official"
    if (!valid() || d.consumed) return
    auth.running = true; setBusy(true)
    try {
      await finishCodexBrowserLogin(d, valid)
      if (!valid()) return
      auth.codex = null; setCodexBrowser(null); setLogins(officialAccounts()); auth.releaseBrowser?.(); auth.releaseBrowser = null; await test()
    } catch (e: any) { if (valid()) { auth.codex = null; setCodexBrowser(null); setBrowserError(e.message || "Codex浏览器登录失败，请重新登录") } }
    finally { if (auth.alive && epoch === auth.epoch) { auth.running = false; setBusy(false) } }
  }
  async function openCodex() {
    const d = auth.codex
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.codex === d && auth.epoch === epoch
    auth.running = true; setBusy(true); setBrowserError("")
    try { await presentIsolatedAuthorization(release => { auth.releaseBrowser = release }, d.url) }
    catch (e: any) { if (valid()) setBrowserError((e.message || "无法打开Codex授权页") + "，请重试登录") }
    finally { if (auth.alive && epoch === auth.epoch && !d.consumed) { auth.running = false; setBusy(false) } }
  }
  function startAG() {
    if (!auth.alive || getSource() !== "official" || auth.running || busy) return
    stopAuth(); setBrowserError("")
    if (typeof WebViewController !== "function") { setBrowserError("Antigravity浏览器登录缺少WebViewController，请重新登录"); return }
    try {
      const d = beginAntigravityLogin(() => { if (auth.antigravity === d) void completeAG(d) }, () => {
        if (auth.antigravity === d) { stopAuth(); auth.running = false; setBusy(false); setBrowserError("Antigravity本次本机登录等待超时，请重新登录") }
      }, () => { if (auth.antigravity === d) { stopAuth(); auth.running = false; setBusy(false); setBrowserError("Antigravity官方授权未完成，请重新登录") } })
      auth.antigravity = d; setAGBrowser(d)
    } catch (e: any) { setBrowserError(e.message) }
  }
  async function completeAG(d: AntigravityLogin) {
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.antigravity === d && auth.epoch === epoch && getSource() === "official"
    if (!valid() || d.consumed) return
    auth.running = true; setBusy(true)
    try {
      await finishAntigravityLogin(d, valid)
      if (!valid()) return
      auth.antigravity = null; setAGBrowser(null); setLogins(officialAccounts()); auth.releaseBrowser?.(); auth.releaseBrowser = null; await test()
    } catch (e: any) { if (valid()) { auth.antigravity = null; setAGBrowser(null); setBrowserError(e.message || "Antigravity浏览器登录失败，请重新登录") } }
    finally { if (auth.alive && epoch === auth.epoch) { auth.running = false; setBusy(false) } }
  }
  async function openAG() {
    const d = auth.antigravity
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.antigravity === d && auth.epoch === epoch
    auth.running = true; setBusy(true); setBrowserError("")
    try { await presentIsolatedAuthorization(release => { auth.releaseBrowser = release }, d.url); if (valid()) { stopAuth(); setBusy(false) } }
    catch (e: any) { if (valid()) setBrowserError((e.message || "无法打开Antigravity授权页") + "，请重试登录") }
    finally { if (auth.alive && epoch === auth.epoch && !d.consumed) { auth.running = false; setBusy(false) } }
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
          auth.claude = null; setClaude(null)
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

  async function test() {
    const requestSource = getSource(), requestScope = accountScope(requestSource), requestStats = getStatisticsSource()
    setBusy(true)
    try {
      const r = await loadUsage()
      // A late refresh from the previous source must not replace this source's account list.
      if (!auth.alive || getSource() !== requestSource || accountScope(requestSource) !== requestScope || getStatisticsSource() !== requestStats) return
      if (r.data) {
        setAccounts(cachedAccounts())
        await Widget.reloadAll()
      }
    } catch { /* failures keep the existing cached list */ }
    setBusy(false)
  }

  // Same remove-then-insert contract as the official editable_list onMove example; persisted by stable ID.
  function moveLogins(indices: number[], newOffset: number) {
    if (busy || claude || codexBrowser || workbuddy || agBrowser || getSource() !== "official") return
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

  function moveRemoteAccounts(indices: number[], newOffset: number) {
    if (busy || source === "official" || getSource() !== source || accountScope(source) !== listScope) return
    const current = cachedAccounts()
    // Reject an event from a stale row snapshot (e.g. another widget hid a row).
    if (current.length !== visible.length || current.some((a, i) => a.id !== visible[i].id)) return
    if (!indices.length || new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= current.length) || !Number.isInteger(newOffset)) return
    const moving = indices.map(i => current[i]), next = current.filter((_, i) => !indices.includes(i))
    const at = newOffset - indices.filter(i => i < newOffset).length
    next.splice(Math.max(0, Math.min(at, next.length)), 0, ...moving)
    if (next.every((a, i) => a.id === current[i].id)) return
    if (!saveVisibleAccountOrder(next.map(a => a.id), source, listScope)) return
    setAccounts(cachedAccounts())
    void Widget.reloadAll()
  }
  const remoteRow = (a: Account, i: number) => <HStack key={a.id} trailingSwipeActions={{ allowsFullSwipe: false, actions: [
    <Button title="隐藏" role="destructive" disabled={busy} action={async () => {
      if (busy || !hideAccount(a.id, source, listScope)) return
      setAccounts(cachedAccounts())
      await Widget.reloadAll()
    }} />
  ] }}>
    <FullScreenLink destination={<WidgetNamePage account={a} source={source} expectedScope={listScope} onSaved={() => { if (getSource() === source && accountScope(source) === listScope) setAccounts(cachedAccounts()) }} />}>
      <VStack alignment="leading" spacing={3}>
        <AccountLine index={i} provider={a.provider} name={a.name} />
        <Text font={12} foregroundStyle="secondaryLabel">自定义小组件用户名：{getWidgetName(a.id, source) || "使用原名（点此设置）"}</Text>
      </VStack>
    </FullScreenLink>
    <Spacer />
  </HStack>

  async function save() {
    const finalKey = key.trim() || cur.managementKey || ""
    if (!baseUrl.trim() || !finalKey) return
    saveConfig(baseUrl, finalKey)
    setKey("")
    setKeyEditing(false)
    await test()
  }

  const loginRow = (a: ReturnType<typeof officialAccounts>[number], i: number) => <HStack key={a.id} trailingSwipeActions={{ allowsFullSwipe: false, actions: [
          <Button title="删除" role="destructive" disabled={busy || !!claude || !!codexBrowser || !!workbuddy || !!agBrowser} action={async () => {
          if (getSource() !== "official") return
          try {
            logoutOfficial(a.id)
            setLogins(officialAccounts())
            setAccounts(cachedAccounts())
            await test()
            await Widget.reloadAll()
          } catch { /* local removal failure leaves the row in place */ }
        }} />
        ] }}>
          <FullScreenLink destination={<WidgetNamePage account={managementAccounts().find(item => item.id === a.id)!} source="official" onSaved={() => setAccounts(cachedAccounts())} />}>
            <VStack alignment="leading" spacing={3}>
              <AccountLine index={i} provider={a.provider} name={a.provider === "claude" ? a.email || "邮箱未提供" : a.name} fixed />
              <Text font={12} foregroundStyle="secondaryLabel">自定义小组件用户名：{getWidgetName(a.id, "official") || "使用原名（点此设置）"}</Text>
            </VStack>
          </FullScreenLink>
          <Spacer />
        </HStack>

  return <NavigationStack>
    <Form
      navigationTitle={"AI 用量"}
      navigationBarTitleDisplayMode={"inline"}
      toolbar={{
        cancellationAction: <Button title={"完成"} systemImage="xmark" action={dismiss} />,
        primaryAction: <Button title={busy ? "刷新中…" : "刷新"} systemImage="arrow.clockwise" disabled={busy || !!claude || !!codexBrowser || !!workbuddy || !!agBrowser} action={async () => { if (busy || auth.running || auth.claude || auth.codex || auth.workbuddy || auth.antigravity) return; await test() }} />,
      }}
    >
      <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>数据来源</Text><Spacer /><Text>{VERSION}</Text></HStack>}>
        <Picker title={"账号来源"} value={source} onChanged={changeSource} disabled={busy}>
          <Text tag={"official"}>OAuth,API,Token</Text>
          <Text tag={"parrot"}>Parrot</Text>
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
          try { saveSub2APIConfig(subUrl, subKey.trim() || getSub2APIConfig().adminKey || "", subCur.timezone); setSubKey(""); setSubKeyEditing(false); setHasSubKey(true); setAccounts(cachedAccounts()); await test() }
          catch { /* invalid configuration is not saved */ }
        }} />
        {hasSubKey ? <Button title="清除Sub2API配置" disabled={busy} action={async () => { clearSub2APIConfig(); setSubKey(""); setSubKeyEditing(false); setSubUrl(""); setHasSubKey(false); setAccounts(cachedAccounts()); await test() }} /> : null}
      </Section> : null}

      {source === "official" ? <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>登录账号</Text><Spacer />{NATIVE_SORT && logins.length > 1 ? <EditButton /> : null}</HStack>}>
        <HStack frame={{ maxWidth: "infinity" }}>
          {!dsAdding && !claude && !codexBrowser && !workbuddy && !wbPreparing && !agBrowser
            ? <Button title={"添加账号"} action={addOfficial} disabled={busy || (loginProvider === "claude" && claudeCooling)} />
            : <Text foregroundStyle="secondaryLabel">{loginProvider === "deepseek" ? "API Key" : "授权进行中"}</Text>}
          <Spacer />
          <Picker title="" pickerStyle="menu" tint="secondaryLabel" value={loginProvider} onChanged={value => { stopAuth(); setLoginProvider(value); setBusy(false); setBrowserError("") }} disabled={busy}>
            <Text tag="antigravity">Antigravity</Text><Text tag="codex">Codex</Text><Text tag="claude">Claude</Text><Text tag="deepseek">DeepSeek</Text><Text tag="workbuddy">WorkBuddy</Text>
          </Picker>
        </HStack>
        {loginProvider === "deepseek" && dsAdding ? <>
          <SecureField title="DeepSeek凭据" value={dsToken} onChanged={setDSToken} prompt="填入api key" />
          <Button title="保存" disabled={busy || !!claude} action={async () => {
            if (!auth.alive || busy || auth.running || auth.claude || getSource() !== "official" || loginProvider !== "deepseek" || !dsAdding) return
            try { addDeepSeekAccount("DeepSeek", "api", dsToken); setDSAdding(false); setDSToken(""); setLogins(officialAccounts()); await test() }
            catch { /* invalid input is not saved */ }
          }} />
        </> : null}
        {loginProvider === "claude" && claudeCooling ? <Text>{claudeCooldownMessage()}</Text> : null}
        {loginProvider === "claude" && claudeProgress && claudeProgress !== "等待Claude回调（尚未收到）" ? <Text>{claudeProgress}</Text> : null}
        {wbPreparing ? <Button title="取消登录" action={() => { stopAuth(); setBusy(false) }} /> : null}
        {workbuddy ? <>
          <Text font={12} foregroundStyle="secondaryLabel">国内个人账号 · 客户端私有协议，可能变更。浏览器授权成功保存后自动返回。</Text>
          <Button title="点击登录" action={openWorkBuddy} disabled={busy} />
          <Button title="取消登录" action={() => { stopAuth(); auth.running = false; setBusy(false) }} />
        </> : null}
        {agBrowser ? <>
          <Button title="点击登录" action={openAG} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          <Button title="取消登录" action={() => { stopAuth(); setBusy(false) }} />
        </> : null}
        {codexBrowser ? <>
          <Button title="点击登录" action={openCodex} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          <Button title="取消登录" action={() => { stopAuth(); setBusy(false) }} />
        </> : null}
        {claude ? <>
          {claude.fallback ? <Text font={12} foregroundStyle="secondaryLabel">{claude.fallback}</Text> : null}
          <Button title="点击登录" action={() => openClaude()} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          {claude.manual ? <>
            <SecureField title="本次完整授权码" value={claudeCode} onChanged={setClaudeCode} prompt="code#state" />
            <Button title="完成Claude授权" action={() => completeClaude()} disabled={busy || !claudeCode.trim()} />
          </> : null}
          <Button title="取消登录" action={() => { stopAuth(); setBusy(false) }} />
        </> : null}
        {!claude && !codexBrowser && !workbuddy && !agBrowser && browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
        {NATIVE_SORT ? <ForEach count={logins.length} onMove={moveLogins} itemBuilder={i => loginRow(sortAccounts(logins, "official")[i], i)} />
          : sortAccounts(logins, "official").map(loginRow)}
        {!NATIVE_SORT && logins.length > 1 ? <FullScreenLink destination={<AccountOrderPage key="official" source="official" onSaved={() => { setAccounts(cachedAccounts()); setLogins(sortAccounts(officialAccounts(), "official")) }} />}>
          <Text>账号排序</Text>
        </FullScreenLink> : null}
      </Section> : null}

      {source !== "official" ? <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>目前账号</Text><Spacer />{NATIVE_SORT && visible.length > 1 ? <EditButton /> : null}</HStack>}>
        {NATIVE_SORT ? <ForEach count={visible.length} onMove={moveRemoteAccounts} itemBuilder={i => remoteRow(visible[i], i)} /> : visible.map(remoteRow)}
        {!NATIVE_SORT && visible.length > 1 ? <FullScreenLink destination={<AccountOrderPage key={source} source={source} expectedScope={listScope} onSaved={() => { if (getSource() === source && accountScope(source) === listScope) setAccounts(cachedAccounts()) }} />}>
          <Text>账号排序</Text>
        </FullScreenLink> : null}
        {hiddenCount > 0 ? <Button title={`恢复全部隐藏账号（${hiddenCount}）`} disabled={busy} action={async () => {
          if (busy || !restoreHiddenAccounts(source, listScope)) return
          setAccounts(cachedAccounts())
          await Widget.reloadAll()
        }} /> : null}
        {!visible.length ? <Text>{hiddenCount ? "账号已全部在本机隐藏，可恢复；服务器账号未删除。" : "连接成功后显示账号列表"}</Text> : null}
      </Section> : null}

      <Section header={<Text>刷新预览</Text>}>
        <Picker title={"刷新间隔"} value={refreshMinutes} onChanged={async (value: string) => {
          setRefreshMinutes(value)
          saveRefreshMinutes(Number(value))
          await Widget.reloadAll()
        }}>
          {REFRESH_OPTIONS.map(m => <Text tag={String(m)}>{m}分钟</Text>)}
        </Picker>
        <Button title="预览组件" action={() => Widget.preview({ family: "systemSmall" })} />
      </Section>


    </Form>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <SettingsView />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}

run()
