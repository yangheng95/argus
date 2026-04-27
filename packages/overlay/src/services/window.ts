// ── Window / UI Service ──
// on the Tauri window handle or on global DOM state.
// Exported functions:
// setTrayAttention — toggle the tray icon attention state via Tauri
// fitBrandVersion — shrink the brand-version element to fit its container

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

