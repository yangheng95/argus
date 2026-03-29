// ── Executor Store ──
// Solid reactive store for executor events.
// Replaces direct reads of state.executorEvents / state.executorRunID.

import { batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";

// ── Types ──

export interface ExecutorEvent {
  id: string;
  runID: string;
  kind: string;
  summary: string;
  payload: Record<string, any>;
  sourceID: string;
  sourceKind: string;
  sourceLabel: string;
  sourceStatus: string;
  goalRunID: string;
  executorSessionID: string;
  time: { created: number };
  _targetText?: string;
  _liveText?: string;
}

// ── Store ──

const [store, setStore] = createStore({
  events: [] as ExecutorEvent[],
  runID: "" as string,
  fetchedAt: 0,
});

export { store as executorStore };

const EXECUTOR_LIVE_INTERVAL = 32;
const executorLiveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── Append / merge helpers ──

function executorDeltaKind(kind: string): boolean {
  return kind === "message_delta" || kind === "reasoning_delta";
}

function executorEventScopeID(event: ExecutorEvent): string {
  if (!event) return "";
  if (event.goalRunID) return `goal:${event.goalRunID}`;
  if (event.executorSessionID) return `session:${event.executorSessionID}`;
  if (event.runID) return `run:${event.runID}`;
  return "";
}

function sameExecutorEventScope(left: ExecutorEvent, right: ExecutorEvent): boolean {
  const a = executorEventScopeID(left);
  const b = executorEventScopeID(right);
  if (!a || !b) return true;
  return a === b;
}

function sameExecutorEventStream(left: ExecutorEvent, right: ExecutorEvent): boolean {
  return (!left?.runID || !right?.runID || left.runID === right.runID) &&
    sameExecutorEventScope(left, right);
}

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function executorTargetText(event: ExecutorEvent): string {
  if (typeof event._targetText === "string") return event._targetText;
  if (typeof event.summary === "string") return event.summary;
  return "";
}

function executorEventKey(event: ExecutorEvent | null | undefined): string {
  return String(event?.id || "").trim();
}

function stopExecutorLiveTimer(key: string): void {
  const timer = executorLiveTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  executorLiveTimers.delete(key);
}

function nextLiveLength(live: string, target: string): number {
  if (!target) return 0;
  if (!live) return Math.min(target.length, 1);
  const remaining = target.length - live.length;
  if (remaining <= 0) return target.length;
 // Avoid a long one-character tail when timers are slightly delayed.
  if (remaining <= 6) return target.length;
  return Math.min(target.length, live.length + Math.max(1, Math.ceil(remaining / 2)));
}

function advanceExecutorLiveText(key: string): void {
  const index = store.events.findIndex((item) => executorEventKey(item) === key);
  if (index < 0) {
    stopExecutorLiveTimer(key);
    return;
  }
  const event = store.events[index];
  const target = executorTargetText(event);
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (!target) {
    stopExecutorLiveTimer(key);
    return;
  }
  if (live.length >= target.length) {
    if (live !== target) {
      setStore("events", index, "_liveText", target);
    }
    stopExecutorLiveTimer(key);
    return;
  }
  setStore("events", index, "_liveText", target.slice(0, nextLiveLength(live, target)));
  executorLiveTimers.set(
    key,
    setTimeout(() => advanceExecutorLiveText(key), EXECUTOR_LIVE_INTERVAL),
  );
}

function scheduleExecutorLiveText(event: ExecutorEvent): void {
  const key = executorEventKey(event);
  if (!key) return;
  const target = executorTargetText(event);
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (!target || live.length >= target.length) {
    stopExecutorLiveTimer(key);
    return;
  }
  if (executorLiveTimers.has(key)) return;
  executorLiveTimers.set(
    key,
    setTimeout(() => advanceExecutorLiveText(key), EXECUTOR_LIVE_INTERVAL),
  );
}

function mergeExecutorDelta(current: ExecutorEvent, event: ExecutorEvent): ExecutorEvent {
  const delta = typeof event.payload?.text === "string" ? event.payload.text : event.summary || "";
  const previous = typeof current.payload?.text === "string"
    ? current.payload.text
    : executorTargetText(current);
  return {
    ...current,
    summary: previous + delta,
    payload: {
      ...(record(current.payload) ? current.payload : {}),
      ...(record(event.payload) ? event.payload : {}),
      text: previous + delta,
    },
    _targetText: previous + delta,
    _liveText: typeof current._liveText === "string" ? current._liveText : previous,
  };
}

function mergeEventList(events: ExecutorEvent[], event: ExecutorEvent): ExecutorEvent[] {
  const index = event.id
    ? events.findIndex((item) => item.id === event.id)
    : -1;

  if (index >= 0) {
    if (executorDeltaKind(event.kind)) {
      events[index] = mergeExecutorDelta(events[index], event);
    } else {
      events[index] = {
        ...events[index],
        ...event,
        payload: {
          ...(record(events[index]?.payload) ? events[index].payload : {}),
          ...(record(event?.payload) ? event.payload : {}),
        },
      };
    }
    return events;
  }

  let sourceIndex = -1;
  if (executorDeltaKind(event.kind)) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const item = events[i];
      if (item.kind !== event.kind) continue;
      if (!sameExecutorEventStream(item, event)) continue;
      if (event.sourceID) {
        if (item.sourceID === event.sourceID) {
          sourceIndex = i;
          break;
        }
        continue;
      }
      if (event.kind === "reasoning_delta") {
        sourceIndex = i;
        break;
      }
    }
  }

  if (sourceIndex >= 0) {
    const merged = mergeExecutorDelta(events[sourceIndex], event);
    events[sourceIndex] = { ...merged, id: events[sourceIndex].id };
    return events;
  }

  events.push(event);
  return events;
}

// ── Public API ──

export function appendExecutorEvent(event: ExecutorEvent): void {
  if (!event) return;

  if (event.runID && store.runID && store.runID !== event.runID) {
 // New run — discard stale events and adopt the new runID
    setStore("events", reconcile([]));
    setStore("runID", event.runID);
  }
  if (event.runID && !store.runID) {
    setStore("runID", event.runID);
  }

  // Use produce() for in-place mutation — only the affected event index
  // triggers reactive updates, not the entire array.
  setStore("events", produce((events) => {
    mergeEventList(events as ExecutorEvent[], event);
  }));
  setStore("fetchedAt", Date.now());

  const key = executorEventKey(event);
  if (key) {
    const idx = store.events.findIndex((item) => executorEventKey(item) === key);
    if (idx >= 0) scheduleExecutorLiveText(store.events[idx] as ExecutorEvent);
  }
}

export function clearExecutorEvents(): void {
  for (const key of executorLiveTimers.keys()) {
    stopExecutorLiveTimer(key);
  }
  setStore("events", reconcile([]));
  setStore("runID", "");
  setStore("fetchedAt", 0);
}

export function setExecutorEvents(events: ExecutorEvent[], runID?: string): void {
  for (const key of executorLiveTimers.keys()) {
    stopExecutorLiveTimer(key);
  }
  batch(() => {
    setStore("events", reconcile(Array.isArray(events) ? events : []));
    if (runID !== undefined) setStore("runID", runID);
    setStore("fetchedAt", Date.now());
  });
}
