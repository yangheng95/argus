# Continuous Independent GUI Quality Audit — 2026-07-26

## Status

Rounds 1–7 have completed independent runtime, GUI, and single-source audits.
Every clean-ownership finding through Round 7 has a root repair and regression
evidence. Lease-loss continuity and overlapping parallel changes remain open
findings; they are recorded below and must not be overwritten or described as
accepted. Round 7 found new defects, so convergence still requires a fresh
three-agent round with zero new evidence-backed findings.

## Recall

### User request

- Lead independent agents as GUI testing peers.
- Repeatedly scan for real bugs and latent quality risks across algorithm
  stability, UI/UX, single-source ownership, UI behavior, and missing product
  capability.
- Repair verified defects, retest, and start another independent audit round
  until one complete round finds no new evidence-backed defect.

### Acceptance criteria

- Every repaired behavior has a regression test.
- UI repairs run through an isolated real Vite page, Node-launched Playwright,
  screenshot capture, and visual inspection.
- Runtime defects are proven through the real persistence/dispatch boundary,
  not a status label or mocked success-only contract.
- A final independent audit round returns no new evidence-backed issue in the
  selected runtime, UI, and single-source scopes.
- Task-owned changes are committed with a `dsw-33987` subject and pushed to the
  `myhexin` git-cc remote without bypassing hooks.

### Hard constraints

- Preserve every staged, unstaged, untracked, and concurrently committed
  change. Do not stash, reset, restore, delete, or broadly stage the worktree.
- Do not start, stop, refresh, reload, or otherwise interfere with the user's
  running OpenCorvus or Overlay process. Browser verification uses a new
  isolated Vite process.
- Playwright must be launched with Node.
- Do not add a fallback, compatibility reader, second store, flow gate, state
  machine, synthetic message, or cross-task preview target.
- Browser Preview target/evidence remains task-scoped and authoritative.
- The desktop Overlay keeps one visible titlebar.
- The untracked `packages/overlay/test/store-test-hooks.test.ts` and the current
  Artifact Catalog / Integrity / Visual QA diffs are protected parallel work.

### Materials read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-24-runtime-memory-and-process-retention-convergence.md`
- `specs/records/2026-07/2026-07-25-settings-system-visual-functional-audit.md`
- `specs/records/2026-07/2026-07-25-openmirror-report-unclosed-ui-repair.md`
- current scheduler cron service, Browser Preview, Right Dock, Overlay global
  bridges, tool-result control, Integrity, Visual QA, and their focused tests
- current Git status, branch history, diff inventory, and package scripts

### Whole-repository grep

| Contract | Call-point result | Round 1 decision |
| --- | --- | --- |
| `consumePendingTaskWaits` | Scheduler runtime composition, `engine/queue.ts`, cron early-activity path, dependency tests, cron tests | Preserve it as the post-accepted-dispatch cancellation owner. Remove its use as a pre-dispatch destructive step in early activity. |
| `triggerTaskWaitFromActivity` | Cron message-created and terminal-tool-result subscriptions plus focused cron tests | Move early activity onto the existing lease/execute/commit ownership protocol. |
| `dispatchTaskLoop` | Task API, Engine Queue, Orchestrator tools/build, cron service, server and scheduler tests | Change only cron ownership ordering; do not change the global dispatch contract. |
| `lease_owner` / `lease_until` | Cron schema/service/tests | Keep `cron_job` as the single durable owner. Renewal must prove continued ownership; successful side effects commit only for the owner. |
| Browser Preview zoom listeners | `BrowserPreviewPanel.tsx`, global `handleZoomHotkey` in `main.tsx`, native zoom service/tests | Browser zoom only owns shortcuts originating inside its focused host chrome; global Overlay zoom remains the default owner elsewhere. |
| Browser Preview address draft | One local signal pair in `BrowserPreviewPanel.tsx`; task scope and native target effects in the same component | Clear draft/dirty/native page state when the exact task-directory scope changes. Do not change backend target ownership. |
| Right Dock reflow | One `RightDock.tsx` owner, one workspace CSS recipe, focused unit/browser suites | Make the required active shell shrink to the actual strip budget while preserving its close control and overflow menu. |
| Overlay mutable global stores | Unconditional `installGlobalBridges` plus the canonical DEV-only `__OC_DEV__` bridge; browser tests directly mutate `settingsStore` | Verified second write surface, but implementation is deferred because an untracked parallel test explicitly owns this contract. |
| `ArtifactReadLocator` through Visual QA / Integrity | Orchestrator tools/stages, Integrity fact projection, Task Artifact catalog, tests | Visual QA was repaired concurrently. Integrity still drops non-Engine locators, but all responsible files have parallel diffs; record, do not overwrite. |
| tool-result park metadata | Legacy parser plus six old writers and one canonical control writer | Verified dual protocol. Complete cutover is deferred because `orchestrator/tools.ts` has a large parallel diff. |

### Independent-agent feedback

- Runtime auditor: early task activity deletes one-shot waits before dispatch,
  so a rejected dispatch permanently loses the wake and its retry/error
  evidence. The same service can continue a wake after losing its lease because
  renew failures and zero-row renewals are only logged.
- GUI auditor: Browser Preview zoom listeners respond globally instead of from
  focused panel ownership; address drafts survive task changes and can navigate
  the next task's lease; a long active Right Dock tab can place its close
  control outside the visible strip at the legal minimum width.
- Architecture auditor: Integrity silently drops Task Artifact snapshot/resource
  locators; tool-result parking has old and new metadata protocols; production
  Overlay exposes mutable test stores/actions. The first two overlap current
  Orchestrator/Integrity diffs and the third overlaps an untracked test.
- Native WebView tab focus is only a source-level candidate. It is excluded
  until a real macOS accessibility/focus run proves the defect.

## Round 1 causal findings

### R1-A — cron wake side effects can outlive or precede durable ownership

Observable failure: early activity may remove the scheduled wake and then fail
to dispatch; a stalled old owner may also wake after another process has taken
the expired lease.

Direct triggers:

1. `consumePendingTaskWaits()` performs `DELETE` before
   `dispatchTaskLoop()`.
2. lease renewal does not verify an affected owner row, and renewal failure does
   not invalidate the local execution owner.

Root cause: normal due execution follows claim, execute, success commit / failure
backoff, but early activity bypasses that protocol and lease continuity is not
an executable invariant of the owner handle.

Repair boundary: one `cron_job` record and one lease identity remain the sole
source. Early activity claims the existing waits, dispatches once, deletes only
after success, and records failure/backoff on rejection. Lease renewal returns
an ownership result; a lost owner must not begin a new external wake.

### R1-B — Browser Preview presentation state is active-tab scoped, not focus/task scoped

Observable failures:

1. a Preview-active window consumes zoom shortcuts even when focus is in Chat;
2. Task A's unsubmitted address remains visible in Task B and can navigate B;
3. the required active tab can exceed the visible strip budget at 280 px Dock
   width.

Root cause: panel visibility was treated as shortcut focus, local edit state was
not reset with the task identity, and reflow treats required visibility as
unbounded width.

Repair boundary: use the existing panel DOM as the shortcut focus boundary,
reset presentation-only state on `taskID:directory` changes, and constrain the
required tab shell to the measured strip budget. Backend preview targets,
evidence, native lease identity, and Right Dock catalog remain unchanged.

## Implementation and validation plan

1. Add failing cron tests for rejected early dispatch, retry/error persistence,
   and lost-lease renewal.
2. Repair cron early activity through the existing lease/execute/fail contract;
   add stable ownership checks without a second scheduler path.
3. Add focused Browser Preview tests for focus-owned zoom and task-scope draft
   reset.
4. Add a real Vite/Node Playwright scenario covering focused Composer zoom,
   two-task draft switching, minimum-width long tab hit-testing, and screenshots.
5. Repair Browser Preview and Right Dock through their canonical owners.
6. Run focused tests, Overlay/OpenCorvus typecheck, Vite build, i18n, document
   health, and a secondary diff review.
7. Commit only task-owned files and push through normal git-cc hooks.
8. Start a fresh independent runtime/UI/single-source audit round. Repeat until
   a complete round reports no new evidence-backed defect.

## Parallel blockers

- Integrity locator preservation requires editing current parallel changes in
  `orchestrator/tools.ts`, `orchestrator/integrity-review-stage.ts`, and
  `integrity/fact-projection.ts`.
- Tool-result control cutover requires editing the same parallel
  `orchestrator/tools.ts`.
- Production mutable-store bridge removal conflicts with the untracked
  `packages/overlay/test/store-test-hooks.test.ts`, which currently asserts the
  opposite contract.

These remain real findings. They are not accepted variances and cannot be
silently declared fixed.

## Round 1 implementation evidence

- Early task activity claims the existing one-shot wait, records backoff after
  a rejected dispatch, deletes only after an accepted dispatch, and permits one
  concurrent owner.
- Browser Preview zoom shortcuts are owned by the panel containing the event
  target. Task-scope changes clear the address draft, dirty flag, and prior
  native page presentation.
- Right Dock requires only the active tab during reflow and constrains its shell
  to the available strip width, keeping the close control visible.
- `bun test test/scheduler/cron-service.test.ts`: 25 pass, 0 fail.
- `bun test test/browser-preview-panel.test.ts
  test/right-dock-panel-ownership.test.ts`: 4 pass, 0 fail.
- `node test/browser-runner.mjs
  test/browser/browser-preview-live-input-batch.test.ts`: 1 pass, 0 fail with
  current screenshots.
- The larger titlebar / Right Dock browser fixture generated current
  `right-dock-light-active-tab-layer.png` and
  `right-dock-requirements-tab-only-title.png`; visual inspection confirmed
  visible title, close, add, and Dock-close controls. Its later event-stream
  stage timed out after parallel event-service changes, so the full fixture is
  not claimed as passing.

The renewal path still does not prove that a long-running owner retained its
lease before another process can start the same external wake. This is carried
into the next repair batch and prevents declaring Round 1 fully converged.

## Round 2 independent findings and progress

Three fresh read-only auditors independently covered runtime concurrency,
Overlay behavior, and single-source contracts. They did not delegate further.

### Repaired in the current batch

- LSP (Language Server Protocol) idle pruning captured the pre-shutdown client
  array and wrote it back after awaiting shutdown. A client pushed during that
  await was therefore lost. Pruning now removes only the exact disposed client
  identities from the current collection; the concurrent-push regression test
  passes.
- EventService used a running-job set as a drop gate. Two valid overlapping
  matches for a zero-cooldown job silently collapsed into one. Each job now has
  one serialized promise tail, while different jobs remain parallel. The
  queued execution re-reads enabled, one-shot, and cooldown facts before
  running. Overlap and one-shot regression tests pass.
- Settings search filtered only navigation, leaving a stale panel and keeping
  About outside the same projection. The dialog now derives navigation, title,
  and body from one filtered tab catalog, renders an explicit empty state,
  clears the query on close, and keeps focus inside the modal.
- Settings and File Explorer feedback used multiple local status surfaces
  without consistent live-region semantics. Settings feedback now converges on
  `SettingsState`; File Explorer errors expose alert/status roles with polite,
  atomic announcements. The retired `config-status-box` CSS owner is removed.
- Persisted file replay accepted canonical AttachmentStore refs, legacy inline
  data URLs, and arbitrary URLs. Persisted provider-bound files now have one
  byte source: the canonical AttachmentStore URL. Process-local tool-result
  media retains its separate live conversion boundary.
- The Orchestrator attachment inventory claimed every attachment was
  automatically forwarded, while current dispatch contracts require exact
  typed binding fields. Inventory rendering now states the real explicit
  contract and has a focused regression test.

### Validation evidence

- OpenCorvus LSP tests: 14 pass.
- OpenCorvus EventService tests: 8 pass.
- OpenCorvus message and attachment-inventory tests: 59 pass.
- OpenCorvus typecheck: pass.
- Overlay typecheck: pass.
- Settings layout composite contract: 44 pass.
- Config dialog Vite/Node browser test: pass. Current Network and no-result
  screenshots were visually inspected; the no-result copy is no longer
  duplicated and the filtered page remains aligned and scannable.
- General Settings failure-state Vite/Node browser test: pass.

### Unresolved or parallel-owned Round 2 findings

- Cron lease renewal still lacks a stable fire identity and executable
  continuity proof across a long-running external wake.
- Server shutdown awaits unbounded startup recovery before stopping the HTTP
  server. `cli/cmd/serve.ts` currently has parallel modifications.
- Artifact binary reads can ignore `max_bytes`; cursor rows can drift under
  mutation; Plugin Host retains two read ABI surfaces. Their responsible
  Artifact Catalog, engine, plugin, and tool files are active parallel work.
- The full File Explorer browser suite currently receives new
  `/mission-skill/catalog` requests not modeled by its fixture. This produces
  visible 404s and prevents claiming the ARIA-only browser suite as passing.
  The product and fixture changes are parallel-owned and must converge before
  the suite is rerun.
- The broad Overlay architecture suite also reports current unrelated
  conversation/messages/inspector CSS debt changes. No baseline was raised and
  no failing assertion was weakened.

Round 2 is therefore not terminal. After the current clean-ownership repairs
are committed and pushed, another independent audit must re-evaluate the
remaining runtime and parallel-owned surfaces.

## Round 3 independent findings and progress

The same three independent auditors received fresh bounded read-only scopes for
runtime ownership, Overlay task transitions, and single-source contracts. They
did not delegate further and were required to report only new evidence.

### Repaired in the current batch

- The selected Subagent Conversation session survived a task replacement.
  Requests could therefore combine the new task ID with a session ID owned by
  the previous task. The selection now converges against the current task's
  canonical progress records before any request is built; task lifecycle reset
  also clears it.
- File Changes presentation filters were component-local and survived task
  changes. When the next task had eight or fewer files, the search control
  disappeared while its old hidden query still filtered the list. The view now
  resets query, status, non-text visibility, and selection on its explicit task
  scope key.
- Work Ledger used the full task/chat selection lifecycle, while Command
  Palette and Mailbox wrote only the underlying service selection. All three
  entry points now call the same UI lifecycle functions, so preview, Dock,
  composer, task-directory, and task-scoped state reset together.
- A rejected first connection remained cached by the scoped MCP (Model Context
  Protocol) owner. Every later call for the same identity awaited the same
  rejected promise, even when valid configuration was supplied. The owner now
  evicts only the exact rejected candidate, preserving concurrent identity
  safety and allowing a real retry.
- Browser profile cleanup swallowed page/context close failures and deleted the
  profile owner anyway. A leaked context could therefore be reported as gone.
  Profile close now propagates failure and removes ownership only after context
  closure succeeds. Empty-profile event cleanup logs failures and leaves the
  owner available for a later retry.

### Validation evidence

- Overlay focused static contracts: 45 pass.
- Overlay typecheck: pass.
- Subagent Progress Dock Vite/Node Playwright test: pass. After replacing the
  task, the Dock closes and no request combines the replacement task with the
  retired session.
- File Changes task-scope Vite/Node Playwright test: pass. The current screenshot
  was cropped to the real component and visually inspected: Task B's replacement
  file is visible, status is `All`, the stale search is absent, selection is
  clear, and no false no-match state remains.
- Scoped MCP connection-owner test: 3 pass, including a failed local process
  followed by a successful same-identity retry.
- Browser MCP lifecycle test: 10 pass, including a forced context-close failure,
  retained profile ownership, profile reuse, and successful cleanup retry.
- OpenCorvus and Overlay typechecks: pass for task-owned changes.
- The broader runtime promise-boundary suite currently fails two source-string
  assertions in active parallel Orchestrator/Control changes. Neither assertion
  touches the browser lifecycle repair, so it is recorded rather than weakened.

### Unresolved or parallel-owned Round 3 findings

- Task Artifact publication sequence allocation uses a process-local lock; two
  OpenCorvus processes can allocate the same sequence. The current Artifact
  Catalog/store files are active parallel work.
- Artifact search validates the manifest but not the resource bytes against the
  recorded SHA (Secure Hash Algorithm) value, so tampered bytes can coexist
  with a `catalog_complete` claim. The responsible files are active parallel
  work.
- Cron lease renewal still lacks a stable fire identity and executable
  continuity proof across a long-running external wake.
- Server shutdown still awaits startup recovery before closing the HTTP
  (Hypertext Transfer Protocol) server; `cli/cmd/serve.ts` remains
  parallel-owned.
- The broad toolbar browser fixture retains its current unrelated 375 px versus
  400 px width failure. The focused task-scope fixture is the claimed visual
  evidence; the broad failure was not hidden or rebaselined.

Round 3 is not terminal because it found new defects and parallel-owned findings
remain. After committing the clean-ownership repairs, a fourth independent
audit must search for fresh evidence rather than repeat these findings.

## Round 4 independent findings and progress

Three independent read-only auditors again covered GUI behavior, runtime
ownership, and single-source contracts without delegation. All three found new
evidence, so this round is not the required zero-finding terminal round.

### Repaired in the current batch

- File Editor GET and PATCH completions had no directory/path ownership check.
  A delayed save for file A could mutate the current resource for file B.
  Load/save side effects now commit only while the exact target remains current.
- File Explorer query, expanded paths, and completed mutation feedback survived
  a directory replacement. Those presentation states now reset from the
  directory accessor as their single scope source.
- File Editor asynchronous failures now expose alert/live semantics. Visual
  review also found that a long API URL overflowed the error panel; the error
  paragraph now wraps within the panel.
- Failed page destruction left `intentionalSessionClose` set, causing the next
  real page close to be misclassified as intentional. Failed close now revokes
  the marker.
- Empty-profile, expiry, shutdown, manual destroy, and profile reuse did not
  share one serialization primitive. All profile closure paths now use the
  profile lock and re-check exact profile identity plus empty/expiry facts
  inside that ownership boundary.
- Browser shutdown swallowed browser-close failure and discarded its owner.
  It now retains the browser reference and propagates failure until a retry
  closes the real resource.
- Sidecar ownership used exclusive file creation but readers deleted partial
  JSON during the create/write publication window. The existing
  `proper-lockfile` dependency now owns atomic cross-process acquisition before
  diagnostic JSON is published; locked partial metadata is never pruned.
- Isolated acceptance workspaces swallowed cleanup failure after copy or command
  failure. Removal uses bounded native retries, and final failure preserves the
  operation error, cleanup error, and exact workspace root in an
  `AggregateError`.

### Validation evidence

- File Explorer/Editor static contract: 5 pass, 453 assertions.
- Focused Node-launched real Overlay browser test proves a held Task A PATCH
  completion cannot replace Task B's editor: pass. The inspected screenshot
  shows `NEXT.md`, `next project`, a clean disabled Save action, and no stale
  Task A content.
- Focused real browser load-failure test: pass with `role=alert` and assertive
  live semantics. The first screenshot exposed horizontal clipping; after the
  CSS repair the re-run screenshot shows centered, fully wrapped error text.
- Browser MCP lifecycle: 13 pass, including page-close rejection classification,
  unexpected-close/reuse serialization, profile cleanup retry, and browser
  shutdown retry.
- Sidecar lock suite: 14 pass, including partial metadata under a live ownership
  lock and a contending second acquisition.
- Isolated workspace cleanup ownership: 3 pass.
- The complete File Explorer browser file currently fails all 11 scenarios
  because the parallel Mission Skill catalog request is absent from its shared
  fixture and older selectors have drifted. Focused current tests provide the
  claimed evidence; the full-suite failure is not hidden or rebaselined.
- OpenCorvus typecheck is currently blocked by a parallel Artifact Catalog
  type mismatch in `artifact-catalog/index.ts`; task-owned MCP, lock, and
  workspace tests pass.

### Unresolved Round 4 findings

- The desktop parent watchdog still treats a PID (process identifier) as the
  complete parent identity. PID reuse can keep an orphan backend alive. The
  root protocol should use the Tauri-owned lifetime pipe or another
  non-reusable parent token, not another PID check.
- Artifact publication sequence and resource SHA verification remain
  parallel-owned findings from Round 3.
- Cron lease continuity and serve startup-recovery shutdown ordering remain
  unresolved on their previously recorded ownership surfaces.

Round 4 therefore requires another repair and audit iteration. A terminal claim
is prohibited until a fresh three-agent round returns no new evidence-backed
defect.

## Round 5 independent findings and progress

Three independent read-only auditors received fresh, non-overlapping runtime,
GUI, and single-source scopes and were explicitly forbidden to delegate. Each
reported new evidence, so Round 5 is not terminal.

### Repaired in the current batch

- `withKeyedLock` left the losing timeout in every successful wait race. Those
  referenced timers kept otherwise-finished processes alive until the original
  deadline. Each waiter now unreferences its timer and clears it in `finally`.
- mDNS (multicast Domain Name System) cleanup ran `unpublishAll` and `destroy`
  in one `try`, so an unpublish failure skipped destruction and then discarded
  the only backend owner. Publication now has one explicit owner, destruction
  is attempted independently, failed destruction retains the owner for retry,
  and a service error invalidates healthy same-port reuse.
- Environment `Commit & Push` obtained its directory separately for commit and
  push. A task switch between the two requests could commit Project A and push
  Project B. The compound operation now captures one required directory,
  supplies it explicitly to both requests, and suppresses stale presentation
  updates after a scope change.
- The clean Git Dialog prevented Kobalte autofocus but only tried to focus the
  absent commit textarea. It now owns a visible close action and focuses the
  textarea, Push action, or close action in that order.
- Goal execution locate captured only a goal ID. A delayed history response
  could therefore read the replacement task's cards, expand them, and issue a
  stale scroll/highlight. Each locate now captures task/source identity,
  selection epoch, goal title, session, directory, and a monotonic operation
  owner; superseded work exits without mutating or reporting against the new
  task.
- Project `config.changed` events used the literal directory `config`, so every
  real project SSE (Server-Sent Events) filter discarded them. The writer now
  publishes the exact owning project directory captured before mutation.
- Skill install/remove/policy writers called the storage primitive directly
  and bypassed the canonical global runtime refresh and invalidation event.
  They now use the same global mutation lifecycle as the global config route.
- Global and project config mutations could persist successfully, fail during
  post-commit reconcile/reset, and return an ordinary error. Both routes now
  return an explicit `committed=true` receipt containing the canonical saved
  config and concrete runtime failures. Overlay config writers project that
  committed config before surfacing the reconciliation diagnostic, so disk,
  API receipt, and the local store no longer disagree.

### Validation evidence

- Keyed lock tests: 3 pass, including a real subprocess that exits in about
  11 ms instead of waiting for a 2 s timeout.
- mDNS lifecycle tests: 3 pass, covering unpublish failure plus destruction,
  retained owner/retry after destroy failure, and same-port republish after a
  service error.
- Overlay VCS service/static tests: 12 pass; Overlay typecheck passes.
- Focused Node-launched Vite browser test holds Project A commit, selects
  Project B, then releases A. Both commit and push remain scoped to A and B
  receives no stale completion notice.
- The same focused browser test opens a clean, ahead repository Git Dialog by
  keyboard. The inspected screenshot
  `.scratch/task-dirbar-clean-git-dialog-visible-focus.png` shows the visible
  Push focus ring and a compact, unclipped dialog.
- The goal locate browser regression holds Task A session history, switches to
  Task B, and releases A. No card-scroll event fires. The inspected screenshot
  `.scratch/task-progress-stale-goal-locate-ignored.png` shows Task B unchanged
  with no stale highlight or misattributed warning.
- The complete TaskDirBar browser file has 15 passing scenarios and two
  unrelated failures: the new focused scenario initially used
  `networkidle0`, which cannot settle while the fixture's SSE streams stay
  open and was corrected to explicit DOM/activity waits; an older worktree
  error-text geometry assertion still fails on current parallel CSS. The
  focused repaired scenario passes independently.
- Project config event scope test: pass.
- SkillManager suite: 29 pass.
- Global and project committed-config route failure-injection tests: pass.
- Overlay committed-receipt projection tests: 3 pass.
- OpenCorvus and Overlay typechecks: pass after the current parallel type
  changes converged.

### Unresolved Round 5 findings

- The desktop parent watchdog still needs a non-reusable Tauri-owned lifetime
  token. Its CLI ownership file remains active parallel work.
- Artifact publication sequence and resource SHA (Secure Hash Algorithm)
  verification remain parallel-owned findings.
- Cron lease continuity and serve startup-recovery shutdown ordering remain on
  their previously recorded ownership surfaces.
- The older TaskDirBar worktree error-text geometry assertion must be
  re-evaluated against the active parallel layout change rather than silently
  weakened.

Round 5 found and repaired new defects. A fresh three-agent Round 6 is required;
only a complete independent round with zero new evidence-backed findings can
end the iteration.

## Round 6 independent findings and progress

Three independent read-only auditors again covered runtime cleanup, GUI
asynchrony, and public/persistence/event single-source contracts without
delegation. They found six new defect clusters, so Round 6 is not terminal.

### Repaired in the current batch

- Channel Supervisor `sync`, `restart`, and disposal could overlap. Each caller
  stopped and started independently, so a late completion could overwrite the
  only runtime reference while another live runtime continued without an
  owner. One lifecycle tail now serializes the instance; stop clears ownership
  only after success, and failed startup rollback remains retryable.
- Channel Runtime stopped adapters sequentially and skipped all later adapters
  plus the server after one rejection. Cleanup now attempts every resource,
  removes each successfully released owner, retains only failures, and reports
  the aggregate.
- PTY (pseudo terminal) bridge termination set a permanent latch before proving
  child exit. A first termination rejection made a second call return success,
  after which the session reported `exited` while the child could still live.
  Termination failures now reset the shared promise for a real retry.
- PTY startup and socket cleanup failures discarded their owners. Failed bridge
  child cleanup remains in instance state and is retried before another spawn
  or disposal. Connections are removed one by one only after close succeeds;
  process exit and session removal retain failed connection owners.
- Image preview loaders had no global request generation. A slower earlier
  click could replace the newer image or open an image after its task trigger
  unmounted. Preview requests now use one global revision, and unmount or a
  newer request invalidates the old completion.
- Image copy feedback was shared across preview generations. A copy from closed
  Preview A could mark Preview B copied or clear B's busy state. Copy source,
  feedback, and busy completion now belong to the exact open preview revision.
- Agent Rail treated expected history cancellation as a locate failure and
  allowed late history/animation-frame/scroll work to mutate the replacement
  task. Locate owns one generation plus selected source identity; superseded
  and `AbortError` completions are silent while real current errors remain
  visible.
- Experimental Workspace create accepted caller `branch` and `config` but used
  neither to create the real worktree, returned before a timer persisted the
  row, and published a schema-invalid ready event under the workspace ID rather
  than the project scope. `Worktree.create` now uniquely owns directory and
  branch; the API accepts only a strict empty object, persistence completes
  before the response, failure rolls back the real worktree and sandbox, and
  ready publishes a schema-valid name under the owning project directory.

### Validation evidence

- Channel Runtime resource cleanup: 6 pass.
- Channel Supervisor lifecycle ownership: 9 pass before a later parallel
  module-removal temporarily blocked the suite loader.
- PTY failure-injection lifecycle tests: 4 pass before the same loader blocker;
  added follow-up cases cover failed connection retry, process-exit connection
  retention, and state-disposal retry.
- The current loader blocker is explicit parallel work:
  `engine/persist.ts` imports `architect-goal-graph.ts` after that file was
  removed by its owner. The task did not restore or overwrite those files.
- Workspace route tests: 4 pass, 29 assertions. The response branch, stored
  branch, and actual `git branch --show-current` are identical; old branch and
  config inputs return 400; a duplicate-row failure leaves worktree inventory,
  project sandboxes, prior row, and ready-event count unchanged.
- Overlay ownership tests: 63 pass, 447 assertions; Overlay typecheck passes.
- Node-launched isolated Vite Image Preview browser test: pass. It proves the
  later B loader defeats delayed A, then proves A's current copy remains busy
  until its own clipboard operation finishes. The inspected dialog screenshot
  is `.scratch/image-preview-ownership/latest-preview-and-copy.png`.
- Node-launched real Overlay Agent Rail browser test: pass. A real delayed
  session-history request is aborted once on task switch; only the replacement
  task card highlights, while DOM warnings and `/log` locate failures remain
  empty. The inspected region screenshot is
  `.scratch/conversation-agent-rail-scroll-browser/latest-task-highlight-no-warning.png`.
- Round 6 repair commits are `fb58f9be33`, `01a1f3530f`, and `589be810e7`.

### Unresolved after Round 6

- The desktop parent watchdog still needs a non-reusable Tauri-owned lifetime
  token. Its CLI ownership file remains active parallel work.
- Artifact publication sequence and resource SHA (Secure Hash Algorithm)
  verification remain parallel-owned findings.
- Cron lease continuity and serve startup-recovery shutdown ordering remain on
  their previously recorded ownership surfaces.
- Experimental Workspace OpenAPI and generated SDK (Software Development Kit)
  must be regenerated after their current parallel owner converges; those files
  were already dirty and were not overwritten.
- The older TaskDirBar worktree error-text geometry assertion still belongs to
  the active parallel layout change.

Round 6 found and repaired new defects. A fresh three-agent Round 7 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 7 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–6 item. They found five new
defect clusters, so Round 7 is not terminal.

### Repaired in the current batch

- Worktree creation made the physical git worktree and
  `Project.sandboxes` separate success sources. Both new-create and reuse paths
  swallowed owner registration failure, while startup rollback swallowed
  physical and owner cleanup failures. Owner registration is now part of the
  create success boundary. Only a worktree proven created by the current call
  may be physically rolled back; reuse and pre-create failure preserve existing
  resources. Cleanup attempts every physical/registry/branch/owner surface and
  returns aggregate residue diagnostics instead of reporting false success.
- `worktree.ready` and `worktree.failed` were emitted before the response under
  the new worktree directory. The calling project did not yet know that
  directory, so its SSE filter discarded both events and a later subscription
  was too late. Both events now use the captured owner project directory and
  include the concrete worktree directory in their schema.
- Task Queue failure handling persisted the queue row as failed, then awaited a
  visible `Session.Error` observer before committing canonical terminal
  `SessionStatus`. A rejecting observer left queue status failed while the
  session remained streaming. Error publication and terminal publication now
  run as independent owned attempts under `allSettled`; terminal state is
  committed even when either observer rejects, and publication failures remain
  aggregated and visible.
- Composer model selection captured Task A correctly for the backend PATCH but
  applied its late completion to the current Task B resource and closed B's
  newly opened Popover. Each PATCH now owns a generation plus exact task,
  session, directory, and resource identity. A stale success cannot mutate or
  close the replacement selector; a stale error is not misattributed, while a
  current error still follows the existing diagnostic path.
- Log Viewer refresh wrote directly into module state without an open
  generation. Closing and reopening could let an older request overwrite newer
  lines and log path, and an old completion could clear the current pending
  state. Fetch now returns data without mutating the store; open, manual
  refresh, close, clear, and unmount share one generation owner. Only the
  current open generation may commit data, path, error, or pending.

### Validation evidence

- Seven scoped Worktree failure/event tests pass with 33 assertions:
  registration failure cleans a newly created worktree; reuse registration
  failure preserves the existing worktree; git-add failure preserves a
  pre-existing branch; physical and sandbox cleanup failures retain consistent
  residue ownership and aggregate diagnostics; owner project SSE receives
  schema-valid ready/failed while a foreign project receives neither.
- Worktree lifecycle plus Experimental Workspace regression: 13 pass.
- The full project-routes file has 39 passing scenarios and four failures in
  active parallel goal projection behavior. The scoped Worktree tests pass and
  those unrelated expectations were not changed.
- Task Queue complete suite: 37 pass, 119 assertions. Failure tests begin from
  streaming status and inject rejecting error/status observers; queue status is
  failed, canonical session status is terminal/error, and no unhandled
  rejection occurs.
- Composer/Log focused contracts: 6 pass, 78 assertions; Overlay typecheck
  passes.
- Node-launched real Overlay Composer browser tests: 2 pass. A delayed Task A
  PATCH is released after Task B loads and reopens its Popover; B retains
  `task-b-model`, its write context, and the open Popover. The inspected region
  screenshot is
  `.scratch/composer-model-selector-task-context/stale-patch-owner.png`.
- Node-launched real Overlay Log Viewer browser test: pass. Close/reopen and
  clear invalidate older responses; the current toolbar, path, pending state,
  and `NEW ownership response` remain authoritative. The inspected region
  screenshot is
  `.scratch/log-viewer-refresh-ownership/latest-open-owner.png`.
- Round 7 repair commits are `44878ecb84`, `0930fa5054`, and `3d856359b2`.

### Unresolved after Round 7

- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, serve startup-recovery shutdown ordering, and the parallel
  TaskDirBar layout assertion remain as previously recorded.
- Worktree event and Experimental Workspace contract changes require OpenAPI
  and SDK regeneration after the current dirty generated-file owner converges.
- The normal pre-push hook currently stops in unrelated parallel OpenCorvus
  type errors under Build/Engine/Orchestrator/Task API. The Round 6 push attempt
  ran the hook normally and did not bypass it.

Round 7 found and repaired new defects. A fresh three-agent Round 8 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 8 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–7 item. They found seven new
defect clusters, so Round 8 is not terminal.

### Repaired in the current batch

- Network proxy HTTP requests constructed a new Node `ProxyAgent` for every
  call without retaining or closing it. A scope-owned transport now reuses one
  agent, rotates it when the effective proxy changes, retries failed close
  owners, and disposes every retained agent. The standalone connectivity test
  owns and closes its deliberately short-lived transport.
- Exact session-tree deletion removed canonical session rows but left
  `SessionStatus`, activity-monitor, and prompt-owner maps alive. Direct removal
  and the clean exact-tree deletion helper now register post-commit cleanup;
  rolled-back transactions retain the live owners, while committed deletion
  releases all three in-memory surfaces.
- PTY update accepted `{}`, empty, and whitespace-only titles, returned 200,
  and emitted an update event despite performing no meaningful mutation. The
  strict input now requires at least one supported field and a trimmed
  non-empty title; rejected requests emit no event.
- Anonymous-project promotion attempted rollback but swallowed cleanup errors,
  so a failed move could be reported as safely restored while source,
  destination, staging, quarantine, or Project/Session mappings remained.
  Rollback now attempts and verifies every owned surface and reports aggregate
  residue instead of false success.
- Composer attachment upload completion was owned only by a global pending
  counter. A delayed upload from Task A could append files or diagnostics after
  Task B/project became current, and component unmount did not invalidate it.
  Uploads now capture normalized draft, directory, and generation ownership;
  scope change and unmount share one invalidation path, and pending state is
  local to the owning composer.
- Provider connection tests stored result and pending state by provider ID
  alone. A delayed global-directory result could overwrite the same provider in
  a project directory. Directory identity plus per-provider generation now
  owns every completion, and scope changes clear obsolete result state.
- Permissions writes for the same directory and key could complete out of
  order, letting an older response roll the UI back after a newer choice. Writes
  are serialized by exact global/project directory and permission key, and
  response application is guarded by the latest generation owner.

### Validation evidence

- Proxy/session focused tests: 11 pass, 47 assertions. A real Node CONNECT
  fixture proves proxy reuse, proxy rotation, disposal, and failed-close retry.
  Session tests prove committed direct and exact-tree deletion release status,
  activity, and prompt owners while rollback preserves them.
- The broader runtime selection has 96 passing tests and one unrelated active
  parallel provider-catalog failure. OpenCorvus typecheck passes for the owned
  changes.
- Anonymous promotion tests: 6 pass. Injected cleanup failures verify every
  rollback surface is attempted and residue is aggregated.
- PTY focused route regression passes; empty, whitespace, and no-op bodies
  return 400 without publishing an update.
- Overlay attachment focused tests: 6 pass, 143 assertions; the wider focused
  ownership selection has 12 passing tests. Overlay typecheck and
  `git diff --check` pass.
- Node-launched isolated Vite permissions browser test proves a delayed Ask
  response cannot replace the later Deny selection. The inspected region
  screenshot is
  `.scratch/settings-segmented-latest-intent-owner.png`.
- Node-launched isolated Vite Provider browser test proves a delayed global
  result cannot overwrite the project-scoped result. The inspected region
  screenshot is `.scratch/provider-test-ownership/current-scope-result.png`.
- Node-launched isolated Vite attachment browser test proves Task A upload
  completion after changing to Task B creates neither a stale attachment nor a
  stale pending indicator. The inspected region screenshot is
  `.scratch/composer-stale-upload-owner-current-scope.png`.
- Round 8 repair commits are `d223b7afa8`, `6cead4ec1d`, and `9857993531`.

### Unresolved after Round 8

- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, serve startup-recovery shutdown ordering, and the parallel
  TaskDirBar layout assertion remain as previously recorded.
- PTY, Worktree, and Experimental Workspace contract changes still require
  OpenAPI and SDK regeneration after the current dirty generated-file owner
  converges.
- The last normal pre-push hook stopped in unrelated active parallel
  Build/Engine/Orchestrator/Task API type errors. It was not bypassed.

Round 8 found and repaired new defects. A fresh three-agent Round 9 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 9 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–8 item. They found ten new
defect clusters, so Round 9 is not terminal.

### Repaired in the current batch

- Goal save completion had no dialog generation owner. Closing Goal A, opening
  Goal B, and then receiving A's response could close B or attribute A's error
  to B. Open, close, save, task, directory, and goal identity now share one
  generation owner; task messages use the captured explicit target.
- Diff Preview keyed its resource by attempt and path without task scope, so
  two tasks with the same path could show Task B metadata with Task A content.
  Its immutable resource source now contains canonical task scope and a target
  snapshot.
- The shared input dialog treated an IME (Input Method Editor) composition
  Enter as confirmation. Composition Enter is now ignored; ordinary Enter
  after composition still settles the existing dialog epoch.
- Codex and DigitalOcean OAuth (Open Authorization) callback owners could be
  overwritten by a second authorization, and an old timer could clear the new
  owner. A shared managed lifecycle class, instantiated independently per
  provider, now supersedes eagerly, binds timers to exact owners, and settles
  once.
- Codex, DigitalOcean, and Snowflake published listener singletons before
  successful listen, poisoning retries after startup failure. The shared
  listener owner publishes only after listen success, deduplicates concurrent
  starts, supports retry, awaits close, and uses per-authorization leases.
- Codex callback rejection skipped listener shutdown and left fixed port 1455
  occupied. Every callback outcome now awaits lease-owned shutdown in `finally`.
- HTTP query `z.coerce.boolean()` interpreted the strings `false` and `0` as
  true. A strict query schema now accepts only exact `true` or `false` across
  Session and Mission routes; limits are bounded positive integers. In
  particular, `deleteTasks=false` can no longer delete bound tasks.
- ChannelAttachment wrote blob and metadata as two non-atomic files, responded
  before validating a blob, accepted malformed base64, and never removed
  expired bytes. It now decodes canonically, publishes a complete staging
  directory by atomic rename, persists expiry, validates bytes before response,
  sweeps/removes expired or corrupt pairs, and exposes cleanup residue.
- ChannelAttachment metadata could name a blob outside its committed directory.
  The single dynamic metadata schema now requires a basename owned by the exact
  attachment ID; invalid URL IDs and corrupted metadata cannot read or delete
  an outside sentinel. Cache lifetime is capped by remaining metadata expiry.
- PTY output SSE (Server-Sent Events) chained writes without a rejection owner,
  causing unhandled rejection, skipped exit, and retained connections.
  A reusable serialized writer now owns the first failure, stops later writes,
  releases the prepared connection once, and observes cleanup failure.

### Validation evidence

- Overlay typecheck and focused Goal/App/Diff unit tests pass.
- Three Node-launched isolated Vite browser tests pass. Inspected strict region
  screenshots are `.scratch/goal-dialog-owner.png`,
  `.scratch/file-changes-task-scope-resource-owner.png`, and
  `.scratch/browser-preview-dispose-dialog/ime-composition-dialog.png`.
- OAuth focused suite: 65 pass, 207 assertions. Real local sockets prove
  overlapping authorization ownership, old-timer isolation, startup
  `EADDRINUSE` retry, and immediate Codex 1455 rebind after failure.
- Strict query and Session tests: 15 pass. Mission's prior 15 tests pass, and a
  new real HTTP regression covers `archived=false`, `archived=true`, and
  rejected `archived=0`.
- ChannelAttachment reached 9 passing focused scenarios before the final two
  metadata traversal/cache-expiry assertions were added. Those assertions are
  source-reviewed and typechecked but their final collection is blocked by the
  active parallel SDK source/dist mismatch.
- PTY serialized-writer failure regression passes independently and produces no
  unhandled rejection. Four pre-existing real process/Server scenarios remain
  blocked by the current parallel runtime baseline.
- OpenCorvus and Overlay package typechecks pass; scoped diff checks pass.
- Round 9 repair commits are `4a2478a9d5`, `ce346dbfdb`, and `e4039ea5f6`.

### Unresolved after Round 9

- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, serve startup-recovery shutdown ordering, and the parallel
  TaskDirBar layout assertion remain as previously recorded.
- Generated OpenAPI/SDK still require convergence. The normal pre-push typecheck
  passed all ten packages, then `api:routes-check` rejected the tracked OpenAPI
  because it lacks the committed Worktree event fields. Later server-test
  collection also sees parallel SDK source exports absent from the old SDK
  `dist`; neither parallel surface was overwritten.
- DigitalOcean and Snowflake browser `open(url)` rejection cleanup was noted
  after the scoped OAuth repair and requires an independent fresh-round
  decision rather than being silently broadened into Round 9.

Round 9 found and repaired new defects. A fresh three-agent Round 10 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 10 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–9 item. They found nine new
defect clusters, so Round 10 is not terminal.

### Repaired in the current batch

- File editor dirty state lived only inside the editor while file/panel
  navigation lived in a separate service, so switching files, opening Diff, or
  closing the center panel silently discarded drafts. The existing draft
  remains the single source; the workbench navigation owner now invokes one
  registered before-navigate decision using the existing Dialog and Button
  primitives for Cancel, Discard, and Save.
- Server Connection save had no immutable request or completion owner. Inputs
  and actions are disabled during an owned save; every external await,
  completion, and saved timer checks the same generation before starting the
  next check/reload or changing feedback.
- PDF preview kept document/loading/render tasks outside reactive source
  ownership. Source generations now reset page/error/canvas, destroy their own
  loading task, reject stale documents, and cancel stale renders; equal-page
  PDFs cannot preserve the old canvas.
- DigitalOcean and Snowflake constructed a callback promise before opening the
  browser. Opener rejection left an unconsumed promise and listener until a
  later unhandled rejection. Exact callback and listener leases are now
  rejected, consumed, and closed before the original opener error is rethrown.
- A language server exiting after initialize left a dead client selected
  forever. One permanent process lifecycle and shutdown promise now converges
  exit/error/dispose races; Instance evicts only the exact client without
  recursive disposal, and the next touch spawns a replacement.
- Browser MCP HTTP startup returned before bind and did not own listen errors.
  Startup now resolves only on listening, rejects port conflicts through the
  caller, supports retry, and awaits connection, browser-session, signal, and
  server cleanup with aggregate failure preservation.
- General AttachmentStore published final blob and metadata paths directly and
  trusted existing size. Content-key serialization, same-directory staging,
  actual byte/SHA (Secure Hash Algorithm) verification, atomic publication,
  final pair validation, and residue-aware cleanup now live inside the existing
  write contract used by all callers.
- Attachment sweep said it skipped locked blobs but deleted metadata and
  reported success. Explicit deleted/retry/failed outcomes now retain both
  files on `EBUSY`/`EPERM`, report retry residue, avoid false statistics, and
  define metadata-failure and missing-blob recovery semantics.
- MySQL import disposed every project Instance before semantic validation.
  A pure, deep-frozen preflight validates fingerprint, table/column shape, row
  constraints, and foreign keys before disposal; apply is a separate operation.
  Only the named validation error maps to 400, while rebuild failures retain
  named 500 state/residue. The staged commit was constructed from latest HEAD
  so pre-existing parallel Artifact Catalog hunks in the same two MySQL files
  remained unstaged and untouched.

### Validation evidence

- Overlay focused unit tests: 8 pass, 474 assertions. Overlay typecheck passes.
- A Node-launched isolated Vite scenario passes all file-editor, Server
  Connection, and real pdf.js ownership interactions.
- Inspected strict region screenshots are
  `.scratch/round10-gui-owners/file-editor-unsaved.png`,
  `.scratch/round10-gui-owners/server-connection-saved.png`,
  `.scratch/round10-gui-owners/pdf-current-b.png`, and
  `.scratch/round10-gui-owners/pdf-after-stale-a.png`. The two PDF images are
  byte-identical after the stale source is released.
- OAuth opener focused tests: 67 pass, 215 assertions.
- LSP (Language Server Protocol) lifecycle suite: 15 pass. A real child process
  initializes, exits, is evicted exactly once, and is replaced.
- Browser MCP HTTP lifecycle test passes with a real occupied port, controlled
  rejection, retry, close, and rebind.
- Attachment publication tests: 3 pass. New sweep lock/metadata/missing-blob
  boundaries: 4 pass. The wider sweep file has 14 pass and two failures only in
  active parallel Artifact fixtures rejected by their trigger.
- MySQL transfer: 6 pass; global destructive route: 9 pass. A dedicated
  preflight test owns the immutable/constraint regression without staging
  pre-existing parallel MySQL test hunks.
- Round 10 repair commits are `a06b22bed6`, `47693ee1d4`,
  `ec3237e84a`, and `d774d6dd16`.

### Unresolved after Round 10

- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, serve startup-recovery shutdown ordering, and the parallel
  TaskDirBar layout assertion remain as previously recorded.
- Generated OpenAPI/SDK and SDK `dist` remain active parallel surfaces. Normal
  push is still blocked until their owner converges the committed route/event
  contracts; hooks have not been bypassed.
- Full package typecheck during the runtime subtask was temporarily blocked by
  active AttachmentStore and SDK export edits; the completed AttachmentStore
  implementation later passed package typecheck.

Round 10 found and repaired new defects. A fresh three-agent Round 11 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 11 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–10 item. They found seven new
defect clusters, so Round 11 is not terminal.

### Repaired in the current batch

- Formatter probes and actual formatter commands had no termination owner.
  Since File Edited publication is awaited by write, edit, and apply-patch
  tools, one hanging custom command could leave a file written but the tool/UI
  running forever. Probe and execution now share a configurable supervised
  timeout; timeout disposes the full process tree and waits for exit, streams,
  and owner release.
- Work Ledger organization/sort saves used each call's previous value as a
  rollback source. An older failure could overwrite a newer successful
  selection. Two per-field persisted-selection owners now use immutable
  snapshots, generations, and durable confirmed values; stale failures neither
  roll back nor diagnose the current operation.
- Workspace editor selection saved and then launched without operation
  ownership. Older completion could open the wrong app, while current failure
  retained an unpersisted label. The same persisted-selection abstraction now
  permits launch only for the latest confirmed owner and restores the durable
  value on current failure. Confirmed same-value clicks still launch; pending
  same-value clicks await the same result.
- Auth durable mutations performed unlocked read-modify-write and directly
  truncated `auth.json`. A filepath-keyed lock now rereads under ownership and
  publishes atomically with mode `0600`; route cache reset occurs only after a
  durable commit.
- Multi-file upload published each target and event immediately, leaving
  partial success on later failure. A complete batch is staged and byte-checked
  in target directories, published without overwrite, and rolled back only for
  this batch with aggregate cleanup residue. Events publish only after the
  whole batch succeeds.
- Panel SSE client abort did not stop its backend control prompt. The request
  now captures the exact prompt-generation owner, cancels and settles only that
  owner on abort, releases its Bus subscription, and rejects late tool
  projection without broad session cancellation.
- Panel stream OpenAPI declared a bare result while the wire sent
  `start/tool/done`. Transport Protocol now owns the single executable
  discriminated Zod schema factory; producer, route resolver, and Overlay
  consumer import it instead of duplicating frame shapes.

### Validation evidence

- Formatter focused suite: 24 pass, 368 assertions; write: 14 pass; edit and
  apply-patch: 50 pass. Real parent and child PIDs that ignore `SIGTERM` are
  absent after timeout, and the formatter supervisor owner registry is empty.
- Persisted-selection unit/contract tests: 14 pass, 111 assertions; Overlay
  typecheck passes.
- Node-launched editor Vite browser test passes confirmed-same, pending-same,
  superseded, current-failure, and no-wrong-launch paths.
- The existing real command-palette App reached and passed the new Work Ledger
  delayed-save assertions for organization and sort, including store, payload,
  persisted value, and menu checkmarks. Inspected strict screenshots are
  `.scratch/round11-command-palette-work-ledger-menu.png` and
  `.scratch/round11-command-palette-work-ledger-region.png`.
- The wider command-palette file later fails an unrelated pre-existing compact
  empty-home composer width assertion. Its acceptance values were not weakened
  or staged to hide that failure.
- Auth, upload, exact Panel owner, schema, and real SSE abort selection: 122
  pass, one Windows-only skip, zero failures.
- Full typecheck during the contract task was blocked only by active parallel
  ACP (Agent Client Protocol), Artifact, and AttachmentStore edits. Focused
  owned checks and scoped diff checks pass.
- Round 11 repair commits are `aad2085473`, `c9c31b8cf2`, and `c046060ae6`.

### Unresolved after Round 11

- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, serve startup-recovery shutdown ordering, and the parallel
  TaskDirBar/compact layout assertions remain as previously recorded.
- The corrected Panel stream source schema requires generated OpenAPI and SDK
  convergence after the existing parallel generated-file owner completes.
- Parallel process-shutdown handoff changes that appeared in
  `session/prompt/state.ts` during this round were excluded from the staged
  prompt-owner commit and remain intact in the working tree.

Round 11 found and repaired new defects. A fresh three-agent Round 12 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 12 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–11 item. They found eleven
new defect clusters, so Round 12 is not terminal.

### Repaired in the current batch

- Server restart spawned a replacement against the still-owned port, treated
  500 milliseconds of survival as readiness, returned 200, then stopped the
  only healthy server. Serve now owns a tokenized pipe handoff:
  `waiting -> bind -> ready/failed`. The parent releases accept ownership, the
  child binds the parent's resolved endpoint (including `port=0`), and only
  real ready produces 200. Failure cleans the child, restores the parent
  listener/managed owner, and returns 503.
- Memory permanent delete was one-click and allowed duplicate requests. The
  existing ArmedConfirmButton now owns confirmation and an exact
  task/directory/file pending identity; failure retains the row and restores
  focus.
- Managed backend restart could save a new URL unsuccessfully after native
  success, leaving settings and API client on different endpoints. Durable
  confirmed settings now roll both surfaces back together, with a caught and
  visible diagnostic.
- Archive projection removed rows by bare ID after kind-specific actions.
  Canonical kind/entity/directory keys now preserve a task/chat/mission with the
  same textual ID.
- Help Docs/SDK ignored false/rejected native-open outcomes. Both paths now
  report visible diagnostics, close the menu, restore Help focus, and own their
  promises.
- File move used check-then-rename, allowing POSIX rename to overwrite a target
  created in the race window. A single native `renameNoReplace` abstraction uses
  macOS `renamex_np(RENAME_EXCL)`, Linux
  `renameat2(RENAME_NOREPLACE)`, and Windows `MoveFileExW` without replacement
  flags for files and complete directories.
- Copy/move validated symlinks only at the source location. Shared relocation
  preflight recalculates every relative link at the destination and rejects
  project escape without residue.
- File text writes and recursive copies mutated canonical paths directly.
  Text uses a filepath lock and same-directory atomic write; copy validates a
  hidden same-parent staging tree and publishes it with native no-replace,
  aggregating cleanup residue.
- File mutations awaited Bus observers after durable commit, so observer
  rejection returned API 500 for an already-complete action. A shared
  post-commit notifier attempts every event, records observer failures, and
  preserves the durable receipt.
- Concurrent projects could write one global plugin manifest and run multiple
  `bun install` processes in the same directory. A resolved-directory owner
  rechecks under lock, atomically publishes manifest/ignore changes, and permits
  one install with failure-safe retry.
- VCS commit-message SSE had server schema, unchecked producer literals, and an
  Overlay hand parser. Transport Protocol now owns the executable discriminated
  schema used by producer, route resolver, and Overlay terminal consumer.

### Validation evidence

- Restart focused suite: 36 pass, 180 assertions; full typecheck passes.
- Real isolated restart E2E passes explicit port PID replacement, `port=0`
  exact-URL replacement, and real bind-failure parent recovery. All isolated
  processes/listeners were stopped; the user's running server was untouched.
- Overlay focused tests: 15 pass, 99 assertions; Overlay typecheck passes.
- New Memory, Help, and restart-save assertions execute in existing Node/Vite
  fixtures before their known later baseline failures. Inspected strict region
  screenshots are `.scratch/memory-row-delete-armed.png`,
  `.scratch/titlebar-help-open-failure-focus.png`, and
  `.scratch/sidebar-restart-save-failure.png`.
- File/Config/VCS focused selection: 147 pass, one Windows-only skip, zero
  failures. Real macOS tests cover no-replace file conflict and complete
  directory rename.
- OpenCorvus, Overlay, and Transport Protocol package typechecks pass. The later
  full workspace typecheck is blocked only by active parallel Artifact recovery
  edits.
- Round 12 repair commits are `e7767d1dbf`, `6f053e8209`, and `5ffb3065b7`.

### Unresolved after Round 12

- Windows restart and native no-replace behavior require their real matrix; the
  production implementation uses platform-native single operations and existing
  supervised process ownership.
- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, parallel TaskDirBar/compact layout assertions, and generated
  OpenAPI/SDK convergence remain as previously recorded.
- Pre-existing process-shutdown handoff work in `serve.ts` stayed unstaged while
  the restart commit used a latest-HEAD task-only index.

Round 12 found and repaired new defects. A fresh three-agent Round 13 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 13 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–12 item. They found five new
defect clusters, so Round 13 is not terminal.

### Repaired in the current batch

- Question rejection removed the pending request but left its timeout alive for
  as long as 60 seconds, retaining the Bun process and permitting a delayed
  terminal callback race. Reply, reject, timeout, configuration error, and
  disposal now converge through one exactly-once finalizer that clears the
  timer before releasing the owner.
- Network save, delete, test, and feedback timers had no immutable
  task/directory/config owner. A completion from project A could clear or
  overwrite project B after navigation. Every operation now captures the exact
  scope and config generation; scope changes invalidate pending UI ownership,
  and authoritative config remains the only form rehydration source.
- Agent model PATCH completions were not owned by global/project/session
  identity, while failures were console-only. Per-key mutation owners now reject
  stale success and failure projections. A current failure preserves canonical
  values, renders an accessible alert, and restores the exact select focus.
- Provider catalog and live Hexin refresh both performed unlocked
  read-modify-write against `models.json`, so either writer could erase the
  other's newer declaration. A catalog-path keyed in-process and filesystem
  transaction now rereads under lock, updates only its owned declaration, and
  publishes atomically. Controlled completion-order and real two-process tests
  cover both writers.
- Provider deletion was a one-click frontend sequence that first patched config
  and then independently deleted credentials. It could leave a partial commit
  while reporting a generic failure. Project and global routes now call one
  durable removal owner and return an explicit committed receipt; the Overlay
  uses ArmedConfirmButton, exact per-provider busy ownership, and a visible
  credential-residue alert. Commit review additionally found and closed the
  credential-lookup failure edge so every post-config credential failure
  returns `committed_with_residue` rather than pretending no mutation occurred.

### Validation evidence

- Question focused suite: 21 pass. A real child configured with a 60-second
  timeout rejects and naturally exits in approximately 0.77 seconds.
- Network and Agent Models focused tests: 8 pass and 44 assertions; dedicated
  Node/Vite scenario: 1 pass; Overlay typecheck passes.
- Inspected strict region screenshots are
  `.scratch/round13-settings-owners/network-project-b-after-stale-delete.png`
  and
  `.scratch/round13-settings-owners/agent-model-current-scope-failure.png`.
- Provider catalog/removal selection after the secondary review fix: 51 pass,
  zero failures, 267 assertions. OpenCorvus and Overlay typechecks pass.
- Node-launched provider-removal Vite evidence covers default, armed, busy, and
  committed-with-residue states in
  `.codex-tmp/provider-removal-round13/{default,armed,busy,residue}.png`.
  The isolated Vite process and browser page were closed after verification.
- Round 13 repair commits are `eaa162d3af`, `f28406426a`, and `5fecffc7b9`.

### Unresolved after Round 13

- The desktop parent watchdog, Artifact Catalog parallel ownership, Cron lease
  continuity, parallel TaskDirBar/compact layout assertions, and generated
  OpenAPI/SDK convergence remain active parallel surfaces.
- The new provider removal routes also require generated OpenAPI/SDK convergence
  by the existing generated-file owner. Hooks have not been bypassed.

Round 13 found and repaired new defects. A fresh three-agent Round 14 is required;
only a complete independent round with zero new evidence-backed defects can end
the iteration.

## Round 14 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–13 item. They found eight
new defect clusters, so Round 14 is not terminal.

### Repaired in the current batch

- Slack had two reachable adapters and both marked an in-memory message ID as
  processed before the durable handler succeeded. A transient failure therefore
  made Slack's retry disappear. The embedded gateway and CLI command were
  removed; the channel-runtime adapter now forwards Slack's stable message
  identity to the canonical ingress owner. In-flight duplicates share one
  operation, failed delivery remains retryable, and a successful result is
  persisted for replay. README, public CLI/channel docs, troubleshooting copy,
  quickstarts, and the architecture explorer now describe only the canonical
  managed/standalone channel-runtime adapter.
- Shared channel session publication truncated the canonical JSON file in
  place. A reader could observe partial JSON, and a crash could make every
  later start fail. First claim now uses a cross-process file lock; publication
  writes a unique same-directory file, syncs file contents, atomically renames,
  syncs the directory, and cleans only its own temporary residue.
- Theme and locale selection mutated runtime state before persistence without
  a durable rollback or latest-operation owner. Theme and locale now use shared
  preference services with immutable save overrides, confirmed persisted
  snapshots, exact operation generations, serialized global locale projection,
  and a project directory captured before the first await. Current failure
  restores store and runtime projection; stale completion cannot target a new
  project or overwrite a newer selection.
- Mission Skill refresh was scope-owned, but copy/open completions were not.
  All actions now capture scope, selected skill, and operation generation;
  navigation or selection change invalidates an old notice.
- Log Copy swallowed clipboard rejection and had no pending or result state.
  It now disables only its exact operation, publishes accessible success/error
  feedback, restores Copy focus on current failure, and invalidates timers and
  completions on close/reopen.
- PTY output SSE had three independent contracts: the producer emitted
  data/cursor/exit, OpenAPI omitted exit details, and Overlay trusted a cast.
  Transport Protocol now owns one strict discriminated schema used by producer,
  route resolver, and safe-parsing consumer; an invalid event reports once,
  closes the consumer, and latches later input.
- Mailbox change SSE similarly duplicated its schema and accepted incomplete
  durable-change events in Overlay. The same shared-schema and terminal
  consumer contract now covers connected, heartbeat, and changed events.
- `provider/dashscope.ts` was documented as the dynamic-key owner while runtime
  called a private duplicate in `provider.ts`. The duplicate and its private
  imports were removed; the public Provider path imports the canonical owner.

### Validation evidence

- Channel runtime and ingress selection: 25 pass, zero failures, 92 assertions.
  This includes Slack retry, concurrent/durable replay, two runtime owners
  claiming one shared session, concurrent JSON readers, and publication-failure
  cleanup. Channel Runtime and OpenCorvus typechecks pass.
- Transport/PTY/Mailbox selection: 21 pass, zero failures, 1187 assertions;
  DashScope public Provider path test passes. Transport Protocol, Overlay, and
  OpenCorvus typechecks pass.
- Mailbox server route suite: 5 pass. The wider PTY route suite has 13 pass and
  four existing process/route lifecycle failures (two output-stream 404s,
  exited-session cleanup, and natural-exit event publication); these were not
  caused by the schema-only diff and remain unaccepted evidence for a later
  runtime repair.
- Appearance, Mission Skill, and Log focused selection: 19 pass, zero failures,
  143 assertions; Overlay typecheck and scoped diff checks pass.
- Real Node browser cases were added for theme persistence rollback and focus,
  delayed Mission Skill copy ownership, Log clipboard failure, and stale
  completion after close/reopen. In the current restricted execution profile,
  all three fixtures fail before page startup with
  `listen EPERM: operation not permitted 127.0.0.1`; no screenshot or visual
  acceptance is claimed.
- Historical docs links pass. Document health has 83 pass and one failure only
  because the active parallel Artifact Catalog record is linked before that
  owner's new file is tracked.

### Unresolved after Round 14

- Round 14 GUI repair is not visually accepted until the Node browser runner can
  bind an isolated localhost fixture and the new strict region screenshots are
  inspected.
- The current execution profile also makes `.git/index.lock` read-only, so
  Round 14 changes cannot yet be staged, committed, or pushed. No Git metadata
  workaround was attempted.
- The PTY lifecycle failures above, desktop parent watchdog, Artifact Catalog
  parallel ownership, Cron lease continuity, parallel TaskDirBar/compact layout
  assertions, and generated OpenAPI/SDK convergence remain active.

Round 14 found and repaired new defects but has explicit unaccepted validation
and delivery blockers. Further independent audit may continue, but termination
requires those blockers to clear and a later complete three-agent round to
produce zero new evidence-backed defects.

## Round 15 independent findings and progress

Three independent read-only auditors searched fresh runtime, GUI, and
single-source scopes while excluding every Round 1–14 item. They found six new
defect clusters. A secondary read-only review of the first configuration repair
then proved that project-root and `.opencorvus` JSONC files still formed a
read-two/write-one ownership split, so that incomplete repair was reopened and
root-fixed before this round was recorded.

### Repaired in the current batch

- The project Git lock rewrote `owner.json` in place and independently removed
  the lock directory. Heartbeat truncation and stale release could therefore
  destroy another process's ownership. One `proper-lockfile` lease now owns
  mutual exclusion; tokenized owner metadata is atomically published for
  diagnostics, compromise is visible, release deletes only its exact token, and
  operation/release failures remain jointly observable.
- Raw Language Server Protocol process disposal latched success before the
  supervised child actually terminated, and the client evicted an unexpected
  exit owner before cleanup succeeded. Raw and client cleanup now retain the
  exact in-flight operation, clear only a failed latch, permit retry against the
  same real child, and publish the exit callback only after cleanup commits.
- Channels save read mutable form values after awaiting the configuration GET,
  while a stale completion could close or overwrite a dialog opened for another
  project. Each channel/public-URL save now captures immutable directory, form,
  channel, values, and generation ownership; stale success, failure, feedback,
  and timers cannot project into a newer form.
- Both Channels tutorial entrances ignored native-open `false` and rejection.
  They now share one exact scope/form/target owner, render an accessible
  form-local error, and restore focus to the precise trigger.
- Automatic configuration discovery merged JSON and JSONC variants and, after
  the first repair, still read project-root or ancestor JSONC alongside the
  single `.opencorvus` writer. The sole project-owned file is now
  `<project>/.opencorvus/opencorvus.jsonc`; root and ancestor
  `opencorvus.json{,c}` plus any other ancestor `.opencorvus` config are strict
  conflicts. Read, candidate validation, atomic update, Provider removal, and
  the CLI MCP writer share the same resolver. Ancestor `.opencorvus` directories
  may still contribute plugin/command resources but never a second config.
  Provider deletion fails before credential mutation on any conflict.
- Channel bundled-environment first-use state swallowed corrupt JSON, wrote
  directly, and let concurrent runtimes reset the credential lifetime. A
  cross-process owner now rereads strictly under lock, publishes a unique
  same-directory file with file and directory sync, never resets
  `first_used_at`, and preserves corrupt state as a visible error.

### Validation evidence

- Real two-process project Git lock handoff: one pass, eleven assertions. The
  second process cannot acquire during the first owner's 300 millisecond hold,
  receives a different token after release, and leaves no lock residue.
- Three real fake-LSP process tests pass: raw termination fail-once retry,
  client shutdown retry against the same PID, and process-error cleanup that
  retains ownership until success. All tested child PIDs are proven exited.
- Bundled environment: seven pass, forty-one assertions, including twelve
  concurrent Bun runtimes claiming one immutable timestamp and strict corrupt
  state preservation.
- Canonical configuration, routes, Provider removal, CLI MCP writer, nested
  project ownership, and related scope tests pass in the agent's 54-test core
  selection. A main-agent wide rerun has 75 pass and seven remaining failures:
  two macOS `/var` versus `/private/var` fixture comparisons, four fixtures
  using nonexistent provider/model identities against correct candidate
  validation, and one read-only dependency-install rejection lifecycle. These
  are not accepted as a green baseline and remain routed to later work.
- Channels ownership contract: three pass, twenty-three assertions; the wider
  Channels selection has 43 pass and 534 assertions. Overlay, OpenCorvus, and
  Channel Runtime typechecks pass; task-scoped diff checks are clean.
- A Node/Vite Channels fixture builds successfully. The required interactive
  run is blocked before page startup by
  `listen EPERM: operation not permitted 127.0.0.1:5215`; no screenshot or
  visual acceptance is claimed.

### Unresolved after Round 15

- Round 14 and Round 15 GUI changes still require Node-launched browser
  interaction and inspected region screenshots when isolated localhost binding
  is permitted.
- The current managed execution profile keeps `.git/index.lock` read-only.
  Round 14–15 task changes therefore cannot yet be staged, committed, or pushed;
  no alternate index, worktree, hook bypass, or Git metadata workaround was
  attempted.
- The seven wide configuration failures above, the known PTY lifecycle cases,
  desktop parent watchdog, Cron lease continuity, active parallel Artifact and
  TaskDirBar/compact work, and generated OpenAPI/SDK convergence remain open.

Round 15 found and repaired new defects and therefore is not terminal. Round 16
must complete three independent audits, repair every new finding, clear the
explicit validation/delivery blockers, and then be followed by a fresh
three-agent zero-new round before iteration can stop.

## Round 16 independent findings and progress

Three new independent read-only auditors searched runtime, GUI, and
single-source scopes while excluding every Round 1–15 item. They found six new
defect clusters. Shared-schema route verification then exposed a seventh,
independent Worktree ownership defect; its assertion was kept strict and the
runtime owner was repaired rather than weakening the contract.

### Repaired in the current batch

- Message history and latest conversation-agent activity used offset paging
  against tables that continue receiving rows. A newer row inserted between
  pages shifted the result set and repeated the previous page boundary.
  Both readers now use strict `(time_created, id)` keyset cursors, preserving
  deterministic order without a deduplication fallback.
- Browser Preview liveness used an unbounded process Map, let every concurrent
  miss perform its own request, and retained expired URL keys forever. A shared
  bounded LRU owner now canonicalizes URL keys, shares one in-flight promise,
  expires settled results after three seconds, and evicts at 256 entries. The
  pre-existing engine lineage caches now reuse the same LRU abstraction instead
  of keeping a private copy.
- Mailbox permitted parallel read acknowledgements but represented pending
  state with one message ID. The first completion could clear a second active
  request. Pending ownership is now exact by message, action, and token;
  duplicate actions share one promise and `finally` releases only its owner.
  Row/open/delete busy and disabled semantics use the same identity.
- Mailbox Search interpreted pointer exit from the header as a close command,
  so moving toward a result cleared the query and restored the full list. Search
  now remains open across pointer movement; only the explicit close button or
  Escape clears it, and focus returns to the Search trigger.
- Work Ledger rows, list/cursor responses, and stream events were independently
  described by server schemas, Overlay interfaces, unchecked API casts, and a
  permissive hand parser. Transport Protocol now owns strict canonical
  Row/List/Cursor/Event schemas used by projection, server producer/OpenAPI,
  Overlay API, and SSE consumer. Malformed payloads fail at the boundary before
  entering runtime projection or dispatch.
- Project Worktree list and delete receipts similarly had a server schema plus
  a permissive Overlay mirror that silently discarded invalid optional identity
  fields. Transport Protocol now owns both strict contracts; producer, route,
  and Overlay parse the same schema.
- The shared Worktree route test then proved that a managed worktree still bound
  to a live Goal could report `removable: true` whenever no Git lock or prompt
  owner remained. The producer now consults the durable latest Goal-attempt
  result and permits removal only when every bound Goal is terminal and Git
  lock plus SessionPrompt ownership are both released.

### Additional quality closure

The seven wide configuration failures carried from Round 15 were not accepted
as baseline:

- command-file fixtures now compare canonical real paths on macOS;
- model-update fixtures declare real provider/model identities instead of
  bypassing correct candidate validation;
- configuration dependency operations are observed immediately by Config, then
  their exact error is rethrown by `waitForDependencies`, preventing a rejection
  before the designated waiter can take ownership.

The wide configuration selection now passes 82 tests and 189 assertions.

### Validation evidence

- Message keyset and liveness: five pass, 322 assertions. Real SQLite coverage
  consumes the first 50 of 51 messages, inserts a newer row, and proves the
  original set is exact; activity scans past 96 unsupported parts to return the
  canonical 24 items. Twenty concurrent canonical-equivalent liveness callers
  perform one probe; capacity and TTL eviction are covered.
- Mailbox focused selection: 40 pass, 316 assertions; main-agent contract rerun:
  12 pass, 208 assertions. Vite production build and Overlay typecheck pass.
- Shared Transport Protocol plus Overlay schema selection: 56 pass, 1,319
  assertions. Work Ledger routes pass 9/9; Worktree GET/DELETE focused routes
  pass 2/2. The live/terminal/locked/prompt ownership matrix passes 6 tests and
  34 assertions.
- Transport Protocol, Overlay, and OpenCorvus package typechecks pass. The
  current task paths pass `git diff --check`.
- Mailbox Node/Vite browser coverage includes two delayed acknowledgements,
  pointer movement into filtered results, explicit close, Escape focus return,
  and strict screenshots. The sandbox rejects the fixture listener with
  `listen EPERM: operation not permitted 127.0.0.1`; the page never opens, so
  no new screenshot or visual acceptance is claimed.

### Delivery and remaining blockers after Round 16

- A parallel owner switched the worktree to `v0.0.19beta` and created local
  checkpoint `1202fa3cbd` while Round 16 agents were still running. It captured
  most Round 14–16 changes plus unrelated parallel work. This audit preserves
  that history and does not rewrite, split, reset, or present the in-progress
  checkpoint as final task delivery.
- The git-cc remote `myhexin/v0.0.19beta` remains behind the local checkpoint.
  The managed execution profile still prevents this Agent from creating
  `.git/index.lock`; remaining post-checkpoint increments cannot be staged or
  committed here, and no alternate index/worktree/hook bypass is used.
- Round 14–16 GUI browser cases remain visually unaccepted until a Node-launched
  isolated localhost fixture can bind and the required screenshots are
  inspected.
- The known PTY lifecycle cases, desktop parent watchdog, Cron lease continuity,
  and active parallel Artifact/Prism/UI work remain outside the repaired
  findings above.

Round 16 found and repaired new defects and therefore is not terminal. Round 17
starts with three fresh independent auditors; only a full zero-new round after
all validation and delivery blockers clear can end the iteration.
