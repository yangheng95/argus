import { applyTheme } from "./theme"
import { subscribeHostTheme } from "./host-theme"
import { setSettingsStore } from "../store/settings"

let unsubscribeHostTheme: (() => void) | undefined

export function installHostThemeHandshakeSubscription(): void {
  if (unsubscribeHostTheme) return
  unsubscribeHostTheme = subscribeHostTheme((theme) => {
    setSettingsStore("theme", theme)
    applyTheme(theme)
  })
}

export function __resetHostThemeHandshakeForTest(): void {
  if (unsubscribeHostTheme) {
    unsubscribeHostTheme()
    unsubscribeHostTheme = undefined
  }
}
