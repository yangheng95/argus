// ── TaskStatusHeader ──
// Replaces the previous imperative createEffects in main.tsx that toggled
// `#taskStatus[hidden]`, wrote `#statusIcon.innerHTML`, set `#statusLabel`'s
// textContent, and ticked `#taskElapsed` every second via getElementById.
// The whole block is now driven by Solid signals: a single reactive subtree
// that updates only the affected text/attribute when boardStore changes.

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { boardStore } from "../store/board";
import { statusIconName } from "../utils/status-mapping";
import { Icon } from "./Icon";
import { t } from "../utils/i18n";
import { formatDuration } from "../utils/time";

const LIVE_STATUSES = new Set(["active", "queued"]);

export function TaskStatusHeader() {
  const task = createMemo(() => (boardStore.board as any)?.task);
  const status = createMemo<string>(() => task()?.status || "idle");
  const startTime = createMemo<number>(() => task()?.time?.created || 0);
  const completedTime = createMemo<number>(() => task()?.time?.completed || 0);
  const isLive = createMemo(() => LIVE_STATUSES.has(status()));
  const visible = createMemo(() => Boolean(boardStore.selectedTaskID));

  // Tick state: only the live-task path drives a 1Hz interval, and only while
  // the overlay window is visible. The previous imperative effect already had
  // this gate; we preserve it exactly to keep the battery-saver behaviour
  // earned in the prior commit.
  const [now, setNow] = createSignal(Date.now());
  const [windowVisible, setWindowVisible] = createSignal(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );
  if (typeof document !== "undefined") {
    const onVis = () => setWindowVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    onCleanup(() => document.removeEventListener("visibilitychange", onVis));
  }

  createEffect(() => {
    if (!visible() || !startTime() || !isLive() || !windowVisible()) return;
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(handle));
  });

  const elapsedText = createMemo(() => {
    const start = startTime();
    if (!visible() || !start) return "";
    if (!isLive()) return formatDuration((completedTime() || Date.now()) - start);
    return formatDuration(now() - start);
  });

  const labelText = createMemo(() =>
    visible() ? t(`task.status.${status()}`) : t("task.status.idle"),
  );

  return (
    <Show when={visible()}>
      <div class="task-status chat-task-status" id="taskStatus">
        <span
          class="status-icon"
          id="statusIcon"
          data-status={status()}
          aria-hidden="true"
        >
          <Icon name={statusIconName(status())} />
        </span>
        <span class="status-copy">
          <span class="status-label" id="statusLabel">{labelText()}</span>
          <span class="elapsed" id="taskElapsed">{elapsedText()}</span>
        </span>
      </div>
    </Show>
  );
}
