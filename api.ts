// Parrot 管理接口数据层（Scripting 中 fetch / Keychain / Storage 为全局对象）


export const VERSION = "1.8.5"
export type DataSource = "parrot" | "official"
export function getSource(): DataSource { return Storage.get<string>("ai_usage_source_v1") === "official" ? "official" : "parrot" }
export function saveSource(source: DataSource) { Storage.set("ai_usage_source_v1", source) }

// Local widget-only names: stable account ID within the explicitly separate data source.
const widgetNameKey = (source: DataSource) => `ai_usage_widget_names_${source}_v1`
export function getWidgetName(id: string, source: DataSource = getSource()): string {
  const names = Storage.get<Record<string, string>>(widgetNameKey(source)) ?? {}
  return Object.prototype.hasOwnProperty.call(names, id) && typeof names[id] === "string" ? names[id] : ""
}
export function saveWidgetName(id: string, value: string, source: DataSource = getSource()) {
  const names = { ...(Storage.get<Record<string, string>>(widgetNameKey(source)) ?? {}) }
  const name = value.trim()
  if (name) Object.defineProperty(names, id, { value: name, enumerable: true, configurable: true, writable: true })
  else delete names[id]
  Storage.set(widgetNameKey(source), names)
}

const KEY_BASE = "parrot_base_url"
const KEY_MGMT = "parrot_management_key"
const KEY_SESSION = "parrot_session_credential"
const KEY_CACHE = "ai_usage_cache_v1"
const KEY_STATS = "ai_usage_parrot_stats_v1"

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
  // Separate from quota freshness; only composed results carry this Parrot statistics status.
  statistics?: { fetchedAt: number | null; stale: boolean; error: string | null }
}

type ParrotStats = Pick<UsageData, "today" | "month" | "todayByFamily" | "monthByFamily" | "fetchedAt">
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
  Storage.remove(KEY_STATS)
  Storage.remove(KEY_CREDITS)
  Storage.remove("ai_usage_selected_accounts_v1")
  Storage.remove(KEY_REFRESH)
  Storage.remove(orderKey("parrot"))
  Storage.remove(widgetNameKey("parrot"))
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
  return { ...parseStats(today, month), accounts }
}

function parseStats(today: any, month: any): ParrotStats {
  const valid = (m: any) => m && ["total", "inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "costTicks"]
    .some(k => typeof m[k] === "number" && Number.isFinite(m[k]))
  if (!valid(today?.overall) || !valid(month?.overall)) throw new Error("Parrot今日/本月统计未提供")
  return { today: toMetric(today.overall), month: toMetric(month.overall),
    todayByFamily: toFamilies(today.families), monthByFamily: toFamilies(month.families), fetchedAt: Date.now() }
}
function statsOnly(data: ParrotStats): ParrotStats {
  return { today: data.today, month: data.month, todayByFamily: data.todayByFamily,
    monthByFamily: data.monthByFamily, fetchedAt: data.fetchedAt }
}
async function loadParrotStats(): Promise<{ data: ParrotStats | null; error: string | null }> {
  const { baseUrl, managementKey } = getConfig()
  // Older Parrot full cache can seed statistics, but its accounts never enter the composed result.
  const cached = Storage.get<ParrotStats>(KEY_STATS) ?? Storage.get<UsageData>(KEY_CACHE)
  if (!baseUrl || !managementKey) return { data: null, error: "Parrot统计未配置" }
  try {
    let cred = Keychain.get(KEY_SESSION) || await login(baseUrl, managementKey)
    const fetchStats = async () => {
      const [today, month] = await Promise.all([
        apiGet(baseUrl, "/stats/summary?period=today", cred),
        apiGet(baseUrl, "/stats/summary?period=month", cred),
      ])
      return parseStats(today, month)
    }
    let data: ParrotStats
    try { data = await fetchStats() }
    catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) throw e
      Keychain.remove(KEY_SESSION)
      cred = await login(baseUrl, managementKey)
      data = await fetchStats()
    }
    Storage.set(KEY_STATS, data)
    return { data, error: null }
  } catch (e: any) {
    return { data: cached?.today && cached?.month ? statsOnly(cached) : null, error: String(e?.message ?? "Parrot统计读取失败") }
  }
}

export async function loadUsage(): Promise<LoadResult> {
  if (getSource() === "official") {
    const [quota, stats] = await Promise.all([loadOfficialUsage(), loadParrotStats()])
    if (!quota.data) return quota
    return { ...quota, data: { ...quota.data,
      today: stats.data?.today ?? null, month: stats.data?.month ?? null,
      todayByFamily: stats.data?.todayByFamily ?? {}, monthByFamily: stats.data?.monthByFamily ?? {},
      statistics: { fetchedAt: stats.data?.fetchedAt ?? null, stale: !!stats.error && !!stats.data, error: stats.error },
    } }
  }
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
    Storage.set(KEY_STATS, statsOnly(data))
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
type Credential = { id: string; accountId: string; subject: string; name: string; email?: string; access: string; refresh: string; expiresAt: number }
export type DeviceLogin = { deviceId: string; code: string; interval: number; expiresAt: number; nextPoll: number; cancelled: boolean }

function credentials(): Credential[] {
  const raw = Keychain.get(KEY)
  if (!raw) return []
  try {
    const items: Credential[] = JSON.parse(raw)
    let changed = false
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const email = officialEmail(claims(item.access))
      if (email && item.email !== email) { item.email = email; changed = true }
      else if (item.email == null) { item.email = ""; changed = true }
      if (!item.name || /^官方账号 \d+$/.test(item.name)) {
        item.name = officialName(claims(item.access)) || item.name?.replace(/^官方账号 /, "账号 ") || `账号 ${i + 1}`
        changed = true
      }
    }
    if (changed) persist(items)
    return items
  } catch { throw new Error("官方登录记录损坏，请重新添加账号") }
}
function persist(items: Credential[]) {
  if (!Keychain.set(KEY, JSON.stringify(items))) throw new Error("钥匙串保存失败")
}
function officialDisplay(item: Credential, index: number): string {
  return item.email || `账号 ${index + 1}（邮箱未提供）`
}
export function officialAccounts(): { id: string; name: string; email: string; provider: "codex" | "claude" }[] {
  // Legacy Codex records have no provider field; their dedicated credential collection identifies them.
  return [...credentials().map((item, i) => ({ id: item.id, name: officialDisplay(item, i), email: item.email || "", provider: "codex" as const })), ...claudeAccounts()]
}
export function officialCached(): UsageData | null {
  const cache = Storage.get<UsageData>(CACHE)
  if (!cache) return null
  const names = new Map(officialAccounts().map(a => [a.id, a.name]))
  return { ...cache, accounts: sortAccounts(cache.accounts.map(a => ({ ...a, name: names.get(a.id) ?? a.name })), "official") }
}
export function logoutOfficial(id: string) {
  if (id.startsWith("claude:")) logoutClaude(id)
  else persist(credentials().filter(x => x.id !== id))
  saveWidgetName(id, "", "official")
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
// Matches OpenAI Codex token_data.rs IdClaims: top-level email, then profile.email.
function officialEmail(...tokens: any[]): string {
  for (const c of tokens) for (const value of [c?.email, c?.["https://api.openai.com/profile"]?.email]) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}
function officialName(...tokens: any[]): string {
  for (const field of ["name", "preferred_username"]) for (const c of tokens) {
    const value = c?.[field] ?? c?.["https://api.openai.com/profile"]?.[field]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
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
  return { id: previous?.id ?? "", accountId, subject, name: officialName(c, a) || previous?.name || "", email: officialEmail(c, a) || previous?.email || "", access: b.access_token, refresh,
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
  item.email = item.email || old?.email || ""
  item.id = old?.id ?? `official-${Date.now()}-${Math.random().toString(36).slice(2)}`
  item.name = item.name || old?.name || `账号 ${Math.max(0, ...items.map(x => Number(x.name.match(/\d+$/)?.[0]) || 0)) + 1}`
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
async function fetchAccount(item: Credential, index: number): Promise<Account> {
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
  return { id: item.id, name: officialDisplay(token, index), provider: "openai", enabled: true, available: true, ...mapped }
}
export async function loadOfficialUsage(): Promise<LoadResult> {
  try {
    const items = credentials()
    if (!items.length && !claudeAccounts().length) return { data: null, stale: false, error: "请在脚本中添加官方账号" }
    // Keep complete mixed-provider snapshots: a failed account is not silently dropped as current.
    const [codex, claude] = await Promise.all([Promise.all(items.map(fetchAccount)), loadClaudeAccounts()])
    const live = new Set(officialAccounts().map(a => a.id))
    const accounts = syncAccountOrder([...codex, ...claude].filter(a => live.has(a.id)), "official")
    const data: UsageData = { today: null, month: null, todayByFamily: {}, monthByFamily: {}, accounts, fetchedAt: Date.now() }
    Storage.set(CACHE, data)
    return { data, stale: false, error: null }
  } catch (e: any) {
    // Logout may have pruned the cache while a request was in flight; never resurrect its old snapshot.
    const cached = officialCached()
    return { data: cached, stale: !!cached, error: e?.message ?? "官方额度读取失败" }
  }
}

// Keep Claude isolated within this module so the existing three-file updater remains compatible.
namespace ClaudeOAuth {
// Claude Code public OAuth protocol (official @anthropic-ai/claude-code 2.1.295; readable 2.1.80 cross-check).
// All browser state/PKCE/code stays in memory; only completed credentials go to this separate Keychain key.
const CLIENT = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOKEN = "https://platform.claude.com/v1/oauth/token"
const MANUAL = "https://platform.claude.com/oauth/code/callback"
const API = "https://api.anthropic.com/api/oauth"
// Official 2.1.295 base Claude subscription scopes (r); exclude optional plugins/projects and org API-key scope.
const SCOPE = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
const KEY = "ai_usage_claude_oauth_v1"
// Explicit nonzero port from Scripting's documented HTTP example. Never fall back to a LAN bind.
const CALLBACK_PORT = 8080
function startErrorCategory(error: unknown): string {
  // Only exact known codes/messages are classified; never echo arbitrary native text or URLs.
  let value = ""
  try {
    const e = error as any
    value = typeof error === "string" ? error : typeof e?.code === "string" ? e.code : typeof e?.message === "string" ? e.message : ""
  } catch { return "未知" }
  const known = value.trim().toLowerCase()
  if (["eaddrinuse", "address already in use", "port already in use"].includes(known)) return "端口占用"
  if (["eacces", "eperm", "permission denied", "operation not permitted"].includes(known)) return "权限"
  if (["einval", "invalid argument", "unsupported parameter", "invalid port", "port 0 is not supported"].includes(known)) return "不支持参数"
  return "未知"
}
function startSnapshot(value: unknown, server: any, returned: boolean): string {
  // Snapshot before cleanup. Output only fixed types/enums/booleans, never native values or text.
  const read = (fn: () => string): string => { try { return fn() } catch { return "读取失败" } }
  let result = returned ? `type=${typeof value};null=${value === null}` : "未返回"
  if (returned && typeof value === "boolean") result += `;bool=${value}`
  if (returned && value !== null && typeof value === "object") {
    result += `;code字符串=${read(() => String(typeof (value as any).code === "string"))}`
    result += `;message字符串=${read(() => String(typeof (value as any).message === "string"))}`
  }
  const state = read(() => { const s = server.state; return ["starting", "running", "stopping", "stopped"].includes(s) ? s : "未知" })
  const port = read(() => { const p = server.port; return String(Number.isInteger(p) && p >= 1 && p <= 65535) })
  const ipv4 = read(() => { const v = server.isIPv4; return typeof v === "boolean" ? String(v) : "未知" })
  return `${result};state=${state};port有效=${port};IPv4=${ipv4}`
}
type Credential = { id: string; accountId: string; organizationId: string; email: string; access: string; refresh: string; expiresAt: number; scope: string }
export type ClaudeLogin = {
  url: string; redirect: string; manual: boolean; fallback: string | null
  verifier: string; state: string; expiresAt: number; cancelled: boolean; consumed: boolean
  code: string | null; server: any; timer: any
}
function credentials(): Credential[] {
  const raw = Keychain.get(KEY)
  if (!raw) return []
  try { const items = JSON.parse(raw); if (!Array.isArray(items)) throw new Error(); return items }
  catch { throw new Error("Claude登录记录损坏，请重新添加账号") }
}
function persist(items: Credential[]) {
  let saved = false
  try { saved = Keychain.set(KEY, JSON.stringify(items)) } catch { /* never expose native errors containing credentials */ }
  if (!saved) throw new Error("Claude钥匙串保存失败")
}
export function claudeAccounts(): { id: string; name: string; email: string; provider: "claude" }[] {
  return credentials().map((a, i) => ({ id: a.id, name: a.email || `Claude账号 ${i + 1}（邮箱未提供）`, email: a.email, provider: "claude" as const }))
}
export function logoutClaude(id: string) { persist(credentials().filter(a => a.id !== id)) }
const base64url = (data: any): string => data.toBase64String().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
function active(d: ClaudeLogin) {
  if (d.cancelled || Date.now() >= d.expiresAt) throw new Error("Claude本次授权已取消或过期，请重新开始")
}
export function cancelClaudeLogin(d: ClaudeLogin) {
  d.cancelled = true
  d.verifier = ""; d.state = ""; d.code = null
  if (d.timer != null) { clearTimeout(d.timer); d.timer = null }
  if (d.server) { d.server.stop(); d.server = null }
}
export function beginClaudeLogin(onCode: () => void = () => {}, onExpire: () => void = () => {}, manual = false): ClaudeLogin {
  if (typeof Crypto === "undefined" || typeof Crypto.generateSymmetricKey !== "function" || typeof Crypto.sha256 !== "function")
    throw new Error("当前Scripting不支持Claude PKCE加密，请更新Scripting")
  const verifier = base64url(Crypto.generateSymmetricKey(256)), state = base64url(Crypto.generateSymmetricKey(256))
  const input = Data.fromRawString(verifier)
  if (!input) throw new Error("无法生成Claude PKCE")
  const challenge = base64url(Crypto.sha256(input))
  const d: ClaudeLogin = { url: "", redirect: MANUAL, manual: true, fallback: null, verifier, state,
    expiresAt: Date.now() + 15 * 60 * 1000, cancelled: false, consumed: false, code: null, server: null, timer: null }
  if (!manual && typeof HttpServer !== "undefined" && typeof HttpServer === "function") {
    let server: any = null
    let stage = "构造"
    let startFailure = ""
    let snapshot = ""
    try {
      server = new HttpServer()
      stage = "地址配置"
      // Never bind to LAN/wildcard. localhost is the exact official CLI redirect, not scripting://.
      server.listenAddressIPv4 = "127.0.0.1"
      if (server.listenAddressIPv4 !== "127.0.0.1") throw new Error()
      stage = "注册handler"
      server.registerHandler("/callback", (req: any) => {
        const values = (key: string) => (req.queryParams ?? []).filter((x: any) => x.key === key).map((x: any) => x.value)
        const codes = values("code"), states = values("state")
        const ok = req.method === "GET" && !d.cancelled && !d.consumed && Date.now() < d.expiresAt &&
          states.length === 1 && states[0] === d.state && codes.length === 1 && typeof codes[0] === "string" && !!codes[0] && !d.code
        if (!ok) return HttpResponse.ok(HttpResponseBody.text("本次回调无效或已失效。请返回脚本检查授权。"))
        d.code = codes[0]
        // Respond without echoing code/state. Schedule exchange AFTER returning the local response.
        Promise.resolve().then(onCode)
        return HttpResponse.ok(HttpResponseBody.text("已收到本次授权回调，请返回脚本等待账号保存。此页面不代表授权已完成。"))
      })
      stage = "启动"
      let error: string | null
      try { error = server.start({ port: CALLBACK_PORT, forceIPv4: true }) }
      catch (e) { snapshot = startSnapshot(undefined, server, false); startFailure = `抛异常/${startErrorCategory(e)}`; throw new Error() }
      snapshot = startSnapshot(error, server, true)
      if (error) { startFailure = `返回错误/${startErrorCategory(error)}`; throw new Error() }
      stage = "端口"
      const port = server.port
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error()
      d.server = server; d.manual = false; d.redirect = `http://localhost:${port}/callback`
    } catch {
      try { server?.stop() } catch { /* no raw native error output */ }
      d.fallback = `本机回调不可用（阶段：${stage}${startFailure ? `；${startFailure}` : ""}${snapshot ? `；诊断：${snapshot}` : ""}），使用Claude官方手动授权码页`
    }
  } else if (!manual) d.fallback = "本机回调不可用（阶段：缺API），使用Claude官方手动授权码页"
  // Parameters are those in the official CLI buildAuthUrl; no cookie extraction or invented redirect.
  const params: Record<string, string> = { code: "true", client_id: CLIENT, response_type: "code", redirect_uri: d.redirect,
    scope: SCOPE, code_challenge: challenge, code_challenge_method: "S256", state }
  d.url = "https://claude.com/cai/oauth/authorize?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  d.timer = setTimeout(() => { if (!d.cancelled) { cancelClaudeLogin(d); onExpire() } }, 15 * 60 * 1000)
  return d
}
async function request(url: string, options: any = {}) {
  try { return await fetch(url, { ...options, timeout: 20 }) }
  catch { throw new Error("Claude官方服务网络请求失败") }
}
async function json(r: any) { try { return await r.json() } catch { throw new Error("Claude官方响应无法解析") } }
function tokenBody(b: any, old?: Credential) {
  if (b?.refresh_token != null && (typeof b.refresh_token !== "string" || !b.refresh_token)) throw new Error("Claude官方令牌响应不完整")
  if (typeof b?.access_token !== "string" || !b.access_token ||
    !(typeof b.refresh_token === "string" && b.refresh_token || old?.refresh) ||
    typeof b.expires_in !== "number" || !Number.isFinite(b.expires_in) || b.expires_in <= 0)
    throw new Error("Claude官方令牌响应不完整")
  return { access: b.access_token, refresh: b.refresh_token || old!.refresh,
    expiresAt: Date.now() + b.expires_in * 1000, scope: typeof b.scope === "string" ? b.scope : old?.scope || SCOPE }
}
const post = (body: any) => request(TOKEN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
export async function finishClaudeLogin(d: ClaudeLogin, pasted = "", stillActive: () => boolean = () => true): Promise<string> {
  active(d)
  if (d.consumed) throw new Error("Claude本次授权码已使用，请重新开始")
  if (!stillActive()) throw new Error("Claude本次授权已取消")
  let code = d.code
  if (d.manual) {
    const input = pasted.trim()
    if (!input) throw new Error("Claude授权码输入为空，请先粘贴本次完整code#state")
    if (!input.includes("#")) throw new Error("Claude授权码缺少#分隔符，请粘贴完整code#state")
    const parts = input.split("#")
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Claude授权码格式错误，需要且仅需要code#state两部分")
    if (parts[1] !== d.state) throw new Error("Claude授权码state不匹配，未提交令牌交换；请确认来自当前授权页")
    code = parts[0]
  }
  if (!code) throw new Error("尚未收到Claude回调，请完成网页授权或改用手动授权码")
  d.consumed = true
  try {
    const r = await post({ grant_type: "authorization_code", code, redirect_uri: d.redirect, client_id: CLIENT, code_verifier: d.verifier, state: d.state })
    if (r.status !== 200) throw new Error(`Claude授权交换失败（HTTP ${r.status}），请重新开始`)
    const tokens = tokenBody(await json(r))
    active(d); if (!stillActive()) throw new Error("Claude本次授权已取消")
    const profile = await request(API + "/profile", { headers: { Authorization: `Bearer ${tokens.access}`, "Content-Type": "application/json" } })
    if (profile.status !== 200) throw new Error(`Claude账号资料读取失败（HTTP ${profile.status}），请重新开始`)
    const p = await json(profile)
    if (typeof p?.account?.uuid !== "string" || !p.account.uuid || typeof p?.organization?.uuid !== "string" || !p.organization.uuid)
      throw new Error("Claude账号资料缺少真实身份，请重新开始")
    const id = `claude:${p.account.uuid}:${p.organization.uuid}`
    const item: Credential = { id, accountId: p.account.uuid, organizationId: p.organization.uuid,
      email: typeof p.account.email === "string" && p.account.email.includes("@") ? p.account.email : "", ...tokens }
    active(d); if (!stillActive()) throw new Error("Claude本次授权已取消")
    const items = credentials(), index = items.findIndex(x => x.id === id)
    if (index < 0) items.push(item)
    else { if (!item.email) item.email = items[index].email; items[index] = item }
    persist(items)
    return id
  } finally { cancelClaudeLogin(d) }
}
const refreshing = new Map<string, Promise<Credential>>()
async function refresh(item: Credential): Promise<Credential> {
  const existing = refreshing.get(item.id)
  if (existing) return existing
  const job = (async () => {
    const current = credentials().find(a => a.id === item.id)
    if (!current) throw new Error("该Claude账号已退出")
    if (current.access !== item.access) return current
    const r = await post({ grant_type: "refresh_token", refresh_token: current.refresh, client_id: CLIENT, scope: current.scope })
    if (r.status !== 200) throw new Error(`Claude续期失败（HTTP ${r.status}），请重新登录该账号`)
    const next = { ...current, ...tokenBody(await json(r), current) }, items = credentials()
    if (!items.some(a => a.id === item.id)) throw new Error("该Claude账号已退出")
    persist(items.map(a => a.id === item.id ? next : a)); return next
  })()
  refreshing.set(item.id, job)
  try { return await job } finally { refreshing.delete(item.id) }
}
export function mapClaudeUsage(b: any): { fiveHour: QuotaWindow; sevenDay: QuotaWindow; resetCredits: null } {
  const window = (w: any): QuotaWindow => {
    const used = typeof w?.utilization === "number" && Number.isFinite(w.utilization) ? Math.max(0, Math.min(100, w.utilization)) : null
    const at = typeof w?.resets_at === "string" ? Date.parse(w.resets_at) : NaN
    return { usedPercent: used, remainingPercent: used == null ? null : 100 - used,
      resetsAt: Number.isFinite(at) ? new Date(at).toISOString() : null }
  }
  // Never substitute model-specific Opus/Sonnet or extra usage for the aggregate weekly window.
  return { fiveHour: window(b?.five_hour), sevenDay: window(b?.seven_day), resetCredits: null }
}
export async function loadClaudeAccounts(): Promise<Account[]> {
  return Promise.all(credentials().map(async item => {
    let current = item.expiresAt <= Date.now() + 60000 ? await refresh(item) : item
    const getUsage = () => request(API + "/usage", { headers: { Authorization: `Bearer ${current.access}`,
      "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" } })
    let r = await getUsage()
    if (r.status === 401) { current = await refresh(current); r = await getUsage() }
    if (r.status !== 200) throw new Error(`Claude额度读取失败（HTTP ${r.status}）`)
    const mapped = mapClaudeUsage(await json(r))
    if (!credentials().some(a => a.id === item.id)) throw new Error("该Claude账号已退出")
    return { id: current.id, name: current.email || "Claude账号（邮箱未提供）", provider: "claude", enabled: true, available: true, ...mapped }
  }))
}
}

export type ClaudeLogin = ClaudeOAuth.ClaudeLogin
export const claudeAccounts = ClaudeOAuth.claudeAccounts
export const loadClaudeAccounts = ClaudeOAuth.loadClaudeAccounts
export const logoutClaude = ClaudeOAuth.logoutClaude
export const beginClaudeLogin = ClaudeOAuth.beginClaudeLogin
export const cancelClaudeLogin = ClaudeOAuth.cancelClaudeLogin
export const finishClaudeLogin = ClaudeOAuth.finishClaudeLogin
export const mapClaudeUsage = ClaudeOAuth.mapClaudeUsage
