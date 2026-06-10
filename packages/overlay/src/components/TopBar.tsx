// ── TopBar (Phase 6) ──
// Slim title bar shown above the Mission main panel.
// Left:  current cwd (clickable to switch project — opens browser dialog).
// Right: connection badge (reuses ConnectionBadge mount logic via main.tsx).
//
// This component is *layout-only*; it doesn't subscribe to anything beyond
// settingsStore.directory. Cwd switching is delegated to applyDirectory(),
// the same function the existing Settings → General panel uses.

import { Show } from "solid-js"
import { settingsStore } from "../store/settings"
import { applyDirectory, pickDirectory } from "../services/workspace"
import { getHostTransport } from "../services/host-transport"
import { Icon } from "./Icon"

export interface TopBarProps {
  /** Slot for the right-side controls (connection badge, window controls). */
  rightSlot?: () => any
}

function shortenPath(p: string, max = 64): string {
  if (!p) return ""
  if (p.length <= max) return p
  // Drop middle, keep root + tail.
  const head = p.slice(0, Math.max(8, Math.floor(max / 3)))
  const tail = p.slice(-(max - head.length - 1))
  return `${head}…${tail}`
}

async function switchCwd(): Promise<void> {
  // Routes through HostTransport so the same call works under Tauri
  // and VS Code. Hosts without workspace.pickDir do not render this
  // as a clickable control.
  const next = await pickDirectory(settingsStore.directory ?? undefined)
  if (!next) return
  await applyDirectory(next, {})
}

export function TopBar(props: TopBarProps) {
  const canPickDirectory = getHostTransport().capabilities.nativeCommands["workspace.pickDir"]
  const directoryLabel = () => shortenPath(settingsStore.directory ?? "", 56) || "Choose project…"
  const directoryTitle = () => settingsStore.directory || "Choose project directory"
  const directoryContent = () => (
    <>
      <span class="top-bar-cwd-icon" aria-hidden="true">
        <Icon name="folder" />
      </span>
      <span class="top-bar-cwd-path">{directoryLabel()}</span>
      <Show when={canPickDirectory}>
        <span class="top-bar-cwd-caret" aria-hidden="true">
          <Icon name="caret-down" />
        </span>
      </Show>
    </>
  )
  return (
    <div class="top-bar" role="banner">
      <Show
        when={canPickDirectory}
        fallback={
          <div class="top-bar-cwd" title={directoryTitle()} aria-label={directoryTitle()}>
            {directoryContent()}
          </div>
        }
      >
        <button type="button" class="top-bar-cwd" title={directoryTitle()} onClick={switchCwd}>
          {directoryContent()}
        </button>
      </Show>
      <div class="top-bar-spacer" />
      <Show when={props.rightSlot}>
        <div class="top-bar-right">{props.rightSlot!()}</div>
      </Show>
    </div>
  )
}
