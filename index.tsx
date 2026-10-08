import {
  Button, Form, LabeledContent, Navigation, NavigationStack, Script, Section,
  SecureField, Text, TextField, Widget, useState,
} from "scripting"
import { getConfig, saveConfig, clearConfig, loadUsage, fmtUsd, fmtTokens, fmtPct } from "./api"

const VERSION = "1.4.0"
const RAW = "https://raw.githubusercontent.com/Wangsc1/ai-usage/main/"
// script.json 不覆盖：保留 Scripting 导入时写入的本地元数据
const FILES = ["api.ts", "widget.tsx", "index.tsx"]

function newer(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

// 从 GitHub 拉取最新文件覆盖当前脚本目录；返回新版本号，已是最新返回 null
async function updateFromGitHub(force: boolean): Promise<string | null> {
  const bust = `?t=${Date.now()}`
  const meta = await fetch(RAW + "script.json" + bust, { timeout: 20 })
  if (meta.status !== 200) throw new Error(`获取版本信息失败（HTTP ${meta.status}）`)
  const remote = String((await meta.json())?.version ?? "")
  if (!force && !newer(remote, VERSION)) return null
  // 先全部下载成功再写入，避免半更新
  const bodies: string[] = []
  for (const f of FILES) {
    const r = await fetch(RAW + f + bust, { timeout: 20 })
    if (r.status !== 200) throw new Error(`下载 ${f} 失败（HTTP ${r.status}）`)
    const t = await r.text()
    if (!t.trim()) throw new Error(`${f} 内容为空`)
    bodies.push(t)
  }
  for (let i = 0; i < FILES.length; i++) {
    await FileManager.writeAsString(Script.directory + "/" + FILES[i], bodies[i])
  }
  return remote
}

function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const cur = getConfig()
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "https://pr.jjbb.me")
  const [key, setKey] = useState("")
  const [hasKey, setHasKey] = useState(!!cur.managementKey)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(hasKey ? "已配置，可点“测试连接”" : "未配置：填写后点“保存并测试”")
  const [lines, setLines] = useState<string[]>([])
  const [updateMsg, setUpdateMsg] = useState("")

  async function checkUpdate(force: boolean) {
    setBusy(true)
    setUpdateMsg("检查中…")
    try {
      const v = await updateFromGitHub(force)
      if (v) {
        setUpdateMsg(`✅ 已更新到 ${v}，点“完成”退出后重新运行生效`)
        await Widget.reloadAll()
      } else {
        setUpdateMsg(`已是最新版本 ${VERSION}`)
      }
    } catch (e: any) {
      setUpdateMsg("❌ " + String(e?.message ?? e))
    }
    setBusy(false)
  }

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
          ...d.accounts.map(a => `${a.provider === "claude" ? "Claude" : "Codex"} ${a.name.replace(/@.*$/, "")}：5 h 余 ${fmtPct(a.fiveHour.remainingPercent)}、每周余 ${fmtPct(a.sevenDay.remainingPercent)}`),
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

      <Section header={<Text>更新</Text>} footer={<Text>从 GitHub 拉取最新版本覆盖当前脚本，配置和密钥保留。</Text>}>
        <LabeledContent title={"当前版本"} value={VERSION} />
        <Button title={"检查更新"} action={() => checkUpdate(false)} disabled={busy} />
        <Button title={"强制重新下载"} action={() => checkUpdate(true)} disabled={busy} />
        {updateMsg ? <Text>{updateMsg}</Text> : null}
      </Section>

      <Section>
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
