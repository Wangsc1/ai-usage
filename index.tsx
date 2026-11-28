import {
  Button, EditButton, ForEach, Form, HStack, Spacer, Navigation, NavigationLink, NavigationStack, Picker, Script, Section,
  SecureField, SVG, Image, Text, TextField, Widget, WebView, VStack, useState, useEffect,
  ScrollView, LazyVGrid, ReorderableForEach, Rectangle, RoundedRectangle, modifiers, useObservable,
} from "scripting"
import { VERSION, Account, Metric, DataSource, StatisticsSource, REFRESH_OPTIONS, CLAUDE_SVG, OPENAI_SVG, DEEPSEEK_SVG, antigravityBrandImage, workBuddyBrandImage, getSource, saveSource, getStatisticsSource, saveStatisticsSource, getRefreshMinutes, saveRefreshMinutes, getConfig, saveConfig, getSub2APIConfig, saveSub2APIConfig, clearSub2APIConfig, loadUsage, refreshAccount, requestLocalWidgetProjection, accountScope, cachedAccounts, cachedDashboardOverview, managementAccounts, sortAccounts, saveAccountOrder, saveVisibleAccountOrder, hiddenAccountIds, hideAccount, restoreHiddenAccounts, getWidgetName, getWidgetNames, saveWidgetName, fmtPct, fmtReset, fmtResetDays, fmtTime, fmtTokens, fmtUsd } from "./api"
import { officialAccounts, logoutOfficial, addDeepSeekAccount, ANTIGRAVITY_MODES, AntigravityMode, getAntigravityMode, saveAntigravityMode, projectAntigravityAccount, antigravityModeHint, requestAntigravityWidgetProjection, AntigravityLogin, beginAntigravityLogin, finishAntigravityLogin, cancelAntigravityLogin, CodexBrowserLogin, beginCodexBrowserLogin, finishCodexBrowserLogin, cancelCodexBrowserLogin, WorkBuddyLogin, beginWorkBuddyLogin, finishWorkBuddyLogin, cancelWorkBuddyLogin, ClaudeLogin, beginClaudeLogin, finishClaudeLogin, cancelClaudeLogin, claudeCooldownUntil, claudeCooldownMessage, fmtDeepSeekMoney, fmtWorkBuddyNumber, fmtWorkBuddyUsed, fmtWorkBuddyCheckin } from "./api"

// Modern ForEach uses Observable data + builder + editActions="move" (views/for_each).
// Guard their presence so a runtime without these exports keeps the long-press sub-page instead of failing to render.
const NATIVE_SORT = typeof EditButton !== "undefined" && EditButton != null && typeof ForEach !== "undefined" && ForEach != null
// EditMode is a host global, not a scripting export. Unsupported hosts keep native editing.
const CUSTOM_LOGIN_SORT = NATIVE_SORT && typeof useObservable === "function" && typeof EditMode !== "undefined" && EditMode != null
  && typeof EditMode.active === "function" && typeof EditMode.inactive === "function"
// Keep native reorder notifications separate from App-driven row synchronization.
function sameRowOrder(a: { id: string }[], b: { id: string }[]) {
  return a.length === b.length && a.every((row, i) => row.id === b[i].id)
}
function useSortableRows<T extends { id: string }>(rows: T[], enabled: boolean,
  commit: (ids: string[], previous: T[]) => boolean) {
  const data = typeof useObservable === "function" ? useObservable<T[]>(() => rows.slice()) : null
  const supported = NATIVE_SORT && data && Array.isArray(data.value) && typeof data.setValue === "function"
    && typeof data.subscribe === "function" && typeof data.unsubscribe === "function"
  useEffect(function syncAccountRows() {
    if (!supported || !data) return
    let syncing = false, expected = rows.slice()
    const replace = (value: T[]) => {
      syncing = true
      try { data.setValue(value.slice()) } finally { syncing = false }
    }
    const changed = (next: T[]) => {
      if (syncing) return
      const ids = Array.isArray(next) ? next.map(row => row?.id) : []
      // Native move may reorder, but must not delete/add or change row identity/metadata.
      const valid = Array.isArray(next) && ids.length === expected.length && new Set(ids).size === ids.length
        && ids.every(id => expected.some(row => row.id === id))
      if (valid && sameRowOrder(next, expected)) {
        if (JSON.stringify(next) !== JSON.stringify(expected)) replace(expected)
        return
      }
      if (!enabled || !valid || !commit(ids, expected)) { replace(expected); return }
      const byId = new Map(expected.map(row => [row.id, row]))
      expected = ids.map(id => byId.get(id)!)
    }
    // Run after render; suppress our own setValue so refresh/hide/source changes never save an order.
    if (JSON.stringify(data.value) !== JSON.stringify(expected)) replace(expected)
    data.subscribe(changed)
    return () => data.unsubscribe(changed)
  }, [data, supported, rows, enabled, commit])
  return supported ? data : null
}
// Same brand marks as the widget (shared constants from ./api); codex/openai accounts use the OpenAI mark.
const ICON_SIZE = 17
type DC = { light: string; dark: string }
const C = (light: string, dark: string): DC => ({ light, dark })
const FG = C("#1C1C1E", "#FFFFFF")
const SUB = C("#5E6068", "#8E8E93")
const ACCENT = C("#0A84FF", "#409CFF")
const GREEN = C("#2E9E4F", "#7ED957")
const ORANGE = C("#D9770B", "#FF9F0A")
const RED = C("#D93025", "#FF453A")
const SEG_OFF = C("rgba(0, 0, 0, 0.13)", "rgba(255, 255, 255, 0.14)")
const DIVIDER = C("rgba(0, 0, 0, 0.08)", "rgba(255, 255, 255, 0.10)")
const PILL_BG = C("rgba(10, 132, 255, 0.12)", "rgba(64, 156, 255, 0.20)")
const MUTED_PILL_BG = C("rgba(0, 0, 0, 0.06)", "rgba(255, 255, 255, 0.11)")
const GREEN_PILL_BG = C("rgba(46, 158, 79, 0.13)", "rgba(126, 217, 87, 0.18)")
const ORANGE_PILL_BG = C("rgba(217, 119, 11, 0.12)", "rgba(255, 159, 10, 0.18)")
const RED_PILL_BG = C("rgba(217, 48, 37, 0.12)", "rgba(255, 69, 58, 0.18)")

function quotaColor(remaining: number | null): DC {
  if (remaining == null) return SUB
  if (remaining <= 20) return RED
  if (remaining <= 60) return ORANGE
  return GREEN
}
function isAccountExhausted(acc?: Account): boolean {
  if (!acc) return false
  if (acc.provider === "workbuddy") return acc.credits?.reliable === true && acc.credits?.remaining === 0
  return [acc.fiveHour?.remainingPercent, acc.sevenDay?.remainingPercent].some(v => typeof v === "number" && Number.isFinite(v) && v === 0)
}
function cacheRateText(m: Metric): string {
  const inputSide = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens
  return inputSide > 0 ? (m.cacheReadTokens / inputSide * 100).toFixed(1) + "%" : "--"
}
function Pill({ text, color = SUB, bg = MUTED_PILL_BG }: { text: string; color?: DC; bg?: DC }) {
  return <HStack fixedSize={{ horizontal: true, vertical: true }} background={<RoundedRectangle cornerRadius={6} fill={bg} />}>
    <Text font={10} fontWeight="semibold" monospacedDigit foregroundStyle={color} lineLimit={1} padding={{ horizontal: 6, vertical: 2 }}>{text}</Text>
  </HStack>
}
// Matches widget.tsx SegBar: lit body uses FG, rightmost lit head uses status color, unlit uses SEG_OFF.
function MiniQuotaBar({ remaining, count = 10, height = 4, muted = false }: { remaining: number | null; count?: number; height?: number; muted?: boolean }) {
  const lit = remaining == null ? 0 : Math.round((Math.max(0, Math.min(100, remaining)) / 100) * count)
  const head = quotaColor(remaining)
  return <HStack spacing={height * 0.45}>
    {Array.from({ length: count }, (_, i) => {
      const color = i < lit ? (muted ? SUB : i < lit - 1 ? FG : head) : SEG_OFF
      return <RoundedRectangle key={String(i)} cornerRadius={height * 0.3} fill={color} frame={{ maxWidth: "infinity", height }} />
    })}
  </HStack>
}
function DetailKV({ label, value, valueColor = FG, mono = false }: { label: string; value: string; valueColor?: DC; mono?: boolean }) {
  return <HStack spacing={8}>
    <Text font={13} foregroundStyle={SUB} lineLimit={1}>{label}</Text>
    <Spacer />
    <Text font={13} fontWeight="medium" monospacedDigit={mono} foregroundStyle={valueColor} lineLimit={1} minScaleFactor={0.75}>{value}</Text>
  </HStack>
}
function ProviderMark({ provider, size = ICON_SIZE }: { provider: string; size?: number }) {
  const code = providerIconCode(provider)
  if (provider === "antigravity") return <Image image={antigravityBrandImage()} renderingMode="original" resizable frame={{ width: size, height: size }} />
  if (provider === "workbuddy") return <Image image={workBuddyBrandImage()} renderingMode="original" resizable frame={{ width: size, height: size }} />
  if (code) return <SVG code={code} resizable frame={{ width: size, height: size }} />
  return <Image systemName="sparkle" font={size * 0.85} foregroundStyle={SUB} frame={{ width: size, height: size }} />
}
function MiniQuotaBlock({ label, remaining, resetsAt, fmt, muted = false }: { label: string; remaining: number | null; resetsAt: string | null; fmt: (iso: string | null) => string; muted?: boolean }) {
  const countdown = fmt(resetsAt)
  const showReset = countdown !== "--" && countdown !== "--:--"
  return <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
    <HStack spacing={4}>
      <Text font={11} fontWeight="medium" monospaced foregroundStyle={SUB} lineLimit={1}>{label}</Text>
      {showReset ? <Text font={10} monospacedDigit foregroundStyle={SUB} lineLimit={1}>{countdown}</Text> : null}
      <Spacer />
      <Text font={11} fontWeight="semibold" monospacedDigit foregroundStyle={muted ? SUB : quotaColor(remaining)} lineLimit={1}>{fmtPct(remaining)}</Text>
    </HStack>
    <MiniQuotaBar remaining={remaining} muted={muted} />
  </VStack>
}
function AccountDashboardMeta({ acc }: { acc?: Account }) {
  const exhausted = isAccountExhausted(acc)
  if (acc?.provider === "workbuddy") {
    const c = acc.credits
    const checkin = fmtWorkBuddyCheckin(c?.checkin)
    const checkedIn = checkin === "已签到"
    const pct = c?.reliable && typeof c.remaining === "number" && typeof c.capacity === "number" && c.capacity > 0
      ? (c.remaining / c.capacity) * 100 : null
    return c ? <VStack alignment="leading" spacing={4}>
      <HStack spacing={6}>
        <Text font={12} fontWeight="semibold" monospacedDigit foregroundStyle={exhausted ? SUB : FG} lineLimit={1}>
          {`剩余积分 ${c.reliable ? fmtWorkBuddyNumber(c.remaining) : "未提供"}`}
        </Text>
        <Spacer />
        <Pill text={checkin} color={checkedIn ? GREEN : SUB} bg={checkedIn ? GREEN_PILL_BG : MUTED_PILL_BG} />
      </HStack>
      {pct != null ? <MiniQuotaBar remaining={pct} muted={exhausted} /> : null}
      {c.error || acc.readError ? <Text font={11} foregroundStyle={ORANGE} lineLimit={1}>{c.error || acc.readError}</Text> : null}
    </VStack> : <Text font={11} foregroundStyle={SUB}>点此查看详情或设置小组件名</Text>
  }
  if (acc?.provider === "deepseek") {
    const b = acc.balance
    const moneyText = b?.money?.length ? b.money.map(m => fmtDeepSeekMoney(m.currency, m.total)).join(" · ") : ""
    const subText = b?.money?.length ? b.money.map(m => b.auth === "网页Token"
      ? `近7日 ${fmtDeepSeekMoney(m.currency, m.weekCost)}`
      : `充值 ${fmtDeepSeekMoney(m.currency, m.toppedUp)} · 赠送 ${fmtDeepSeekMoney(m.currency, m.granted)}`).join(" · ") : ""
    return moneyText ? <VStack alignment="leading" spacing={2}>
      <HStack spacing={6}>
        <Text font={12} fontWeight="semibold" monospacedDigit foregroundStyle={FG} lineLimit={1}>{`余额 ${moneyText}`}</Text>
        <Spacer />
        {b?.auth ? <Pill text={b.auth} /> : null}
      </HStack>
      {subText ? <Text font={11} foregroundStyle={SUB} lineLimit={1}>{subText}</Text> : null}
      {b?.error || acc.readError ? <Text font={11} foregroundStyle={ORANGE} lineLimit={1}>{b?.error || acc.readError}</Text> : null}
    </VStack> : <Text font={11} foregroundStyle={b?.error || acc.readError ? ORANGE : SUB} lineLimit={1}>{b?.error || acc.readError || "点此查看详情或设置小组件名"}</Text>
  }
  if (acc && (acc.fiveHour?.remainingPercent != null || acc.sevenDay?.remainingPercent != null)) {
    return <VStack alignment="leading" spacing={4}>
      <HStack spacing={12}>
        <MiniQuotaBlock label="5h" remaining={acc.fiveHour?.remainingPercent ?? null} resetsAt={acc.fiveHour?.resetsAt ?? null} fmt={fmtReset} muted={exhausted} />
        <MiniQuotaBlock label="7d" remaining={acc.sevenDay?.remainingPercent ?? null} resetsAt={acc.sevenDay?.resetsAt ?? null} fmt={fmtResetDays} muted={exhausted} />
      </HStack>
      {acc.readError ? <Text font={11} foregroundStyle={ORANGE} lineLimit={1}>{acc.readError}</Text> : null}
    </VStack>
  }
  if (acc?.readError) return <Text font={11} foregroundStyle={ORANGE} lineLimit={1}>{acc.readError}</Text>
  return <Text font={11} foregroundStyle={SUB} lineLimit={1}>暂未读取缓存 · 点此查看详情或设置名称</Text>
}
function AccountHeaderLine({ index, provider, name, fixed = false, alias = "", acc }: { index: number; provider: string; name: string; fixed?: boolean; alias?: string; acc?: Account }) {
  const hasReset = typeof acc?.resetCredits === "number" && Number.isFinite(acc.resetCredits) && acc.resetCredits > 0
  const unavailable = !!acc && acc.enabled && !acc.available
  return <HStack spacing={6}>
    <AccountLine index={index} provider={provider} name={name} fixed={fixed} />
    {alias ? <Pill text={alias} color={ACCENT} bg={PILL_BG} /> : null}
    {hasReset || unavailable ? <Spacer /> : null}
    {hasReset ? <Pill text={`RE:${acc!.resetCredits}`} /> : null}
    {unavailable ? <Pill text="不可用" color={RED} bg={RED_PILL_BG} /> : null}
  </HStack>
}
function DashboardHeroCard({ source, statisticsSource, accountCount, hiddenCount }: { source: DataSource; statisticsSource: StatisticsSource; accountCount: number; hiddenCount: number }) {
  const overview = (typeof cachedDashboardOverview === "function" ? cachedDashboardOverview(source, statisticsSource) : null)
    ?? { today: null, month: null, statsFetchedAt: null, quotaFetchedAt: null }
  const sourceLabel = source === "official" ? "官方直连" : source === "sub2api" ? "Sub2API" : "Parrot"
  const statsLabel = statisticsSource === "sub2api" ? "Sub2API" : "Parrot"
  const latestAt = overview.quotaFetchedAt ?? overview.statsFetchedAt
  const metricCell = (label: string, value: string) => <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
    <Text font={10} foregroundStyle={SUB} lineLimit={1}>{label}</Text>
    <Text font={12} fontWeight="semibold" monospacedDigit foregroundStyle={FG} lineLimit={1} minScaleFactor={0.7}>{value}</Text>
  </VStack>
  const periodRow = (title: string, m: Metric, badge?: string) => <VStack alignment="leading" spacing={7}>
    <HStack spacing={6}>
      <Text font={12} fontWeight="semibold" foregroundStyle={SUB}>{title}</Text>
      <Pill text={`请求 ${fmtTokens(m.requests)}`} />
      {badge ? <Pill text={badge} color={ACCENT} bg={PILL_BG} /> : null}
      <Spacer />
      <Text font={18} fontWeight="bold" monospacedDigit foregroundStyle={FG} lineLimit={1} minScaleFactor={0.75}>{fmtUsd(m.costUsd)}</Text>
    </HStack>
    <HStack spacing={6}>
      {metricCell("输入", fmtTokens(m.inputTokens))}
      {metricCell("输出", fmtTokens(m.outputTokens))}
      {metricCell("缓存", fmtTokens(m.cacheReadTokens + m.cacheCreationTokens))}
      {metricCell("缓存率", cacheRateText(m))}
      {metricCell("Token", fmtTokens(m.totalTokens))}
    </HStack>
  </VStack>
  return <VStack alignment="leading" spacing={10} padding={{ vertical: 4 }} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
    <HStack spacing={6}>
      <Image systemName="gauge.with.dots.needle.67percent" font={14} foregroundStyle={ACCENT} />
      <Text font={15} fontWeight="bold">{sourceLabel}</Text>
      <Pill text={`${accountCount} 账号`} color={ACCENT} bg={PILL_BG} />
      {hiddenCount > 0 ? <Pill text={`${hiddenCount} 隐藏`} /> : null}
      <Spacer />
      <Text font={11} monospacedDigit foregroundStyle={SUB}>{latestAt ? `更新 ${fmtTime(latestAt)}` : "本机缓存"}</Text>
    </HStack>
    <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
    {overview.today && overview.month ? <>
      {periodRow("今日用量", overview.today, statsLabel)}
      <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
      {periodRow("本月用量", overview.month)}
    </> : <HStack spacing={8} padding={{ vertical: 2 }}>
      <Image systemName="chart.bar.xaxis" font={13} foregroundStyle={SUB} />
      <Text font={12} foregroundStyle={SUB} lineLimit={2}>{`今日/本月统计暂未缓存（${statsLabel}），点击右上角刷新获取`}</Text>
    </HStack>}
  </VStack>
}
function providerIconCode(provider: string) {
  return provider === "claude" ? CLAUDE_SVG : provider === "deepseek" ? DEEPSEEK_SVG : provider === "codex" || provider === "openai" ? OPENAI_SVG : null
}
function providerWord(provider: string) { return provider === "antigravity" ? "Antigravity" : provider === "workbuddy" ? "WorkBuddy" : provider === "deepseek" ? "DeepSeek" : provider === "claude" ? "Claude" : provider === "codex" || provider === "openai" ? "Codex" : provider }
// "1. [icon] name"; unknown icon falls back to the original text label.
function AccountLine({ index, provider, name, fixed = false }: { index: number; provider: string; name: string; fixed?: boolean }) {
  const code = providerIconCode(provider)
  const nameText = <Text font={14} fontWeight="semibold" fixedSize={fixed ? { horizontal: false, vertical: true } : undefined}>{name}</Text>
  if (!code && provider !== "workbuddy" && provider !== "antigravity") return <Text font={14} fontWeight="semibold" fixedSize={fixed ? { horizontal: false, vertical: true } : undefined}>{`${index + 1}. ${providerWord(provider)} ${name}`}</Text>
  return <HStack spacing={6}>
    <Text font={12} fontWeight="medium" monospacedDigit>{`${index + 1}.`}</Text>
    {provider === "antigravity" ? <Image image={antigravityBrandImage()} renderingMode="original" resizable frame={{ width: ICON_SIZE, height: ICON_SIZE }} /> : provider === "workbuddy"
      ? <Image image={workBuddyBrandImage()} renderingMode="original" resizable frame={{ width: ICON_SIZE, height: ICON_SIZE }} />
      : <SVG code={code!} resizable frame={{ width: ICON_SIZE, height: ICON_SIZE }} />}
    {nameText}
  </HStack>
}
const accountLabel = (a: Account, i: number) => `${i + 1}. ${providerWord(a.provider)} · ${a.name}`

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
          builder={(a: Account, i: number) => <VStack
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
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState("")
  const [refreshed, setRefreshed] = useState<Account | null>(null)
  const [refreshLife] = useState({ alive: true, running: false })
  useEffect(() => () => { refreshLife.alive = false }, [])
  const detailAccount = getSource() === source && accountScope(source) === scope
    ? managementAccounts().find(a => a.id === account.id) ?? refreshed ?? account : refreshed ?? account
  async function refresh() {
    if (!refreshLife.alive || refreshLife.running) return
    refreshLife.running = true; setRefreshing(true); setRefreshError("")
    try {
      const result = await refreshAccount(account.id, source, scope, () => refreshLife.alive)
      if (!refreshLife.alive) return
      setRefreshError(result.error ?? "")
      if (result.account) {
        setRefreshed(result.account); onSaved()
        try { await Widget.reloadAll() } catch { if (refreshLife.alive) setRefreshError("账号已更新，小组件同步失败，请稍后重试") }
      }
    } catch { if (refreshLife.alive) setRefreshError("当前账号刷新失败，请重试") }
    finally { refreshLife.running = false; if (refreshLife.alive) setRefreshing(false) }
  }
  async function save() {
    if (getSource() !== source || accountScope(source) !== scope || (source !== "official" && !cachedAccounts().some(a => a.id === account.id))) return
    saveWidgetName(account.id, name, source)
    setName(name.trim())
    requestLocalWidgetProjection(source)
    onSaved()
    await Widget.reloadAll()
    close()
  }
  return <Form navigationTitle="账号详情" navigationBarTitleDisplayMode="inline"
    toolbar={{ primaryAction: <Button title={refreshing ? "刷新中…" : "刷新"} systemImage="arrow.clockwise" disabled={refreshing} action={refresh} /> }}>
    <Section header={<Text>小组件用户名</Text>}>
      <TextField title="自定义小组件用户名" value={name} onChanged={setName} prompt="留空使用原名" />
      <Button title="保存" systemImage="checkmark.circle.fill" action={save} />
    </Section>
    {account.provider === "antigravity" ? <Section header={<Text>小组件额度显示</Text>}>
      {source === "official" ? <Picker title="显示额度" value={quotaMode} onChanged={async (value: string) => {
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
    <AccountCacheSections account={detailAccount} source={source} refreshError={refreshError} />
  </Form>
}

// Shared detail content consumes only the passed cached account and source-local cache timestamps.
function AccountCacheSections({ account, source = getSource(), refreshError = "" }: { account: Account; source?: DataSource; refreshError?: string }) {
  account = projectAntigravityAccount(account, source)
  const exhausted = isAccountExhausted(account)
  const sourceLabel = source === "official" ? "官方直连" : source === "sub2api" ? "Sub2API" : "Parrot"
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
  const identityHeader = <Section>
    <HStack spacing={10} padding={{ vertical: 2 }}>
      <ProviderMark provider={account.provider} size={22} />
      <VStack alignment="leading" spacing={3}>
        <Text font={15} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }}>{account.name}</Text>
        <HStack spacing={6}>
          <Pill text={providerWord(account.provider)} color={ACCENT} bg={PILL_BG} />
          <Pill text={sourceLabel} />
          {account.enabled && !account.available ? <Pill text="不可用" color={RED} bg={RED_PILL_BG} /> : null}
        </HStack>
      </VStack>
      <Spacer />
    </HStack>
  </Section>
  const warningRow = (msg: string) => <HStack spacing={7} padding={{ vertical: 2 }}>
    <Image systemName="exclamationmark.triangle.fill" font={13} foregroundStyle={ORANGE} />
    <Text font={12} foregroundStyle={ORANGE} fixedSize={{ horizontal: false, vertical: true }}>{msg}</Text>
  </HStack>
  if (account.provider === "workbuddy") {
    const c = account.credits
    const checkinText = fmtWorkBuddyCheckin(c?.checkin)
    const checkedIn = checkinText === "已签到"
    const totalPct = c?.reliable && typeof c.remaining === "number" && typeof c.capacity === "number" && c.capacity > 0
      ? (c.remaining / c.capacity) * 100 : null
    const err = refreshError || c?.error || account.readError
    return <>
      {identityHeader}
      <Section header={<Text>WorkBuddy个人积分</Text>}>
        <VStack alignment="leading" spacing={7} padding={{ vertical: 2 }}>
          <HStack spacing={8}>
            <Text font={13} foregroundStyle={SUB}>{c?.reliable ? "剩余积分" : "积分状态"}</Text>
            <Spacer />
            <Text font={c?.reliable ? 20 : 14} fontWeight={c?.reliable ? "bold" : "medium"} monospacedDigit foregroundStyle={c?.reliable ? (exhausted ? SUB : FG) : SUB}>
              {c?.reliable ? fmtWorkBuddyNumber(c.remaining) : "积分未可靠提供"}
            </Text>
          </HStack>
          {totalPct != null ? <MiniQuotaBar remaining={totalPct} count={20} height={5} muted={exhausted} /> : null}
        </VStack>
        <DetailKV label="积分消耗" value={fmtWorkBuddyUsed(c?.used, c?.capacity)} mono />
        <HStack spacing={8}>
          <Text font={13} foregroundStyle={SUB}>签到状态</Text>
          <Spacer />
          <Pill text={checkinText} color={checkedIn ? GREEN : SUB} bg={checkedIn ? GREEN_PILL_BG : MUTED_PILL_BG} />
        </HStack>
        {err ? warningRow(err) : null}
      </Section>
      {(c?.packages ?? []).map((p, i) => {
        const pkgPct = typeof p.remaining === "number" && typeof p.capacity === "number" && p.capacity > 0
          ? (p.remaining / p.capacity) * 100 : null
        return <Section key={String(i)} header={<Text>{p.name}</Text>}>
          <VStack alignment="leading" spacing={6} padding={{ vertical: 2 }}>
            <HStack spacing={6}>
              <Text font={13} fontWeight="semibold" monospacedDigit>{`剩余 ${fmtWorkBuddyNumber(p.remaining)} · ${fmtWorkBuddyUsed(p.used, p.capacity)}`}</Text>
              <Spacer />
            </HStack>
            {pkgPct != null ? <MiniQuotaBar remaining={pkgPct} count={16} height={4} muted={p.remaining === 0} /> : null}
          </VStack>
          <DetailKV label="资源到期" value={cnTime(p.expiresAt)} mono />
          <DetailKV label="周期结束" value={`${cnTime(p.cycleEnd)}（不等同资源到期）`} mono />
        </Section>
      })}
    </>
  }
  if (account.provider === "deepseek") {
    const b = account.balance
    const err = refreshError || b?.error || account.readError
    const availText = b?.available == null ? "未提供" : b.available ? "可用" : "不可用"
    const availColor = b?.available === true ? GREEN : b?.available === false ? RED : SUB
    const availBg = b?.available === true ? GREEN_PILL_BG : b?.available === false ? RED_PILL_BG : MUTED_PILL_BG
    return <>
      {identityHeader}
      <Section header={<Text>DeepSeek余额</Text>}>
        <DetailKV label="认证方式" value={b?.auth || "未提供"} />
        <HStack spacing={8}>
          <Text font={13} foregroundStyle={SUB}>可用状态</Text>
          <Spacer />
          <Pill text={availText} color={availColor} bg={availBg} />
        </HStack>
        <DetailKV label="余额采集时间" value={iso(b?.fetchedAt)} mono />
        {b?.stale ? <HStack spacing={8}><Text font={12} foregroundStyle={SUB}>缓存状态</Text><Spacer /><Pill text="此前余额缓存" color={ORANGE} bg={ORANGE_PILL_BG} /></HStack> : null}
        {err ? warningRow(err) : null}
        {!b?.money?.length ? <Text font={13} foregroundStyle={SUB}>余额未提供</Text> : null}
      </Section>
      {(b?.money ?? []).map((m, i) => <Section key={String(i)} header={<Text>{m.currency}</Text>}>
        <HStack spacing={8} padding={{ vertical: 2 }}>
          <Text font={13} foregroundStyle={SUB}>账户余额</Text>
          <Spacer />
          <Text font={20} fontWeight="bold" monospacedDigit foregroundStyle={FG}>{fmtDeepSeekMoney(m.currency, m.total)}</Text>
        </HStack>
        <DetailKV label="充值余额" value={fmtDeepSeekMoney(m.currency, m.toppedUp)} mono />
        <DetailKV label="赠送余额" value={fmtDeepSeekMoney(m.currency, m.granted)} mono />
        {b?.auth === "网页Token" || m.weekCost != null ? <>
          <DetailKV label="近7日消费" value={fmtDeepSeekMoney(m.currency, m.weekCost)} mono />
          <DetailKV label="7日消费采集时间" value={iso(b?.weekFetchedAt)} mono />
          {b?.weekStale ? <HStack spacing={8}><Text font={12} foregroundStyle={SUB}>7日状态</Text><Spacer /><Pill text="此前7日消费缓存" color={ORANGE} bg={ORANGE_PILL_BG} /></HStack> : null}
        </> : null}
      </Section>)}
    </>
  }
  const percent = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? `${account.provider === "antigravity" ? Math.round(v) : v}%` : "未提供"
  const err = refreshError || account.readError
  const hasCards = typeof account.resetCredits === "number" && Number.isFinite(account.resetCredits) && account.resetCredits >= 0
  return <>
    {identityHeader}
    {err ? <Section>{warningRow(err)}</Section> : null}
    <Section header={<Text>额度窗口</Text>}>
      {([["5 h", account.fiveHour, fmtReset], ["7 d", account.sevenDay, fmtResetDays]] as const).map(([label, w, fmtCountdown]) => {
        const remaining = typeof w?.remainingPercent === "number" && Number.isFinite(w.remainingPercent) ? w.remainingPercent : null
        const countdown = fmtCountdown(w?.resetsAt ?? null)
        const showCountdown = countdown !== "--" && countdown !== "--:--"
        return <VStack key={label} alignment="leading" spacing={7} padding={{ vertical: 4 }}>
          <HStack spacing={8}>
            <Pill text={label} color={ACCENT} bg={PILL_BG} />
            <Text font={15} fontWeight="bold" monospacedDigit foregroundStyle={exhausted ? SUB : quotaColor(remaining)}>{`剩余额度 ${percent(w?.remainingPercent)}`}</Text>
            <Spacer />
            {showCountdown ? <Pill text={countdown} /> : null}
          </HStack>
          <MiniQuotaBar remaining={remaining} count={20} height={5} muted={exhausted} />
          <DetailKV label="已用额度" value={percent(w?.usedPercent)} mono />
          <DetailKV label="重置时间" value={cnTime(w?.resetsAt)} mono />
        </VStack>
      })}
    </Section>
    {account.provider === "antigravity" ? <>
      <Section header={<Text>Antigravity AI Credits</Text>}>
        <DetailKV label="套餐" value={account.antigravity?.tier || "未提供"} />
        <DetailKV label="剩余" value={account.antigravity?.creditAmount != null ? String(account.antigravity.creditAmount) : "未提供"} mono />
        <DetailKV label="最低可用额度" value={account.antigravity?.minimumCreditAmount != null ? String(account.antigravity.minimumCreditAmount) : "未提供"} mono />
      </Section>
      {(account.antigravity?.groups ?? []).map((g, i) => <Section key={String(i)} header={<Text>{g.name}</Text>}>
        {g.buckets.map((b, j) => {
          const pct = typeof b.remainingPercent === "number" && Number.isFinite(b.remainingPercent) ? b.remainingPercent : null
          return <VStack key={String(j)} alignment="leading" spacing={5} padding={{ vertical: 2 }}>
            <HStack spacing={6}>
              <Text font={13} fontWeight="semibold" lineLimit={1}>{b.name}</Text>
              <Pill text={b.window || "窗口未提供"} />
              <Spacer />
              <Text font={13} fontWeight="semibold" monospacedDigit foregroundStyle={pct === 0 ? SUB : quotaColor(pct)}>
                {pct != null ? `${Math.round(pct)}%` : "未提供"}
              </Text>
            </HStack>
            <MiniQuotaBar remaining={pct} count={16} height={4} muted={pct === 0} />
            <HStack spacing={6}>
              <Text font={11} foregroundStyle={SUB}>重置时间</Text>
              <Spacer />
              <Text font={11} monospacedDigit foregroundStyle={SUB}>{cnTime(b.resetsAt)}</Text>
            </HStack>
          </VStack>
        })}
      </Section>)}
    </> : <Section header={<Text>重置卡</Text>}>
      <HStack spacing={8}>
        <Text font={13} foregroundStyle={SUB}>可用重置卡</Text>
        <Spacer />
        {hasCards ? <Pill text={String(account.resetCredits)} color={account.resetCredits! > 0 ? GREEN : SUB} bg={account.resetCredits! > 0 ? GREEN_PILL_BG : MUTED_PILL_BG} />
          : <Text font={13} foregroundStyle={SUB}>未提供</Text>}
      </HStack>
    </Section>}
  </>
}

const UNSUPPORTED_BROWSER = "当前Scripting不支持WebViewController临时浏览器，请更新Scripting"
type AuthorizationDestination = { controller: WebViewController; onBack: () => void }
type PushAuthorization = (destination: AuthorizationDestination) => () => void
async function presentIsolatedAuthorization(register: ((release: (() => void) | null) => void) | undefined, url: string, push: PushAuthorization) {
  // Push before waiting for loadURL: redirects/login pages may never complete loading.
  // WebViewController is a GLOBAL API in the official WebView example, not a scripting module export.
  if (typeof WebViewController !== "function") throw new Error(UNSUPPORTED_BROWSER)
  const browser = new WebViewController({ ephemeral: true })
  let released = false
  let pop: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop!: () => void
  const cancelled = new Promise<void>(resolve => { stop = resolve })
  const release = () => { if (!released) {
    released = true; stop()
    // Embedded WebView navigation belongs to the same stack, never the controller's modal API.
    try { pop?.() } finally { browser.dispose() }
  } }
  register?.(release)
  try {
    const failure = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("授权页面加载超时，请重试")), 20000)
    })
    pop = push({ controller: browser, onBack: release })
    const loading = browser.loadURL(url).then(ok => {
      if (timer != null) clearTimeout(timer)
      if (!ok && !released) throw new Error("授权页面加载失败，请重试")
      return new Promise<void>(() => {}) // Loading success is NOT dismissal or authorization success.
    })
    await Promise.race([loading, failure, cancelled])
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
  const [sortUI, setSortUI] = useState({ editing: false, failed: false })
  const sortMode = CUSTOM_LOGIN_SORT ? useObservable(() => EditMode.inactive()) : null
  const officialEditMode = !sortUI.failed && sortMode && typeof sortMode.setValue === "function" ? sortMode : null
  const close = Navigation.useDismiss()
  const [authorization, setAuthorization] = useState<AuthorizationDestination | null>(null)
  const pushAuthorization: PushAuthorization = destination => {
    setAuthorization(destination)
    return () => setAuthorization(current => current === destination ? null : current)
  }
  const [init] = useState<{ logins?: ReturnType<typeof officialAccounts>; parrot?: boolean; sub?: boolean }>({})
  const [source, setSource] = useState<DataSource>(getSource())
  const [statisticsSource, setStatisticsSource] = useState<StatisticsSource>(getStatisticsSource())
  const needParrot = source === "parrot" || statisticsSource === "parrot"
  const needSub = source === "sub2api" || statisticsSource === "sub2api"
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
  if (source === "official" && !init.logins) init.logins = officialAccounts()
  const [logins, setLogins] = useState(init.logins ?? [])
  const [auth] = useState({ antigravity: null as AntigravityLogin | null, codex: null as CodexBrowserLogin | null, alive: true, running: false, epoch: 0, workbuddy: null as WorkBuddyLogin | null, claude: null as ClaudeLogin | null, releaseBrowser: null as (() => void) | null })
  const stopAuth = () => { if (auth.antigravity) cancelAntigravityLogin(auth.antigravity); auth.antigravity = null; setAGBrowser(null); auth.running = false; setWBPreparing(false); if (auth.workbuddy) cancelWorkBuddyLogin(auth.workbuddy); auth.workbuddy = null; setWorkbuddy(null); if (auth.codex) cancelCodexBrowserLogin(auth.codex); auth.codex = null; setCodexBrowser(null); setDSAdding(false); setDSToken(""); auth.epoch++; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; setClaude(null); setClaudeCode(""); setClaudeProgress("") }
  const dismiss = () => { auth.alive = false; stopAuth(); close() }
  const subCur = needSub ? getSub2APIConfig() : { baseUrl: "", adminKey: "", timezone: "" }
  if (needSub) init.sub = true
  const [subUrl, setSubUrl] = useState(subCur.baseUrl ?? "")
  const [subKey, setSubKey] = useState("")
  const [subKeyEditing, setSubKeyEditing] = useState(false)
  const [hasSubKey, setHasSubKey] = useState(!!subCur.adminKey)
  const [subError, setSubError] = useState("")
  const cur = needParrot ? getConfig() : { baseUrl: "", managementKey: "" }
  if (needParrot) init.parrot = true
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "")
  const [key, setKey] = useState("")
  const [keyEditing, setKeyEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [browserError, setBrowserError] = useState("")
  const [refreshMinutes, setRefreshMinutes] = useState(String(getRefreshMinutes()))
  const [, setAccounts] = useState<Account[]>([])
  const listScope = accountScope(source)
  const visible = source !== "official" && getSource() === source ? cachedAccounts() : []
  const sortedLogins = source === "official" ? sortAccounts(logins, "official") : []
  const loginAccountById = new Map((source === "official" && logins.length ? managementAccounts(logins, false) : []).map(a => [a.id, a]))
  const hiddenCount = hiddenAccountIds(source).length
  const widgetNames = getWidgetNames(source) ?? {}
  const [agBrowser, setAGBrowser] = useState<AntigravityLogin | null>(null)

  function ensureSourceConfig(nextSource: DataSource, nextStats: StatisticsSource) {
    if (nextSource === "official" && !init.logins) {
      init.logins = officialAccounts()
      setLogins(init.logins)
    }
    if ((nextSource === "parrot" || nextStats === "parrot") && !init.parrot) {
      init.parrot = true
      setBaseUrl(getConfig().baseUrl ?? "")
    }
    if ((nextSource === "sub2api" || nextStats === "sub2api") && !init.sub) {
      init.sub = true
      const sc = getSub2APIConfig()
      setSubUrl(sc.baseUrl ?? "")
      setHasSubKey(!!sc.adminKey)
    }
  }

  useEffect(() => () => { if (auth.antigravity) cancelAntigravityLogin(auth.antigravity); auth.antigravity = null; if (auth.workbuddy) cancelWorkBuddyLogin(auth.workbuddy); auth.workbuddy = null; if (auth.codex) cancelCodexBrowserLogin(auth.codex); auth.codex = null; auth.alive = false; auth.releaseBrowser?.(); auth.releaseBrowser = null; if (auth.claude) cancelClaudeLogin(auth.claude); auth.claude = null; auth.epoch++ }, [])

  async function changeSource(value: string) {
    try {
      if (officialEditMode) officialEditMode.setValue(EditMode.inactive())
      setSortUI(current => ({ ...current, editing: false }))
    } catch { setSortUI({ editing: false, failed: true }) }
    stopAuth()
    setSubError("")
    const next = value as DataSource
    saveSource(next)
    setSource(next)
    ensureSourceConfig(next, statisticsSource)
    setAccounts(cachedAccounts())
    if (!await test()) await Widget.reloadAll()
  }

  async function addOfficial() {
    if (loginProvider === "deepseek") {
      if (!auth.alive || auth.running || busy || auth.claude || getSource() !== "official") return
      setDSToken(""); setDSAdding(true); return
    }
    if (loginProvider === "workbuddy") { await startWorkBuddy(); return }
    if (loginProvider === "claude") { startClaude(); return }
    if (loginProvider === "antigravity") { startLoopback("antigravity"); return }
    startLoopback("codex")
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
    const browserCancelled = new Error("WorkBuddy authorization cancelled")
    auth.running = true; setBusy(true); setBrowserError("")
    try {
      // Presentation starts before polling; its own ephemeral cookies are never copied into fetch.
      const shown = presentIsolatedAuthorization(release => { if (valid()) auth.releaseBrowser = release }, d.url, pushAuthorization)
      const completed = finishWorkBuddyLogin(d, valid).then(() => {
        if (!valid()) return
        saved = true; setLogins(officialAccounts()); auth.releaseBrowser?.(); auth.releaseBrowser = null
      })
      await Promise.all([completed, shown.then(() => { if (!saved && valid()) throw browserCancelled })])
      if (valid() && saved) { auth.workbuddy = null; setWorkbuddy(null); await test() }
    } catch (e: any) {
      if (valid()) { cancelWorkBuddyLogin(d); auth.workbuddy = null; setWorkbuddy(null); if (e !== browserCancelled) setBrowserError(e.message || "WorkBuddy登录失败，请重试"); auth.releaseBrowser?.(); auth.releaseBrowser = null }
    } finally { if (auth.alive && epoch === auth.epoch) { auth.running = false; setBusy(false) } }
  }
  const loopbackProviders = {
    codex: { label: "Codex", begin: beginCodexBrowserLogin, finish: finishCodexBrowserLogin, set: setCodexBrowser },
    antigravity: { label: "Antigravity", begin: beginAntigravityLogin, finish: finishAntigravityLogin, set: setAGBrowser },
  } as const
  function startLoopback(kind: keyof typeof loopbackProviders) {
    if (!auth.alive || getSource() !== "official" || auth.running || busy) return
    const p = loopbackProviders[kind]
    stopAuth(); setBrowserError("")
    if (typeof WebViewController !== "function") { setBrowserError(`${p.label}浏览器登录缺少WebViewController，请重新登录`); return }
    try {
      const d = p.begin(
        () => { if (auth[kind] === d) void completeLoopback(kind, d) },
        () => { if (auth[kind] === d) { stopAuth(); auth.running = false; setBusy(false); setBrowserError(`${p.label}本次本机登录等待超时，请重新登录`) } },
        () => { if (auth[kind] === d) { stopAuth(); auth.running = false; setBusy(false); setBrowserError(`${p.label}官方授权未完成，请重新登录`) } },
      )
      auth[kind] = d as any; p.set(d as any)
    } catch (e: any) { setBrowserError(e.message) }
  }
  async function completeLoopback(kind: keyof typeof loopbackProviders, d: CodexBrowserLogin) {
    const p = loopbackProviders[kind], epoch = auth.epoch
    const valid = () => auth.alive && auth[kind] === d && auth.epoch === epoch && getSource() === "official"
    if (!valid() || d.consumed) return
    auth.running = true; setBusy(true)
    try {
      await (p.finish as (d: any, active: () => boolean) => Promise<void>)(d, valid)
      if (!valid()) return
      auth[kind] = null; p.set(null); setLogins(officialAccounts()); auth.releaseBrowser?.(); auth.releaseBrowser = null; await test()
    } catch (e: any) { if (valid()) { auth[kind] = null; p.set(null); setBrowserError(e.message || `${p.label}浏览器登录失败，请重新登录`) } }
    finally { if (auth.alive && epoch === auth.epoch) { auth.running = false; setBusy(false) } }
  }
  async function openLoopback(kind: keyof typeof loopbackProviders) {
    const p = loopbackProviders[kind], d = auth[kind]
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth[kind] === d && auth.epoch === epoch && getSource() === "official"
    auth.running = true; setBusy(true); setBrowserError("")
    try { await presentIsolatedAuthorization(release => { if (valid()) auth.releaseBrowser = release }, d.url, pushAuthorization) }
    catch (e: any) { if (valid()) setBrowserError((e.message || `无法打开${p.label}授权页`) + "，请重试登录") }
    finally {
      // Native back/load failure ends an unconsumed attempt, not a token exchange.
      if (valid() && !d.consumed) { stopAuth(); setBusy(false) }
    }
  }
  function startClaude(manual = false) {
    if (!auth.alive || auth.running || busy || getSource() !== "official") return
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
    } finally { if (auth.alive && epoch === auth.epoch) { auth.running = false; setBusy(false) } }
  }
  async function openClaude() {
    const d = auth.claude
    if (!d || auth.running) return
    const epoch = auth.epoch
    const valid = () => auth.alive && auth.claude === d && auth.epoch === epoch && getSource() === "official"
    auth.running = true; setBusy(true); setBrowserError("")
    try {
      await presentIsolatedAuthorization(release => { if (valid()) auth.releaseBrowser = release }, d.url, pushAuthorization)
      if (valid() && !d.consumed && d.code) await completeClaude(d)
    } catch (e: any) { if (valid()) {
      const message = e?.message === UNSUPPORTED_BROWSER || e?.message?.startsWith("授权页面加载") ? e.message : "无法打开Claude授权页，请重试"
      setBrowserError(message)
    } }
    finally {
      // Closing the browser must not unlock an exchange/profile request still in flight.
      if (valid() && !d.consumed) {
        // No loopback listener in manual fallback: keep code/state for paste, but no active I/O lock.
        if (d.manual) auth.running = false
        else stopAuth()
        setBusy(false)
      }
    }
  }

  async function test(): Promise<boolean> {
    let reloaded = false
    const requestSource = getSource(), requestScope = accountScope(requestSource), requestStats = getStatisticsSource()
    setBusy(true)
    try {
      const r = await loadUsage()
      // A late refresh from the previous source must not replace this source's account list.
      if (!auth.alive || getSource() !== requestSource || accountScope(requestSource) !== requestScope || getStatisticsSource() !== requestStats) return false
      if (r.data) {
        setAccounts(cachedAccounts())
        if (requestSource === "official") setLogins(officialAccounts())
        await Widget.reloadAll()
        reloaded = true
      }
    } catch { /* failures keep the existing cached list */ }
    setBusy(false)
    return reloaded
  }

  // The system has already moved Observable data; persist its final stable-ID permutation.
  function commitLogins(ids: string[], previous: ReturnType<typeof officialAccounts>): boolean {
    if (busy || claude || codexBrowser || workbuddy || agBrowser || getSource() !== "official") return false
    const current = sortAccounts(officialAccounts(), "official")
    if (!sameRowOrder(current, previous)) return false
    saveAccountOrder(ids, "official")
    const byId = new Map(current.map(a => [a.id, a]))
    setLogins(ids.map(id => byId.get(id)!))
    setAccounts(cachedAccounts())
    void Widget.reloadAll()
    return true
  }
  function commitRemote(ids: string[], previous: Account[], target: DataSource, scope: number): boolean {
    if (busy || getSource() !== target || accountScope(target) !== scope || !sameRowOrder(cachedAccounts(), previous)) return false
    if (!saveVisibleAccountOrder(ids, target, scope)) return false
    setAccounts(cachedAccounts())
    void Widget.reloadAll()
    return true
  }
  const loginRows = useSortableRows(sortedLogins, source === "official", commitLogins)
  // Separate bindings ensure an old native source cannot reorder the next source's data.
  const parrotRows = useSortableRows(source === "parrot" ? visible : [], source === "parrot",
    (ids, previous) => commitRemote(ids, previous, "parrot", listScope))
  const subRows = useSortableRows(source === "sub2api" ? visible : [], source === "sub2api",
    (ids, previous) => commitRemote(ids, previous, "sub2api", listScope))
  const remoteRows = source === "sub2api" ? subRows : parrotRows
  const remoteRow = (a: Account, i: number) => <HStack key={a.id} trailingSwipeActions={{ allowsFullSwipe: false, actions: [
    <Button title="隐藏" role="destructive" disabled={busy} action={async () => {
      if (busy || !hideAccount(a.id, source, listScope)) return
      setAccounts(cachedAccounts())
      await Widget.reloadAll()
    }} />
  ] }}>
    <NavigationLink destination={<WidgetNamePage account={a} source={source} expectedScope={listScope} onSaved={() => { if (getSource() === source && accountScope(source) === listScope) setAccounts(cachedAccounts()) }} />}>
      <VStack alignment="leading" spacing={6} padding={{ vertical: 3 }}>
        <AccountHeaderLine index={i} provider={a.provider} name={a.name} alias={widgetNames[a.id] || ""} acc={a} />
        <AccountDashboardMeta acc={a} />
      </VStack>
    </NavigationLink>
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

  const loginRow = (a: ReturnType<typeof officialAccounts>[number], i: number) => {
    const detailAcc = loginAccountById.get(a.id) ?? { id: a.id, name: a.name, provider: a.provider, enabled: true, available: true, fiveHour: { usedPercent: null, remainingPercent: null, resetsAt: null }, sevenDay: { usedPercent: null, remainingPercent: null, resetsAt: null }, resetCredits: null }
    return <HStack key={a.id} trailingSwipeActions={{ allowsFullSwipe: false, actions: [
          <Button title="删除" role="destructive" disabled={busy || !!claude || !!codexBrowser || !!workbuddy || !!agBrowser} action={async () => {
          if (getSource() !== "official") return
          try {
            logoutOfficial(a.id)
            setLogins(officialAccounts())
            setAccounts(cachedAccounts())
            if (!await test()) await Widget.reloadAll()
          } catch { /* local removal failure leaves the row in place */ }
        }} />
        ] }}>
          <NavigationLink destination={<WidgetNamePage account={detailAcc} source="official" onSaved={() => setAccounts(cachedAccounts())} />}>
            <VStack alignment="leading" spacing={6} padding={{ vertical: 3 }}>
              <AccountHeaderLine index={i} provider={a.provider} name={a.provider === "claude" ? a.email || "邮箱未提供" : a.name} fixed alias={widgetNames[a.id] || ""} acc={detailAcc} />
              <AccountDashboardMeta acc={detailAcc} />
            </VStack>
          </NavigationLink>
          <Spacer />
        </HStack>
  }

  return <NavigationStack>
    <Form
      // The editing list owner must receive the binding, not only its child Section.
      environments={source === "official" && loginRows && officialEditMode ? { editMode: officialEditMode } : undefined}
      navigationDestination={{
        isPresented: authorization != null,
        onChanged: (value: boolean) => { if (!value) authorization?.onBack() },
        content: authorization ? <WebView
          controller={authorization.controller}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          navigationTitle="官方授权（临时会话）"
          navigationBarTitleDisplayMode="inline"
        /> : <Text />,
      }}
      navigationTitle={"AI 用量"}
      navigationBarTitleDisplayMode={"inline"}
      toolbar={{
        cancellationAction: <Button title={"完成"} systemImage="xmark" action={dismiss} />,
        primaryAction: <Button title={busy ? "刷新中…" : "刷新"} systemImage="arrow.clockwise" disabled={busy || (!!claude && !claude.manual) || !!codexBrowser || !!workbuddy || !!agBrowser} action={async () => { if (busy || auth.running || (auth.claude && !auth.claude.manual) || auth.codex || auth.workbuddy || auth.antigravity) return; await test() }} />,
      }}
    >
      <Section>
        <DashboardHeroCard source={source} statisticsSource={statisticsSource} accountCount={source === "official" ? sortedLogins.length : visible.length} hiddenCount={hiddenCount} />
      </Section>

      {source === "official" ? <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>登录账号</Text><Spacer />{loginRows && logins.length > 1 ? officialEditMode ? <Button title={sortUI.editing ? "完成" : "编辑排序"} action={() => {
        if (getSource() !== "official") return
        try {
          const next = officialEditMode.value.isEditing ? EditMode.inactive() : EditMode.active()
          officialEditMode.setValue(next)
          // Match the calendar sort control: notify the binding, then refresh the nested header via state.
          setSortUI({ editing: next.isEditing, failed: false })
        } catch { setSortUI({ editing: false, failed: true }) }
      }} /> : <EditButton /> : null}</HStack>}>
        <HStack frame={{ maxWidth: "infinity" }}>
          {!dsAdding && (!claude || claude.manual && !busy) && !codexBrowser && !workbuddy && !wbPreparing && !agBrowser
            ? <Button title={"添加账号"} systemImage="plus.circle.fill" action={addOfficial} disabled={busy || (loginProvider === "claude" && claudeCooling)} />
            : <Text foregroundStyle="secondaryLabel">{loginProvider === "deepseek" ? "API Key" : "授权进行中"}</Text>}
          <Spacer />
          <Picker title="" pickerStyle="menu" tint="secondaryLabel" value={loginProvider} onChanged={(value: string) => { stopAuth(); setLoginProvider(value); setBusy(false); setBrowserError("") }} disabled={busy}>
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
        {loginProvider === "claude" && claudeCooling ? <Text font={12} foregroundStyle={ORANGE}>{claudeCooldownMessage()}</Text> : null}
        {loginProvider === "claude" && claudeProgress && claudeProgress !== "等待Claude回调（尚未收到）" ? <Text font={12} foregroundStyle={SUB}>{claudeProgress}</Text> : null}
        {wbPreparing ? <Button title="取消登录" action={() => { stopAuth(); setBusy(false) }} /> : null}
        {workbuddy ? <>
          <Button title="点击登录" action={openWorkBuddy} disabled={busy} />
          <Button title="取消登录" action={() => { stopAuth(); auth.running = false; setBusy(false) }} />
        </> : null}
        {agBrowser ? <>
          <Button title="点击登录" action={() => openLoopback("antigravity")} disabled={busy} />
          {browserError ? <Text font={12} foregroundStyle="systemRed">{browserError}</Text> : null}
          <Button title="取消登录" action={() => { stopAuth(); setBusy(false) }} />
        </> : null}
        {codexBrowser ? <>
          <Button title="点击登录" action={() => openLoopback("codex")} disabled={busy} />
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
        {loginRows ? <ForEach key="official" data={loginRows} editActions="move" builder={loginRow} />
          : sortedLogins.map(loginRow)}
        {!loginRows && logins.length > 1 ? <NavigationLink destination={<AccountOrderPage key="official" source="official" onSaved={() => { setAccounts(cachedAccounts()); setLogins(sortAccounts(officialAccounts(), "official")) }} />}>
          <Text>账号排序</Text>
        </NavigationLink> : null}
      </Section> : null}

      {source !== "official" ? <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>目前账号</Text><Spacer />{remoteRows && visible.length > 1 ? <EditButton /> : null}</HStack>}>
        {remoteRows ? <ForEach key={`${source}:${listScope}`} data={remoteRows} editActions="move" builder={remoteRow} /> : visible.map(remoteRow)}
        {!remoteRows && visible.length > 1 ? <NavigationLink destination={<AccountOrderPage key={source} source={source} expectedScope={listScope} onSaved={() => { if (getSource() === source && accountScope(source) === listScope) setAccounts(cachedAccounts()) }} />}>
          <Text>账号排序</Text>
        </NavigationLink> : null}
        {hiddenCount > 0 ? <Button title={`恢复全部隐藏账号（${hiddenCount}）`} systemImage="eye" disabled={busy} action={async () => {
          if (busy || !restoreHiddenAccounts(source, listScope)) return
          setAccounts(cachedAccounts())
          await Widget.reloadAll()
        }} /> : null}
        {!visible.length ? <HStack spacing={8} padding={{ vertical: 4 }}>
          <Image systemName={hiddenCount ? "eye.slash" : "tray"} font={14} foregroundStyle={SUB} />
          <Text font={13} foregroundStyle={SUB}>{hiddenCount ? "账号已全部在本机隐藏，可恢复；服务器账号未删除。" : "连接成功后显示账号列表"}</Text>
        </HStack> : null}
      </Section> : null}

      <Section header={<HStack frame={{ maxWidth: "infinity" }}><Text>数据来源</Text><Spacer /><Text font={11} fontWeight="medium" monospacedDigit foregroundStyle={SUB}>{VERSION}</Text></HStack>}>
        <Picker title={"账号来源"} value={source} onChanged={changeSource} disabled={busy}>
          <Text tag={"official"}>OAuth,API,Token</Text>
          <Text tag={"parrot"}>Parrot</Text>
          <Text tag="sub2api">Sub2API</Text>
        </Picker>
        <Picker title="统计来源" value={statisticsSource} disabled={busy} onChanged={async (value: string) => {
          const next = value as StatisticsSource
          setSubError(""); saveStatisticsSource(next); setStatisticsSource(next); ensureSourceConfig(source, next); await test()
        }}>
          <Text tag="parrot">Parrot</Text><Text tag="sub2api">Sub2API</Text>
        </Picker>
      </Section>
      {source === "parrot" || statisticsSource === "parrot" ? <Section header={<Text>Parrot 连接</Text>}>
        <TextField title={"地址"} value={baseUrl} onChanged={setBaseUrl} prompt={"填写你自己的 Parrot 地址"} />
        <TextField title={"管理密钥"} value={keyEditing ? key : maskedKey(key || cur.managementKey || "")} onFocus={() => { setKey(""); setKeyEditing(true) }} onBlur={() => setKeyEditing(false)} onChanged={(value: string) => { if (keyEditing && value !== maskedKey(cur.managementKey || "")) setKey(value) }} prompt="managementKey" />
        <Button title={busy ? "处理中…" : "保存并测试"} systemImage="checkmark.circle.fill" action={save} disabled={busy} />
      </Section> : null}
      {statisticsSource === "sub2api" || source === "sub2api" ? <Section header={<Text>Sub2API连接</Text>}>
        <TextField title="Sub2API地址" value={subUrl} onChanged={(value: string) => { setSubError(""); setSubUrl(value) }} prompt="https://你的部署地址" />
        <TextField title="Sub2API管理员密钥" value={subKeyEditing ? subKey : maskedKey(subKey || subCur.adminKey || "")} onFocus={() => { setSubKey(""); setSubKeyEditing(true) }} onBlur={() => setSubKeyEditing(false)} onChanged={(value: string) => { if (subKeyEditing && value !== maskedKey(subCur.adminKey || "")) { setSubError(""); setSubKey(value) } }} prompt="Admin API Key" />
        {subError ? <Text font={12} foregroundStyle="systemRed">{subError}</Text> : null}
        <Button title="保存并测试" systemImage="checkmark.circle.fill" disabled={busy} action={async () => {
          try { saveSub2APIConfig(subUrl, subKey.trim() || getSub2APIConfig().adminKey || "", subCur.timezone); setSubError(""); setSubKey(""); setSubKeyEditing(false); setHasSubKey(true); setAccounts(cachedAccounts()); await test() }
          catch (e: any) { setSubError(e?.message || "Sub2API配置无效") }
        }} />
        {hasSubKey ? <Button title="清除Sub2API配置" role="destructive" disabled={busy} action={async () => { clearSub2APIConfig(); setSubError(""); setSubKey(""); setSubKeyEditing(false); setSubUrl(""); setHasSubKey(false); setAccounts(cachedAccounts()); await test() }} /> : null}
      </Section> : null}

      <Section header={<Text>刷新预览</Text>}>
        <Picker title={"刷新间隔"} value={refreshMinutes} onChanged={async (value: string) => {
          setRefreshMinutes(value)
          saveRefreshMinutes(Number(value))
          await Widget.reloadAll()
        }}>
          {REFRESH_OPTIONS.map(m => <Text tag={String(m)}>{m}分钟</Text>)}
        </Picker>
        <Button title="预览组件" systemImage="rectangle.on.rectangle.angled" action={() => Widget.preview({ family: "systemSmall" })} />
      </Section>


    </Form>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <SettingsView />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}

run()
