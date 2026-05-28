// ── TopBar (Phase 6) ──
// Slim title bar shown above the Mission main panel.
// Left:  current cwd (clickable to switch project — opens browser dialog).
// Right: connection badge (reuses ConnectionBadge mount logic via main.tsx).
//
// This component is *layout-only*; it doesn't subscribe to anything beyond
// settingsStore.directory. Cwd switching is delegated to applyDirectory(),
// the same function the existing Settings → General panel uses.

import { Show } from "solid-js";
import { settingsStore } from "../store/settings";
import { applyDirectory, pickDirectory } from "../services/workspace";
import { Icon } from "./Icon";

export interface TopBarProps {
  /** Slot for the right-side controls (connection badge, window controls). */
  rightSlot?: () => any;
}

function shortenPath(p: string, max = 64): string {
  if (!p) return "";
  if (p.length <= max) return p;
  // Drop middle, keep root + tail.
  const head = p.slice(0, Math.max(8, Math.floor(max / 3)));
  const tail = p.slice(-(max - head.length - 1));
  return `${head}…${tail}`;
}

async function switchCwd(): Promise<void> {
  // Routes through HostTransport so the same call works under Tauri,
  // VS Code (M5 will wire it to vscode.window.showOpenDialog), and
  // throws UnsupportedNativeCommandError everywhere else (CLAUDE.md
  // §一-7: no silent prompt fallback — vite-preview users can supply
  // a directory via settings instead).
  const next = await pickDirectory(settingsStore.directory ?? undefined);
  if (!next) return;
  await applyDirectory(next, {});
}

export function TopBar(props: TopBarProps) {
  return (
    <div class="top-bar" role="banner">
      <button
        type="button"
        class="top-bar-cwd"
        title={settingsStore.directory || "Choose project directory"}
        onClick={switchCwd}
      >
        <span class="top-bar-cwd-icon" aria-hidden="true">
          <Icon name="folder" />
        </span>
        <span class="top-bar-cwd-path">
          {shortenPath(settingsStore.directory ?? "", 56) || "Choose project…"}
        </span>
        <span class="top-bar-cwd-caret" aria-hidden="true">
          <Icon name="caret-down" />
        </span>
      </button>
      <div class="top-bar-spacer" />
      <Show when={props.rightSlot}>
        <div class="top-bar-right">{props.rightSlot!()}</div>
      </Show>
    </div>
  );
}
