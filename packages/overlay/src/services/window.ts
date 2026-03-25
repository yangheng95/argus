// ── Window / UI Service ──
// Exact port of app.js window-management and UI helper functions that operate
// on the Tauri window handle or on global DOM state.
//
// Exported functions:
//   setTrayAttention   — toggle the tray icon attention state via Tauri
//   setConnStatus      — update the DOM connection badge
//   startElapsedTimer  — start the task elapsed-time interval
//   stopTimers         — clear all active timers and stop SSE
//   fitBrandVersion    — shrink the brand-version element to fit its container
//   syncExecutorWidth  — equalise executor chip button widths

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
// Mirrors app.js setTrayAttention() (line 1162).
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
// Mirrors app.js setConnStatus() (line 3817).
// Update the DOM connection badge to reflect the current connection state.
// The badge element's text is set via the legacy t() i18n global to avoid
// importing the full i18n module during migration.

export function setConnStatus(status: "online" | "offline" | "connecting"): void {
  if (typeof document === "undefined") return;
  const legacyT = (window as any).t as
    | ((key: string) => string)
    | undefined;
  const t = (key: string) =>
    typeof legacyT === "function" ? legacyT(key) : key;

  document.body.dataset.connection = status;
  const badge = document.getElementById("connBadge") as HTMLElement | null;
  if (!badge) return;
  badge.dataset.status = status;
  badge.textContent =
    status === "online"
      ? t("titlebar.connection.online")
      : status === "connecting"
        ? t("titlebar.connection.connecting")
        : t("titlebar.connection.offline");
}

// ── startElapsedTimer ──
// Mirrors app.js startElapsedTimer() (line 5929).
// Start a 1-second interval that updates the elapsed-time DOM element.
// Returns a cleanup function that clears the interval.
//
// The caller is responsible for storing and cancelling the returned handle.
// In the legacy app.js path the handle is stored in state.elapsedTimer.

export function startElapsedTimer(
  startTime: number,
  opts: {
    getCompletedTime?: () => number | null | undefined;
    formatDuration: (ms: number) => string;
    onTick: (text: string) => void;
  },
): ReturnType<typeof setInterval> | null {
  if (!startTime) {
    opts.onTick("");
    return null;
  }
  const update = () => {
    const end = opts.getCompletedTime?.() ?? Date.now();
    opts.onTick(opts.formatDuration(end - startTime));
  };
  update();
  const completed = opts.getCompletedTime?.();
  if (completed) return null;
  return setInterval(update, 1000);
}

// ── fitBrandVersion ──
// Mirrors app.js fitBrandVersion() (line 3890).
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
// Mirrors app.js syncExecutorWidth() (line 3985).
// Measure all executor chip buttons and set --engine-chip-width to the widest.

export function syncExecutorWidth(): void {
  const bar = document.getElementById("engineBar") as HTMLElement | null;
  if (!bar) return;
  bar.style.removeProperty("--engine-chip-width");
  const buttons = [
    ...bar.querySelectorAll<HTMLElement>("[data-executor]"),
  ];
  const width = buttons.reduce(
    (max, btn) => Math.max(max, Math.ceil(btn.getBoundingClientRect().width)),
    0,
  );
  if (width > 0) {
    bar.style.setProperty("--engine-chip-width", `${width}px`);
  }
}
