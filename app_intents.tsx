import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { loadUsage } from "./api"

// Scripting discovers interactive-widget intents in this required file/environment.
export let widgetIntentReady = true
export const RefreshUsageIntent = (() => { try { return AppIntentManager.register({
  name: "RefreshUsageIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    // Same composed loader as App/widget: current-source quotas plus the independently selected statistics provider.
    // Its existing cache/fetchedAt failure semantics remain authoritative.
    try { await loadUsage() }
    finally { await Widget.reloadAll() }
  },
}) } catch { widgetIntentReady = false; return (_params: undefined) => undefined } })()
