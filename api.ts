// Parrot 管理接口数据层（Scripting 中 fetch / Keychain / Storage 为全局对象）

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
  today: Metric
  month: Metric
  todayByFamily: Record<string, Metric>
  monthByFamily: Record<string, Metric>
  accounts: Account[]
  fetchedAt: number
}

export type LoadResult = { data: UsageData | null; stale: boolean; error: string | null }

const KEY_SELECTION = "ai_usage_selected_accounts_v1"
export function getSelectedAccounts(): string[] | null {
  return Storage.get<string[]>(KEY_SELECTION)
}
export function saveSelectedAccounts(ids: string[]) {
  Storage.set(KEY_SELECTION, ids.slice(0, 4))
}
export function cachedAccounts(): Account[] {
  return Storage.get<UsageData>(KEY_CACHE)?.accounts ?? []
}
export function widgetAccounts(accounts: Account[], parameter = ""): Account[] {
  // 小组件参数可填账号邮箱前缀，用逗号分隔；为空时使用设置页勾选结果。
  const names = parameter.split(/[,，]/).map(x => x.trim()).filter(Boolean)
  if (names.length) return names.map(n => accounts.find(a => a.id === n || a.name === n || a.name.replace(/@.*$/, "") === n)).filter(Boolean).slice(0, 4) as Account[]
  const ids = getSelectedAccounts()
  if (ids !== null) return ids.map(id => accounts.find(a => a.id === id)).filter(Boolean).slice(0, 4) as Account[]
  return accounts.filter(a => a.enabled).sort((x, y) => tightest(x) - tightest(y)).slice(0, 4)
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
  Storage.remove(KEY_SELECTION)
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
  const { baseUrl, managementKey } = getConfig()
  const cached = Storage.get<UsageData>(KEY_CACHE)
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
  if (n >= 1000) return "$" + n.toFixed(0)
  if (n >= 100) return "$" + n.toFixed(1)
  return "$" + n.toFixed(2)
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
