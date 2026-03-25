// ── Native / Platform Utilities ──
// Exact port of app.js native dialog and OS-open helpers to TypeScript.
//
// Exported functions:
//   nativeConfirm  — show a confirm dialog (ok/cancel)
//   nativePrompt   — show a text-input dialog
//   nativeSelect   — show a select-option dialog
//   nativeOpen     — open a URL in the browser or a path with the OS
//
// All dialog functions delegate to the app.js `showAppDialog` global via
// the window bridge so that no circular import is introduced while the Solid
// migration is in progress.  Once the dialog component is fully ported to
// Solid these can be wired directly.

import { AppLog } from "./log";
import { apiJson } from "../services/api";

// ── Internal: bridge to app.js globals ──

function legacyFn(name: string, ...args: unknown[]): unknown {
  const fn = (window as any)[name];
  if (typeof fn === "function") return fn(...args);
  return undefined;
}

// ── nativeConfirm ──
// Mirrors app.js nativeConfirm() (line 3567).
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
  const result = await (legacyFn("showAppDialog", {
    title: options?.title,
    message,
    kind: options?.kind || "warning",
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
    cancel: true,
  }) as Promise<{ confirmed: boolean; value: any }>);
  return !!result?.confirmed;
}

// ── nativePrompt ──
// Mirrors app.js nativePrompt() (line 3588).
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
  const result = await (legacyFn("showAppDialog", {
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
  }) as Promise<{ confirmed: boolean; value: string | null }>);
  return result?.confirmed ? (result.value ?? null) : null;
}

// ── nativeSelect ──
// Mirrors app.js nativeSelect() (line 3604).
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
  const result = await (legacyFn("showAppDialog", {
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
  }) as Promise<{ confirmed: boolean; value: string | null }>);
  return result?.confirmed ? (result.value ?? null) : null;
}

// ── nativeOpen ──
// Mirrors app.js nativeOpen() (line 3728).
// Open a URL with the native browser, or a file-system path with the OS shell.
// Falls back to the server path/open API for filesystem paths when Tauri is not
// available.

export async function nativeOpen(target: string): Promise<boolean> {
  if (!target) return false;
  const isUrl = /^https?:\/\//i.test(target);
  const invoke = (window as any).__TAURI__?.core?.invoke as
    | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  if (typeof invoke === "function") {
    try {
      const opened = isUrl
        ? await invoke("overlay_open_url", { url: target })
        : await invoke("overlay_open_path", { path: target });
      if (opened) return true;
    } catch {
      // Tauri invoke failed, fall through to browser / API fallbacks
    }
  }
  if (isUrl) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  try {
    const result = await apiJson("path/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target }),
    }) as { opened?: boolean } | undefined;
    return result?.opened === true;
  } catch (openErr) {
    AppLog.debug("ui", "path/open fallback failed", {
      target,
      error: String(openErr),
    });
    return false;
  }
}
