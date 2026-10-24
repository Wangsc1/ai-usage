import { Button, Form, Section, Text, useState } from "scripting"
import { readWidgetDiagnostics, widgetDiagnosticTime } from "./api"

// Child of the existing NavigationStack; native back button/edge navigation remain owned by host.
export function WidgetDiagnosticsPage() {
  const [records, setRecords] = useState(readWidgetDiagnostics())
  return <Form navigationTitle="组件诊断" navigationBarTitleDisplayMode="inline">
    <Section>
      <Button title="刷新本地记录" action={() => setRecords(readWidgetDiagnostics())} />
      <Text>只读本机最近10次执行，不联网、不刷新组件。可截图反馈。</Text>
      <Text>到达present前或调用返回都不代表已成功渲染。宿主可能立即结束上下文，缺少返回不等于失败。记录缺失也不能证明未启动：模块导入或本地存储写入可能失败。</Text>
      <Text>多组件实例同时执行时，本地存储非原子合并，可能遗漏记录。</Text>
    </Section>
    {!records.length ? <Section><Text>暂无可读记录（也可能读取失败）。请等待组件下一次执行后刷新本地记录。</Text></Section> : null}
    {records.map((entry, index) => <Section key={entry.id} header={<Text>{`${index + 1}. ${widgetDiagnosticTime(entry.startedAt)}`}</Text>}>
      <Text>{`脚本版本：${entry.scriptVersion} · 尺寸：${entry.family}`}</Text>
      <Text>{`阶段：${entry.phase} · 结果：${entry.outcome}`}</Text>
      <Text>{`错误类型：${entry.errorType} · 耗时：${entry.elapsedMs} ms`}</Text>
      <Text>{entry.legacy ? "旧记录：时间、尺寸及启动/present标记未记录。" : `已记录启动 · 到达present前：${entry.beforePresent ? "是" : "未记录"} · 调用返回：${entry.returned ? "已记录（非渲染成功）" : "未记录（不等于失败）"}`}</Text>
    </Section>)}
  </Form>
}
