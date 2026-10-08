import { HStack, VStack, Text, Spacer, Image, ProgressView, Widget, VirtualNode } from "scripting"
import {
  loadUsage, Account, Metric, UsageData,
  fmtTokens, fmtUsd, fmtPct, fmtReset, fmtTime, providerLabel, familyLabel, quotaColor,
} from "./api"

const BG = { light: "#F7F8FA", dark: "#15161F" } as any
const SUB = "secondaryLabel"

function Header({ data, stale, error }: { data: UsageData | null; stale: boolean; error: string | null }) {
  return <HStack spacing={4}>
    <Image systemName="sparkles" font={12} foregroundStyle="systemPurple" />
    <Text font={12} fontWeight="semibold">AI 用量</Text>
    <Spacer />
    {data
      ? <Text font={10} foregroundStyle={stale ? "systemOrange" : SUB}>
          {stale ? "离线 " : ""}{fmtTime(data.fetchedAt)}
        </Text>
      : null}
  </HStack>
}

function QuotaBar({ label, used, remaining, reset }: { label: string; used: number | null; remaining: number | null; reset: string | null }) {
  return <VStack alignment="leading" spacing={2}>
    <HStack spacing={2}>
      <Text font={10} foregroundStyle={SUB}>{label}</Text>
      <Spacer />
      <Text font={10} fontWeight="semibold" monospacedDigit foregroundStyle={quotaColor(remaining)}>
        余 {fmtPct(remaining)}
      </Text>
      {reset ? <Text font={9} foregroundStyle={SUB}> · {fmtReset(reset)}</Text> : null}
    </HStack>
    <ProgressView
      progressViewStyle="linear"
      value={Math.min(100, Math.max(0, used ?? 0))}
      total={100}
      tint={quotaColor(remaining)}
    />
  </VStack>
}

function AccountRow({ acc, compact }: { acc: Account; compact?: boolean }) {
  const short = acc.name.replace(/@.*$/, "")
  return <VStack alignment="leading" spacing={3}>
    <HStack spacing={4}>
      <Text font={11} fontWeight="bold" foregroundStyle={acc.provider === "claude" ? "systemOrange" : "systemTeal"}>
        {providerLabel(acc.provider)}
      </Text>
      <Text font={10} foregroundStyle={SUB} lineLimit={1}>{short}</Text>
      {acc.available ? null : <Text font={9} foregroundStyle="systemRed">不可用</Text>}
    </HStack>
    <QuotaBar label="5小时" used={acc.fiveHour.usedPercent} remaining={acc.fiveHour.remainingPercent} reset={acc.fiveHour.resetsAt} />
    {compact ? null : <QuotaBar label="7天" used={acc.sevenDay.usedPercent} remaining={acc.sevenDay.remainingPercent} reset={acc.sevenDay.resetsAt} />}
  </VStack>
}

// 单行紧凑：名称 + 5小时剩余 + 重置倒计时，下方进度条
function MiniAccount({ acc }: { acc: Account }) {
  const w = acc.fiveHour
  const short = acc.name.replace(/@.*$/, "")
  return <VStack alignment="leading" spacing={2}>
    <HStack spacing={3}>
      <Text font={10} fontWeight="bold" foregroundStyle={acc.provider === "claude" ? "systemOrange" : "systemTeal"}>
        {providerLabel(acc.provider)}
      </Text>
      <Text font={9} foregroundStyle={SUB} lineLimit={1}>{short}</Text>
      <Spacer />
      <Text font={10} fontWeight="semibold" monospacedDigit foregroundStyle={acc.available ? quotaColor(w.remainingPercent) : "systemRed"}>
        {acc.available ? fmtPct(w.remainingPercent) : "不可用"}
      </Text>
    </HStack>
    <ProgressView
      progressViewStyle="linear"
      value={Math.min(100, Math.max(0, w.usedPercent ?? 0))}
      total={100}
      tint={quotaColor(w.remainingPercent)}
    />
  </VStack>
}

function StatBlock({ title, m }: { title: string; m: Metric }) {
  return <VStack alignment="leading" spacing={1}>
    <Text font={10} foregroundStyle={SUB}>{title}</Text>
    <Text font={18} fontWeight="bold" monospacedDigit minScaleFactor={0.6} lineLimit={1}>{fmtUsd(m.costUsd)}</Text>
    <Text font={10} monospacedDigit foregroundStyle={SUB} lineLimit={1} minScaleFactor={0.7}>
      {fmtTokens(m.totalTokens)} tok · {m.requests} 次
    </Text>
  </VStack>
}

function TokenDetail({ m }: { m: Metric }) {
  const item = (k: string, v: number) => <VStack alignment="leading" spacing={0}>
    <Text font={9} foregroundStyle={SUB}>{k}</Text>
    <Text font={11} fontWeight="medium" monospacedDigit>{fmtTokens(v)}</Text>
  </VStack>
  return <HStack spacing={10}>
    {item("输入", m.inputTokens)}
    {item("输出", m.outputTokens)}
    {item("缓存读", m.cacheReadTokens)}
    {item("缓存写", m.cacheCreationTokens)}
  </HStack>
}

function FamilyRows({ fam }: { fam: Record<string, Metric> }) {
  const rows: VirtualNode[] = Object.keys(fam).map(k =>
    <HStack spacing={4}>
      <Text font={10} foregroundStyle={SUB}>{familyLabel(k)}</Text>
      <Spacer />
      <Text font={10} monospacedDigit>{fmtUsd(fam[k].costUsd)}</Text>
      <Text font={10} monospacedDigit foregroundStyle={SUB}> · {fmtTokens(fam[k].totalTokens)}</Text>
    </HStack>
  )
  return <VStack spacing={2}>{rows}</VStack>
}

function ErrorView({ error }: { error: string }) {
  return <VStack spacing={6}>
    <Image systemName="exclamationmark.triangle" font={20} foregroundStyle="systemOrange" />
    <Text font={11} multilineTextAlignment="center" foregroundStyle={SUB}>{error}</Text>
  </VStack>
}

function Small({ d }: { d: UsageData }) {
  const first = d.accounts[0]
  return <VStack alignment="leading" spacing={6}>
    <StatBlock title="今日" m={d.today} />
    <Text font={10} foregroundStyle={SUB} monospacedDigit lineLimit={1}>本月 {fmtUsd(d.month.costUsd)} · {fmtTokens(d.month.totalTokens)}</Text>
    <Spacer />
    {first ? <MiniAccount acc={first} /> : null}
  </VStack>
}

function Medium({ d }: { d: UsageData }) {
  const accs = d.accounts.slice(0, 3)
  // 右侧：5 小时剩余额度（单行紧凑）
  return <HStack alignment="top" spacing={12}>
    <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      <StatBlock title="今日" m={d.today} />
      <StatBlock title="本月" m={d.month} />
    </VStack>
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
      <Text font={9} foregroundStyle={SUB}>5小时剩余</Text>
      {accs.map(a => <MiniAccount acc={a} />)}
    </VStack>
  </HStack>
}

function Large({ d }: { d: UsageData }) {
  return <VStack alignment="leading" spacing={8}>
    <HStack alignment="top" spacing={12}>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <StatBlock title="今日" m={d.today} />
        <FamilyRows fam={d.todayByFamily} />
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <StatBlock title="本月" m={d.month} />
        <FamilyRows fam={d.monthByFamily} />
      </VStack>
    </HStack>
    <TokenDetail m={d.today} />
    <VStack alignment="leading" spacing={7}>
      {d.accounts.slice(0, 4).map(a => <AccountRow acc={a} compact={d.accounts.length > 2} />)}
    </VStack>
  </VStack>
}

function Root({ data, stale, error }: { data: UsageData | null; stale: boolean; error: string | null }) {
  const family = Widget.family
  let body: VirtualNode
  if (!data) body = <ErrorView error={error ?? "无数据"} />
  else if (family === "systemSmall") body = <Small d={data} />
  else if (family === "systemLarge" || family === "systemExtraLarge") body = <Large d={data} />
  else body = <Medium d={data} />
  return <VStack
    alignment="leading"
    spacing={6}
    frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
    widgetBackground={BG}
  >
    <Header data={data} stale={stale} error={error} />
    {body}
    <Spacer />
  </VStack>
}

async function run() {
  const r = await loadUsage()
  Widget.present(<Root data={r.data} stale={r.stale} error={r.error} />, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

run()
