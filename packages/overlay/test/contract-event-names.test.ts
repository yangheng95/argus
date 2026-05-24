import { test, expect } from "bun:test";
import path from "node:path";

// ── Wire-format contract test ──
//
// The overlay's notification path went silent for months because the
// consumer (`events.ts`, `tree-writer.ts`, `notify.ts`) listened for event
// names the engine never emits — `interaction.created` instead of
// `interaction.requested`, and `task.completed/failed/cancelled` for which
// no producer existed at all. Single-file unit tests passed because the
// fixtures invented the same wrong names.
//
// This test reads the OpenAPI contract (generated from the engine's
// BusEvent registry by `bun run --cwd packages/sdk/js build`) and asserts
// that every event the overlay listens to is either a real producer event
// or an explicitly documented SSE-meta marker the server inserts directly
// in the per-stream handler (heartbeat / connected / replay_expired).
//
// If you add a `type === "<event-name>"` branch to the overlay, either:
//   (a) the producer side declares a matching BusEvent.define, OR
//   (b) you add the event to META_EVENT_NAMES below with a one-line note
//       pointing at the route handler that emits it.

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const OPENAPI_PATH = path.join(REPO_ROOT, "packages", "sdk", "openapi.json");

// SSE control frames the route handlers insert directly into the stream;
// they are NOT BusEvent and intentionally absent from openapi.json's Event.*.
const META_EVENT_NAMES = new Set<string>([
  // Per-task SSE: server/routes/orchestrator.ts (taskEvent connected/heartbeat)
  "task.connected",
  "task.heartbeat",
  // Global task-list SSE: server/routes/orchestrator.ts (/task/events)
  "task-list.connected",
  "task-list.heartbeat",
  // Replay window expired hint (consumer reloads). Server-side notification,
  // not a BusEvent.
  "task.replay_expired",
  // Selected-task live replay retention/epoch failure. Server-side control
  // frame from GET /task/:taskID/events, not a BusEvent.
  "task.live_replay_expired",
  // App-level SSE connect / heartbeat
  "server.connected",
  "server.heartbeat",
]);

async function loadProducerEventNames(): Promise<Set<string>> {
  const text = await Bun.file(OPENAPI_PATH).text();
  const spec = JSON.parse(text) as {
    components?: { schemas?: Record<string, unknown> };
  };
  const schemas = spec.components?.schemas ?? {};
  const names = new Set<string>();
  for (const key of Object.keys(schemas)) {
    if (!key.startsWith("Event.")) continue;
    // "Event.task.created" → "task.created"
    names.add(key.slice("Event.".length));
  }
  return names;
}

test("openapi.json declares the terminal task events the overlay's OS-notification path depends on", async () => {
  const producer = await loadProducerEventNames();
  // These four events are the difference between "OS toast actually pings
  // the operator when work finishes" and "the operator never gets notified".
  // If openapi.json lacks them, the engine BusEvent.define was rolled back
  // or the SDK was not rebuilt after the engine change.
  expect(producer.has("interaction.requested")).toBe(true);
  expect(producer.has("task.completed")).toBe(true);
  expect(producer.has("task.failed")).toBe(true);
  expect(producer.has("task.cancelled")).toBe(true);
});

test("openapi.json does NOT declare the historical bogus event names that masked the bug", async () => {
  const producer = await loadProducerEventNames();
  // These names appeared in consumer code and fixtures but were never
  // emitted by any producer. The renames in 2026-05-12 retired them.
  expect(producer.has("interaction.created")).toBe(false);
});

test("every event the overlay's OS-notification path listens to is a known wire event", async () => {
  // Single source of truth: this list mirrors the type checks in
  // `packages/overlay/src/services/events.ts` (interaction.requested,
  // task.completed/failed/cancelled, task.replay_expired) and
  // `tree-writer.ts` (interaction.requested, interaction.resolved,
  // task.created/updated/completed). If you add a branch there, add the
  // name here too.
  const overlaySubscribes = [
    "interaction.requested",
    "interaction.resolved",
    "task.created",
    "task.updated",
    "task.completed",
    "task.failed",
    "task.cancelled",
    "task.replay_expired",
    "task.live_replay_expired",
    "review.stream.started",
    "review.stream.progress",
    "review.stream.chunk",
    "integrity.review.completed",
  ];
  const producer = await loadProducerEventNames();
  const unknown = overlaySubscribes.filter(
    (name) => !producer.has(name) && !META_EVENT_NAMES.has(name),
  );
  expect(unknown).toEqual([]);
});
