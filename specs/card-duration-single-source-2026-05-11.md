# Card Duration Single Source Repair Plan

Date: 2026-05-11

## Problem

Two independent code paths render the per-card elapsed/duration string, producing visually inconsistent UX (rule 8 violation).

Path A — `CardHeader.tsx:46-56,255-270`
- Trigger: `time` AND `timeCompleted` both set.
- Function: local `formatDuration(ms)` (hard-coded English, zero-suppression).
- DOM: `.card__duration` inline chip in `card__title-row`.
- Text: `6m 10s` (no suffix).
- Only renders for completed cards.

Path B — `tree-writer.ts:843-883`
- Trigger: `integrity.review.progress` SSE event every 20s while integrity is running.
- Function: local `formatElapsed(sec)` (appends " elapsed").
- DOM: writes `node.subtitle` → `.card__subtitle` span (different style/position).
- Text: `1m 20s elapsed`, or `attempt N · 1m 20s elapsed`.
- Only present on the running integrity card.

Hidden third source — `utils/time.ts:29-36`
- Existing i18n-aware `formatDuration` already used by `TaskStatusHeader`. CardHeader and tree-writer both reinvented it.

## Goals

- One time-display path for every card row, running and completed alike.
- Single shared `formatDuration` (`utils/time.ts`).
- One DOM target (`.card__duration`), one CSS rule.
- `card.subtitle` field reserved for genuine subtitles (verdict, attempt label, tool args, phase summary).
- One shared 1Hz tick signal (replaces TaskStatusHeader's private interval + the eliminated subtitle hack).

## Non-Goals

- Do not rewrite duration string format substantively (keep `Xs` / `Xm Ys` / `Xh Ym Ys`).
- Do not change backend `integrity.review.progress` event shape.
- Do not introduce per-card `setInterval`s.

## Root Cause

Path A's `<Show when>` requires `timeCompleted`, so running cards have no chip. Operator needed live elapsed for the long-running integrity check, so the back-end fix was a tree-writer shortcut: write the elapsed string into `subtitle`. That works visually but forks the time-display contract and rots the `subtitle` field's meaning.

## Design

### Step 1 — shared tick: `services/clock.ts`

New `useNowTick(intervalMs = 1000): () => number`.

- Module-level `createSignal<number>(Date.now())`.
- Reference-counted: first subscriber starts `setInterval`; last subscriber's `onCleanup` stops it.
- Visibility-gated: pauses while `document.visibilityState !== "visible"` (battery-saver, mirrors TaskStatusHeader's existing gate).

### Step 2 — `CardHeader.tsx`

- Drop local `formatDuration`; import from `utils/time`.
- Rewrite the duration chip's selector:

```ts
function durationMs(): number | null {
  const start = props.node.time;
  if (!Number.isFinite(start) || start <= 0) return null;
  const end = props.node.timeCompleted;
  if (Number.isFinite(end) && (end as number) > start) {
    return (end as number) - start;
  }
  if (props.node.status === "running") {
    return now() - start;        // useNowTick(), subscribed lazily
  }
  return null;
}
```

- Chip text always `formatDuration(durationMs()!)` — no " elapsed" suffix anywhere.
- Tooltip stays as `card.duration_tooltip` (existing i18n key).
- Only subscribe to `useNowTick` when `status === "running"` and `time` is set.

### Step 3 — `tree-writer.ts`

- Delete `formatElapsed`.
- `materializeRunningIntegrity` no longer composes an elapsed string. New subtitle rule:

```ts
const subtitle = p.attempt > 0
  ? t("integrity.attempt_label", { value: p.attempt })
  : undefined;
```

- `RunningIntegrityPayload.elapsedMs` is retained because it still feeds `startedAt = existing?.startedAt ?? (Date.now() - elapsedMs)` for SSE-replay startedAt recovery. It no longer reaches the DOM.

### Step 4 — i18n

Add to both `zh-CN.json` and `en-US.json`:

```jsonc
"integrity.attempt_label": "attempt {{value}}"   // en
"integrity.attempt_label": "第 {{value}} 次尝试" // zh
```

### Step 5 — `TaskStatusHeader.tsx`

Switch its private 1Hz interval to `useNowTick()` for consistency. Same visibility gate, no behavior change.

### Step 6 — Tests (rule 36)

| Test | Assertion |
|---|---|
| new `card-duration-running.test.ts` | `<CardHeader>` with `time = now - 65s`, `status: "running"`, no `timeCompleted` → renders `.card__duration` whose text matches `/1m\s+5s/` and does **not** contain `"elapsed"` |
| same | `timeCompleted = time + 130_000`, `status: "completed"` → renders `2m 10s`, no `"elapsed"` |
| same | `time` undefined or zero → `.card__duration` absent |
| update `tree-writer-hierarchy.test.ts` | `integrity.review.progress {attempt: 2, elapsedMs: 80_000}` → `cards[integrityCardID].subtitle === t("integrity.attempt_label", {value: 2})` and `!subtitle.includes("elapsed")` |
| same | `attempt: 0` → `subtitle === undefined` |
| new `services-clock.test.ts` | two subscribers share one interval; full unsubscribe stops it; visibility-hidden pauses tick |

### Step 7 — Acceptance

- `bun typecheck`, `bun test` green.
- `bun run build:overlay` green.
- Dev run integrated test: launch a task that reaches the integrity stage, visually confirm running + completed cards use the same `.card__duration` chip in the same DOM position with no `"elapsed"` suffix.

## File list

| Op | Path |
|---|---|
| new | `packages/overlay/src/services/clock.ts` |
| edit | `packages/overlay/src/components/CardHeader.tsx` |
| edit | `packages/overlay/src/components/TaskStatusHeader.tsx` |
| edit | `packages/overlay/src/services/tree-writer.ts` |
| edit | `packages/overlay/src/i18n/zh-CN.json` |
| edit | `packages/overlay/src/i18n/en-US.json` |
| new | `packages/overlay/test/card-duration-running.test.ts` |
| new | `packages/overlay/test/services-clock.test.ts` |
| edit | `packages/overlay/test/tree-writer-hierarchy.test.ts` |

## Risks

- **Zero-suppression difference**: `utils/time.formatDuration` emits `6m 0s` where the old CardHeader local emitted `6m`. Acceptable for an unambiguous read; if rejected, add `time.duration.minute_only` / `time.duration.hour_only` i18n keys later.
- **Visibility-pause**: When the overlay is hidden, all running chips freeze. Same trade-off TaskStatusHeader already accepts.
- **`elapsedMs` becoming dead-weight on the wire**: kept for `startedAt` reconstruction during SSE replay; document via comment.
