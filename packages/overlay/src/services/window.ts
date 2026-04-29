// ── Window / UI Service ──
// Exported functions:
// setTrayAttention — toggle the tray icon attention state via host
// fitBrandVersion — shrink the brand-version element to fit its container

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

// ── fitBrandVersion ──
// Scale the brand-version element down when its content overflows the container.

export function fitBrandVersion(): void {
  const el = document.getElementById("brandVersion") as HTMLElement | null;
  if (!el) return;
  el.style.setProperty("--brand-version-scale", "1");
  requestAnimationFrame(() => {
    const width = el.clientWidth;
    const scroll = el.scrollWidth;
    if (!width || scroll <= width) return;
    const next = Math.max(0.72, Math.min(1, width / scroll));
    el.style.setProperty("--brand-version-scale", next.toFixed(3));
  });
}

