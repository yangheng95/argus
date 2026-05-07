// ── Window / UI Service ──
// Exported functions:
// setTrayAttention — toggle the tray icon attention state via host

import { getHostTransport } from "./host-transport";

// ── setTrayAttention ──
// Activate or deactivate the tray-icon attention animation.
// Returns true on success, false when the host has no tray (browser
// preview, VS Code webview).

let _trayAttentionEnabled = false;

export async function setTrayAttention(active: boolean): Promise<boolean> {
  if (_trayAttentionEnabled === !!active) return true;
  try {
    const result = await getHostTransport().native({
      kind: "tray.attention.set",
      active: !!active,
    });
    if (result) _trayAttentionEnabled = !!active;
    return !!result;
  } catch {
    return false;
  }
}
