// Parrot 管理接口数据层（Scripting 中 fetch / Keychain / Storage 为全局对象）


export const VERSION = "1.7.14"
export type DataSource = "parrot" | "official"
export function getSource(): DataSource { return Storage.get<string>("ai_usage_source_v1") === "official" ? "official" : "parrot" }
export function saveSource(source: DataSource) { Storage.set("ai_usage_source_v1", source) }

const KEY_BASE = "parrot_base_url"
const KEY_MGMT = "parrot_management_key"
const KEY_SESSION = "parrot_session_credential"
const KEY_CACHE = "ai_usage_cache_v1"

const TICKS_PER_USD = 10_000_000_000

export type Metric = {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
}

export type QuotaWindow = {
  usedPercent: number | null
  remainingPercent: number | null
  resetsAt: string | null
}

export type Account = {
  id: string
  enabled: boolean
  provider: string // "claude" | "openai" | ...
  name: string
  available: boolean
  fiveHour: QuotaWindow
  sevenDay: QuotaWindow
  resetCredits: number | null // 重置卡数量（仅 OpenAI）
}

export type UsageData = {
  today: Metric | null
  month: Metric | null
  todayByFamily: Record<string, Metric>
  monthByFamily: Record<string, Metric>
  accounts: Account[]
  fetchedAt: number
}

export type LoadResult = { data: UsageData | null; stale: boolean; error: string | null }

const KEY_REFRESH = "ai_usage_refresh_minutes_v1"
export const REFRESH_OPTIONS = [5, 15, 30, 60]
export function getRefreshMinutes(): number {
  const m = Storage.get<number>(KEY_REFRESH)
  return m != null && REFRESH_OPTIONS.includes(m) ? m : 15
}
export function saveRefreshMinutes(minutes: number) {
  if (REFRESH_OPTIONS.includes(minutes)) Storage.set(KEY_REFRESH, minutes)
}

function orderKey(source: DataSource) { return source === "official" ? "ai_usage_official_order_v1" : "ai_usage_parrot_order_v1" }
export function saveAccountOrder(ids: string[], source: DataSource = getSource()) {
  Storage.set(orderKey(source), [...new Set(ids)])
}
export function sortAccounts(accounts: Account[], source: DataSource = getSource()): Account[] {
  const ids = Storage.get<string[]>(orderKey(source)) ?? []
  const byId = new Map(accounts.map(a => [a.id, a]))
  const ordered: Account[] = []
  for (const id of ids) {
    const a = byId.get(id)
    if (a) { ordered.push(a); byId.delete(id) }
  }
  // Existing IDs retain positions; newly seen IDs append in provider-list order.
  return [...ordered, ...byId.values()]
}
function syncAccountOrder(accounts: Account[], source: DataSource): Account[] {
  const sorted = sortAccounts(accounts, source)
  saveAccountOrder(sorted.map(a => a.id), source) // prune removed IDs only on a successful full fetch
  return sorted
}
export function cachedAccounts(): Account[] {
  return sortAccounts((getSource() === "official" ? officialCached() : Storage.get<UsageData>(KEY_CACHE))?.accounts ?? [])
}
export function widgetAccounts(accounts: Account[], parameter = ""): Account[] {
  // 参数序号与 App 账号列表从上到下一致，1 起算；支持英文/中文逗号或空格。
  accounts = sortAccounts(accounts)
  const numbers = parameter.split(/[,，\s]+/).filter(Boolean)
  if (numbers.length) {
    const picked: Account[] = []
    for (const n of numbers) {
      if (!/^[1-9]\d*$/.test(n)) continue
      const acc = accounts[Number(n) - 1]
      if (acc && !picked.some(a => a.id === acc.id)) picked.push(acc)
      if (picked.length === 4) break
    }
    return picked
  }
  // Default follows the complete ordered list, including disabled accounts.
  // Legacy selected-ID keys are intentionally ignored; rendering takes 2 or 4.
  return accounts.slice(0, 4)
}

// ---------- 配置 ----------
export function getConfig() {
  return {
    baseUrl: Keychain.get(KEY_BASE),
    managementKey: Keychain.get(KEY_MGMT),
  }
}

export function saveConfig(baseUrl: string, managementKey: string) {
  Keychain.set(KEY_BASE, baseUrl.trim().replace(/\/+$/, ""))
  Keychain.set(KEY_MGMT, managementKey.trim())
  Keychain.remove(KEY_SESSION)
}

export function clearConfig() {
  Keychain.remove(KEY_BASE)
  Keychain.remove(KEY_MGMT)
  Keychain.remove(KEY_SESSION)
  Storage.remove(KEY_CACHE)
  Storage.remove(KEY_CREDITS)
  Storage.remove("ai_usage_selected_accounts_v1")
  Storage.remove(KEY_REFRESH)
  Storage.remove(orderKey("parrot"))
}

// ---------- 请求 ----------
class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(`HTTP ${status} ${code}`)
  }
}

async function login(baseUrl: string, managementKey: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/api/management/v1/auth/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantType: "managementKey", managementKey }),
    timeout: 15,
  })
  const body = await resp.json().catch(() => null)
  if (resp.status !== 201 || !body?.data?.credential) {
    throw new HttpError(resp.status, body?.error?.code ?? "LOGIN_FAILED")
  }
  const cred = body.data.credential as string
  Keychain.set(KEY_SESSION, cred)
  return cred
}

async function apiGet(baseUrl: string, path: string, cred: string): Promise<any> {
  const resp = await fetch(`${baseUrl}/api/management/v1${path}`, {
    headers: { Authorization: `Bearer ${cred}` },
    timeout: 15,
  })
  const body = await resp.json().catch(() => null)
  if (resp.status !== 200) {
    throw new HttpError(resp.status, body?.error?.code ?? "REQUEST_FAILED")
  }
  return body.data
}

const KEY_CREDITS = "ai_usage_reset_credits_v1"

// ---------- 解析 ----------
function toMetric(m: any): Metric {
  const n = (v: any) => (typeof v === "number" ? v : 0)
  const input = n(m?.inputTokens)
  const output = n(m?.outputTokens)
  const cr = n(m?.cacheReadTokens)
  const cc = n(m?.cacheCreationTokens)
  return {
    requests: n(m?.total),
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cr,
    cacheCreationTokens: cc,
    totalTokens: input + output + cr + cc,
    costUsd: n(m?.costTicks) / TICKS_PER_USD,
  }
}

function toFamilies(f: any): Record<string, Metric> {
  const out: Record<string, Metric> = {}
  for (const k of Object.keys(f ?? {})) out[k] = toMetric(f[k])
  return out
}

function toWindow(list: any[], name: string): QuotaWindow {
  const w = (list ?? []).find((x: any) => x?.name === name)
  return {
    usedPercent: w?.usedPercent ?? null,
    remainingPercent: w?.remainingPercent ?? null,
    resetsAt: w?.resetsAt ?? null,
  }
}

async function fetchAll(baseUrl: string, cred: string): Promise<UsageData> {
  const [today, month, accList] = await Promise.all([
    apiGet(baseUrl, "/stats/summary?period=today", cred),
    apiGet(baseUrl, "/stats/summary?period=month", cred),
    apiGet(baseUrl, "/oauth/accounts?pageSize=50", cred),
  ])
  const all = [...(accList?.items ?? [])]
  for (let page = 2, pageLength = all.length; pageLength === 50; page++) {
    const next = await apiGet(baseUrl, `/oauth/accounts?pageSize=50&page=${page}`, cred)
    all.push(...(next?.items ?? []))
    pageLength = next?.items?.length ?? 0
  }
  const accounts: Account[] = await Promise.all(
    all.map(async (a: any) => {
      const d = await apiGet(baseUrl, `/oauth/accounts/${encodeURIComponent(a.accountId)}`, cred)
      // 重置卡：Parrot 管理接口暂未提供只读字段；若日后账号详情返回 resetCreditCount 则自动显示
      const rc = d?.resetCreditCount ?? d?.openai?.resetCreditCount
      return {
        id: a.accountId,
        enabled: !!a.enabled,
        resetCredits: typeof rc === "number" ? rc : null,
        provider: a.provider,
        name: String(a.displayName ?? a.identity ?? a.accountId),
        available: !!a.available,
        fiveHour: toWindow(d?.usageWindows, "fiveHour"),
        sevenDay: toWindow(d?.usageWindows, "sevenDay"),
      }
    })
  )
  // Claude 在前，其余按名称
  accounts.sort((x, y) =>
    x.provider === y.provider ? x.name.localeCompare(y.name) : x.provider === "claude" ? -1 : y.provider === "claude" ? 1 : x.provider.localeCompare(y.provider)
  )
  return {
    today: toMetric(today?.overall),
    month: toMetric(month?.overall),
    todayByFamily: toFamilies(today?.families),
    monthByFamily: toFamilies(month?.families),
    accounts,
    fetchedAt: Date.now(),
  }
}

export async function loadUsage(): Promise<LoadResult> {
  if (getSource() === "official") return loadOfficialUsage()
  const { baseUrl, managementKey } = getConfig()
  const rawCache = Storage.get<UsageData>(KEY_CACHE)
  const cached = rawCache ? { ...rawCache, accounts: sortAccounts(rawCache.accounts, "parrot") } : null
  if (!baseUrl || !managementKey) {
    return { data: null, stale: false, error: "未配置：请在 Scripting 中运行本脚本进行设置" }
  }
  try {
    let cred = Keychain.get(KEY_SESSION)
    if (!cred) cred = await login(baseUrl, managementKey)
    let data: UsageData
    try {
      data = await fetchAll(baseUrl, cred)
    } catch (e) {
      // 会话过期 → 重新登录一次
      if (e instanceof HttpError && e.status === 401) {
        Keychain.remove(KEY_SESSION)
        cred = await login(baseUrl, managementKey)
        data = await fetchAll(baseUrl, cred)
      } else throw e
    }
    data.accounts = syncAccountOrder(data.accounts, "parrot")
    Storage.set(KEY_CACHE, data)
    return { data, stale: false, error: null }
  } catch (e: any) {
    const msg = e instanceof HttpError
      ? (e.status === 401 || e.code === "AUTHENTICATION_FAILED" ? "管理密钥无效" : e.code === "RATE_LIMITED" ? "登录过于频繁" : e.message)
      : String(e?.message ?? e)
    return { data: cached ?? null, stale: !!cached, error: msg }
  }
}

// ---------- 格式化 ----------
export function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(Math.round(n))
}

export function fmtUsd(n: number): string {
  // Nonnegative costs: correct binary floating-point ties, then round (not truncate).
  const scaled = n * 10
  const rounded = Math.round(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled))) / 10
  return "$" + rounded.toFixed(1)
}

export function fmtPct(v: number | null): string {
  return v == null ? "--" : Math.round(v) + "%"
}

// 每周额度倒计时：满 1 天显示“N天”，不足 1 天按 HH:MM
export function fmtResetDays(iso: string | null): string {
  if (!iso) return "--"
  const ms = new Date(iso).getTime() - Date.now()
  if (!(ms > 0)) return "--"
  const d = Math.floor(ms / 86400000)
  return d >= 1 ? fmtReset(iso).replace("d ", "天 ") : fmtReset(iso)
}

// 重置倒计时：01:36 / 3d 04:48；未知或已过期显示 --:--
export function fmtReset(iso: string | null): string {
  if (!iso) return "--:--"
  const ms = new Date(iso).getTime() - Date.now()
  if (!(ms > 0)) return "--:--"
  const totalMin = Math.floor(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  const p = (x: number) => String(x).padStart(2, "0")
  return d > 0 ? `${d}d ${p(h)}:${p(m)}` : `${p(h)}:${p(m)}`
}

// 账号最紧张的剩余百分比（无数据视为 101，排在最后）
export function tightest(acc: Account): number {
  const v = [acc.fiveHour.remainingPercent, acc.sevenDay.remainingPercent].filter(x => x != null) as number[]
  return v.length ? Math.min(...v) : 101
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function providerLabel(p: string): string {
  return p === "claude" ? "Claude" : p === "openai" ? "GPT" : p
}

export function familyLabel(f: string): string {
  return f === "anthropic" ? "Claude" : f === "openai" ? "GPT" : f
}

export function quotaColor(remaining: number | null): string {
  if (remaining == null) return "systemGray"
  if (remaining <= 15) return "systemRed"
  if (remaining <= 40) return "systemOrange"
  return "systemGreen"
}

// OpenAI Codex public device-auth protocol. No Parrot credentials are accessed here.
const AUTH = "https://auth.openai.com"
const CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann"
const WHAM = "https://chatgpt.com/backend-api/wham"
const KEY = "ai_usage_official_oauth_v1"
const CACHE = "ai_usage_official_cache_v1"
type Credential = { id: string; accountId: string; subject: string; name: string; access: string; refresh: string; expiresAt: number }
export type DeviceLogin = { deviceId: string; code: string; interval: number; expiresAt: number; nextPoll: number; cancelled: boolean }

function credentials(): Credential[] {
  const raw = Keychain.get(KEY)
  if (!raw) return []
  try { return JSON.parse(raw) } catch { throw new Error("官方登录记录损坏，请重新添加账号") }
}
function persist(items: Credential[]) {
  if (!Keychain.set(KEY, JSON.stringify(items))) throw new Error("钥匙串保存失败")
}
export function officialAccounts(): { id: string; name: string }[] {
  return credentials().map(({ id, name }) => ({ id, name }))
}
export function officialCached(): UsageData | null {
  const cache = Storage.get<UsageData>(CACHE)
  return cache ? { ...cache, accounts: sortAccounts(cache.accounts, "official") } : null
}
export function logoutOfficial(id: string) {
  persist(credentials().filter(x => x.id !== id))
  const cache = officialCached()
  if (cache) Storage.set(CACHE, { ...cache, accounts: cache.accounts.filter(a => a.id !== id) })
  const order = Storage.get<string[]>(orderKey("official"))
  if (order) saveAccountOrder(order.filter(x => x !== id), "official")
}
// Never surface response bodies / transport errors, which may contain secrets.
async function request(url: string, options: any = {}) {
  try { return await fetch(url, { ...options, timeout: 20 }) }
  catch { throw new Error("官方服务网络请求失败，请检查网络后重试") }
}
async function json(resp: any) {
  try { return await resp.json() } catch { throw new Error("官方服务返回了无法解析的数据") }
}
async function post(path: string, body: any) {
  return request(AUTH + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}
export async function beginDeviceLogin(): Promise<DeviceLogin> {
  const r = await post("/api/accounts/deviceauth/usercode", { client_id: CLIENT })
  if (r.status !== 200) throw new Error(r.status === 404 ? "官方设备授权不可用；不支持以自定义回调替代" : `设备授权申请失败（HTTP ${r.status}）`)
  const b = await json(r)
  const code = b.user_code ?? b.usercode
  if (!b.device_auth_id || typeof code !== "string") throw new Error("官方设备授权响应不完整")
  return { deviceId: b.device_auth_id, code, interval: Math.max(1, Number(b.interval) || 5) * 1000, expiresAt: Date.now() + 15 * 60 * 1000, nextPoll: 0, cancelled: false }
}
export function cancelDeviceLogin(d: DeviceLogin) { d.cancelled = true }
function checkDevice(d: DeviceLogin) {
  if (d.cancelled) throw new Error("已取消登录")
  if (Date.now() >= d.expiresAt) throw new Error("设备授权已过期，请重新开始")
}
function claims(token: string): any {
  try {
    let base = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    base += "=".repeat((4 - base.length % 4) % 4)
    return JSON.parse(Data.fromBase64String(base)?.toRawString() ?? "{}")
  } catch { return {} }
}
function credential(b: any, previous?: Credential): Credential {
  if (typeof b.access_token !== "string" || !b.access_token) throw new Error("官方未返回访问令牌")
  const c = claims(b.id_token ?? b.access_token)
  const a = claims(b.access_token)
  const auth = c["https://api.openai.com/auth"] ?? a["https://api.openai.com/auth"] ?? {}
  const accountId = auth.chatgpt_account_id ?? previous?.accountId
  if (auth.chatgpt_account_is_fedramp) throw new Error("此账号要求专用官方路由，当前脚本不支持")
  const subject = auth.chatgpt_user_id ?? auth.user_id ?? c.sub ?? a.sub ?? previous?.subject
  const refresh = b.refresh_token ?? previous?.refresh
  if (!accountId || !subject || !refresh) throw new Error("官方未提供账号路由或续期信息，无法保存登录")
  const exp = a.exp
  return { id: previous?.id ?? "", accountId, subject, name: previous?.name ?? "", access: b.access_token, refresh,
    expiresAt: typeof exp === "number" ? exp * 1000 : Date.now() + (Number(b.expires_in) || 3600) * 1000 }
}
// Explicit foreground checks avoid losing a polling loop when iOS suspends the browser/app.
export async function checkDeviceLogin(d: DeviceLogin): Promise<"pending" | "complete"> {
  checkDevice(d)
  if (Date.now() < d.nextPoll) return "pending"
  d.nextPoll = Date.now() + d.interval
  const r = await post("/api/accounts/deviceauth/token", { device_auth_id: d.deviceId, user_code: d.code })
  checkDevice(d)
  if (r.status === 403 || r.status === 404) return "pending"
  if (r.status !== 200) throw new Error(`设备授权失败（HTTP ${r.status}），请重新开始`)
  const b = await json(r)
  if (!b.authorization_code || !b.code_verifier) throw new Error("设备授权响应不完整")
  const form = Object.entries({ grant_type: "authorization_code", client_id: CLIENT, code: b.authorization_code,
    redirect_uri: AUTH + "/deviceauth/callback", code_verifier: b.code_verifier })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
  let t: any
  try {
    t = await request(AUTH + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form })
  } catch (e) { d.cancelled = true; throw e }
  checkDevice(d)
  if (t.status !== 200) { d.cancelled = true; throw new Error(`官方令牌交换失败（HTTP ${t.status}），请重新开始`) }
  // Once exchanged, never reuse the code even if Keychain persistence fails.
  const body = await json(t).catch(e => { d.cancelled = true; throw e })
  checkDevice(d)
  d.cancelled = true
  const item = credential(body)
  const items = credentials()
  const old = items.find(x => x.accountId === item.accountId && x.subject === item.subject)
  item.id = old?.id ?? `official-${Date.now()}-${Math.random().toString(36).slice(2)}`
  item.name = old?.name ?? `官方账号 ${Math.max(0, ...items.map(x => Number(x.name.match(/\d+$/)?.[0]) || 0)) + 1}`
  persist(old ? items.map(x => x.id === item.id ? item : x) : [...items, item])
  d.cancelled = true // One-time authorization codes must not be exchanged twice.
  return "complete"
}
const refreshing = new Map<string, Promise<Credential>>()
async function refreshToken(item: Credential): Promise<Credential> {
  const running = refreshing.get(item.id)
  if (running) return running
  const job = (async () => {
    const current = credentials().find(x => x.id === item.id)
    if (!current) throw new Error("该官方账号已退出")
    if (current.access !== item.access) return current
    const r = await post("/oauth/token", { grant_type: "refresh_token", client_id: CLIENT, refresh_token: current.refresh })
    if (r.status !== 200) throw new Error(r.status === 400 || r.status === 401 ? "官方登录已失效，请重新添加该账号" : `官方续期失败（HTTP ${r.status}）`)
    const next = credential(await json(r), current)
    const items = credentials()
    if (!items.some(x => x.id === item.id)) throw new Error("该官方账号已退出")
    persist(items.map(x => x.id === item.id ? next : x))
    return next
  })()
  refreshing.set(item.id, job)
  try { return await job } finally { refreshing.delete(item.id) }
}
const emptyWindow = (): QuotaWindow => ({ usedPercent: null, remainingPercent: null, resetsAt: null })
function windowOf(w: any): QuotaWindow {
  if (!w) return emptyWindow()
  const used = typeof w.used_percent === "number" && Number.isFinite(w.used_percent) ? Math.max(0, Math.min(100, w.used_percent)) : null
  const reset = typeof w.reset_at === "number" ? w.reset_at * 1000 : typeof w.reset_after_seconds === "number" ? Date.now() + w.reset_after_seconds * 1000 : NaN
  return { usedPercent: used, remainingPercent: used == null ? null : 100 - used, resetsAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null }
}
export function resetCount(b: any): number | null {
  const n = b?.available_count
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null
}
export function mapOfficialUsage(b: any) {
  let fiveHour = emptyWindow(), sevenDay = emptyWindow()
  for (const [name, w] of Object.entries(b?.rate_limit ?? {}) as [string, any][]) {
    if (name !== "primary_window" && name !== "secondary_window") continue
    const seconds = w?.limit_window_seconds
    // Use declared duration, not ordering. Do not mislabel monthly/custom windows.
    if (seconds === 18000 || (seconds == null && name === "primary_window")) fiveHour = windowOf(w)
    if (seconds === 604800 || (seconds == null && name === "secondary_window")) sevenDay = windowOf(w)
  }
  return { fiveHour, sevenDay, resetCredits: resetCount(b?.rate_limit_reset_credits) }
}
async function fetchAccount(item: Credential): Promise<Account> {
  let token = item.expiresAt <= Date.now() + 60000 ? await refreshToken(item) : item
  async function get(path: string) {
    const send = () => request(WHAM + path, { headers: { Authorization: `Bearer ${token.access}`, "ChatGPT-Account-ID": token.accountId, Accept: "application/json" } })
    let r = await send()
    if (r.status === 401) { token = await refreshToken(token); r = await send() }
    return r
  }
  const r = await get("/usage")
  if (r.status !== 200) throw new Error(`官方额度读取失败（HTTP ${r.status}）`)
  const mapped = mapOfficialUsage(await json(r))
  if (mapped.resetCredits == null) {
    // Optional endpoint: unsupported/denied is unknown, never a fabricated zero.
    try {
      const cards = await get("/rate-limit-reset-credits")
      if (cards.status === 200) mapped.resetCredits = resetCount(await json(cards))
    } catch { /* keep unknown */ }
  }
  return { id: item.id, name: item.name, provider: "openai", enabled: true, available: true, ...mapped }
}
export async function loadOfficialUsage(): Promise<LoadResult> {
  const cached = officialCached()
  try {
    const items = credentials()
    if (!items.length) return { data: null, stale: false, error: "请在脚本中添加官方账号" }
    // Do not silently drop a failed account or present partial data as current.
    const accounts = syncAccountOrder(await Promise.all(items.map(fetchAccount)), "official")
    const data: UsageData = { today: null, month: null, todayByFamily: {}, monthByFamily: {}, accounts, fetchedAt: Date.now() }
    Storage.set(CACHE, data)
    return { data, stale: false, error: null }
  } catch (e: any) {
    return { data: cached, stale: !!cached, error: e?.message ?? "官方额度读取失败" }
  }
}
