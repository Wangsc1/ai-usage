import { HStack, VStack, ZStack, Text, Spacer, Image, SVG, RoundedRectangle, Rectangle, LazyVGrid, Widget, VirtualNode } from "scripting"
import { loadUsage, Account, QuotaWindow, UsageData, fmtReset, fmtResetDays, fmtTime, fmtTokens, fmtUsd, widgetAccounts, getRefreshMinutes } from "./api"

// ---------- 配色（浅色 / 深色自动切换） ----------
type DC = { light: string; dark: string }
const C = (light: string, dark: string): DC => ({ light, dark })

// 渐变背景：浅色参考用户车载组件，顶部浅冰蓝→底部近白；深色保持蓝灰→蓝绿
const BG = {
  light: {
    gradient: [
      { color: "#D8ECF7", location: 0 },
      { color: "#E5F2F9", location: 0.38 },
      { color: "#F5FBFC", location: 0.8 },
      { color: "#FAFDFE", location: 1 },
    ],
    startPoint: { x: 0.5, y: 0 },
    endPoint: { x: 0.5, y: 1 },
  },
  dark: {
    gradient: [
      { color: "#25282F", location: 0 },
      { color: "#232731", location: 0.45 },
      { color: "#28303F", location: 0.75 },
      { color: "#335A76", location: 1 },
    ],
    startPoint: { x: 0.3, y: 0 },
    endPoint: { x: 0.7, y: 1 },
  },
} as any

const FG = C("#1C1C1E", "#FFFFFF")
const SUB = C("#5E6068", "#8E8E93")
const SEG_OFF = C("rgba(0, 0, 0, 0.13)", "rgba(255, 255, 255, 0.14)")
const DIVIDER = C("rgba(0, 0, 0, 0.12)", "rgba(255, 255, 255, 0.10)")
const GREEN = C("#2E9E4F", "#7ED957")
const ORANGE = C("#D9770B", "#FF9F0A")
const RED = C("#D93025", "#FF453A")
// SVG 里只能写具体颜色，按模式各生成一份
const LCD_ON = C("#1C1C1E", "#FFFFFF")
const LCD_OFF = C("#B9BCC3", "#363A44")

function levelColor(remaining: number | null): DC {
  if (remaining == null) return SUB
  if (remaining <= 20) return RED
  if (remaining <= 60) return ORANGE
  return GREEN
}

// ---------- 七段数码管数字 ----------
const SEG: Record<string, [number, number, number, number]> = {
  a: [1.7, 0, 6.6, 2.4], b: [7.6, 1.7, 2.4, 6.9], c: [7.6, 9.4, 2.4, 6.9],
  d: [1.7, 15.6, 6.6, 2.4], e: [0, 9.4, 2.4, 6.9], f: [0, 1.7, 2.4, 6.9], g: [1.7, 7.8, 6.6, 2.4],
}
const DIGIT: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
}

function lcdSvg(value: number | null, on: string, off: string): string {
  const s = value == null ? " --" : String(Math.max(0, Math.min(100, Math.round(value)))).padStart(3, " ")
  const W = 10, GAP = 3.2, H = 18
  let rects = ""
  for (let i = 0; i < 3; i++) {
    const ox = i * (W + GAP)
    const segs = DIGIT[s[i]] ?? ""
    for (const k of Object.keys(SEG)) {
      const [x, y, w, h] = SEG[k]
      const lit = segs.includes(k)
      if (!lit) continue // 只画点亮笔画，去掉暗色底影
      rects += `<rect x="${(ox + x).toFixed(1)}" y="${y}" width="${w}" height="${h}" rx="0.9" fill="${lit ? on : off}"/>`
    }
  }
  const vw = 3 * W + 2 * GAP
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw * 8}" height="${H * 8}" viewBox="0 0 ${vw} ${H}">${rects}</svg>`
}

// 数码管百分比：height 为数字高度
function Lcd({ value, height }: { value: number | null; height: number }) {
  const width = height * (36.4 / 18)
  return <HStack alignment="bottom" spacing={2}>
    <SVG
      code={{
        light: lcdSvg(value, LCD_ON.light, LCD_OFF.light),
        dark: lcdSvg(value, LCD_ON.dark, LCD_OFF.dark),
      }}
      resizable
      frame={{ width, height }}
    />
    <Text font={Math.max(9, height * 0.42)} fontWeight="bold" foregroundStyle={levelColor(value)}>%</Text>
  </HStack>
}

// ---------- 分段进度条（剩余额度） ----------
function SegBar({ remaining, count, height }: { remaining: number | null; count: number; height: number }) {
  const lit = remaining == null ? 0 : Math.round((Math.max(0, Math.min(100, remaining)) / 100) * count)
  const head = levelColor(remaining)
  const segs: VirtualNode[] = []
  for (let i = 0; i < count; i++) {
    const color = i < lit - 1 ? FG : i === lit - 1 ? head : SEG_OFF
    segs.push(<RoundedRectangle fill={color} cornerRadius={height * 0.3} frame={{ maxWidth: "infinity", height }} />)
  }
  return <HStack spacing={height * 0.45}>{segs}</HStack>
}

// ---------- 图标 / 名称 ----------
// 图标路径来自 Simple Icons（CC0）
const CLAUDE_PATH = "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
const OPENAI_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
const iconSvg = (path: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><path fill="${color}" d="${path}"/></svg>`
const CLAUDE_SVG = iconSvg(CLAUDE_PATH, "#D97757")
const OPENAI_SVG = { light: iconSvg(OPENAI_PATH, "#1C1C1E"), dark: iconSvg(OPENAI_PATH, "#FFFFFF") }

function ProviderIcon({ provider, size }: { provider: string; size: number }) {
  if (provider === "claude") return <SVG code={CLAUDE_SVG} resizable frame={{ width: size, height: size }} />
  if (provider === "openai") return <SVG code={OPENAI_SVG} resizable frame={{ width: size, height: size }} />
  return <Image systemName="sparkle" font={size * 0.85} foregroundStyle={FG} frame={{ width: size, height: size }} />
}

function shortName(acc: Account) {
  return acc.name.replace(/@.*$/, "")
}

function providerName(p: string) {
  return p === "claude" ? "Claude" : p === "openai" ? "Codex" : p
}

function AccountTitle({ acc, font }: { acc: Account; font: number }) {
  return <HStack spacing={5}>
    <ProviderIcon provider={acc.provider} size={font + 1} />
    <Text font={font} fontWeight="semibold" foregroundStyle={FG} lineLimit={1}>{providerName(acc.provider)}</Text>
    <Text font={font - 3} foregroundStyle={SUB} lineLimit={1}>{shortName(acc)}</Text>
    {acc.resetCredits != null
      ? <Text font={font - 3} monospacedDigit foregroundStyle={acc.resetCredits > 0 ? GREEN : SUB} lineLimit={1}>重置:{acc.resetCredits}</Text>
      : null}
    {!acc.enabled ? <Text font={font - 3} foregroundStyle={SUB}>已停用</Text> : acc.available ? null : <Text font={font - 3} foregroundStyle={RED}>不可用</Text>}
  </HStack>
}

function RefreshTime({ data, stale }: { data: UsageData; stale: boolean }) {
  return <HStack spacing={3}>
    <Image systemName={stale ? "wifi.slash" : "arrow.triangle.2.circlepath"} font={8} foregroundStyle={stale ? ORANGE : SUB} />
    <Text font={9} monospacedDigit foregroundStyle={SUB}>{fmtTime(data.fetchedAt)}</Text>
  </HStack>
}

type Win = { label: string; w: QuotaWindow; fmt: (iso: string | null) => string }
const windowsOf = (a: Account): Win[] => [
  { label: "5 h", w: a.fiveHour, fmt: fmtReset },
  { label: "每周", w: a.sevenDay, fmt: fmtResetDays },
]

// Small single-account stats use the same Parrot summary scope as Large, not per-account totals.
const SMALL_STAT_COLUMNS = Array.from({ length: 4 }, () => ({
  size: { type: "flexible" as const, min: 0, max: "infinity" as const },
  spacing: 2,
  alignment: "leading" as const,
}))

function SmallStats({ data }: { data: UsageData }) {
  const today = data.today, month = data.month
  if (!today || !month) return <Text font={7} foregroundStyle={SUB} lineLimit={2}>今日/本月统计未提供</Text>
  const stat = (label: string, value: string) => <VStack alignment="leading" spacing={1}
    frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
    <Text font={7} foregroundStyle={SUB} lineLimit={1} minScaleFactor={0.7}>{label}</Text>
    <Text font={9} fontWeight="semibold" monospacedDigit foregroundStyle={FG} lineLimit={1} minScaleFactor={0.65}>{value}</Text>
  </VStack>
  const row = (m: NonNullable<UsageData["today"]>) => {
    const inputSide = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens
    const rate = inputSide > 0 ? (m.cacheReadTokens / inputSide * 100).toFixed(1) + "%" : "--"
    return <LazyVGrid columns={SMALL_STAT_COLUMNS} alignment="leading" spacing={0}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      {stat("缓存", fmtTokens(m.cacheReadTokens + m.cacheCreationTokens))}
      {stat("缓存率", rate)}
      {stat("Token", fmtTokens(m.totalTokens))}
      {stat("花费", fmtUsd(m.costUsd))}
    </LazyVGrid>
  }
  return <VStack alignment="leading" spacing={2}>
    <Text font={7} foregroundStyle={SUB}>今日</Text>
    {row(today)}
    <Text font={7} foregroundStyle={SUB}>本月</Text>
    {row(month)}
  </VStack>
}

// ---------- 小号：上下两个账号，各自5 h在上、每周在下 ----------
function Small({ data, stale }: { data: UsageData; stale: boolean }) {
  const s: Scale = { title: 11, label: 8, lcd: 10, bar: 3, segs: 10, gap: 1 }
  const accounts = data.accounts.slice(0, 2)
  // Only the final one-account selection gets stats. The two-account path below is unchanged.
  if (data.accounts.length === 1) return <VStack alignment="leading" spacing={4}
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <SmallStats data={data} />
    <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack alignment="leading" spacing={3}>
        <AccountTitle acc={accounts[0]} font={s.title} />
        {windowsOf(accounts[0]).map(x => <QuadWindow label={x.label} w={x.w} fmt={x.fmt} s={s} />)}
      </VStack>
    </VStack>
  </VStack>
  // 分隔线独立铺在几何中心，不放进下方账号的内容堆栈。
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    {accounts.length > 1 ? <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} /> : null}
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {accounts.map((acc, i) => <VStack
        padding={{ top: i > 0 ? 4 : 0, bottom: i === 0 && accounts.length > 1 ? 4 : 0 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <VStack alignment="leading" spacing={3}>
          <AccountTitle acc={acc} font={s.title} />
          {windowsOf(acc).map(x => <QuadWindow label={x.label} w={x.w} fmt={x.fmt} s={s} />)}
        </VStack>
      </VStack>)}
    </VStack>
  </ZStack>
}

// ---------- 四宫格：每格一个账号，5小时在上、每周在下 ----------
type Scale = { title: number; label: number; lcd: number; bar: number; segs: number; gap: number }
const MEDIUM_SCALE: Scale = { title: 12, label: 9, lcd: 11, bar: 4, segs: 10, gap: 2 }

function QuadWindow({ label, w, fmt, s }: Win & { s: Scale }) {
  return <VStack alignment="leading" spacing={s.gap}>
    <HStack alignment="bottom" spacing={2}>
      {/* 标签固定宽度（约两个汉字），“5 h”与“每周”对齐，后面的倒计时也对齐 */}
      <Text font={s.label} foregroundStyle={SUB} lineLimit={1} frame={{ width: s.label * 2.1, alignment: "leading" as any }}>{label}</Text>
      <Text font={s.label} monospacedDigit foregroundStyle={SUB} lineLimit={1} minScaleFactor={0.8}>
        · {fmt(w.resetsAt)}
      </Text>
      <Spacer />
      <Lcd value={w.remainingPercent} height={s.lcd} />
    </HStack>
    <SegBar remaining={w.remainingPercent} count={s.segs} height={s.bar} />
  </VStack>
}

function Quad({ acc, s }: { acc?: Account; s: Scale }) {
  if (!acc) return <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><Spacer /></VStack>
  return <VStack alignment="leading" spacing={s.gap + 1} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" as any }}>
    <AccountTitle acc={acc} font={s.title} />
    {windowsOf(acc).map(x => <QuadWindow label={x.label} w={x.w} fmt={x.fmt} s={s} />)}
  </VStack>
}

// 十字分隔线画在底层，竖线贯穿整个高度、横线贯穿整个宽度
function QuadGrid({ accounts, s }: { accounts: Account[]; s: Scale }) {
  const a = accounts.slice(0, 4)
  const pad = s.gap * 2 + 3
  const cell = (acc?: Account, top = false, left = false) =>
    <VStack
      padding={{ top: top ? 0 : pad, bottom: top ? pad : 0, leading: left ? 0 : 10, trailing: left ? 10 : 0 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
    >
      <Quad acc={acc} s={s} />
    </VStack>
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <Rectangle fill={DIVIDER} frame={{ width: 1, maxHeight: "infinity" }} />
    <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
    <VStack spacing={0}>
      <HStack spacing={0}>{cell(a[0], true, true)}{cell(a[1], true, false)}</HStack>
      <HStack spacing={0}>{cell(a[2], false, true)}{cell(a[3], false, false)}</HStack>
    </VStack>
  </ZStack>
}

// ---------- 中号：四宫格，最多 4 个账号 ----------
function Medium({ data }: { data: UsageData }) {
  return <QuadGrid accounts={data.accounts} s={MEDIUM_SCALE} />
}

// ---------- 大号：顶部今日统计 + 从上到下四个账号 ----------
function LargeQuota({ label, w, fmt }: Win) {
  return <HStack spacing={5}>
    <HStack spacing={1}>
      <Text font={9} foregroundStyle={SUB} frame={{ width: 20, alignment: "leading" as any }}>{label}</Text>
      <Text font={9} monospacedDigit foregroundStyle={SUB} lineLimit={1} minScaleFactor={0.8}
        frame={{ width: 65, alignment: "leading" as any }}>· {fmt(w.resetsAt)}</Text>
    </HStack>
    <SegBar remaining={w.remainingPercent} count={20} height={5} />
    <Lcd value={w.remainingPercent} height={12} />
  </HStack>
}

// Both periods share six equal flexible tracks, independent of text intrinsic width.
const STAT_COLUMNS = Array.from({ length: 6 }, () => ({
  size: { type: "flexible" as const, min: 0, max: "infinity" as const },
  spacing: 4,
  alignment: "leading" as const,
}))

function Large({ data, stale }: { data: UsageData; stale: boolean }) {
  const m = data.today
  const month = data.month
  // Token缓存命中率：缓存读取占全部输入侧Token的比例，不包含输出。
  const cacheRate = (m: NonNullable<UsageData["today"]>) => {
    const total = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens
    return total > 0 ? (m.cacheReadTokens / total * 100).toFixed(1) + "%" : "--"
  }
  const stat = (label: string, value: string) => <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
    <Text font={9} foregroundStyle={SUB} lineLimit={1} minScaleFactor={0.7}>{label}</Text>
    <Text font={12} fontWeight="semibold" monospacedDigit foregroundStyle={FG} lineLimit={1} minScaleFactor={0.7}>{value}</Text>
  </VStack>
  return <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    {m && month ? <>
    <Text font={9} foregroundStyle={SUB}>今日</Text>
    <LazyVGrid columns={STAT_COLUMNS} alignment="leading" spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      {stat("输入", fmtTokens(m.inputTokens))}
      {stat("输出", fmtTokens(m.outputTokens))}
      {stat("缓存", fmtTokens(m.cacheReadTokens + m.cacheCreationTokens))}
      {stat("缓存率", cacheRate(m))}
      {stat("Token", fmtTokens(m.totalTokens))}
      {stat("估算花费", fmtUsd(m.costUsd))}
    </LazyVGrid>
    <Text font={9} foregroundStyle={SUB}>本月</Text>
    <LazyVGrid columns={STAT_COLUMNS} alignment="leading" spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      {stat("输入", fmtTokens(month.inputTokens))}
      {stat("输出", fmtTokens(month.outputTokens))}
      {stat("缓存", fmtTokens(month.cacheReadTokens + month.cacheCreationTokens))}
      {stat("缓存率", cacheRate(month))}
      {stat("Token", fmtTokens(month.totalTokens))}
      {stat("估算花费", fmtUsd(month.costUsd))}
    </LazyVGrid>
    </> : <Text font={10} foregroundStyle={SUB}>官方未提供今日/本月Token与花费</Text>}
    <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
    <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {data.accounts.slice(0, 4).map((acc, i) => <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {i > 0 ? <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} /> : null}
        <AccountTitle acc={acc} font={12} />
        {windowsOf(acc).map(x => <LargeQuota label={x.label} w={x.w} fmt={x.fmt} />)}
      </VStack>)}
    </VStack>
  </VStack>
}

function Message({ text }: { text: string }) {
  return <VStack spacing={6}>
    <Spacer />
    <Image systemName="exclamationmark.triangle" font={20} foregroundStyle={ORANGE} />
    <Text font={11} multilineTextAlignment="center" foregroundStyle={SUB}>{text}</Text>
    <Spacer />
  </VStack>
}

function Root({ data, stale, error }: { data: UsageData | null; stale: boolean; error: string | null }) {
  let body: VirtualNode
  if (!data) body = <Message text={error ?? "无数据"} />
  else if (data.accounts.length === 0) body = <Message text="没有订阅账号" />
  else {
    const selected = widgetAccounts(data.accounts, Widget.parameter ?? "")
    const sorted = { ...data, accounts: selected }
    const f = Widget.family
    if (!selected.length) body = <Message text="请在脚本设置页选择账号，或在小组件参数填写账号序号" />
    else if (f === "systemSmall") body = <Small data={sorted} stale={stale} />
    else if (f === "systemLarge" || f === "systemExtraLarge") body = <Large data={sorted} stale={stale} />
    else body = <Medium data={sorted} />
  }
  return <ZStack
    padding={{ horizontal: 14, vertical: 12 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    widgetBackground={BG}
  >
    <ZStack padding={{ bottom: data ? 14 : 0 }} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>{body}</ZStack>
    {data ? <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Spacer />
      <HStack offset={{ x: 3, y: 6 }}><Spacer /><RefreshTime data={data} stale={stale} /></HStack>
    </VStack> : null}
  </ZStack>
}

async function run() {
  const r = await loadUsage()
  Widget.present(<Root data={r.data} stale={r.stale} error={r.error} />, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + getRefreshMinutes() * 60 * 1000) },
  })
}

run()
