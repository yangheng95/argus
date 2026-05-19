# Delivery verification live streaming card — spec & decision

Date: 2026-05-19
Branch: feat/architect-contract-audit-coverage
Trigger: user reported a deliver-phase task where the conversation showed NO
deliver card for the entire ~20min verification, and the cascaded integrity
review card was also missing. Confirmed against runtime DB
(tsk_e3f39ce18001lAEFdjqtCib5bU): `DeliveryService.verify` ran 09:54:58 →
10:15:45 (≈21 min) emitting ZERO during-run events / ZERO session rows /
ZERO conversation messages; only terminal `delivery.gate.rejected` +
`evaluation.completed` + `delivery-agent-verdict` artifact. Verdict was
`rejected` (host gates: runtime web render, unit tests exit1, typecheck
exit1, client_contract specialist review).

## Problem (essence, rule 1)

The deliver phase is a ~20-minute black box in the conversation. The only
trace is the orchestrator's `deliver` tool part stuck on a `running`
spinner. There is no live card, no progress, no reasoning stream — so the
operator cannot tell whether it is working, stalled, or what it is doing.
This is an observability asymmetry vs the `integrity` review, which DOES
stream a live card.

## Reference architecture — why integrity IS visible

EMIT (`packages/opencorvus/src/integrity/agent.ts`):
- `emitIntegrityLifecycle("started")` → `EngineEvent.IntegrityReviewStarted`
  at session creation; a 20s ticker emits `IntegrityReviewProgress`.
- LLM stream hook forwards reasoning deltas as `IntegrityReviewChunk` (~2Hz,
  reasoning-only, tool-input JSON intentionally NOT forwarded).
- `emitIntegrityEvent()` → `IntegrityReviewCompleted` with the structured
  verdict (dimensions/issues/corrections/missingGoals).

SCHEMAS: `packages/opencorvus/src/engine/model.ts` lines ~1325–1482
(`IntegrityReviewStarted/Progress/Chunk/Completed`; streaming tiers = 3,
completed = tier 1).

TRANSPORT: `EngineProtocol.emit` → `protocol_event` → SSE
(`server/routes/orchestrator.ts` `protocolTaskEvent`, type prefix
`engine.integrity.review.*` → `integrity.review.*`).

RECEIVE (`packages/overlay/src/services/tree-writer.ts`):
`handleIntegrityStarted/Progress/Chunk/Completed`, `integrityCardID`,
`ensureIntegritySession`, `materializeRunningIntegrity`,
`materializeIntegrity`, buffered by `pendingIntegrity` / `runningIntegrity`.
Dedicated card id `integrity:session:<sid>` (NOT message-turn based; events
arrive via `integrity.review.*`, never `message.updated`).

RENDER: `IntegrityCard.tsx` `IntegrityBody`, mounted in `Card.tsx`
(`<Show when={node.integrity}>`), card kind `"integrity"`.

## Delivery — the gap

`packages/opencorvus/src/delivery/service.ts` `DeliveryService.verify`:
1. manifest hard gate — on fail: ZERO agent dispatch, emit
   `DeliveryGateRejected`, return early.
2. runtime evidence gate — same early-return shape.
3. visual hard gate — same.
4. host-gate composite — only `emitGateRejectedIfNeeded` here.
5. `DeliveryAgent.verify()` (`delivery/agent.ts`,
   `runAgentSessionWithRetry({ kind:"delivery", parentSessionID:
   orchestrator })`) — runs BLIND, no started/progress/chunk events.
6. post-repair re-validate; `composeDeliveryDecision`.

During-run events: only `DeliveryEvidenceUpdated` (once, when manifest gate
finishes). No started/progress/chunk family. Orchestrator `deliver` tool
(`orchestrator/tools.ts` ~4042 / ~4425) does a synchronous blocking
`await DeliveryService.verify(...)` and never learns a delivery sessionID,
so the overlay has nothing to render. In the observed task the host gate
failed first → the delivery agent session was never created at all → the
entire 21 min were silent host gates (shell `pnpm test/typecheck/dev` +
specialist review).

Constraint from `specs/delivery-fresh-eyes-decoupling-2026-05-18.md`: the
delivery agent runs blind (no host-gate conclusions in prompt); final
decision is the single business-consumable artifact (`delivery-agent-verdict`
label). Liveness/streaming was never addressed there — adding a streaming
card must NOT feed host-gate conclusions back into the agent prompt and must
NOT add a second business verdict source.

## Design fork (needs a decision)

- A. Parallel `delivery.review.*` event family mirroring `integrity.review.*`
  (new schemas + emitters + tree-writer handlers + DeliveryBody). Low risk,
  integrity untouched, but duplicates the live-review-card design pattern
  (rule 9) and arguably double-sources the "review live card" mechanism
  (rule 8).
- B. Fully abstract one shared `review.stream.*` family (phase discriminant
  integrity|delivery), migrate integrity onto it. Single source (rule 8/9)
  but touches the working integrity path (regression risk) and over-unifies
  genuinely different completed-verdict payloads (rule 5/6).
- C. Share only the *streaming half* (started/progress/chunk → a generic
  running "review session" card with a reasoning stream + a `phase` tag),
  keep the *completed verdict body* phase-specific (IntegrityBody vs a new
  DeliveryBody, because the verdict payloads are legitimately different
  domain artifacts, not duplication). Streaming/liveness is the truly
  repeated pattern; verdict bodies are not.

Also in scope: the host gates (manifest/runtime/visual/specialist) run
before/around the agent and are themselves silent for most of the 20 min —
the streaming card must cover the WHOLE `DeliveryService.verify` span
(phase: manifest → runtime → visual → specialist → agent), not just the LLM
agent, otherwise the host-gate-only rejection path (observed here) stays
invisible.

## Decision — C (codex read-only consult, 2026-05-19)

codex explicitly rejected A (copy integrity → rule-9 copy-paste) and B
(unify completed payloads → leaky, rule-5/6). Chosen: **C — share the
streaming half, keep completed bodies phase-specific.**

### Event contract (engine/model.ts)

Shared streaming family (replaces integrity's Started/Progress/Chunk —
DELETE the old three, rule 8 single source; keep IntegrityReviewCompleted):

- `review.stream.started` — `{ taskID, reviewID, phase: "integrity"|"delivery", sessionID? }` tier 3
- `review.stream.progress` — `{ taskID, reviewID, phase, currentStep: "manifest"|"runtime"|"visual"|"specialist"|"agent"|"post_repair", attempt, elapsedMs, summary? }` tier 3
- `review.stream.chunk` — `{ taskID, reviewID, phase, kind: "reasoning", delta, attempt }` tier 3
- `delivery.review.completed` — derived ONLY from `decision.final` (NOT a
  second business verdict; all business readers stay on the
  `delivery-agent-verdict` artifact) — `{ taskID, runID?, reviewID, verdict: "accepted"|"rejected", source: "llm"|"host_gate", summary, hostGatePassed, failureKinds[], rejectionCount, deferredCount, details }` tier 1
- KEEP `integrity.review.completed` (→ IntegrityBody) and
  `delivery.gate.rejected` / `delivery.evidence.updated` (pass-through,
  MUST NOT create cards).

Identity: delivery `reviewID = delivery:${taskID}:${iteration}`, overlay
card `review:delivery:${taskID}:${iteration}` (top-level — host gates run
before any delivery agent session exists). Integrity
`reviewID = integrity:${sessionID}`, card stays `integrity:session:<sid>`.

### Emitter placement (delivery/service.ts DeliveryService.verify)

`started` right after validating `input.task.id`, before
`resolveReferenceAttachmentPath`/`buildDeliveryEvidenceManifest`. `progress`
at each real await boundary: `manifest` (before build; pass a narrow
observer into `buildDeliveryEvidenceManifest` so it emits `manifest`→
`runtime`(runRuntimeFlows)→`specialist`(per reviewer)), then `runtime`
(before computeRuntimeEvidence), `visual` (before runVisualHardGate),
`agent` (before DeliveryAgent.verify), `post_repair` (before post-repair
manifest rebuild). On `!hostGatePassedPreAgent`: emit a host-gate summary
progress then `delivery.review.completed` from `decision.final`. Emit
`delivery.review.completed` before EVERY successful return. On thrown
`DeliveryFailureError`: emit a non-verdict stream-failure / mark card error
via existing error path — do NOT fabricate a rejected verdict. Do NOT pass
any host-gate/manifest/runtime/visual conclusion into `DeliveryAgent.verify`
(fresh-eyes invariant, specs/delivery-fresh-eyes-decoupling-2026-05-18.md).
The delivery agent chunk stream feeds `review.stream.chunk phase:"delivery"`
via the runAgentSessionWithRetry stream hook (reasoning-only, ~2Hz).

### tree-writer.ts contract

Explicit handlers before the prefix pass-through:
`review.stream.started/progress/chunk` + `delivery.review.completed`. Shared
running-review materializer: `phase:"integrity"` delegates to existing
integrity session-card creation (`integrity:session:<sid>`);
`phase:"delivery"` creates/upserts a top-level `kind:"review"` card.
`review.stream.chunk` appends `kind:"reasoning"` deltas to stable part id
`review:<reviewID>:reasoning:<attempt>`. `delivery.review.completed` writes
`deliveryReview` payload + status (accepted→completed, rejected→error);
late chunks after completed ignored. `delivery.gate.rejected` /
`delivery.evidence.updated` stay pass-through (no card). Migrate
`handleIntegrityStarted/Progress/Chunk` onto the shared handlers and DELETE
the old integrity lifecycle handlers/schemas (rule 8) —
`handleIntegrityCompleted` + `materializeIntegrity` + IntegrityBody stay.

### Render (card-tree.ts / Card.tsx / new DeliveryReviewCard.tsx)

`CardNode` += `reviewStream?: { phase, currentStep?, elapsedMs?, summary? }`
and `deliveryReview?: { verdict, source, summary, hostGatePassed,
failureKinds, rejectionCount, deferredCount, details }`. `Card.tsx`:
IntegrityBody when `node.integrity`, DeliveryReviewBody when
`node.deliveryReview`, CardParts for reasoning/progress as today. i18n keys
(both en-US & zh-CN): `chat.role.delivery_review`,
`review.stream.step.{manifest,runtime,visual,specialist,agent,post_repair}`,
`delivery.review.{title,source.llm,source.host_gate,verdict.accepted,
verdict.rejected,rejections_heading,no_rejections,host_gate_failed,
host_gate_passed}`.

### Tests (rule 28/36) — backend / overlay / e2e

Backend: schema test for all new events; verify() emits `started` before
manifest; manifest-fail emits started/progress/completed & does NOT call
DeliveryAgent.verify; runtime/visual host-gate rejection emits progress
through the failing phase + completes card data; agent path emits `agent`
then completed; accepted-agent + post-repair-failed manifest emits
`post_repair` + final completed rejected from host gate; prompt-blind tests
stay (no host-gate data in DeliveryAgent.verify input); `delivery.gate.
rejected` notification stays but assert it is NOT the card source.
Overlay: tree-writer creates top-level running delivery review card from
`started`; repeated progress mutates same card id; host-gate-only completed
→ error + DeliveryReviewBody; gate.rejected/evidence.updated still no card;
integrity migration — started/progress/chunk still build
`integrity:session:<sid>`, completed still IntegrityBody; late chunk
ignored; i18n discipline covers new keys both locales; unknown review event
name throws (not silent pass). E2E: replay fixture delivery host-gate
rejection shows live card before final rejection; integrity replay stays
green; overlay smoke screenshot running + completed-rejected readable.

### Rule traps (codex §4)

A-copy / B-unify forbidden (above). Instrument the WHOLE
DeliveryService.verify, not just DeliveryAgent.verify (misses observed
host-gate-only path). `delivery.review.completed` derives only from
`decision.final`, overlay-render-only, business readers stay on
`delivery-agent-verdict`. No old/new compat listeners — migrate & delete.
No coded flow state machine — emit at real await boundaries; `currentStep`
is display data only.

### Deployment note

Running opencorvus is a packaged binary (memory
reference_opencorvus_deployment_model) — after source change must repackage
+ restart the server process before the user sees the card.
