// ── Window / UI Service ──
// on the Tauri window handle or on global DOM state.
// Exported functions:
// setTrayAttention — toggle the tray icon attention state via Tauri
// setConnStatus — update the DOM connection badge
// fitBrandVersion — shrink the brand-version element to fit its container
// syncExecutorWidth — equalise executor chip button widths

import { t } from "../utils/i18n";

// ── Helpers ──

function hasTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).__TAURI__?.core?.invoke === "function"
  );
}

async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const globalInvoke = (window as any).__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    return globalInvoke(command, args) as Promise<T>;
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}

// ── setTrayAttention ──
// Activate or deactivate the tray-icon attention animation.
// Returns true on success, false when Tauri is unavailable.

let _trayAttentionEnabled = false;

export async function setTrayAttention(active: boolean): Promise<boolean> {
  if (!hasTauriRuntime()) return false;
  if (_trayAttentionEnabled === !!active) return true;
  const result = await tauriInvoke<boolean>("overlay_attention_set", {
    active: !!active,
  }).catch(() => false);
  if (result) _trayAttentionEnabled = !!active;
  return !!result;
}

// ── setConnStatus ──
// Update the DOM connection badge to reflect the current connection state.

export function setConnStatus(status: "online" | "offline" | "connecting"): void {
  if (typeof document === "undefined") return;
  document.body.dataset.connection = status;
  const badge = document.getElementById("solidConnBadge") as HTMLElement | null;
  if (!badge) return;
  badge.dataset.status = status;
  badge.textContent =
    status === "online"
      ? t("titlebar.connection.online")
      : status === "connecting"
        ? t("titlebar.connection.connecting")
        : t("titlebar.connection.offline");
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

// ── syncExecutorWidth ──
// Measure all executor chip buttons and set --engine-chip-width to the widest.

export function syncExecutorWidth(): void {
  const bar = document.getElementById("engineBar") as HTMLElement | null;
  if (!bar) return;
  bar.style.removeProperty("--engine-chip-width");
  requestAnimationFrame(() => {
    const buttons = [...bar.querySelectorAll<HTMLElement>("[data-executor]")];
    const width = buttons.reduce(
      (max, btn) => Math.max(max, Math.ceil(btn.getBoundingClientRect().width)),
      0,
    );
    if (width > 0) {
      bar.style.setProperty("--engine-chip-width", `${width}px`);
    }
  });
}
