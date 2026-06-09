// ── Window / UI Service ──
// Exported functions:
// quitOverlay — quit the Tauri overlay process after UI confirmation
// setTrayAttention — toggle the tray icon attention state via host
// setDockBadge — set the host dock/taskbar badge projection

import { getHostTransport } from "./host-transport"

// ── setTrayAttention ──
// Activate or deactivate the tray-icon attention animation.
// Returns true on success, false when the host has no tray (browser
// preview, VS Code webview).

let _trayAttentionEnabled: boolean | undefined
let _dockBadgeCount: number | undefined

export async function quitOverlay(): Promise<boolean> {
  const result = await getHostTransport().native({ kind: "window.quit" })
  return result === true
}

export async function setTrayAttention(active: boolean): Promise<boolean> {
  if (_trayAttentionEnabled === !!active) return true
  try {
    const result = await getHostTransport().native({
      kind: "tray.attention.set",
      active: !!active,
    })
    if (result) _trayAttentionEnabled = !!active
    return !!result
  } catch {
    return false
  }
}

export async function setDockBadge(count: number): Promise<boolean> {
  const next = Math.max(0, Math.trunc(Number(count) || 0))
  if (_dockBadgeCount === next) return true
  try {
    const result = await getHostTransport().native({
      kind: "badge.set",
      count: next,
    })
    if (result) _dockBadgeCount = next
    return !!result
  } catch {
    return false
  }
}
