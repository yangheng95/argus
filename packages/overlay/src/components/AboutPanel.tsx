// ── AboutPanel Component ──
// Solid.js port of renderAboutVersion from app.js.
// Displays a runtime-info grid: overlay version, core version, server URL,
// connection status, active directory, executor, and task count.

import { For } from "solid-js";
import { boardStore } from "../store/board";
import { settingsStore } from "../store/settings";
import { t } from "../utils/i18n";

// ── Overlay version constant (mirrors app.js OVERLAY_VERSION) ──

const OVERLAY_VERSION = "0.0.1-alpha";

// ── AboutPanel ──

export interface AboutPanelProps {
  /** Core (server) version string — empty string if not yet known. */
  coreVersion: string;
  /** Whether the overlay is currently connected to the server. */
  connected: boolean;
}

export function AboutPanel(props: AboutPanelProps) {
  // Derive rows — mirrors the rows[] array in app.js renderAboutVersion
  const rows = () => {
    const tasks = Array.isArray(boardStore.tasks)
      ? boardStore.tasks
      : [];
    const dir =
      (boardStore.board as any)?.task?.directory ||
      settingsStore.directory ||
      "";

    return [
      [t("about.rt_overlay"), `v${OVERLAY_VERSION}`],
      [
        t("about.rt_core"),
        props.coreVersion || t("about.rt_unavailable"),
      ],
      [
        t("about.rt_server"),
        settingsStore.serverUrl || "-",
      ],
      [
        t("about.rt_connection"),
        props.connected
          ? t("about.rt_connected")
          : t("about.rt_disconnected"),
      ],
      [t("about.rt_directory"), dir || "-"],
      [t("about.rt_executor"), settingsStore.executor || "-"],
      [t("about.rt_tasks"), String(tasks.length)],
    ] as [string, string][];
  };

  return (
    <div class="about-panel">
      <div id="aboutRuntimeGrid" class="about-runtime-grid">
        <For each={rows()}>
          {([label, value]) => (
            <>
              <span class="about-info-label">{label}</span>
              <span class="about-info-value">{value}</span>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
