import { HStack, VStack, ZStack, Text, Spacer, Image, SVG, RoundedRectangle, Rectangle, GeometryReader, Widget, VirtualNode, modifiers } from "scripting"
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
function SegBar({ remaining, count, height, fixedHeight = false }: { remaining: number | null; count: number; height: number; fixedHeight?: boolean }) {
  const lit = remaining == null ? 0 : Math.round((Math.max(0, Math.min(100, remaining)) / 100) * count)
  const head = levelColor(remaining)
  const segs: VirtualNode[] = []
  for (let i = 0; i < count; i++) {
    const color = i < lit - 1 ? FG : i === lit - 1 ? head : SEG_OFF
    segs.push(fixedHeight
      ? <RoundedRectangle fill={color} cornerRadius={height * 0.3}
          modifiers={modifiers().frame({ height }).frame({ maxWidth: "infinity" })} />
      : <RoundedRectangle fill={color} cornerRadius={height * 0.3} frame={{ maxWidth: "infinity", height }} />)
  }
  return <HStack spacing={height * 0.45}>{segs}</HStack>
}

// Same-screen Medium reference: outer horizontal padding 14, half-width cell, inner edge padding 10.
// Small and Medium bars have different available widths; preserve both and use Medium as the target.
function largeSegmentLayout(width: number, widgetWidth: number) {
  const mediumBarWidth = (widgetWidth - 28) / 2 - 10
  const target = Math.max(1, (mediumBarWidth - (MEDIUM_SCALE.segs - 1) * MEDIUM_SCALE.bar * 0.45) / MEDIUM_SCALE.segs)
  const gap = 5 * 0.45
  const count = Math.max(1, Math.round((width + gap) / (target + gap)))
  return { count, target, segmentWidth: (width - (count - 1) * gap) / count }
}
function LargeSegBar({ remaining }: { remaining: number | null }) {
  // Root owns the only horizontal inset (14pt each side); Large's bar occupies that full content width.
  const width = Widget.displaySize.width - 28
  return <VStack spacing={0} fixedSize={{ horizontal: false, vertical: true }}>
    <SegBar remaining={remaining} count={largeSegmentLayout(width, Widget.displaySize.width).count} height={5} fixedHeight />
  </VStack>
}

// ---------- 图标 / 名称 ----------
// 图标路径来自 Simple Icons（CC0）
const CLAUDE_PATH = "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
const OPENAI_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
const iconSvg = (path: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><path fill="${color}" d="${path}"/></svg>`
const CLAUDE_SVG = iconSvg(CLAUDE_PATH, "#D97757")
const OPENAI_SVG = { light: iconSvg(OPENAI_PATH, "#1C1C1E"), dark: iconSvg(OPENAI_PATH, "#FFFFFF") }

function ProviderIcon({ provider, size, muted = false }: { provider: string; size: number; muted?: boolean }) {
  // SVG paths have explicit fills; changing only the parent's foregroundStyle cannot gray them.
  const graySvg = (path: string) => ({ light: iconSvg(path, SUB.light), dark: iconSvg(path, SUB.dark) })
  if (provider === "claude") return <SVG code={muted ? graySvg(CLAUDE_PATH) : CLAUDE_SVG} resizable frame={{ width: size, height: size }} />
  if (provider === "openai") return <SVG code={muted ? graySvg(OPENAI_PATH) : OPENAI_SVG} resizable frame={{ width: size, height: size }} />
  return <Image systemName="sparkle" font={size * 0.85} foregroundStyle={muted ? SUB : FG} frame={{ width: size, height: size }} />
}

function shortName(acc: Account) {
  return acc.name.replace(/@.*$/, "")
}

function providerName(p: string) {
  return p === "claude" ? "Claude" : p === "openai" ? "Codex" : p
}

function AccountTitle({ acc, font }: { acc: Account; font: number }) {
  const showReset = typeof acc.resetCredits === "number" && Number.isFinite(acc.resetCredits) && acc.resetCredits > 0
  // Same full-width container as the quota rows: trailing reset text aligns to the entire LCD/% right edge.
  // Only the positive-count case changes layout; unknown and zero remain distinct data values, both hidden.
  return <HStack spacing={5} alignment={showReset ? "bottom" : undefined}
    frame={showReset ? { maxWidth: "infinity" } : undefined}>
    <ProviderIcon provider={acc.provider} size={font + 1} muted={!acc.enabled} />
    <Text font={font} fontWeight="semibold" foregroundStyle={acc.enabled ? FG : SUB} lineLimit={1}>{providerName(acc.provider)}</Text>
    <Text font={font - 3} foregroundStyle={SUB} lineLimit={1}>{shortName(acc)}</Text>
    {acc.enabled && !acc.available ? <Text font={font - 3} foregroundStyle={RED}>不可用</Text> : null}
    {showReset ? <Spacer /> : null}
    {showReset ? <Text font={font - 3} monospacedDigit foregroundStyle={GREEN} lineLimit={1}
      fixedSize={{ horizontal: true, vertical: true }}>重置：{acc.resetCredits}</Text> : null}
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

// Each intrinsic column owns BOTH periods: no Grid flexible-column compression or spanning headings.
type StatColumn = { label: string; today: string; month: string }
// Conservative SF text-width budget, NOT native text measurement. Fixed-size text is the no-ellipsis guard.
function statTextBudget(text: string, font: number): number {
  let em = 0
  for (const ch of text) em += /[0-9]/.test(ch) ? 0.7 : ch === "." ? 0.4 : ch === "$" ? 0.8 : /[MW%]/.test(ch) ? 1 : /[\u0000-\u007f]/.test(ch) ? 0.85 : 1
  return (em + 0.25) * font // reserve scales with the single shared font factor
}
function statsWidthBudget(columns: StatColumn[], labelFont: number, valueFont: number, gap: number, width: number) {
  const columnWidths = columns.map(c => Math.max(statTextBudget(c.label, labelFont), statTextBudget(c.today, valueFont),
    statTextBudget(c.month, valueFont), statTextBudget("今日", labelFont)))
  const natural = columnWidths.reduce((sum, w) => sum + w, 0) + gap * (columns.length - 1)
  const scale = Math.min(1, Math.max(1, width) / natural)
  return { columnWidths, natural, scale, fitted: natural * scale }
}
function PeriodStats({ columns, labelFont, valueFont, gap, verticalGap, contentWidth, sizingValueFont = valueFont }: {
  columns: StatColumn[]; labelFont: number; valueFont: number; gap: number; verticalGap: number; contentWidth?: number; sizingValueFont?: number
}) {
  // Bound reader height to six text lines + the existing inter-period/label gaps, rather than filling the widget.
  const height = 4 * Math.ceil(labelFont * 1.2) + 2 * Math.ceil(valueFont * 1.2) + 3 * verticalGap + 2
  const render = (width: number) => {
      // Large keeps the old 12pt width budget so title fitting remains identical while values render at 11pt.
      const { scale } = statsWidthBudget(columns, labelFont, sizingValueFont, gap, width)
      const cells: VirtualNode[] = []
      columns.forEach((c, i) => {
        if (i > 0) cells.push(<Spacer frame={{ minWidth: gap * scale, maxWidth: "infinity" }} />)
        const period = (heading: string, value: string) => <VStack alignment="leading" spacing={verticalGap}>
          <Text font={labelFont * scale} foregroundStyle={SUB} opacity={i === 0 ? 1 : 0}
            fixedSize={{ horizontal: true, vertical: true }} lineLimit={1}>{heading}</Text>
          <VStack alignment="leading" spacing={1}>
            <Text font={labelFont * scale} foregroundStyle={SUB} fixedSize={{ horizontal: true, vertical: true }} lineLimit={1}>{c.label}</Text>
            <Text font={valueFont * scale} fontWeight="semibold" monospacedDigit foregroundStyle={FG}
              fixedSize={{ horizontal: true, vertical: true }} lineLimit={1}>{value}</Text>
          </VStack>
        </VStack>
        cells.push(<VStack alignment="leading" spacing={verticalGap} fixedSize={{ horizontal: true, vertical: true }}>
          {period("今日", c.today)}
          {period("本月", c.month)}
        </VStack>)
      })
      return <HStack alignment="top" spacing={0} frame={{ width, alignment: "leading" as any }}
        fixedSize={contentWidth != null ? { horizontal: false, vertical: true } : undefined}>{cells}</HStack>
  }
  // Large: known full content width, natural content height. No greedy reader or estimated-height reservation.
  if (contentWidth != null) return render(contentWidth)
  // Small retains its existing bounded reader and statistics geometry.
  return <GeometryReader frame={{ height }}>{proxy => render(proxy.size.width)}</GeometryReader>
}

// Same Parrot summary scope as Large, not per-account totals.

function SmallStats({ data }: { data: UsageData }) {
  const today = data.today, month = data.month
  if (!today || !month) return <Text font={7} foregroundStyle={SUB} lineLimit={2}>今日/本月统计未提供</Text>
  const values = (m: NonNullable<UsageData["today"]>) => {
    const inputSide = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens
    return [fmtTokens(m.cacheReadTokens + m.cacheCreationTokens),
      inputSide > 0 ? (m.cacheReadTokens / inputSide * 100).toFixed(1) + "%" : "--",
      fmtTokens(m.totalTokens), fmtUsd(m.costUsd)]
  }
  const t = values(today), m = values(month)
  return <PeriodStats labelFont={7} valueFont={9} gap={2} verticalGap={2}
    columns={["缓存", "缓存率", "Token", "花费"].map((label, i) => ({ label, today: t[i], month: m[i] }))} />
}

// ---------- 小号：上下两个账号，各自5 h在上、每周在下 ----------
// Shared single/double geometry: 1.7.13 moved up 3pt, 1.7.14 another 2pt; lower account retains its 4pt inset.
function smallRegionLayout(height: number) {
  const dividerY = Math.max(74, Math.min(height * 0.56, height - 57)) - 5
  return { dividerY, lowerY: dividerY + 1 + 4, lowerHeight: height - dividerY - 1, fits: height >= 131 }
}
function Small({ data, stale }: { data: UsageData; stale: boolean }) {
  const s: Scale = { title: 11, label: 8, lcd: 10, bar: 3, segs: 10, gap: 1 }
  const accounts = data.accounts.slice(0, 2), single = accounts.length === 1
  const account = (acc: Account) => <VStack alignment="leading" spacing={3}>
    <AccountTitle acc={acc} font={s.title} />
    {windowsOf(acc).map(x => <QuadWindow label={x.label} w={x.w} fmt={x.fmt} s={s} rowToBarGap={MEDIUM_SCALE.gap} />)}
  </VStack>
  return <GeometryReader>
    {proxy => {
      const region = smallRegionLayout(proxy.size.height)
      return <VStack alignment="leading" spacing={0} frame={{ width: proxy.size.width, height: proxy.size.height }}>
        <VStack alignment="leading" spacing={0}
          frame={{ height: region.dividerY, maxWidth: "infinity", alignment: "topLeading" as any }}>
          {single ? <SmallStats data={data} /> : account(accounts[0])}
        </VStack>
        <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
        <VStack alignment="leading" spacing={0} padding={{ top: 4 }}
          frame={{ height: region.lowerHeight, maxWidth: "infinity", alignment: "topLeading" as any }}>
          {account(single ? accounts[0] : accounts[1])}
        </VStack>
      </VStack>
    }}
  </GeometryReader>
}

// ---------- 四宫格：每格一个账号，5小时在上、每周在下 ----------
type Scale = { title: number; label: number; lcd: number; bar: number; segs: number; gap: number }
const MEDIUM_SCALE: Scale = { title: 12, label: 9, lcd: 11, bar: 4, segs: 10, gap: 2 }

// "5 h/每周" label and countdown use the Small two-account baseline in Small and Medium:
// 8pt, fixed label width 8*2.1, monospaced digits, NO per-text scaling (the time never shrinks alone).
const QUOTA_TEXT_FONT = 8
function QuadWindow({ label, w, fmt, s, fixedLcd = false, rowToBarGap = s.gap }: Win & { s: Scale; fixedLcd?: boolean; rowToBarGap?: number }) {
  const lcd = <Lcd value={w.remainingPercent} height={s.lcd} />
  return <VStack alignment="leading" spacing={rowToBarGap}>
    <HStack alignment="bottom" spacing={2}>
      {/* 标签固定宽度（约两个汉字），“5 h”与“每周”对齐，后面的倒计时也对齐 */}
      <Text font={QUOTA_TEXT_FONT} foregroundStyle={SUB} lineLimit={1} frame={{ width: QUOTA_TEXT_FONT * 2.1, alignment: "leading" as any }}>{label}</Text>
      <Text font={QUOTA_TEXT_FONT} monospacedDigit foregroundStyle={SUB} lineLimit={1}>
        · {fmt(w.resetsAt)}
      </Text>
      <Spacer />
      {fixedLcd ? <HStack spacing={0} fixedSize={{ horizontal: true, vertical: false }}>{lcd}</HStack> : lcd}
    </HStack>
    <SegBar remaining={w.remainingPercent} count={s.segs} height={s.bar} />
  </VStack>
}

function Quad({ acc, s, fixedLcd = false }: { acc?: Account; s: Scale; fixedLcd?: boolean }) {
  if (!acc) return <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><Spacer /></VStack>
  return <VStack alignment="leading" spacing={s.gap + 1} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" as any }}>
    <AccountTitle acc={acc} font={s.title} />
    {windowsOf(acc).map(x => <QuadWindow label={x.label} w={x.w} fmt={x.fmt} s={s} fixedLcd={fixedLcd} />)}
  </VStack>
}

// 十字分隔线画在底层，竖线贯穿整个高度、横线贯穿整个宽度
function QuadGrid({ accounts, s, fixedLcd = false, statsData }: { accounts: Account[]; s: Scale; fixedLcd?: boolean; statsData?: UsageData }) {
  const a = accounts.slice(0, 4)
  const pad = s.gap * 2 + 3
  const cell = (acc?: Account, top = false, left = false, statistics = false) =>
    <VStack
      padding={{ top: top ? 0 : pad, bottom: top ? pad : 0, leading: left ? 0 : 10, trailing: left ? 10 : 0 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
    >
      {statistics && statsData ? <SmallStats data={statsData} /> : <Quad acc={acc} s={s} fixedLcd={fixedLcd} />}
    </VStack>
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <Rectangle fill={DIVIDER} frame={{ width: 1, maxHeight: "infinity" }} />
    <Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />
    <VStack spacing={0}>
      <HStack spacing={0}>{statsData ? cell(undefined, true, true, true) : cell(a[0], true, true)}{cell(a[statsData ? 0 : 1], true, false)}</HStack>
      <HStack spacing={0}>{cell(a[statsData ? 1 : 2], false, true)}{cell(a[statsData ? 2 : 3], false, false)}</HStack>
    </VStack>
  </ZStack>
}

// Shared source-wide Parrot six-column summary, not selected-account totals.
function summaryColumns(data: UsageData): StatColumn[] | null {
  if (!data.today || !data.month) return null
  const values = (m: NonNullable<UsageData["today"]>) => {
    const inputSide = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens
    return [fmtTokens(m.inputTokens), fmtTokens(m.outputTokens), fmtTokens(m.cacheReadTokens + m.cacheCreationTokens),
      inputSide > 0 ? (m.cacheReadTokens / inputSide * 100).toFixed(1) + "%" : "--", fmtTokens(m.totalTokens), fmtUsd(m.costUsd)]
  }
  const today = values(data.today), month = values(data.month)
  return ["输入", "输出", "缓存", "缓存率", "Token", "花费"].map((label, i) => ({ label, today: today[i], month: month[i] }))
}

function mediumTwoLayout(height: number) {
  // Root vertical padding 12×2 + refresh reservation 14; divider remains halfway.
  const contentHeight = Math.max(1, height - 38), half = contentHeight / 2
  // Compact six lines: 4×ceil(7×1.2)+2×ceil(8×1.2)+2 gaps = 58pt MODEL, not native measurement.
  return { contentHeight, half, statsScale: Math.min(1, Math.max(1, half - 4) / 58) }
}
function MediumTwo({ data }: { data: UsageData }) {
  const width = Widget.displaySize.width - 28
  const { contentHeight, half, statsScale } = mediumTwoLayout(Widget.displaySize.height)
  const columns = summaryColumns(data)
  return <ZStack frame={{ width, height: contentHeight }}>
    <VStack spacing={0}>
      <Spacer frame={{ height: half }} />
      <Rectangle fill={DIVIDER} modifiers={modifiers().frame({ width: 1, height: half })} />
    </VStack>
    <Rectangle fill={DIVIDER} modifiers={modifiers().frame({ height: 1 }).frame({ maxWidth: "infinity" })} />
    <VStack spacing={0}>
      <VStack alignment="leading" spacing={0}
        modifiers={modifiers().padding({ bottom: 4 }).frame({ height: half }).frame({ maxWidth: "infinity", alignment: "topLeading" })}>
        {columns ? <PeriodStats columns={columns} labelFont={7 * statsScale} valueFont={8 * statsScale}
          gap={2} verticalGap={0} contentWidth={width} />
          : <Text font={7} foregroundStyle={SUB}>官方未提供今日/本月Token与花费</Text>}
      </VStack>
      <HStack spacing={0} modifiers={modifiers().frame({ height: half }).frame({ maxWidth: "infinity" })}>
        {data.accounts.map((acc, i) => <VStack
          padding={{ top: 7, bottom: 0, leading: i === 0 ? 0 : 10, trailing: i === 0 ? 10 : 0 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}>
          <Quad acc={acc} s={MEDIUM_SCALE} fixedLcd />
        </VStack>)}
      </HStack>
    </VStack>
  </ZStack>
}

// ---------- 中号：四宫格，最多 4 个账号 ----------
function Medium({ data }: { data: UsageData }) {
  if (data.accounts.length === 2) return <MediumTwo data={data} />
  if (data.accounts.length === 3) return <QuadGrid accounts={data.accounts} s={MEDIUM_SCALE} fixedLcd statsData={data} />
  return <QuadGrid accounts={data.accounts} s={MEDIUM_SCALE} fixedLcd />
}

// ---------- 大号：顶部今日统计 + 从上到下四个账号 ----------
function LargeQuota({ label, w, fmt }: Win) {
  return <VStack alignment="leading" spacing={MEDIUM_SCALE.gap}
    modifiers={modifiers().fixedSize({ horizontal: false, vertical: true }).frame({ minHeight: 19, maxWidth: "infinity" })}>
    <HStack alignment="bottom" spacing={5} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={1}>
        <Text font={9} foregroundStyle={SUB} frame={{ width: 20, alignment: "leading" as any }}>{label}</Text>
        <Text font={9} monospacedDigit foregroundStyle={SUB} lineLimit={1} minScaleFactor={0.8}
          frame={{ width: 65, alignment: "leading" as any }}>· {fmt(w.resetsAt)}</Text>
      </HStack>
      <Spacer />
      <Lcd value={w.remainingPercent} height={12} />
    </HStack>
    <LargeSegBar remaining={w.remainingPercent} />
  </VStack>
}

function Large({ data, stale }: { data: UsageData; stale: boolean }) {
  const m = data.today
  const month = data.month
  const contentWidth = Widget.displaySize.width - 28 // Root's 14pt horizontal inset on each side.
  const columns = summaryColumns(data)
  return <VStack alignment="leading" spacing={3}
    modifiers={modifiers().fixedSize({ horizontal: false, vertical: true })
      .frame({ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" })}>
    {m && month ? <PeriodStats labelFont={9} valueFont={11} sizingValueFont={12} gap={4} verticalGap={3} contentWidth={contentWidth}
      columns={columns!} /> : <Text font={10} foregroundStyle={SUB}>官方未提供今日/本月Token与花费</Text>}
    <Rectangle fill={DIVIDER} modifiers={modifiers().frame({ height: 1 }).frame({ maxWidth: "infinity" })} />
    <VStack alignment="leading" spacing={2} fixedSize={{ horizontal: false, vertical: true }} frame={{ maxWidth: "infinity" }}>
      {data.accounts.slice(0, 4).map((acc, i) => <VStack alignment="leading" spacing={1}
        fixedSize={{ horizontal: false, vertical: true }} frame={{ maxWidth: "infinity" }}>
        {/* Outer account-list gap 2 + this inset 1 => weekly bar to next divider 3 (formerly 2).
            Account spacing 1 still controls divider→title and title→5h; only the two windows use gap 3. */}
        {i > 0 ? <Rectangle fill={DIVIDER}
          modifiers={modifiers().frame({ height: 1 }).frame({ maxWidth: "infinity" }).padding({ top: 1 })} /> : null}
        <VStack spacing={0} fixedSize={{ horizontal: false, vertical: true }}><AccountTitle acc={acc} font={12} /></VStack>
        <VStack alignment="leading" spacing={3} fixedSize={{ horizontal: false, vertical: true }} frame={{ maxWidth: "infinity" }}>
          {windowsOf(acc).map(x => <LargeQuota label={x.label} w={x.w} fmt={x.fmt} />)}
        </VStack>
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
    if (!selected.length) body = <Message text="请按脚本账号列表检查小组件参数中的账号序号" />
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
