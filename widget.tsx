import { HStack, VStack, ZStack, Text, Spacer, Image, SVG, RoundedRectangle, Rectangle, Widget, VirtualNode } from "scripting"
import { loadUsage, Account, QuotaWindow, UsageData, fmtReset, fmtTime, tightest } from "./api"

// ---------- 配色 ----------
const BG = "#1C1C1E"
const FG = "#FFFFFF"
const SUB = "#8E8E93"
const GHOST = "#2E2E31"
const SEG_OFF = "#3A3A3C"
const DIVIDER = "#2C2C2E"

function levelColor(remaining: number | null): string {
  if (remaining == null) return SUB
  if (remaining <= 15) return "#FF453A"
  if (remaining <= 40) return "#FF9F0A"
  return "#7ED957"
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

function lcdSvg(value: number | null): string {
  const s = value == null ? " --" : String(Math.max(0, Math.min(100, Math.round(value)))).padStart(3, " ")
  const W = 10, GAP = 3.2, H = 18
  let rects = ""
  for (let i = 0; i < 3; i++) {
    const ox = i * (W + GAP)
    const on = DIGIT[s[i]] ?? ""
    for (const k of Object.keys(SEG)) {
      const [x, y, w, h] = SEG[k]
      const lit = on.includes(k)
      rects += `<rect x="${(ox + x).toFixed(1)}" y="${y}" width="${w}" height="${h}" rx="0.9" fill="${lit ? FG : GHOST}"/>`
    }
  }
  const vw = 3 * W + 2 * GAP
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw * 8}" height="${H * 8}" viewBox="0 0 ${vw} ${H}">${rects}</svg>`
}

// 数码管百分比：height 为数字高度
function Lcd({ value, height }: { value: number | null; height: number }) {
  const width = height * (36.4 / 18)
  return <HStack alignment="bottom" spacing={2}>
    <SVG code={lcdSvg(value)} resizable frame={{ width, height }} />
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
const CLAUDE_SVG = (() => {
  let rays = ""
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180
    const r = i % 2 === 0 ? 11 : 8.5
    rays += `<line x1="12" y1="12" x2="${(12 + r * Math.cos(a)).toFixed(2)}" y2="${(12 + r * Math.sin(a)).toFixed(2)}" stroke="#D97757" stroke-width="2.6" stroke-linecap="round"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24">${rays}</svg>`
})()

function ProviderIcon({ provider, size }: { provider: string; size: number }) {
  if (provider === "claude") return <SVG code={CLAUDE_SVG} resizable frame={{ width: size, height: size }} />
  return <Image systemName="hexagon.fill" font={size * 0.85} foregroundStyle={FG} frame={{ width: size, height: size }} />
}

function shortName(acc: Account) {
  return acc.name.replace(/@.*$/, "")
}

function providerName(p: string) {
  return p === "claude" ? "Claude" : p === "openai" ? "GPT" : p
}

function AccountTitle({ acc, font }: { acc: Account; font: number }) {
  return <HStack spacing={5}>
    <ProviderIcon provider={acc.provider} size={font + 1} />
    <Text font={font} fontWeight="semibold" foregroundStyle={FG} lineLimit={1}>{providerName(acc.provider)}</Text>
    <Text font={font - 3} foregroundStyle={SUB} lineLimit={1}>{shortName(acc)}</Text>
    {acc.available ? null : <Text font={font - 3} foregroundStyle="#FF453A">不可用</Text>}
  </HStack>
}

function RefreshTime({ data, stale }: { data: UsageData; stale: boolean }) {
  return <HStack spacing={3}>
    <Image systemName={stale ? "wifi.slash" : "arrow.clockwise"} font={10} foregroundStyle={stale ? "#FF9F0A" : SUB} />
    <Text font={12} monospacedDigit foregroundStyle={SUB}>{fmtTime(data.fetchedAt)}</Text>
  </HStack>
}

type Win = { label: string; w: QuotaWindow }
const windowsOf = (a: Account): Win[] => [
  { label: "5 小时", w: a.fiveHour },
  { label: "每周", w: a.sevenDay },
]

// ---------- 小号：最紧张的账号，5 小时 + 每周 ----------
function Small({ data, stale }: { data: UsageData; stale: boolean }) {
  const acc = data.accounts[0]
  return <VStack alignment="leading" spacing={0}>
    <HStack spacing={4}>
      <ProviderIcon provider={acc.provider} size={13} />
      <Text font={12} foregroundStyle={SUB} lineLimit={1}>{providerName(acc.provider)}</Text>
      <Spacer />
      <RefreshTime data={data} stale={stale} />
    </HStack>
    <Spacer />
    <VStack alignment="leading" spacing={9}>
      {windowsOf(acc).map(({ label, w }) =>
        <VStack alignment="leading" spacing={4}>
          <HStack alignment="bottom" spacing={0}>
            <VStack alignment="leading" spacing={1}>
              <Text font={11} foregroundStyle={SUB}>{label}</Text>
              <Text font={11} monospacedDigit foregroundStyle={FG}>{fmtReset(w.resetsAt)}</Text>
            </VStack>
            <Spacer />
            <Lcd value={w.remainingPercent} height={22} />
          </HStack>
          <SegBar remaining={w.remainingPercent} count={12} height={8} />
        </VStack>
      )}
    </VStack>
  </VStack>
}

// ---------- 中号：每账号 5 小时 + 每周，最多 2 个账号 ----------
function MediumRow({ label, w }: Win) {
  return <HStack spacing={8}>
    <Text font={10} monospacedDigit foregroundStyle={SUB} lineLimit={1} frame={{ width: 92, alignment: "leading" as any }}>
      {label} · {fmtReset(w.resetsAt)}
    </Text>
    <SegBar remaining={w.remainingPercent} count={16} height={6} />
    <Lcd value={w.remainingPercent} height={13} />
  </HStack>
}

function Medium({ data }: { data: UsageData }) {
  const accs = data.accounts.slice(0, 2)
  const blocks: VirtualNode[] = []
  accs.forEach((a, i) => {
    if (i > 0) blocks.push(<Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />)
    blocks.push(<VStack alignment="leading" spacing={3}>
      <AccountTitle acc={a} font={13} />
      {windowsOf(a).map(x => <MediumRow label={x.label} w={x.w} />)}
    </VStack>)
  })
  return <VStack alignment="leading" spacing={8}>
    <Spacer />
    {blocks}
    <Spacer />
  </VStack>
}

// ---------- 大号：最多 3 个账号 ----------
function LargeWindow({ label, w }: Win) {
  return <VStack alignment="leading" spacing={3}>
    <HStack>
      <Text font={11} foregroundStyle={SUB}>{label}</Text>
      <Spacer />
      <Text font={11} monospacedDigit foregroundStyle={SUB}>{fmtReset(w.resetsAt)} 后重置</Text>
    </HStack>
    <HStack spacing={10}>
      <SegBar remaining={w.remainingPercent} count={22} height={7} />
      <Lcd value={w.remainingPercent} height={15} />
    </HStack>
  </VStack>
}

function Large({ data, stale }: { data: UsageData; stale: boolean }) {
  const accs = data.accounts.slice(0, 3)
  const blocks: VirtualNode[] = []
  accs.forEach((a, i) => {
    if (i > 0) blocks.push(<Rectangle fill={DIVIDER} frame={{ maxWidth: "infinity", height: 1 }} />)
    blocks.push(<VStack alignment="leading" spacing={5}>
      <AccountTitle acc={a} font={16} />
      {windowsOf(a).map(x => <LargeWindow label={x.label} w={x.w} />)}
    </VStack>)
  })
  return <VStack alignment="leading" spacing={7}>
    <HStack>
      <HStack spacing={0}>
        <Text font={15} fontWeight="bold" foregroundStyle={FG}>us</Text>
        <Text font={15} fontWeight="bold" foregroundStyle="#7ED957">A</Text>
        <Text font={15} fontWeight="bold" foregroundStyle={FG}>ge</Text>
      </HStack>
      <Spacer />
      <RefreshTime data={data} stale={stale} />
    </HStack>
    {blocks}
    <Spacer />
  </VStack>
}

function Message({ text }: { text: string }) {
  return <VStack spacing={6}>
    <Spacer />
    <Image systemName="exclamationmark.triangle" font={20} foregroundStyle="#FF9F0A" />
    <Text font={11} multilineTextAlignment="center" foregroundStyle={SUB}>{text}</Text>
    <Spacer />
  </VStack>
}

function Root({ data, stale, error }: { data: UsageData | null; stale: boolean; error: string | null }) {
  let body: VirtualNode
  if (!data) body = <Message text={error ?? "无数据"} />
  else if (data.accounts.length === 0) body = <Message text="没有已启用的订阅账号" />
  else {
    const sorted = { ...data, accounts: [...data.accounts].sort((x, y) => tightest(x) - tightest(y)) }
    const f = Widget.family
    if (f === "systemSmall") body = <Small data={sorted} stale={stale} />
    else if (f === "systemLarge" || f === "systemExtraLarge") body = <Large data={sorted} stale={stale} />
    else body = <Medium data={sorted} />
  }
  return <ZStack
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    widgetBackground={BG}
  >
    {body}
  </ZStack>
}

async function run() {
  const r = await loadUsage()
  Widget.present(<Root data={r.data} stale={r.stale} error={r.error} />, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

run()
