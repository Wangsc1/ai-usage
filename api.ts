// Parrot 管理接口数据层（Scripting 中 fetch / Keychain / Storage 为全局对象）


export const VERSION = "1.9.1"
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
  return sortAccounts((getSource() === "official" ? officialCached() : Storage.get<UsageData>(getSource() === "sub2api" ? KEY_SUB_CACHE : KEY_CACHE))?.accounts ?? [])
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
  return { today: null, month: null, todayByFamily: {}, monthByFamily: {}, fetchedAt: Date.now(), accounts }
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
        if ((row.platform === "anthropic" && ["oauth", "setup-token"].includes(row.type)) || (row.platform === "openai" && row.type === "oauth")) rows.push(row)
      }
    }
    const errors: string[] = [], cards = Storage.get<Record<string, { count: number | null; at: number; error?: string }>>(KEY_SUB_CARDS) ?? {}
    const accounts: Account[] = []
    // Bounded sequential reads avoid a per-account upstream request burst. List remains complete if any read fails.
    for (const row of rows) {
      const id = `sub2api:${row.id}`, old = cached?.accounts.find(a => a.id === id)
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
          return HttpResponse.ok(HttpResponseBody.text("本次回调无效或已失效。请返回脚本检查授权。"))
        }
        d.code = codes[0]
        loginProgress(d, "收到Claude回调，已通过本次校验")
        // Return a synchronous response without awaiting exchange. Native socket flush timing is platform-owned.
        Promise.resolve().then(onCode)
        return HttpResponse.ok(HttpResponseBody.text("已收到本次授权回调，请返回脚本等待账号保存。此页面不代表授权已完成。"))
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
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  // Controlled compatibility: standard JSON negotiation and this script's honest identity, not browser/CLI spoofing.
  // Limit the change to initial exchange; existing credential refresh keeps its original wire headers.
  if (body.grant_type === "authorization_code") {
    headers.Accept = "application/json"
    headers["User-Agent"] = `ai-usage/${VERSION}`
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
export async function loadClaudeAccounts(): Promise<Account[]> {
  // In-process de-duplication: concurrent App/widget loads share one request sequence per account.
  return Promise.all(credentials().map(item => {
    const pending = claudeLoads.get(item.id)
    if (pending) return pending
    const job = loadClaudeAccount(item).finally(() => { if (claudeLoads.get(item.id) === job) claudeLoads.delete(item.id) })
    claudeLoads.set(item.id, job)
    return job
  }))
}
async function loadClaudeAccount(item: Credential): Promise<Account> {
  {
    const limited = deadline(USAGE_LIMIT, item.id)
    if (limited) throw new Error(`Claude额度读取冷却中（此前GET /api/oauth/usage受限），${waitText(limited)}；本次未发送请求`)
    let current = item.expiresAt <= Date.now() + 60000 ? await refresh(item) : item
    const getUsage = () => request(API + "/usage", { headers: { Authorization: `Bearer ${current.access}`,
      "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" } })
    let r = await getUsage()
    if (r.status === 401) { current = await refresh(current); r = await getUsage() }
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
