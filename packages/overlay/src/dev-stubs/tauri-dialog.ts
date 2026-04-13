// Dev-only stub for `@tauri-apps/plugin-dialog`. Used by vite alias when
// running outside the Tauri webview (e.g. `bun run dev:vite` for visual
// iteration). Real Tauri builds bypass this via the rollup `external` rule.
export async function open(_opts?: unknown): Promise<string | string[] | null> {
  console.warn("[dev-stub] @tauri-apps/plugin-dialog `open` called outside Tauri")
  return null
}
export async function save(_opts?: unknown): Promise<string | null> {
  console.warn("[dev-stub] @tauri-apps/plugin-dialog `save` called outside Tauri")
  return null
}
export async function message(_opts?: unknown): Promise<void> {
  console.warn("[dev-stub] @tauri-apps/plugin-dialog `message` called outside Tauri")
}
export async function ask(_opts?: unknown): Promise<boolean> {
  console.warn("[dev-stub] @tauri-apps/plugin-dialog `ask` called outside Tauri")
  return false
}
export async function confirm(_opts?: unknown): Promise<boolean> {
  console.warn("[dev-stub] @tauri-apps/plugin-dialog `confirm` called outside Tauri")
  return false
}
