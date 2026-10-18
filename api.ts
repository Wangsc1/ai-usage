// Parrot 管理接口数据层（Scripting 中 fetch / Keychain / Storage 为全局对象）


export const VERSION = "1.30"
export type DataSource = "parrot" | "official" | "sub2api"
export function getSource(): DataSource { const s = Storage.get<string>("ai_usage_source_v1"); return s === "official" || s === "sub2api" ? s : "parrot" }
export function saveSource(source: DataSource) { Storage.set("ai_usage_source_v1", source) }

// Statistics selection is independent of account/quota source. Existing installs default to Parrot.
export type StatisticsSource = "parrot" | "sub2api"
const KEY_STAT_SOURCE = "ai_usage_statistics_source_v1"
const KEY_SUB_URL = "ai_usage_sub2api_url_v1", KEY_SUB_KEY = "ai_usage_sub2api_admin_key_v1", KEY_SUB_TZ = "ai_usage_sub2api_timezone_v1"
const KEY_SUB_STATS = "ai_usage_sub2api_stats_v1", KEY_SUB_CACHE = "ai_usage_sub2api_quota_v1", KEY_SUB_CARDS = "ai_usage_sub2api_cards_v1"
export function getStatisticsSource(): StatisticsSource { return Storage.get<string>(KEY_STAT_SOURCE) === "sub2api" ? "sub2api" : "parrot" }
export function saveStatisticsSource(source: StatisticsSource) { Storage.set(KEY_STAT_SOURCE, source) }
export function getSub2APIConfig() { return { baseUrl: Keychain.get(KEY_SUB_URL), adminKey: Keychain.get(KEY_SUB_KEY), timezone: Keychain.get(KEY_SUB_TZ) || "Asia/Shanghai" } }
export function saveSub2APIConfig(baseUrl: string, adminKey: string, timezone: string) {
  const url = baseUrl.trim().replace(/\/+$/, ""), key = adminKey.trim(), tz = timezone.trim()
  if (!/^https?:\/\/[^\s?#]+$/i.test(url) || /https?:\/\/[^/]*@/i.test(url)) throw new Error("Sub2API地址应为部署根地址，不含凭据、查询参数或片段")
  if (!key) throw new Error("请填写Sub2API管理员密钥")
  try { new Intl.DateTimeFormat("en", { timeZone: tz }).format(new Date()) } catch { throw new Error("请填写有效IANA统计时区，如Asia/Shanghai") }
  const old = getSub2APIConfig()
  if (old.baseUrl !== url || old.adminKey !== key || old.timezone !== tz) { Storage.remove(KEY_SUB_STATS); Storage.remove(KEY_SUB_CACHE); Storage.remove(KEY_SUB_CARDS) }
  Keychain.set(KEY_SUB_URL, url); Keychain.set(KEY_SUB_KEY, key); Keychain.set(KEY_SUB_TZ, tz)
}
export function clearSub2APIConfig() { Keychain.remove(KEY_SUB_URL); Keychain.remove(KEY_SUB_KEY); Keychain.remove(KEY_SUB_TZ); Storage.remove(KEY_SUB_STATS); Storage.remove(KEY_SUB_CACHE); Storage.remove(KEY_SUB_CARDS) }

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
  antigravity?: AntigravityQuota
  readError?: string
  balance?: DeepSeekBalance
  credits?: WorkBuddyCredits
  id: string
  enabled: boolean
  provider: string // "claude" | "openai" | ...
  name: string
  available: boolean
  fiveHour: QuotaWindow
  sevenDay: QuotaWindow
  resetCredits: number | null // 官方只读重置卡数量；未提供/查询失败为未知
}

export type UsageData = {
  providerErrors?: string[]
  today: Metric | null
  month: Metric | null
  todayByFamily: Record<string, Metric>
  monthByFamily: Record<string, Metric>
  accounts: Account[]
  fetchedAt: number
  // Statistics freshness is independent of account/quota freshness.
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

function orderKey(source: DataSource) { return `ai_usage_${source}_order_v1` }
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
  const source = getSource()
  return sortAccounts(((source === "official" ? officialCached() : Storage.get<UsageData>(source === "sub2api" ? KEY_SUB_CACHE : KEY_CACHE))?.accounts ?? []).map(a => projectAntigravityAccount(a, source)), source)
}
export function widgetAccounts(accounts: Account[], parameter = ""): Account[] {
  // 参数序号与 App 账号列表从上到下一致，1 起算；支持英文/中文逗号或空格。
  accounts = sortAccounts(accounts.map(a => projectAntigravityAccount(a, getSource())))
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
  const old = getConfig()
  if (old.baseUrl !== baseUrl.trim().replace(/\/+$/, "") || old.managementKey !== managementKey.trim()) { Storage.remove(KEY_CACHE); Storage.remove(KEY_STATS) }
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

async function loginRequest(baseUrl: string, managementKey: string): Promise<string> {
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
  const current = getConfig()
  if (current.baseUrl === baseUrl && current.managementKey === managementKey) Keychain.set(KEY_SESSION, cred)
  return cred
}

let parrotLogin: { url: string; key: string; promise: Promise<string> } | null = null
function login(baseUrl: string, managementKey: string): Promise<string> {
  if (parrotLogin?.url === baseUrl && parrotLogin.key === managementKey) return parrotLogin.promise
  const promise = loginRequest(baseUrl, managementKey)
  parrotLogin = { url: baseUrl, key: managementKey, promise }
  promise.finally(() => { if (parrotLogin?.promise === promise) parrotLogin = null }).catch(() => {})
  return promise
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
  const accList = await apiGet(baseUrl, "/oauth/accounts?pageSize=50", cred)
  const all = [...(accList?.items ?? [])]
  for (let page = 2, pageLength = all.length; pageLength === 50; page++) {
    const next = await apiGet(baseUrl, `/oauth/accounts?pageSize=50&page=${page}`, cred)
    all.push(...(next?.items ?? []))
    pageLength = next?.items?.length ?? 0
  }
  const accounts: Account[] = await Promise.all(
    all.map(async (a: any) => {
      let d: any
      try { d = await apiGet(baseUrl, `/oauth/accounts/${encodeURIComponent(a.accountId)}`, cred) }
      catch (e) {
        if (a.provider !== "workbuddy" || e instanceof HttpError && e.status === 401) throw e
        const old = Storage.get<UsageData>(KEY_CACHE)?.accounts.find(x => x.id === a.accountId)
        return { ...(old ?? { fiveHour: emptyWindow(), sevenDay: emptyWindow(), resetCredits: null }), id: a.accountId, enabled: !!a.enabled, available: !!a.available, provider: a.provider, name: String(a.displayName ?? a.identity ?? a.accountId), fiveHour: emptyWindow(), sevenDay: emptyWindow(), resetCredits: null, credits: { ...(old?.credits ?? WorkBuddyCN.unknown()), checkin: workBuddyCheckin(null, null, "Parrot详情读取失败"), error: "Parrot WorkBuddy详情读取失败，显示此前快照" }, readError: "Parrot WorkBuddy详情读取失败" }
      }
      // 重置卡：Parrot 管理接口暂未提供只读字段；若日后账号详情返回 resetCreditCount 则自动显示
      const rc = d?.resetCreditCount ?? d?.openai?.resetCreditCount
      return {
        id: a.accountId,
        enabled: !!a.enabled,
        resetCredits: a.provider === "workbuddy" ? null : typeof rc === "number" ? rc : null,
        provider: a.provider,
        name: String(a.displayName ?? a.identity ?? a.accountId),
        available: !!a.available,
        fiveHour: a.provider === "workbuddy" ? emptyWindow() : toWindow(d?.usageWindows, "fiveHour"),
        sevenDay: a.provider === "workbuddy" ? emptyWindow() : toWindow(d?.usageWindows, "sevenDay"),
        ...(a.provider === "workbuddy" ? { credits: WorkBuddyCN.parrot(d?.workbuddy, Storage.get<UsageData>(KEY_CACHE)?.accounts.find(x => x.id === a.accountId)?.credits) } : {}),
      }
    })
  )
  // Claude 在前，其余按名称
  const ds = await dsParrot(baseUrl, cred, (Storage.get<UsageData>(KEY_CACHE)?.accounts ?? []))
  accounts.push(...ds.accounts)
  accounts.sort((x, y) =>
    x.provider === y.provider ? x.name.localeCompare(y.name) : x.provider === "claude" ? -1 : y.provider === "claude" ? 1 : x.provider.localeCompare(y.provider)
  )
  return { today: null, month: null, todayByFamily: {}, monthByFamily: {}, fetchedAt: Date.now(), accounts, ...(ds.error ? { providerErrors: [ds.error] } : {}) }
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
    const current = getConfig()
    if (current.baseUrl !== baseUrl || current.managementKey !== managementKey) return { data: null, error: "Parrot统计配置已改变" }
    Storage.set(KEY_STATS, data)
    return { data, error: null }
  } catch (e: any) {
    const current = getConfig(), same = current.baseUrl === baseUrl && current.managementKey === managementKey
    return { data: same && cached?.today && cached?.month ? statsOnly(cached) : null, error: String(e?.message ?? "Parrot统计读取失败") }
  }
}

async function loadParrotQuota(): Promise<LoadResult> {
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
    const current = getConfig()
    if (current.baseUrl !== baseUrl || current.managementKey !== managementKey) return { data: null, stale: false, error: "Parrot额度配置已改变" }
    data.accounts = syncAccountOrder(data.accounts, "parrot")
    Storage.set(KEY_CACHE, data)
    return { data, stale: false, error: null }
  } catch (e: any) {
    const msg = e instanceof HttpError
      ? (e.status === 401 || e.code === "AUTHENTICATION_FAILED" ? "管理密钥无效" : e.code === "RATE_LIMITED" ? "登录过于频繁" : e.message)
      : String(e?.message ?? e)
    const current = getConfig(), same = current.baseUrl === baseUrl && current.managementKey === managementKey
    return { data: same ? cached : null, stale: same && !!cached, error: msg }
  }
}

// Sub2API @3a6fd1c9: admin usage/stats, accounts lite, Claude reset-credits, OpenAI quota. GET only.
function sub2Date(tz: string, at = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at))
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
function sameSub2Config(cfg: ReturnType<typeof getSub2APIConfig>) {
  const c = getSub2APIConfig(); return c.baseUrl === cfg.baseUrl && c.adminKey === cfg.adminKey && c.timezone === cfg.timezone
}
async function sub2Get(cfg: ReturnType<typeof getSub2APIConfig>, path: string): Promise<any> {
  const res = await fetch(`${cfg.baseUrl}/api/v1/admin${path}`, { headers: { "x-api-key": cfg.adminKey! }, timeout: 15 })
  if (res.status !== 200) throw new Error(`Sub2API HTTP ${res.status}，GET /api/v1/admin${path.split("?")[0]}`)
  const body = await res.json().catch(() => null)
  if (body?.code !== 0 || body.data == null) throw new Error(`Sub2API响应无效，GET /api/v1/admin${path.split("?")[0]}`)
  return body.data
}
export function parseSub2APIStats(today: any, month: any): ParrotStats {
  const metric = (m: any): Metric => {
    const fields: [keyof Metric, string][] = [["requests", "total_requests"], ["inputTokens", "total_input_tokens"], ["outputTokens", "total_output_tokens"], ["cacheReadTokens", "total_cache_read_tokens"], ["cacheCreationTokens", "total_cache_creation_tokens"], ["totalTokens", "total_tokens"], ["costUsd", "total_actual_cost"]]
    if (!m || fields.some(([, k]) => typeof m[k] !== "number" || !Number.isFinite(m[k]) || m[k] < 0)) throw new Error("Sub2API今日/本月统计字段缺失或无效")
    const out = {} as Metric; for (const [to, from] of fields) out[to] = m[from]
    return out
  }
  return { today: metric(today), month: metric(month), todayByFamily: {}, monthByFamily: {}, fetchedAt: Date.now() }
}
async function loadSub2APIStats(): Promise<{ data: ParrotStats | null; error: string | null }> {
  const cfg = getSub2APIConfig(), cached = Storage.get<ParrotStats>(KEY_SUB_STATS)
  if (!cfg.baseUrl || !cfg.adminKey) return { data: null, error: "Sub2API统计未配置" }
  try {
    const end = sub2Date(cfg.timezone), first = end.slice(0, 8) + "01", tz = encodeURIComponent(cfg.timezone)
    // Explicit calendar month: upstream period=month is rolling one month, not this month.
    const path = (start: string) => `/usage/stats?start_date=${start}&end_date=${end}&timezone=${tz}`
    const todayRead = sub2Get(cfg, path(end))
    const [today, month] = await Promise.all([todayRead, first === end ? todayRead : sub2Get(cfg, path(first))])
    const data = parseSub2APIStats(today, month)
    if (!sameSub2Config(cfg)) return { data: null, error: "Sub2API统计配置已改变" }
    Storage.set(KEY_SUB_STATS, data); return { data, error: null }
  } catch (e: any) {
    return { data: sameSub2Config(cfg) && cached?.today && cached?.month ? statsOnly(cached) : null,
      error: typeof e?.message === "string" && e.message.startsWith("Sub2API") ? e.message : "Sub2API统计网络或解析失败" }
  }
}
function sub2Window(window: any): QuotaWindow {
  const v = window?.utilization
  return { usedPercent: typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null,
    remainingPercent: typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.max(0, 100 - v) : null,
    resetsAt: typeof window?.resets_at === "string" && Number.isFinite(Date.parse(window.resets_at)) ? window.resets_at : null }
}
function sub2Count(value: any): number | null { return Number.isSafeInteger(value) && value >= 0 ? value : null }
export function mapSub2APIAccount(row: any, usage: any, credits: any): Account {
  if (row.platform === "antigravity") return mapSub2Antigravity(row, usage)
  const codex = row.platform === "openai"
  const rateWindow = (seconds: number) => [usage?.rate_limit?.primary_window, usage?.rate_limit?.secondary_window].find(w => w?.limit_window_seconds === seconds)
  const codexWindow = (seconds: number): QuotaWindow => {
    const w = rateWindow(seconds)
    return sub2Window({ utilization: w?.used_percent, resets_at: typeof w?.reset_at === "number" && Number.isFinite(w.reset_at) ? (Number.isFinite(new Date(w.reset_at * 1000).getTime()) ? new Date(w.reset_at * 1000).toISOString() : null) : null })
  }
  return { id: `sub2api:${row.id}`, name: String(row.name ?? row.id), provider: codex ? "openai" : "claude",
    enabled: row.status !== "disabled", available: row.status === "active" && row.schedulable !== false && usage?.is_forbidden !== true,
    fiveHour: codex ? codexWindow(18000) : sub2Window(usage?.five_hour), sevenDay: codex ? codexWindow(604800) : sub2Window(usage?.seven_day),
    resetCredits: sub2Count(codex ? usage?.rate_limit_reset_credits?.available_count : credits?.available_count) }
}
async function loadSub2APIQuota(): Promise<LoadResult> {
  const cfg = getSub2APIConfig(), cached = Storage.get<UsageData>(KEY_SUB_CACHE)
  const fallback = cached ? { ...cached, accounts: sortAccounts(cached.accounts, "sub2api") } : null
  if (!cfg.baseUrl || !cfg.adminKey) return { data: null, stale: false, error: "Sub2API额度未配置" }
  try {
    const rows: any[] = [], seen = new Set<number>()
    for (let page = 1, pages = 1; page <= pages; page++) {
      const result = await sub2Get(cfg, `/accounts?lite=true&page=${page}&page_size=100`)
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.pages) || result.pages < page) throw new Error("Sub2API账号分页响应无效")
      pages = result.pages
      for (const row of result.items) {
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error("Sub2API账号ID重复或无效")
        seen.add(row.id)
        if ((row.platform === "anthropic" && ["oauth", "setup-token"].includes(row.type)) || (row.platform === "openai" && row.type === "oauth") || row.platform === "deepseek" || (row.platform === "antigravity" && row.type === "oauth")) rows.push(row)
      }
    }
    const errors: string[] = [], cards = Storage.get<Record<string, { count: number | null; at: number; error?: string }>>(KEY_SUB_CARDS) ?? {}
    const accounts: Account[] = []
    // Bounded sequential reads avoid a per-account upstream request burst. List remains complete if any read fails.
    for (const row of rows) {
      const id = `sub2api:${row.id}`, old = cached?.accounts.find(a => a.id === id)
      if (row.platform === "deepseek") { accounts.push(await dsSub2(cfg, row, old)); continue }
      let usage: any = null, credits: any = null, quotaFailed = false
      try { usage = await sub2Get(cfg, row.platform === "openai" ? `/openai/accounts/${row.id}/quota` : `/accounts/${row.id}/usage`) }
      catch (e: any) { quotaFailed = true; errors.push(`${id}额度：${typeof e?.message === "string" && e.message.startsWith("Sub2API") ? e.message : "Sub2API网络或解析失败"}`) }
      if (row.platform === "anthropic" && row.type === "oauth") {
        if (cards[id] && Date.now() - cards[id].at < 3600000) { credits = { available_count: cards[id].count }; if (cards[id].error) errors.push(cards[id].error!) }
        else {
          try { credits = await sub2Get(cfg, `/accounts/${row.id}/claude/reset-credits`); cards[id] = { count: sub2Count(credits?.available_count), at: Date.now() } }
          catch (e: any) { const error = `${id}重置卡：${typeof e?.message === "string" && e.message.startsWith("Sub2API") ? e.message : "Sub2API网络或解析失败"}`; errors.push(error); cards[id] = { count: cards[id]?.count ?? null, at: Date.now(), error }; credits = { available_count: cards[id].count } }
        }
      }
      const account = mapSub2APIAccount(row, usage, credits)
      if (row.platform === "antigravity" && (quotaFailed || usage?.error_code || usage?.error || usage?.needs_reauth)) { account.readError = "Sub2API Antigravity额度读取失败，可重试"; if (old) account.antigravity = old.antigravity; if (!quotaFailed) errors.push(`${id}额度：Antigravity管理接口返回降级状态`) }
      if (quotaFailed && old) { account.fiveHour = old.fiveHour; account.sevenDay = old.sevenDay; if (row.platform === "openai") account.resetCredits = old.resetCredits }
      accounts.push(account)
    }
    if (!sameSub2Config(cfg)) return { data: null, stale: false, error: "Sub2API额度配置已改变" }
    const data: UsageData = { today: null, month: null, todayByFamily: {}, monthByFamily: {}, accounts: syncAccountOrder(accounts, "sub2api"), fetchedAt: errors.length && cached ? cached.fetchedAt : Date.now() }
    Storage.set(KEY_SUB_CACHE, data); Storage.set(KEY_SUB_CARDS, cards)
    return { data, stale: errors.length > 0, error: errors.length ? errors.join("；") : null }
  } catch (e: any) {
    return { data: sameSub2Config(cfg) ? fallback : null, stale: sameSub2Config(cfg) && !!fallback,
      error: typeof e?.message === "string" && e.message.startsWith("Sub2API") ? e.message : "Sub2API账号列表网络或解析失败" }
  }
}
let usageFlight: { source: DataSource; stats: StatisticsSource; parrotURL: string | null; parrotKey: string | null; subURL: string | null; subKey: string | null; tz: string; promise: Promise<LoadResult> } | null = null
export function loadUsage(): Promise<LoadResult> {
  const source = getSource(), stats = getStatisticsSource(), pc = getConfig(), sc = getSub2APIConfig()
  const f = usageFlight
  if (f && f.source === source && f.stats === stats && f.parrotURL === pc.baseUrl && f.parrotKey === pc.managementKey && f.subURL === sc.baseUrl && f.subKey === sc.adminKey && f.tz === sc.timezone) return f.promise
  const promise = (async (): Promise<LoadResult> => {
    const [quota, result] = await Promise.all([source === "official" ? loadOfficialUsage() : source === "sub2api" ? loadSub2APIQuota() : loadParrotQuota(), stats === "sub2api" ? loadSub2APIStats() : loadParrotStats()])
    if (!quota.data) return quota
    return { ...quota, data: { ...quota.data, today: result.data?.today ?? null, month: result.data?.month ?? null,
      todayByFamily: result.data?.todayByFamily ?? {}, monthByFamily: result.data?.monthByFamily ?? {},
      statistics: { fetchedAt: result.data?.fetchedAt ?? null, stale: !!result.error && !!result.data, error: result.error } } }
  })()
  usageFlight = { source, stats, parrotURL: pc.baseUrl, parrotKey: pc.managementKey, subURL: sc.baseUrl, subKey: sc.adminKey, tz: sc.timezone, promise }
  promise.finally(() => { if (usageFlight?.promise === promise) usageFlight = null }).catch(() => {})
  return promise
}

// Shared brand icons (Simple Icons CC0 paths; official DeepSeek mark embedded offline) for widget and settings.
export const CLAUDE_PATH = "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
export const OPENAI_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
export const iconSvg = (path: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><path fill="${color}" d="${path}"/></svg>`
export const CLAUDE_SVG = iconSvg(CLAUDE_PATH, "#D97757")
export const OPENAI_SVG = { light: iconSvg(OPENAI_PATH, "#1C1C1E"), dark: iconSvg(OPENAI_PATH, "#FFFFFF") }

// DeepSeek brand mark shape: https://api-docs.deepseek.com/img/logo-mark-light.svg (embedded offline); fill recolored to blue #4D6BFE.
export const DEEPSEEK_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"27\" height=\"20\" viewBox=\"0.163 1.75 26.634 19.6\" fill=\"none\" role=\"img\" aria-label=\"DeepSeek\">\n  <path d=\"M26.5174 3.39471C26.235 3.2567 26.1137 3.52006 25.9487 3.65346C25.8923 3.69659 25.8446 3.75294 25.7969 3.80469C25.3846 4.24516 24.9027 4.53439 24.2737 4.49989C23.3536 4.44814 22.5682 4.73737 21.8735 5.44119C21.7258 4.57349 21.2353 4.0554 20.4889 3.72304C20.0985 3.55054 19.7034 3.37746 19.4297 3.00197C19.2388 2.73459 19.1865 2.43673 19.091 2.14289C19.0301 1.96579 18.9697 1.78466 18.7656 1.75418C18.5442 1.71968 18.4574 1.90541 18.3705 2.06067C18.0232 2.69549 17.8887 3.39471 17.9019 4.10313C17.9324 5.6965 18.6051 6.96556 19.9421 7.86834C20.0939 7.97184 20.133 8.07535 20.0852 8.22658C19.9938 8.53766 19.8857 8.83955 19.7903 9.15063C19.7293 9.34901 19.6384 9.39271 19.4257 9.30588C18.692 8.9994 18.0583 8.54571 17.4982 7.99772C16.5477 7.07827 15.6881 6.06336 14.6162 5.26869C14.3644 5.08296 14.1125 4.91045 13.8521 4.746C12.7584 3.68394 13.9952 2.81164 14.2816 2.70814C14.5812 2.60003 14.3857 2.22857 13.4179 2.23317C12.4502 2.2372 11.5646 2.56151 10.4359 2.99335C10.2708 3.05832 10.0972 3.10547 9.91951 3.14457C8.8954 2.95022 7.83162 2.90709 6.72069 3.03245C4.62877 3.26533 2.95777 4.25436 1.72954 5.94261C0.254043 7.97184 -0.0932678 10.2777 0.33167 12.6824C0.778458 15.2171 2.07225 17.3153 4.06008 18.9558C6.12152 20.6567 8.49577 21.4905 11.2047 21.3306C12.8498 21.2358 14.6812 21.0155 16.7473 19.2669C17.2682 19.5262 17.8151 19.6297 18.7219 19.7074C19.4205 19.7723 20.0933 19.6729 20.6143 19.5648C21.4302 19.3923 21.3739 18.6367 21.0789 18.4981C18.6874 17.3843 19.2124 17.8374 18.7351 17.4706C19.9501 16.033 21.8063 13.4776 22.379 9.99821C22.4353 9.61409 22.5072 9.073 22.4986 8.76192C22.494 8.57216 22.5377 8.49856 22.7545 8.47671C23.3536 8.40771 23.935 8.24383 24.4692 7.94999C26.0188 7.10357 26.6439 5.71318 26.7911 4.04678C26.8129 3.79204 26.7865 3.52869 26.5174 3.39471ZM13.0143 18.3946C10.6964 16.5724 9.5722 15.9726 9.10816 15.9985C8.67402 16.0244 8.75222 16.5212 8.84768 16.8449C8.94773 17.1646 9.07768 17.3849 9.25996 17.6655C9.38589 17.8512 9.47272 18.1272 9.13404 18.3348C8.38766 18.7965 7.08985 18.1796 7.0289 18.1491C5.51833 17.2595 4.25559 16.0853 3.36546 14.4793C2.50581 12.9337 2.0067 11.2753 1.92447 9.50542C1.90262 9.07818 2.02855 8.92695 2.45406 8.84932C3.01413 8.74582 3.59144 8.72397 4.15093 8.80619C6.51656 9.15178 8.53027 10.2092 10.2185 11.8848C11.1822 12.8388 11.9114 13.979 12.6623 15.0929C13.461 16.2757 14.3201 17.4027 15.4144 18.3268C15.8008 18.6505 16.109 18.8966 16.404 19.0783C15.5144 19.1778 14.0297 19.1991 13.0143 18.3958V18.3946ZM14.1252 11.2489C14.1252 11.0591 14.277 10.9079 14.4679 10.9079C14.511 10.9079 14.5501 10.9165 14.5852 10.9292C14.6329 10.9464 14.6766 10.9723 14.7111 11.0114C14.7721 11.0718 14.8066 11.158 14.8066 11.2489C14.8066 11.4386 14.6548 11.5899 14.4639 11.5899C14.273 11.5899 14.1252 11.4386 14.1252 11.2489ZM17.5759 13.0188C17.3545 13.1096 17.1331 13.1873 16.9203 13.1959C16.5903 13.2131 16.2303 13.0791 16.0348 12.9153C15.7312 12.6605 15.5139 12.5179 15.423 12.0734C15.3839 11.8837 15.4057 11.5899 15.4402 11.4214C15.5185 11.0585 15.4316 10.8257 15.1757 10.614C14.9676 10.4415 14.7025 10.3938 14.4115 10.3938C14.3029 10.3938 14.2034 10.3461 14.1292 10.3076C14.0079 10.2472 13.9078 10.096 14.0033 9.91023C14.0338 9.84985 14.1815 9.70322 14.216 9.67734C14.6111 9.45251 15.0665 9.52612 15.488 9.6946C15.8784 9.85445 16.174 10.1477 16.5989 10.5623C17.033 11.0631 17.1112 11.2011 17.3585 11.5772C17.554 11.871 17.7317 12.1729 17.8536 12.5185C17.9272 12.7341 17.8317 12.9107 17.5759 13.0188Z\" fill=\"#4D6BFE\"/>\n</svg>\n"

// ---------- 格式化 ----------
// Display-only; deadlines remain epoch milliseconds and statistics keep their configured timezone.
export function formatBeijingDeadline(at: number): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at))
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`
}
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

// 7d 额度倒计时：满 1 天显示“Nd HH:MM”，不足 1 天按 HH:MM
export function fmtResetDays(iso: string | null): string {
  if (!iso) return "--"
  const ms = new Date(iso).getTime() - Date.now()
  if (!(ms > 0)) return "--"
  return fmtReset(iso)
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

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// OpenAI Codex browser OAuth protocol. No Parrot credentials are accessed here.
const AUTH = "https://auth.openai.com"
const CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann"
const WHAM = "https://chatgpt.com/backend-api/wham"
const KEY = "ai_usage_official_oauth_v1"
const CACHE = "ai_usage_official_cache_v1"
type Credential = { id: string; accountId: string; subject: string; name: string; email?: string; access: string; refresh: string; expiresAt: number }

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
export function officialAccounts(): { id: string; name: string; email: string; provider: "codex" | "claude" | "deepseek" | "workbuddy" | "antigravity" }[] {
  // Legacy Codex records have no provider field; their dedicated credential collection identifies them.
  return [...credentials().map((item, i) => ({ id: item.id, name: officialDisplay(item, i), email: item.email || "", provider: "codex" as const })), ...claudeAccounts(), ...dsCredentials().map(a => ({ id: a.id, name: a.name, email: "", provider: "deepseek" as const })), ...WorkBuddyCN.accounts(), ...Antigravity.accounts()]
}
// Local management includes authorized accounts even before their first usage collection.
export function managementAccounts(): Account[] {
  if (getSource() !== "official") return cachedAccounts()
  const cached = new Map((officialCached()?.accounts ?? []).map(a => [a.id, a]))
  return sortAccounts(officialAccounts().map(a => cached.get(a.id) ?? {
    id: a.id, name: a.name, provider: a.provider, enabled: true, available: true,
    fiveHour: { usedPercent: null, remainingPercent: null, resetsAt: null },
    sevenDay: { usedPercent: null, remainingPercent: null, resetsAt: null }, resetCredits: null,
  }), "official")
}
function officialSnapshot(): UsageData | null {
  const cache = Storage.get<UsageData>(CACHE)
  if (!cache) return null
  const names = new Map(officialAccounts().map(a => [a.id, a.name]))
  return { ...cache, accounts: sortAccounts(cache.accounts.map(a => ({ ...a, name: names.get(a.id) ?? a.name })), "official") }
}
export function officialCached(): UsageData | null {
  const cache = officialSnapshot()
  return cache ? { ...cache, accounts: cache.accounts.map(a => projectAntigravityAccount(a, "official")) } : null
}
export function logoutOfficial(id: string) {
  if (id.startsWith("antigravity:")) { Antigravity.logout(id); saveAntigravityMode(id, "summary", "official"); if (!Antigravity.accounts().length) Storage.remove(AG_LOCAL_WIDGET_UNTIL) }
  else if (id.startsWith("workbuddy:")) WorkBuddyCN.logout(id)
  else if (id.startsWith("deepseek:")) { if (!Keychain.set(DS_KEY, JSON.stringify(dsCredentials().filter(x => x.id !== id)))) throw new Error("DeepSeek钥匙串保存失败") }
  else if (id.startsWith("claude:")) logoutClaude(id)
  else persist(credentials().filter(x => x.id !== id))
  saveWidgetName(id, "", "official")
  const cache = officialSnapshot()
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
  if (b.refresh_token != null && (typeof b.refresh_token !== "string" || !b.refresh_token)) throw new Error("官方令牌响应不完整")
  const refresh = b.refresh_token ?? previous?.refresh
  if (!accountId || !subject || typeof refresh !== "string" || !refresh) throw new Error("官方未提供账号路由或续期信息，无法保存登录")
  const exp = a.exp
  return { id: previous?.id ?? "", accountId, subject, name: officialName(c, a) || previous?.name || "", email: officialEmail(c, a) || previous?.email || "", access: b.access_token, refresh,
    expiresAt: typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1000 : Date.now() + (Number.isFinite(Number(b.expires_in)) && Number(b.expires_in) > 0 ? Number(b.expires_in) : 3600) * 1000 }
}
// Browser login preserves the existing account identity/dedup and local Keychain semantics.
function saveOfficialCredential(body: any) {
  const item = credential(body)
  const items = credentials()
  const old = items.find(x => x.accountId === item.accountId && x.subject === item.subject)
  item.email = item.email || old?.email || ""
  item.id = old?.id ?? `official-${Date.now()}-${Math.random().toString(36).slice(2)}`
  item.name = item.name || old?.name || `账号 ${Math.max(0, ...items.map(x => Number(x.name.match(/\d+$/)?.[0]) || 0)) + 1}`
  persist(old ? items.map(x => x.id === item.id ? item : x) : [...items, item])
}
export type CodexBrowserLogin = {
  url: string; redirect: string; verifier: string; state: string; expiresAt: number;
  cancelled: boolean; consumed: boolean; code: string | null; server: any; timer: any;
}
function closeCodexListener(d: CodexBrowserLogin) {
  if (d.timer != null) { clearTimeout(d.timer); d.timer = null }
  if (d.server) { try { d.server.stop() } catch {} d.server = null }
}
export function cancelCodexBrowserLogin(d: CodexBrowserLogin) {
  d.cancelled = true; closeCodexListener(d); d.verifier = ""; d.state = ""; d.code = null; d.url = ""
}
export function beginCodexBrowserLogin(onCode: () => void, onExpire: () => void, onFailure: () => void = onExpire): CodexBrowserLogin {
  if (typeof Crypto === "undefined" || typeof Crypto.generateSymmetricKey !== "function" || typeof Crypto.sha256 !== "function")
    throw new Error("Codex浏览器登录缺少PKCE能力，请重新登录")
  if (typeof HttpServer !== "function" || typeof HttpResponse === "undefined" || typeof HttpResponseBody === "undefined" || typeof HttpResponse.ok !== "function" || typeof HttpResponseBody.html !== "function")
    throw new Error("Codex浏览器登录缺少本机回调能力，请重新登录")
  const base = (data: any) => data.toBase64String().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const verifier = base(Crypto.generateSymmetricKey(256)), state = base(Crypto.generateSymmetricKey(256))
  const input = Data.fromRawString(verifier)
  if (!input) throw new Error("Codex PKCE生成失败，请重新登录")
  const challenge = base(Crypto.sha256(input))
  const d: CodexBrowserLogin = { url: "", redirect: "", verifier, state, expiresAt: Date.now() + 15 * 60000,
    cancelled: false, consumed: false, code: null, server: null, timer: null }
  const reply = (ok: boolean) => HttpResponse.ok(HttpResponseBody.html(ok
    ? '<!doctype html><meta charset="utf-8"><p>已收到授权回调，请返回脚本等待保存。此页面不代表登录成功。</p>'
    : '<!doctype html><meta charset="utf-8"><p>本次回调无效或已失效，请返回脚本重新登录。</p>'))
  for (const port of [1455, 1457]) {
    let server: any = null
    try {
      server = new HttpServer(); server.listenAddressIPv4 = "127.0.0.1"
      if (server.listenAddressIPv4 !== "127.0.0.1") throw new Error()
      server.registerHandler("/auth/callback", (req: any) => {
        const values = (key: string) => (req.queryParams ?? []).filter((x: any) => x.key === key).map((x: any) => x.value)
        const codes = values("code"), states = values("state")
        if (!d.cancelled && Date.now() >= d.expiresAt) { cancelCodexBrowserLogin(d); Promise.resolve().then(onExpire); return reply(false) }
        if (req.method === "GET" && !d.cancelled && !d.consumed && states.length === 1 && states[0] === d.state && values("error").length > 0) {
          cancelCodexBrowserLogin(d); Promise.resolve().then(onFailure); return reply(false)
        }
        const valid = req.method === "GET" && !d.cancelled && !d.consumed && !d.code && Date.now() < d.expiresAt &&
          values("error").length === 0 && states.length === 1 && states[0] === d.state && codes.length === 1 && typeof codes[0] === "string" && !!codes[0]
        if (!valid) return reply(false)
        d.code = codes[0]
        Promise.resolve().then(onCode)
        return reply(true)
      })
      const error = server.start({ port, forceIPv4: true })
      if (error || server.port !== port) throw new Error()
      d.server = server; d.redirect = `http://127.0.0.1:${port}/auth/callback`; break
    } catch { try { server?.stop() } catch {} }
  }
  if (!d.server) { cancelCodexBrowserLogin(d); throw new Error("Codex本机回调无法绑定127.0.0.1:1455或1457，请重新登录") }
  const params = { response_type: "code", client_id: CLIENT, redirect_uri: d.redirect,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke", code_challenge: challenge,
    code_challenge_method: "S256", state, id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "codex_cli_rs" }
  d.url = AUTH + "/oauth/authorize?" + Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  d.timer = setTimeout(() => { if (!d.cancelled) { cancelCodexBrowserLogin(d); onExpire() } }, 15 * 60000)
  return d
}
export async function finishCodexBrowserLogin(d: CodexBrowserLogin, active: () => boolean): Promise<void> {
  if (Date.now() >= d.expiresAt || !active()) cancelCodexBrowserLogin(d)
  if (d.cancelled || d.consumed || !d.code) throw new Error("Codex本次浏览器授权已失效，请重新登录")
  d.consumed = true
  const body = Object.entries({ grant_type: "authorization_code", client_id: CLIENT, code: d.code,
    redirect_uri: d.redirect, code_verifier: d.verifier }).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  try {
    const r = await request(AUTH + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })
    if (r.status !== 200) throw new Error(`Codex浏览器令牌交换失败（HTTP ${r.status}），请重新登录`)
    const tokens = await json(r)
    if (d.cancelled || !active() || Date.now() >= d.expiresAt) throw new Error("Codex本次浏览器授权已失效，请重新登录")
    saveOfficialCredential(tokens)
  } finally { cancelCodexBrowserLogin(d) }
}
// Renewal cooldowns contain only provider/account-ID deadlines, never tokens. No timer or automatic retry.
const RENEWAL_LIMIT = "ai_usage_oauth_renewal_cooldown_v1"
function renewalDeadline(provider: string, id: string): number {
  const at = (Storage.get<Record<string, number>>(RENEWAL_LIMIT) ?? {})[`${provider}:${id}`]
  return typeof at === "number" && Number.isFinite(at) && at > Date.now() ? at : 0
}
function renewalWait(provider: string, until: number): string {
  return `${provider}续期冷却至${formatBeijingDeadline(until)}，剩余${Math.ceil((until - Date.now()) / 1000)}秒；保留登录，冷却后下次刷新再尝试`
}
function renewalDue(expiresAt: number): boolean {
  return typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000
}
async function renewalFailure(provider: string, id: string, response: any): Promise<Error> {
  let retry = ""
  try { retry = String(response.headers?.get("Retry-After") || "").trim() } catch { /* no raw headers */ }
  let until = /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry) ? Date.parse(retry) : 0
  if (!Number.isFinite(until) || until <= Date.now() || until > 8640000000000000) until = 0
  const fallback = response.status === 429 && !until
  if (fallback) until = Date.now() + 300000 // Local backoff only, not a claimed service deadline.
  if (response.status === 429 || response.status >= 500) {
    if (until) {
      const key = `${provider}:${id}`, all = Storage.get<Record<string, number>>(RENEWAL_LIMIT) ?? {}
      Storage.set(RENEWAL_LIMIT, { ...all, [key]: Math.max(until, renewalDeadline(provider, id)) })
    }
    return new Error(`${provider}续期暂时失败（HTTP ${response.status}），保留登录${until ? `；${fallback ? "服务未提供有效等待时间，本机退避5分钟；" : ""}${renewalWait(provider, until)}` : "；下次刷新再尝试"}`)
  }
  // Only a machine-readable invalid_grant is evidence of invalid renewal credentials.
  // Do not infer revocation from HTTP400/401/403 alone or echo response message/body.
  let invalid = false
  try { const body = await response.json(); invalid = body?.error === "invalid_grant" || body?.error?.type === "invalid_grant" } catch { /* unclassified */ }
  return new Error(invalid ? `${provider}续期失败：登录已失效（invalid_grant），请重新添加该账号` : `${provider}续期失败（HTTP ${response.status}），尚不能确认登录失效；保留登录，下次刷新再尝试`)
}
const refreshing = new Map<string, Promise<Credential>>()
async function refreshToken(item: Credential, force = false): Promise<Credential> {
  const running = refreshing.get(item.id)
  if (running) return running
  const job = (async () => {
    const current = credentials().find(x => x.id === item.id)
    if (!current) throw new Error("该官方账号已退出")
    if (current.access !== item.access || current.refresh !== item.refresh || (!force && current.expiresAt !== item.expiresAt && !renewalDue(current.expiresAt))) return current
    const until = renewalDeadline("Codex", item.id)
    if (until) throw new Error(renewalWait("Codex", until))
    let r: any
    try { r = await post("/oauth/token", { grant_type: "refresh_token", client_id: CLIENT, refresh_token: current.refresh }) }
    catch { throw new Error("Codex续期网络暂时失败，保留登录，下次刷新再尝试") }
    if (r.status !== 200) {
      const latest = credentials().find(x => x.id === item.id)
      if (latest && (latest.access !== current.access || latest.refresh !== current.refresh)) return latest
      const failure = await renewalFailure("Codex", item.id, r)
      // Parsing the error body awaits I/O; another execution can rotate credentials meanwhile.
      const recovered = credentials().find(x => x.id === item.id)
      if (!recovered) throw new Error("该官方账号已退出")
      if (!renewalDue(recovered.expiresAt) && (recovered.access !== current.access || recovered.refresh !== current.refresh || recovered.expiresAt !== current.expiresAt)) return recovered
      throw failure
    }
    const next = credential(await json(r), current)
    const items = credentials(), latest = items.find(x => x.id === item.id)
    if (!latest) throw new Error("该官方账号已退出")
    if (latest.access !== current.access || latest.refresh !== current.refresh) return latest
    persist(items.map(x => x.id === item.id ? { ...x, ...next } : x))
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
  let token = renewalDue(item.expiresAt) ? await refreshToken(item) : item
  async function get(path: string) {
    const send = () => request(WHAM + path, { headers: { Authorization: `Bearer ${token.access}`, "ChatGPT-Account-ID": token.accountId, Accept: "application/json" } })
    let r = await send()
    if (r.status === 401) { token = await refreshToken(token, true); r = await send() }
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
    if (!items.length && !claudeAccounts().length && !dsCredentials().length && !WorkBuddyCN.credentials().length && !Antigravity.credentials().length) return { data: null, stale: false, error: "请在脚本中添加官方账号" }
    // Keep complete mixed-provider snapshots: a failed account is not silently dropped as current.
    const isolate = dsCredentials().length > 0 || WorkBuddyCN.credentials().length > 0 || Antigravity.credentials().length > 0
    const [codex, claude] = await Promise.all([Promise.all(items.map((item, i) => isolate ? fetchAccount(item, i).catch(() => quotaFallback(item.id, officialDisplay(item, i), "openai")) : fetchAccount(item, i))), loadClaudeAccounts(isolate)])
    const deepseek = (await Promise.all(dsCredentials().map(dsOfficial))).filter((a): a is Account => !!a)
    const workbuddy = (await Promise.all(WorkBuddyCN.credentials().map(WorkBuddyCN.read))).filter((a): a is Account => !!a)
    const antigravity = await Promise.all(Antigravity.credentials().map(Antigravity.read))
    const live = new Set(officialAccounts().map(a => a.id))
    const accounts = syncAccountOrder([...codex, ...claude, ...deepseek, ...workbuddy, ...antigravity].filter(a => live.has(a.id)), "official")
    const providerErrors = accounts.flatMap(a => a.readError ? [`${a.name}：${a.readError}`] : [])
    const data: UsageData = { today: null, month: null, todayByFamily: {}, monthByFamily: {}, accounts, fetchedAt: Date.now(), ...(providerErrors.length ? { providerErrors } : {}) }
    Storage.set(CACHE, data) // canonical windows + all raw groups; never persist a selected projection
    return { data: { ...data, accounts: data.accounts.map(a => projectAntigravityAccount(a, "official")) }, stale: false, error: null }
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
const COOLDOWN = "ai_usage_claude_login_cooldown_v1"
export function claudeCooldownUntil(): number {
  const value = Storage.get<number>(COOLDOWN)
  return typeof value === "number" && Number.isFinite(value) && value > Date.now() && value <= 8640000000000000 ? value : 0
}
export function claudeCooldownMessage(): string {
  const until = claudeCooldownUntil()
  return until ? `Claude授权冷却中，剩余${Math.ceil((until - Date.now()) / 1000)}秒；可重新授权时间：${formatBeijingDeadline(until)}` : ""
}
async function tokenRateLimit(r: any): Promise<Error> {
  const header = (name: string): string => { try { return r.headers?.get(name) || "" } catch { return "" } }
  const retry = header("Retry-After").trim()
  let until = 0
  if (/^\d+$/.test(retry)) until = Date.now() + Number(retry) * 1000
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry)) until = Date.parse(retry)
  if (!Number.isFinite(until) || until <= Date.now() || until > 8640000000000000) until = 0
  if (until) { try { Storage.set(COOLDOWN, Math.max(until, claudeCooldownUntil())) } catch { /* no raw storage errors */ } }
  const mime = header("Content-Type").split(";")[0].trim().toLowerCase()
  const format = mime === "application/json" || mime.endsWith("+json") ? "JSON" : mime === "text/html" ? "HTML" : "other"
  let category = "未分类"
  if (format === "JSON") {
    try {
      const b = await r.json(), value = typeof b?.error === "string" ? b.error : b?.error?.type
      if (["rate_limit_error", "rate_limited", "too_many_requests"].includes(value)) category = "rate_limit"
      else if (["temporarily_unavailable", "invalid_grant"].includes(value)) category = value
    } catch { /* no body/message/URL output */ }
  }
  const wait = claudeCooldownMessage() || "服务未提供有效等待时间，请稍后再授权，勿连续重试"
  return new Error(`Claude授权交换失败（HTTP 429；格式：${format}；类别：${category}）。${wait}。本次流程已结束，未自动重试；之后需使用新授权码。`)
}
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
function safeStartDescription(error: string): string {
  // Only the local start() RETURN string, before browser/code exchange; never network bodies or exceptions.
  const text = error.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim()
  if (/[a-z][a-z0-9+.-]*:\/\/|www\.|[?&][^\s=]+=/i.test(text) ||
      /\b(?:access[_ -]?token|refresh[_ -]?token|token|bearer|secret|verifier|pkce|authorization)\b/i.test(text) ||
      /\b(?:code|state)\s*[:=#]|\b(?:code[_ -]?verifier|access_token|refresh_token|client_secret)\b/i.test(text)) return "已隐藏（含敏感模式）"
  return text.length > 240 ? text.slice(0, 239) + "…" : text || "空描述"
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
  progress: string; onProgress?: (stage: string) => void
}
function loginProgress(d: ClaudeLogin, stage: string) {
  d.progress = stage
  d.onProgress?.(stage)
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
export function logoutClaude(id: string) { persist(credentials().filter(a => a.id !== id)); forgetClaudeUsageState(id) }
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
export function beginClaudeLogin(onCode: () => void = () => {}, onExpire: () => void = () => {}, manual = false, onProgress?: (stage: string) => void): ClaudeLogin {
  if (claudeCooldownUntil()) throw new Error(claudeCooldownMessage())
  if (typeof Crypto === "undefined" || typeof Crypto.generateSymmetricKey !== "function" || typeof Crypto.sha256 !== "function")
    throw new Error("当前Scripting不支持Claude PKCE加密，请更新Scripting")
  const verifier = base64url(Crypto.generateSymmetricKey(256)), state = base64url(Crypto.generateSymmetricKey(256))
  const input = Data.fromRawString(verifier)
  if (!input) throw new Error("无法生成Claude PKCE")
  const challenge = base64url(Crypto.sha256(input))
  const d: ClaudeLogin = { url: "", redirect: MANUAL, manual: true, fallback: null, verifier, state,
    expiresAt: Date.now() + 15 * 60 * 1000, cancelled: false, consumed: false, code: null, server: null, timer: null,
    progress: "等待Claude回调（尚未收到）", onProgress }
  if (!manual && typeof HttpServer !== "undefined" && typeof HttpServer === "function") {
    let server: any = null
    let stage = "构造"
    let startFailure = ""
    let snapshot = ""
    let description = ""
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
        if (!ok) {
          if (!d.cancelled && !d.consumed && !d.code) loginProgress(d, "收到Claude回调，但未通过本次校验")
          return HttpResponse.ok(HttpResponseBody.html('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>授权回调</title></head><body><p>本次回调无效或已失效。请返回脚本检查授权。</p></body></html>'))
        }
        d.code = codes[0]
        loginProgress(d, "收到Claude回调，已通过本次校验")
        // Return a synchronous response without awaiting exchange. Native socket flush timing is platform-owned.
        Promise.resolve().then(onCode)
        return HttpResponse.ok(HttpResponseBody.html('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>授权回调</title></head><body><p>已收到本次授权回调，请返回脚本等待账号保存。此页面不代表授权已完成。</p></body></html>'))
      })
      stage = "启动"
      let error: string | null
      try { error = server.start({ port: CALLBACK_PORT, forceIPv4: true }) }
      catch (e) { snapshot = startSnapshot(undefined, server, false); startFailure = `抛异常/${startErrorCategory(e)}`; throw new Error() }
      snapshot = startSnapshot(error, server, true)
      if (error) {
        startFailure = `返回错误/${startErrorCategory(error)}`
        if (typeof error === "string") description = safeStartDescription(error)
        throw new Error()
      }
      stage = "端口"
      const port = server.port
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error()
      d.server = server; d.manual = false; d.redirect = `http://localhost:${port}/callback`
    } catch {
      try { server?.stop() } catch { /* no raw native error output */ }
      d.fallback = `本机回调不可用（阶段：${stage}${startFailure ? `；${startFailure}` : ""}${snapshot ? `；诊断：${snapshot}` : ""}${description ? `；启动描述：${description}` : ""}），使用Claude官方手动授权码页`
    }
  } else if (!manual) d.fallback = "本机回调不可用（阶段：缺API），使用Claude官方手动授权码页"
  // Parameters are those in the official CLI buildAuthUrl; no cookie extraction or invented redirect.
  const params: Record<string, string> = { code: "true", client_id: CLIENT, response_type: "code", redirect_uri: d.redirect,
    scope: SCOPE, code_challenge: challenge, code_challenge_method: "S256", state }
  d.url = "https://claude.com/cai/oauth/authorize?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  if (d.manual) d.progress = "等待Claude手动授权码"
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
const post = (body: any) => {
  // Same honest HTTP identity and JSON negotiation for initial exchange and renewal.
  // A controlled compatibility adjustment, not evidence that these headers cure service HTTP429.
  const headers: Record<string, string> = {
    "Content-Type": "application/json", Accept: "application/json", "User-Agent": `ai-usage/${VERSION}`,
  }
  return request(TOKEN, { method: "POST", headers, body: JSON.stringify(body) })
}
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
    loginProgress(d, "正在交换Claude令牌（不重复提交）")
    const r = await post({ grant_type: "authorization_code", code, redirect_uri: d.redirect, client_id: CLIENT, code_verifier: d.verifier, state: d.state })
    if (r.status === 429) throw await tokenRateLimit(r)
    if (r.status !== 200) throw new Error(`Claude授权交换失败（HTTP ${r.status}），请重新开始`)
    const tokens = tokenBody(await json(r))
    active(d); if (!stillActive()) throw new Error("Claude本次授权已取消")
    loginProgress(d, "正在读取Claude账号资料")
    const profile = await request(API + "/profile", { headers: { Authorization: `Bearer ${tokens.access}`, "Content-Type": "application/json" } })
    if (profile.status !== 200) throw new Error(`Claude账号资料读取失败（HTTP ${profile.status}），请重新开始`)
    const p = await json(profile)
    if (typeof p?.account?.uuid !== "string" || !p.account.uuid || typeof p?.organization?.uuid !== "string" || !p.organization.uuid)
      throw new Error("Claude账号资料缺少真实身份，请重新开始")
    const id = `claude:${p.account.uuid}:${p.organization.uuid}`
    const item: Credential = { id, accountId: p.account.uuid, organizationId: p.organization.uuid,
      email: typeof p.account.email === "string" && p.account.email.includes("@") ? p.account.email : "", ...tokens }
    active(d); if (!stillActive()) throw new Error("Claude本次授权已取消")
    loginProgress(d, "正在保存Claude账号到本机")
    const items = credentials(), index = items.findIndex(x => x.id === id)
    if (index < 0) items.push(item)
    else { if (!item.email) item.email = items[index].email; items[index] = item }
    persist(items)
    loginProgress(d, item.email ? `Claude ${item.email}` : "Claude 邮箱未提供")
    return id
  } finally { cancelClaudeLogin(d) }
}
const refreshing = new Map<string, Promise<Credential>>()
async function refresh(item: Credential, force = false): Promise<Credential> {
  const existing = refreshing.get(item.id)
  if (existing) return existing
  const job = (async () => {
    const current = credentials().find(a => a.id === item.id)
    if (!current) throw new Error("该Claude账号已退出")
    if (current.access !== item.access || current.refresh !== item.refresh || (!force && current.expiresAt !== item.expiresAt && !renewalDue(current.expiresAt))) return current
    const until = renewalDeadline("Claude", item.id)
    if (until) throw new Error(renewalWait("Claude", until))
    let r: any
    try { r = await post({ grant_type: "refresh_token", refresh_token: current.refresh, client_id: CLIENT, scope: current.scope }) }
    catch { throw new Error("Claude续期网络暂时失败，保留登录，下次刷新再尝试") }
    if (r.status !== 200) {
      const latest = credentials().find(a => a.id === item.id)
      if (latest && (latest.access !== current.access || latest.refresh !== current.refresh)) return latest
      const failure = await renewalFailure("Claude", item.id, r)
      const recovered = credentials().find(a => a.id === item.id)
      if (!recovered) throw new Error("该Claude账号已退出")
      if (!renewalDue(recovered.expiresAt) && (recovered.access !== current.access || recovered.refresh !== current.refresh || recovered.expiresAt !== current.expiresAt)) return recovered
      throw failure
    }
    const next = { ...current, ...tokenBody(await json(r), current) }, items = credentials(), latest = items.find(a => a.id === item.id)
    if (!latest) throw new Error("该Claude账号已退出")
    if (latest.access !== current.access || latest.refresh !== current.refresh) return latest
    persist(items.map(a => a.id === item.id ? { ...a, ...next } : a)); return next
  })()
  refreshing.set(item.id, job)
  try { return await job } finally { refreshing.delete(item.id) }
}
// Official 2.1.295 cedar_ember status: grants[].resets_left; CLI Ue sums the remaining grants.
// Do not substitute extra_usage.used_credits (money), or infer zero from an absent/malformed status.
function claudeResetCount(b: any): number | null {
  const status = b?.cedar_ember
  if (typeof status?.eligible !== "boolean" || !Array.isArray(status.grants)) return null
  let total = 0
  const ids = new Set<string>()
  for (const grant of status.grants) {
    if (typeof grant?.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(grant.id) || ids.has(grant.id) ||
        !Number.isSafeInteger(grant.resets_left) || grant.resets_left < 0) return null
    ids.add(grant.id); total += grant.resets_left
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}
// Official 2.1.295 K_: remember a 429/403 per bearer for Retry-After, else 5 min, capped at 1 h; do not ask again meanwhile.
// Only non-secret account-ID deadlines/counts are stored locally.
const USAGE_LIMIT = "ai_usage_claude_usage_cooldown_v1", CARDS = "ai_usage_claude_reset_cards_v1"
const CARD_INTERVAL = 3600000
type Deadlines = Record<string, number>
function deadline(key: string, id: string): number {
  const value = (Storage.get<Deadlines>(key) ?? {})[id]
  return typeof value === "number" && Number.isFinite(value) && value > Date.now() ? value : 0
}
function remember429(key: string, id: string, r: any): number {
  let retry = ""
  try { retry = String(r.headers?.get("Retry-After") || "").trim() } catch { /* unreadable header = absent */ }
  let ms = 0
  if (/^\d+$/.test(retry)) ms = Number(retry) * 1000
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry)) ms = Date.parse(retry) - Date.now()
  const until = Date.now() + Math.min(Number.isFinite(ms) && ms > 0 ? ms : 300000, 3600000)
  const all = Storage.get<Deadlines>(key) ?? {}
  Storage.set(key, { ...all, [id]: Math.max(until, deadline(key, id)) })
  return until
}
const waitText = (until: number) => `冷却至${formatBeijingDeadline(until)}，剩余${Math.ceil((until - Date.now()) / 1000)}秒`
type CardCache = Record<string, { count: number | null; at: number }>
const claudeLoads = new Map<string, Promise<Account>>()
export function forgetClaudeUsageState(id: string) {
  for (const key of [USAGE_LIMIT, CARDS]) {
    const all = { ...(Storage.get<Record<string, unknown>>(key) ?? {}) }
    if (id in all) { delete all[id]; Storage.set(key, all) }
  }
}
export function mapClaudeUsage(b: any): { fiveHour: QuotaWindow; sevenDay: QuotaWindow; resetCredits: number | null } {
  const window = (w: any): QuotaWindow => {
    const used = typeof w?.utilization === "number" && Number.isFinite(w.utilization) ? Math.max(0, Math.min(100, w.utilization)) : null
    const at = typeof w?.resets_at === "string" ? Date.parse(w.resets_at) : NaN
    return { usedPercent: used, remainingPercent: used == null ? null : 100 - used,
      resetsAt: Number.isFinite(at) ? new Date(at).toISOString() : null }
  }
  // Never substitute model-specific Opus/Sonnet or extra usage for the aggregate weekly window.
  return { fiveHour: window(b?.five_hour), sevenDay: window(b?.seven_day), resetCredits: claudeResetCount(b) }
}
export async function loadClaudeAccounts(isolate = false): Promise<Account[]> {
  // In-process de-duplication: concurrent App/widget loads share one request sequence per account.
  return Promise.all(credentials().map(item => {
    const pending = claudeLoads.get(item.id)
    if (pending) return isolate ? pending.catch(() => quotaFallback(item.id, item.email || "Claude账号", "claude")) : pending
    const job = loadClaudeAccount(item).finally(() => { if (claudeLoads.get(item.id) === job) claudeLoads.delete(item.id) })
    claudeLoads.set(item.id, job)
    return isolate ? job.catch(() => quotaFallback(item.id, item.email || "Claude账号", "claude")) : job
  }))
}
async function loadClaudeAccount(item: Credential): Promise<Account> {
  {
    const limited = deadline(USAGE_LIMIT, item.id)
    if (limited) throw new Error(`Claude额度读取冷却中（此前GET /api/oauth/usage受限），${waitText(limited)}；本次未发送请求`)
    let current = renewalDue(item.expiresAt) ? await refresh(item) : item
    const getUsage = () => request(API + "/usage", { headers: { Authorization: `Bearer ${current.access}`,
      "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" } })
    let r = await getUsage()
    if (r.status === 401) { current = await refresh(current, true); r = await getUsage() }
    if (r.status === 429 || r.status === 403) {
      const until = remember429(USAGE_LIMIT, item.id, r)
      throw new Error(`Claude额度读取受限（HTTP ${r.status}，GET /api/oauth/usage），${waitText(until)}；不自动重试`)
    }
    if (r.status !== 200) throw new Error(`Claude额度读取失败（HTTP ${r.status}，GET /api/oauth/usage）`)
    const mapped = mapClaudeUsage(await json(r))
    const cards = Storage.get<CardCache>(CARDS) ?? {}, cached = cards[item.id]
    if (mapped.resetCredits != null) Storage.set(CARDS, { ...cards, [item.id]: { count: mapped.resetCredits, at: Date.now() } })
    else if (cached && typeof cached.at === "number" && Date.now() - cached.at < CARD_INTERVAL) mapped.resetCredits = cached.count
    else if (!deadline(CARDS, item.id)) {
      // Optional same-endpoint selector at most hourly; never the reset_rate_limits POST/claim endpoint.
      try {
        const cardResponse = await request(API + "/usage?cedar_ember=1&skip_spend=1", { headers: { Authorization: `Bearer ${current.access}`,
          "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" } })
        if (cardResponse.status === 429 || cardResponse.status === 403) remember429(CARDS, item.id, cardResponse)
        else if (cardResponse.status === 200) {
          mapped.resetCredits = claudeResetCount(await json(cardResponse))
          Storage.set(CARDS, { ...(Storage.get<CardCache>(CARDS) ?? {}), [item.id]: { count: mapped.resetCredits, at: Date.now() } })
        }
      } catch { /* optional card lookup must not block the successfully read quota */ }
    }
    if (!credentials().some(a => a.id === item.id)) throw new Error("该Claude账号已退出")
    return { id: current.id, name: current.email || "Claude账号（邮箱未提供）", provider: "claude", enabled: true, available: true, ...mapped }
  }
}
}

export type ClaudeLogin = ClaudeOAuth.ClaudeLogin
export const claudeAccounts = ClaudeOAuth.claudeAccounts
export const loadClaudeAccounts = ClaudeOAuth.loadClaudeAccounts
export const logoutClaude = ClaudeOAuth.logoutClaude
export const claudeCooldownUntil = ClaudeOAuth.claudeCooldownUntil
export const claudeCooldownMessage = ClaudeOAuth.claudeCooldownMessage
export const beginClaudeLogin = ClaudeOAuth.beginClaudeLogin
export const cancelClaudeLogin = ClaudeOAuth.cancelClaudeLogin
export const finishClaudeLogin = ClaudeOAuth.finishClaudeLogin
export const mapClaudeUsage = ClaudeOAuth.mapClaudeUsage

// DeepSeek protocols independently implemented from DashBoard-Kit data.ts (SylvanRoe/Scripting,
// 9eadd307). No reference source/assets copied: repository exposes no license grant.
export type DeepSeekMoney = { currency: string; total: string | null; granted: string | null; toppedUp: string | null; weekCost: string | null }
export type DeepSeekBalance = { money: DeepSeekMoney[]; fetchedAt: number | null; weekFetchedAt?: number | null; weekStale?: boolean; stale: boolean; error: string | null; available: boolean | null; auth: string }
const DS_KEY = "ai_usage_deepseek_credentials_v1"
type DeepSeekCredential = { id: string; name: string; mode: "api" | "web"; token: string }
class DeepSeekReadError extends Error {}
function dsCredentials(): DeepSeekCredential[] { try { return JSON.parse(Keychain.get(DS_KEY) || "[]") } catch { return [] } }
export function addDeepSeekAccount(name: string, mode: "api" | "web", token: string): string {
  if (!name.trim() || !token.trim() || !["api", "web"].includes(mode)) throw new Error("DeepSeek名称、认证方式和凭据不能为空")
  if (typeof Crypto === "undefined" || typeof Crypto.generateSymmetricKey !== "function") throw new Error("当前Scripting不支持安全随机ID，请更新Scripting")
  const id = `deepseek:${Date.now().toString(36)}:${Crypto.generateSymmetricKey(256).toHexString()}`
  if (!Keychain.set(DS_KEY, JSON.stringify([...dsCredentials(), { id, name: name.trim(), mode, token: token.trim() }]))) throw new Error("DeepSeek钥匙串保存失败")
  return id
}
function dsDecimal(value: any): string | null {
  let text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : ""
  if (typeof value === "number" && /e/i.test(text)) {
    const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text)
    if (!match) return null
    const digits = match[2] + (match[3] || ""), point = match[2].length + Number(match[4])
    text = match[1] + (point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point))
  }
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : null
}
// Exact decimal addition avoids float rounding and keeps currency values separate.
function dsSum(values: string[]): string {
  const scale = Math.max(0, ...values.map(v => (v.split(".")[1] || "").length))
  const total = values.reduce((sum, v) => { const negative = v.startsWith("-"); const [a, b = ""] = v.replace(/^-/, "").split("."); return sum + BigInt((negative ? "-" : "") + a + b.padEnd(scale, "0")) }, 0n)
  const sign = total < 0n ? "-" : "", digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0")
  return sign + (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits)
}
// Display only: exact decimal rounding to two places for CNY, without mutating stored money.
export function fmtDeepSeekMoney(currency: string, value: string | null): string {
  const label = currency === "CNY" ? "¥" : currency
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return `${label} 未提供`
  if (currency !== "CNY") return `${label} ${value}`
  const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^-/, "").split(".")
  let cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))
  if ((fraction[2] || "0") >= "5") cents += 1n
  const digits = cents.toString().padStart(3, "0")
  return `${label} ${negative && cents !== 0n ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`
}
export function deepSeekSummary(a: Account): string {
  const b = a.balance
  if (!b) return "余额未提供"
  return `${b.auth} · ${b.money.map(m => `账户余额 ${fmtDeepSeekMoney(m.currency, m.total)} · 充值 ${fmtDeepSeekMoney(m.currency, m.toppedUp)} 赠送 ${fmtDeepSeekMoney(m.currency, m.granted)}${b.auth === "网页Token" ? ` · 近7日消费 ${fmtDeepSeekMoney(m.currency, m.weekCost)}` : ""}`).join("；") || "余额未提供"} · ${b.weekFetchedAt ? `7日采集 ${new Date(b.weekFetchedAt).toISOString()}` : ""} · ${b.available === null ? "可用状态未提供" : b.available ? "可用" : "不可用"} · ${b.fetchedAt == null ? "未采集" : `采集 ${new Date(b.fetchedAt).toISOString()}`}${b.error ? ` · ${b.error}` : ""}`
}
function dsAccount(id: string, name: string, balance: DeepSeekBalance, enabled = true): Account {
  return { id, name, provider: "deepseek", enabled, available: balance.available !== false, balance,
    fiveHour: { usedPercent: null, remainingPercent: null, resetsAt: null }, sevenDay: { usedPercent: null, remainingPercent: null, resetsAt: null }, resetCredits: null }
}
function dsFallback(id: string, name: string, old: Account | undefined, auth: string, error: string): Account {
  return dsAccount(id, name, { money: old?.balance?.money ?? [], fetchedAt: old?.balance?.fetchedAt ?? null, weekFetchedAt: old?.balance?.weekFetchedAt ?? null, stale: true, available: old?.balance?.available ?? null, auth, error }, old?.enabled ?? true)
}
function dsPublicMoney(body: any): DeepSeekMoney[] {
  if (!Array.isArray(body?.balance_infos) || !body.balance_infos.length) throw new Error("DeepSeek余额字段缺失")
  return body.balance_infos.map((m: any) => {
    if (typeof m.currency !== "string" || !m.currency || dsDecimal(m.total_balance) === null) throw new Error("DeepSeek余额字段无效")
    return { currency: m.currency, total: dsDecimal(m.total_balance), granted: dsDecimal(m.granted_balance), toppedUp: dsDecimal(m.topped_up_balance), weekCost: null }
  })
}
const dsFlights = new Map<string, Promise<Account | null>>()
async function dsOfficial(item: DeepSeekCredential): Promise<Account | null> {
  const existing = dsFlights.get(item.id); if (existing) return existing
  const job = (async () => {
    const old = officialCached()?.accounts.find(a => a.id === item.id)
    let account: Account
    try {
      const headers = { Authorization: `Bearer ${item.token}`, Accept: "application/json", "User-Agent": "ai-usage/1.10.0" }
      if (item.mode === "api") {
        const r = await fetch("https://api.deepseek.com/user/balance", { headers, timeout: 15 })
        if (r.status !== 200) throw new DeepSeekReadError(`DeepSeek API余额 HTTP ${r.status}`)
        const body = await r.json(); const money = dsPublicMoney(body)
        account = dsAccount(item.id, item.name, { money, fetchedAt: Date.now(), stale: false, error: null, available: typeof body.is_available === "boolean" ? body.is_available : null, auth: "API Key" })
      } else {
        // Private platform contract; no API-key fallback or automatic session renewal.
        const webHeaders = { ...headers, Referer: "https://platform.deepseek.com/usage" }
        const r = await fetch("https://platform.deepseek.com/api/v0/users/get_user_summary", { headers: webHeaders, timeout: 20 })
        if (r.status !== 200) throw new DeepSeekReadError(`DeepSeek网页余额 HTTP ${r.status}；可重试，Token失效需更新`)
        const body = await r.json(), biz = body?.data?.biz_data
        if (body?.code !== 0 || !Array.isArray(biz?.normal_wallets) || !Array.isArray(biz?.bonus_wallets)) throw new DeepSeekReadError("DeepSeek网页余额字段缺失；可重试，Token失效需更新")
        const currencies = new Set<string>(), normal = new Map<string, string[]>(), bonus = new Map<string, string[]>()
        for (const [rows, target] of [[biz.normal_wallets, normal], [biz.bonus_wallets, bonus]] as const) for (const row of rows) {
          const amount = dsDecimal(row.balance)
          if (typeof row.currency !== "string" || !row.currency || amount === null) throw new DeepSeekReadError("DeepSeek网页钱包字段无效")
          currencies.add(row.currency); target.set(row.currency, [...target.get(row.currency) ?? [], amount])
        }
        const money: DeepSeekMoney[] = [...currencies].map(currency => ({ currency, total: dsSum([...(normal.get(currency) ?? []), ...(bonus.get(currency) ?? [])]), toppedUp: normal.has(currency) ? dsSum(normal.get(currency)!) : null, granted: bonus.has(currency) ? dsSum(bonus.get(currency)!) : null, weekCost: null }))
        const balance: DeepSeekBalance = { money, fetchedAt: Date.now(), stale: false, error: null, available: null, auth: "网页Token", weekFetchedAt: null }
        try {
          const midnight = Math.floor((Date.now() / 1000 + 28800) / 86400) * 86400 - 28800
          const cost = await fetch(`https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=${midnight - 6 * 86400}&end=${midnight + 86400}&tz=28800`, { headers: webHeaders, timeout: 15 })
          if (cost.status !== 200) throw new Error("cost")
          const cb = await cost.json(), rows = cb?.data?.biz_data?.data
          if ((cb?.code != null && cb.code !== 0) || !Array.isArray(rows)) throw new Error("schema")
          const amounts = new Map<string, string[]>()
          for (const row of rows) {
            if (!Array.isArray(row.series)) throw new Error("schema")
            for (const series of row.series) {
              if (!Array.isArray(series.buckets)) throw new Error("schema")
              for (const bucket of series.buckets) {
                const value = dsDecimal(bucket.cost), currency = bucket.currency ?? series.currency ?? row.currency ?? (money.length === 1 ? money[0].currency : null)
                if (value === null || typeof currency !== "string" || !currencies.has(currency)) throw new Error("currency")
                amounts.set(currency, [...amounts.get(currency) ?? [], value])
              }
            }
          }
          for (const m of money) m.weekCost = amounts.has(m.currency) ? dsSum(amounts.get(m.currency)!) : null
          balance.weekFetchedAt = Date.now()
        } catch { balance.error = "近7日消费读取失败或币种无法确认，可重试；未提供不等于零"; for (const m of money) m.weekCost = old?.balance?.money.find(o => o.currency === m.currency)?.weekCost ?? null; balance.weekFetchedAt = old?.balance?.weekFetchedAt ?? null; balance.weekStale = true }
        account = dsAccount(item.id, item.name, balance)
      }
    } catch (e: any) {
      const safe = e instanceof DeepSeekReadError ? e.message : "DeepSeek网络或解析失败，可重试"
      account = dsFallback(item.id, item.name, old, item.mode === "api" ? "API Key" : "网页Token", safe)
    }
    // A removed or changed credential must never be resurrected by late responses.
    const latest = dsCredentials().find(x => x.id === item.id)
    return latest && latest.token === item.token && latest.mode === item.mode ? account : null
  })()
  dsFlights.set(item.id, job)
  try { return await job } finally { dsFlights.delete(item.id) }
}
async function dsParrot(baseUrl: string, cred: string, old: Account[]): Promise<{ accounts: Account[]; error?: string }> {
  const accounts: Account[] = [], seen = new Set<string>()
  try {
    for (let page = 1, more = true; more; page++) {
      const r = await fetch(`${baseUrl}/api/management/v1/channels?providerId=deepseek&page=${page}&pageSize=50`, { headers: { Authorization: `Bearer ${cred}` }, timeout: 15 })
      if (r.status === 401) throw new HttpError(401, "AUTHENTICATION_FAILED")
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
      const body = await r.json()
      if (!Array.isArray(body?.data) || typeof body?.meta?.hasNext !== "boolean" || body.meta.page !== page) throw new Error("schema")
      more = body.meta.hasNext
      if (more && !body.data.length) throw new Error("pagination")
      for (const row of body.data) {
        if (row.providerId !== "deepseek") continue
        if (typeof row.id !== "string" || !row.id) throw new Error("channel ID missing")
        const id = `parrot:deepseek:${row.id}`, name = String(row.name || row.id), u = row.providerUsage
        if (seen.has(id)) throw new Error("duplicate channel ID")
        seen.add(id)
        try {
          if (!u?.supported || !Array.isArray(u?.snapshot?.balances)) throw new Error("snapshot")
          const map = new Map<string, DeepSeekMoney>()
          for (const b of u.snapshot.balances) {
            if (typeof b.currency !== "string" || !b.currency || dsDecimal(b.value) === null) throw new Error("money")
            const m = map.get(b.currency) ?? { currency: b.currency, total: null, granted: null, toppedUp: null, weekCost: null }
            if (b.id === "total") m.total = dsDecimal(b.value); else if (b.id === "granted") m.granted = dsDecimal(b.value); else if (b.id === "topped_up") m.toppedUp = dsDecimal(b.value)
            map.set(b.currency, m)
          }
          const time = Date.parse(u.fetchedAt), money = [...map.values()]
          if (!Number.isFinite(time) || !money.length) throw new Error("snapshot")
          accounts.push(dsAccount(id, name, { money, fetchedAt: time, stale: !!u.stale, error: u.error ? "Parrot余额快照报告错误" : null, available: u.snapshot.notices?.includes("账户不可用") ? false : u.snapshot.notices?.includes("账户可用") ? true : null, auth: "Parrot快照" }, !!row.enabled))
        } catch { accounts.push({ ...dsFallback(id, name, old.find(a => a.id === id), "Parrot快照", "Parrot DeepSeek余额未采集或读取失败"), enabled: !!row.enabled }) }
      }
    }
    return { accounts }
  } catch (e) { if (e instanceof HttpError && e.status === 401) throw e; return { accounts: [...accounts, ...old.filter(a => a.provider === "deepseek" && !accounts.some(current => current.id === a.id)).map(a => dsFallback(a.id, a.name, a, "Parrot快照", "Parrot DeepSeek频道接口不可用，可重试"))], error: "Parrot DeepSeek频道接口不可用（旧版可能未提供），原账号仍可读取" } }
}
async function dsSub2(cfg: ReturnType<typeof getSub2APIConfig>, row: any, old?: Account): Promise<Account> {
  const id = `sub2api:${row.id}`, name = String(row.name || id)
  try {
    const b = await sub2Get(cfg, `/cn-providers/accounts/${row.id}/balance`)
    if (!b.success || !Array.isArray(b.balances) || !b.balances.length || !Number.isFinite(b.fetched_at) || b.fetched_at <= 0 || !Number.isFinite(new Date(b.fetched_at * 1000).getTime())) throw new Error("schema")
    const money = b.balances.map((m: any) => {
      const total = dsDecimal(m.balance)
      if (typeof m.currency !== "string" || !m.currency || total === null) throw new Error("money")
      return { currency: m.currency, total, granted: null, toppedUp: null, weekCost: null }
    })
    return dsAccount(id, name, { money, fetchedAt: b.fetched_at * 1000, stale: false, error: null, available: typeof b.available === "boolean" ? b.available : null, auth: "Sub2API" }, row.status !== "disabled")
  } catch { return { ...dsFallback(id, name, old, "Sub2API", "Sub2API DeepSeek余额读取失败，可重试；未提供赠送/充值拆分"), enabled: row.status !== "disabled" } }
}

function quotaFallback(id: string, name: string, provider: string): Account {
  const old = officialSnapshot()?.accounts.find(a => a.id === id)
  return { ...(old ?? { id, name, provider, enabled: true, available: false, fiveHour: { usedPercent: null, remainingPercent: null, resetsAt: null }, sevenDay: { usedPercent: null, remainingPercent: null, resetsAt: null }, resetCredits: null }), readError: "额度读取失败，保留原账号缓存；可重试" }
}


// WorkBuddy CN personal CLI profile, from danger-dream/Parrot 25b93d3 oauth/workbuddy.
// Private client protocol, not OAuth/PKCE or an API-key balance API. No check-in/trial endpoints.
export type WorkBuddyCheckin = { checked: boolean | null; observedAt: number | null; active: boolean | null; error?: string }
// Upstream Parrot business_date uses billing.CN_TIMEZONE = Asia/Shanghai (UTC+8).
export function workBuddyDay(at: number): string { return new Date(at + 8 * 3600000).toISOString().slice(0,10) }
export function workBuddyCheckin(raw: any, observedAt: any, error?: string): WorkBuddyCheckin {
  const at = typeof observedAt === "number" && Number.isFinite(observedAt) && observedAt > 0 && observedAt <= Date.now() ? observedAt : null
  const checked = raw?.todayCheckedIn ?? raw?.today_checked_in
  const active = raw?.active ?? raw?.Active
  return { checked: typeof checked === "boolean" && !error && active !== false && raw?.supported !== false ? checked : null, observedAt: at, active: typeof active === "boolean" ? active : null, ...(error ? { error } : {}) }
}
export function fmtWorkBuddyCheckin(c: WorkBuddyCheckin | undefined): string {
  if (c?.error) return "签到未知（查询失败）"
  if (!c || c.observedAt == null || c.checked == null || c.observedAt > Date.now()) return "签到未知"
  if (workBuddyDay(c.observedAt) !== workBuddyDay(Date.now())) return "签到未知（旧缓存）"
  return `${c.checked ? "已签到" : "未签到"}`
}
export type WorkBuddyCredits = {
  checkin?: WorkBuddyCheckin
  remaining: number | null; capacity: number | null; used: number | null; reliable: boolean
  status: string; complete: boolean; fetchedAt: number | null; currentStatus?: string; error?: string
  packages: { name: string; remaining: number | null; capacity: number | null; used: number | null; expiresAt: string | null; cycleEnd: string | null }[]
}
export type WorkBuddyLogin = WorkBuddyCN.Login
export const fmtWorkBuddyNumber = (n: number | null | undefined): string => typeof n === "number" && Number.isFinite(n) ? String(n) : "未提供"
export function fmtWorkBuddyUsed(used: number | null | undefined, capacity: number | null | undefined): string {
  const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
  const amount = (n: number | null | undefined) => valid(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "未提供"
  const pct = valid(used) && valid(capacity) && capacity > 0 ? (used / capacity * 100).toFixed(2) + "%" : "未提供"
  return `已用 ${pct}（${amount(used)} / ${amount(capacity)}）`
}

namespace WorkBuddyCN {
const KEY = "ai_usage_workbuddy_cn_cli_v1"
const AUTH = "https://copilot.tencent.com"
const BILLING = "https://www.codebuddy.cn"
const DOMAINS = new Set(["copilot.tencent.com", "codebuddy.cn", "www.codebuddy.cn", "workbuddy.cn", "www.workbuddy.cn"])
type Credential = { id: string; uid: string; domain: string; name: string; access: string; refresh: string; expiresAt: number }
export type Login = { url: string; state: string; expiresAt: number; cancelled: boolean; consumed: boolean; cookies: Record<string, string>; timer?: ReturnType<typeof setTimeout>; wake?: () => void; controller?: AbortController }
const flows = new Set<Login>()
const refreshing = new Map<string, Promise<Credential>>()
// Retry saving an in-memory rotated candidate rather than replaying its old refresh token.
const pendingRefresh = new Map<string, { credential: Credential; until: number }>()
class WBError extends Error { constructor(message: string, public invalid = false) { super(message) } }
function text(v: any, max = 32768): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw new WBError("WorkBuddy响应字段无效")
  return v.trim()
}
function domain(v: any): string { const d = text(v, 128).toLowerCase(); if (!DOMAINS.has(d)) throw new WBError("WorkBuddy返回了不支持的国内认证域名"); return d }
function number(v: any): number | null {
  if (typeof v !== "number" && typeof v !== "string" || typeof v === "string" && !v.trim()) return null
  if (typeof v === "string" && !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())) return null
  const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null
}
function tokenExpiry(v: any): number { const n = number(v); return n != null && n > 0 && n <= 366 * 86400 ? Date.now() + n * 1000 : 0 }
export function credentials(): Credential[] {
  const raw = Keychain.get(KEY); if (!raw) return []
  try {
    const rows = JSON.parse(raw); if (!Array.isArray(rows)) throw 0
    return rows.map(c => { text(c.id); text(c.uid, 512); domain(c.domain); text(c.access); text(c.refresh); return c })
  } catch { throw new WBError("WorkBuddy登录记录损坏，请移除后重新添加") }
}
function persist(rows: Credential[]) { if (!Keychain.set(KEY, JSON.stringify(rows))) throw new WBError("WorkBuddy钥匙串保存失败") }
export function accounts() { return credentials().map(c => ({ id: c.id, name: c.name || "WorkBuddy", email: "", provider: "workbuddy" as const })) }
export function logout(id: string) { for (const d of flows) cancel(d); persist(credentials().filter(c => c.id !== id)); for (const key of pendingRefresh.keys()) if (key.startsWith(id + ":")) pendingRefresh.delete(key) }
function same(c: Credential): boolean { return credentials().some(x => x.id === c.id && x.access === c.access && x.refresh === c.refresh) }
function headers(c?: Credential, refresh = false): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Origin: BILLING, Referer: BILLING + "/", "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2", "X-IDE-Type": "CLI", "X-IDE-Name": "CLI", "X-IDE-Version": "2.63.2" }
  if (c) { domain(c.domain); if (refresh) { h["X-Refresh-Token"] = text(c.refresh); h["X-Auth-Refresh-Source"] = "workbuddy" } else { h.Authorization = "Bearer " + text(c.access); h["X-User-Id"] = text(c.uid, 512); h["X-Domain"] = c.domain } }
  return h
}
function active(d: Login, valid: () => boolean) {
  if (d.cancelled || Date.now() >= d.expiresAt || !valid()) { cancel(d); throw new WBError("WorkBuddy登录已取消或等待超时，请重新登录") }
}
// Scripting fetch docs: handleRedirect returns null to prevent redirects; cookies are NOT shared automatically.
async function wire(base: string, path: string, method: string, h: Record<string, string>, body?: any, d?: Login, pending = false): Promise<any> {
  if (base !== AUTH && base !== BILLING) throw new WBError("WorkBuddy不支持此请求域名")
  if (d?.cancelled) throw new WBError("WorkBuddy登录已取消")
  let r: any
  try {
    r = await fetch(base + path, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }), timeout: 20,
      handleRedirect: async () => null, ...(d?.controller ? { signal: d.controller.signal } : {}) })
  } catch { throw new WBError(d?.cancelled ? "WorkBuddy登录已取消" : "WorkBuddy网络请求失败，请重试") }
  if (d?.cancelled) throw new WBError("WorkBuddy登录已取消")
  if (r.status < 200 || r.status >= 300) throw new WBError(`WorkBuddy请求失败（HTTP ${r.status}）`, r.status === 401)
  // Only this state's own cookies, returned by the fixed AUTH host. Never read browser/global cookies.
  if (d && base === AUTH && Array.isArray(r.cookies)) for (const cookie of r.cookies) {
    const name = cookie?.name, value = cookie?.value
    if (typeof name === "string" && /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) && typeof value === "string" && /^[\x21-\x7e]*$/.test(value) && !/[;,]/.test(value) && value.length <= 4096) d.cookies[name] = value
  }
  let b: any; try { b = await r.json() } catch { throw new WBError("WorkBuddy响应不是有效JSON") }
  if (!b || !Number.isInteger(b.code)) throw new WBError("WorkBuddy响应结构无效")
  if (pending && b.code === 11217) return null
  if (b.code !== 0) {
    if (pending && typeof b.msg === "string" && b.msg.trim().toLowerCase() === "login ing") return null
    throw new WBError(`WorkBuddy请求失败（code ${b.code}）`, b.code === 12153)
  }
  if (pending && b.data == null) return null
  if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) throw new WBError("WorkBuddy响应数据无效")
  return b.data
}
function loginHeaders(d: Login): Record<string, string> { const h = headers(); const cookie = Object.entries(d.cookies).map(([k,v]) => `${k}=${v}`).join("; "); if (cookie) h.Cookie = cookie; return h }
export function cancel(d: Login) { d.cancelled = true; if (d.timer != null) clearTimeout(d.timer); d.timer = undefined; d.wake?.(); d.wake = undefined; d.controller?.abort(); d.cookies = {}; d.state = ""; d.url = ""; flows.delete(d) }
export async function begin(valid: () => boolean): Promise<Login> {
  const d: Login = { url: "", state: "", expiresAt: Date.now() + 10 * 60000, cancelled: false, consumed: false, cookies: {}, ...(typeof AbortController === "function" ? { controller: new AbortController() } : {}) }; flows.add(d)
  try {
    active(d, valid)
    const b = await wire(AUTH, "/v2/plugin/auth/state?platform=CLI", "POST", loginHeaders(d), {}, d)
    active(d, valid); d.state = text(b.state, 4096)
    const url = text(b.authUrl, 8192)
    // Browser navigation only. Tokens never go to a server supplied host.
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*(?:tencent\.com|codebuddy\.cn|workbuddy\.cn)(?::443)?(?:[/?#]|$)/i.test(url)) throw new WBError("WorkBuddy授权地址不可信")
    d.url = url; return d
  } catch (e) { cancel(d); throw e }
}
async function wait(d: Login) { await new Promise<void>(resolve => { d.wake = resolve; d.timer = setTimeout(() => { d.timer = undefined; d.wake = undefined; resolve() }, 2000) }) }
export async function finish(d: Login, valid: () => boolean): Promise<void> {
  if (d.consumed) throw new WBError("WorkBuddy本次登录已结束")
  d.consumed = true
  try {
    let token: any = null
    while (!token) {
      active(d, valid)
      token = await wire(AUTH, "/v2/plugin/auth/token?state=" + encodeURIComponent(d.state), "GET", loginHeaders(d), undefined, d, true)
      active(d, valid)
      if (!token || !token.accessToken) { token = null; await wait(d) }
    }
    const access = text(token.accessToken), refresh = text(token.refreshToken), dom = domain(token.domain), expiresAt = tokenExpiry(token.expiresIn)
    // Access token belongs to the chosen CN profile; identity comes from the same auth flow.
    const h = loginHeaders(d); h.Authorization = "Bearer " + access; h["X-Domain"] = dom
    const info = await wire(AUTH, "/v2/plugin/login/account?state=" + encodeURIComponent(d.state), "GET", h, undefined, d)
    active(d, valid)
    if (info.enterpriseId || info.enterprise_id) throw new WBError("仅支持WorkBuddy国内个人账号，请使用个人身份登录")
    const uid = text(info.uid, 512), id = "workbuddy:cn:cli:" + encodeURIComponent(uid)
    const name = typeof info.nickname === "string" && info.nickname.trim() ? info.nickname.trim().slice(0, 512) : "WorkBuddy"
    const rows = credentials(), previous = rows.find(c => c.id === id)
    const credential = { id, uid, domain: dom, name: previous?.name || name, access, refresh, expiresAt }
    active(d, valid); persist([...rows.filter(c => c.id !== id), credential])
  } finally { cancel(d) }
}
async function refresh(c: Credential): Promise<Credential> {
  const key = c.id + ":" + c.refresh
  const existing = refreshing.get(key); if (existing) return existing
  const task = (async () => {
    if (!same(c)) throw new WBError("WorkBuddy账号已退出或登录已更新")
    let candidate = pendingRefresh.get(key)
    if (candidate && candidate.until <= Date.now()) throw new WBError("WorkBuddy轮换令牌未能保存且已过期，请重新登录", true)
    if (!candidate) {
      const b = await wire(AUTH, "/v2/plugin/auth/token/refresh", "POST", headers(c, true))
      const next: Credential = { ...c, access: text(b.accessToken), refresh: b.refreshToken == null ? c.refresh : text(b.refreshToken), expiresAt: tokenExpiry(b.expiresIn), domain: b.domain == null ? c.domain : domain(b.domain) }
      candidate = { credential: next, until: next.expiresAt || Date.now() + 300000 }; pendingRefresh.set(key, candidate)
    }
    const rows = credentials(); if (!same(c)) { pendingRefresh.delete(key); throw new WBError("WorkBuddy账号已退出或登录已更新") }
    persist(rows.map(x => x.id === c.id ? candidate!.credential : x)); pendingRefresh.delete(key); return candidate.credential
  })()
  refreshing.set(key, task); try { return await task } finally { refreshing.delete(key) }
}
function cnTime(v: any): string | null {
  if (typeof v !== "string" || !v.trim()) return null
  const raw = v.trim(), zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(raw) ? raw.replace(" ", "T") + "+08:00" : ""
  const ms = Date.parse(zoned); return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
function epoch(v: any): string | null { const n = number(v); if (n == null || n <= 0 || n > 8640000000000000) return null; return new Date(n).toISOString() }
export function unknown(error?: string): WorkBuddyCredits { return { remaining: null, capacity: null, used: null, reliable: false, status: "unknown", complete: false, fetchedAt: null, packages: [], ...(error ? { error } : {}) } }
export function parrot(s: any, old?: WorkBuddyCredits): WorkBuddyCredits {
  const current = snapshot(s)
  if (!current.reliable) {
    const error = !s ? "Parrot未提供WorkBuddy个人积分快照" : `Parrot WorkBuddy积分${current.status}，未可靠提供`
    return old?.reliable ? { ...old, checkin: current.checkin, currentStatus: current.status, error: error + "，显示此前快照" } : { ...current, error }
  }
  return current
}
export function snapshot(s: any): WorkBuddyCredits {
  if (!s || typeof s !== "object" || s.scope === "enterprise" || s.unit && s.unit !== "credits") return unknown("WorkBuddy个人积分快照未提供")
  const c = s.personalCredits ?? s.credits ?? {}, complete = s.complete === true
  if (c.scope === "enterprise" || c.unit && c.unit !== "credits") return unknown("WorkBuddy个人积分未提供")
  const remaining = number(c.remaining), capacity = number(c.capacity), used = number(c.used)
  const reliable = complete && s.status === "known" && c.reliable === true && remaining != null && (capacity == null || remaining <= capacity) && (used == null || capacity == null || Math.abs(capacity - remaining - used) <= 0.000001)
  const packages = Array.isArray(s.packages) ? s.packages.map((p: any) => ({ name: typeof p?.name === "string" ? p.name : "资源包", remaining: number(p?.remaining), capacity: number(p?.capacity), used: number(p?.used), expiresAt: cnTime(p?.expiresAt), cycleEnd: cnTime(p?.cycleEnd) })) : []
  return { checkin: workBuddyCheckin(s.checkin, s.checkin?.observedAt ?? s.checkin?.observed_at, s.errors?.checkin ? "Parrot签到查询失败" : undefined), remaining, capacity, used, reliable, complete, status: typeof s.status === "string" ? s.status : "unknown", fetchedAt: typeof s.fetchedAt === "number" && s.fetchedAt > 0 && s.fetchedAt <= 8640000000000000 ? s.fetchedAt : null, packages }
}
function normalize(p: any) {
  const prefix = ["Size", "Remain", "Used"].some(k => p["CycleCapacity" + k] !== undefined || p["CycleCapacity" + k + "Precise"] !== undefined) ? "CycleCapacity" : "Capacity"
  const val = (suffix: string) => number(Object.prototype.hasOwnProperty.call(p, prefix + suffix + "Precise") ? p[prefix + suffix + "Precise"] : p[prefix + suffix])
  const capacity = val("Size"), remaining = val("Remain"); let used = val("Used")
  const invalidPrecise = ["Size", "Remain", "Used"].some(k => Object.prototype.hasOwnProperty.call(p, prefix + k + "Precise") && val(k) == null)
  let reliable = remaining != null && !invalidPrecise && (capacity == null || remaining <= capacity)
  if (used == null && reliable && capacity != null) used = capacity - remaining!
  if (capacity != null && used != null && remaining != null && Math.abs(capacity - used - remaining) > 0.000001) reliable = false
  if (capacity != null && used != null && used > capacity) reliable = false
  return { name: typeof p.PackageName === "string" ? p.PackageName : "资源包", capacity, remaining, used, reliable, expiresAt: cnTime(p.PackageEndTime) ?? cnTime(p.EndTime) ?? epoch(p.DeductionEndTime), cycleEnd: cnTime(p.CycleEndTime) }
}
export async function read(c: Credential): Promise<Account | null> {
  const make = (credits: WorkBuddyCredits, readError?: string): Account => ({ id: c.id, name: c.name, provider: "workbuddy", enabled: true, available: true, fiveHour: emptyWindow(), sevenDay: emptyWindow(), resetCredits: null, credits, ...(readError ? { readError } : {}) })
  try {
    let token = c, refreshed = false
    if (!c.expiresAt || c.expiresAt - Date.now() <= 300000) { token = await refresh(c); refreshed = true }
    const date = (ms: number) => new Date(ms + 8 * 3600000).toISOString().slice(0,19).replace("T", " ")
    const begin = date(Date.now()), end = date(Date.now() + 365 * 101 * 86400000)
    const packages: ReturnType<typeof normalize>[] = [], pages = new Set<string>(), accountIds = new Set<string>(), deadline = Date.now() + 60000
    let count: number | null = null, complete = false
    for (let page = 1; page <= 50; page++) {
      if (Date.now() >= deadline) throw new WBError("WorkBuddy积分分页读取超时，保留此前快照")
      if (!same(token)) throw new WBError("WorkBuddy账号已退出或登录已更新")
      const body = { PageSize: 100, PageNumber: page, ProductCode: "p_tcaca", Status: [0,3], PackageEndTimeRangeBegin: begin, PackageEndTimeRangeEnd: end }
      let b: any
      try { b = await wire(BILLING, "/v2/billing/meter/get-user-resource", "POST", headers(token), body) }
      catch (e) { if (!(e instanceof WBError) || !e.invalid || refreshed) throw e; token = await refresh(token); refreshed = true; b = await wire(BILLING, "/v2/billing/meter/get-user-resource", "POST", headers(token), body) }
      if (!same(token)) throw new WBError("WorkBuddy账号已退出或登录已更新")
      if (Date.now() >= deadline) throw new WBError("WorkBuddy积分分页读取超时，保留此前快照")
      const response = b.Response
      if (!response?.Data || response.Error) throw new WBError("WorkBuddy积分响应结构无效")
      const data = response.Data, total = number(data.TotalCount)
      if (total == null || !Number.isInteger(total) || count != null && count !== total) throw new WBError("WorkBuddy积分分页总数无效或变化")
      count = total
      const rows = data.Accounts === null && total === 0 ? [] : data.Accounts
      if (!Array.isArray(rows) || rows.length > 100 || rows.some(p => !p || typeof p !== "object" || Array.isArray(p))) throw new WBError("WorkBuddy积分资源列表无效")
      const signature = JSON.stringify(rows); if (rows.length && pages.has(signature)) throw new WBError("WorkBuddy积分分页重复"); pages.add(signature)
      for (const p of rows) if (p.AccountId != null) { const id = String(p.AccountId); if (accountIds.has(id)) throw new WBError("WorkBuddy积分资源重复"); accountIds.add(id) }
      packages.push(...rows.map(normalize))
      if (packages.length >= count) { complete = packages.length === count; break }
      if (!rows.length || rows.length < 100) break
    }
    if (!complete) throw new WBError("WorkBuddy积分分页未完整，保留此前快照")
    const sum = (k: "remaining" | "capacity" | "used") => packages.length && packages.every(p => p[k] != null) ? packages.reduce((n,p) => n + p[k]!, 0) : null
    const reliable = packages.length > 0 && packages.every(p => p.reliable) && number(sum("remaining")) != null
    const credits: WorkBuddyCredits = { remaining: sum("remaining"), capacity: sum("capacity"), used: sum("used"), reliable, status: packages.length ? reliable ? "known" : "partial" : "empty", complete, fetchedAt: Date.now(), packages: packages.map(({ reliable, ...p }) => p) }
    // Read-only upstream queries. Never call checkin, claim_trial, payment or refresh-status actions.
    const started = Date.now()
    try {
      let status: any
      try { status = await wire(BILLING, "/v2/billing/meter/checkin-activity-status", "POST", headers(token), {}) }
      catch (e) {
        if (!(e instanceof WBError) || !e.message.includes("HTTP 404")) throw e
        status = await wire(BILLING, "/v2/billing/meter/checkin-status", "POST", headers(token), {})
      }
      const observed = Date.now()
      credits.checkin = workBuddyCheckin(status, observed, workBuddyDay(started) !== workBuddyDay(observed) ? "查询跨越北京时间日期边界" : undefined)
    } catch { credits.checkin = workBuddyCheckin(null, null, "WorkBuddy签到查询失败") }
    if (!same(token)) return null
    const previous = officialCached()?.accounts.find(a => a.id === c.id)?.credits
    if (!reliable && previous?.reliable) return make({ ...previous, checkin: credits.checkin, currentStatus: credits.status, error: `本次${credits.status}，显示此前快照` }, "WorkBuddy本次积分未可靠提供")
    return make(credits)
  } catch (e) {
    if (!credentials().some(x => x.id === c.id)) return null
    const error = e instanceof WBError ? e.invalid && !e.message.includes("重新登录") ? `WorkBuddy凭据失效，请重新登录（${e.message}）` : e.message : "WorkBuddy积分读取失败，请重试"
    const previous = officialCached()?.accounts.find(a => a.id === c.id)?.credits
    const a = make(previous ? { ...previous, checkin: workBuddyCheckin(null, null, "本次读取失败"), error } : { ...unknown(error), checkin: workBuddyCheckin(null, null, "本次读取失败") }, error)
    if (e instanceof WBError && e.invalid) a.available = false
    return a
  }
}
}
export const beginWorkBuddyLogin = WorkBuddyCN.begin
export const finishWorkBuddyLogin = WorkBuddyCN.finish
export const cancelWorkBuddyLogin = WorkBuddyCN.cancel
export const mapWorkBuddySnapshot = WorkBuddyCN.snapshot

// Original WorkBuddy favicon source: assets/workbuddy-original.svg (not loaded at runtime).
// https://assets.workbuddy.cn/web/workbuddy/f4728a12fe9cfe5a34da6b2fa827614041c84386/assets/logo.svg

// Offline 120px raster of assets/workbuddy-original.svg (librsvg/rsvg-convert).
// The two muted variants preserve the existing zero-credit gray palettes and original geometry.
const WB_PNG_ORIGINAL = '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'
const WB_PNG_LIGHT = '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'
const WB_PNG_DARK = 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAABmJLR0QA/wD/AP+gvaeTAAAfNUlEQVR4nO1deVAc15n/vZ4eGAaBhDgkcSMQSEKAbgQCXXasKPERZ5PsJps4a6dSjtc2FpLJvbvskU1tLIGMpNpSKtlskt1UfGQdr23ZcmJZsmQwAgl0gAALnSB0cA5iOGam3/7R09P3TM8wA0jaX9XU9Ot+x9f96+/73t0E9wCqqqoiKGWzAZJNCM0BSA5AkgAuFiCxhMBKKcIBWN1J7IRgnFLYAdoHMH0A7aYUbQA6ANoxPBzVXln55Ng03lZQQKZbAH9BKSXV1fuXEkK3UIrNAFkB0FQATJCL4gByFaCnAPohx+Hwiy+WtQa5jJDjriB4z5498yhlHwPoFkqxCcC8aRLlJoAPKaWHOc78ZkXFM7emSQ7DmLEE19TUhDudeIgQ8g1K8QUA5umWSQEXeLJ/O2tW+OtPP/20fboF0sKMI3jPnn2FHEe/BeDLAOZMtzwGMQjgVYZhfrF9+7MN0y2MFDOG4F279pcwDPc9AA9PtyyTxMcA/bcdO8remm5BgBlAcHV1zYOUkn8GsG66ZQkymijFT3fseO51QgidLiGmjeDq6r3rKcVeACumS4apACHkJIDny8ufq5uW8qe6wKqqqrlA2D8A9DkEv2kzYxAfH4fFi7NhNptx8+Yt2tl58RWnc6ysrKzs9lTKYZqqgiilJDo69glCmLcAbMYMcA+hQlpaCjZsKEFMzBxERc3C/PnzSEZG+rLBQdt3iotL7UVFhQ1HjhyZErM9JQ951659aQyD3wG0eCrKm04kJSViw4b1YBjeOBEiPmJKKRobT6Gjo+M4w9C/fuGFF66GWp6Qa3BVVc0jhOBdANmhLmu6ERU1C1u2bATLsiCEyMgVwklJiaAUqTdu3H7qs5/dduHQoXdD2jsWMg2urKxko6Jif0wI/g73sK8VYDKZsHXrA4iJiZERC0BBNP/f3HwWZ86cowDZa7P1VlRWVk6EQq6QELx79/4UQrjXAawNRf4zEfn5y5Cfv0x2Tk205wgA0Nh4Cq2tbQDwCcvSL5eVlXUFW66ga1Z19f4lhHAf4z4iNzo6Grm5SzxhtXkWyCWQ6tTq1SuRmbkQANa5XKS+qmpvXrBlCyrBVVU1ayl1fQQgJZj5znSsXbsKJpPJMLFCPEIIiosLkZAQD0qRSAiOVlfvXR9M2YJGcHV1zYMA+QAgccHK825AcnIS5s+fp2OOtYmVxjGZGGzevAGRkVZQihhK8f7u3fs+Fyz5gkJwVdXer1FK3gUwKxj53S0ghGDFigIvWiuPqx2HwGqNwKZNG2AymQDASgj9Y1XVvr8KhoyTJri6uubzAH4NgJ28OHcXFi5Mx5w5swH4Nsdi2HMkCRMkJMRj3TpPtcUM0N8EQ5MnRfCePfsKKSWv4D4klxCC3NwlfhErjael6dnZWVi8OEcImgmhr0/WJwdMcFXVvlyOowcBRE5GgLsVqakpHu0NnFh1unXr1iAhIV44HUEp3qyu3i9W0f1EQAS//PLLqQB9D8DcQAu+27Fs2VJokSQe+0esAJOJwaZNpTCbPRNYYinlDtXU1CQHIqffBB84cMDscjG/BxBQgfcCkpISERsrvtvG/KwY1ksjvABRUVFYt26NtMgUp5P8obKyMsxfWf0m2G4f/xmAIn/T3UvIy8sFMDlzLIVWmpycbGRkpEmjrY2OjvsXf2X1i+Dq6prPU0pe8LeQewnz5iVg3ryEoJhjZUVLqumEACUlxYiIiJCUTl+sqtr3mD/yGiZ49+79KZSSX8skvg/B+14RkydWnU6IarFYUFoqG2ElhNBf7dq1T6ba3mCI4MrKSoYQ+nsAsUYzvhcxa1YkkpISAXjXPs9RAMQqX5C0tFRp0wmUIoYQ+htKqSFFM0RwVNTcb98Pg/W+kJ2dBYYhhrVWCqX5NZYH/ysqWgOr1So9v2HPnr1PGpHZJ8H79u2LJQR+O/d7DQzDICsrE8Ewx+4rnut6xArnw8LCsHbtKpk8lJKf7dp1wGe/v0+CJyboS7jPBhC0kJqaAqvVGlQ/q91n7TmSxcnJWYR58xKkUWNNJodPxfNKsLub7G98ZXI/ICdnkaafBTAJYv3RdILS0mJZWZTSb1dX7/PaZNUlmFJK3POW7+taMwBER0dhwYL5MKK17iNJ2H9i9cJxcXFYunSxVDSG47iXvcmuO+lu9uzYRwCyw1vi+wUFBXlISBDNo78DCdo1bP80XQjPnz8fbW3tcDqdgixJW7c+XH/o0MELWrJ7MdHM9w0/gXsYJpPJXbkKTrNHSOc+koR95cEjPDwcq1evVEjJ/b2e/JoE796974H/bxbxSE9PRXh4eMj8rDdNl7e0xDS5uUskI1kAgKKqqpqNWvJrEkwIfuTzzu8TLFqUZcDP8uFg+FktrVVqOsOYUFgoG4wAIUSTMxXBe/bsKwToZh/3fV9g1qxId+XKGEk8gk2stqZnZi5EaWkxIiP54XhK8Zk9e/bLWYfGTAz34uv7GizLIiUlCYsX54BhhCfuy4zKmPGp6drXvOctjUcIX/nLzV2Kc+da0dBwEuPj408BaFDn5EZl5a8s0dF3enD3rKwPGkwmE5KTk5CZmYGUlGT3NFggmMR6DxuNA6i7QQlGR8dw4sRJ++jocPwjjzzi2U5CpsFRUXcew31ELiH8ZLeMjDQsXJgBi8XiPu+J4SUcTGK14xkhVkBEhAUbN5ZYW1pa/wHA94TzrDwBvqEs9l6ExWJxT3DLxqxZ4kxff0mSpwsesVrxlAvZ9PKYOzfm65AQ7In50kv/nmAyObsw83azCRpiY2ORk7MIWVkLwbLiuz05Yn2lCx6xWmFlOo7j0NTUmlNYuLwDkGgwy7q+QOm9SW5ychJWrMhHXFycxgPzHE2Rn/VVllCGf8QKMJlMsFrZHwH4JiAz0XSLUoy7HYmJC7Bq1XKfxBoJB5ImsNpxYMRK482ePfsB4ZgBPAMLm5Ti3K1ISkrEY499Hlu3Poj4+HhVR4U/bVNpOvdRkNqz6njeydVPo/TPCQnxiY2NjVbArcG7dtXkmkzMdG0PGDRER0dj1arlSE/npyz5M5U1GOZ4qvysrzRhYWEEMH0NwC9YAGBZZjOdtp2cJg+WZZGXl4v8/GVgGMagOQ69n9UvSyhj8uZYGRaOIyMjH4NAML9r692J9PRUrFu3FhEREfeVn/UVjoqKXAmIlSzl+NOMh9VqRVHRWqSmpgSFWP14wSF2fHwct271wm63Y2TEjpGREbhcHMLCzDCZTAgPD8OcOXOQkBCHqKgohVzGiRUQHR2VAACkqqoqAjDfwV20UUpOziKsWbMKZrN5yv2sPKwfh1KKrq5uz6+3tw/UoB+0WCyYP38eFi3KRGZmBsLDw91l+CZWAKUUR4+ejmEpZbMJuTvItVgsKCkpQkpKsl9aOzV+lg+Pj4/j7NlzaG1tw507I4buS4mxsTFcvnwFly9fweHDJqSnp2L58gKkpCS5y9Mn1iMJIYiKwiaWECYHmPk1rOTkJJSUFMnmBwMzx886HBNoajqDM2fOYWIieDsiuVwudHZeQmfnJaSmJqO4eJ1nCNMXzGZ2PUsIzZnJNWh+m4R8FBTkh9wcB0IspRzOn2/DiRONsNtHDd9XILh6tQtXr76OnJxsPPDARo/p1kNYWHgBS+nM3YEuPDwcGzeWIDk5SXbeWOUn9H62u7sbx4/Xoa+v3+AdBQft7R3o6enBtm0PITFxgW48q9WykMUMXec7Z85sfOYzW2Q1SmOkhN7PDg4Oora2HpcvXzF+Q0GGzTaM1157A+vXr9OYhMcjPDwshsUMXFC2YMF8bNmyUVJ7FK4EorXBI3ZiYhwNDadw9mwLOI7z76ZCAI7jcOxYLSYmHCguLlRdN5vNESw0tmFgWRZWqxUsa/Js8OVyueBwOMFxHByOCXAchcPhCLrQWVmZKCkpcvdICWdDYY7997P19Q0YHZ15n1Kqr28Ax7lQUiKfCBsWFh7GAphltUYgKSkRCxYsQEJCnKF2FyEApXyV3m4fxejoGEZH7bDbR93hUYyMjGB4eBhOp8uQoMuX52PlyuWe/N0lTZGf1S7r+vUeHDtWi76+PkP3MF1oaDgFszkMhYWrPefMZpZh8/OXWXNzl3j2Nwa8E8uHxfMRERGeVehatVxKgZGREdhsNgwNDWNoaAhDQzYMDdlgt9s96davX4fsbPX6n+lq9gwPD6O29hN0dl5SRp6xqKurx7x5CUhPTwUAMIyJkJs3b3Fw36FRYtWaY0ST1GkcDgeGhmwAgPj4WI00+mGtsoJBrNPpwMmTzWhuPm3Y8qjLDy74ZqzvtiwhBJGRVjzxxNdgsVhAKYWHYG9zfiZHrPd0U9G9aIRYgKKj4wLq6up99ECFjkgjMEL2kiU52LbtIVBKwVJKKSNO/tUhLfjE6qcLvZ9VlnX79m0cO1aLnp4bsnjTSaQetPhQkn7+fDuWLl2MxMQFINev9zhZljUForXBJdZ7PqHws3b7CE6cOInW1jbPQICRft6ZDIHs2Ni5+PKXv0hZl8vlNJvNnmWkwTTHM3UYz+Vy4vTps2hsbILD4QQhdz+xAoRn09c3gKam5iHW6XSOAQi/2/2sPKwf5+LFS/j4409gsw27iUVQwFuA4Jp1YYwgkDwJAU6ebL7MTkw47hAC91rEwLUvkHRT42f5cH9/P44dq0VX1/VJE0upOn0oLIAyS8H8Gi2LUu42OzDQ3xUbO1fWm++tohVKP+urrECIHR8fQ0PDKZw71wqO4wIiVqmd02XNpc9G6yXTSNHD9vTcPJGVlVXIZzDT/CwfDoRYoXuxrq4B4+P+dy9KH6B/2kn49uekLQSBt+aQNH89sp1OVzt79Wr38fHx8eeFhVfyxIFo7fT72e7ubhw7Vov+/gH4A54YvZdICT0CJkeuWLYyb33ChfKUJpwQrp2llLZdu9aNRYsyQ9zsCb2fHRwcxMcff4LLl68afshyUr0l4i2JOK/KV8+S3v0K5WpK401SRd7quMJzFjSaELaN5bixTzs7L3LZ2ZmMkHhq/Kx2WYEQ63A40Nx8BidPNhn2swKxvsyvaP6oDimiTPKHLo8c6KwZQohG75VwrE80peCGhyM7CQBUVe29/Pjjj6bNnh09A5o9/vhZio6OT1Fb+4nhYTypxurDm/9TarIsd1k8hmGQnp6KefMSwDAMBgYGcenSZYyNqWWVZ6fUVveRJtk6UhJysbz8uUxhXvTJzs6LaatWLYc3YvmwWPDU+Fntsnp6+GG827d7/Wg2GK0wefN/VPGQRdmkG8Cmp6fiwQc3q+Y4O50uNDQ0or6+0cs0WrkyCeXJo6tfQv4F4M9xHHcGcE98JwRHLlzo/OLKleI3gGZy92Jd3Qm0tXVoyqkF0RxrXdXTVjmp4r+gwWJmwoMX/hcvXoRt2x7SlI1lTSgqKkR0dDTef/8DHXk9RxCfJ1GcoyqNFl8YAkLoccBNMKXksN0+iq6u60hNlX+VLrjmOHBiXS6Xu3vxlGcmiTFy9eIJBOppgT6plGr3MhHC78zz4IObfcqWm7sE16514fz5dk+eQvmESH2ssnYsugh9v07hcjHHAfdqhvLyZ1sB3GhpOS8TViQlNJt9idfEc1p5d3V145VX/oC6unrD5IqDB/oPQQ7hYYrnpXJLSVXep/R8Xt4yhIUZ+3ZGael6hIWFQ37P6soZf00ph9c9PGzR0eZTgJtgwr8yR3p6bqC3t8+L9gV3sy+FeKqyRkZG8M477+HNN9/GwMCA5yaM1Xz1tFbvnKi1ok9Vkyqcl5Tm0SwAntUHRhAZaXXvA603gY/IiPUmG++jPSf+/PTTTzsAyXokSulhADhz5hyMaJ/nKABifWstcP58G373u1dlU1ONVqaMaS1RnVNriTapUkLFPPgI8o9o+MbKlQWYM0dvYyMOQuVKra1yuaTPhlL6nnDsIZjjzG8CcFy5chU2m82w1rqPVOHAiOV97YcfHsXhw0dlS0CMmmT1eeUZQSuUplhLW5X3qtZ2JYR5ZkZhMpmwYUOJTA6xDOVzlcskXFNo88T4OP4oBDwEV1Q8cwvAIUopzp5twWTNsVQYI8QSArhcTrz99rvCV7El5fkmVy+OumzBlFEZseomCCCvxQL6plRMd+WK/x/xzszMQGpqikcOwceq5RdkkoQU2k0p3vvhD8tuC2HFqkLyWwD49NNOjI6OIhh+Vuvt09J0p9OFd945hO7u63KJJkGuOh+p5hENU6xFrNqsS+WXN2lowIvPNm0q9cxslVa25PPr1RVD5a0zDP2tLCwN2GyR/wtg0OVyoanptDyroPtZUTiXi8PBg4fQ1dWtMLXBIJd44qo1Umme9YiVg3/oFHKN5tONjY3ixIlGHzKpERs7F/n5y3TqD9Sj1WozLpGAkEGTCW9Jz8kIrqx8cgzAqwDQ1tbh8cXeKlqBEiuNV1dXj2vXulR+1Bt3gXQ5Kmuk0mMxK7kZVvtnaRtVu/Pk1KnTGBgY9CGbGkVFhYiIEEb15M9X0Gr9FTMEAH21rKxsXHpWtfCbYZhfAPy6l8bGJvgmyT8/K41HCMG1a104ffqsjsDaMEKu1niqYJKVcsvzkhMnPFC53Joleo5cLieOHfvYq3xasFjCpR+J1ixDLYdocVwunjspVARv3/5sA0A/APj5S319/ZP2s/Iw/0AJIbDbR/GnP33Ii0ep4rr2LQqzK7yDqKyBmLcgk3hd3blBPb1WajmULwMg+F9pkZ2dl3DlylUfcqpRUJCH2FhhEYD6BZX2hVMq7fWif37xxWdlWwkDOvtyUEp/4v5HQ0MjJutnleQK4Bdzjfrld72RL6ZXPhgpmYCWL+bzlvYxq18Qtf8TfaP8On9w9Ohxv1chEkKwcaPw0W8ik1durgkAzmNhXC7XT7Ty0yR4584XPgTwMcCvKr9+vcdT4GSIlZI7NGTz9MMahe9NTERyRd8pmnN5t586L/5hcTLS5OUDSlK1ZeDR29vn7jjyD2lpqYqPYGnLK3nO9RUV5Ue08tLdfIUQ+lPhWKgVapkrf4kVwidONPr1dmv5XTXfSk2FomzBD3s339JmijRvrbay+pnIXU1d3QnN8V9f4Hfrk1srvblXHMf9k14+ugRv3/78QULISQC4efMWLly4KLmqrEHq+1mtsM02jI4Ozc/8+DC/gccV5CSEKojUzkTMWz1q462poow7NjaG2toT/gqKqKhZqryFF1TxIjfu3PnCQb18vGgwoYSQZ+BuN3zyyQn3arvJb6rZ0XHBo0VG/K/Rzgxp75Q6D/46pcKcJeoxyUJabTmUvo9RaLjQYaIv+9mz59Db69/64okJcXG90uLwZVEAhGMYbPeWj+6XzwDgvfcOXt+69XOpAFZOTDhgNpuRmCh+4s2oOZbEAAAcPXoMdruycqV+MYSb0zLNwinxmjgATik/sL54cQ4KC1djzZpVyMnJwpw5c2CzDWNiYhwcx5PM10RF2QQtlw7iK8WSto315JDGpRQYHBxSfpbOK06dakZ/f79OTxt/bDLhP8rLn9/vLR/VV1fUcHwXYB8DSNypU81YsiTb8ykX8Sa8aawoGCFAf/+A5ttsfO6xtGkgfbtFcmNjY/Dww9sQGyvfnSI1NQWrV6/ARx/V4vTp0xJypXJy4Dj1JHfxRaOy6+6rqntV1gGuXr2GCxcuIitroc87tNls6OyUu0S+fAreglBQSgYYhvuBr7x87nC3Y8eOfkrxQwBwOByor5d3w/nWWLmmC33NynavFrRNs1Y60TRHRUXiS1/6gopcASzLYsuWDcjLU3YL8uRKNVo9RCiHUnuV47NKfPDBEdy5c0dTLgEulwvvv3/YUwGV1nPktX/uB2Vl4qCCHgxtYTg83P9LYY5Pe/un7oLV5lgObRPujy8yPmtD1N7S0vUqC6OFTZtKER0tnRDHKcy11J9LK1rqdri6G1Nbdrvdjlde+R/FOmQRIyMjeOONt9zdtuJ5ISverQCU0todO57/uc+bhCETDVRWVnI1NTVfdTppk8lkivNFrFQoZbxbt3y+dLpQ+jxhAEGo4Fgs4Vi0KNNQXizLorR0Pd555z0QApnZlS89oQqt5lTtajEOUWixGjabDa+88gekpqYgIyMNkZGRmJiYQHf3dXR0fCrZNoI3x8p2PUAGGcb5DSL1U97u00gkACgrK+vavXvfN81m9m0AxF9iBRjdFU7LPMvbhGrtjY+Pg8nktd4oQ3Z2FpqbE9Hdfd3t34jiJZISz5twJbmCnFrE6nWoUEpx5cpV9woMMY6Yl/DPKZ4BoU4nnq6oKL+oylQHfu0yu3PncwctFssBX35WuDmlprtcLs93b/2F/oC8kD9fc/YXmzaVuh+m/AXlyYVMc+U1bXk+ykoZLzPns/dNbC6KyiD9V0xG2FtR8dyr/tyf39sIp6Ullff3DwzxIbXWemsqCeQaqWApoV1rlT+AwcFhw/chICEhHsuWLZWZZF5GeWeHfM4TJ4kjPS/8U881KUnKn1wppMOQ8vt2t7+bbLbeCn/vz2+CN2/ePHb58qUH7Xa7U0trpcfKsMPhNFx71oe8jSn9HxjQboL5QnHxOoSHC1NdRS1ViiF0cwqkCW1cSQwZ6dI2rNZPmaeQh5JkSsn1iQn2C5WVlX5PFQloI/DCwsLGS5cuPTw+Ps7xN+C9Ri0X3nPWaxlaHSRyaHchKptxRmC1Rri/xytqr1prBWLEGrZUy5WrJwQS9d5VUYvllTP1aBcd5Djntu9//2n/xx4xiW38ly9ffqitreNbTqdTbEB4Mc8AYLVGSq7p5+3NbKubKHLT1t7+Kbq6uo3cggzLl+cjJmauonxlF6HcNQgESitHUqLkZp7IfuILQD1huVWgoBRjhJj/oqJi+xm/b8iNSW3lv2rViv88f779e/ySTX1iBbCsCRaLxYff1dZWz5Gk9iyNL13JcOTIMZ+VGyX46avrNTRIrr3yFROCNouVIqUGi6ZeaNJRD6liZU3MU1I7dwL4enn5M4f9uhEFJv2thhUrCl5qbe2oEUj2VWmSfu0zGNAqrre3F+fOtfqd18KF6cjISHOH5O5Eex8t2aiO7F9IpxwAEUezpETL/TWl1EkI+c7Onc//we+bUCAoH+MoKMh9oaXl/I8cDqdPtYmL0+5C9A/qYkSN4h9Wbe0nGB8fV8XzhY0bS0CI/LFo9ylIK2Nao1jSaUNU8hPlF0207HiUYfDVHTue/6XfwmsgaF9bKSjI+9eWltYnx8bGvI7iK7fnDxXs9tGAKlxz58YgLy9X44p6npc3N6C+RhQ/5TWAEMbmcjkfLS8ve91PsXUR1M/prFhR8OuWlrZHR0ZGdHszUlJC/wUBwQQ2N58JaPrqypX5khCV+WDpeV7TtYcH5U0hdVtY3odAAdAehnGWVlSU/9lvgb0g6N9LWr16xTutra3Fvb29mr0OMTFzguCH1Y5XrMiID5DjXDh69LjfucfExEg+3yPWcNVaKZ/vJfzLe7O028CK9b1NHMcUbd8eeG1ZDyH5INbatWsbzp07l9DefuGolhnLyVk06TK0KzVqoi9duhLQxzMsFn7drtRHSmvRyvKl/lQqi16d050fBcivkpPnrXvxxef8F9IAQvbFs82bN48tXrxoU0tL24+FDhEBeXlL/cxNqxNF2lwRz/P/clMayPTVkRE7lOZXyF+oVEn/5bLpd3BIMEgp/csdO5576itf+UrwvqSlQMg/aZeXt/QnTU3nim/duj0knIuJiUFWlt6wntH2q96sCnl6QoC+vgGd1RPauHHjpqoGrt3FSmRhaW1ab/qRe4jzBCHsip07n3/NsFABYkq+WVhUtLo+ISF+bktL689HR/ladnHxWp9tZi140wxlv7BwjhB+0qDRbwlKa9+iCWZkJEuHC7Vl0WrKMUMMQ35ss/UXlZc/c9mQMJOE/094kjh6tD4jOTnhjYyMtIJ33/0T2ts7QlAK38EgBaVAcvICPP74ozCbzbopT55swkcf1cLXxDtpvvIRIXXHhfvCG04n8+x3v/us9nSOEGHKCRZw6lTzUzExMbveeutgjNYYsfepsgKB8pmUygEArZGZ+Pg4bNmyUfVJuJERO+rq6nHmTIusG1KURyt/qK5L5efdCGkGmLIdO/72mLfnESpMG8ECDhz49ebR0eEfcRx9QHre+MJurY59QEkQH48/Rynfo5aQEA+WZTEwMIQbN3rc02WkU3TU8EW0AI6jJxmG+Vl5+bOvGZ1eEwpMO8ECdu3aX8Ky9HscRx8GfBMsnZOl1GJ5HHEmBiHQmA8tja/uS1Z2QypfKI12byPg+sedO7e/HdiTCC5mDMEC9uzZvwbAtyjlvkIpYqTX9EgXiVH7XndKqEeHAtVUdV4MQwYB/NHpdPy8oqK8ztCNThFmHMECampqwjmObOU4+g2APApAtbuYdy0WyNYm3RfJ3gbr3XABqOU47r8SEmL++4knngjsc98hxowlWIpduw7EmUyOL3Ic/SwheABAtJF0arL1rnvNRfIS0GFK6VGGMb1nMnGvGpl4Pt24KwiW4sCBA+axMecap9NZDJASQkg+gDT4bNOrSZZWvKRwT6VxUUq7TCacdThILaUTx+12W11lZWVg00KnCXcdwVrgzTmbA7hyOI7mAMgGkEwIE8txNJYQRBJCWEoxyz0AfwegTkrJCKW0n2HQx3FMN8PQTykl7ZRy54eH+9srKytn3rdk/cT/ARKKm46SCBVNAAAAAElFTkSuQmCC'
let workBuddyOriginalImage: UIImage | null = null
let workBuddyMutedImages: { light: UIImage; dark: UIImage } | null = null
export function workBuddyBrandImage(muted = false): UIImage | { light: UIImage; dark: UIImage } {
  // Documented UIImage.fromBase64String + Image(image, renderingMode="original"). No disk writes/network.
  const decode = (base64: string): UIImage => {
    const image = UIImage.fromBase64String(base64)
    if (!image) throw new Error("WorkBuddy官方图标PNG解码失败，请更新Scripting")
    return image
  }
  if (muted) return workBuddyMutedImages ?? (workBuddyMutedImages = { light: decode(WB_PNG_LIGHT), dark: decode(WB_PNG_DARK) })
  return workBuddyOriginalImage ?? (workBuddyOriginalImage = decode(WB_PNG_ORIGINAL))
}

export type AntigravityQuota = {
  tier: string | null; creditAmount: number | null; minimumCreditAmount: number | null;
  groups: { name: string; buckets: { name: string; window: string; remainingPercent: number | null; resetsAt: string | null }[] }[]
}
export type AntigravityMode = "summary" | "gemini" | "claude_gpt"
export const ANTIGRAVITY_MODES = [
  { value: "summary", label: "两个分组最低剩余额度汇总" },
  { value: "gemini", label: "Gemini Models" },
  { value: "claude_gpt", label: "Claude and GPT models" },
] as const
// The verified public parser exposes displayName, not a stable provider group ID.
// Match these real group names exactly (after whitespace trimming), never their order.
const AG_GROUP_NAMES = { gemini: "Gemini Models", claude_gpt: "Claude and GPT models" }
const agModeKey = (source: DataSource) => `ai_usage_antigravity_mode_${source}_v1`
function isAntigravityMode(value: any): value is AntigravityMode { return value === "summary" || value === "gemini" || value === "claude_gpt" }
export function getAntigravityMode(id: string, source: DataSource = getSource()): AntigravityMode {
  const modes = Storage.get<Record<string, AntigravityMode>>(agModeKey(source)) ?? {}
  return Object.prototype.hasOwnProperty.call(modes, id) && isAntigravityMode(modes[id]) ? modes[id] : "summary"
}
export function saveAntigravityMode(id: string, mode: AntigravityMode, source: DataSource = getSource()) {
  if (!isAntigravityMode(mode)) return
  const modes = { ...(Storage.get<Record<string, AntigravityMode>>(agModeKey(source)) ?? {}) }
  if (mode === "summary") delete modes[id] // Default is backwards-compatible and needs no stored override.
  else Object.defineProperty(modes, id, { value: mode, enumerable: true, configurable: true, writable: true })
  if (Object.keys(modes).length) Storage.set(agModeKey(source), modes)
  else Storage.remove(agModeKey(source))
}
const AG_LOCAL_WIDGET_UNTIL = "ai_usage_antigravity_local_widget_until_v1"
export function requestAntigravityWidgetProjection() {
  if (getSource() === "official") Storage.set(AG_LOCAL_WIDGET_UNTIL, Date.now() + getRefreshMinutes() * 60000)
}
// Widget.reloadAll starts widget scripts too. During this explicit local-only reload,
// every widget instance uses cached quota/statistics until its next scheduled refresh.
// Manual App/intent refresh still calls loadUsage directly and is never suppressed.
export function cachedAntigravityWidgetProjection(): LoadResult | null {
  const until = Storage.get<number>(AG_LOCAL_WIDGET_UNTIL)
  if (getSource() !== "official" || typeof until !== "number" || !Number.isFinite(until) || Date.now() >= until) return null
  const cache = officialCached() ?? { today: null, month: null, todayByFamily: {}, monthByFamily: {}, accounts: managementAccounts(), fetchedAt: 0 }
  const statisticsSource = getStatisticsSource()
  const stats = Storage.get<ParrotStats>(statisticsSource === "sub2api" ? KEY_SUB_STATS : KEY_STATS) ?? (statisticsSource === "parrot" ? Storage.get<UsageData>(KEY_CACHE) : null)
  return { data: { ...cache, today: stats?.today ?? null, month: stats?.month ?? null, todayByFamily: stats?.todayByFamily ?? {}, monthByFamily: stats?.monthByFamily ?? {},
    statistics: { fetchedAt: stats?.fetchedAt ?? null, stale: true, error: stats?.today && stats?.month ? null : `${statisticsSource === "parrot" ? "Parrot" : "Sub2API"}统计缓存未提供` } }, stale: true, error: null }
}
function antigravityWindows(groups: AntigravityQuota["groups"]): Pick<Account, "fiveHour" | "sevenDay"> {
  const window = (name: string): QuotaWindow => {
    const buckets = groups.flatMap(g => g.buckets).filter(b => b.window === name && typeof b.remainingPercent === "number" && Number.isFinite(b.remainingPercent) && b.remainingPercent >= 0 && b.remainingPercent <= 100)
    // Strict comparison retains the original response order on equal remaining quota.
    const worst = buckets.reduce<(typeof buckets)[number] | null>((a, b) => !a || b.remainingPercent! < a.remainingPercent! ? b : a, null)
    return worst ? { remainingPercent: worst.remainingPercent, usedPercent: 100 - worst.remainingPercent!, resetsAt: worst.resetsAt } : emptyWindow()
  }
  return { fiveHour: window("5h"), sevenDay: window("weekly") }
}
export function projectAntigravityAccount(account: Account, source: DataSource = getSource()): Account {
  if (account.provider !== "antigravity" || source !== "official") return account
  const mode = getAntigravityMode(account.id, source), groups = account.antigravity?.groups ?? []
  if (mode === "summary" && !groups.length) return account // Older snapshots retain their standard windows.
  const selected = mode === "summary" ? groups : groups.filter(g => g.name.trim() === AG_GROUP_NAMES[mode])
  return { ...account, ...antigravityWindows(selected) } // All original groups stay intact, even when selection is missing.
}
export function antigravityModeHint(account: Account, source: DataSource = getSource()): string {
  if (source === "parrot") return "Parrot管理接口未公开真实分组明细，不支持分组切换；保留管理接口标准窗口。"
  if (source === "sub2api") return "Sub2API当前提供的是模型额度，不是真实两个分组，不支持分组切换；保留原有窗口。"
  const mode = getAntigravityMode(account.id, source), groups = account.antigravity?.groups ?? []
  if (mode !== "summary" && !groups.some(g => g.name.trim() === AG_GROUP_NAMES[mode])) return `所选 ${AG_GROUP_NAMES[mode]} 分组未提供，5 h／7 d 均为未知；保留选择，不回退另一组。`
  return mode === "summary" ? "按各窗口最低剩余额度汇总，并采用对应重置时间；未提供真实分组的旧缓存沿用标准窗口。" : `仅显示 ${AG_GROUP_NAMES[mode]}；缺少的窗口为未知，不回退另一组。`
}
function agNumber(v: any): number | null {
  if (typeof v !== "number" && (typeof v !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim()))) return null
  const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null
}
function agTime(v: any): string | null { return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null }
export function mapAntigravityQuota(load: any, summary: any): Pick<Account, "fiveHour" | "sevenDay" | "antigravity"> {
  const paid = load?.paidTier, credit = (Array.isArray(paid?.availableCredits) ? paid.availableCredits : []).find((c: any) => c?.creditType === "GOOGLE_ONE_AI")
  const groups: AntigravityQuota["groups"] = []
  const raw = [...(Array.isArray(summary?.groups) ? summary.groups : []), ...(Array.isArray(summary?.buckets) ? [{ buckets: summary.buckets }] : [])]
  for (const g of raw) {
    if (!Array.isArray(g?.buckets)) continue
    groups.push({ name: typeof g.displayName === "string" ? g.displayName : "?", buckets: g.buckets.filter((b: any) => b && typeof b === "object").map((b: any) => {
      const fraction = agNumber(b.remainingFraction)
      return { name: String(b.displayName || b.bucketId || "?"), window: typeof b.window === "string" ? b.window : "", remainingPercent: fraction != null && fraction <= 1 ? fraction * 100 : null, resetsAt: agTime(b.resetTime) }
    }) })
  }
  const windows = antigravityWindows(groups)
  const tier = [paid?.name, load?.currentTier?.name, paid?.id, load?.currentTier?.id].find(v => typeof v === "string" && v.trim())
  return { ...windows, antigravity: { tier: tier?.trim() ?? null,
    creditAmount: agNumber(credit?.creditAmount), minimumCreditAmount: agNumber(credit?.minimumCreditAmountForUsage), groups } }
}
// Sub2API @3a6fd1c9: five_hour is a selected-model compatibility projection, not
// a declared 5h window. Preserve model quotas in details, never invent durations.
export function mapSub2Antigravity(row: any, usage: any): Account {
  const credits = (Array.isArray(usage?.ai_credits) ? usage.ai_credits : []).find((c: any) => c?.credit_type === "GOOGLE_ONE_AI")
  const groups: AntigravityQuota["groups"] = Object.entries(usage?.antigravity_quota ?? {}).map(([id, value]: [string, any]) => {
    const used = agNumber(value?.utilization)
    return { name: String(usage?.antigravity_quota_details?.[id]?.display_name || id), buckets: [{ name: id, window: "model", remainingPercent: used != null && used <= 100 ? 100 - used : null, resetsAt: agTime(value?.reset_time) }] }
  })
  return { id: `sub2api:${row.id}`, name: String(row.name ?? row.id), provider: "antigravity", enabled: row.status !== "disabled", available: row.status === "active" && row.schedulable !== false && usage?.is_forbidden !== true,
    fiveHour: emptyWindow(), sevenDay: emptyWindow(), resetCredits: null, antigravity: { tier: typeof usage?.subscription_tier_raw === "string" ? usage.subscription_tier_raw : null, creditAmount: agNumber(credits?.amount), minimumCreditAmount: agNumber(credits?.minimum_balance), groups } }
}
// Public installed-client protocol from Parrot oauth/antigravity.py. No shared credentials.
namespace Antigravity {
const KEY = "ai_usage_antigravity_oauth_v1"
const CLIENT = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
// Public installed-client secret, not a user credential.
const SECRET = "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"
const TOKEN = "https://oauth2.googleapis.com/token", BASE = "https://cloudcode-pa.googleapis.com/v1internal:"
// loadCodeAssist and quota summary select the Antigravity product by this public client
// profile (Parrot oauth/antigravity.py). A generic UA can yield HTTP 200 without
// project/tier, followed by quota HTTP 403. Keep this scoped to these two reads.
const QUOTA_USER_AGENT = "antigravity/hub/2.22.0 (aidev_client; os_type=linux; arch=amd64; cl=995734886)"
type Credential = { id: string; email: string; access: string; refresh: string; expiresAt: number }
export function credentials(): Credential[] {
  const raw = Keychain.get(KEY); if (!raw) return []
  try { const items = JSON.parse(raw); if (!Array.isArray(items)) throw new Error(); return items } catch { throw new Error("Antigravity登录记录损坏，请重新登录") }
}
function persist(items: Credential[]) { if (!Keychain.set(KEY, JSON.stringify(items))) throw new Error("Antigravity钥匙串保存失败，保留原凭据") }
export function accounts() { return credentials().map(c => ({ id: c.id, name: c.email, email: c.email, provider: "antigravity" as const })) }
let loginEpoch = 0
export function logout(id: string) { persist(credentials().filter(c => c.id !== id)); loginEpoch++; rotated.delete(id) }
export type Login = {
  epoch: number;
  url: string; redirect: string; verifier: string; state: string; expiresAt: number;
  cancelled: boolean; consumed: boolean; code: string | null; server: any; timer: any;
}
function closeListener(d: Login) {
  if (d.timer != null) { clearTimeout(d.timer); d.timer = null }
  if (d.server) { try { d.server.stop() } catch {} d.server = null }
}
export function cancel(d: Login) {
  d.cancelled = true; closeListener(d); d.verifier = ""; d.state = ""; d.code = null; d.url = ""
}
export function begin(onCode: () => void, onExpire: () => void, onFailure: () => void = onExpire): Login {
  if (typeof Crypto === "undefined" || typeof Crypto.generateSymmetricKey !== "function" || typeof Crypto.sha256 !== "function")
    throw new Error("Antigravity浏览器登录缺少PKCE能力，请重新登录")
  if (typeof HttpServer !== "function" || typeof HttpResponse === "undefined" || typeof HttpResponseBody === "undefined" || typeof HttpResponse.ok !== "function" || typeof HttpResponseBody.html !== "function")
    throw new Error("Antigravity浏览器登录缺少本机回调能力，请重新登录")
  const base = (data: any) => data.toBase64String().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const verifier = base(Crypto.generateSymmetricKey(256)), state = base(Crypto.generateSymmetricKey(256))
  const input = Data.fromRawString(verifier)
  if (!input) throw new Error("Antigravity PKCE生成失败，请重新登录")
  const challenge = base(Crypto.sha256(input))
  const d: Login = { epoch: loginEpoch, url: "", redirect: "", verifier, state, expiresAt: Date.now() + 15 * 60000,
    cancelled: false, consumed: false, code: null, server: null, timer: null }
  const reply = (ok: boolean) => HttpResponse.ok(HttpResponseBody.html(ok
    ? '<!doctype html><meta charset="utf-8"><p>已收到授权回调，请返回脚本等待保存。此页面不代表登录成功。</p>'
    : '<!doctype html><meta charset="utf-8"><p>本次回调无效或已失效，请返回脚本重新登录。</p>'))
  for (const port of [51121]) {
    let server: any = null
    try {
      server = new HttpServer(); server.listenAddressIPv4 = "127.0.0.1"
      if (server.listenAddressIPv4 !== "127.0.0.1") throw new Error()
      server.registerHandler("/oauth-callback", (req: any) => {
        const values = (key: string) => (req.queryParams ?? []).filter((x: any) => x.key === key).map((x: any) => x.value)
        const codes = values("code"), states = values("state")
        if (!d.cancelled && Date.now() >= d.expiresAt) { cancel(d); Promise.resolve().then(onExpire); return reply(false) }
        if (req.method === "GET" && !d.cancelled && !d.consumed && states.length === 1 && states[0] === d.state && values("error").length > 0) {
          cancel(d); Promise.resolve().then(onFailure); return reply(false)
        }
        const valid = req.method === "GET" && !d.cancelled && !d.consumed && !d.code && Date.now() < d.expiresAt &&
          values("error").length === 0 && states.length === 1 && states[0] === d.state && codes.length === 1 && typeof codes[0] === "string" && !!codes[0]
        if (!valid) return reply(false)
        d.code = codes[0]
        Promise.resolve().then(onCode)
        return reply(true)
      })
      const error = server.start({ port, forceIPv4: true })
      if (error || server.port !== port) throw new Error()
      d.server = server; d.redirect = `http://localhost:${port}/oauth-callback`; break
    } catch { try { server?.stop() } catch {} }
  }
  if (!d.server) { cancel(d); throw new Error("Antigravity本机回调无法绑定127.0.0.1:51121，请重新登录") }
  const params = { response_type: "code", client_id: CLIENT, redirect_uri: d.redirect,
    scope: ["cloud-platform", "userinfo.email", "userinfo.profile", "cclog", "experimentsandconfigs", "aicode"].map(s => "https://www.googleapis.com/auth/" + s).join(" "),
    code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent" }
  d.url = "https://accounts.google.com/o/oauth2/v2/auth?" + Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&")
  d.timer = setTimeout(() => { if (!d.cancelled) { cancel(d); onExpire() } }, 15 * 60000)
  return d
}
async function token(body: Record<string, string>) {
  return request(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: Object.entries({ client_id: CLIENT, client_secret: SECRET, ...body }).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&") })
}
function credential(b: any, old?: Credential): Credential {
  const seconds = Number(b?.expires_in)
  if (typeof b?.access_token !== "string" || !b.access_token || b.refresh_token != null && (typeof b.refresh_token !== "string" || !b.refresh_token) || !(b.refresh_token || old?.refresh) || !Number.isFinite(seconds) || seconds <= 0) throw new Error("Antigravity令牌响应不完整，保留原凭据")
  return { id: old?.id ?? "", email: old?.email ?? "", access: b.access_token, refresh: b.refresh_token ?? old!.refresh, expiresAt: Date.now() + seconds * 1000 }
}
export async function finish(d: Login, active: () => boolean) {
  const check = () => { if (d.cancelled || d.epoch !== loginEpoch || Date.now() >= d.expiresAt || !active()) { cancel(d); throw new Error("Antigravity本次授权已取消或过期") } }
  check(); if (d.consumed || !d.code) throw new Error("Antigravity授权回调尚未收到或已使用")
  d.consumed = true
  try {
    const r = await token({ grant_type: "authorization_code", code: d.code, redirect_uri: d.redirect, code_verifier: d.verifier })
    if (r.status !== 200) throw new Error(`Antigravity令牌交换失败（HTTP ${r.status}），请重新登录`)
    const item = credential(await json(r)); check()
    const profile = await request("https://www.googleapis.com/oauth2/v2/userinfo?alt=json", { headers: { Authorization: `Bearer ${item.access}` } })
    if (profile.status !== 200) throw new Error(`Antigravity账号资料读取失败（HTTP ${profile.status}）`)
    const user = await json(profile)
    if (typeof user?.id !== "string" || !user.id || typeof user?.email !== "string" || !user.email) throw new Error("Antigravity账号资料缺少真实身份")
    check(); item.id = "antigravity:" + encodeURIComponent(user.id); item.email = user.email
    const items = credentials(); persist([...items.filter(c => c.id !== item.id), item])
  } finally { cancel(d) }
}
const flights = new Map<string, Promise<Credential>>()
// If Keychain temporarily rejects a rotated token, retry its save rather than reuse the old refresh token.
const rotated = new Map<string, { previous: string; next: Credential }>()
async function renew(item: Credential, force = false): Promise<Credential> {
  const latest = credentials().find(c => c.id === item.id)
  if (!latest) throw new Error("Antigravity账号已退出")
  const recovery = rotated.get(item.id)
  if (recovery) {
    if (JSON.stringify(latest) === recovery.previous) {
      persist(credentials().map(c => c.id === item.id ? recovery.next : c)); rotated.delete(item.id); return recovery.next
    }
    rotated.delete(item.id)
  }
  if (JSON.stringify(latest) !== JSON.stringify(item)) return latest
  if (!force && !renewalDue(latest.expiresAt)) return latest
  const pending = flights.get(item.id); if (pending) return pending
  const job = (async () => {
    const until = renewalDeadline("Antigravity", item.id); if (until) throw new Error(renewalWait("Antigravity", until))
    const r = await token({ grant_type: "refresh_token", refresh_token: item.refresh })
    const current = () => credentials().find(c => c.id === item.id)
    if (!current()) throw new Error("Antigravity账号已退出")
    if (JSON.stringify(current()) !== JSON.stringify(item)) return current()!
    if (r.status !== 200) {
      const failure = await renewalFailure("Antigravity", item.id, r), recovered = current()
      if (!recovered) throw new Error("Antigravity账号已退出")
      if (JSON.stringify(recovered) !== JSON.stringify(item)) return recovered
      throw failure
    }
    const next = credential(await json(r), item), items = credentials(), old = items.find(c => c.id === item.id)
    if (!old) throw new Error("Antigravity账号已退出")
    if (JSON.stringify(old) !== JSON.stringify(item)) return old
    rotated.set(item.id, { previous: JSON.stringify(item), next })
    persist(items.map(c => c.id === item.id ? next : c)); rotated.delete(item.id); return next
  })()
  flights.set(item.id, job)
  try { return await job } finally { if (flights.get(item.id) === job) flights.delete(item.id) }
}
export async function read(item: Credential): Promise<Account> {
  try {
    let current = renewalDue(item.expiresAt) ? await renew(item) : item, retried = false
    const post = async (method: "loadCodeAssist" | "retrieveUserQuotaSummary", body: any) => {
      const projectState = method === "retrieveUserQuotaSummary" ? `；project ${body.project ? "已提供" : "未提供"}` : ""
      const send = async () => {
        try { return await request(BASE + method, { method: "POST", headers: { Authorization: `Bearer ${current.access}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": QUOTA_USER_AGENT }, body: JSON.stringify(body) }) }
        catch { throw new Error(`Antigravity ${method}：网络请求失败（无 HTTP 状态${projectState}），保留登录；可重试`) }
      }
      let r = await send()
      if (r.status === 401 && !retried) { retried = true; current = await renew(current, true); r = await send() }
      if (r.status !== 200) {
        // Do not echo Google messages, URLs, request IDs or arbitrary error fields.
        // Only these fixed protocol status names are safe to surface in cached details.
        let status = ""
        try {
          const b = await r.json(), s = b?.error?.status
          if (["PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "FAILED_PRECONDITION", "NOT_FOUND", "RESOURCE_EXHAUSTED", "INTERNAL", "UNAVAILABLE", "VALIDATION_REQUIRED"].includes(s)) status = `；${s}`
        } catch { /* HTTP status and step remain useful without a response body. */ }
        throw new Error(`Antigravity ${method}失败（HTTP ${r.status}${status}${projectState}），保留登录；可重试`)
      }
      let parsed: any
      try { parsed = await r.json() } catch { throw new Error(`Antigravity ${method}（HTTP 200${projectState}）：响应无法解析，保留登录；可重试`) }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Antigravity ${method}（HTTP 200${projectState}）：响应结构无效，保留登录；可重试`)
      return parsed
    }
    const load = await post("loadCodeAssist", { metadata: { ideType: "ANTIGRAVITY" } })
    let project = ""
    for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
      const value = load?.[key]; if (typeof value === "string" && value.trim()) { project = value.trim(); break }
      if (typeof value?.id === "string" && value.id.trim()) { project = value.id.trim(); break }
    }
    const diagnostics: string[] = []
    if (!project) diagnostics.push("Antigravity loadCodeAssist（HTTP 200）：未返回 project；不自动开通项目，保留登录")
    let summary: any = null
    try { summary = await post("retrieveUserQuotaSummary", project ? { project } : {}) }
    catch (e: any) { diagnostics.push(typeof e?.message === "string" && e.message.startsWith("Antigravity") ? e.message : "Antigravity retrieveUserQuotaSummary：续期或本机凭据处理失败，保留登录；可重试") }
    if (!credentials().some(c => c.id === item.id)) throw new Error("Antigravity账号已退出")
    const mapped = mapAntigravityQuota(load, summary)
    if (summary && !mapped.antigravity?.groups.length) diagnostics.push("Antigravity retrieveUserQuotaSummary（HTTP 200）：未提供额度分组，窗口未知")
    return { id: item.id, name: current.email, provider: "antigravity", enabled: true, available: true, resetCredits: null, ...mapped, ...(diagnostics.length ? { readError: diagnostics.join("；") } : {}) }
  } catch (e: any) {
    const fallback = quotaFallback(item.id, item.email, "antigravity")
    // Only locally authored diagnostics; transport/JSON failures use shared redacted errors.
    fallback.readError = typeof e?.message === "string" && e.message.startsWith("Antigravity") ? e.message : "Antigravity额度读取失败，保留原缓存与登录；可重试"
    return fallback
  }
}
}
export type AntigravityLogin = Antigravity.Login
export const beginAntigravityLogin = Antigravity.begin
export const finishAntigravityLogin = Antigravity.finish
export const cancelAntigravityLogin = Antigravity.cancel

// Official color asset: https://antigravity.google/assets/image/antigravity-logo.png
// Linked as 276x276 icon by https://antigravity.google/; original SHA256 193ba1805de11c23cd0c7a1df92aa0a886708e57350f6f7766100afe5befed73
let agBrandImage: UIImage | null = null, agMutedImage: UIImage | null = null
export function antigravityBrandImage(muted = false): UIImage {
  if (muted && agMutedImage) return agMutedImage
  if (!muted && agBrandImage) return agBrandImage
  const image = UIImage.fromBase64String(muted ? "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" : "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")
  if (!image) throw new Error("Antigravity内嵌图标解码失败")
  if (muted) agMutedImage = image; else agBrandImage = image
  return image
}
