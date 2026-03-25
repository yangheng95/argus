// ── Executor Store ──
// Solid reactive store for executor events.
// Replaces direct reads of app.js state.executorEvents / state.executorRunID.

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

function mergeExecutorDelta(current: ExecutorEvent, event: ExecutorEvent): ExecutorEvent {
  const delta = typeof event.payload?.text === "string" ? event.payload.text : event.summary || "";
  const previous = executorTargetText(current);
  return {
    ...current,
    summary: previous + delta,
    payload: {
      ...(record(current.payload) ? current.payload : {}),
      ...(record(event.payload) ? event.payload : {}),
      text: previous + delta,
    },
    _targetText: previous + delta,
    _liveText: typeof current._liveText === "string" ? current._liveText : "",
  };
}

function mergeEventList(events: ExecutorEvent[], event: ExecutorEvent): ExecutorEvent[] {
  const index = event.id
    ? events.findIndex((item) => item.id === event.id)
    : -1;

  if (index >= 0) {
    if (executorDeltaKind(event.kind)) {
      const next = mergeExecutorDelta(events[index], event);
      return [...events.slice(0, index), next, ...events.slice(index + 1)];
    }
    return [
      ...events.slice(0, index),
      {
        ...events[index],
        ...event,
        payload: {
          ...(record(events[index]?.payload) ? events[index].payload : {}),
          ...(record(event?.payload) ? event.payload : {}),
        },
      },
      ...events.slice(index + 1),
    ];
  }

  const sourceIndex =
    executorDeltaKind(event.kind) && event.sourceID
      ? events.findIndex(
          (item) =>
            item.kind === event.kind &&
            item.sourceID === event.sourceID &&
            sameExecutorEventStream(item, event),
        )
      : -1;

  if (sourceIndex >= 0) {
    const merged = mergeExecutorDelta(events[sourceIndex], event);
    return [
      ...events.slice(0, sourceIndex),
      { ...merged, id: events[sourceIndex].id },
      ...events.slice(sourceIndex + 1),
    ];
  }

  return [...events, event];
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

  const merged = mergeEventList([...store.events], event);
  setStore("events", reconcile(merged));
  setStore("fetchedAt", Date.now());
}

export function clearExecutorEvents(): void {
  setStore("events", reconcile([]));
  setStore("runID", "");
  setStore("fetchedAt", 0);
}

export function setExecutorEvents(events: ExecutorEvent[]): void {
  setStore("events", reconcile(Array.isArray(events) ? events : []));
  setStore("fetchedAt", Date.now());
}
