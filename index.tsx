import { Dialog, Script, Widget } from "scripting"
import { getConfig, saveConfig, clearConfig, loadUsage, fmtUsd, fmtTokens } from "./api"

async function setup(): Promise<boolean> {
  const cur = getConfig()
  const baseUrl = await Dialog.prompt({
    title: "Parrot 地址",
    message: "管理接口所在的根地址，不带路径",
    defaultValue: cur.baseUrl ?? "https://pr.jjbb.me",
    placeholder: "https://pr.jjbb.me",
    keyboardType: "URL",
  })
  if (!baseUrl) return false
  const key = await Dialog.prompt({
    title: "管理密钥",
    message: "Parrot 的 managementKey，只存储在本机钥匙串",
    obscureText: true,
    placeholder: cur.managementKey ? "留空沿用已保存的密钥" : "managementKey",
  })
  const finalKey = key || cur.managementKey
  if (!finalKey) {
    await Dialog.alert({ title: "未保存", message: "管理密钥不能为空" })
    return false
  }
  saveConfig(baseUrl, finalKey)
  return true
}

async function testConnection() {
  const r = await loadUsage()
  if (r.data && !r.stale) {
    await Dialog.alert({
      title: "连接成功",
      message: `今日 ${fmtUsd(r.data.today.costUsd)} · ${fmtTokens(r.data.today.totalTokens)} tokens\n本月 ${fmtUsd(r.data.month.costUsd)}\n账号 ${r.data.accounts.length} 个`,
    })
    await Widget.reloadAll()
  } else {
    await Dialog.alert({ title: "连接失败", message: r.error ?? "未知错误" })
  }
}

async function main() {
  const configured = !!getConfig().managementKey
  if (!configured) {
    if (await setup()) await testConnection()
    Script.exit()
    return
  }
  const actions = ["预览 小", "预览 中", "预览 大", "测试连接并刷新小组件", "修改配置", "清除配置"]
  const i = await Dialog.actionSheet({
    title: "AI 用量小组件",
    actions: actions.map((label, idx) => ({ label, destructive: idx === 5 })),
  })
  switch (i) {
    case 0: await Widget.preview({ family: "systemSmall" }); break
    case 1: await Widget.preview({ family: "systemMedium" }); break
    case 2: await Widget.preview({ family: "systemLarge" }); break
    case 3: await testConnection(); break
    case 4: if (await setup()) await testConnection(); break
    case 5:
      if (await Dialog.confirm({ title: "清除配置", message: "将删除保存的地址、密钥和缓存" })) {
        clearConfig()
        await Widget.reloadAll()
      }
      break
  }
  Script.exit()
}

main()
