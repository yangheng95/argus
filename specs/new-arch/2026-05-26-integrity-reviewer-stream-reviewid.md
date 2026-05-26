# Integrity Reviewer Independent Review Stream

Date: 2026-05-26
Status: in-progress
Owner: HengYang
Linked issue: User report — "event type review.stream.chunk 导致绘画/卡片渲染失败" (task `tsk_e6208f3810010tvBK9e6L7xZfc`).

## Root cause (verified by DB)

`packages/opencorvus/src/integrity/team-agent.ts:447-453` (`runReviewerSession`) wires
`createReviewReasoningForwarder` with `reviewID: input.activeReviewID` — the
**supervisor's** reviewID. All N reviewer child sessions therefore stream their
reasoning under one reviewID (`integrity:<supervisorSID>`) and one
`attempt`, and they never emit their own `review.stream.started`.

Independent agent + main agent both confirm in DB
(task `tsk_e6208f3810010tvBK9e6L7xZfc`):

- 1 020 `review.stream.chunk` events, 6 sources
  (`architect.integrity.supervisor` + 5 `architect.integrity.reviewer.*`),
  all carrying `reviewID = integrity:ses_19d5715eeffd6QDp5Z22HhEEB4` and
  `attempt = 1`.
- 1 `review.stream.started` (supervisor only). 0 `integrity.review.completed`.
- `packages/overlay/src/services/tree-writer.ts:1136` computes
  `partID = review:${reviewID}:reasoning:${attempt}` and `produce(parts => parts[idx].text += delta)`.
  Result: ~195 KB of 5 reviewers' reasoning text interleaved into a single
  SolidJS Store cell, 1 020 reactive writes — overlay card tree renders
  thrashes / appears to "hang".

Rule violated: **rule 8** (single source — multiple emitters collapsed onto one
reviewID slot) and **rule 13** (host relying on accidental partID collision instead
of an explicit per-reviewer review handle).

## Fix design (rule 35: enumerate call sites)

### A. emit side (root fix) — `packages/opencorvus/src/integrity/team-agent.ts`

Inside `runReviewerSession`:

1. Track a reviewer-local `reviewerReviewID: string | undefined`.
2. Install `onSessionCreated` that derives it via `reviewIDForIntegrity(session.id)`
   and emits `review.stream.started` (sessionID = reviewer's child session id,
   source = `architect.integrity.reviewer.${scope.reviewerID}`).
3. Switch the `createReviewReasoningForwarder` `reviewID` to `() => reviewerReviewID`.

### B. interface-level interception (rule 11) — same file

Drop the `activeReviewID` parameter from `runReviewerSession`. The supervisor
reviewID is now structurally unreachable to reviewer code paths, which
prevents future regressions of the same shape. Caller in
`reviewIntegrity()` updated accordingly.

### C. writer side — `packages/overlay/src/services/tree-writer.ts`

No changes required. Once each reviewer carries an independent
`integrity:<reviewerSID>` reviewID:

- `runningReviews` gets one entry per reviewer (each `started` registers its
  own sessionID).
- `reviewCardID` derives `integrity:session:<reviewerSID>` per reviewer →
  each reviewer's reasoning lands in **its own** card (the dedicated reviewer
  session card that overlay already creates from `session.status`).
- `partID = review:integrity:<reviewerSID>:reasoning:<attempt>` is unique
  per reviewer.
- The existing `arrived before started` throw at
  `tree-writer.ts:1126` will catch any future code path that emits chunks
  under an unstarted reviewID — that is the writer-side invariant for this
  class of bug.

## Call-site sweep (rule 35)

- `createReviewReasoningForwarder` callers — 3 in `team-agent.ts`
  (`reviewIntegrity` plan + `reviewIntegrity` consensus + `runReviewerSession`).
  Plan / consensus already use supervisor reviewID correctly; only the
  reviewer site is wrong.
- `emitReviewStreamStarted` callers — 1 (supervisor, `team-agent.ts:225`).
  Adds 1 (reviewer, `team-agent.ts:runReviewerSession`).
- `reviewIDForIntegrity` callers — 1 src + 2 tests. Adds 1 (reviewer).
- `emitReviewStreamProgress` — supervisor heartbeat only. Reviewers
  do not need progress events; the supervisor's per-20s heartbeat already
  describes coordination state, and reviewer running state is conveyed by
  the dedicated reviewer session card + reasoning stream.

## Tests (rule 36)

- Extend `packages/opencorvus/test/integrity/team-agent.test.ts`:
  - Mock `emitReviewStreamStarted` to record calls; assert exactly one
    started per session (supervisor + each reviewer), with **distinct**
    reviewIDs.
  - Assert each forwarder's `reviewID()` returns the reviewer-specific
    reviewID (not the supervisor's).
- Add `packages/overlay/test/tree-writer-multi-reviewer-stream.test.ts`:
  - Drive started + chunk for supervisor + 2 reviewers (each with its own
    reviewID + sessionID); assert 3 distinct cards each accumulate their
    own reasoning part, with no cross-contamination.

## Out of scope

- Re-emitting historical chunks is impossible; this fix prevents recurrence.
  Live tasks pre-fix still carry the conflated stream.
- Reviewer progress heartbeats — not added; can be revisited if reviewer
  card durations need an in-card ticker.
