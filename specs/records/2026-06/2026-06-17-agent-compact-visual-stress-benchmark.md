# Agent Compact Visual Stress Benchmark - 2026-06-17

## Acronyms

- API: Application Programming Interface, the backend contract used by the overlay.
- DOM: Document Object Model, the rendered browser tree inspected by Playwright.
- GUI: Graphical User Interface, the visible overlay surface.
- ID: Identifier, a task, session, message, part, or artifact key.
- LLM: Large Language Model, the model runtime that produces agent messages.
- PNG: Portable Network Graphics, the screenshot image format used for visual evidence.
- SSE: Server-Sent Events, the task event stream consumed by the overlay.
- UI: User Interface, the compact overlay preview surface.

## Task

Build a repeatable visual stress benchmark for agent compaction in the goal
overlay UI. The benchmark must exercise real overlay rendering, hydrated
conversation state, live SSE timing, compaction summary visibility, validation
failure visibility, crash/restart reload, resume after compaction, narrow layout,
and large handoff content pressure.

If the benchmark starts an HTTP server, it must bind `127.0.0.1:7378`; no
alternate port is allowed.

## Recall

Read before implementation:

- `AGENTS.md`
- `deleted pre-June record 2026-05-13-compaction-handoff-hardening`
- `deleted pre-June record 2026-05-29-compaction-continuation-rewrite`
- `specs/records/2026-06/2026-06-02-compact-agent-fidelity-review.md`
- `specs/records/2026-06/2026-06-04-workflow-auto-compaction-live-continuation.md`
- `specs/records/2026-06/2026-06-03-workflow-auto-compaction-kind-single-source.md`
- `specs/records/2026-06/2026-06-03-compaction-dispatch-anchor-bounded-reference.md`
- `specs/records/2026-06/2026-06-06-compaction-instruction-path-match.md`
- `specs/records/2026-06/2026-06-02-overlay-card-projection-fragility-audit.md`
- `deleted pre-June record 2026-05-16-overlay-message-turn-agent-cards`
- Current code in `packages/opencorvus/src/session/auto-compaction.ts`
- Current code in `packages/opencorvus/src/session/compaction.ts`
- Current code in `packages/opencorvus/src/session/compaction-handoff.ts`
- Current overlay routing in `packages/overlay/src/services/events.ts`
- Current card projection in `packages/overlay/src/services/tree-writer.ts`

Key recall conclusions:

- Compaction is a lifecycle/runtime contract, tail-boundary, resume, and overlay
  projection problem. Testing only summary text quality is insufficient.
- `CompactionHandoff` is the single structured source for the compact summary.
  Rendered markdown is display output, not a second source.
- Automatic compaction is only valid for workflow kinds with live runtime
  continuation evidence. Unsupported kinds must fail visibly instead of
  pretending to compact.
- `session.compacted` is currently an overlay writer no-op. The visible source
  for users must therefore be the persisted compact summary message and the
  resumed agent message that follows it.
- Compact dispatch anchors retain full text by `anchor_id`; compact prompts
  only include a bounded reference.
- Overlay card projection must preserve real chronology and message identity.
  It must not create synthetic compact separators or hide failures behind local
  UI-only state.

## Call Point Sweep

Command:

```powershell
rg -n "SessionCompaction\.create|SessionCompaction\.process|SessionCompaction\.isOverflow|SessionCompaction\.TestHooks|CompactionHandoff|SessionControl|compaction_request|manual_summarize|session\.compacted|predictiveCompactionDecision|automaticCompactionDecision|maintenanceSummaryFailureMessage|selectPromptFinalMessageFromNewest|result_mode|tail_start_id|anchor_id|hydrateConversationView|applyEvent|TREE_WRITER_NOOP_TYPES" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs -S
```

| Surface              | Evidence                                                                                                                                                                         | Benchmark treatment                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Automatic decision   | `packages/opencorvus/src/session/auto-compaction.ts` owns compact eligibility and disabled workflow kinds.                                                                       | Stress visible unsupported-kind failure and correct compact timing rather than adding host gates.                      |
| Compact process      | `packages/opencorvus/src/session/compaction.ts` queues `SessionControl` rows, runs summary mode, writes summary messages, publishes `session.compacted`, and exposes test hooks. | Model the actual lifecycle: compact request event, summary message, session status, and resumed message.               |
| Handoff schema       | `packages/opencorvus/src/session/compaction-handoff.ts` validates objective, criteria, instructions, todos, chronology, files, tests, blockers, and previous handoff retention.  | Render large valid handoff markdown and explicit validation failure text.                                              |
| Conversation route   | `packages/opencorvus/src/server/routes/session.ts` and orchestrator task routes return conversation payloads with `board`, `transcript`, `view`, `eventReplay`, and `history`.   | Browser fixture must serve the same payload shape; no local-only overlay state.                                        |
| Overlay event router | `packages/overlay/src/services/events.ts` routes task-scope SSE events and selected task recovery.                                                                               | Live timing case sends out-of-order `session.compacted`, `session.status`, and message events through the real stream. |
| Overlay writer       | `packages/overlay/src/services/tree-writer.ts` requires enriched `info.role`, `resolvedRole`, `channel`, and `time.created` on every message.                                    | Fixture messages must satisfy the strict enrichment contract and verify no render-error cards.                         |
| Event policy         | `packages/overlay/src/services/event-policy.ts` lists `session.compacted` as a writer no-op.                                                                                     | Benchmark proves the no-op event cannot be the only visible compact evidence.                                          |
| Browser runner       | `packages/overlay/test/browser-runner.mjs` starts Node browser tests with `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`.                                                       | New benchmark must run through this Node path, not Bun Playwright.                                                     |
| HTTP fixture         | `packages/overlay/test/browser/http-fixture.ts` accepts a fixed port option.                                                                                                     | Use port `7378` exactly and fail if unavailable.                                                                       |

## Input and Output

Input:

- Overlay static bundle served by the browser test fixture.
- A task-scoped backend fixture exposing `/global/tasks`,
  `/task/:taskID/board`, `/task/:taskID/conversation`,
  `/task/:taskID/conversation/events`, `/task/:taskID/transcript`,
  `/task/:taskID/events`, `/task/:taskID/browser-preview`, and ordinary
  control-plane routes.
- Deterministic root, build, compaction, validation-error, unsupported-kind,
  crash/restart, and resumed agent messages.
- Live SSE events for compact timing and resume after page startup.

Output:

- Node-driven browser benchmark assertions.
- PNG screenshots under
  `packages/overlay/.scratch/agent-compact-visual-stress/`.
- `report.json` with request log, stream log, snapshots, screenshot stats, and
  scenario markers.
- A deterministic failure if port `7378` is unavailable.

## Idle Timeout

The benchmark uses inactivity timeout, not total elapsed timeout. Activity
signals are:

- request log length changes
- stream event log length changes
- DOM text signature changes
- `window.cardTree.order/cards` signature changes
- screenshot target dimensions or pixel statistics change

Default idle timeout: 6000 ms for fixture browser states. Node's outer test
timeout remains a last-resort process guard and does not replace the
inactivity-aware wait helper.

## Case Matrix

### Case A - Hydrated Compact Baseline

1. Load overlay at `http://127.0.0.1:7378/ui/index.html`.
2. Restore the selected workspace task from local settings.
3. Hydrate a long pre-compact build message, compact summary message, and
   resumed build message from `/task/:taskID/conversation`.
4. Screenshot `01-hydrated-compact.png`.

Acceptance:

- Compact summary text is visible in chronological order between pre-compact
  and resumed build messages.
- High token pressure is visible through the card usage projection.
- No render-error cards, duplicate top-level IDs, or body horizontal overflow.

### Case B - Live Compact Timing

1. Open the per-task SSE stream.
2. Send `session.compacted` before the summary message.
3. Send the compact summary `message.updated` and `message.part.updated`.
4. Send terminal `session.status`.
5. Send a resumed build message.
6. Screenshot `02-live-timing.png`.

Acceptance:

- The no-op compact lifecycle event alone does not create a fake visible card.
- The compact summary appears when the persisted summary message arrives.
- Resume appears after the summary and does not overwrite the compact card.

### Case C - Validation Failure Is Visible

1. Send a compaction validation failure message with
   `StructuredOutputPayloadError` and required-field details.
2. Send `session.status` terminal error for the compact session.
3. Screenshot `03-validation-failure.png`.

Acceptance:

- The error is visible as conversation content and terminal card state.
- The UI does not render a resumed-success card for the failed compact segment.

### Case D - Unsupported Auto Compact Is Visible

1. Hydrate an unsupported workflow compact attempt.
2. Include the disabled auto compact reason and `ContextOverflowError` text.
3. Screenshot `04-unsupported-auto-compact.png`.

Acceptance:

- Unsupported-kind failure is visible and attributable to compaction policy.
- There is no hidden success state or generic empty agent card.

### Case E - Crash, Reload, And Resume

1. After live compact and resume messages render, reload the browser page.
2. Serve all previously streamed messages from `/conversation`.
3. Assert the same compact and resume ordering after hydrate.
4. Screenshot `05-reload-resume.png`.

Acceptance:

- Reload does not lose compact summary, resumed message, or error cards.
- Hydrated card IDs and visible text remain stable.
- No duplicate summary cards are created after replay.

### Case F - Large Handoff Layout Pressure

1. Hydrate a compact summary with long acceptance criteria, durable instruction
   paths, evidence records, command output, file lists, and next actions.
2. Use desktop and narrow viewport screenshots.
3. Screenshots `06-large-handoff.png` and `07-narrow-layout.png`.

Acceptance:

- Long markdown text wraps within cards.
- No overlapping headers, usage chips, buttons, or text blocks.
- Narrow viewport has no body-level horizontal overflow.

### Case G - Rapid Stream Robustness

1. Send compact summary, resumed message, validation error, and status events in
   a short burst after the stream opens.
2. Assert final order, card uniqueness, and stable status projection.

Acceptance:

- No orphaned `childIDs`.
- No duplicate top-level IDs.
- No page crash, console error, or unhandled 4xx or 5xx request.

## Visual Assertions

Every screenshot is decoded and checked for:

- minimum dimensions matching the target panel
- non-white pixel density above the fixture threshold
- enough unique color buckets to prove a nonblank real UI
- no body-level horizontal overflow
- no render-error cards
- required compact/resume/failure markers visible

## Acceptance

- `cd packages/overlay; node test/browser-runner.mjs test/browser/agent-compact-visual-stress.test.ts`
  passes.
- The benchmark uses port `7378` with no alternate port.
- The benchmark runs through the Node browser runner and asserts
  `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`.
- Screenshots and `report.json` are written under
  `packages/overlay/.scratch/agent-compact-visual-stress/`.
- The final screenshots are manually reviewed after the benchmark passes.
- Any compact rendering or lifecycle bug exposed by the benchmark must be fixed
  with targeted tests before this work is complete.
