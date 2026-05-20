IMPLEMENT (not review). cwd = repo root C:\Users\chuan\myhexin-local\opecorvus
(this IS the git repo root — there is NO nested .git, do NOT --cd into a
subpackage, stage files by path from here).

AUTHORITATIVE SPEC: read specs/delivery-live-review-card-2026-05-19.md in
FULL and implement the "Decision — C" section verbatim. Also read
specs/delivery-fresh-eyes-decoupling-2026-05-18.md for the fresh-eyes
invariant you must not break.

GOAL: the delivery verification phase currently emits ZERO during-run events
for ~20 min (host gates manifest/runtime/visual/specialist + the delivery
agent), so the overlay conversation shows no deliver card at all — unlike
integrity which streams a live card. Implement design C: a shared
`review.stream.{started,progress,chunk}` streaming family + a new
`delivery.review.completed`, migrate integrity's lifecycle events onto the
shared family (DELETE the old ones — rule 8 single source, no compat dual
path), add tree-writer handlers + a top-level delivery review card + a
DeliveryReviewBody render component, i18n keys both locales, and the full
test suite.

HARD RULES (CLAUDE.md — non-negotiable):
- rule 8: single source. DELETE IntegrityReviewStarted/Progress/Chunk
  schemas + their emitters in integrity/agent.ts + handleIntegrityStarted/
  Progress/Chunk in tree-writer.ts. NO old/new compatibility listeners.
  Keep IntegrityReviewCompleted + handleIntegrityCompleted +
  materializeIntegrity + IntegrityBody (completed stays phase-specific).
- rule 9: do NOT copy-paste integrity handlers into delivery ones; the
  running-review materializer is ONE shared helper parametrized by phase.
- rule 13: NO state machine. `currentStep` is display-only data; emit
  progress at REAL await boundaries inside DeliveryService.verify, no flow
  enum driving control.
- rule 5/6: no over-engineering; minimal shared abstraction.
- `delivery.review.completed` MUST derive only from the `decision.final`
  object returned by composeDeliveryDecision and be consumed ONLY by the
  overlay render path. Do NOT make it a second business verdict source —
  every existing business reader stays on the `delivery-agent-verdict`
  artifact. Do NOT pass any host-gate / manifest / runtime / visual
  conclusion into DeliveryAgent.verify input (fresh-eyes invariant).
- rule 36/28: every change needs a test. Implement the FULL backend +
  overlay + e2e test list from the spec's Tests section.
- rule 33: commit at logical milestones with clear messages (do NOT push —
  the human reviews and pushes). End commit messages with the
  Co-Authored-By trailer:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

SCOPE / FILES (rule 35 — these are the enumerated touch points; grep for
more call sites before editing and list any you find):
- packages/opencorvus/src/engine/model.ts — add review.stream.* +
  delivery.review.completed; delete IntegrityReviewStarted/Progress/Chunk.
- packages/opencorvus/src/integrity/agent.ts — migrate emitIntegrityLifecycle
  + the started/progress ticker + the chunk forwarder to review.stream.*
  with phase:"integrity", reviewID=`integrity:${sessionID}`.
- packages/opencorvus/src/delivery/service.ts — emit started/progress at
  every real await boundary (manifest→runtime→visual→specialist→agent→
  post_repair) + delivery.review.completed before every return + on the
  !hostGatePassedPreAgent early-return path; thread a narrow progress
  observer into buildDeliveryEvidenceManifest (and its checks/runtime/
  specialist internals) for long internal spans.
- packages/opencorvus/src/delivery/checks/project-gate.ts (+ runtime/
  specialist internals) — accept + call the optional progress observer.
- packages/opencorvus/src/delivery/agent.ts — forward LLM reasoning deltas
  as review.stream.chunk phase:"delivery" via the runAgentSessionWithRetry
  stream hook (reasoning-only, ~2Hz throttle, mirror integrity's old
  forwarder behavior).
- packages/overlay/src/services/tree-writer.ts — review.stream.started/
  progress/chunk + delivery.review.completed handlers; shared running-review
  materializer (integrity delegates to existing integrity card path,
  delivery → top-level kind:"review" card id
  `review:delivery:${taskID}:${iteration}`); keep gate.rejected/
  evidence.updated as no-card pass-through; delete old integrity lifecycle
  handlers.
- packages/overlay/src/store/card-tree.ts — CardNode += reviewStream? +
  deliveryReview?.
- packages/overlay/src/components/DeliveryReviewCard.tsx — NEW
  DeliveryReviewBody.
- packages/overlay/src/components/Card.tsx — mount DeliveryReviewBody when
  node.deliveryReview (keep IntegrityBody when node.integrity).
- packages/overlay/src/i18n/en-US.json + zh-CN.json — all new keys (spec
  lists them); keep i18n discipline test green.
- Any event-policy / tier registry / contract test that enumerates event
  names — update so the new names are known and old integrity lifecycle
  names are removed (unknown review event name must THROW, not silently
  pass).

EXECUTION ORDER: (1) schemas, (2) delivery emitters + observer threading,
(3) integrity migration, (4) tree-writer, (5) card-tree + render + i18n,
(6) tests. typecheck each package as you go
(`bun run --filter @opencorvus/opencorvus typecheck` and the overlay
typecheck; if `tsc` missing run `bun install` at repo root first). Commit
per milestone. Do NOT push. When done, print: files changed, commits made,
test commands you ran + their PASS/FAIL output, and any spec deviation with
rationale (if you deviate, append a "codex 实施反馈" note to
specs/delivery-live-review-card-2026-05-19.md, do not silently rewrite).
Work autonomously to completion; do not stop to ask.
