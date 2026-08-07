# 2026-07-05 Overlay Build Card SSE Teardown Verification

## Recall

User-visible problem chain in this thread:

- `goal` parsing/progress no longer projected in overlay.
- Routing to the frontend-replica expert squad did not immediately refresh
  dropdown/state surfaces.
- Selected-task SSE became abnormal and surfaced
  `goal phase ... missing backend board projection`.
- After agent rail execution reached `build`, the rail row disappeared, the
  build message card was not visible, and status became uninspectable.
- Latest user request: investigate and fix all remaining issues, then use
  independent agents to review the result.

Current objective:

- Stop selected-task SSE cleanly during overlay teardown so no hidden reconnect
  path survives after the UI/browser fixture is gone.
- Preserve the canonical build target across live SSE, full conversation
  clear-and-hydrate, and lazy history/session replay so `build` cards remain
  locatable.
- Restore the overlay Vite build chain used by browser verification.
- Keep durable validation evidence: unit tests, browser tests, screenshots, and
  read-only independent-agent review.

Acceptance criteria:

- `teardownApp()` closes selected-task SSE and does not schedule the `3000 ms`
  reconnect retry.
- Stopping SSE never throws just because the current board task lacks a
  positive `time.started`.
- Hydrate/history paths keep the canonical build `targetMessageID` even when
  the rendered card is temporarily absent, so history loading can fetch the
  missing build transcript.
- `bun run build:vite` succeeds for overlay.
- Real browser tests keep the rail visible and the build card inspectable after
  hydrate/live/reload/history interactions.
- Independent read-only agents either confirm the result or surface concrete
  remaining findings.

Hard constraints:

- No fallback or compatibility logic.
- No git reset/revert/worktree creation.
- Do not restart, kill, or refresh the user’s running overlay/OpenCorvus
  processes.
- Keep requirements, acceptance criteria, grep evidence, validation commands,
  artifact paths, and independent-agent conclusions on disk so context
  compaction cannot shrink scope.

Sources read before implementation/verification:

- `AGENTS.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-agent-rail-build-hydrate-live-retention.md`
- `specs/records/2026-07/2026-07-04-architecture-issue-subagent-investigation.md`
- `packages/overlay/src/services/init.ts`
- `packages/overlay/src/services/sse.ts`
- `packages/overlay/src/store/conversation-agents.ts`
- `packages/overlay/src/services/conversation.ts`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/vite.config.ts`
- `packages/overlay/test/sse-reconnect.test.ts`
- `packages/overlay/test/conversation-agent-rail-records.test.ts`
- `packages/overlay/test/conversation-hydrate-replay.test.ts`
- `packages/overlay/test/selected-task-recovery.test.ts`
- `packages/overlay/test/browser/agent-compact-visual-stress.test.ts`
- `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`

Whole-repository search evidence:

- `rg -n "teardownApp|stopSSE|selectedTaskRuntimeKey|startSSE\\(|stopTaskListSSE|selectedTaskRuntimeActivityKey|selectedTaskStream" packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "sessionDisplayMessageID|clearRecordRenderedProjection|recordWithCurrentProjectionPreservingCanonicalTarget|mergeHydratedRecordWithCurrentRecord|clearConversationAgentRenderedTargets|targetMessageID|renderedCardID" packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "build|agent rail|goal phase|workflow status|session.status|missing backend board projection|compact visual stress|rail scroll" packages/overlay/test/browser -g "*.ts"`

Independent agent feedback:

- First-round independent explorers surfaced four real defects, not just test
  gaps:
  - full clear-and-hydrate cleared canonical build targets, and phase-history
    sessions could keep a step card without any `targetMessageID`;
  - stale connection-monitor / SSE reconnect paths could reopen after teardown;
  - hydrate could overwrite a newer canonical build target with an older live
    target when the live lifecycle timestamp was newer;
  - browser evidence only proved chat-pane text persistence, not rail-row
    retention or locate-target correctness after live merge/reload.
- Their concrete findings and the corresponding fixes are recorded in
  `## Diagnosis`, `## Implementation`, and `## Independent Review`.

## Diagnosis

Confirmed root-cause chain:

1. The original visible symptom was late SSE/log noise and disappearing build
   rail state after teardown, hydrate, or reload. The first-layer fix stopped
   obvious teardown crashes, but independent review showed two deeper stale
   lifecycle paths still existed.
2. `teardownApp()` originally stopped timers and handles, but neither the
   connection monitor nor the selected-task SSE reconnect path had a generation
   guard. An already-running monitor tick or `performSseReconnect(...)` could
   outlive teardown and reopen state later.
3. On the conversation side, the real bug was not “missing rendered card” but
   “canonical target identity being treated as disposable projection state”.
   Full clear-and-hydrate could strip `targetMessageID`, phase-history hydrate
   could keep only a projected step card, and merge logic could let a later
   lifecycle timestamp force an older live target over a newer hydrated one.
4. Browser validation originally proved only that the build transcript text
   remained in the chat pane. It did not prove that the rail row survived, that
   the locate button still pointed at the same canonical target after live
   merge, or that reload preserved that target.
5. Overlay browser verification also depended on a healthy production build.
   Vite’s esbuild path was not configured for automatic Solid JSX transform, so
   real browser evidence could fail before the UI chain ran.

Why this is the correct fix path:

- The reconnect problem is a real product path, not a test-only shim: unload
  and workspace teardown share the same selected-task SSE and connection
  monitor lifecycle.
- The rail/history problem is a canonical-target ownership issue, not a CSS
  visibility issue. The UI can only lazy-load or relocate a build transcript if
  the rail row retains the true session/message identity even when projection is
  temporarily absent.
- Browser screenshots had to prove rail behavior directly, because the user
  reported that the build row disappeared and could not be inspected from the
  rail.
- The build-chain failure had to be fixed locally because browser evidence is a
  required acceptance surface for this overlay work.

## Implementation

### 1. Stop selected-task SSE during app teardown and invalidate stale lifecycles

- `packages/overlay/src/services/init.ts`
  now:
  - imports `stopSSE` and calls it inside `teardownApp()` before
    `stopTaskListSSE()`;
  - tracks `initLifecycleGeneration` so stale `initApp()` / reconnect work
    cannot continue after teardown or supersession;
  - checks the lifecycle generation after each awaited init/reconnect step
    before mutating stores or reopening SSE.
- `packages/overlay/src/services/connection.ts`
  now tracks `_monitorGeneration`, passes `isCurrent()` into
  `makeMonitorTick(...)`, and suppresses stale `check()` / `onReconnect`
  continuations after monitor stop or replacement.
- `packages/overlay/src/services/monitor-tick.ts`
  now accepts optional `isCurrent()` and checks it before the probe, after the
  probe, and before `onReconnect`.

### 2. Invalidate stale selected-task SSE reconnect paths

- `packages/overlay/src/services/sse.ts`
  now:
  - tracks `selectedTaskStreamGeneration`;
  - passes `isCurrent()` into `performSseReconnect(...)`;
  - aborts reconnect before restart and before retry scheduling when the stream
    has been stopped or superseded;
  - ignores late `onClose` work from stale handles.
- The same file also changed `selectedTaskRuntimeKey(taskID)` so it returns `""`
  when the current board task does not match or lacks a positive
  `time.started`, instead of throwing during teardown/close paths.
- This keeps `taskRuntimeActivityKey(...)` strict while removing teardown-time
  crashes from partial board fixtures.

### 3. Preserve canonical build targets through clear/hydrate/history transitions

- `packages/overlay/src/store/conversation-agents.ts`
  now:
  - derives session display identity through `sessionDisplayMessageID(...)`,
    preferring `lastDisplayMessageID` and otherwise falling back to the tail of
    `messageIDs`;
  - stores canonical `targetMessageID` even when no rendered card is currently
    projected;
  - records `targetObservedAt` so canonical target freshness is compared using
    target observation time instead of unrelated lifecycle timestamps;
  - distinguishes clearing rendered projection from clearing canonical target,
    so full hydrate can drop stale card IDs without destroying build-session
    identity;
  - preserves canonical targets across clear/hydrate via
    `recordWithCurrentProjectionPreservingCanonicalTarget(...)`;
  - keeps the newer hydrated canonical target when it is newer than the current
    live target, even if the live lifecycle status observed later;
  - lets phase-history / lifecycle-only records keep canonical message identity
    while projection is temporarily absent.

### 4. Cover the regressions with tests

- `packages/overlay/test/monitor-tick.test.ts`
  adds coverage proving a stopped monitor tick that resolves later does not fire
  `onReconnect`.
- `packages/overlay/test/sse-reconnect.test.ts`
  adds coverage proving:
  - selected-task SSE closes during teardown without scheduling the `3000 ms`
    reconnect retry;
  - invalidated reconnect work cannot reopen a stale stream before restart;
  - invalidated reconnect work cannot schedule a stale retry after restart
    failure.
- `packages/overlay/test/conversation-hydrate-replay.test.ts`
  adds/extends cases for:
  - preserving a live build target across full clear-and-hydrate;
  - continuing goal-phase history paging when the phase card exists but the
    build message is not yet loaded;
  - hydrating build transcript directly by session ID.
- `packages/overlay/test/conversation-agent-rail-records.test.ts`
  now covers:
  - top-level hydrated execution records keeping canonical `targetMessageID`
    even when `renderedCardID` is absent;
  - live goal-phase lifecycle-only records staying unprojected instead of
    throwing when they are not the active owner;
  - hydrate preferring a newer hydrated canonical build target over an older
    live target whose lifecycle timestamp is newer.
- `packages/overlay/test/selected-task-recovery.test.ts`
  resets `boardSyncPending` to remove cross-file state leakage during combined
  runs.

### 5. Prove rail-target retention in real browser evidence

- `packages/overlay/test/browser/agent-compact-visual-stress.test.ts`
  now:
  - locates a specific rail row by `sessionID`;
  - asserts the rail row’s `data-target-message-id`;
  - clicks the locate button and waits for the pulsed card target;
  - asserts the located card still contains both the compact summary and resume
    markers after live merge and after reload;
  - records `railStates` plus two new rail screenshots:
    - `02-live-timing-rail.png`
    - `05-reload-resume-rail.png`

### 6. Restore the overlay browser-verification build chain

- `packages/overlay/vite.config.ts`
  now sets:
  - `esbuild.jsx = "automatic"`
  - `esbuild.jsxImportSource = "solid-js"`

## Validation

### Commands

- `bun test packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/events-refresh.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts`
  - Result: `191 pass / 0 fail`.
- `bun run build:vite`
  - Result: exit `0`; Vite emitted only existing chunk-size/dynamic-import
    warnings and produced `dist-vite`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-compact-visual-stress.test.ts packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
  - Result: `2 pass / 0 fail`.

### Browser artifacts reviewed

- `packages/overlay/.scratch/agent-compact-visual-stress/report.json`
  records the live compact/reload request log, stream log, screenshot paths,
  extracted snapshot text, and `railStates` for the `build` cards.
- Reviewed screenshots:
  - `packages/overlay/.scratch/agent-compact-visual-stress/02-live-timing.png`
  - `packages/overlay/.scratch/agent-compact-visual-stress/02-live-timing-rail.png`
  - `packages/overlay/.scratch/agent-compact-visual-stress/05-reload-resume.png`
  - `packages/overlay/.scratch/agent-compact-visual-stress/05-reload-resume-rail.png`
  - `.scratch/conversation-agent-rail-scroll-browser/chat-pane-after-locate.png`
  - `.scratch/conversation-agent-rail-scroll-browser/absorbed-card-after-locate.png`
  - `.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`
- Visual conclusion:
  - the `Build` rail remains visible;
  - the live compact rail row keeps `targetMessageID =
    "msg_live_resume_after_compact"` during the live phase and after reload;
  - the build card is present after reload/resume;
  - the absorbed build card remains locatable through the rail/history path;
  - horizontal rail interaction still works after the primitive button
    migration.

## Independent Review

Independent read-only review happened in two rounds:

1. First-round explorers surfaced the real remaining defects:
   - full clear-and-hydrate and phase-history could strip canonical build
     targets or keep only projected step cards with no `targetMessageID`;
   - stale connection-monitor / SSE reconnect work could reopen after teardown;
   - hydrate could let an older live target beat a newer hydrated canonical
     target;
   - browser evidence did not prove rail-row survival or locate-target
     correctness after live merge/reload.
2. This implementation directly addressed each finding with code, tests, and
   browser evidence:
   - canonical target preservation now separates rendered projection from
     message identity and compares target freshness via `targetObservedAt`;
   - teardown now invalidates init, monitor, and selected-task stream
     generations so stale reconnect work cannot continue;
   - browser evidence now includes rail-target assertions, rail screenshots, and
     persisted `railStates`.
3. A fresh post-fix explorer (`Epicurus`) reported `无发现` on the final
   working tree. Its cited reasons were:
   - `conversation-agents.ts` now keeps source-scoped pending-target merge
     protection and re-applies canonical targets during hydrate/store merge;
   - `sse.ts` now guards reconnect with `streamGeneration`, `isCurrent()`, and
     active-task checks;
   - `agent-compact-visual-stress.test.ts` plus `report.json` now prove the
     rail row keeps the same `targetMessageID` and `renderedCardID` after
     reload, with no reported browser errors.

Residual risk:

- I did not restart or interfere with the user’s currently running overlay, so
  acceptance relies on targeted unit tests, production build success, and real
  Playwright fixture screenshots rather than a destructive manual restart of the
  user session.
- The fresh explorer still suggested one extra hardening case that is not yet
  covered explicitly: simulate a long SSE disconnect followed by close/reopen
  and assert that the rail target still does not drift when the replay window
  changes.
