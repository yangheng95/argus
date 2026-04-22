// ── Native / Platform Utilities ──
// Exported functions:
// nativeConfirm — show a confirm dialog (ok/cancel)
// nativePrompt — show a text-input dialog
// nativeSelect — show a select-option dialog
// nativeOpen — open a URL or filesystem path via the Tauri plugin

import { showAppDialog } from "../services/app-dialog";

// ── nativeConfirm ──
// Shows a confirm dialog and returns true when the user clicked OK.

export async function nativeConfirm(
  message: string,
  options?: {
    title?: string;
    kind?: string;
    okLabel?: string;
    cancelLabel?: string;
  },
): Promise<boolean> {
  const result = await showAppDialog({
    title: options?.title,
    message,
    kind: options?.kind || "warning",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true,
  });
  return !!result?.confirmed;
}

// ── nativePrompt ──
// Shows a text-input dialog and returns the entered value, or null if cancelled.

export async function nativePrompt(
  message: string,
  options?: {
    title?: string;
    kind?: string;
    okLabel?: string;
    cancelLabel?: string;
    inputLabel?: string;
    inputPlaceholder?: string;
    inputValue?: string;
  },
): Promise<string | null> {
  const result = await showAppDialog({
    title: options?.title,
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true,
    input: true,
    inputLabel: options?.inputLabel,
    inputPlaceholder: options?.inputPlaceholder || "",
    inputValue: options?.inputValue || "",
  });
  return result?.confirmed ? (result.value ?? null) : null;
}

// ── nativeSelect ──
// Shows a select-option dialog and returns the chosen value, or null if cancelled.

export interface SelectOption {
  value: string;
  label?: string;
}

export async function nativeSelect(
  message: string,
  options?: {
    title?: string;
    kind?: string;
    okLabel?: string;
    cancelLabel?: string;
    selectLabel?: string;
    selectValue?: string;
    options?: SelectOption[];
  },
): Promise<string | null> {
  const list = Array.isArray(options?.options) ? options!.options : [];
  if (!list.length) return null;
  const result = await showAppDialog({
    title: options?.title,
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true,
    select: true,
    selectLabel: options?.selectLabel,
    selectOptions: list,
    selectValue: options?.selectValue || list[0]?.value || "",
  });
  return result?.confirmed ? (result.value ?? null) : null;
}

// ── nativeOpen ──
// Open a URL or filesystem path via the Tauri opener plugin.
// Throws when the Tauri runtime is unavailable (e.g. vite dev preview).

export async function nativeOpen(target: string): Promise<boolean> {
  if (!target) return false;
  const isUrl = /^https?:\/\//i.test(target);
  const invoke = (window as any).__TAURI__?.core?.invoke as
    | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  if (typeof invoke !== "function") {
    if (isUrl) {
      window.open(target, "_blank", "noopener");
      return true;
    }
    throw new Error("Tauri runtime unavailable — cannot open " + target);
  }
  const opened = isUrl
    ? await invoke("overlay_open_url", { url: target })
    : await invoke("overlay_open_path", { path: target });
  return opened === true;
}
