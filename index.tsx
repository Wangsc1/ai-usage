import {
  Button, Form, LabeledContent, Navigation, NavigationLink, NavigationStack, Picker, Script, Section,
  SecureField, Text, TextField, Widget, VStack, useState, useEffect,
  ScrollView, LazyVGrid, ReorderableForEach, RoundedRectangle, modifiers, useObservable,
} from "scripting"
import { getConfig, saveConfig, clearConfig, loadUsage, fmtUsd, fmtTokens, fmtPct, Account, cachedAccounts, getRefreshMinutes, saveRefreshMinutes, REFRESH_OPTIONS, getSource, saveSource, DataSource } from "./api"
import { beginDeviceLogin, checkDeviceLogin, cancelDeviceLogin, DeviceLogin, officialAccounts, logoutOfficial, saveAccountOrder } from "./api"

const VERSION = "1.7.27"
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

const accountLabel = (a: Account, i: number) => `${i + 1}. ${a.provider === "claude" ? "Claude" : "Codex"} · ${a.name}`

// Separate ScrollView page: Scripting docs recommend ReorderableForEach outside List/Form (built-in long-press drag).
function AccountOrderPage({ source, onSaved }: { source: DataSource; onSaved: (next: Account[]) => void }) {
  const data = useObservable<Account[]>(() => cachedAccounts())
  const active = useObservable<Account | null>(null)
  const onMove = (indices: number[], newOffset: number) => {
    // A page opened for one source must never write after the app switched source.
    if (getSource() !== source) return
    const current = data.value
    if (!indices.length || indices.some(i => i < 0 || i >= current.length)) return
    // Standard implementation from views/reorderable_foreach documentation.
    const movingItems = indices.map(index => current[index])
    const newValue = current.filter((_, index) => !indices.includes(index))
    newValue.splice(Math.max(0, Math.min(newOffset, newValue.length)), 0, ...movingItems)
    if (newValue.every((a, i) => a.id === current[i].id)) return
    data.setValue(newValue)
    saveAccountOrder(newValue.map(a => a.id), source)
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
          builder={(a, i) => <VStack
            key={a.id}
            modifiers={modifiers()
              .frame({ maxWidth: "infinity", alignment: "leading" as any })
              .padding({ horizontal: 14, vertical: 12 })
              .background(<RoundedRectangle cornerRadius={12}
                fill={active.value?.id === a.id ? "tertiarySystemFill" : "secondarySystemGroupedBackground"} />)
              .contentShape({ kind: "dragPreview", shape: { type: "rect", cornerRadius: 12 } })}
          >
            <Text>{accountLabel(a, i)}</Text>
          </VStack>}
          onMove={onMove}
        />
      </LazyVGrid> : <Text>连接成功后显示账号列表</Text>}
    </VStack>
  </ScrollView>
}

function SettingsView() {
  const close = Navigation.useDismiss()
  const [source, setSource] = useState<DataSource>(getSource())
  const [device, setDevice] = useState<DeviceLogin | null>(null)
  const [logins, setLogins] = useState(officialAccounts())
  const dismiss = () => { if (device) cancelDeviceLogin(device); close() }
  const cur = getConfig()
  const [baseUrl, setBaseUrl] = useState(cur.baseUrl ?? "")
  const [key, setKey] = useState("")
  const [hasKey, setHasKey] = useState(!!cur.managementKey)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(hasKey ? "已配置，可点“测试连接”" : "未配置：填写后点“保存并测试”")
  const [lines, setLines] = useState<string[]>([])
  const [updateMsg, setUpdateMsg] = useState("")
  const [refreshMinutes, setRefreshMinutes] = useState(String(getRefreshMinutes()))
  const [accounts, setAccounts] = useState<Account[]>(cachedAccounts())

  useEffect(() => {
    if (getSource() === "official" || cur.managementKey) test()
  }, [])

  useEffect(() => () => { if (device) cancelDeviceLogin(device) }, [device])

  async function changeSource(value: string) {
    if (device) cancelDeviceLogin(device)
    setDevice(null)
    saveSource(value as DataSource)
    setSource(value as DataSource)
    setAccounts(cachedAccounts())
    setLines([])
    await test()
    await Widget.reloadAll()
  }

  async function addOfficial() {
    setBusy(true)
    try {
      const d = await beginDeviceLogin()
      setDevice(d)
      setStatus("请打开官方授权页输入下方一次性代码；完成后返回点“检查授权”")
    } catch (e: any) { setStatus(e.message) }
    setBusy(false)
  }

  async function checkOfficial() {
    if (!device) return
    setBusy(true)
    try {
      const result = await checkDeviceLogin(device)
      if (result === "pending") setStatus("等待授权：请完成官方页面操作后再次检查（15分钟内有效）")
      else {
        setDevice(null)
        setLogins(officialAccounts())
        await test()
      }
    } catch (e: any) {
      cancelDeviceLogin(device)
      setDevice(null)
      setStatus(e.message)
    }
    setBusy(false)
  }

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
      if (r.data) {
        setAccounts(r.data.accounts)
      }
      if (r.data && !r.stale) {
        const d = r.data
        setStatus("✅ 连接成功")
        setLines([
          ...(d.today && d.month ? [
            `今日 ${fmtUsd(d.today.costUsd)} · ${fmtTokens(d.today.totalTokens)} tok · ${d.today.requests} 次`,
            `本月 ${fmtUsd(d.month.costUsd)} · ${fmtTokens(d.month.totalTokens)} tok`,
          ] : ["官方额度接口未提供今日/本月Token及花费"]),
          ...d.accounts.map(a => `${a.provider === "claude" ? "Claude" : "Codex"} ${a.name.replace(/@.*$/, "")}：5 h 余 ${fmtPct(a.fiveHour.remainingPercent)}、每周余 ${fmtPct(a.sevenDay.remainingPercent)}${a.resetCredits == null ? " · 重置卡未提供" : ` · 重置:${a.resetCredits}`}`),
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
      <Section header={<Text>数据来源</Text>} footer={<Text>切换不删除另一来源的配置、账号或选择。普通 API Key 不能查询 Parrot 管理接口。</Text>}>
        <Picker title={"来源"} value={source} onChanged={changeSource} disabled={busy}>
          <Text tag={"parrot"}>Parrot密钥</Text>
          <Text tag={"official"}>OpenAI/Codex官方OAuth</Text>
        </Picker>
      </Section>

      {source === "official" ? <Section header={<Text>官方账号（独立登录）</Text>} footer={<Text>在官方页面登录你要添加的账号，可先退出浏览器的其他账号。Token仅存本机钥匙串；列表使用匿名编号，不展示邮箱。退出只移除此账号的本机登录。</Text>}>
        {!device ? <Button title={"添加官方账号"} action={addOfficial} disabled={busy} /> : <>
          <Text>一次性代码：{device.code}</Text>
          <Text>仅输入你自己在此脚本发起的代码，有效期15分钟。</Text>
          <Button title={"打开官方授权页"} action={async () => { try { await Safari.present("https://auth.openai.com/codex/device") } catch { setStatus("无法打开官方授权页，请稍后重试") } }} disabled={busy} />
          <Button title={"检查授权"} action={checkOfficial} disabled={busy} />
          <Button title={"取消登录"} action={() => { cancelDeviceLogin(device); setDevice(null); setStatus("已取消登录") }} />
        </>}
        {logins.map(a => <Button title={`退出 ${a.name}`} disabled={busy || !!device} action={async () => {
          try {
            logoutOfficial(a.id)
            setLogins(officialAccounts())
            setAccounts(cachedAccounts())
            await test()
            await Widget.reloadAll()
          } catch (e: any) { setStatus(e.message) }
        }} />)}
        <Button title={"刷新官方额度"} action={test} disabled={busy || !!device} />
      </Section> : <Section header={<Text>Parrot 连接</Text>} footer={<Text>密钥只保存在本机钥匙串。已保存过密钥时可留空。</Text>}>
        <TextField title={"地址"} value={baseUrl} onChanged={setBaseUrl} prompt={"填写你自己的 Parrot 地址"} />
        <SecureField title={"管理密钥"} value={key} onChanged={setKey} prompt={hasKey ? "已保存，留空沿用" : "managementKey"} />
        <Button title={busy ? "处理中…" : "保存并测试"} action={save} disabled={busy} />
        {hasKey ? <Button title={"测试连接"} action={test} disabled={busy} /> : null}
      </Section>}

      <Section header={<Text>状态</Text>}>
        <Text>{status}</Text>
        {lines.map(l => <Text font={13}>{l}</Text>)}
      </Section>

      <Section header={<Text>小组件账号</Text>} footer={<Text>保留列表全部账号，不改变远端状态。点“账号排序”进入单独页面，长按账号卡片拖动排序，松手即保存。默认按此列表顺序显示，小号前2个、中大号前4个，不按启用状态过滤。数字参数按排序后序号映射，参数顺序仍有效（如3,1显示第三、第一）。两种来源的排序独立保存。</Text>}>
        {accounts.map((a, i) => <Text key={a.id}>{accountLabel(a, i)}</Text>)}
        {accounts.length > 1 ? <NavigationLink destination={<AccountOrderPage key={source} source={source} onSaved={setAccounts} />}>
          <Text>账号排序</Text>
        </NavigationLink> : null}
        {!accounts.length ? <Text>连接成功后显示账号列表</Text> : null}
      </Section>

      <Section header={<Text>小组件刷新</Text>} footer={<Text>这是请求刷新间隔，实际时间由iOS调度，可能延后。更短间隔会增加网络请求与耗电。</Text>}>
        <Picker title={"刷新间隔"} value={refreshMinutes} onChanged={async (value: string) => {
          setRefreshMinutes(value)
          saveRefreshMinutes(Number(value))
          await Widget.reloadAll()
        }}>
          {REFRESH_OPTIONS.map(m => <Text tag={String(m)}>{m}分钟</Text>)}
        </Picker>
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

      {source === "parrot" ? <Section>
        <Button
          title={"清除Parrot配置"}
          action={async () => {
            clearConfig()
            setHasKey(false)
            setLines([])
            setAccounts([])
            setRefreshMinutes("15")
            setStatus("已清除配置")
            await Widget.reloadAll()
          }}
        />
      </Section> : null}
    </Form>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
