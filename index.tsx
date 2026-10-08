import {
  Button, Form, LabeledContent, Navigation, NavigationStack, Script, Section,
  SecureField, Text, TextField, Widget, useState,
} from "scripting"
import { getConfig, saveConfig, clearConfig, loadUsage, fmtUsd, fmtTokens, fmtPct } from "./api"

function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const cur = getConfig()
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "https://pr.jjbb.me")
  const [key, setKey] = useState("")
  const [hasKey, setHasKey] = useState(!!cur.managementKey)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(hasKey ? "已配置，可点“测试连接”" : "未配置：填写后点“保存并测试”")
  const [lines, setLines] = useState<string[]>([])

  async function test() {
    setBusy(true)
    setStatus("连接中…")
    setLines([])
    try {
      const r = await loadUsage()
      if (r.data && !r.stale) {
        const d = r.data
        setStatus("✅ 连接成功")
        setLines([
          `今日 ${fmtUsd(d.today.costUsd)} · ${fmtTokens(d.today.totalTokens)} tok · ${d.today.requests} 次`,
          `本月 ${fmtUsd(d.month.costUsd)} · ${fmtTokens(d.month.totalTokens)} tok`,
          ...d.accounts.map(a => `${a.provider === "claude" ? "Claude" : "GPT"} ${a.name.replace(/@.*$/, "")}：5小时余 ${fmtPct(a.fiveHour.remainingPercent)}`),
        ])
        await Widget.reloadAll()
      } else {
        setStatus("❌ " + (r.error ?? "未知错误"))
      }
    } catch (e: any) {
      setStatus("❌ " + String(e?.message ?? e))
    }
    setBusy(false)
  }

  async function save() {
    const finalKey = key.trim() || cur.managementKey || ""
    if (!baseUrl.trim() || !finalKey) {
      setStatus("❌ 地址和管理密钥都不能为空")
      return
    }
    saveConfig(baseUrl, finalKey)
    setKey("")
    setHasKey(true)
    await test()
  }

  return <NavigationStack>
    <Form
      navigationTitle={"AI 用量"}
      navigationBarTitleDisplayMode={"inline"}
      toolbar={{
        cancellationAction: <Button title={"完成"} action={dismiss} />,
      }}
    >
      <Section header={<Text>Parrot 连接</Text>} footer={<Text>密钥只保存在本机钥匙串。已保存过密钥时可留空。</Text>}>
        <TextField title={"地址"} value={baseUrl} onChanged={setBaseUrl} prompt={"https://pr.jjbb.me"} />
        <SecureField title={"管理密钥"} value={key} onChanged={setKey} prompt={hasKey ? "已保存，留空沿用" : "managementKey"} />
        <Button title={busy ? "处理中…" : "保存并测试"} action={save} disabled={busy} />
        {hasKey ? <Button title={"测试连接"} action={test} disabled={busy} /> : null}
      </Section>

      <Section header={<Text>状态</Text>}>
        <Text>{status}</Text>
        {lines.map(l => <Text font={13}>{l}</Text>)}
      </Section>

      <Section header={<Text>预览小组件</Text>}>
        <Button title={"小"} action={() => Widget.preview({ family: "systemSmall" })} />
        <Button title={"中"} action={() => Widget.preview({ family: "systemMedium" })} />
        <Button title={"大"} action={() => Widget.preview({ family: "systemLarge" })} />
      </Section>

      <Section>
        <LabeledContent title={"版本"} value={"1.0.1"} />
        <Button
          title={"清除配置"}
          action={async () => {
            clearConfig()
            setHasKey(false)
            setLines([])
            setStatus("已清除配置")
            await Widget.reloadAll()
          }}
        />
      </Section>
    </Form>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
