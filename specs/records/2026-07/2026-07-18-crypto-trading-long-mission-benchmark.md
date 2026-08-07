# Crypto Trading Long Mission Benchmark

Date: 2026-07-18
Status: Active benchmark and repair record
Owner: Codex

## Recall

### User request

- Run a long, unattended OpenCorvus benchmark that creates a complete local cryptocurrency trading-system Demo from research through design, implementation, and MirrorTest acceptance.
- Start the development backend and Vite frontend against the formal OpenCorvus database.
- Use a persistent temporary project directory that is not deleted after the run.
- Observe progress through durable mailbox messages only. Do not continuously tail or interpret verbose process logs.
- Carefully classify every failure as infrastructure or expert-squad responsibility. Infrastructure owns generic scheduling stability; the selected squad owns functional delivery and its own stability. Never overfit infrastructure to cryptocurrency-specific failures.
- Repair every benchmark-exposed root cause, rerun, and visually review the real rendered product until every acceptance criterion passes. Do not use fallback behavior, placeholder output, fake realtime behavior, or mocked End-to-End (E2E) evidence.

### Input and expected output

Input:

- Mission request: the complete Chinese task-C prompt supplied by the user, covering competitor research, product/technical design, backend/data implementation, frontend implementation, and MirrorTest acceptance.
- OpenCorvus source worktree: `C:/Users/chuan/myhexin-local/opecorvus`.
- Persistent System Under Test project: `C:/Users/chuan/myhexin-local/benchmark-projects/crypto-trading-task-c-20260718`.
- Active database: `C:/Users/chuan/.local/share/opencorvus/opencorvus.db` with no `OPENCORVUS_HOME` or test-home override.
- Development endpoints: OpenCorvus backend `http://127.0.0.1:7878`; Vite overlay `http://127.0.0.1:5173`.

Expected output:

- A locally runnable cryptocurrency trading Demo in the persistent System Under Test directory.
- Durable research, requirements, architecture, database, Application Programming Interface (API), realtime-event, implementation, test, screenshot, and acceptance artifacts produced through the Mission and its projected expert squads.
- A mailbox chronology sufficient to prove scheduling progress, attention requests, failures, recovery, and terminal claims.
- Root-cause fixes and regression tests in OpenCorvus or the responsible expert-squad package for every benchmark-exposed defect.
- Final MirrorTest evidence plus independent Codex review of code, database behavior, APIs, WebSocket or equivalent streaming, browser interactions, and screenshots.

### Acceptance matrix

| Area                         | Executable acceptance evidence                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Competitor research          | Durable comparison covers Binance, OKX, Bybit, Coinbase Advanced, Kraken Pro, TradingView, CoinMarketCap, CoinGecko, Dexscreener, and GeckoTerminal; includes information architecture, components, interactions, data models, adopted scope, rejected scope, and copyright boundary.                                             |
| Product and technical design | Route map, module boundaries, database schema, API contracts, realtime events, deterministic market generator, matching/account model, frontend state/subscription design, test strategy, risks, and a page-to-API/event/table/component dependency matrix exist before implementation goals.                                     |
| Database                     | Real schema plus initialization exists for pairs, Open/High/Low/Close/Volume (OHLCV) candles, ticks, order-book snapshots, trades, accounts, balances, orders, fills, positions, watchlists, alerts, and audit logs. Persistence is demonstrated by executable tests and database inspection.                                     |
| Synthetic market data        | Seeded generator produces BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, and XRP/USDT across multiple intervals and regimes: trend, range, wick, volume spike, gap, extreme volatility, and low liquidity. No tiny hard-coded quote arrays.                                                                                              |
| Trading backend              | Schema-validated market, pair, account, asset, order, fill, cancel, diagnostic, and simulator-control APIs plus realtime ticker/candle/book/trade delivery. Explicit error responses; no silent fallback.                                                                                                                         |
| Matching and accounting      | Executable tests prove market and limit orders, cancellation, partial fills, fees, slippage, balance freezing/release, fill reports, status transitions, insufficient funds rejection, no negative balances, and auditability.                                                                                                    |
| Frontend pages               | Real desktop routes for market home, trading terminal, pair detail, assets/positions, orders/fills, watchlist/alerts, and diagnostics/simulator control. Mobile/responsive delivery is out of scope because it was not authorized.                                                                                                |
| Mature components            | Financial chart uses Lightweight Charts, Apache ECharts, or equivalent; computed indicators include multiple of Moving Average (MA), Exponential Moving Average (EMA), Moving Average Convergence Divergence (MACD), Relative Strength Index (RSI), and Bollinger Bands; complex tables/forms use mature primitives or libraries. |
| Live UI behavior             | Tables, chart, order book, trades, order entry, balances, positions, history, watchlist, and alerts bind to real local APIs and realtime delivery. Loading, empty, error, reconnect, pause/resume, order success/failure, insufficient funds, and partial-fill states are exercised.                                              |
| Functional acceptance        | MirrorTest executes quote display, interval switching, indicator calculation, book updates, submit/cancel/partial fill, freeze/release, order/fill linkage, navigation, filtering/sorting, watchlist, and alerts.                                                                                                                   |
| Performance acceptance       | Measured large tick flow, candle rolling, book/table refresh, long-lived realtime connection, backend latency, and frontend rendering remain responsive under a declared repeatable workload. Thresholds must be declared by the test architect before execution and failures remain failures.                                    |
| Security acceptance          | Tests cover schema rejection, numeric/order boundaries, authorization/ownership simulation, negative/over-order prevention, and non-leaking error responses.                                                                                                                                                                      |
| Consistency acceptance       | Tests reconcile order states, fills, frozen/released balances, fees, positions, and continuous market time series.                                                                                                                                                                                                                |
| Visual acceptance            | Node-launched Playwright opens the real application, captures task/region-bound desktop screenshots, covers key states and keyboard/focus paths, and verifies terminal density, chart readability, and book/trade/order linkage. Codex personally views and reviews screenshots after MirrorTest.                                   |
| Final report                 | Lists implemented pages and business chains, database/generator design, API/realtime inventory, mature libraries, test cases/results, repair history, and every unresolved item as explicitly not achieved.                                                                                                                       |

### Hard constraints

- No fallback, compatibility alias, hidden gate, keyword route, second active-squad source, state-machine workflow, synthetic/hidden message, static placeholder, fake button, fake order, fake realtime feed, or task-specific infrastructure branch.
- `prompt_profile.active` remains the sole active expert-squad source and `PromptProfileResolver` remains the sole projection surface.
- The General squad owns research, architecture, and product delivery. The Mission must explicitly select `opentest` through the existing tool when product acceptance begins; MirrorTest owns test design, implementation, execution, evidence, and its own package-tool behavior.
- Infrastructure classification requires generic scheduling evidence: dispatch/session/task persistence, lifecycle transition, mailbox delivery, wake/settle, cancellation, or projection isolation. Product correctness and artifact quality are squad responsibilities unless a generic infrastructure failure is proven.
- Timeout is mailbox inactivity, not elapsed wall time. The observer resets its deadline only when canonical mailbox state changes; backend/Vite readiness output is inspected once and is not a progress signal.
- Playwright must run with Node on Windows. Visual acceptance uses a real browser and real screenshots.
- Do not stop, restart, refresh, or kill unrelated OpenCorvus/overlay processes. This run owns only processes it starts on 7878 and 5173.
- Do not create a git worktree, reset the repository, delete Mission/task records before proven settle, or remove the persistent System Under Test directory.
- Existing unrelated staged and unstaged worktree changes are preserved and excluded from benchmark commits.

### Sources read before implementation

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-01-mission-benchmark.md`
- `specs/records/2026-07/2026-07-06-opentest-contract-engine.md`
- `specs/records/2026-07/2026-07-07-opentest-futures-e2e.md`
- `specs/records/2026-07/2026-07-17-all-expert-squad-runtime-audit.md`
- `packages/opencorvus/script/benchmark/mission-benchmark.ts`
- `packages/opencorvus/script/benchmark/mission-scenario.ts`
- `packages/opencorvus/script/mission-e2e.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/server/routes/mailbox.ts`
- `packages/opencorvus/src/engine/mailbox.ts`
- `packages/opencorvus/src/expert-squad/builtin/general/README.md`
- `.opencorvus/expert-squads/wujiang/opentest/expert-squad.jsonc`
- `.opencorvus/expert-squads/wujiang/opentest/README.md`
- `.opencorvus/expert-squads/wujiang/opentest/agents/orchestrator/skills/workflow/SKILL.md`

### Repository-wide search inventory

- Expert-squad command: `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records` produced 2,808 matching lines.
- Mission/mailbox command: `rg -n "mission/wake|MissionRoutes|mailbox|recordMailboxMessage|listProjectMailbox|wait_for|dispatch_agent|report_.*result" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test` produced 1,270 matching lines.
- Relevant ownership clusters are strict package discovery/import/release in `expert-squad/registry.ts` and `manager.ts`; sole runtime projection in `prompt-profile-resolver.ts`; scheduling in `orchestrator/agent.ts` and `orchestrator/tools.ts`; Mission lifecycle in `mission/session.ts`, `server/routes/mission.ts`, and `session/wake.ts`; durable mailbox write/projection in `tool/send-mailbox-message.ts`, `engine/mailbox.ts`, and `server/routes/mailbox.ts`; overlay consumers in `packages/overlay/src/services/mission.ts` and `mailbox.ts`.
- Repository identities recalled from the landed audit are built-in `general` and project packages `frontend-innovate`, `frontend-replica`, `mirror-watch`, and `opentest`. This benchmark exercises `general` and the explicit transition to `opentest`; inactive packages must remain isolated.

### Independent-agent feedback

- None. The user requested unattended execution but did not request sub-agents or a parallel independent audit, and current collaboration policy does not authorize delegation.

### Initial environment evidence

- Git branch: `v0.0.9beta` at `01e9a8eed5` after fetching `myhexin`.
- Formal database exists at `C:/Users/chuan/.local/share/opencorvus/opencorvus.db` and was 36,032,512 bytes at recall time.
- No OpenCorvus/Bun listener was found on 7878 and no Vite listener was found on 5173 before startup.
- The worktree already contains unrelated staged and unstaged changes, including the v0.0.9 beta version line and Artificial Intelligence Software Development Kit adapter work. They are not benchmark changes and must not be overwritten or included in benchmark commits.

## Benchmark execution plan

1. Add a reusable long-Mission harness that scaffolds but never deletes the persistent System Under Test, calls the real `/mission/wake` and `/mailbox` routes, records canonical mailbox snapshots, and applies a true mailbox-inactivity timeout.
2. Add focused harness tests proving persistent-directory preservation, exact prompt/profile submission, canonical mailbox-only progress detection, inactivity reset, and honest rejected verdicts.
3. Start the dev backend on 7878 against the formal database and Vite on 5173. Inspect startup output only for readiness or startup failure, then stop reading logs during Mission progress.
4. Create the task-C Mission under the General squad. Drive it only from mailbox messages: acknowledge information, answer genuine attention requests, resume a settled incomplete Mission, or repair a proven defect and restart only the benchmark-owned process when required.
5. For each failure, reconstruct mailbox chronology and authoritative session/task/database/code evidence before classification. Add the correct regression test, repair the owning infrastructure or squad package without fallback or task-specific gates, commit with `dsw-33987`, push to `myhexin`, restart only owned processes if code reload is required, and rerun.
6. Require the Mission to select MirrorTest explicitly for final acceptance. Validate package projection and artifacts through Registry/Manager/Resolver and MirrorTest protocol/runner paths.
7. Run focused tests, relevant full suites, TypeScript checks, API/document health checks, and `git diff --check` for every touched surface.
8. Open the real generated application with Node Playwright, capture and personally inspect desktop screenshots and interaction states, repair and recapture until accepted.
9. Perform a final adversarial code/data/API/realtime/browser review independent of the Mission claims. Mark the goal complete only when the full matrix passes and no unexplained anomaly remains.

## Current status

- Recall and benchmark definition complete.
- The one-off long-Mission harness was later retired from the platform repository after the benchmark completed.
- The one-off Mission input was later retired; this record preserves the historical requirement and evidence.
- Harness regression: 7 passed, 0 failed, including canonical-mailbox inactivity reset, watcher reconnect preservation, and non-destructive persistent project preparation.
- Historical document links: 21 passed, 0 failed.
- `packages/opencorvus` TypeScript typecheck: passed.
- `git diff --check`: passed.
- Dev backend PID 24540 and Vite PID 3360 are owned by this benchmark; readiness and formal database identity were verified once.
- Mission `1ca1f63e7a01df7d`, session `ses_08ea47b6dffeTb0mDUbw5eqWIl`, is active in the persistent System Under Test directory.
- Research and bootstrap planning are terminal; Phase 03 backend/data implementation is active.

## Iteration 2 — watcher restart must not extend inactivity

### Evidence and classification

- The first watcher process was ended by the shell command's 30-minute wall-time ceiling after canonical mailbox activity had occurred. A reconnect loaded the already-seen mailbox page and treated that initial snapshot as new activity.
- Classification: benchmark harness defect. OpenCorvus remained healthy and the durable mailbox transcript contained two valid `task.completed` events; no infrastructure or squad failure is implied by the observer defect.

### Repair design

- Derive the inactivity baseline from the persisted Mission `createdAt` and the maximum canonical mailbox item `createdAt`.
- On watcher startup, seed the fingerprint at that authoritative timestamp instead of `Date.now()`.
- Reset only when a later canonical page fingerprint appears, using that page's maximum item timestamp. A process reconnect therefore cannot extend the deadline.
- Add regression coverage for restart-after-expiry, empty-mailbox Mission baselines, and invalid persisted time rejection.

### Repair validation

- Harness regression: 7 passed, 0 failed.
- `packages/opencorvus` TypeScript typecheck: passed.
- Reconnected watcher expired against the original latest mailbox timestamp instead of extending the deadline.

## Iteration 3 — Mission dropped the mailbox observability contract

### Scheduler-message chronology

1. Mission `1ca1f63e7a01df7d` created research and bootstrap-planning tasks. The canonical mailbox recorded both `task.completed` events.
2. Mission created Phase 03 task `tsk_f71707397001dloh6dBC6crVQP` after research was terminal. The task persisted four dependency-ordered Goals.
3. The first Goal dispatched implementation worker `ses_08e8433b7ffeC7R69I440FJo7h`, which performed real reads, edits, dependency installation, start/typecheck verification, commit, and typed build reporting without tool error.
4. No Phase 03 progress mailbox message arrived for 15 minutes, so the benchmark correctly raised mailbox inactivity.
5. A bounded public snapshot showed the task and worker were still healthy/running, contradicting a scheduler-stall hypothesis. The later canonical `goal.passed` event confirmed lifecycle and mailbox projection were functioning.

### Durable database evidence and classification

- Backend: `http://127.0.0.1:7878`; formal database: `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; snapshot: 2026-07-18 03:11:46 +08:00.
- Phase 03 task root session: `ses_08e8f8c64ffeKIORhDuRJ9zEBP`; task Orchestrator session: `ses_08e8f86e9ffeVkm6VbfpH4YA2h`; first implementation session: `ses_08e8433b7ffeC7R69I440FJo7h`.
- The Phase 03 request contained an `Original user input` section but contained neither `mailbox` nor `send_mailbox_message`.
- The worker's persisted parts contained real `todowrite`, `glob`, `read`, `bash`, `apply_patch`, `edit`, and `report_build_result` calls, no failed tool call, and no `send_mailbox_message` call.
- Classification: Mission coordinator prompt-contract fidelity defect affecting General squad observability, not agent scheduling infrastructure. The active task, Goal dependency graph, worker streaming, typed report, `goal.passed`, and mailbox projection were all healthy.

### Causal chain

1. Observable symptom: canonical mailbox had no Phase 03 progress for the configured 15-minute inactivity window.
2. Direct trigger: the active worker never called its projected `send_mailbox_message` tool.
3. Deep cause: the Mission-generated self-contained task brief omitted the operator's explicit mailbox execution contract, even though the executor cannot read Mission state. The existing prompt described scope/acceptance/warnings as task-relevant but did not explicitly classify progress/evidence/notification channel requirements that way.
4. Why scheduling did not recover: no scheduling failure existed to recover from; work continued normally and only became visible at the canonical Goal terminal event.

### Repair design

- Strengthen `mission-core.txt` at the prompt boundary: operator-specified execution/observability channels are task-relevant and must be preserved in every affected `create_task.request` with exact worker behavior.
- Do not add a host validator, keyword matcher, forced mailbox call, workflow gate, task-specific branch, or synthetic progress event.
- Add a Mission prompt regression asserting this generic constraint-preservation contract.
- Let the current Phase 03 task finish without restart. Apply the repaired prompt to future Mission wakes only after a safe owned-backend restart, then send a natural Mission follow-up so later task briefs carry the contract.

### Repair validation

- Mission prompt, prompt hygiene, and long-Mission harness suites: 18 passed, 0 failed, 161 expectations.
- `packages/opencorvus` TypeScript typecheck: passed.
- `git diff --check`: passed.

## Iteration 1 — explicit Mission model input

### Evidence and classification

- Backend and Vite started successfully on the owned ports. `/global/health` returned `healthy=true`, `version=local`, and database path `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; Vite returned HTTP 200.
- The first `/mission/wake` attempt returned HTTP 400 `MissingModelConfigError`: no model was configured for agent `mission`. No Mission ID or session was created and no benchmark state file exists.
- Classification: benchmark setup defect, not infrastructure scheduling and not squad functionality. The server correctly rejected an incomplete input before scheduling; there is no dispatch/session/mailbox failure evidence.
- Current local provider evidence identifies the explicitly configured benchmark-capable model as `hexin/gpt-5.4-mini` (`HEXIN_MODEL=gpt-5.4-mini`, and landed runtime evidence uses provider ID `hexin`).

### Repair design

- Make model identity an explicit required harness input and persist it beside Mission/session identity.
- Submit the exact model in the initial `/mission/wake` body together with `promptProfile=general`; do not infer, choose, or fallback to a model inside the harness.
- Keep resume free of a model/profile patch so it preserves the Mission's current explicit configuration and later `opentest` selection.
- Add a pure payload regression proving the initial wake includes the exact model/profile/text and the resume payload does not overwrite either configuration field.

### Repair validation

- Harness regression: 5 passed, 0 failed; the added case proves the exact `provider/model` requirement, initial `general` profile, and resume preservation behavior.
- `packages/opencorvus` TypeScript typecheck: passed.
- `git diff --check`: passed.

## Iteration 4 — terminal refill no-decision self-wake amplification

### Scheduler-message chronology

1. Goal run `762cbae9` and worker session `ses_08e8433b7ffeC7R69I440FJo7h` reached terminal success at 2026-07-18 03:12:43 +08:00; canonical `goal.passed` followed at 03:12:45.
2. Runtime recorded exactly one `goal_refill_notification` (`art_f717ed54b001dtjLmM6REdp5ji`) with `terminal_goal_run.status=completed`, no live siblings, and `dispatch_result=started`.
3. The refill wake repeatedly emitted status-only assistant text claiming the completed scaffold worker was still live. Each stop produced an `orchestrator-decision-contract-failure` and another recovery wake.
4. The formal database contains 80 decision-contract-failure artifacts between 03:12:55 and 03:24:51, but only one refill notification and no queued external wake amplification.
5. The 80th recovery wake called `wait` for 20 minutes using the already-terminal worker as its alleged external blocker. The durable cron job is `crn_f718a03f3001PIGZhL6DpocqA9`, due at 03:44:58.

### Classification and causal chain

- Classification: generic scheduler prompt-context stability defect. Product implementation and the General squad worker completed successfully; the failure is in the common Orchestrator's interpretation of a terminal refill wake.
- Observable symptom: 80 recovery wakes consumed model turns without dispatching the now-eligible dependent goal.
- Direct trigger: every recovery turn stopped with status-only prose, so the existing no-decision contract recorded a failure and self-woke again.
- Deep cause: historical assistant prose claiming the child was live remained in the visible conversation and outweighed the current structured Goal, Collaboration Closure, and Terminal Refill sections. The prompt said to read current state but did not explicitly define conflict precedence or forbid reusing failure-reason prose as current state.
- Why the previous mechanism did not root-cause it: the no-decision artifact correctly detected each invalid stop, but its recovery text only requested another decision. It did not tell the model that the quoted prior assistant status was historical and non-authoritative, so the same stale claim reproduced the same failure.

### Repository-wide call inventory and repair design

- `orchestrator/agent.ts::classifyOrchestratorDecisionStop` detects the invalid stop and `recordOrchestratorSessionErrorEnvelope` dispatches the recovery wake. These mechanisms remain unchanged; adding a host counter, fuse, state gate, or keyword route would hide the decision error rather than repair it.
- `orchestrator/event.ts::OrchestratorEventNote.noDecisionRecovery` supplies wake provenance, while `engine/describe.ts::renderTaskDescription` renders the durable failure artifacts, current Goal graph, Collaboration Closure, and Terminal Refill facts. The rendered current snapshot remains the single decision evidence source.
- `prompt/core/orchestrator-core.txt` is the common scheduler instruction surface for every squad. It will explicitly rank the current structured snapshot above historical assistant prose and require terminal refill/current dispatchability to drive a real tool decision.
- `engine/describe.ts` will state that the failure reason quotes historical assistant output for audit only and cannot establish current goal/session state.
- Regression coverage will extend the existing no-decision render test and core prompt tests. It must prove current-state precedence and prohibit treating a terminal refill's named goal run as live, without adding task-specific terms or host routing.

### Repair validation

- Focused no-decision, prompt, terminal-refill, describe, prompt-hygiene, and benchmark regressions: 74 passed, 0 failed when run by database-safe file groups.
- The focused run exposed a stale test fixture whose assistant message omitted the schema-required `author`; the fixture was repaired and its three open-tool ownership cases now pass.
- `packages/opencorvus` TypeScript typecheck: passed.
- Historical document links: 21 passed, 0 failed.
- `git diff --check`: passed.

### Live application and recovery evidence

- Repair commit `508222655d` passed the full pre-push hook and was pushed to `myhexin/v0.0.9beta`.
- The benchmark-owned backend was replaced from PID 24540 to PID 22220; the restarted health endpoint remained `healthy=true` against `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`. Vite and unrelated processes were not restarted.
- Operational error: the last pre-stop snapshot showed no active child worker, but the old Orchestrator dispatched goal 2 during the short interval between that snapshot and process stop. The restart therefore interrupted newly-created worker `ses_08e61b0dcffe2pfpP0MpnVRXCp` / goal run `c60ac84d`. This interruption is not attributed to the product squad or scheduler.
- Startup recovery recorded `server_restart_active_task_recovered`, marked only the dead-owner attempt aborted with reason `Directory queue: previous owner process died before interruption`, and preserved the task record as active with no task error.
- The repaired Orchestrator consumed current state, created retry run `run_f71a0e0ee001e1cragyaxWvOpT`, superseded `c60ac84d`, and dispatched replacement worker `ses_08e5f1e22ffeO1kyuMKYzohIa1` / goal run `6045cc46` for the same goal. Canonical mailbox retained the old attempt's `goal.failed` event as visible evidence.

## Iteration 5 — concurrent benchmark watchers duplicated transcript evidence

### Evidence and classification

- Canonical mailbox event `pev_f71a8bc0b001N5T3EB3jl0IMav` existed once, while the benchmark transcript contained eight byte-equivalent copies of that ID.
- Process inspection found 16 benchmark-owned Bun processes running `crypto-trading-long-mission.ts watch`, created between 03:50:47 and 04:06:57. Each parent shell had already returned after its bounded execution window, but the Bun child remained alive.
- Every watcher loaded the same pre-event `seen` snapshot. When the new canonical event arrived, multiple processes independently passed `unseenMailboxItems` before any process refreshed its in-memory set, then appended the same event.
- Classification: benchmark observer/tooling defect and operator launch error, not OpenCorvus infrastructure and not expert-squad behavior. The canonical mailbox, Goal lifecycle, and Mission product work each emitted one event.
- All 16 exact benchmark watcher processes were stopped. Backend PID 22220, Vite, Mission records, task records, and the persistent project were left running and untouched.

### Repository-wide call inventory and repair design

- `appendMailboxItems` is called only by `watchMailbox` and the `poll` command in `packages/opencorvus/script/benchmark/crypto-trading-long-mission.ts`; `readSeenMailboxIDs` is used by those same two paths.
- Replace their split read/filter/append sequence with one transcript transaction protected by the repository's existing `proper-lockfile` dependency. Under that lock, reload persisted IDs, filter by canonical event ID, append only the remaining events, and return exactly the events recorded by that transaction.
- Add an explicit repair operation that holds the same lock, parses every transcript record strictly, preserves the first occurrence and original order for each event ID, atomically replaces the polluted file, and reports the removed duplicate count. Malformed evidence remains an error; there is no permissive fallback.
- Add regressions for concurrent recording and deterministic duplicate repair. Subsequent unattended observation uses one-shot `poll` on timer wakeups, not long-lived watchers. The existing `watch` command is not deleted in this iteration because project rule 17 requires user approval before deleting obsolete logic.

### Repair validation

- Focused harness regression: 9 passed, 0 failed, including eight concurrent writers for one canonical event and deterministic first-occurrence repair.
- `packages/opencorvus` TypeScript typecheck: passed.
- `git diff --check`: passed.
- The explicit repair strictly parsed the real transcript, removed seven duplicate copies, and left five records with five unique canonical event IDs.
- A following one-shot poll appended no duplicate. At the validation instant the latest canonical event was 13.6 minutes old, below the declared 15-minute mailbox-inactivity threshold.

## Iteration 6 — dead-owner convergence rewrote completed sibling sessions

### Scheduler and database chronology

1. The Phase 03 requirement session `ses_08e8cf10dffdpThL2OlKN4S9lB` durably emitted `terminal completed` at 03:01:44.530.
2. The architecture session `ses_08e8a2a11ffdoESR47SsHKwhe7` durably emitted `terminal completed` at 03:09:14.131.
3. The scaffold worker `ses_08e8433b7ffeC7R69I440FJo7h` durably emitted `terminal completed` at 03:12:43.332 and its Goal remained `passed`.
4. The owned backend restart interrupted only the newly-dispatched goal-2 worker `ses_08e61b0dcffe2pfpP0MpnVRXCp`, whose goal run still belonged to the dead process.
5. At 03:49:12.548–03:49:12.670, directory-queue dead-owner convergence appended `terminal aborted` with `Directory queue: previous owner process died before interruption` for the orphan worker, all three already-completed sibling sessions, and the task root session.
6. The 15-minute mailbox-inactivity snapshot later showed goal 3 worker `ses_08e531930ffeQITXrTzFP523gV` actively streaming at 04:14:02.288. The Mission was healthy; restart or retry was not justified.

### Classification and causal chain

- Classification: generic infrastructure lifecycle-persistence defect, not General squad functionality. The affected completed outputs and Goal states were valid; only common dead-owner session projection was corrupted.
- Observable symptom: the public Mission/Task invocation graph displayed previously successful requirements, architecture, and scaffold sessions as aborted while their Goals and artifacts remained successful.
- Direct trigger: `advanceQueue` called `convergeDeadOwnerActiveTasksForCwd`, which selected one orphan goal run and delegated to `abortDeadOwnerLiveExecutionForTasks`.
- Deep cause: after aborting the selected goal/run rows, `abortDeadOwnerLiveExecutionForTasks` called `terminateTaskOwnedSessionsAndMarkInterrupted`. That helper is an explicit whole-Task cleanup primitive: it traverses the task root's entire session tree and calls `terminateSessionPromptInScope` for every row. After process restart, the in-memory `SessionStatus` latch no longer contained historical terminal states, so those durable completed siblings appeared idle to the helper and received new aborted events.
- Why existing guards did not protect history: `SessionStatus.set` prevents a second terminal only inside one process lifetime. The durable protocol-event history already proved completion, but the dead-owner path selected scope from the whole Task tree instead of the orphan goal run's persisted `session_id`.

### Repository-wide call inventory and repair design

- `terminateTaskOwnedSessionsAndMarkInterrupted` has three call sites in `engine/writer.ts`: project-wide active Task shutdown, current-process shutdown, and dead-owner goal-run convergence. The first two intentionally own whole-Task settlement; only the third has narrower orphan execution scope.
- `abortDeadOwnerLiveExecutionForTasks` is installed as the queue termination runtime by `project/bootstrap.ts` and production-shaped Gateway/queue tests. `engine/queue.ts` is its sole production caller through `ExecutionTerminationRuntime.convergeDeadOwnerTasks`.
- Split physical session-tree termination from Task semantic interruption. Whole-Task shutdown callers continue to pass the task root. Dead-owner convergence passes only the distinct non-null `session_id` values on the orphan goal runs and marks the Task interrupted without traversing unrelated siblings.
- Preserve strict goal/run abortion and queue-finalization behavior. Do not hydrate process-local latches, infer status from titles, add a recovery gate, or suppress lifecycle events by error text.
- Extend the real queue-convergence regression with one task root containing a durably completed sibling and a streaming orphan worker. The queued sibling must start, the orphan goal/run and worker must become aborted, and the completed sibling must retain completed as its latest durable status.

### Repair validation

- The queue convergence suite passed 34/34. Its dead-owner case now carries a task root, a durable `terminal completed` sibling, and a streaming orphan worker; queue advance aborts only the orphan goal/run/session and preserves the completed sibling plus task root.
- Explicit whole-Task shutdown coverage passed 3/3, proving the narrower recovery scope did not weaken project/process shutdown ownership.
- Startup orphan inspection passed 12/12 after repairing a stale assistant-message fixture that omitted the schema-required `author`. The original failure was test data, not production behavior.
- Gateway production assembly passed 18/18; execution-termination runtime and dependency-boundary coverage passed 18/18.
- `packages/opencorvus` TypeScript typecheck and `git diff --check` passed.
- While this repair was under test, canonical mailbox event `pev_f71bbeebb0017n4xtGIyzqYohc` reported goal 3, `Fastify market, trading, and WebSocket backend`, passed at 04:19:29.595. Transcript state remained one row per canonical event ID.

## Iteration 7 — Phase 01–03 squad delivery review rejects the backend foundation

### Evidence and classification

- Classification: General squad functional-quality failure, not infrastructure. Scheduling, sessions, commits, Goal terminalization, and mailbox delivery all operated; the produced implementation does not satisfy the Mission contract.
- Git history contains Phase 01 and Phase 03 checkpoints plus three implementation commits, but the complete tracked tree contains no competitor research, product-design, route map, API/realtime contract, risk register, or page-to-API/event/table/component dependency artifact. The two Phase 01/02 `task.completed` claims therefore do not yield project-verifiable deliverables.
- `prisma/schema.prisma` and `prisma/migrations/0001_initial/migration.sql` declare PostgreSQL tables, but no package depends on `@prisma/client`, Prisma CLI, `pg`, or another PostgreSQL client. No runtime call site uses `DATABASE_URL`, `PrismaClient`, SQL, or a repository backed by PostgreSQL.
- `scripts/init/rebuild-persistence.ts` and `scripts/seed/market-seed.ts` only construct JavaScript objects and print summaries/JSON. They never initialize or seed a database.
- `apps/api/src/server.ts::createApp` always calls `createRuntimeState`; every market/account/order route reads and mutates that in-memory object. The integration test explicitly compares HTTP output with the same in-process `runtime.state`, so its green result proves shared memory, not persistence.
- Order submission fills every market order immediately and leaves every limit order `NEW`; it has no quantity-aware book sweep, partial-fill path, balance freeze/release, slippage model, insufficient-funds rejection, ownership check, or negative-balance prevention. Fee is `quantity * 0.0001`, independent of execution notional, and balance mutation can cross below zero.
- The WebSocket route sends one prebuilt snapshot and only request-response acknowledgements for pause/resume/subscribe. There is no ongoing ticker/candle/book/trade producer or fan-out, so it is not realtime delivery.
- Fastify routes have no declared request/response schemas and rely on shallow manual checks. Watchlist, alert, audit, diagnostics, and simulator-control APIs are absent even though seed objects/schema names exist.
- The generator produces deterministic multi-pair/timeframe arrays, but it does not model or label the required trend, range, wick, volume-spike, gap, extreme-volatility, and low-liquidity regimes. Existing tests only assert deterministic equality/counts and cannot prove those regimes.

### Required squad remediation before frontend work

- Preserve the research and technical-design deliverables as tracked project artifacts, including all ten named competitors and the complete dependency matrix.
- Replace the in-memory backend source with one PostgreSQL repository/runtime path. Initialization and seed commands must execute against the configured local PostgreSQL database and tests must inspect persisted rows across process boundaries.
- Implement the real matching/accounting chain with market/limit/cancel/partial fill, book liquidity, fee/slippage, freeze/release, fill reports, order transitions, ownership, insufficient-funds rejection, non-negative balances, positions, and audit records in one transaction model.
- Produce continuous deterministic market events and WebSocket fan-out with resumable sequencing, subscription filtering, pause/resume, and disconnect/reconnect tests.
- Add strict route schemas and the missing account/watchlist/alert/diagnostic/simulator surfaces. Replace contract-string/unit-only tests with database/API/WebSocket integration tests that exercise the actual runtime.
- Do not proceed to frontend implementation against the rejected in-memory contract. Once Phase 03 reaches a terminal mailbox event, resume the Mission with this evidence and require a corrected backend/data task before Phase 04.

### Live rejection and correction wake

- Goal 4 emitted canonical `goal.passed` event `pev_f71c259df001WXv569VJ0a4ExH` at 04:26:30.239, followed by Phase 03 `task.completed` event `pev_f71c474060016pBY3bPfvefQbs` at 04:28:48.005.
- The terminal Task summary claimed that Prisma/PostgreSQL persistence was in place. This directly contradicts the dependency and runtime call inventory above and is rejected evidence, not an accepted variance.
- At 04:29:38, the benchmark sent a real Mission resume message on the same Mission/session. It prohibited frontend dispatch, supplied the exact rejection evidence, required tracked research/design artifacts, one real project-managed persistent PostgreSQL path, complete matching/accounting, continuous realtime fan-out, strict schemas/missing APIs/explicit regimes, and process-boundary integration tests.
- The resume preserved Mission `1ca1f63e7a01df7d`, session `ses_08ea47b6dffeTb0mDUbw5eqWIl`, and model `hexin/gpt-5.4-mini`; it did not patch the active expert squad or create a second Mission.
- Causality check: Phase 04 frontend Task `tsk_f71c4ff110018RNmV563z7Y3UO` was created at 04:29:23.601, 15.217 seconds before the operator rejection entered the Mission at 04:29:38.818. Its initial creation therefore cannot be classified as ignoring the correction.
- After consuming the rejection, the Mission cancelled that frontend Task at 04:31:10.287. Canonical mailbox event `pev_f71c69fd2001pdr3gN1AuaLUPY` exposed the cancellation. No frontend implementation commit was produced, and the Mission remained streaming while deciding the corrective work.

## Iteration 8 — corrective backend scope clarification

### Mailbox chronology and response

- The Mission created two separate corrective Tasks: Phase 05 owns durable research/design artifacts, while Phase 06 owns the backend runtime correction. Both briefs preserve the canonical mailbox-only progress contract and prohibit frontend implementation before correction acceptance.
- Phase 06 emitted canonical `interaction.requested` event `pev_f71d1130d001JIZiaQrnj2bui2` for interaction `int_f71d1130b001phECa6q0w4DKHT`. The question asked whether the Task should own only PostgreSQL persistence or the complete correction set already enumerated in its brief.
- The operator answered the existing interaction with `full-backend-set`. The durable response is `answers=[["full-backend-set"]]`; the interaction is now `answered` and retains the same Task and session identity.
- The binding scope therefore remains: real persistent PostgreSQL, complete matching/accounting, continuous realtime fan-out, strict and missing APIs, explicit deterministic market regimes, and database/API/WebSocket integration tests. Frontend work remains blocked until the entire set passes.

### Classification

- Classification: valid General-squad clarification, not an infrastructure failure. The Task brief contained the complete scope, the interaction was surfaced through canonical mailbox attention, project-scoped route validation rejected a request without directory identity, and the corrected structured reply resumed the same Task.
- Choosing persistence-only would have silently reduced the already explicit correction contract. No infrastructure route, gate, fallback, or cryptocurrency-specific scheduler behavior was added; the operator resolved the product-task ambiguity through the existing natural interaction protocol.

## Iteration 9 — Phase 05 durable artifacts fail independent completeness review

### Evidence and classification

- Phase 05 emitted canonical `task.completed` event `pev_f71d400f6001yBhiOolmk4z5Pv` and produced commit `f4b9794`. Six tracked files now exist under the single durable path `docs/mission/phase-05/`; this repairs the earlier absence of inspectable artifacts but does not by itself satisfy their content contract.
- Classification: General-squad product/design quality failure, not infrastructure. Task dispatch, repository writes, commit capture, terminalization, and mailbox delivery all succeeded. The independent rejection concerns the content generated by the squad.
- The REST and dependency matrices omit watchlist, alert, audit, diagnostics, and simulator-control surfaces. The page matrix also omits the required watchlist/alerts and diagnostics/simulator pages, and it does not map mature chart/table/form libraries or Moving Average (MA), Exponential Moving Average (EMA), Moving Average Convergence Divergence (MACD), Relative Strength Index (RSI), and Bollinger calculations.
- The deterministic-generator section describes source layers but none of the required trend, range, wick, volume-spike, gap, extreme-volatility, or low-liquidity regimes.
- The matching/accounting section does not specify book-liquidity partial fills, fee/slippage equations, balance freeze/release, transaction boundaries, order transitions, ownership, insufficient-funds rejection, non-negative invariants, position reconciliation, or audit facts. Its probabilistic limit-fill wording also conflicts with the deterministic contract.
- The WebSocket section remains centered on snapshot and acknowledgement messages; it does not define continuous producer cadence, sequencing/resume behavior, subscription filtering, backpressure, disconnect/reconnect, or account/order/fill updates.
- The test section is a short list of test names without declared performance workloads and thresholds, security boundaries, ownership/error-leakage cases, accounting/time-series reconciliation, or real-browser visual/keyboard/focus acceptance.
- Competitor rows contain generic observations and a separate URL list, but material comparisons and adopted/rejected decisions are not traced to inspected source evidence.

### Corrective wake

- The operator resumed the same Mission/session at 04:48:12 +08:00 with the exact gaps above. The wake requires in-place repair of `docs/mission/phase-05/` as the single source, keeps frontend blocked, preserves Phase 06 ownership of backend implementation, and retains canonical mailbox-only reporting.
- No infrastructure rule or task-specific scheduler branch was added. The durable Task completion remains visible as rejected evidence, and a following correction must be independently reread rather than accepted from its summary.

## Iteration 10 — Mission checkpoints overwrote tracked observer evidence

### Evidence and classification

- After Phase 07 began, a one-shot poll unexpectedly emitted its three already-recorded mailbox events again. Canonical mailbox still contained one event per ID and no benchmark watcher process existed.
- The System Under Test repository tracked both `.opencorvus/benchmark/crypto-trading-task-c.json` and `.opencorvus/benchmark/mailbox.jsonl`. Git history proves Mission checkpoint commits repeatedly captured those files, including `9e33d7a` immediately before Phase 07.
- Phase 07's product commit restored the tracked transcript to the checkpoint's twelve-event version while the observer had already appended three newer events in the working tree. The next poll therefore saw those canonical IDs as unseen and emitted them again. The later Phase 07 completion commit also included benchmark state/transcript changes, confirming that product and observer ownership were mixed.
- Classification: benchmark observer persistence defect, not OpenCorvus mailbox/scheduler infrastructure and not squad functionality. The first observer repair serialized concurrent writers correctly, but serialization cannot protect a tracked file from Git checkout/commit reconciliation performed by the System Under Test.

### Repository-wide inventory and repair

- `benchmarkStatePath` and `mailboxTranscriptPath` are the only path authorities; all state reads/writes and transcript lock/read/append/repair operations use them. `preparePersistentProject` owns creation of their parent directory.
- Move both authorities from the product worktree to `.git/opencorvus-benchmark/`. This Git metadata location is persistent and project-specific but cannot be staged, committed, checked out, or overwritten by Mission product workflows.
- There is no legacy read path or automatic compatibility lookup. The active run receives one explicit migration: copy its exact Mission identity state and twelve unique transcript records to the new authority, then refill missing events from canonical mailbox.
- The post-migration transcript contains sixteen lines with sixteen unique event IDs, including all Phase 07 events and its completion. An immediate second one-shot poll emits nothing.

### Validation

- Benchmark harness regression: 9 passed, 0 failed. Path coverage now proves both artifacts live under `.git/opencorvus-benchmark/` and the old worktree directory is not created for a fresh persistent project.
- `packages/opencorvus` TypeScript typecheck passed.
- `git diff --check` passed.

## Iteration 11 — Phase 07 partial acceptance and Phase 06 mailbox silence

### Phase 07 independent review

- Phase 07 emitted canonical `task.completed` event `pev_f71de4cb2001Sy9lU6cjmyRimr` and updated the original `docs/mission/phase-05/` bundle in place. It materially added the missing support surfaces, seven generator regimes, matching/accounting invariants, continuous realtime semantics, mature-component categories, indicator mappings, performance/security/consistency/visual checks, and per-competitor source pointers.
- Independent review retains those improvements but does not yet accept the design contract. REST and WebSocket sections name routes/events without concrete request, success-response, error-response, and event payload schemas. Initial snapshot language is inconsistent across documents, and the shared event sentence incorrectly implies that account-only events require `pairSymbol`.
- The implementation map still leaves alternatives (`ECharts or TradingView Lightweight Charts`, analytics module `or equivalent`) instead of selecting one executable source. Its performance section also says `local mock paths`, which conflicts with the real local runtime acceptance boundary.
- Classification: remaining General-squad design quality gaps, not infrastructure. At 05:02:23 +08:00 the operator resumed the same Mission/session with only these two bounded in-place corrections, preserved Phase 06, and kept frontend blocked.

### Phase 06 bounded inactivity inspection

- Phase 06 exceeded fifteen minutes since its last canonical mailbox message, so the observer performed one bounded authoritative Task-status inspection rather than reading process logs.
- The Task was active, the source-investigator and requirement-engineer sessions had completed, and solution-architect session `ses_08e266e5bffewmR9XGAHkBZ31W` was streaming with fresh activity at `1784322071787`. The Task was not stuck and restart was not justified.
- The missing milestone messages violate the Phase 06 brief's mailbox-only progress contract. Because Phase 07 delivered canonical mailbox messages during the same backend lifetime, there is no evidence of mailbox infrastructure loss. Classification: Phase 06 General-squad progress-reporting defect.
- A natural Task injection reminded the existing active Orchestrator to continue without restart, restore canonical mailbox milestones, preserve the full backend correction scope, and keep frontend blocked. The result was `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, `status=active`.

### Phase 08 documentation acceptance

- The Mission created Phase 08 against the same authoritative `docs/mission/phase-05/` path. Canonical event `pev_f71ede12b001bl2oyLsQSX6ygp` reported completion after in-place updates to `contracts-and-schema.md`, `implementation-map.md`, and `phase-05-bundle.md`.
- Independent diff review confirms concrete REST success/error/list envelopes, route request/response types, cursor pagination, account identity semantics, WebSocket client/server/event types, monotonic sequence/cursor recovery, consistent initial market/account snapshots, and account-only events without a required `pairSymbol`.
- The implementation map now selects TradingView Lightweight Charts, TanStack Table, React Hook Form with Zod, and one `packages/analytics` calculation owner with exact indicator module paths. Performance acceptance now names the real local API/runtime rather than mock paths.
- Phase 05/07/08 design artifacts are accepted as the implementation contract. This is documentation acceptance only: Phase 06 must still prove the schemas, ownership model, persistence, matching, fan-out, and tests in the real runtime before frontend dispatch.

## Iteration 12 — Phase 06 shared embedded-PostgreSQL test identity

### Scheduler and tool chronology

1. Phase 06 goal `gol_f71e3afab002M5gaq7Lqb0KpgC` dispatched implementation session `ses_08e1c039fffej4p6w7uebN3dh8` to replace the in-memory runtime with project-managed PostgreSQL.
2. The worker successfully proved cross-process durability with `scripts/tests/postgres-persistence.test.ts`, but its first parallel validation round left `scripts/tests/integration-shared-backend-state.test.ts` running until the Bash tool's 1,200,000 millisecond timeout. Durable part `prt_f720f3a2a001zUnBJ5IopEnFdF` recorded exit 1 and the timeout metadata.
3. The worker attributed the surrounding failures to top-level `await`, embedded-PostgreSQL log output, and double stop. It wrapped three scripts in `main()`, silenced logs, and made stop idempotent, then launched the affected tests in parallel again.
4. In the second round, typecheck and cross-process persistence passed. Market, trading, and realtime tests each failed while initializing the same `.cache/persistent-postgres-runtime` directory (`target directory exists` or `Directory not empty`). Integration part `prt_f72228932001nRF6guLD2DO2Fl` again ran for 1,200,000 milliseconds and terminated by timeout.
5. Read-only process evidence during the first timeout showed the full Bash/pnpm/tsx process chain plus embedded PostgreSQL 18.1 running from the System Under Test dependency tree. After timeout, the process tree exited and the tool result persisted; scheduler ownership and tool-result delivery were intact.

### Causal chain and classification

- Observable symptom: Phase 06 remained streaming without canonical mailbox progress while integration validation consumed two twenty-minute timeouts.
- Direct trigger: each validation round launched multiple embedded-PostgreSQL consumers concurrently.
- Product/test-runtime cause: independent tests used one implicit default PostgreSQL data directory and runtime identity. Multiple `initdb` and server owners raced over the same durable directory, while the integration process remained attached until timeout.
- Why the first repair did not root-cause it: top-level-await compatibility, log parsing, and idempotent stop addressed adjacent symptoms but left the shared persistence identity unchanged, so the next parallel validation reproduced the same directory conflict and hang.
- Classification: General-squad backend/test-toolchain defect, not OpenCorvus scheduling infrastructure. The common scheduler dispatched once, persisted every tool call and timeout result, retained the same goal/session identity, and resumed the worker after each tool result.

### Required correction

- The operator injected the evidence into the existing Phase 06 Task. Each independent test must receive an explicit unique test-owned PostgreSQL data directory, port, and database identity. Only the cross-process persistence test may deliberately share its one test-owned directory between its child processes.
- The correction must be ownership/isolation at the storage boundary, not serial-test gating, retry, fallback, or weakened persistence. The same affected commands must run concurrently to prove the race is removed, and the Task must restore canonical mailbox milestones.

### Observer correction

- During the bounded wait, one operator poll command accidentally supplied two `--project` arguments. The harness correctly selected the first and recorded unrelated OpenCorvus-root mailbox events under `C:/Users/chuan/myhexin-local/opecorvus/.git/opencorvus-benchmark/mailbox.jsonl`.
- Those events were explicitly excluded from benchmark reasoning. The newly-created 11,558-byte file and its empty parent directory were path-validated and removed; no source file, formal database record, System Under Test evidence, or running process was changed. The correct project poll then emitted no event.

## Iteration 13 — Phase 06 integration runtime ownership leak

### Durable evidence and classification

- After the worker isolated independent tests by data directory, the market, trading, realtime, and cross-process persistence tests passed. The integration command remained the only non-terminating validation.
- Formal database part `prt_f7235adbb0013ypFcxK7pO2Kt0` records the third exact invocation of `scripts/tests/integration-shared-backend-state.test.ts`; it started at `1784327548347`, terminated at `1784328748748`, and again returned exit 1 only because the Bash tool enforced its 1,200,000 millisecond timeout.
- The test creates `runtime` with `createRuntimeState({ databaseDir })`, then calls `createApp({ databaseDir })`, whose implementation creates a second runtime internally against the same live PostgreSQL data directory. It later creates `deterministicRuntime` against that same directory while both earlier owners remain live.
- The `finally` block closes the application-owned runtime through Fastify's `onClose` hook and explicitly stops `runtime`, but never stops `deterministicRuntime`. Thus the test has both concurrent ownership of one PostgreSQL directory and an unclosed third runtime.
- Classification: General-squad integration-test and resource-lifecycle defect. The OpenCorvus scheduler dispatched one worker, kept the same Goal/session identity, durably recorded all three timeout results, and resumed normal decision handling after each result.

### Required correction

- Use the runtime returned by `createApp` as the single live application/database owner for API and state assertions. Do not create another embedded-PostgreSQL runtime concurrently over the same data directory.
- If the test needs restart-persistence evidence, close the current owner before reopening the same directory. Every explicitly created runtime must be stopped in `finally`.
- Keep validation parallel and persistent. Do not add a serial gate, retry, fallback, or in-memory substitute. The integration command must exit promptly, and its assertions must prove API/persisted behavior rather than equality between aliases of one in-memory object.
- This evidence was injected into the existing Phase 06 Task. The route returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; no task or process was restarted.

## Iteration 14 — PID-scoped production database defeats persistence

### Independent acceptance evidence

- Phase 06 commit `bb608f3` corrected the integration test to use the runtime returned by `createApp`; the exact integration command then passed independently and exited in 13,402 milliseconds instead of reaching a fourth twenty-minute timeout.
- The same commit changed the default database authority to `.cache/persistent-postgres-runtime/<seed>/<process.pid>`. `openPersistentDatabase` uses this path whenever its caller does not inject `databaseDir`.
- A normal backend restart changes the process identifier and therefore silently selects a new PostgreSQL cluster. The implementation cannot preserve application data across process restarts through its production default.
- The cross-process test appears green because its parent computes one PID-scoped path and passes that exact string to the child. It proves explicit-directory reuse, but it does not prove that two processes deriving the project default select the same database.
- The integration test also calls the exported in-memory `submitOrder(runtime.state, ...)` path after its API assertions. That mutation bypasses PostgreSQL and is not valid persistence-integration evidence.

### Classification and required correction

- Classification: General-squad product/test-boundary defect. The worker solved parallel-test ownership by changing production identity, overfitting the runtime to the test conflict; OpenCorvus scheduling and mailbox infrastructure are not implicated.
- Restore one stable project-owned default directory independent of process identifier. Parallel tests must obtain isolation only through explicitly injected unique temporary roots; the persistence test alone deliberately reuses one explicit directory after the first owner stops.
- Add executable evidence that two sequential processes independently deriving the default from the same project root resolve the same directory and observe the same persisted row. Remove or replace the direct in-memory mutation in the integration test with an API/database assertion.
- The rejection was injected into the existing Phase 06 Task after the independent 13.4-second run. The route returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; the PostgreSQL Goal remains unaccepted.

## Iteration 15 — retry preserved PID identity and added a process-local gate

### Retry review

- Generic scheduler recovery retained the first terminal attempt and dispatched retry worker `ses_08db40e46ffeKDoqTN33FmIOwL` for the same PostgreSQL Goal. Canonical mailbox later exposed a second `goal.passed` event.
- Retry commit `d6725cc` did not remove `process.pid` from `getPersistentDatabaseDir`; production still derives a new database directory after every restart.
- The commit added `activeDatabaseDirs`, a process-local `Map` that rejects a second owner in the same process. It cannot detect another process using the directory and is a host gate rather than a storage-boundary fix.
- Its failed-start cleanup catches and discards `pg.stop()` failure under the explicit comment `Best-effort cleanup after failed startup`. This is forbidden fallback behavior and hides cleanup evidence.
- The commit changed only `packages/db/src/runtime.ts` and the integration script. It did not add the requested regression in which two sequential processes independently derive the same project default and observe the same persisted row.

### Classification and next correction

- Classification remains General-squad implementation and acceptance-discipline failure. The common scheduler correctly created a retry after operator rejection; the retry worker then reported success without satisfying the explicit root-cause contract.
- The second terminal claim is rejected. The existing Task received exact line-level correction: stable PID-independent default, no process-local gate, no swallowed cleanup error, explicit unique test directories, and a child process that independently derives the same default rather than receiving a parent-computed path.
- The injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`. No product or OpenCorvus process was restarted.

## Iteration 16 — stable production default exposes three unisolated tests

### Third retry review and concurrent validation

- Third retry commit `e2185f6` removed the PID suffix, process-local directory gate, and swallowed cleanup error. The production default is now the stable project-owned `.cache/persistent-postgres-runtime/<seed>` path.
- Both the persistence and shared-backend scripts now have explicit temporary roots, and their child processes independently call `getPersistentDatabaseDir` with the same root and seed. This satisfies the requested default-derivation shape.
- Independent concurrent execution of five affected commands produced two passes: cross-process PostgreSQL persistence in 16,061 milliseconds and shared-backend integration in 16,710 milliseconds.
- `market-api-contract`, `trading-api-contract`, and `realtime-resume` each failed after roughly one second. Source inspection proves all three still call `createRuntimeState()` without `databaseDir`, so parallel `initdb` processes race on the correct stable production default and report that the directory exists but is not empty.

### Classification and correction

- Classification remains General-squad test-resource ownership failure. Stable application persistence is now correct; the remaining conflict is caused by three independent tests failing to inject their own temporary PostgreSQL directories.
- The next correction is deliberately narrow: each test must create and inject a unique temporary directory, after which all five original commands must pass concurrently. Production identity must not change, and no serial gate, retry, fallback, or PID path may be reintroduced.
- The evidence was injected into the existing Task, which returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`. The later backend-integration Goal still owns replacement of these weak direct-memory contract assertions with real runtime coverage.

## Iteration 17 — fourth retry child-stream race and cleanup hang

### Formal tool-part chronology

- The next worker added unique temporary roots to the three previously conflicting tests. Market and realtime then passed in its parallel tool-call batch.
- PostgreSQL persistence and shared-backend integration both reached `JSON.parse` with an empty stdout buffer. Their child-process wrappers resolve on the child's `exit` event, which can occur before stdout and stderr streams emit `close`; parsing at `exit` therefore races the final pipe delivery.
- The in-progress persistence script also kept its parent `createRuntimeState` database owner live while spawning a child against the same directory. This regressed the required sequential stop-and-reopen ownership contract.
- Trading tool part `prt_f7259fee6001lKFmV3Yg0kZGbf` printed `Trading API contract validated.` and then remained running in its `finally` path until the exact 300,000 millisecond tool timeout. The persisted output establishes a post-assertion cleanup/stop hang but does not yet distinguish its exact cleanup call.

### Classification and correction

- Classification remains General-squad test lifecycle and evidence-capture failure. OpenCorvus concurrently executed and persisted all five tool calls and their results; the scheduler did not manufacture the pipe race or the unclosed test resource.
- Await complete child-process and stdio closure before parsing captured output. Stop the persistence writer before opening the same directory in the child. Diagnose and repair the trading cleanup owner without `process.exit`, timeout masking, retry, gate, fallback, or serial execution.
- The correction was injected into the same active Task. It returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; all five commands must subsequently exit cleanly under concurrent execution.

## Iteration 18 — green concurrent suite does not prove shutdown persistence

### Independent validation

- Commit `abed3ee` changed child completion waits to `close`, gave market/trading/realtime unique temporary directories, and removed the post-assertion hang. Independent concurrent execution then passed all five commands: PostgreSQL persistence in 36,343 milliseconds, shared-backend integration in 37,609 milliseconds, market in 26,444 milliseconds, trading in 26,509 milliseconds, and realtime in 26,372 milliseconds.
- The dedicated persistence script nevertheless keeps its parent runtime database open while spawning the child over the same directory. The result proves cross-process visibility while the original PostgreSQL server remains online, not durability after its owner shuts down.
- This contradicts the Goal objective and Task acceptance wording that the project-managed database must survive process shutdowns. The live shared-backend integration check cannot substitute for a stop-and-reopen persistence test.

### Classification and final persistence correction

- Classification remains General-squad acceptance-semantics failure, not infrastructure. The scheduler and tool runtime executed the concurrent commands successfully; the asserted scenario is weaker than the persisted Goal contract.
- The dedicated test must write, stop the parent runtime, then spawn a child that independently derives and reopens the same stable directory, inspects the row, and stops. The now-green parallel isolation and production default must remain unchanged.
- The exact rejection and five timings were injected into the existing Task. The route returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; PostgreSQL persistence remains unaccepted until shutdown/reopen passes.

## Iteration 19 — matching logic is outside the database transaction

### Checker chronology and independent review

- The matching worker first failed `trading-ledger.integration.test.ts` with `Negative balance detected for USDT`, read the exact ledger/test locations, repaired the defect, and later passed both repository typecheck and the integration script. Canonical mailbox then emitted `goal.passed` for the matching/accounting Goal.
- Commit `2bca2b8` adds deterministic book walking, market/limit statuses, partial fills, fees, slippage fields, lock/release behavior, positions, audit records, account validation, and non-negative checks. These are meaningful functional improvements.
- `packages/db/src/runtime.ts::submitOrder` nevertheless calls the in-memory `applySubmitOrder(state, input)` before issuing `BEGIN`; cancellation has the same order. A subsequent SQL failure rolls back PostgreSQL but leaves the cached state mutated.
- Each operation then calls `replaceAllStateRows`, which truncates every market, account, balance, order, fill, position, watchlist, alert, audit, trade, tick, book, candle, and pair table before reinserting the full state. It rewrites unrelated data and provides no row-lock or concurrent-transaction ownership model.
- The current test does not force a database failure or concurrent requests, so it cannot detect ghost in-memory mutations, lost updates, duplicate identifiers, or rollback inconsistency. It also lacks exact slippage, unauthorized cancellation, sell-side lock/release, and full/partial limit reconciliation coverage.

### Classification and correction

- Classification: General-squad transaction-design and test-completeness failure. OpenCorvus correctly persisted the original checker failure, the repair tool calls, and the terminal claim; common scheduling is not the cause.
- The raw Goal pass is rejected. Trading/account/audit changes must be derived from database-authoritative rows and persisted inside one PostgreSQL transaction with concurrency ownership; only committed state may become observable. Rollback must leave both runtime and database unchanged, without an in-process queue/gate/state machine or fallback snapshot.
- Exact rollback, concurrency, fee/slippage, ownership, sell-lock, full/partial limit, market, position, audit, and persistence acceptance gaps were injected into the active Task. The injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; any already-started realtime work may continue, but ledger correction is required before Phase 06 completion.

## Iteration 20 — malformed WebSocket debug command leaked its server

### Formal tool evidence

- Realtime/API worker typechecked the API and simulator packages, then launched tool part `prt_f72984d18001hyuqV8KV31JnnK` to investigate a WebSocket handshake.
- The double-quoted shell command embedded a JavaScript backtick URL. `/usr/bin/bash` treated the backticks as command substitution, emitted `ws://127.0.0.1:/ws: No such file or directory`, and passed `undefined` to the WebSocket client.
- The resulting `SyntaxError: Invalid URL: undefined` entered a catch path that did not close the already-listening Fastify application, PostgreSQL runtime, or temporary directory. The tool therefore remained alive until its exact 300,000 millisecond timeout.
- The persisted output is debugging-command failure evidence, not a product WebSocket handshake result.

### Classification and correction

- Classification: General-squad tool-use and resource-lifecycle defect. OpenCorvus preserved the live tool state and exact timeout result; there is no scheduler or mailbox projection loss.
- The active Task received the exact shell-escaping cause and required a shell-safe URL construction plus unconditional WebSocket, application, database, and temporary-directory cleanup. No restart, timeout masking, fallback, or product workaround is authorized.
- Injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; the original realtime/API acceptance must still be executed with a valid client.

## Iteration 21 — WebSocket plugin registration raced route declaration

### Terminal chronology and root cause

- The realtime worker later ran `realtime-stream.integration.test.ts` through the library's `injectWS` helper and received `Unexpected server response: 404`. It investigated further but committed `92ac02d` and reported the Goal failed with the checker unresolved.
- The commit adds substantial API, simulator, contracts, and realtime code, but `createApp` calls `app.register(websocket)` without awaiting registration and immediately declares every route, including the full-declaration `/ws` route with `wsHandler`.
- The installed `@fastify/websocket` 11.3.0 README and tests explicitly await plugin registration before declaring WebSocket routes. Its route hook must exist when the route is registered; otherwise the upgrade is handled by the normal HTTP handler, which this implementation deliberately answers with 404.
- This exact ordering explains the observed status without a task-specific workaround or infrastructure hypothesis.

### Classification and retry contract

- Classification: General-squad product implementation and completion-discipline failure. The worker encountered a locally fixable mature-library integration error but used `report_build_result(status="failed")`; OpenCorvus correctly terminalized and surfaced that honest failure.
- Retry must await plugin registration before route declaration, preserve one documented route form, and run both `injectWS` integration and a shell-safe real Node `ws` client with complete socket/application/database/temp cleanup. API/simulator integration and typecheck must also pass.
- The proven local-library evidence was injected into the same Task. The route returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; no backend restart or infrastructure code change is required.

## Iteration 22 — ledger concurrency test opened two PostgreSQL servers on one directory

### Correction chronology

- A dedicated persistence correction committed the shutdown/reopen proof and then ran five PostgreSQL-backed tests concurrently. All passed in one 57,091 millisecond batch: market 28,740 ms, realtime 29,288 ms, persistence 41,959 ms, shared backend 52,497 ms, and ledger 57,010 ms. The persistence sub-requirement is accepted.
- The ledger transaction correction added broader scenarios and exposed a real concurrent-order failure. The worker then changed the test to create two independent `RuntimeState` instances against the same database directory, describing them as two connections.
- Each `RuntimeState` starts its own embedded PostgreSQL server. The test therefore created two server owners over one data directory rather than two clients to one server; tool part `prt_f72d9644a001LHiWUkXR5sEAkh` produced no output and terminated at the exact 300,000 millisecond timeout.

### Classification and required model

- Classification: General-squad runtime/test ownership defect. OpenCorvus dispatched one worker and persisted the exact tool timeout; scheduler infrastructure is healthy.
- One embedded PostgreSQL server must own the cluster. Concurrent order/cancel calls need independent transaction connections from that server through a mature client pool or equivalent, with each connection owning `BEGIN` through `COMMIT` or `ROLLBACK`.
- The Task was instructed to revert the dual-server test, keep concurrent `Promise.all` through the public runtime, and prove distinct identifiers, no lost updates, non-negative balances, and fill/audit reconciliation. An in-process queue/gate or serial test is forbidden. Injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`.

## Iteration 23 — green realtime checks contradict the accepted backend contract

### Independent validation and contract comparison

- Realtime correction commit `1ffb36a` now awaits `app.register(websocket)` before declaring `/ws` and adds both `injectWS` and a real Node `ws` client. Independent concurrent execution passed `realtime-stream.integration.test.ts` in 83.2 seconds, `api-and-simulator.integration.test.ts` in 53.1 seconds, and workspace typecheck in 7.2 seconds.
- The green realtime test weakens the accepted protocol by allowing its first frame to be either `snapshot` or `event`. The Phase 05/07/08 contract requires a scope-specific snapshot before the first incremental frame for each new subscription.
- No API route declares a Fastify request or response `schema`; manual casts and ad hoc validators do not enforce unknown-field rejection or keep the transport contract aligned with `packages/contracts`.
- Private account reads and support mutations do not consistently require and verify account ownership. Watchlist and alert creation mutate cached runtime state before separate SQL statements, so database failure can leave ghost state and multi-row creation is not atomic.
- The simulator-control route passes an empty event array into an isolated calculation and does not commit generated market state, drive the live stream, update diagnostics, or implement the accepted read, pause, resume, and reset lifecycle.
- The WebSocket implementation only cycles a precomputed market-event array while rewriting sequence values. It has no account/order/fill/balance event families, no cursor field, no unsubscribe or account subscription, no strict client-message validation, and no scope-specific snapshot. Filtered resume also retains original sequence gaps while its `verified` check demands dense `since + index + 1` values.
- Several implemented support paths diverge from the already accepted single design source, including plural watchlist paths, a shortened audit path, a single diagnostics path, and one simulator calculation route instead of the declared support lifecycle. The implementation neither revised the design contract explicitly nor implemented it.

### Classification and correction boundary

- Classification: General-squad product implementation and acceptance-discipline failure, not OpenCorvus infrastructure. The scheduler executed the retry, emitted canonical Goal status, and accepted the operator injection. The independent rejection is based on executable source and accepted artifact differences.
- The raw realtime Goal pass is rejected. The existing Phase 06 Task received a complete correction contract covering strict route schemas, account ownership, transactional support persistence, integrated deterministic simulator state, the full WebSocket snapshot/cursor/resume/account protocol, exact first-frame tests, and persistence/rollback/concurrency/network evidence.
- Existing PostgreSQL identity/persistence and ledger transaction corrections must remain intact. No task-specific scheduler rule, gate, retry loop, serial test, process exit, or fallback is authorized. The injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`; frontend remains blocked.

## Iteration 24 — fifteen-minute mailbox silence while correction worker remains active

### Bounded inactivity snapshot

- Canonical mailbox remained unchanged for 15.46 minutes after event `pev_f72f09321001iY7cp2k1joU3IL`, crossing the benchmark's real no-activity threshold. The observer then took one bounded public snapshot and did not poll task internals repeatedly.
- `/global/health` reported the formal database `C:/Users/chuan/.local/share/opencorvus/opencorvus.db` healthy. Phase 06 remained `running` with lifecycle `active`, four of five goals completed, and the final integration-test goal running.
- Recovery Orchestrator session `ses_08db6bfc9ffe37T1PRrw7NusdY` remained streaming. The newly dispatched in-place correction worker `ses_08d0bc3deffedA5w0XisnOVj94` was also streaming; its last persisted update was only about 1.2 minutes before the snapshot.
- The active worker title carries the exact Phase 06 realtime/API correction scope from Iteration 23. No duplicate correction worker, failed dispatch, missing session, or stale scheduler ownership was visible.

### Classification and action

- Classification: General-squad milestone-reporting defect, not infrastructure. The common scheduler consumed the operator injection, dispatched the correction worker, kept its session live, and projected the remaining goal. The squad has not sent the requested canonical mailbox milestone despite active work.
- Restart, retry, replacement dispatch, and additional task injection are not justified while the worker has fresh activity. The observer will return to canonical mailbox polling and independently inspect the correction only after a durable milestone or terminal event arrives.

## Iteration 25 — correction worker ended incomplete while recovery Orchestrator remained active

### Bounded inactivity snapshot

- Canonical mailbox remained unchanged after Iteration 24. Once fifteen minutes had elapsed since the last independently proven recovery-Orchestrator update, the observer took one further bounded public snapshot and did not inspect verbose logs or session message streams.
- `/global/health` remained healthy against the formal database `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`. Phase 06 remained `running` with lifecycle `active`: four of five Goals were projected successful and the final real-integration-test Goal `gol_f71e3afab005wHZtqMbEPBLmwq` remained `running` / raw `pending`.
- Correction worker `ses_08d0bc3deffedA5w0XisnOVj94` was terminal with reason `completed`, but its own terminal summary explicitly stated that the realtime/API/simulator correction was not completed, cross-package `rootDir` / dependency and implementation-structure conflicts remained, and its attempted worktree changes had been restored to a clean state. No correction milestone or terminal disclosure reached canonical mailbox.
- Recovery Orchestrator `ses_08db6bfc9ffe37T1PRrw7NusdY` was still `streaming` and had a fresh persisted update at `1784343580462`, immediately before the snapshot at `1784343580582`. The Task therefore still had a live coordinator capable of consuming the failed worker outcome and deciding the next action.

### Classification and action

- Classification: General-squad execution and mailbox-reporting defect, not an infrastructure scheduling defect. The scheduler created and terminalized the worker, preserved its honest failure summary, kept the parent Orchestrator live, and retained the unfinished integration Goal. The functional correction itself was not delivered, and the squad also failed to surface that outcome through its required mailbox contract.
- The raw realtime Goal pass remains rejected and frontend work remains blocked. No restart, retry, replacement dispatch, or duplicate injection is justified while the recovery Orchestrator has fresh activity; the observer returns to canonical mailbox polling and will only intervene after another true inactivity threshold or a durable attention/terminal message.

## Iteration 26 — no-decision self-wake loop masks scheduler inactivity

### Recall

- Original requirement: run the long Mission autonomously from canonical mailbox evidence, distinguish infrastructure scheduling stability from expert-squad functional quality, repair every exposed defect without task-specific infrastructure overfitting, and never monitor verbose logs.
- Acceptance retained: Phase 06 realtime/API/simulator corrections must independently satisfy the Iteration 23 contract before frontend work begins; the full desktop frontend, real browser evidence, MirrorTest coverage, final audit, commit, and `myhexin` push remain unfinished required work.
- Hard constraints retained: no fallback, gate, state machine, keyword rule, serial-test workaround, duplicate source, process-exit patch, benchmark-specific scheduler branch, or unapproved OpenCorvus/overlay process intervention. Benchmark-owned backend restart is allowed only after a verified infrastructure repair requires code reload.
- Landed evidence reread before repair: this record through Iteration 25; `benchmark-debug-template/SKILL.md`; `opencorvus-debug-evidence/SKILL.md`; `opencorvus-debug-evidence/references/evidence-surfaces.md`; `specs/current/architecture/01-agents.md`; `specs/current/architecture/02-data.md`; and `specs/current/architecture/13-agent-communication-matrix.md`.
- Full-repository call-site audit: `OrchestratorNoDecisionStopError`, `orchestrator_wake_failure`, `recordOrchestratorDecisionContractFailure`, no-decision recovery notes, `dispatchTaskLoop`, task-wake composition, and scheduler-decision wording were grepped across `packages/opencorvus/src`, `packages/opencorvus/test`, and `specs/current/architecture`. The only production no-decision self-wake is `packages/opencorvus/src/orchestrator/agent.ts::recordOrchestratorSessionErrorEnvelope`; `packages/opencorvus/src/orchestrator/event.ts::noDecisionRecovery` exists only for that path. Artifact persistence/listing and describe projection are the single evidence path in `engine/persist.ts`, `engine/store.ts`, and `engine/describe.ts`. Behavioural coverage is concentrated in `test/orchestrator/no-decision-stop-process.test.ts`; stream-error and general queue tests are separate.
- Independent-agent feedback: none; the user did not request sub-agent or parallel-agent work, so no agent was delegated.

### Evidence and causal chain

- Canonical mailbox stayed unchanged while repeated bounded public snapshots showed Phase 06 `running` / lifecycle `active`, its final integration Goal raw `pending`, one failed correction worker, no replacement worker, and recovery Orchestrator session `ses_08db6bfc9ffe37T1PRrw7NusdY` continuously advancing `updated` timestamps.
- A single bounded public trace summary disproved meaningful activity: the session alternated `orchestrator_wake_failure` and `llm_request` roughly every ten seconds. The last structured failure said the Orchestrator intentionally made no retry because `query_failed_goals` returned no failed Goals and another retry would duplicate work.
- Direct trigger: `classifyOrchestratorDecisionStop` raises `OrchestratorNoDecisionStopError`; `recordOrchestratorSessionErrorEnvelope` records the visible artifact and unconditionally calls `dispatchTaskLoop` again.
- Deep cause: the host converts a prompt-level scheduler-decision contract into an automatic process-control loop. Each correct refusal to duplicate work becomes another immediate wake, so timestamps look live while Task state, Goal runs, workers, and mailbox never change. Existing tests explicitly require repeated no-decision failures to bypass the stream fuse and self-wake forever.
- Classification: generic OpenCorvus infrastructure lifecycle defect. The General squad still owns the incomplete Phase 06 correction, but the repeated wake storm and misleading streaming state are host scheduling behaviour independent of cryptocurrency functionality.

### Repair plan and acceptance

- Keep one append-only `orchestrator-decision-contract-failure` artifact and the natural assistant message as observable evidence. Remove the automatic no-decision `dispatchTaskLoop` control path and its dedicated recovery-note constructor. No-decision must not mutate task status/error; the current pass settles and only a real external event may wake it again.
- Preserve hard provider/tool/stream error handling, external queue dispatch, live-worker scheduler parking, and artifact describe projection. Do not add a retry counter, fuse, cooldown, keyword classifier, special Goal check, or Phase 06 branch.
- Replace tests that assert self-wake with tests proving: one plain-text no-decision creates exactly one artifact and zero dispatches; a real queue runs one prompt and settles until an explicit second external dispatch; that external dispatch sees the prior artifact and can make a normal tool decision; repeated externally triggered no-decisions remain observable without autonomous replay; live blocking work still parks cleanly; hard errors still surface normally.
- Verification: focused `no-decision-stop-process.test.ts`, affected orchestrator/queue/describe suites, repository typecheck, then benchmark-owned dev-backend reload. After reload, prove the old session no longer accumulates `orchestrator_wake_failure` events without an external event, resume the same Phase 06 Task once with its exact unmet correction contract, and return to mailbox-only observation.

### Repair and runtime verification

- Commit `a8e535b119` removes the no-decision self-dispatch path and dedicated recovery note, keeps one decision-contract-failure artifact, excludes no-decision from `task.error`, and updates the task-loop contract plus regression coverage. It introduces no retry counter, fuse, cooldown, status gate, Task/Goal special case, or fallback.
- Focused no-decision/describe regression passed 20 tests; the broader affected Orchestrator prompt, queue, and describe batch passed 55 tests; package TypeScript typecheck passed; historical docs health passed 21 tests. The `myhexin` pre-push SDK/runtime, all-package typecheck, route, docs, i18n, and secret checks passed.
- The exact benchmark backend PID 22220 was verified by command line and unique ownership of port 7878, then replaced with PID 12464 using the same Bun dev serve command. `/global/health` remained healthy against `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; Vite and unrelated processes were untouched.
- After reload, a two-point public trace sample separated by thirty seconds remained exactly `216 -> 216`; the last trace event and recovery-Orchestrator session timestamp did not change, and session status was no longer `streaming`. The former roughly ten-second `orchestrator_wake_failure` / `llm_request` storm therefore stopped without a timer, retry limit, or task-specific branch.
- One real external injection resumed the existing Phase 06 Task with the exact unmet strict API, ownership, transactional support persistence, integrated PostgreSQL simulator, continuous realtime, WebSocket cursor/snapshot/account protocol, persistence/concurrency/network-test, mailbox, and frontend-blocking contract. The route returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, `status=active`; no parallel Task or duplicate correction Task was created.

## Iteration 27 — restart chronology, PostgreSQL lifecycle timeout, and persistence-proof regression

### Recall

- Original requirement retained: observe the long Mission through canonical mailbox, distinguish generic scheduler stability from expert-squad functional responsibility, repair every exposed defect, keep the formal database and persistent benchmark project, and block frontend work until the backend correction independently passes.
- Acceptance retained: the accepted PostgreSQL proof is parent write -> parent stop -> child independently derives the stable project-managed database path from the same root and seed -> child reopens -> direct row assertion -> child stop. Parallel sibling tests must use explicit test-owned PostgreSQL resources. The complete strict API, account ownership, transactional support persistence, integrated simulator, continuous realtime, and WebSocket contract from Iteration 23 remains required.
- Hard constraints retained: no fallback, gate, retry masking, serial-test workaround, PID-scoped production path, duplicate Task, task-specific infrastructure branch, or unapproved process intervention. Test timeout must represent real inactivity rather than elapsed time since process start.
- Landed evidence reread before action: this record through Iteration 26; `benchmark-debug-template/SKILL.md`; `opencorvus-debug-evidence/SKILL.md`; and `opencorvus-debug-evidence/references/evidence-surfaces.md`.
- Repository and runtime call-site audit: task message/inject routes, `appendAndWakeTaskOperatorMessage`, task root and Orchestrator sessions, worker prompts, `report_build_result`, commit `4b733d7`, `getPersistentDatabaseDir`, `openPersistentDatabase`, `createRuntimeState`, `createApp`, and every PostgreSQL-backed script test were inspected. No sub-agent was delegated because the user did not request parallel agents.

### Scheduler-message chronology and classification

- After the benchmark-owned backend reload, the root Orchestrator first resumed an older unfinished operator instruction about PostgreSQL test isolation and dispatched worker `ses_08cae427cffeQxFCDPbZLvGlzl` against the already-passed persistence Goal. The later realtime correction message arrived after that dispatch; the Orchestrator repaired the existing realtime Goal contract in place and left its next dispatch pending while the persistence worker remained active.
- The worker's real prompt confirms the persistence guidance; this was not a title-based inference. Therefore the apparent wrong-Goal dispatch was chronological continuation of an earlier durable user message, not loss of the later correction and not an infrastructure routing defect.
- The worker added explicit per-test data directory, database name, and port ownership, then ran `postgres-persistence` successfully while `integration-shared-backend-state` produced no output and remained alive until the worker-selected Bash `timeout: 1200000` terminated it exactly 1,200,000 milliseconds after start.
- The backend remained healthy on PID 12464, port 7878, using `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; Vite remained healthy on PID 3360. The timeout was a test-process lifecycle failure, not backend death or scheduler loss.
- The worker read the test, changed writer/inspector shutdown ordering, reran the shared-backend test successfully, then passed concurrent persistence + ledger and API + realtime batches. Classification: General-squad PostgreSQL lifecycle and execution-discipline defect. Any agent running the same broken shared artifact could reproduce the hang; changing agent identity would not make it an infrastructure defect.
- The Bash timeout is a start-time wall-clock limit, not an activity timeout. This particular command had no activity for the whole interval, so both policies would have terminated it near the same time; the evidence does not justify attributing the PostgreSQL hang to generic tool infrastructure. Whether the Bash surface lacks a reusable inactivity-timeout capability remains a separate unproven question.

### Independent rejection of raw pass

- Worker commit `4b733d7` usefully preserves explicit test isolation and fixes writer-before-inspector shutdown/reopen, but it regresses the accepted dedicated persistence proof. The child no longer calls `getPersistentDatabaseDir(tempRoot, seed)` independently; the parent injects its precomputed `databaseDir`, `databaseName`, and `port` strings. That proves reopening an injected identity, not stable independent production-path derivation.
- The worker's internal reasoning explicitly chose to report only successful commands. Its passed `report_build_result` omitted the 1,200,000 millisecond failed attempt, even though the required benchmark report must list failures and repair records. This is a General-squad completion-discipline defect, not an OpenCorvus message-persistence defect; the full failed tool result remains authoritatively stored.
- Canonical event `pev_f73760d52001iewUqseirBxIZb` is therefore rejected as final REQ-2 acceptance. The existing Task received a bounded correction requiring restoration of child-side default-path derivation while retaining the new isolation helper, database identity, port ownership, lifecycle repair, and accepted ledger changes. It also requires the correction report to disclose the failed attempt, its cause, repair, and successful rerun before continuing the already-repaired realtime Goal.
- Injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`. No new Task, parallel correction worker, frontend work, or infrastructure modification was created.

## Iteration 28 — restart proof still permits false green; model baseline moves to Terra

### Independent executable evidence

- Correction commit `ebb522f` restores child-side `getPersistentDatabaseDir(tempRoot, seed)` and updates the common test helper to use that production path function. The diff is narrow and preserves the useful per-test database identity and port support from `4b733d7`.
- Independent concurrent execution contradicted the worker's pass claim: `postgres-persistence.test.ts` passed, while `integration-shared-backend-state.test.ts` exited 1 with no output. A separate shared-backend rerun printed PostgreSQL `AggregateError [ETIMEDOUT]` for both `::1` and `127.0.0.1` on the forced child restart port, never printed its success marker, yet the outer command exited 0.
- Control execution `pnpm exec node -e "process.exitCode=1"` exited 1, proving the package runner propagates status correctly. The false green belongs to the test/runtime lifecycle, not the command wrapper.
- Both restart children force the parent's explicit TCP port even though persistence only requires the same independently derived storage path and database identity. Both parents check child exit code but do not capture and assert the explicit `ok` stdout marker, so a child may leave an unresolved startup promise and exit without ever running the database assertions. `openPersistentDatabase` also supplies `onError: () => undefined`, suppressing mature-library error evidence.
- The earlier concurrent port-allocation time-of-check/time-of-use race remains only a hypothesis because the no-output failure provides no authoritative port-collision payload. It is not accepted as root cause and does not authorize a global port gate or allocator rewrite.

### Classification and correction

- Classification: General-squad persistence-test completeness and runtime error-surfacing defect. OpenCorvus scheduled and persisted both correction workers and their reports; the false acceptance comes from weak executable evidence.
- The Task was instructed to let each restart child obtain a new test-owned port, keep independent database-path derivation, capture stdout through child `close`, require the `ok` marker, remove embedded-postgres error silencing, and rerun both tests individually and concurrently while reporting the failed independent attempts. No retry, fallback, sleep, process exit, port gate, second server owner, frontend work, or infrastructure change is authorized.
- Injection returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, and `status=active`.

### User-mandated model switch

- The user requires every subsequent benchmark agent call to use `gpt-5.6-terra`. The refreshed project-scoped Hexin catalog authoritatively lists `gpt-5.6-terra`; the exact reference is `hexin/gpt-5.6-terra`.
- Session-scoped effective configuration for Phase 06 Task root `ses_08e32ce5fffeX0IoXtEKPqfREF` and Mission session `ses_08ea47b6dffeTb0mDUbw5eqWIl` now sets the top-level model plus Orchestrator and Mission host-agent models to `hexin/gpt-5.6-terra`. `/task/tsk_f71cd319b001UabB4T4CyVp1Bl/operator-model-context` confirms the effective Orchestrator model is `hexin/gpt-5.6-terra`.
- The durable benchmark harness state now records `hexin/gpt-5.6-terra`. A task-level model mandate was appended and woke the same Task so every new dispatch after that message must inherit Terra; calls already started before the mandate may finish naturally and are not forcibly cancelled.
- The global Hexin refresh route, despite claiming no active project is needed, returned `No context found for instance`; the project-scoped refresh succeeded with 24 models. This is preserved as a generic provider/control-plane defect candidate requiring separate call-path proof. It is not used as a fallback or attributed to the cryptocurrency squad.

## Iteration 29 — old-model correction was not merged; isolated-worktree PostgreSQL failure is path-length dependent

### Recall

- Original requirement retained: every new benchmark agent must use `hexin/gpt-5.6-terra`; observe the same long Mission through canonical mailbox; classify generic scheduling separately from squad functionality; repair and independently verify every failure before frontend work.
- Acceptance retained: both PostgreSQL restart proofs must independently derive or retain the intended storage identity, reopen with a child-owned port, assert the explicit `ok` completion marker, surface startup errors, fail with a non-zero process status on any top-level rejection, and pass both from the persistent project and the actual isolated build-worker worktree.
- Hard constraints retained: no fallback database, absolute-machine-path configuration, `subst` drive workaround, forced process exit, serial-test masking, retry, scheduler special case, or direct promotion of a failed worker branch. Toolchain repair must use a mature package-manager facility and retain worktree isolation.
- Landed evidence reread before action: this record through Iteration 28; `benchmark-debug-template/SKILL.md`; `opencorvus-debug-evidence/SKILL.md`; and `opencorvus-debug-evidence/references/evidence-surfaces.md`.
- Full project call-site audit: both PostgreSQL proof scripts, every `void main().catch` and `process.exitCode = 1` occurrence, `embedded-postgres` package/runtime resolution, the explicit Windows binary package, pnpm lock entries, native `initdb`/`plpgsql` files, and the old worker's Bash/apply-patch/report chronology were inspected. Only the two PostgreSQL proof scripts use the affected caught-main pattern. No sub-agent was delegated because the user did not request parallel agents.

### Evidence and causal chain

- Old correction session `ses_08c754e2affe2Lo8AHq3ItUoP6` was created before the Terra mandate and its persisted metadata identifies the old model. It committed `23f2e0c` on branch `opencorvus/s/1hHzHYjG`, honestly reported failure, and therefore did not merge into persistent-project `master`; `master` remains at `ebb522f`. The useful diff is audit evidence, not delivered code.
- The worker initially lacked a local `tsx` executable in its isolated worktree. `pnpm install --force` restored the executable, after which both PostgreSQL proofs reached `initdb` and printed `extension "plpgsql" is not available`; both commands nevertheless exited 0.
- The persistent project currently resolves `tsx v4.23.1`; its unmodified `postgres-persistence.test.ts` independently passes. Main-project and worker-worktree copies of `initdb.exe`, `plpgsql.control`, `plpgsql--1.0.sql`, and `plpgsql.dll` have identical sizes and SHA-256 hashes. The resolved native root is 194 characters in the persistent project and 230 characters in the nested worker worktree; appending `share/extension/plpgsql.control` puts only the worker path beyond the traditional Windows 260-character boundary. Rerunning the proof in that worktree reproduces the `plpgsql` failure while the main-project proof passes.
- Direct trigger: the default pnpm virtual-store layout plus OpenCorvus's already-long isolated-worktree location makes PostgreSQL's extension path too long for this Windows native binary. The package contents are present; the error text is a downstream stat/lookup symptom, not evidence that `plpgsql` was omitted.
- A focused Node probe also proves that after `EmbeddedPostgres` installs its `async-exit-hook`, a caught rejection that only assigns `process.exitCode = 1` prints the error but ends with status 0; an uncaught throw or rejected top-level `await` ends with status 1. This explains the worker's false-green command status without blaming pnpm's runner.
- Classification: General-squad build-toolchain and test-entrypoint responsibility under this benchmark's stated boundary, not scheduler stability. OpenCorvus created, ran, terminalized, and preserved the worker and its failed report. The squad must make its chosen database/toolchain work inside its real build worktree and make its tests truthfully fail.

### Terra correction plan and acceptance

- Resume the existing Phase 06 Task only. The first new worker must have actual persisted metadata `hexin/gpt-5.6-terra`; model configuration text alone is not acceptance.
- Use a pnpm-supported, repository-relative virtual-store path-length setting (for example a bounded `virtual-store-dir-max-length`) or an equivalently mature package-manager solution, with no absolute host path and no alternate database. Reinstall in the isolated worktree and prove the resolved `plpgsql.control` path is below the Windows boundary before rerunning tests.
- Replace the two caught-main entrypoints with rejected top-level execution so database startup/assertion failures naturally produce non-zero status. Merge the audited `23f2e0c` semantics by editing the owning files on the new Terra branch: child-owned ports, captured stdout/stderr, required `ok`, and unsilenced embedded-postgres errors. Do not cherry-pick the failed old-model branch as acceptance.
- Verification must include a deliberate failure probe for non-zero status, each PostgreSQL proof individually, both concurrently, TypeScript typecheck, a clean commit, merge into persistent-project `master`, canonical mailbox disclosure of the old failures and repair, and independent Codex reruns from the merged persistent project. Frontend remains blocked until this passes.

## Iteration 30 — Terra recovery exposes successful-goal worktree redispatch and false mailbox transition defects

### Recall

- Original requirement retained: all new benchmark agents use `hexin/gpt-5.6-terra`; observe canonical mailbox rather than verbose logs; classify only generic scheduling/lifecycle defects as infrastructure; repair every exposed issue without a cryptocurrency-specific branch or fallback.
- Acceptance retained: the PostgreSQL correction must execute in a real isolated worker worktree, merge into persistent-project `master`, and pass independent tests before frontend starts. A mailbox terminal event is progress evidence only when it represents a real lifecycle transition, not a replay of an unchanged terminal projection.
- Hard constraints retained: no second Task, new Goal, hidden gate, retry loop, fallback workspace, automatic replacement of a failed worktree, status cache, task-specific scheduler branch, forced process exit, or direct promotion of the old failed branch.
- Landed sources reread: this record through Iteration 29; `benchmark-debug-template/SKILL.md`; `opencorvus-debug-evidence/SKILL.md`; `opencorvus-debug-evidence/references/evidence-surfaces.md`; `2026-06-25-build-retry-session-resume-and-visible-feedback.md`; `2026-06-25-context-recovery-and-worktree-reuse.md`; `2026-06-25-windows-supervisor-worktree-lock.md`; `2026-06-30-completed-worktree-immediate-reclaim.md`; and `2026-07-02-optional-build-worktree-schema.md`.
- Full call-site audit: the exact `fresh context retry cannot reuse worktree` producer, both `selectedWorktreeUsage` paths, completed-worktree cleanup, `findGoalLatestWorkspace`, `selectGoalBuildRetrySession`, every `startNewAttempt` and `syncGoalStatus` caller, `modify_goal`, goal-status event projection, protocol/mailbox persistence, and related orchestrator/engine tests were grepped. `build-tool.ts` and the selected test files have no overlapping user edits. No sub-agent was delegated because the user did not request parallel agents.

### Canonical chronology and proven causes

- Canonical mailbox event `pev_f73a711a9001qKrp85oHsxf8Rf` reported `goal.passed` for ledger Goal `gol_f71e3afab0031W5PfPuXLNDe2p` at `1784351756712`. The bounded Task snapshot still showed four of five Goals complete and no new build worker; the event was not implementation completion.
- Fresh Orchestrator session `ses_08c5b26cdffed8lbf0WyPyOTbj` has a persisted first user message whose model metadata is exactly `hexin/gpt-5.6-terra`. It correctly retried the orphaned Task, tightened the existing ledger Goal contract with the operator's worktree/toolchain evidence, and attempted one isolated Terra build dispatch.
- `modify_goal` called `startNewAttempt`, which only annotated the completed tip with retry intent and deliberately left the derived Goal projection `passed`. `supersedeGoalRun` and `startNewAttempt` nevertheless called `syncGoalStatus`. Because the reloaded backend's `lastEmittedStatus` map had no baseline for this Goal, `syncGoalStatus` emitted a new durable `goal.passed`; mailbox consumers are append-only and therefore are not idempotent despite the stale code comment claiming duplicate emits after restart are harmless.
- The subsequent `dispatch_agent` call failed with authoritative structured error: prior terminal Goal run `1eff11c5` had no recorded worktree, so fresh-context retry could not reuse one. The prior run is `completed`, and successful managed worktrees are intentionally reclaimed immediately while current-project runs intentionally persist no managed workspace pointer. The adapter therefore conflates valid successful cleanup/current-project execution with missing implementation state from an unsuccessful attempt.
- Classification: both are generic infrastructure lifecycle/dispatch defects. The first creates false canonical progress for any modified terminal Goal after process restart. The second makes a valid completed-Goal redispatch impossible whenever the model newly selects managed isolation, independent of cryptocurrency functionality. The General squad remains responsible for the PostgreSQL implementation after dispatch succeeds.

### Single-owner repair and regression contract

- `startNewAttempt` and its internal terminal-tip annotation must not call `syncGoalStatus`, because retry intent does not change the current Goal lifecycle projection. The actual next attempt boundary (`beginBuildAttempt`) remains the single transition emitter. Add an engine regression proving a completed/failed terminal tip annotated for retry produces no new `goal.passed` / `goal.failed` protocol event, while a subsequent real attempt projects running normally.
- In the managed-worktree selection path, a terminal successful prior run with no workspace pointer may create one new managed worktree from the current project HEAD. This is the next attempt's single implementation source after the previous successful contribution was already committed/merged and its workspace reclaimed, or after a caller-owned current-project run. Keep the existing structural error unchanged for failed/aborted terminal attempts whose workspace pointer is missing; do not hide lost diagnostic state.
- Add orchestrator regressions proving: completed current-project/no-workspace Goal + explicit managed redispatch creates a fresh worktree and fresh build session; completed managed Goal after immediate cleanup can likewise redispatch; failed Goal with missing workspace still returns the structural error; existing failed Goal with recorded workspace still reuses it.
- Run focused engine and orchestrator tests, affected worktree lifecycle tests, package typecheck, document health, and `git diff --check`; commit with `dsw-33987`, push `myhexin`, then reload only the benchmark-owned backend so production uses the repair. Re-inject the same existing Goal contract once and return to canonical mailbox observation. No frontend dispatch is allowed until the Terra worker and independent PostgreSQL proofs pass.

## Iteration 31 — first Terra implementation worker lands and independently passes PostgreSQL isolation proofs

### Recall

- Original requirement retained: all new benchmark agents must actually run as `hexin/gpt-5.6-terra`; canonical mailbox is the progress source; the persistent System Under Test must pass PostgreSQL restart/isolation proofs before frontend dispatch; worker completion claims require independent execution.
- Acceptance retained: repository-relative pnpm configuration must keep the embedded PostgreSQL native extension path below the Windows boundary inside the real worker layout; startup/assertion rejection must produce a non-zero process result; persistence and shared-backend proofs must pass separately and concurrently; the trading ledger and workspace typecheck must remain green.
- Hard constraints retained: no alternate database, absolute-machine-path workaround, `subst`, forced exit, swallowed startup error, serial-only masking, retry loop, fallback, direct promotion of the old failed branch, or acceptance based only on a worker report.
- Landed evidence reread before action: this record through Iteration 30; `benchmark-debug-template/SKILL.md`; `opencorvus-debug-evidence/SKILL.md`; and `opencorvus-debug-evidence/references/evidence-surfaces.md`. No sub-agent was delegated because the user did not request parallel agents.

### Canonical mailbox and model evidence

- The one canonical mailbox poll returned progress and terminal messages for new worker `ses_08c580466ffeqFSdVR8yStaLs9`, Goal run `a213548e`, followed by Goal terminal projection. The worker reported commit `3dae93d` on persistent-project `master`; it did not reuse old-model session `ses_08c754e2affe2Lo8AHq3ItUoP6` or failed branch commit `23f2e0c`.
- The worker trace exists at `.opencorvus/.r/s/Bb/gzs0Im/trace.jsonl`. Its first persisted `llm_request` directly records `sessionID=ses_08c580466ffeqFSdVR8yStaLs9`, `agentName=implementation-engineer`, `providerID=hexin`, and `modelID=gpt-5.6-terra`. This is actual execution metadata rather than configuration prose.
- Classification: General-squad database toolchain/test-entrypoint repair succeeded. OpenCorvus created, ran, persisted progress for, and terminalized the exact Terra worker. The path-length and rejection-propagation defects remain squad responsibility, not generic scheduler behavior.

### Independent code and executable verification

- Commit `3dae93d` is the current persistent-project `master` tip. It sets pnpm `virtualStoreDirMaxLength: 40`, removes the embedded PostgreSQL `onError` silencer, captures both child stdout and stderr through `close`, requires exact `ok`, and leaves rejection uncaught through `void main()` so Node's unhandled-rejection policy produces a non-zero result.
- `pnpm config get virtual-store-dir-max-length` and its camel-case equivalent both resolve to `40`. The actual existing native extension is `native/share/extension/plpgsql.control`; its resolved absolute path is 221 characters and exists. An initial inspection probe incorrectly joined the package root directly to `share/extension` and found a nonexistent 214-character candidate; that probe was rejected and the real `native` path was then measured.
- A deliberate `Promise.reject(...)` probe exited `1`. `postgres-persistence.test.ts` passed separately; `integration-shared-backend-state.test.ts` passed separately; a Node child-process harness then ran both commands concurrently and both returned code `0` with their exact success messages. `trading-ledger.integration.test.ts` and `pnpm typecheck` also passed.
- The first inactivity-runner invocation with executable `pnpm` failed before test startup with Windows `uv_spawn ... ENOENT`; using the concrete `pnpm.cmd` entry ran the individual proofs. The first concurrent harness then failed before test startup because Node 25 rejected direct `.cmd` spawning with `EINVAL`; invoking pnpm's installed `pnpm.cjs` through `node.exe` entered and passed both real tests. These are disclosed verification-tool entrypoint failures, not product failures or hidden retries.
- The persistent project retains only its pre-existing `.opencorvus/opencorvus.jsonc` runtime-state modification. The worker's four source/config files are clean and committed. PostgreSQL persistence/toolchain correction is independently accepted, so frontend dispatch may proceed after the generic OpenCorvus lifecycle repair is committed, loaded, and proven on the original Task.

## Iteration 32 — unified dispatch ownership repair and cancellation evidence boundary

### Recall

- Original requirement retained: benchmark OpenCorvus infrastructure and squad quality separately, repair every exposed issue without task-specific scheduler behavior, use only inactivity-based timeout, preserve the formal database and persistent System Under Test, and run every subsequent benchmark agent as `hexin/gpt-5.6-terra`.
- Acceptance retained: the accepted PostgreSQL correction at persistent-project commit `3dae93d` remains the prerequisite for frontend work. Frontend, real browser screenshots, MirrorTest, final report, and final delivery review remain required and unfinished.
- Hard constraints retained: no fallback, recovery synthesis, hidden gate, Build-specific host policy, second dispatch engine, start-time test timeout, serial-test masking, duplicate Task/Goal, or intervention in non-benchmark processes.
- Landed sources reread before repair: this record through Iteration 31; the benchmark-debug template; OpenCorvus debug-evidence instructions and evidence surfaces; and Item 11 Recall in `2026-07-16-platform-legacy-debt-cleanup.md`.
- Full-repository call-site and residue audit covered strict tool ownership, Build/Integrity nested owners, Agent-to-Agent redispatch strategies, cancellation scope, session-status publication, queue/settlement consumers, runtime-template ownership policy, and affected docs/tests. No sub-agent was delegated because the user did not request parallel agents.

### Evidence, classification, and root causes

- The apparent hang in `goal build returns started after binding goal_run and finalizes in the background` occurred after dispatch had already returned. The assertion saw an empty `child_session_ids` list, then test cleanup waited for a deliberately unresolved terminal promise. The test mock's `markBuildSlotAcquired` bypassed production `executionLease.attachSession`; production dispatch was not deadlocked. Classification: stale infrastructure-test fixture exposed by the unified-owner contract.
- A real generic cancellation defect remained. Cross-directory prompt cancellation wrote process state as terminal-aborted with publication disabled. The single process-state terminal latch then made a later state mutation a no-op, so Agent-to-Agent cancellation could lack its durable `session.status` evidence. The repair runs cancellation inside the worker session's owning directory and publishes the terminal fact at that first authoritative transition.
- A proposed `SessionStatus.publishCurrent` recovery path was rejected during secondary review because replaying an old in-memory terminal state would be fallback synthesis and contradicted Item 11's durable-evidence boundary. It was deleted. A worker that is already process-aborted without durable status now fails visibly; an already durable status may be reused idempotently.
- The first combined queued-wake run caught an incomplete Item 11 fixture update: after tests gained real root sessions they entered production dead-owner convergence but had not installed its required execution-termination runtime. The isolated failure was not a queue production regression. The fixture now installs the same real termination runtime used by queue tests; queued-wake passes 7/7 and a combined queued-wake plus extra-tools invocation passes 49/49, so the result is not based on serial execution.

### Verification and current action

- The complete `tools.test.ts` suite passed 127/127 with 998 assertions under `run-with-inactivity.ts --inactivity-ms 120000` and Bun's elapsed timeout disabled. The background Build terminal test completed naturally. Default Bun five-second elapsed-time failures are rejected as an invalid benchmark mode, not counted as product failures.
- Strict cancellation selection passed 5/5: active cancellation completes with durable status, durable prior status is recoverable, and missing durable status is rejected instead of synthesized.
- The affected ownership/coordination/attempt/dispatch/runtime/MirrorTest matrix passed 69/69 with 685 assertions; queued-wake plus session extra-tools passed 49/49 with 217 assertions. Historical document links passed 21/21. OpenCorvus typecheck, production dead-code, API route inventory, and the 274-operation docs check passed.
- Formal generation succeeded. Its first before/after whole-diff hash changed only because another already-running Item 11 writer updated test files during generation; no generated file appeared in `git status`. A stable-tree idempotence check remains required before commit.
- Classification: unified ownership, cancellation publication, and stale retry/dispatch lifecycle are generic OpenCorvus infrastructure concerns. PostgreSQL/toolchain implementation remains General-squad responsibility and is accepted. The benchmark backend has not yet been restarted; the original Mission/Task has not yet been resumed for frontend work.

### Independent infrastructure acceptance

- Stable-tree formal generation is idempotent: the complete binary diff hash remained `1259f8b3e60d3f40a46d592c56f1da24a936ba4d` before and after generation.
- The final complete tools rerun passed 127/127 with 998 assertions. The changed server A2A conversation path passed 1/1 with 39 assertions and the remaining projected-adapter error boundary passed 1/1 with 6 assertions. Exact production residue and `git diff --check` scans are clean.
- Independent review rejected process-local status republishing, verified atomic coordination-action/dispatch-owner binding and true background-terminal ownership, and ACCEPTED the generic infrastructure repair. The next authorized action is commit/push, then replacement of only the benchmark-owned backend process and resumption of the original Terra Task.

## Iteration 33 — elapsed-time test debt removed and infrastructure repair reaccepted

### Recall

- Original requirement retained: autonomously benchmark OpenCorvus infrastructure and squad quality separately,
  repair every exposed issue without task-specific scheduler behavior, use the formal database and persistent
  System Under Test, observe progress through canonical mailbox messages, and run every new benchmark agent as
  `hexin/gpt-5.6-terra`.
- Acceptance retained: the accepted System Under Test PostgreSQL correction at commit `3dae93d` remains valid;
  generic ownership/cancellation/A2A infrastructure must pass complete stable-tree tests before the benchmark-owned
  backend is reloaded; frontend, browser screenshots, MirrorTest, final report and independent delivery review remain
  required and unfinished.
- Hard constraints retained: no fallback, hidden gate, state machine, Build-specific host policy, second dispatch
  engine, positive elapsed test timeout, serial-test masking, duplicate Task/Goal, or intervention in processes not
  owned by this benchmark.
- Landed evidence reread before action: this record through Iteration 32, Item 11 Recall and correction history in
  `2026-07-16-platform-legacy-debt-cleanup.md`, the benchmark-debug template, OpenCorvus debug-evidence instructions,
  and the evidence-surface reference. Exact source/test scans covered all ownership APIs, cancellation publication,
  `beginBuildAttempt` callers, A2A restart fixtures, mailbox routes and timeout-governance tests. No sub-agent was
  delegated because the user did not request parallel agents.

### Evidence, classification and repair

- The first full tools run was executed while another existing Item 11 writer was still changing fixtures. Its
  15 failures were stale-tree results; seven representative cases passed immediately on the stopped tree and the
  subsequent strict lifecycle fixtures explicitly terminalized their old owners.
- Stable-tree heavy tests then exposed Bun's default five-second elapsed timeout. Active cross-process seed,
  Server-Sent Events and background Build work was killed despite progress. Unfinished teardown subsequently raced
  `Instance.disposeAll`, Git isolated indexes and the Windows supervisor, creating misleading later failures.
  Focused reruns passed, proving the direct trigger was the test runner's elapsed cutoff rather than product
  ownership, PostgreSQL or expert-squad behavior. Classification: generic OpenCorvus test infrastructure.
- The correct repository pattern was already encoded in
  `acceptance/inactivity-timeout-process.test.ts`: `setDefaultTimeout(0)` plus operation-specific inactivity
  observation. The long tools and task-conversation files now use that form. The acceptance test itself, mailbox
  routes and active-plan Build tests were brought onto the same single source. All temporary positive timeout
  arguments were removed; A2A activity-file and Server-Sent Events diagnostics remain the real inactivity bounds.
- No production scheduler guard was weakened and no cryptocurrency-specific condition, retry, fallback or
  serial-only acceptance was added.

### Final verification and next action

- Fresh complete tools: 127/127, 999 assertions. Task conversation plus task message routes: 63/63, 545 assertions.
  Ownership/coordination/attempt/dispatch/Mirror Watch matrix: 44/44, 246 assertions. Timeout governance plus
  affected mailbox/active-plan tests: 22/22, 66 assertions.
- OpenCorvus typecheck, production Knip, 31-file API route inventory, generated API documentation freshness at 274
  operations in 24 groups, historical links at 21/21, and `git diff --check` pass. Formal generation is idempotent:
  the complete binary diff hash remained `ae8f71f4923ea3129cd2a20f77d4fad5e3d9bf4f`.
- Exact scans find zero retired ownership insert/completion APIs, Build/Integrity-specific live-owner finders,
  adapter-specific redispatch executors or process-local status republisher. There are 56 `beginBuildAttempt` calls
  and 56 explicit `dispatchOwnershipID` fields.
- The generic infrastructure repair is reaccepted on stable-tree evidence. The next action remains commit/push,
  restart only the benchmark-owned dev backend on the formal database, verify Vite remains healthy, and resume the
  same original Task with an actual persisted `hexin/gpt-5.6-terra` worker before frontend implementation.

## Iteration 34 — user-directed clean project restart on Terra

### Recall

- The user explicitly replaced the same-Task continuation instruction with “启动新的测试项目”. The old persistent
  project, Mission, Task, System Under Test and all formal-database records must remain untouched and auditable;
  no deletion, reset or in-place conversion is authorized.
- The full Task C product, implementation, browser/MirrorTest and final-review acceptance remains unchanged. Every
  new agent invocation must use `hexin/gpt-5.6-terra`; canonical mailbox remains the sole progress-monitoring
  surface; the dev backend must use the formal database and the existing Vite process must remain untouched.
- The landed Iteration 33 infrastructure repair was committed as `c3192543b5` and pushed to
  `myhexin/v0.0.9beta`. The benchmark-owned backend was replaced from PID 12464 to PID 27608 using the same Bun dev
  serve command. `/global/health` confirms
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; Vite remains PID 3360 on port 5173.

### Preserved old-run defect and new identity

- The attempted old-Task wake was rejected before scheduling because the formal database contains terminal
  pre-Item-11 `orchestrator_tool_ownership` artifacts in the retired Build shape. The named failing row was
  `art_f73b855e0001LRp85yKmJkPbe2`; a read-only database audit found 88 retired-shape rows globally, including 34
  for the old benchmark Task, alongside 73 strict dispatch-owner rows for that Task. The strict parser correctly
  refuses `tool_name=build`, singular `child_session_id` and missing `target_agent_id`; adding compatibility parsing
  would violate the accepted single-source contract. Classification: generic development-database/schema-cutover
  defect, not expert-squad functionality or backend death. It remains recorded rather than deleted or rewritten.
- The user-directed new persistent project is
  `C:/Users/chuan/myhexin-local/benchmark-projects/crypto-trading-task-c-20260718-v2`. Mission
  `03be07739f546f9c`, session `ses_08ba9ffaaffeK1lgSwMSksz5Gz`, was created successfully at
  `2026-07-18T08:27:01.148Z` with exact requested model `hexin/gpt-5.6-terra` and prompt profile `general`. The first
  bounded canonical mailbox poll returned no messages yet; no log watcher or duplicate wake was started.

### Next action

- Continue only the new Mission. Wait for a canonical mailbox change or the 15-minute mailbox inactivity boundary;
  then verify the first actual worker's persisted provider/model metadata before accepting any squad result. Do not
  modify or delete the old project/Task, and do not attribute the preserved schema-cutover defect to the new squad.

## Iteration 35 — new Task enters requirements with verified Terra execution

### Canonical evidence

- The first new canonical mailbox event is `pev_f7458321d0014osq77VHfYLs27`. It created Task
  `tsk_f74575f4f001j34LSCooVBUXVr`, titled `Phase 01: 竞品调研与系统设计`, and reports progress `0.05` from
  `requirement-engineer` session `ses_08ba80952ffeggm0xU6fXeiXJV`. The message explicitly says the worker is
  validating the blank baseline and acceptance boundary and is not implementing product code yet. Evidence points
  to `.opencorvus/.r/t/Kb/OX6ryp/intent/request.md` in the v2 project.
- The actual worker trace at `.opencorvus/.r/t/Kb/OX6ryp/trace.jsonl` contains a persisted `llm_request` for that
  exact session and Task with `agentName=requirement-engineer`, `providerID=hexin` and
  `modelID=gpt-5.6-terra`. This is execution metadata, not title or configuration inference.
- Backend PID 27608 remains healthy on the formal database and Vite remains PID 3360. No log watcher, duplicate
  wake, restart or old-project mutation occurred.

### Continuation contract

- The existing five-minute thread heartbeat now targets only
  `C:/Users/chuan/myhexin-local/benchmark-projects/crypto-trading-task-c-20260718-v2`. Each wake must read this
  Recall, perform exactly one canonical mailbox poll, verify actual Terra metadata for newly observed workers, and
  use the 15-minute mailbox inactivity boundary before any bounded Task-state inspection. Phase 01 is active; full
  research, design, implementation, browser/MirrorTest and final audit remain unfinished.

## Iteration 36 — research and architecture advance with Terra workers

### Recall

- The full Task C contract remains unchanged: Phase 01 must deliver independently reviewable competitor research,
  technical design and an implementation roadmap before product implementation. The eventual product must still
  include the real database, deterministic market generator, matching/accounting, realtime transport, dense desktop
  trading surfaces, browser screenshots and MirrorTest acceptance. No static substitute or fallback is acceptable.
- Observation remains canonical-mailbox-only with one bounded poll per wake. A Task snapshot is permitted only after
  fifteen minutes without a canonical mailbox change. Every newly observed worker must be verified from persisted
  execution metadata as `hexin/gpt-5.6-terra` before its result is accepted.
- Landed sources reread before action: this record through Iteration 35, the benchmark-debug template, OpenCorvus
  debug-evidence instructions and its evidence-surface reference. No sub-agent was delegated because the user did
  not request parallel agents.

### Canonical evidence and classification

- The transcript already contained research event `pev_f745cfa93001UknJD46vt8PbXW`: the research investigator
  registered public evidence for all ten required products and reported its own progress `0.70`. Its Binance source
  returned 404 and was explicitly isolated for later replacement; Phase 01 cannot be accepted until the final
  research artifact cites an accessible official Binance source.
- This wake's single mailbox poll added `pev_f745dbbbb001JMKSbZtDosA2b9` from solution architect session
  `ses_08ba2a18affeLExG0rDvW5sols`. The architect confirmed the blank business-code baseline and limited Phase 01 to
  three documentation Goals ordered competitor research -> technical design -> implementation roadmap. Its `0.15`
  progress is worker-local and does not contradict the earlier research worker's `0.70` progress.
- Persisted `llm_request` rows for that architect record `agentName=solution-architect`, `providerID=hexin` and
  `modelID=gpt-5.6-terra`. A subsequently observed implementation worker,
  `ses_08ba01073ffeSKFiYowcMAeR4F`, likewise records `agentName=implementation-engineer`, `providerID=hexin` and
  `modelID=gpt-5.6-terra` in its persisted trace.
- Classification: normal General-squad Phase 01 execution. OpenCorvus dispatched distinct projected roles, retained
  the same Task identity and delivered the expected durable mailbox milestone. There is no scheduler instability or
  infrastructure repair trigger. The unavailable Binance citation is a squad research-quality obligation, not an
  infrastructure defect.

### Next action

- Do not inject, retry or restart while the Terra implementation worker has fresh persisted activity. Return to one
  canonical mailbox poll on the next wake. On Phase 01 terminalization, independently inspect the three committed
  documents and reject the phase if the Binance source remains inaccessible or any required research/design matrix
  is absent. Product implementation, visual browser evidence and MirrorTest remain unfinished.

## Iteration 37 — completed research Goal rejected and corrected in place

### Recall

- The complete Task C and Phase 01 contracts remain unchanged. A `goal.passed` mailbox event is only lifecycle
  evidence; independent artifact review must still prove all ten named competitors have accessible, attributable
  public evidence and that the required information-architecture, component, interaction, data-model and scope
  analysis is complete.
- Observation used exactly one canonical mailbox poll. Product-repository inspection began only because the poll
  reported a terminal Goal with a committed deliverable; no Task-status snapshot, session transcript or verbose log
  was polled. The same Task must own correction, without a duplicate Task, process restart or fallback source path.
- Landed sources reread before action: this record through Iteration 36, the benchmark-debug template, OpenCorvus
  debug-evidence instructions and its evidence-surface reference. The committed research artifact and its exact Git
  commit were then independently read. No sub-agent was delegated.

### Evidence and classification

- The single mailbox poll returned `goal.passed` event `pev_f74630508001n8P77dRaQc4Vfg` for research Goal
  `gol_f745fc7b7001E5WGH9x6tslsc`. Project commit `670270e` contains only
  `docs/research-and-product-design.md`; the next technical-design file is still untracked active-worker output and
  was not touched.
- The research document satisfactorily contains the ten-product table, retrieval dates, information-architecture
  comparison, page/component list, key interactions, market/trading data model, adopted scope, rejected scope and
  non-copying boundary. It nevertheless states in the Binance row, source limitation, downstream handoff and
  evidence index that its only Binance entry returned 404 and remains pending. This directly contradicts the Goal's
  all-ten-products acceptance and therefore invalidates the raw pass.
- Independent current-source lookup found the Binance-owned repository
  `https://github.com/binance/binance-spot-api-docs`, whose README identifies it as the official documentation for
  Spot APIs and streams and links the REST, WebSocket API, market-stream and user-data-stream documents. This is an
  accessible primary source capable of replacing the unresolved entry without inventing Binance behavior.
- Classification: General-squad research and self-verification defect. OpenCorvus dispatched the worker, persisted
  commit `670270e`, terminalized the Goal and projected exactly one mailbox event; no scheduling or mailbox loss is
  present. The defect is that the squad reported passed while preserving a declared acceptance gap.

### Corrective action and next evidence

- One natural operator message was injected into the same Task, naming the Goal, commit, four affected document
  locations and accessible official Binance source. It requires an in-place correction, direct-claim discipline,
  document/link checks, a committed repair and a canonical mailbox milestone. The route returned
  `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, `status=active`; no duplicate Task or direct
  child-session mutation occurred.
- Return to canonical mailbox observation. Accept the research Goal only after its corrected commit removes every
  pending/404 Binance statement, cites accessible official evidence and passes independent document review. The
  technical design, roadmap, implementation, browser/MirrorTest and final audit remain unfinished.

## Iteration 38 — completed technical-design Goal rejected for missing delivery surfaces

### Recall

- The full Phase 01 design contract remains binding: the design must name an implementable mature stack, define all
  required pages and business components, persist every required business entity, specify API and realtime contracts,
  describe deterministic market/matching/account behavior, quantify acceptance, and enumerate risks. A raw
  `goal.passed` event cannot replace independent inspection of those surfaces.
- This wake used exactly one canonical mailbox poll. Product-repository inspection began only after the poll reported
  the technical-design Goal terminal. No Task-status snapshot, session transcript, process restart or log monitoring
  occurred. The prior in-place research correction remains part of the same active Task.
- Landed sources reread before action: this record through Iteration 37, benchmark-debug instructions, OpenCorvus
  evidence instructions and evidence surfaces. Commit `64ff7d2` and all 297 lines of its technical-design artifact
  were independently reviewed. No sub-agent was delegated.

### Evidence and classification

- The single mailbox poll returned `goal.passed` event `pev_f74685069001odNRXf4Zy3V1sM` for Goal
  `gol_f745fc7b70021eWqtiaMby5lS2`. Project commit `64ff7d2` adds only `docs/technical-design.md`; the repository is
  otherwise clean at that commit. Its producing implementation worker was already proven from persisted trace as
  `hexin/gpt-5.6-terra`.
- The artifact is strong on seven listed routes, strict HTTP errors, snapshot/delta recovery, deterministic generation,
  matching, balance holds, fees, slippage, outbox transactions and accounting invariants. It nevertheless omits a
  required watchlists/alerts route, alert components, their API/events and `watchlists`/`alerts` storage. It also omits
  the explicitly required `ticks` persistence surface.
- The stack section names only generic categories and deliberately leaves chart, schema, Object-Relational Mapping
  (ORM), WebSocket and testing libraries replaceable. The Task contract instead requires a recommended local stack
  with reasons, including mature candlestick/indicator/table/validation/database/realtime/testing choices and
  Node-launched Playwright. The artifact never commits to a chart library, indicator calculation library/module or
  MA, EMA, MACD, RSI and Bollinger Bands delivery, and its page matrix has no depth-chart component.
- The five-item test list lacks numeric tick/WebSocket/browser-render performance thresholds, a complete security and
  data-consistency acceptance matrix, visual interaction measures and an explicit risk register with mitigations and
  evidence. These are binding Phase 01 design outputs, not optional implementation details.
- Classification: General-squad design and self-verification defect. OpenCorvus scheduled the Terra worker, persisted
  commit `64ff7d2`, terminalized the intended Goal and projected one canonical event. No generic scheduler, mailbox or
  ownership instability is implicated.

### Corrective action and next evidence

- One natural message was injected into the same Task and named the Goal, commit and all missing contract surfaces.
  It requires an in-place technical-design correction while preserving the already-requested research correction,
  document/link verification, a committed repair and canonical mailbox disclosure. The route returned
  `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, `status=active`; no duplicate Task or direct
  worker mutation occurred.
- Return to canonical mailbox observation. Neither the technical-design Goal nor Phase 01 may be accepted until the
  corrected commit covers every named page/component/API/event/table, concrete library choice, numeric acceptance
  and risk. Roadmap, product implementation, browser/MirrorTest and final audit remain unfinished.

## Iteration 39 — Binance research correction accepted; 5173 white-screen report diagnosed

### Recall

- The complete Task C contract remains active. Phase 01 still requires the independently rejected technical-design
  Goal to be corrected before its roadmap can run. The research Goal may be accepted only from the corrected commit,
  accessible primary sources, clean repository state and actual Terra execution metadata.
- This wake used exactly one canonical mailbox poll. The user's subsequent report that port 5173 was white added a
  runtime diagnostic requirement; browser and process inspection was therefore performed without reading benchmark
  process logs, restarting either service or mutating the Task. The existing browser-control skill was loaded and its
  real page/screenshot workflow followed.
- Landed sources reread before action: this record through Iteration 38, benchmark-debug instructions, OpenCorvus
  evidence instructions and evidence surfaces. No sub-agent was delegated.

### Corrected research evidence

- The one mailbox poll returned progress event `pev_f746c5375001nKQgMbSpyImC29` and a new terminal projection
  `pev_f746cb551001i2y9YLPlPSPEX2` for the same research Goal. Worker
  `ses_08b96ea33ffeYpNsvdNrCr9aRg` reported project commit `598c563`; its persisted `llm_request` records
  `agentName=implementation-engineer`, `providerID=hexin` and `modelID=gpt-5.6-terra`.
- Independent diff review confirms commit `598c563` replaces the inaccessible Binance entry, source limitation,
  downstream handoff and E01 index with the Binance-owned official Spot API/Streams repository plus its REST and
  market-stream documents. Exact residue scans find no `404`, `待复核`, `资料缺口` or retired
  `developers.binance.com` entry.
- Independent `curl.exe --ssl-no-revoke -L --fail` checks returned HTTP 200 and exit 0 for all three Binance URLs.
  The persistent-project worktree is clean and `git diff --check` passes. The corrected research Goal is therefore
  independently accepted; its initial false pass remains recorded as a General-squad self-verification defect.

### Port 5173 evidence and classification

- Listener inspection proves port 5173 remains Node/Vite PID 3360, created at 02:28:11, and serves `/` with HTTP 200.
  Backend port 7878 remains benchmark-owned Bun PID 27608 and `/global/health` reports healthy on formal database
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`. Neither process died.
- A real in-app browser navigation rendered the OpenCorvus shell. An intentional reload first exposed an empty DOM
  snapshot and a large white/skeleton content region, reproducing the user's observation, but the same page then
  hydrated the project tree, changed Connection Diagnostics to Online, and opened the current Phase 01 conversation,
  goals and live Terra worker. A final real screenshot shows the complete task surface; console error/warn capture is
  empty before and after task selection.
- Classification: no sustained Vite, backend or task failure is currently proven. The observable white region belongs
  to the reload/task-hydration window and recovered without restart. Concurrent Item 12 is editing overlay sources
  under the long-lived Vite process and may cause Hot Module Replacement (HMR) refreshes, but current evidence proves
  only temporal correlation, not causation; no speculative overlay patch is permitted.

### Next action

- Keep both services running. Return to canonical mailbox observation for the in-place technical-design correction.
  Reopen the infrastructure diagnosis only if 5173 becomes persistently blank, emits a browser error, stops serving
  HTTP 200 or fails to hydrate after a bounded reload. Roadmap, implementation, browser/MirrorTest and final audit remain
  unfinished.

## Iteration 40 — corrected technical-design Goal independently accepted

### Recall

- The complete Task C contract remains active. The corrected technical-design Goal must be judged from its committed
  artifact rather than its lifecycle label; Phase 01 still requires an independently accepted implementation roadmap
  before any product implementation may begin.
- This wake reread this record through Iteration 39, the benchmark-debug template, the OpenCorvus debug-evidence skill
  and its evidence-surface reference before acting. Observation remained mailbox-led and no process log, restart,
  retry, replacement Task or child-session mutation was used.
- The first attempted mailbox request used unsupported query value `view=all` and was rejected by the route's strict
  schema before returning a projection. The observer corrected its own parameter to documented `view=active` and then
  performed the wake's one effective canonical mailbox snapshot. This is an observer-command error, not an OpenCorvus
  mailbox or scheduler defect.

### Canonical and durable evidence

- The valid snapshot added worker milestone `pev_f74723d30001lUTsSEw6xJml8o` and terminal projection
  `pev_f7472ee6a001OYTt9hE4gS9KiF` for technical-design Goal `gol_f745fc7b70021eWqtiaMby5lS2`. The worker reported
  commit `dfe298d47575702e13ce71d6065e77a47bd95f5e` from session `ses_08b92a6d4ffeguZLVdsV8IMmVN`.
- Read-only formal-database evidence binds that session to the intended Goal and implementation-engineer role. Its
  original persisted user message and every sampled assistant message record `providerID=hexin` and
  `modelID=gpt-5.6-terra`; the terminal session event reports `reason=completed`. The mailbox milestone exists once
  with matching Task, Goal, Goal-run and commit identities.

### Independent artifact review

- Commit `dfe298d` changes only `docs/technical-design.md`; `git diff --check dfe298d^ dfe298d` passes. Review was
  performed against the committed blob, not the concurrently changing primary worktree.
- The correction now provides seven desktop routes including `/watchlists-alerts`, and each route row names its
  business components, HTTP resources, realtime topics, database tables and loading/empty/error/disconnected behavior.
  Watchlist and alert CRUD, ownership, tick-triggered events, audit/outbox transactions and reconnect behavior are
  defined across page, persistence, HTTP and realtime contracts.
- The schema contains the formerly missing `ticks`, `watchlists`, `watchlist_items`, `alert_rules` and `alert_events`
  surfaces in addition to the required market, account, order, fill, position and audit data. The implementation stack
  is concrete: React/Vite/React Router, TanStack Query/Table, Zustand, React Hook Form, Zod, Fastify,
  `@fastify/websocket`, PostgreSQL, Prisma, Lightweight Charts, `technicalindicators`, Vitest, fast-check and
  Node-launched Playwright, with role and selection rationale.
- The chart contract includes OHLCV, volume, crosshair, zoom, MA, EMA, MACD, RSI, Bollinger Bands and a `DepthChart`
  derived only from the real order-book projection. Numeric release criteria cover deterministic 10,000-tick runs,
  WebSocket latency/sequence, five-minute browser rendering, concurrent API behavior, plus explicit security,
  consistency, visual/interaction matrices and a risk register with mitigations/evidence.
- An exact committed-blob assertion over 33 named required surfaces found zero missing entries. The corrected design is
  therefore independently accepted. The earlier raw pass at commit `64ff7d2` remains a General-squad self-verification
  defect; the correction does not expose a generic dispatch, persistence, ownership or mailbox fault.

### Next action

- Do not inject or restart after this fresh terminal event. Return to one canonical mailbox snapshot on the next wake
  and independently review the implementation-roadmap commit when it is disclosed. Backend/data implementation,
  frontend/browser evidence, MirrorTest acceptance and final audit all remain unfinished.

## Iteration 41 — implementation-roadmap raw pass rejected for missing producers and inconsistent cardinality

### Recall

- The complete Task C contract remains active. Phase 01 requires a dependency-complete implementation roadmap whose
  downstream consumers have explicit earlier producers, whose measurable matrices agree with their named cases, and
  whose backend includes the requested strict test/diagnostic interface. A `goal.passed` event alone is insufficient.
- This wake reread this record through Iteration 40, the benchmark-debug template, the OpenCorvus debug-evidence skill
  and its evidence-surface reference. It performed exactly one valid canonical mailbox snapshot, then used bounded
  read-only database and committed-artifact inspection because that snapshot exposed a new terminal Goal. No process
  log, restart, retry, duplicate Task or direct child-session message was used.

### Canonical and durable evidence

- The mailbox added only terminal projection `pev_f7477a5ce001GGKfdjm6OFCfYg` for roadmap Goal
  `gol_f745fc7b7003GXnPdSTviqOZkf`; unlike the prior corrections, no worker-authored mailbox milestone disclosed a
  session, commit or verification. Formal-database chronology binds Goal run `f6c4dc52` to worker session
  `ses_08b8c9c35ffekJD8sToT2n7e5P`, followed by one terminal session event, one `goal.passed` and one
  `goal_run running→completed` event.
- The persisted session and all seventeen compactly inspected messages identify agent `implementation-engineer`,
  provider `hexin` and model `gpt-5.6-terra`. Project Git establishes commit
  `a0921b9aec1df044232db220ebf0e001e27d6bc4`, which adds `docs/implementation-roadmap.md` and crosslinks the two
  upstream documents. The commit diff is whitespace-clean.

### Independent rejection

- The roadmap correctly sequences database/generation before HTTP/WebSocket, matching/accounting before UI, real
  integration before browser work, and explicit `opentest` selection after a release candidate. It provides scoped
  Goals, dependencies, evidence, tests, numeric thresholds and risks. Those strengths do not cure three executable
  contract gaps.
- Both the technical design and roadmap claim eight scenario classes and require `5 × 6 × 8` verification, while
  both enumerate only the seven user-named classes: trend, range, wick, volume spike, gap, extreme volatility and low
  liquidity. Exact committed-text checks found three roadmap eight-count references, one design reference and seven
  actual scenario rows. The acceptance matrix is therefore internally contradictory.
- G6 requires watchlist and alert APIs/events to be already real, but G1 does not persist their tables and G3 does not
  implement watchlist CRUD, alert rules, tick evaluation, audit/outbox or account alert events. No G1–G4 stage owns
  those producers, so the roadmap asks the UI to consume a nonexistent prerequisite despite correctly forbidding UI
  mocks.
- The original Task requires a backend test/diagnostic interface. Exact scans found no diagnostic/health contract in
  either design or roadmap. Simulator control and audit pages do not define strict health, run/sequence or consistency
  diagnostics, their schema/error boundary, or a safe read-only interface that cannot bypass trading persistence.
- Classification: General-squad design, dependency-modelling and self-verification defect. OpenCorvus dispatched the
  exact Terra worker, persisted its run/session, terminalized it and delivered one canonical status event. The absent
  worker milestone is also a squad reporting-quality gap; there is no evidence of generic scheduler or mailbox loss.

### Corrective action and next evidence

- One natural message was injected into the same Task. It names the Goal/commit and requires the existing documents to
  normalize the matrix to seven scenarios, add watchlist/alert database and backend producers before UI, and define
  strict read-only diagnostic resources plus their page dependency, tests and security boundary. It also requires a
  committed correction, exact document/dependency checks and a worker-authored mailbox milestone with commit evidence.
- The route returned `appended=true`, `orchestratorWoken=true`, `executorResumed=false`, `status=active`. Return to one
  canonical mailbox snapshot on the next wake. Phase 01, product implementation, browser/MirrorTest and final audit
  remain unaccepted.

### Observer-boundary update

- After the correction injection above had completed, the user narrowed the benchmark operator role: Codex is an
  observer that may read mailbox evidence, repair infrastructure or expert-squad ownership defects and clean the
  benchmark environment, but must not simulate user intervention inside a running Task. This newer boundary
  supersedes the earlier in-place Task-correction practice for all subsequent iterations.
- The already-persisted injection is retained as historical evidence; deleting or disguising it would corrupt the
  chronology. No further Task injection, direct agent reply, operator steer, artificial retry or user-like phase
  advancement is permitted. Future artifact failures will be recorded and repaired only at their generic owning
  infrastructure or expert-squad source, followed by a fresh benchmark run when code reload is legitimately required.
- Because this Phase 01 sample has already received operator content, its later correction may prove defect recovery
  but cannot be represented as a fully autonomous squad self-correction sample. Canonical mailbox remains the only
  progress observation surface.
- The user subsequently made the rerun boundary explicit: accumulate a coherent defect batch, repair its generic
  owning source, then restart E2E with a new persistent project and new sessions. Neither this Mission, its sessions
  nor its project may be reused as post-fix acceptance evidence. The current Phase 01 batch comprises source
  verification, contract-coverage, producer/consumer dependency, measurable-cardinality, terminal self-review and
  worker-mailbox evidence defects; the next implementation step is a full call-site audit of the General-squad owning
  prompts/contracts and focused regression design, not another message to this Task.

## Iteration 42 — General-squad evidence-closure repair plan

### Recall

- The current objective is observer-only benchmark operation: read canonical mailbox, classify generic scheduling
  separately from expert-squad quality, accumulate a coherent defect batch, repair its owning source, and rerun E2E
  with a new persistent project and new sessions. Running Tasks must not receive simulated user intervention. The old
  Phase 01 project and sessions remain evidence only.
- Acceptance for this batch is generic: required external references are actually checked; explicit requirement sets
  remain enumerable; every downstream consumer has an upstream producer; measurable counts equal their named sets;
  a worker replays every acceptance item against final committed evidence; declared progress channels are honored;
  and the Orchestrator treats terminal lifecycle as evidence rather than automatic product acceptance.
- Hard constraints retained: prompt-over-host repair, no host gate/state machine/keyword router/fallback, no Task-C or
  cryptocurrency-specific rules, no active-task injection, one expert-squad projection source, tests with every
  change, and a fresh-project E2E after the batch is committed and the benchmark-owned backend is reloaded.
- Sources read before implementation: this record through Iteration 41, `AGENTS.md`, benchmark-debug and OpenCorvus
  evidence skills, expert-squad creator skill and checklist, `specs/README.md`, July index,
  `specs/current/architecture/04-extensions.md`, `99-principles.md`, the complete built-in General manifest/README,
  relevant role overlays and `general-package.test.ts`. No sub-agent was delegated.

### Full call-point inventory

- Package ownership is confined to `packages/opencorvus/src/expert-squad/builtin/general/**`; the manifest is loaded by
  `expert-squad/builtin/index.ts`, validated by `ExpertSquadRegistry`, and projected only by
  `PromptProfileResolver`. General is excluded from payload release and no project-installed duplicate exists.
- Runtime prompt call points are the General README scheduler append prompt, the scheduler role overlay, and twelve
  agent overlays declared by `expert-squad.jsonc`. `general-package.test.ts` validates all identities, overlays,
  effective prompt composition, dispatch targets, external-package isolation and payload exclusion. Registry,
  repository-package, scheduler-capability and prompt-profile suites are sibling projection consumers; none owns the
  domain behavior text.
- Relevant evidence-role overlays are `requirement-engineer`, `research-investigator`, `solution-architect`,
  `workload-reviewer`, `implementation-engineer`, `claim-verifier` and `system-integrity-reviewer`. Interface-specific
  roles are retained unchanged because the observed batch precedes rendered UI. Exact status/diff checks show these
  source and test files have no overlapping uncommitted edits.

### Root cause and design

- Observable symptom: three Phase 01 artifacts reached raw `goal.passed` while retaining an inaccessible required
  source, omitted explicit delivery surfaces, missing producer dependencies and contradictory scenario counts; one
  terminal worker also omitted the task-declared mailbox evidence.
- Direct trigger: workers and Orchestrator treated successful local document checks plus terminal reports as enough,
  without replaying all acceptance obligations against the final committed artifact or using the projected evidence
  reviewers for material risk.
- Deep cause: General overlays state role outputs but underspecify evidence closure. Research does not require each
  cited source to be accessible; planning roles do not require exact-set/cardinality and producer-consumer closure;
  Build does not explicitly reconcile every acceptance item and declared observation channel before passing; the
  scheduler overlay does not explicitly distinguish lifecycle completion from artifact acceptance.
- Repair the package prompts, not host code. Add generic role-local evidence duties and risk-based reviewer scheduling:
  requirement enumeration, source accessibility, dependency production, cardinality consistency, committed-artifact
  acceptance replay, visible channel adherence and adversarial review. These are natural-language judgment contracts,
  not automatic gates or a fixed pipeline.
- Regression: extend `general-package.test.ts` to prove those duties reach the exact effective role prompts and that the
  scheduler prompt retains lifecycle-versus-acceptance and reviewer guidance. Run focused General package tests,
  registry/projection siblings, typecheck, docs health and diff checks. After commit/reload, create a new persistent
  benchmark project and new Mission/session; never reuse the current sample as acceptance evidence.

### Scope correction before implementation

- The user then clarified the current priority: do not micromanage minor agent deviations or incidental artifact
  imperfections; focus on whether the agentic loop unexpectedly dies, stalls or dispatches incorrectly. This narrows
  the repair threshold without changing the observer-only, batch-and-fresh-E2E boundary.
- The Phase 01 citation, document-coverage and roadmap defects remain honest General-squad quality observations, but
  they did not cause a dead loop, a stuck Task or a wrong dispatch. The proposed General evidence-closure prompt edits
  would therefore overfit the squad to this document sample and were fully reverted before commit. Exact status and
  diff checks confirm the General package and `general-package.test.ts` are unchanged.
- The focused test run made the current concurrent platform refactor visible instead: the first dispatch test reached
  `dispatch-agent-tool.ts` and failed because its fixture ownership object lacks the newly expected
  `completeInvocation`; two later tests then hit their five-second limits. Those source/test boundaries are part of
  the independently active Item 12 ownership refactor and overlap semantically with uncommitted changes, so this
  observer must not patch or classify that in-progress state as a benchmark regression.
- Current action returns to mailbox-only observation. A repair batch will be opened only for evidence of loop death,
  true inactivity with no live owner, incorrect projected dispatch, duplicate lifecycle work, or another material
  stability failure. Any accepted repair must be followed by a new persistent project and all-new E2E sessions.

## Iteration 43 — correction attempts prove healthy agentic-loop recovery

### Recall

- The active objective now prioritizes material agentic-loop stability: unexpected death, genuine stall, incorrect
  projected dispatch or duplicate lifecycle work. Minor artifact drift is recorded but does not justify prompt or host
  changes. Codex remains a mailbox observer and must not simulate user participation in Task scheduling.
- This wake reread this record through Iteration 42 plus benchmark and OpenCorvus evidence instructions, then performed
  exactly one canonical mailbox snapshot. Bounded read-only database inspection followed only because the snapshot
  exposed new correction sessions and terminal lifecycle evidence. No process log, Task injection, reply, steer,
  retry, restart or artifact review was used.

### Mailbox and durable lifecycle evidence

- New mailbox milestones report technical-design commit `c29d107` from Goal run `c6f79ff5` / session
  `ses_08b8329b1ffeS0uL30X0KP13cv` and roadmap commit `d229c34` from Goal run `2cbd8da4` / session
  `ses_08b7cd7c7ffeoqoHOKqE7PuHi2`. Both identify the same original Task and intended Goals; neither creates a duplicate
  Task or project.
- Persisted message identity for each complete session is exactly `implementation-engineer`, provider `hexin`, model
  `gpt-5.6-terra`. The roadmap correction was preceded by an independent `system-integrity-reviewer` completion that
  named the remaining contract contradiction, demonstrating reviewer evidence was consumed before the next build.
- Technical-design attempt `c6f79ff5` persisted `queued→running`, a streaming Terra session, worker mailbox evidence,
  terminal `completed`, a new `goal.passed`, then `goal_run running→completed`. Roadmap attempt `2cbd8da4` persisted
  the same ordered chain. Its `goal.passed` event arrived just after the canonical snapshot and was observed only in
  the bounded database chronology for that disclosed run.
- The new `goal.passed` events are legitimate new-attempt terminal transitions, not replayed old projections: each has
  its own Goal run, session, mailbox milestone, terminal session and finalization records. No duplicate dispatch,
  orphan live owner, lifecycle divergence, wrong model or agentic-loop stall is present.

### Classification and next action

- Classification: healthy General-squad recovery and healthy generic scheduling. The earlier operator injection means
  this project cannot serve as post-fix autonomous acceptance evidence, but it does prove the existing loop remained
  alive, dispatched intended Terra roles, used independent review, and converged without infrastructure intervention.
- Do not inspect or micromanage the corrected document contents under the narrowed stability objective. Return to one
  mailbox snapshot on the next wake to see whether the Mission advances beyond Phase 01. Open a repair batch only for
  a material loop stability signal. No current code repair or service restart is justified.

## Iteration 44 — active Terra integrity owner disproves a Phase 01 stall

### Recall

- The observer-only benchmark remains focused on unexpected agentic-loop death, genuine inactivity without a live
  owner, incorrect projected dispatch and duplicate lifecycle work. Artifact-level drift does not justify Task
  intervention or a generic infrastructure repair. Any eventual repair batch must be followed by a new persistent
  project and all-new sessions.
- This wake reread the landed Recall through Iteration 43 and performed exactly one canonical mailbox poll. The poll
  wrote the previously disclosed Phase 01 items to the persistent transcript for the first time but exposed no event
  newer than the roadmap correction already verified in Iteration 43. No process log, Task message, retry, restart or
  artifact-content inspection was used.

### Bounded inactivity disproof

- A lack of a new mailbox milestone was not treated as a stall. Narrow read-only queries against the formal database
  found integrity session `ses_08b7968d9ffeiUCzeshn43pKoe` actively streaming under the Phase 01 Orchestrator parent
  `ses_08ba8941affecXMvoKJqW9ffyS`. Review progress and stream events continued within seconds of the snapshot.
- Latest-status projection shows the integrity child and its parent Orchestrator as `streaming`; every earlier
  requirements, research, architecture, Build and integrity child is terminal. There is one current child owner, not
  parallel duplicate work or an orphaned session.
- The integrity session's persisted user and assistant message data identify agent `system-integrity-reviewer`,
  provider `hexin` and model `gpt-5.6-terra`. This satisfies the exact-model constraint for the newly disclosed agent.
  Its protocol payload labels the review as attempt 2, while the earlier integrity session is terminal; the evidence
  therefore describes a sequential independent re-review rather than two simultaneous lifecycle owners.

### Classification and next action

- Classification: healthy General-squad review activity and healthy infrastructure scheduling. Phase 01 has not yet
  advanced, but it has a recent, correctly projected Terra owner and continuous durable activity, so no inactivity
  timeout, repair or service restart is warranted.
- Return to one canonical mailbox snapshot on the next wake. Only if the current owner terminalizes without forward
  scheduling, disappears without terminal evidence, becomes genuinely inactive, or overlaps a duplicate live owner
  should bounded causal reconstruction begin.

## Iteration 45 — Phase 01 terminalizes and Mission handoff remains live

### Recall and operating-mode update

- The benchmark still separates generic scheduling stability from squad-owned functional quality, uses the formal
  database and persistent project, observes progress through canonical mailbox rather than process logs, and requires
  every newly disclosed agent to use `hexin/gpt-5.6-terra`.
- The user explicitly superseded the pure-observer restriction after this wake began. Codex may again intervene in
  scheduling when that improves defect discovery and recovery efficiency. Historical operator-injection evidence is
  retained, and healthy live ownership is still not interrupted merely because intervention is authorized.
- This wake performed one mailbox poll. No second mailbox read, process-log monitoring, Task mutation, restart or retry
  was used. Bounded database inspection was scoped to the terminal Phase 01 event and its Mission handoff.

### Terminal and handoff evidence

- Mailbox item `pev_f748b327b0010i1DT1gtfS2Z9D` reports `task.completed` for Phase 01 Task
  `tsk_f74575f4f001j34LSCooVBUXVr`. Durable chronology orders the second integrity review pass, integrity-child
  terminal, final Orchestrator activity, Task/run completion, then Orchestrator terminal. This is a complete terminal
  chain rather than an unexpected agent death.
- The formal database contains exactly one Task for Mission `03be07739f546f9c` at the bounded snapshot, so Phase 02
  had not yet been persisted. That absence was not treated as a stall: Mission session
  `ses_08ba9ffaaffeK1lgSwMSksz5Gz` continued creating and completing assistant turns after Phase 01 terminalized.
- Compact part inspection shows the Mission using completed `panel` and `mission_state` calls and beginning another
  turn while the snapshot was being read. Its persisted messages identify author `mission`, provider `hexin`, model
  `gpt-5.6-terra`; there is recent activity and no competing Mission owner.

### Classification and next action

- Classification: healthy infrastructure terminalization and healthy Mission-level continuation. The Phase 01 squad
  completed its document stage and independent review; no scheduling repair, wake or restart is currently justified.
- Active-intervention mode now applies. On the next mailbox wake, verify that Phase 02 is created and assigned to the
  intended Terra identity. If the Mission instead stops after repeated state inspection without producing a new Task,
  inspect the tool result/decision chain and either resume it or repair the generic owning source according to the
  evidence.

## Iteration 46 — required expert-squad provisioning and stale-runtime failure plan

### Recall

- The user identified that the persistent benchmark project had not installed the expert squads required by the
  Mission. The benchmark must use the formal database, persistent non-deleted project, mailbox-led progress, exact
  `hexin/gpt-5.6-terra` agents, and explicit infra-versus-squad attribution. Active scheduling intervention is now
  authorized.
- The Mission contract starts under built-in `general` and explicitly requires switching to manifest ID `opentest`
  for final MirrorTest acceptance. `general` is intentionally the only built-in runtime package; every non-general squad
  must be explicitly installed under `.opencorvus/expert-squads/<namespace>/<id>` before it can be selected.
- Sources read before implementation: this benchmark record through Iteration 45, `AGENTS.md`, benchmark-debug,
  OpenCorvus evidence and expert-squad creator skills plus the expert-squad checklist, `specs/README.md`, July index,
  `specs/current/architecture/04-extensions.md`, current manager/routes/payload sources and the current Agent Skill
  metadata repair record. No independent Agent was requested or delegated.

### Evidence and classification

- The benchmark project has no `.opencorvus/expert-squads` directory and its project config has no non-general active
  package. Repository payload sources include canonical package `wujiang/opentest`; it is the one non-general package
  explicitly required by this Mission. Installing unrelated frontend-replica, frontend-innovate or mirror-watch
  packages would expand scope without a Mission requirement.
- Phase 02 Task `tsk_f748cea37001DZrDAyysCFU1Im` was created with exact model `hexin/gpt-5.6-terra`, then its Orchestrator
  failed before worker dispatch because global Codex system Skill `skill-creator` contains standards-defined
  `metadata.short-description` and the running process rejected top-level `metadata`.
- Current source already contains commit `e29bd7732e` and its accepted record extending the single strict Skill schema
  with string-to-string metadata; the benchmark backend predates that fix. Classification: missing squad is benchmark
  bootstrap ownership; the Phase 02 failure is stale benchmark runtime code, not a General/MirrorTest functional defect
  and not a new source defect.

### Full call-point inventory and plan

- Benchmark start ownership is `crypto-trading-long-mission.ts::main → preparePersistentProject → startMission`.
  Existing tests cover persistent project preparation, exact model/profile wake data, mailbox inactivity and transcript
  durability, but do not provision or assert required squad packages.
- Canonical installation is `POST /expert-squad/install-payload` →
  `ExpertSquadPackageManager.installPayloadPackage`; `GET /expert-squad/market` exposes manifest-owned availability and
  installed state. Bulk release would install every payload package, so this benchmark must install only explicit ID
  `opentest` at project scope and then verify it is installed before Mission creation.
- Add a benchmark provisioning function and call it before initial Mission wake. Fail visibly if the exact payload is
  absent, installation identity drifts, or post-install market state is false; do not add fallback, aliases, name
  guessing or automatic activation. Add a real HTTP-sequence regression proving Mission creation is never attempted
  before successful MirrorTest installation and proving existing installation remains idempotent.
- Provision the current persistent project through the same canonical route, reload only the benchmark-owned backend
  so commit `e29bd7732e` is active, verify health/catalog and installed `wujiang/opentest`, then resume the existing
  Mission/Phase 02. Preserve the failed Task and error evidence rather than deleting it.

## Iteration 47 — MirrorTest provisioning, coherent runtime reload and Phase 02 recovery

### Recall

- The active benchmark must keep the persistent project and formal database, use exact `hexin/gpt-5.6-terra`, install
  only Mission-required non-General squads, preserve the completed Phase 01 and failed Phase 02 evidence, and resume
  through normal Mission scheduling rather than editing database state. Codex may now intervene in scheduling, but
  progress observation remains mailbox-led and process logs are not monitored.
- This continuation reread the landed Iteration 46 plan before mutation. The relevant benchmark/bootstrap,
  expert-squad manager/route/payload and runtime-schema call points were already enumerated there; no sub-agent was
  delegated. The current main worktree also contains a separate uncommitted executor-removal refactor, so benchmark
  runtime and record changes must not absorb or rewrite that work.

### Canonical package installation and bootstrap repair

- The formal `POST /expert-squad/install-payload` route installed exactly manifest ID `opentest` at project scope as
  `wujiang/opentest`, with `installed=true` and `replaced=false`. The package now exists at
  `.opencorvus/expert-squads/wujiang/opentest`; market and catalog projections expose exactly built-in `general` plus
  installed `opentest`. Unrelated payload packages were not installed.
- Benchmark startup now provisions the declared `REQUIRED_CRYPTO_TRADING_EXPERT_SQUAD_IDS = ["opentest"]` before the
  initial Mission wake. It verifies an exact market identity, uses the formal project-scope install route when
  absent, rejects replacement/identity drift, and verifies installed state afterward. Existing installation is
  idempotent and a missing payload fails before Mission creation; no package is auto-activated and no fallback,
  alias, name guess or bulk payload release was added.
- Focused benchmark regression passed 12 tests / 43 assertions, including request ordering, idempotence and missing
  payload failure. OpenCorvus typecheck, the 21 historical-document tests and `git diff --check` also passed. Commit
  `109fd61a01` (`dsw-33987 provision benchmark MirrorTest squad`) contains only the bootstrap, regression and planned
  record changes.

### Runtime coherence repair

- Reloading the benchmark backend directly from the dirty main tree exposed `EBUSY` while it attempted to remove the
  formal database WAL. The dirty concurrent refactor has removed `engine_task.executor` from its DDL, so that process
  detected schema drift and tried to rebuild a database still legally held by the packaged Overlay sidecar. This is
  source/runtime incoherence from loading an unfinished concurrent schema, not a PostgreSQL ownership issue, a WAL
  retry problem or an MirrorTest defect. No retry/fallback was added and the packaged Overlay/Vite processes were not
  stopped.
- A persistent non-worktree runtime snapshot was created from coherent commit
  `109fd61a01e78d173a48d5ae356502ab377f74ad` at
  `C:/Users/chuan/myhexin-local/benchmark-runtimes/opencorvus-109fd61a01`. Its frozen dependencies were installed and
  the SDK output was built after the first launch correctly exposed that missing build prerequisite. The benchmark
  backend now runs that snapshot on port 7878; Vite remains on 5173.
- `GET /global/health` reports healthy version `local` and the formal database path
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`. Project market/catalog and Skill queries succeed, and
  `skill-creator.metadata` now contains `short-description`, proving the committed metadata schema repair is active.

### Recovery and newly exposed lifecycle projection defect

- A normal Mission resume returned the original Mission `03be07739f546f9c` and session
  `ses_08ba9ffaaffeK1lgSwMSksz5Gz` with `created=false`. The recovery message explicitly preserved the failed Task,
  skipped completed Phase 01, disclosed the installed MirrorTest package and repaired Skill loader, and required every
  new dispatch to use `hexin/gpt-5.6-terra`.
- Phase 02 Task `tsk_f748cea37001DZrDAyysCFU1Im` regained a Build owner without creating another Task. New session
  `ses_08b528640ffepS8QXjB06POlB6` has current runtime status `streaming`, continued tool activity and persisted
  assistant identity `implementation-engineer`, provider `hexin`, model `gpt-5.6-terra`.
- The Mission DAG simultaneously projects the pre-reload Build session `ses_08b691567ffeKsbqQcjYZp3WKi` as
  `streaming`, although the authoritative current runtime status map has no entry for it and its last message is an
  unfinished tool call from before the benchmark backend was stopped. Therefore there are not two live execution
  owners; the scheduler correctly created one replacement owner. The observable defect is generic infrastructure:
  process reload leaves the interrupted session without a persisted terminal status, and the durable DAG presents
  that stale session as live after recovery. This can mislead Mission/UI owner and progress projections even though
  recovery continues.
- Do not patch this symptom in the benchmark or add task-specific reconciliation. First inspect the active generic
  lifecycle/ownership refactor and its tests for session-settling ownership. If it does not already root-fix process
  interruption persistence, repair the single lifecycle owner with a generic regression covering reload, missing
  in-memory status, unfinished tool evidence and one replacement live owner. Until that overlap is resolved, continue
  the active Phase 02 through mailbox evidence and treat only the new Terra session as the live owner.

## macOS continuation — independent host Iteration 35

### Recall

- The current operator request repeats the complete task-C acceptance contract: autonomously run the long Mission,
  observe progress only through durable mailbox messages, distinguish generic scheduling infrastructure from
  expert-squad functional quality, repair every proven root cause, and finish real browser/MirrorTest review.
- The Windows formal database and persistent `-v2` project recorded in Iteration 34 are not mounted on this macOS
  host. They remain untouched historical evidence and cannot be resumed from the macOS formal database. Creating a
  host-explicit persistent project is therefore a new execution identity, not a replacement, migration, fallback,
  or duplicate wake of the Windows Mission.
- Acceptance remains General for research/design/product delivery, followed by an explicit
  `select_expert_squad` transition to manifest ID `opentest` for final testing. Every new worker must run as
  `hexin/gpt-5.6-terra`; mobile/tablet delivery remains outside scope.

### Environment and identity evidence

- Git `v0.0.9beta` was clean and exactly aligned with `myhexin/v0.0.9beta` at `be72eb452`. Ports 7878 and 5173 had
  no listeners before startup. The benchmark-owned backend now serves 7878 and `/global/health` identifies the
  formal database `/Users/yangheng/.local/share/opencorvus/opencorvus.db`; the benchmark-owned Vite process serves
  `http://localhost:5173/`.
- Persistent System Under Test:
  `/Users/yangheng/Documents/OpenCorvus-Benchmarks/crypto-trading-task-c-20260718-mac`. The canonical payload
  installer placed `wujiang/opentest` at the project-scoped namespaced package root with `replaced=false`; it did
  not activate the package or mutate the single `prompt_profile.active=general` source.
- Mission `83916b1c77cb6a2b`, session `ses_08b584564ffeCOT9Oul99lhFSk`, was created once with exact model
  `hexin/gpt-5.6-terra`. The real Vite control plane shows the Mission as Running and lists General as selected with
  MirrorTest available.
- Canonical mailbox recorded Phase 01 progress from `research-investigator` session
  `ses_08b55bdd4ffeldq6RAzd8ytVer` and `requirement-engineer` session
  `ses_08b55be0cffdl1z62AIls8l3nH`. Their first persisted `llm_request` trace rows independently record
  `providerID=hexin` and `modelID=gpt-5.6-terra`.

### Classification and next action

- Mission creation, Task dispatch, parallel worker sessions, exact model propagation and durable mailbox delivery
  are currently healthy. No infrastructure or squad defect is proven.
- The first Browser navigation to `127.0.0.1:5173` failed because this Vite invocation listens on `localhost`
  (IPv6); host curl and a fresh in-app Browser tab at `http://localhost:5173/` prove the page is healthy. This is a
  benchmark endpoint fact, not a Mission, scheduler, or squad failure, and requires no product repair.
- Continue bounded mailbox polling. Accept Phase 01 only after terminal mailbox evidence and independent artifact
  review; do not start or accept backend implementation before the research/design dependency is durable.

## Iteration 48 — Windows Phase 02 replacement owner remains healthy

### Recall and host identity

- This continuation applies to the Windows formal-database Mission `03be07739f546f9c`, persistent project
  `C:/Users/chuan/myhexin-local/benchmark-projects/crypto-trading-task-c-20260718-v2` and coherent benchmark backend
  snapshot on port 7878. The separately recorded macOS Mission is an independent host execution and does not replace,
  migrate or provide acceptance evidence for this Windows Mission.
- The full task-C acceptance contract remains unchanged: mailbox-led observation, exact `hexin/gpt-5.6-terra`,
  General-owned implementation followed by explicit MirrorTest selection and real E2E review, formal database,
  persistent project, no task-specific infrastructure behavior and no fallback/gate/state-machine repair.
- This wake reread benchmark-debug and OpenCorvus evidence instructions plus the landed record through Iteration 47,
  then performed exactly one canonical mailbox poll. No process logs, extra mailbox reads, restart, retry, Task
  mutation or database write were used.

### Mailbox chronology and identity evidence

- The newly persisted transcript contains the Phase 02 requirements and architecture milestones, the original Build
  start/milestone, terminal `goal.failed`, replacement Build start and replacement milestone. The ordering proves the
  first Build did real workspace work before the benchmark backend reload interrupted its final running tool call;
  the later failure notification precedes, rather than follows, the replacement dispatch.
- Replacement session `ses_08b528640ffepS8QXjB06POlB6` reports that the lockfile and unified tool commands are fixed,
  with format, lint, typecheck, test and build individually verified, and is proceeding to the documented clean-install
  chain. Its persisted latest assistant identifies `implementation-engineer`, provider `hexin`, model
  `gpt-5.6-terra`; its runtime status is currently `streaming` with fresh activity.
- Requirements session `ses_08b70b31bffecZ6QwQ6A7qzpjR` and architecture session
  `ses_08b6e9984ffeeL6YHPWvUYdMRr` also persist exact provider `hexin` and model `gpt-5.6-terra` and have completed
  assistant turns. The interrupted Build `ses_08b691567ffeKsbqQcjYZp3WKi` persists the same exact Terra identity but
  has no current runtime-status entry and retains an unfinished pre-reload assistant turn.

### Classification and next action

- There is exactly one current live Phase 02 execution owner: the replacement Terra Build. The old session remains a
  durable stale-live projection defect described in Iteration 47, not a second executing worker. The scheduler's
  replacement dispatch and current functional progress are healthy, so interrupting or restarting the new owner would
  reduce evidence quality rather than repair anything.
- The old session's missing terminal settlement remains a generic infrastructure lifecycle defect because it can
  mislead owner and progress surfaces after process reload. It is not caused by the crypto task or General squad.
  Preserve it for root repair at a safe stage boundary; do not patch the benchmark or mutate the database while the
  replacement owner is active.
- Continue with one mailbox snapshot on the next wake. Inspect durable status only when a new milestone or a real
  inactivity threshold requires it; advance/recover normally if the current owner terminalizes, and keep every newly
  dispatched worker on exact Terra.

## Iteration 49 — Windows Phase 02 first Goal passes at the stage boundary

### Recall

- This wake continues Windows Mission `03be07739f546f9c` and reread the benchmark/debug skills plus Iteration 48
  before action. It performed exactly one mailbox poll and only bounded public status/identity checks after that poll
  exposed a new terminal Goal. No process log, retry, restart, Task mutation or database write was used.
- Acceptance remains the complete long Mission, not the first Phase 02 Goal: exact Terra workers, General functional
  implementation, explicit MirrorTest transition, real browser/performance/security/consistency review and final
  second-party artifact audit are all still pending downstream.

### Terminal evidence

- Mailbox milestone `pev_f74b98ae3001sX4D2RQrcTLZJl` reports replacement Build commit `f5fcab3` and successful
  execution of the README chain `npm ci`, `format:check`, `lint`, `typecheck`, `test`, `build`. Terminal projection
  `pev_f74ba45aa001g5XC4m7M3Pw3e7` then records `goal.passed` for
  `gol_f74953c91001ozXI6uEffq11I3`.
- Direct repository evidence confirms `f5fcab3` is the benchmark project's current commit and contains the strict
  TypeScript workspace, lockfile, root quality configuration and empty future app/package boundaries. The only
  project working-tree differences are expected OpenCorvus project configuration and installed expert-squad package;
  they are not Build product files.
- Replacement session `ses_08b528640ffepS8QXjB06POlB6` now has authoritative runtime terminal status
  `completed` with a matching workspace summary. Its persisted messages already proved exact identity
  `implementation-engineer` / `hexin` / `gpt-5.6-terra`. The interrupted pre-reload session still has no current
  runtime entry, so no duplicate live worker exists.

### Boundary classification and next action

- Mission and Task projections remain running; Goal 1 is passed and the remaining four Phase 02 Goals are pending.
  No Goal 2 worker had been created in the bounded snapshot. Current runtime status contains neither the Mission,
  Task root nor Orchestrator session, while the just-completed Build has a terminal entry. This is a stage-boundary
  observation, not yet a proven stall, because the Goal terminal event is fresh and event-driven refill may occur
  after the snapshot.
- Do not mechanically wake or restart immediately. Use the next canonical mailbox wake as the activity boundary. If
  no new dispatch/milestone appears and the configured inactivity interval has elapsed since the Goal terminal event,
  reconstruct the Orchestrator finalization/refill tool chain and resume the existing Mission or Task through its
  normal public path. Preserve `f5fcab3` and do not create a duplicate Goal or Task.
- The repository historical-document test remains temporarily un-runnable in the main worktree because the separate
  uncommitted executor-removal refactor deletes a tracked browser test before updating every historical scanner input.
  That overlap is not patched here; this benchmark record remains uncommitted until the owning refactor settles or
  restores repository health.

## Iteration 50 — terminal-refill acceptance does not produce a real Orchestrator turn

### Recall and inactivity boundary

- This was the first real 15-minute Codex heartbeat after the operator explicitly prohibited frequent polling. The
  landed Recall, benchmark-debug instructions, OpenCorvus scheduler-evidence instructions and their bounded evidence
  templates were read before action. No process or verbose log surface was inspected.
- The last durable canonical mailbox event remained `goal.passed`
  `pev_f74ba45aa001g5XC4m7M3Pw3e7` at `1784369792422`. The heartbeat timestamp was `1784371397974`, about 26.8 minutes
  later, so one and only one canonical mailbox poll was permitted. It appended no event and printed no output.

### Scheduler and database chronology

- A bounded Task status/board/trace snapshot still showed Task `tsk_f748cea37001DZrDAyysCFU1Im` active. Goal 1 was
  passed at `1784369792422`; Goals 2–5 had no worker session and retained raw `pending` state even though the aggregate
  projection labelled them running. Orchestrator session `ses_08b730a10ffeJTKwBFFa2nGH8W` had entered idle at
  `1784368985284`, before the replacement Build completed.
- Read-only formal-database evidence proves the terminal Build session event at `1784369772398`, `goal.passed` at
  `1784369792422`, `goal_run.updated running→completed` at `1784369792433`, and then Task lifecycle event
  `terminal_goal_refill_dispatched` at `1784369792458`. No later Task protocol event, Orchestrator session event or
  Goal-2 dispatch exists.
- The lifecycle payload claims that the engine is “waking orchestrator for 1 refill decision”, but the claimed wake
  did not produce a real Orchestrator turn. Therefore the first bad transition is after terminal-goal persistence and
  before observable Orchestrator execution. This is a generic infrastructure scheduling/lifecycle defect, not a
  General squad functional failure and not specific to cryptocurrency work.

### Owning boundary and recovery plan

- Whole-repository search maps the single refill producer to
  `EngineRuntime.syncTerminalGoalRefills → dispatchTaskLoop(beforeAcceptedWake)`. The accepted callback records the
  refill fact before `dispatchTaskLoop` fire-and-forget launches `runTaskLoop`; existing unit tests prove callback
  ordering and mocked dispatch results but do not prove that an accepted refill creates a new observable Orchestrator
  turn under the real project/session lifetime.
- The relevant generic sources are `engine/runtime.ts`, `engine/queue.ts`, `orchestrator/loop.ts`, session standby/wake
  runtime-contract code and their focused tests. `engine/runtime.ts` currently contains unrelated uncommitted
  executor-removal edits, so no overlapping source edit is permitted until a focused real-chain reproducer identifies
  the exact owner and the concurrent change can be preserved.
- Recover through the normal existing Mission resume path after this proven inactivity, explicitly preserving Mission,
  Task, Goal 1 commit `f5fcab3`, Goals 2–5 and exact `hexin/gpt-5.6-terra`. Do not create a replacement Task/Goal or edit
  database state. Verify the next worker identity from durable evidence on a later mailbox heartbeat.

## Iteration 51 — normal Mission resume restores Goal 2 with one healthy Terra owner

### Recall and bounded mailbox evidence

- The previous normal Mission resume preserved Mission `03be07739f546f9c`, session
  `ses_08ba9ffaaffeK1lgSwMSksz5Gz`, the existing Phase 02 Task and Goal 1 commit `f5fcab3`. This heartbeat reread the
  latest Recall and local transcript before any network request.
- Exactly 15 minutes had elapsed since the prior mailbox check, so one canonical poll was performed. It appended two
  new Goal-2 progress events and no failure or attention request: worker session `ses_08b24bd51ffe9yxQnZoiXw7e1Q`
  started strict protocol contracts, then reached a 65% schema/rejection-matrix milestone at `1784372253556`.
- The worker reports real files `packages/contracts/src/index.ts` and
  `packages/contracts/test/protocol.test.ts`, three passing package tests and passing package typecheck. These are
  progress claims, not terminal acceptance; workspace-wide verification and independent artifact review remain due.

### Identity and classification

- Read-only formal-database inspection of the newly observed session's latest twelve messages records agent
  `implementation-engineer`, provider `hexin`, and model `gpt-5.6-terra` on every assistant turn. There is one current
  Goal-2 owner and no evidence of duplicate dispatch.
- The Mission resume successfully recovered from the generic terminal-refill launch gap without duplicating the Task
  or Goal. Goal-2 execution is currently healthy General-squad functional work, so no interruption, restart or new
  scheduling wake is justified. Continue with the next 15-minute mailbox heartbeat.

## Iteration 52 — Goal 2 terminal claim passes commands but fails independent contract review

### Terminal evidence and executable recheck

- One canonical mailbox poll at the 15-minute boundary appended Goal-2 completion event
  `pev_f74e1c9cc0011z5Z9YsFDRnMgX` and `goal.passed` `pev_f74e26fbd001GHYeiasohSnqSr`. The worker committed
  `6bf5196`, claiming the strict shared Zod contracts and workspace-wide quality commands passed.
- Codex independently inspected the full Goal-2 commit and reran
  `npm test --workspace @local-simulation/contracts -- --run` plus package typecheck. All three Vitest tests and
  typecheck passed. The commit is substantive (five files, 636 additions), not a placeholder or static claim.

### Functional quality defect

- Independent source review found `tickerSchema.priceChangePercent` bound to `decimalStringSchema`, whose pattern only
  accepts non-negative decimal strings. A real 24-hour ticker must represent down moves with a negative percentage;
  the current shared contract would reject every negative market move before the later generator/API/UI layers can
  consume it.
- Full project search finds no signed decimal schema or separate ticker percentage rule; the only caller is this
  contract field and tests contain no declining-ticker case. Therefore this is a proven missing domain rejection/
  acceptance case, not a naming inference. It is a General squad functional-quality defect in Goal 2, not an
  OpenCorvus scheduling defect.
- Goal 2 is not independently accepted despite its green terminal projection. The responsible repair must introduce
  one strict signed-decimal percentage contract, bind only percentage semantics to it, add positive/zero/negative and
  malformed regression cases, and rerun the declared package/workspace chain. Do not weaken monetary schemas or add
  parsing fallback. Because the Goal terminal event was less than 15 minutes old at this review and downstream owner
  state was not inspected, defer scheduling mutation until the next inactivity boundary rather than interrupting a
  potentially healthy owner.

## Iteration 53 — second terminal-refill launch gap and Goal 2 repair wake

### Repeated infrastructure evidence

- At the next 15-minute boundary, one canonical mailbox poll appended no new event. Goal-2 terminal evidence was then
  about 28.6 minutes old. A bounded Task snapshot showed Goals 1–2 passed, Goals 3–5 raw pending with no worker, and
  Orchestrator session `ses_08b730a10ffeJTKwBFFa2nGH8W` idle.
- Read-only protocol rows reproduce the same transition exactly: Goal-2 Build terminal at `1784372417914`,
  `goal.passed` at `1784372424636`, `goal_run running→completed` at `1784372424639`, then lifecycle fact
  `terminal_goal_refill_dispatched` at `1784372424763`, with no later Orchestrator or worker event.
- This second independent occurrence proves a generic deterministic infrastructure launch gap after an accepted
  terminal refill; it is not a one-off provider delay and not caused by Goal-2 contract code or the General squad.
  The runtime fact remains an acceptance claim, not evidence that `runTaskLoop` actually began.

### Recovery and repair contract

- Use the existing Mission resume path again without creating a Task/Goal. The wake must disclose Codex's independent
  Goal-2 failure: `priceChangePercent` rejects negative values. The Orchestrator must reopen/modify the existing Goal 2
  through its normal goal lifecycle, dispatch one exact Terra repair owner, add signed-percentage regression coverage,
  and only then continue Goal 3.
- Preserve `6bf5196` as the auditable failed acceptance baseline, keep monetary schemas non-negative, add no fallback,
  and require package plus workspace quality commands before re-acceptance. Separately continue the focused generic
  terminal-refill real-launch reproducer; do not patch the benchmark or database around the infrastructure defect.

### Reproducer refinement and rejected repair

- Formal artifact rows show both stalled completed Goal runs recorded `dispatch_result: "started"`, not `queued`;
  there is no pending `queued_operator_wake`. The ownership-completion drain path is therefore not the observed
  boundary. The gap is after direct dispatch acceptance and before a visible internal Orchestrator turn.
- A candidate change made `dispatchTaskLoop("started")` wait until the independent task-loop runner was invoked. The
  focused queue regression then timed out: during first project initialization, the caller retains the Instance write
  lease and an independent runner cannot acquire its lease until the caller returns. Awaiting runner start inside that
  caller creates a self-deadlock. The candidate was fully removed; source and tests are back to the concurrent
  executor-removal owner's pre-existing diff.
- This disproves “synchronously await runner acknowledgement” as a valid repair. Continue at the next safe iteration
  by reproducing the internal lifecycle wake through the real `runTaskLoop → Orchestrator.processTask → SessionPrompt`
  chain and by closing the existing silent-error boundary where `runTaskLoopInner` only logs an unexpected
  `processTask` exception. Do not infer the hidden exception from the lack of session events; make it durably visible
  with focused regression before changing launch semantics.

## Iteration 54 — repaired Goal 2 accepted and same Mission resumed after real inactivity

### Recall and acceptance evidence

- The complete Task C contract, exact `hexin/gpt-5.6-terra` identity, canonical-mailbox-only observation rule,
  persistent project/formal database boundary and infrastructure-versus-squad classification remain unchanged.
- Repair worker `ses_08b00c193ffeAonbGmzO6ukV2j` reproduced the negative-ticker failure, added the dedicated
  `signedPercentageDecimalStringSchema`, kept monetary decimals non-negative, passed the package/workspace command
  chain and committed `ffe3114`. Independent Codex inspection and reruns accepted the repair; Goal 2 is now accepted.
- The generic silent-error boundary in `runTaskLoopInner` was repaired in OpenCorvus commit `2b604a3d5c` so an
  unexpected Orchestrator decision exception terminalizes the Task with durable failure evidence instead of leaving
  an invisible active stall. Its focused five-test suite, package typecheck and the complete pre-push hook passed.
  The commit remains local because `myhexin/v0.0.9beta` advanced by six overlapping commits; integration is deferred
  until the concurrent executor-removal refactor can be preserved and the overlapping remote scheduler changes are
  fully reviewed. The benchmark runtime remains the coherent `109fd61a01` snapshot, so this source repair is not yet
  active in the running backend.

### Inactivity boundary and recovery

- At `2026-07-18T11:58:19.244Z`, more than fifteen real minutes had elapsed since the previous mailbox check and more
  than twenty minutes since repaired Goal-2 terminal event `pev_f75042269001DytO569oFHwytz` at `1784374633065`.
  Exactly one canonical mailbox poll was performed. It returned no new event; no status, database, process or log
  surface was polled.
- This is the third terminal-boundary instance of the already proven generic refill launch gap. With no fresh mailbox
  owner to interrupt, the normal Mission resume path was authorized. It preserved Mission `03be07739f546f9c`, Mission
  session `ses_08ba9ffaaffeK1lgSwMSksz5Gz`, Phase 02 Task `tsk_f748cea37001DZrDAyysCFU1Im`, Goal 1 and repaired Goal 2,
  and persisted `lastWakeAt=2026-07-18T11:59:15.248Z` with model `hexin/gpt-5.6-terra`.
- No replacement Task/Goal, database edit, restart or task-specific workaround was used. Return to mailbox silence
  until the next real fifteen-minute boundary, then perform one canonical poll and verify any newly observed worker's
  persisted provider/model metadata before judging progress.

## Iteration 55 — Goal 3 advances automatically; independent package-boundary review rejects its manifest

### Mailbox chronology and Terra identity

- At the next real fifteen-minute boundary, exactly one canonical mailbox poll appended Goal-3 start, test-first red,
  verification, commit `80ce0ae`, `goal.passed`, and Goal-4 start. The same Phase 02 Task advanced continuously after
  the prior normal Mission resume; no additional wake, restart, duplicate Goal or status poll was used.
- Goal-3 session `ses_08ae6e143ffeSlO1Sxsh9fAWsG` persisted 28 assistant turns and live Goal-4 session
  `ses_08ae0bc08ffe8i7vEXJUYpYmNy` persisted 37 assistant turns at the bounded identity check. Every row records
  `implementation-engineer`, provider `hexin`, model `gpt-5.6-terra`. Goal 4 has fresh activity and remains the sole
  live owner, so it must not be interrupted.

### Independent Goal-3 review and classification

- Commit `80ce0ae` is substantive: it adds `packages/config`, strict loopback-only HTTP/WebSocket validation, explicit
  error codes, credential rejection and ten Vitest cases. Independent commands
  `npm test --workspace @local-simulation/config -- --run`, package typecheck and package build all pass. Source search
  confirms no network connection, endpoint replacement or fallback path.
- The package source directly imports `zod`, but `packages/config/package.json` declares only
  `@local-simulation/contracts`; `zod` is merely a dependency of that sibling package. The current root npm hoist
  happens to make the undeclared direct import resolvable, but a different valid dependency layout may nest `zod`
  below contracts and make config fail to load. This violates the Phase-02 reproducible package boundary even though
  the current workspace commands are green.
- Classification: General-squad functional/package-quality defect in Goal 3, not infrastructure. Scheduler refill,
  session creation, Terra propagation, worker milestones, terminal persistence and automatic Goal-4 dispatch all
  worked. Preserve `80ce0ae` as the failed-review baseline; after Goal 4 reaches a safe terminal boundary, require an
  in-place Goal-3 manifest/lockfile repair with a regression that audits direct runtime imports against declared
  dependencies. Do not add a host fallback or interrupt the healthy Goal-4 owner.

## Iteration 56 — stale per-turn context and compaction pagination create a Goal-4 retry storm

### Mailbox and authoritative chronology

- The next single canonical poll exposed Goal-4 commit `1f509f8` and a valid first `goal.passed`, followed by six
  needless recovery Build sessions for the same already-completed Goal. Three recovery sessions completed after
  revalidating the unchanged commit; three failed with
  `Compaction tool result ... declares metadata.truncated=true without an authoritative outputPath`. Goal status
  oscillated between passed and failed while terminal refills continuously created another Goal-4 attempt.
- Protocol rows prove the first correct worker terminalized at `1784377130553`, `goal.passed` persisted at
  `1784377134239`, and `goal_run d87e02ad running→completed` at `1784377134260`. The same external scheduler wake then
  began Goal-4 run `dc32de97` at `1784377134883` instead of selecting pending Goal 5. Equivalent repeated begins
  continued through `f4177f78`; this is real redispatch, not duplicate mailbox projection.
- Two Orchestrator turns also failed strict parsing because a visible Skill description contained top-level
  `metadata`; the old runtime emitted durable `task.updated` failures rather than hiding them. Every newly observed
  recovery worker nevertheless persisted exact `implementation-engineer / hexin / gpt-5.6-terra` metadata.

### Classification and owning committed repairs

- Classification: generic infrastructure defects, not General-squad functionality. Commit `1f509f8` and its audit,
  tests, documentation and scope boundary were repeatedly revalidated; the repeated execution was caused by scheduler
  context and compaction lifecycle behavior after valid completion.
- Remote commit `1e2137f748` directly repairs the first cause by resolving the current durable scheduler system for
  every model turn rather than once per external wake. Its existing macOS reproducer records the same pattern: a
  completed Goal is redispatched because the next turn still sees the pre-completion snapshot. No Goal-ID gate or
  task-specific host rule is added.
- Remote commit `98549e425b` directly repairs the second cause: a tool-managed paginated message result with
  `metadata.truncated=true` but no `outputPath` remains authoritative in the persisted message part; an explicitly
  materialized output path remains strictly validated. The added regression reproduces the exact missing-path shape.
- The newer committed runtime also contains the strict Skill metadata schema repair and single-owner session-stream /
  prompt-settlement changes. Preserve the old failures as evidence; do not mutate the formal database.

### Coherent runtime validation and restart

- A persistent snapshot was created at
  `C:/Users/chuan/myhexin-local/benchmark-runtimes/opencorvus-4e842fd5e0` from pushed commit `4e842fd5e0`. Dependencies,
  the Windows process-supervisor helper and generated SDK were built inside that snapshot.
- The first combined test invocation hit two snapshot toolchain prerequisites: Bun's default five-second test timeout
  killed the first Cargo helper build, and the unbuilt workspace SDK could not resolve `@opencorvus-ai/sdk`. After
  building those declared prerequisites, the affected per-turn/session tests passed 6/6, compaction tests passed 7/7,
  session projection tests passed 17/17 and OpenCorvus TypeScript typecheck passed. The initial failures are tooling
  setup evidence, not product regressions or reasons to weaken timeouts.
- At a natural Goal-worker terminal boundary, benchmark backend PID 24200 and Vite PID 3360 were stopped by exact PID
  and verified command line. New snapshot backend PID 27800 and Node-launched Vite PID 29252 bound ports 7878 and
  5173; `/global/health` returned healthy and Vite returned HTTP 200. No unrelated OpenCorvus process was touched.
- Normal Mission resume preserved Mission `03be07739f546f9c`, session `ses_08ba9ffaaffeK1lgSwMSksz5Gz`, Phase 01, the
  Phase-02 Task and all commits/evidence. The wake accepts Goal 4 exactly once, reopens existing Goal 3 only for the
  undeclared direct `zod` dependency plus regression, requires the three design documents to satisfy `format:check`,
  then continues Goal 5 and the full MirrorTest contract. Persisted model remains `hexin/gpt-5.6-terra`; no duplicate
  Task/Goal or database edit was used.

## Iteration 57 — no-diff verification retry erases earlier delivered dependency evidence

### Recall and terminal evidence

- The full Task C Mission, exact Terra identity, canonical-mailbox observation boundary, formal database, persistent
  project, no-fallback/no-gate rule and final MirrorTest acceptance remain unchanged. This iteration follows one mailbox
  poll more than fifteen minutes after the repaired runtime resume; no process log was read.
- Goal-3 repair worker committed `c61a759`: `packages/config` now declares locked direct dependency `zod@3.24.4`, a
  workspace-generic runtime-import audit and three regressions prove missing declarations fail, the three design
  documents are formatted, and the complete 19-test/format/lint/typecheck/audit/build chain passes.
- Goal 4's real delivery remains commit `1f509f8`. Formal lineage proves run `d87e02ad` has the only delivered outcome
  and acceptance. Fourteen later attempts form one continuous `supersede_of` chain whose prior rows are all marked
  `superseded_reason=build_retry`; the final run `2d9a87ef` completed with `no_project_diff` because it only rechecked
  the already-committed files. The engine then failed the Task because Goal 5 saw only that final no-diff tip as
  `evidence_unsatisfied(actual_changed_files_empty)`.
- Every post-restart Goal-3/Goal-4 assistant session persisted `implementation-engineer / hexin / gpt-5.6-terra`.
  This is generic infrastructure evidence-selection failure, not a General-squad delivery failure.

### Full call inventory and repair design

- `deriveGoalEvidenceState` in `engine/goal-evidence.ts` is the sole dependency-readiness projection consumed by
  `engine/describe.ts` and `orchestrator/build-tool.ts`. It currently chooses only `goalRunTip(rows)`, then reads that
  tip's build outcome and acceptance.
- `listGoalRunsByGoal`, `findBuildOutcomeByGoalRun` and `findAcceptanceByGoalRun` are the authoritative append-only
  stores. `findLatestDeliveredGoalRun` already proves that delivered history remains canonical for file display, but
  it ignores supersede lineage and therefore cannot be reused directly for dependency readiness.
- `beginBuildAttempt` opens an ordinary repeated dispatch with typed reason `build_retry`; `startNewAttempt` uses
  `modify_contract`, `acceptance_rework` or caller-provided retry reasons when earlier evidence is intentionally
  invalidated. The latest failed/aborted/cancelled or running lifecycle must remain authoritative and must never be
  replaced by historical success.
- Repair the single projection source, not dispatch routing: when and only when the current tip is completed but its
  outcome evidence is unsatisfied, walk its exact `supersede_of` ancestry through consecutive parents whose
  `superseded_reason` is `build_retry`. Reuse the first ancestor with a satisfied delivered outcome and acceptance.
  Stop at every explicit non-build-retry invalidation boundary or broken lineage. Return refs naming both the current
  verification tip and retained delivered ancestor so the result is auditable. This is evidence lineage projection,
  not a Goal-ID gate, fallback, workflow state or database mutation.
- Add regressions to the existing real persistence fixture proving (a) delivered attempt followed by completed
  no-diff `build_retry` remains dependency-ready from its accepted ancestor, and (b) `modify_contract` followed by
  no-diff completion remains unsatisfied. Run the focused engine test, dependent describe/build-tool cases,
  OpenCorvus typecheck and `git diff --check`; commit separately with `dsw-33987`.

### Repair and verification

- `deriveGoalEvidenceState` now walks only the exact `supersede_of` ancestry of a completed no-diff tip and only across
  parents marked `build_retry`. It retains the nearest satisfied delivered outcome plus acceptance and reports refs
  for both the current verification attempt and delivered ancestor. A missing parent, a non-`build_retry` invalidation,
  a running/failed/aborted/cancelled tip, or an ancestor without delivered acceptance remains non-ready.
- The first regression attempt exposed that the pure persistence fixture had not installed the production ownership
  completion runtime. The fixture now appends the same authoritative terminal ownership artifact directly; it does
  not install a fake handler or bypass production code.
- `start-new-attempt.test.ts`: 19/19 passed, including both new lineage boundaries. Existing dependency projection /
  Build dispatch cases: 4/4 passed. OpenCorvus TypeScript typecheck passed, focused Prettier and `git diff --check`
  passed, and historical document links passed 21/21.

## macOS continuation — Iteration 36: stale same-wake scheduler context and duplicated streaming tool input

### Recall

- The operator requires autonomous completion of task C, mailbox-led observation, careful separation of generic
  scheduling infrastructure from expert-squad functional ownership, root-cause repair without task-specific gates,
  formal database use, and a persistent benchmark project. The newly attached screenshot asks why the Phase 02 task
  creation parameter visually repeats individual streamed fragments.
- Acceptance retained: scheduler execution must settle between real external wakes or, when it continues after a
  tool result in the same model loop, every model turn must receive the latest durable Task/Goal snapshot. The final
  persisted task request and its visible streaming representation must agree. Fixes require focused regressions,
  typecheck, runtime reload of only benchmark-owned processes when necessary, browser reinspection, commit and
  `myhexin` push.
- Hard constraints retained: no duplicate-dispatch gate, retry counter, cooldown, keyword rule, task-C branch,
  compatibility path, UI-only text de-duplication, hidden message, state machine, or log monitoring. The General
  package owns cryptocurrency implementation quality; host wake/context and message projection correctness belong
  to infrastructure.
- Read before implementation: this benchmark record through Iteration 35, `AGENTS.md`,
  `session/loop.ts`, `session/runtime-contract.ts`, `orchestrator/agent.ts`, `engine/describe.ts`, the runtime-contract
  wake tests, Overlay `events.ts`, `sse.ts`, `tree-writer.ts`, `InlineToolPart.tsx`, backend message/session protocol
  bridges, and the formal DB/AgentTrace evidence named below.
- Full-repository call-point audit: `SessionPrompt.loop`, `setSessionRuntimeContract`, `runOnce`, runtime system
  composition, `buildSystemParts`, `dispatch_agent`, terminal refill wakes, `message.part.delta`,
  `ProtocolStore.dispatchEphemeral`, session/task message bridges, Overlay SSE routing, delta buffering and raw tool
  rendering were grepped across production and tests. No independent agent was delegated because the user did not
  request sub-agent work.

### Scheduler evidence, causal chain and classification

- Phase 01 Task `tsk_f74a93fb3001m8VjeRmyJ2ZSuN` correctly persisted three passed Goals. The third Goal then acquired
  five completed Goal runs. Every repeated worker produced a real passed terminal report and a terminal refill wake;
  the worker/squad did not fail to finish.
- Orchestrator session `ses_08b56bf30ffeeysLFDgXELZ1Id` repeatedly called `dispatch_agent` for the same third Goal.
  Its corresponding assistant tool parts prove each call remained open until the child completed, then the same
  SessionLoop immediately began another model turn. Consecutive tool spans were
  `1784370067302–1784370139523`, `1784370148527–1784370228218`, and
  `1784370234365–1784370403666`.
- The three resulting AgentTrace `llm_request` rows have the identical system SHA-256
  `4d6218bbbf5d9843fbea331f6abd3b5f5bb28a80b2b75a3ac5f01fbe57bf347a`. That frozen prompt says
  `Execution attempts recorded: 2` and marks the third Goal `never_dispatched`. A fresh `describeTask` query against
  the same formal DB now reports seven attempts and five rows for the third Goal, proving the durable source advanced
  while the model-visible per-wake snapshot did not.
- Direct trigger: `dispatch_agent` is intentionally synchronous and returns child evidence to the same reasoning
  loop. `SessionLoop.processTurn` reuses the installed runtime contract's fixed `system` array on subsequent
  `tool-calls` turns. `runOnce` is consumed after the first turn but does not end the active loop because
  `shouldEnterStandby` excludes `finish=tool-calls`.
- Deep cause: `Orchestrator.processTask` calls `buildSystemParts` once per external wake, while one external wake may
  contain multiple long-lived model turns separated by completed agents. The source comment promises fresh DB state
  “on each invocation”, but the actual decision boundary is each model turn. The model therefore followed the stale
  authoritative statement and re-dispatched; every legitimate child terminal event made the loop observable again.
- Classification: generic infrastructure context-lifecycle defect, not a General-squad failure and not failed
  sleeping/wake delivery. Repair the runtime-system source so the scheduler resolves current durable context for
  each model turn. Do not teach the host to reject a repeated Goal ID.

### Streaming parameter evidence and current classification

- The screenshot shows the in-progress `panel.create_task` request with chunk-shaped repetitions such as
  `DecimalDecimal`, `packagespackages` and `send_mailbox_messagesend...`. The final formal `engine_task.request` for
  Phase 02 Task `tsk_f74c71884001Q2NeW3rroQtMp7` is clean. Both persisted `panel.create_task` tool inputs are clean,
  and the provider AgentTrace tool-call input is clean. The duplicate text therefore first appears after provider
  parsing and before/during the Overlay's transient raw-input projection; it is not the created Task contract.
- Backend `SessionProcessor` accumulates each `tool-input-delta` once in memory and publishes an ephemeral
  `message.part.delta`; the final `message.part.updated` replaces the raw accumulator with the clean parsed input.
  Overlay `tree-writer` appends every received raw delta without an event-identity check. A duplicated live delivery
  or overlapping session-stream projection therefore doubles only the transient text and disappears at final
  replacement, matching the screenshot and formal DB.
- Classification is generic infrastructure/UI message-projection correctness, not Mission planning quality. Before
  mutation, capture the exact duplicate delivery boundary with a production-shaped session-stream regression. Fix
  the single producer/subscription ownership if it emits twice; if transport replay is the proven source, consume
  each `live_sequence` once at the selected-stream boundary. Do not string-deduplicate content or hide the raw input.

### Repair plan

- Make the runtime contract's single `system` source support a per-turn resolver. Snapshot the resolver identity with
  the rest of the contract, resolve it inside each owned model turn, and keep array-backed worker contracts unchanged.
  The Orchestrator supplies one resolver that calls `buildSystemParts(requireTask(taskID), ...)` for every turn; the
  initial visible user message carries the natural request only, while the runtime contract remains the sole
  complete system source. Keep the latest resolved `TaskDesc` for post-turn scheduler-park classification.
- Add a behavioral SessionLoop regression where one scheduler wake produces two model turns around a tool call,
  durable state changes between them, and the second `LLM.stream` input contains the refreshed system while excluding
  the first snapshot. Extend Orchestrator session-reuse coverage to prove first and internal wakes install the same
  resolver-owned complete-system contract without persisting a second dynamic system source.
- Add a production-shaped session event-stream/delta regression that reproduces the screenshot's duplicate-delivery
  condition and identifies the first duplicated boundary. Correct only that owner, then assert each source delta is
  rendered once, the final parsed input remains clean, and reconnect/replay does not append an already-consumed live
  sequence.
- Run focused SessionLoop/Orchestrator and protocol/Overlay delta suites, both package typechecks, historical docs
  health and `git diff --check`; commit and push each independently proven repair. Reload only the two benchmark-owned
  dev processes as needed, then visually inspect a real streamed long `panel.create_task` input and continue Phase 02
  through canonical mailbox evidence.

### Scheduler repair and verification

- The scheduler runtime contract now has one `system` source that may be an immutable array for projected workers or
  a per-turn resolver for the projected scheduler. `SessionLoop.processTurn` resolves that source inside the existing
  runtime-contract ownership boundary immediately before composing each model request. The snapshot layer preserves
  the resolver closure exactly as it already preserves live tool/collector closures; it adds no persisted state or
  alternate context field.
- `Orchestrator.processTask` installs the same resolver for initial and internal wakes. Every invocation calls
  `buildSystemParts(requireTask(taskID), ...)`, so a second model turn after a long `dispatch_agent` receives the
  current Goal-run chain. The natural user message no longer persists a second copy of dynamic system context.
  Post-turn scheduler-park classification consumes the latest resolver-produced `TaskDesc`.
- The adjacent external-provider Build resume cast was narrowed from the whole runtime-contract union to the projected
  worker contract. This preserves its array-backed system ABI and prevents the scheduler-only resolver type from
  leaking into worker resume semantics; no runtime behavior or compatibility path changed.
- The new behavioral regression executes two model turns in one scheduler wake, advances its durable-attempt fixture
  between them, and proves the second request contains `Execution attempts recorded: 3` while excluding the first
  turn's value `2`. Session reuse now proves both initial and internal wakes install a function-owned complete runtime
  system and that the visible user message carries no dynamic system copy.
- Focused scheduler/runtime/standby/no-decision/core-prompt and historical-document verification passed 57 tests with
  322 assertions. The refined focused batch passed 6 tests with 49 assertions; OpenCorvus TypeScript typecheck and
  `git diff --check` pass. Manual diff review removed unrelated Prettier churn from `session/loop.ts` and
  `build/agent.ts` before acceptance.

### Streaming parameter root cause and repair decision

- The first duplicated boundary is the session protocol producer, not provider parsing or the persisted message.
  `GET /session/:sessionID/events` currently calls `subscribeSessionMirror` once per connected viewer. Every such
  mirror listens to the process-wide `GlobalBus` and republishes the same source event into the shared
  `ProtocolStore`; every connected session stream then receives every republished copy. Two overlapping viewers
  therefore turn one `message.part.delta` into two append operations. A final `message.part.updated` is also repeated
  but replaces the part idempotently with the clean parsed input, exactly matching the transient-only screenshot.
- Complete call-point audit: the only production caller of `subscribeSessionMirror` is the session SSE route; direct
  `mirrorSessionBusEvent` callers are protocol unit tests. `InstanceBootstrap` already owns the analogous singleton
  task-message bridge. Overlay `startSSE` owns one selected handle and discards callbacks from stale handles, so it
  cannot prevent amplification that already occurred in the shared backend store. Content de-duplication and
  client-side sequence gates would conceal the producer ownership error.
- Replace the viewer-owned mirror with one project-Instance-owned session protocol bridge initialized alongside the
  task bridge. It consumes the local project Bus once, projects only mission/assistant sessions through the existing
  mapper, and publishes one ephemeral protocol event independent of viewer count. The SSE route becomes a pure
  ProtocolStore subscriber. A regression will initialize the bridge twice (the former multiple-viewer amplification
  shape), publish one raw tool-input delta, and require exactly one protocol delivery.

### Streaming parameter repair and verification

- `InstanceBootstrap` now installs one project-local session protocol bridge next to the existing task-message
  bridge. The bridge subscribes to the project Bus once, derives the event's real session, and retains the strict
  mission/assistant projection. Session SSE connections now only subscribe to `ProtocolStore`; opening another
  viewer cannot create another producer or amplify shared events.
- The regression initializes the bridge twice, publishes the screenshot boundary token `Decimal` as a real raw
  `message.part.delta`, and observes exactly one session protocol delivery. A second regression proves projection
  failures still reject the source publish instead of being swallowed by a viewer-specific callback. The existing
  session-diff continuity test now traverses the same project-owned production bridge.
- Protocol/session route and Overlay single-write coverage passed 31 tests with 148 assertions. Historical-document
  health passed 21 tests with 70 assertions, OpenCorvus TypeScript typecheck passed, and `git diff --check` is clean.
  The Overlay tool-stream test emitted an existing missing-translation diagnostic for `common.active` while still
  passing; that independent observable defect remains queued for benchmark root-cause review rather than being
  mislabeled as part of this transport repair.

### Cancellation/runtime-contract teardown race

- Reloading the benchmark-owned backend after Phase 02's four Goals passed invoked the documented graceful shutdown
  cancellation path. The task's orchestrator session still had a background SessionLoop owner even though the task
  projection already reported success. Shutdown rejected its attached prompt callback immediately; the loop's model
  turn had not yet unwound its `SessionRuntimeContractStore.claimOperation(..., "session model turn")` owner.
- `Orchestrator.processTask` then entered its inner `finally` and synchronously called
  `clearSessionRuntimeContract`. That cleanup error replaced the original cancellation, was classified as a hard
  orchestrator failure because process shutdown did not abort the task-local controller, and polluted the otherwise
  validated Phase 02 task with `SessionRuntimeContract cannot clear during session model turn`.
- Full call-point audit: production contract clearing is owned by the Orchestrator's prompt `finally`; SessionLoop
  owns model-turn claims and `SessionPromptState.cancel` intentionally rejects callbacks before its background owner
  finishes. `SessionPrompt.waitForFinish` is the existing owner-settlement primitive. Normal successful wakes resolve
  at standby and intentionally retain a sleeping loop, so they must not wait for finish; only the exceptional path
  where `promptInFlight` remains true may await settlement before clearing.
- Repair the teardown ordering, not the clear invariant: after an exceptional prompt return, wait for the real prompt
  loop to finish, then clear the contract. Add a shutdown-shaped regression that keeps a model-turn claim alive after
  prompt rejection and proves cleanup waits for release, preserves the original error, and never writes the clear
  race into task state.

### Cancellation teardown repair and live stream recheck

- The Orchestrator now waits on the existing `SessionPrompt.waitForFinish` primitive only when the prompt exits while
  `promptInFlight` remains true, then clears the runtime contract. Successful wakes still clear immediately at their
  standby boundary, so the scheduler's sleep/wake behavior is unchanged. The shutdown-shaped regression holds a
  real `session model turn` claim for 25 ms after prompt rejection and proves the clear occurs only after release;
  task error retains the original shutdown cancellation and excludes the cleanup-race text.
- The cancellation suite also exposed two stale test fixtures, not production defects: the abort-cascade test still
  spied on the retired `SessionPrompt.cancel` wrapper instead of the current cancellation-scope primitive, and the
  cancel-route test omitted the now-required strict projected-worker binding. Both fixtures now traverse current
  production ownership and dynamic-squad projection paths.
- Focused teardown, reuse, refreshed per-turn context, strict cancellation-route and historical-document coverage
  passed 33 tests with 152 assertions; OpenCorvus TypeScript typecheck and `git diff --check` pass.
- After loading the single-owner session bridge, the real Mission resumed and created Phase 03 Task
  `tsk_f74df363e001SFX2Ls8ELj7hb5`. Browser inspection of the expanded `panel.create_task` call shows one clean
  request followed by one task-accepted result, with no doubled fragments. The Mission now reports three Tasks and
  Phase 03 running. This is the required real Vite/Browser recheck of the transient input repair; persisted input and
  the visible completed tool row agree.

### Iteration 37 — tool-managed pagination misclassified as lost output

#### Recall and evidence

- The operator requires all benchmark-exposed infrastructure defects to be repaired without weakening strict
  evidence rules. Phase 03's first schema attempt correctly failed because no PostgreSQL server existed. A persistent
  official Postgres.app PostgreSQL 16.14 cluster is now running outside the SUT Git worktree at
  `/Users/yangheng/Documents/OpenCorvus-Benchmarks/crypto-trading-task-c-20260718-mac-runtime/postgres16`, listening
  on `127.0.0.1:55432` with database `crypto_trading`; the Mission received the exact connection URL and binary path.
- The second schema attempt failed before database execution with
  `Compaction tool result ... declares metadata.truncated=true without an authoritative outputPath`. Formal DB part
  `prt_f74f194ac001QyNltd2zZy7fbk` is a `read` call with explicit `offset=1, limit=80`; it persisted the exact requested
  80-line page and an honest continuation marker (`Showing lines 1-80 of 821. Use offset=81 to continue.`). Its
  metadata has `truncated=true`, `lines=80`, `totalLines=821`, and intentionally no `outputPath`.
- Full call-point audit: `Tool.define` skips central `Truncate.output` when a tool owns `metadata.truncated`; central
  truncation always writes `outputPath`. `ReadTool` uses the same boolean for source pagination and intentionally has
  no output file. `CompactionToolResultReader` currently treats every true value as centrally lost output and throws;
  `compaction.ts` routes all true values through that reader. Existing Read tests require true/no-path pagination,
  while existing compaction tests cover true/path central materialization and missing declared files.

#### Repair decision

- Preserve both strict meanings without a fallback: `outputPath` is the discriminant for centrally materialized full
  output. When it is declared with `truncated=true`, compaction must read that file and must fail if it is missing.
  When a tool declares pagination with `truncated=true` but no path, the complete persisted tool result is the exact
  requested page in `state.output`, so that is the authoritative source for this tool call. Reject the inconsistent
  inverse shape (`outputPath` without `truncated=true`).
- Add a regression with the real read-pagination metadata shape and continuation text, proving compaction references
  and retrieves the exact persisted page as `message-part-output`. Keep existing central truncation-file and missing
  file tests unchanged. Do not suppress compaction, drop the result, or manufacture a path to the source file.

#### Repair and verification

- `CompactionToolResultReader` now uses the presence of `metadata.outputPath` as the single discriminant for a
  centrally materialized full result. Declared paths still require `truncated=true`, must be non-empty, must exist,
  and remain the only authoritative source. Tool-managed pagination without a path reads the exact persisted page;
  it is not treated as missing output.
- The regression reproduces the Read tool's true/no-path/line-count metadata plus continuation marker, proves
  `assertSources` accepts it, the reference declares `message-part-output`, and retrieval returns the byte-identical
  page with its SHA-256. Existing true/path and missing-file strictness tests remain green.
- Focused compaction-reader and Read-tool coverage passed 29 tests with 80 assertions. OpenCorvus TypeScript typecheck
  and `git diff --check` pass.

### Iteration 38 — goal progress falsely projected as terminal task success

#### Recall and evidence

- The operator requires scheduler stability to be judged from durable mailbox/task facts and requires safe backend
  restart only when no live worker or task owner exists. Phase 03 completed all three Goals and emitted durable
  `task.completed`; its PostgreSQL 16 migration, repository, deterministic seed/reset and isolated-schema integration
  evidence is authoritative. The full Mission remains incomplete and must continue with planned G3–G7 and MirrorTest.
- Before the backend restart, `/mission/83916b1c77cb6a2b/status` reported all three created Tasks as `success` and
  zero running Tasks. Formal DB evidence contradicts that projection for Phase 02 task
  `tsk_f74c71884001Q2NeW3rroQtMp7`: all four Goals were passed, but `engine_task.time_completed` was still null and its
  task-root/orchestrator session remained live pending an explicit terminal lifecycle decision.
- A previously queued operator message explicitly asked that old Phase 02 be “终止/收敛”. The Orchestrator therefore
  selected `manage_task(action="cancel_task")` in part `prt_f750dca76001TgrzWfu6K8tvpK`; this is the direct trigger
  for the later `task.cancelled`, not evidence that shutdown independently chose to cancel an already-terminal task.
  The tool itself ended with the external abort signal during the benchmark-owned restart, while `cancelTask`
  terminalized the still-active task as cancelled. The visible symptom is therefore: misleading status made the
  restart appear safe, then an explicit cancellation instruction and restart overlapped.
- Full call-point audit: `missionRecord/projectMissionTasks` projects `deriveTaskStatus` directly and would have shown
  Phase 02 as active. `/mission/:missionID/status` instead calls `missionStatusRecord` → `compileBoard` →
  `taskStatusDetailFromBoard`. `taskStatusDetailFromBoard` computes goal progress, then `statusFromProgress` returns
  `success` whenever every Goal is passed even when `board.task.status` is `active`; it likewise returns `failed` for
  a failed Goal or task-level agent outcome while task lifecycle is still active. Both Mission status and
  `/task/:taskID/status` consume this same projection. Existing status tests explicitly encode the premature
  active→failed projection and have no active-with-all-goals-passed regression.

#### Repair decision

- Task `status` must be the normalized projection of the task's persistent lifecycle facts. Goal and task-agent
  outcomes remain visible through `progress`, `goals` and `taskAgentOutcomes`; they cannot terminalize the task status
  before the Orchestrator calls `complete_task`, `fail_task` or `cancel_task`. This is a read-model correction, not a
  host gate or workflow state machine.
- Remove the progress-based task terminal inference. Add regressions proving (a) an active task with every Goal passed
  remains `running` with 100% goal progress, (b) an active task with a failed Goal/outcome remains `running` while the
  failure stays visible in progress/evidence, and (c) the Mission remains running until the task lifecycle becomes
  terminal. Preserve terminal completed/failed/cancelled lifecycle precedence.

#### Repair and verification

- `taskStatusDetailFromBoard` now uses the task lifecycle projection as its normalized task `status`; Goal and
  task-agent outcome states still populate the unchanged progress and evidence surfaces. Consequently, 4/4 passed
  Goals with an active task lifecycle report `running` and 100% Goal progress instead of terminal `success`.
- Focused regressions cover active/all-passed, active/failed-Goal, active/failed task-agent outcome, terminal completed
  history and Mission aggregation. The Mission/task status, workbench-board and Mission-route suites pass 39 tests
  with 178 assertions; OpenCorvus TypeScript typecheck and `git diff --check` pass.
- The Mission-route suite also exposed stale cancellation fixtures: it spied on the retired `SessionPrompt.cancel`
  wrapper, created a sessionless queued task that the now-strict real `cancelTask` correctly rejected, and called
  `Instance.disposeAll` from inside an active instance callback. The route test now spies on the production
  `SessionPromptState.cancel` primitive, isolates child cancellation at the route boundary, and lets the active
  instance callback unwind normally. This changes test evidence only; production cancellation strictness remains
  intact.

## Iteration 58 — schema-incompatible runtime cutover and failed-wake residue

### Recall and evidence

- The benchmark must preserve the formal SQLite database, completed Phase 01, failed Phase 02 evidence and the
  persistent project; all new workers must use the project configuration single source `hexin/gpt-5.6-terra`.
  Progress remains mailbox-only and no database row may be manually edited.
- After loading runtime `3a17e82d57`, the formal database path contained one fresh project/session and no engine
  tasks or Goals. The prior 97,832,960-byte database was preserved byte-for-byte as
  `opencorvus.schema-backup-2026-07-18T13-16-17.135Z-e1dcb1dd-537d-42ca-9ba0-be61845cc8fa.db`; the newly created
  database was 843,776 bytes. This is the current `Database.Client` schema-drift contract: rotate the old SQLite file
  to an explicit backup and create the current DDL, not an unexplained scheduler or PostgreSQL loss.
- Diff audit proves the incompatible cutover came from the concurrent external-task-executor removal, including
  removal of persisted `engine_task.executor` and run `executor` / `executor_ref` fields. Commit `327f6a9605` is the
  exact committed evidence-lineage repair before that schema-changing refactor and remains compatible with the
  preserved formal database. Loading the combined refactor mid-Mission was an operator/runtime-coherence error.
- The first `/mission/wake` after the reset returned `MissingModelConfigError` but had already created Mission session
  `ses_08aa1255fffe6D4K9ozR7VxBtv`. The second wake returned `created=false` for that residue, and the benchmark
  harness correctly rejected its mismatch with durable session `ses_08ba9ffaaffeK1lgSwMSksz5Gz`. Route chronology is
  `findExistingMissionSession` → config-reference validation → `ensureMissionSession` → `SessionWake.wake`; missing
  effective model resolution currently happens only inside the last step, after persistence.
- Full call-point audit: `/mission/wake` is the only server route that combines Mission creation and `SessionWake`;
  `panel.ts` calls `ensureMissionSession` under a different already-resolved tool contract. Existing wake tests cover
  malformed/unknown explicit models and prompt profiles before creation, but not a syntactically valid request with
  no effective model anywhere. `resolveAgentModelRef` is the sole model-resolution source.

### Repair decision

- Before `ensureMissionSession`, resolve the Mission model through `resolveAgentModelRef`: use the explicit request
  model when present, the existing Mission session overlay when resuming, otherwise the project base. This validates
  the runtime dependency before persistent creation while preserving the one resolver and strict missing-model
  error; it is data/lifecycle atomicity, not an LLM routing gate or fallback.
- Add a real route regression proving a request with no configured or explicit model returns HTTP 400, does not call
  `SessionWake.wake`, and leaves no Mission session row. Retain the existing invalid-explicit-model and concurrent
  wake tests.
- Build a persistent runtime snapshot from committed tree `327f6a9605`, verify its evidence tests, stop only the
  benchmark-owned backend/Vite processes, preserve the fresh incompatible database and WAL/SHM as recoverable files,
  copy the exact schema backup back to the formal database path, and restart against the compatible snapshot. Do not
  modify database rows, rerun completed Goals, or create a new Mission.

### Failed-wake repair and verification

- `/mission/wake` now calls the sole `resolveAgentModel` path before `ensureMissionSession`, using an explicit request
  model, the existing Mission session overlay, or the project base according to the resolver's existing precedence.
  A missing model therefore returns the existing named HTTP 400 error before any Mission row or runtime directory is
  created; the later `SessionWake` still consumes the persisted overlay and no second model source was introduced.
- The new route regression reproduces the benchmark failure with empty effective config and proves HTTP 400,
  `MissingModelConfigError(agent=mission)`, zero `SessionWake.wake` calls and no Mission session. The model-persistence
  suite passes 5 tests with 52 assertions. Mission route coverage passes, and the previously stale route-mechanics
  fixtures now declare an explicit test model and assert the durable overlay rather than the retired direct-wake
  model argument. Focused wake coverage for linked worktrees, prompt profiles and all strict input failures passes.
- OpenCorvus TypeScript typecheck, historical-document links (21 tests, 70 assertions) and touched-file
  `git diff --check` pass.

### Compatible runtime recovery and current blocker

- Copy-validation disproved `327f6a9605` as an old-schema baseline: its parent already removed
  `engine_task.executor`, so it correctly refreshed an isolated copy and was rejected without touching the formal
  database. An alternate Git index applied only the two evidence-lineage files to the last runtime proven against
  this Mission, `4e842fd5e0`, producing auditable commit object `570aac8757fb2486ce076491d159281bada71ba8`.
  Its tree differs from `4e842fd5e0` only in `goal-evidence.ts` and `start-new-attempt.test.ts`, while retaining the
  executor-bearing schema.
- Persistent runtime `C:/Users/chuan/myhexin-local/benchmark-runtimes/opencorvus-570aac8757` completed frozen
  dependency install, generated SDK build, release Windows process-supervisor build, lineage tests (19/19, 128
  assertions) and OpenCorvus typecheck. Opening a fresh copy of the 97,832,960-byte backup reported no
  `Database.schemaRefresh`, proving exact schema compatibility.
- Benchmark-owned backend PID 29508 and Node Vite PID 8812 were verified by port/command and stopped. Three unrelated
  Bun test processes blocking the database were then proven orphaned: each had run for roughly six to seven hours
  and each parent PID no longer existed. Only PIDs 6816, 27664 and 28932 were stopped.
- The database remained locked. Windows Restart Manager identified the exact remaining owner as PID 19744,
  user-installed Overlay embedded sidecar `opencorvus.exe`, parent PID 12308, started at 21:50. It is not a
  benchmark-owned process, so the recovery stopped before moving or overwriting any formal database file. Explicit
  operator authorization is required to stop that sidecar; after authorization, preserve the fresh DB/WAL/SHM,
  restore the hashed backup, start runtime `570aac8757`, and resume the same Mission/session.

### Compatible runtime recovery completed

- The operator explicitly authorized the Overlay restart. Before any stop call, exact PID revalidation showed both
  previously identified processes had already exited and ports 7878/5173 had no listeners, so no additional process
  was terminated.
- Recovery remained reversible: the fresh incompatible database was moved to
  `opencorvus.post-incompatible-runtime-2026-07-18T13-51-00Z.db`; no WAL or SHM existed to move. The preserved
  97,832,960-byte schema backup was copied back to the formal `opencorvus.db`. Source and restored SHA-256 are both
  `45E168DDA411AE46B96E4711D04BD77C5C441798268B5399DE8F0F0B457942DD`; no row was edited and the original backup
  remains present.
- Compatible runtime `570aac8757` now owns backend port 7878 and reports a healthy formal database. Vite is running
  on port 5173 through `node.exe`, returns HTTP 200, and is not Bun-hosted. Read-only formal-database verification
  found the original Mission session `ses_08ba9ffaaffeK1lgSwMSksz5Gz`, Mission ID `03be07739f546f9c`, persisted
  `hexin/gpt-5.6-terra` overlay, and failed Phase 02 Task `tsk_f748cea37001DZrDAyysCFU1Im` with its original evidence.
- The canonical benchmark resume returned the same Mission and session, `createdAt=2026-07-18T08:27:01.148Z`,
  `lastWakeAt=2026-07-18T14:02:26.969Z`, and exact model `hexin/gpt-5.6-terra`. There is no Mission/session identity
  drift. The resumed Orchestrator was instructed to preserve accepted Goals 3/4, re-evaluate Goal 5 from the repaired
  retry ancestry, continue through final MirrorTest secondary acceptance, avoid database edits, and report progress
  only through canonical mailbox messages. Mailbox was deliberately not polled immediately after wake.

## Iteration 59 — fresh E2E baseline and complete squad provisioning

### Recall

- The operator rejected the old-schema compatible runtime and authorized a direct fresh E2E restart on the current
  schema. Every known benchmark defect must be root-fixed, the dev backend and Node-launched Vite frontend must use
  the formal database, and required squads must be installed before the Mission proceeds.
- The operator then named the exact non-General package set: `frontend-innovate`, `mirror-watch`, and `opentest`.
  `general` remains the sole built-in runtime package and `prompt_profile.active` remains the sole active selection;
  provisioning must install packages without activating, combining, or silently replacing them.
- Acceptance for this setup iteration is: a clean runtime snapshot from the committed current schema; archived rather
  than deleted prior DB/WAL/SHM; focused regressions for retry evidence, Mission wake atomicity, dead-owner/queue,
  Hexin provider refresh and Overlay i18n; all three exact payload IDs installed and catalog-verified in the new
  persistent project before continuing the new Mission; exact `hexin/gpt-5.6-terra` model metadata.
- Hard constraints remain: no compatibility path, fallback, gate, state machine, task-specific scheduler branch,
  database row edit, hidden squad activation, verbose-log monitoring, frequent mailbox polling, or Bun-launched
  Playwright/Vite.
- Read before implementation: this record and its prior Recall; `AGENTS.md`; the benchmark-debug and OpenCorvus debug
  evidence skills; the expert-squad creator skill and complete checklist; `specs/current/architecture/04-extensions.md`;
  `specs/records/2026-07/README.md`; and
  `specs/records/2026-07/2026-07-17-all-expert-squad-runtime-audit.md`.
- Repository-wide call-point inventory found one benchmark provisioning source,
  `REQUIRED_CRYPTO_TRADING_EXPERT_SQUAD_IDS`, consumed only by `provisionRequiredExpertSquads` before
  `startMission`; its focused tests are all in
  `packages/opencorvus/test/benchmark/crypto-trading-long-mission.test.ts`. Package manifests prove canonical
  namespaces `builtin/frontend-innovate`, `myhexin/mirror-watch`, and `wujiang/opentest`; installation continues
  through the sole `ExpertSquadPackageManager.installPayloadPackage` route.
- No independent sub-agent was used because the operator did not request delegation and current collaboration policy
  does not authorize it.

### Repair plan

1. Replace the incomplete one-ID benchmark requirement with the exact ordered three-ID package set.
2. Generalize the focused provisioning fixture to prove missing packages are each installed once, installed packages
   are not overwritten, the post-install catalog verifies all three identities, and Mission creation occurs last.
3. Install the two missing packages into the already-created v3 project through the canonical payload route, verify
   all three catalog entries and files, commit the project baseline, and resume the same new Mission only if needed.

### SDK and package calibration audit

- The authoring SDK does not need a protocol calibration: its 12 focused tests pass, generated-client validation
  still uses the project-scoped Registry route, the SDK build is fresh, and scaffold/import/resolver coverage passes.
  It retains the correct split: SDK writes a new file tree, Registry validates semantics, and Manager owns explicit
  install/update/export.
- `frontend-innovate` is already calibrated for this Mission's frontend stage. Its selector and projected roles
  require competitor/reference screenshots, named design directions, mature component/library reuse, real data and
  state paths, a rendered source-editable design draft, real-page interaction/focus/error-state proof, visual review,
  and integrity review. It forbids static mock acceptance and fake controls.
- `opentest` is already calibrated for final functional, performance, security, consistency and visual acceptance.
  Its protocol-engine/runner, typed dispatch, source-skill parity and real projected package-tool chain pass.
- `mirror-watch` is not calibrated for task C. Its selector explicitly rejects generic product research and every
  non-AInvest product; its workflow, tools and tests require an AInvest-specific fixed F01-F10 feature set, two named
  experts, four fixed personas and deterministic 3-2-1 aggregation. Selecting it for cryptocurrency competitor
  analysis would violate its own contract. This is an expert-squad scope defect, not scheduler infrastructure.
- Full expert-squad execution reached 311 pass, one existing skip and two failures. The General failure is a stale
  test ownership fixture: production `dispatch_agent` now owns `completeInvocation`, while two fixture objects still
  expose retired `complete`. The Multica failure is also stale test data: `license` is now a valid canonical Skill
  frontmatter field, so it no longer creates the intended generated-package blocker. Production preview still calls
  `ExpertSquadRegistry.loadSourcePackage`; the negative fixture must use a truly unknown field and keep proving zero
  project writes.
- The first combined rerun exposed a third test-only resource race immediately after the unsafe-supporting-path loop:
  that loop called asynchronous `Bun.serve.stop(true)` without awaiting it and left the closing server in the shared
  cleanup set. The following identity test passed alone but intermittently lost its new local source server in the
  combined file. Await the close and remove that exact server from cleanup ownership before the next iteration; do
  not add network retry behavior to production Multica requests.

### Audit repair decision

1. Update only the two stale fixtures to the current ownership and strict Skill schemas, then rerun the affected tests
   and complete expert-squad suite. Do not weaken production validation.
2. Keep `frontend-innovate` and `opentest` unchanged.
3. Calibrate Mirror Watch at its package source rather than bypassing its selector. The calibration must be a generic
   financial-product competitor-research mode with explicit task inputs and evidence artifacts; it must not hardcode
   cryptocurrency, silently reuse AInvest personas, or add a second package identity. Preserve the existing AInvest
   delivery as an explicitly scoped workflow only if both modes can remain strict under one manifest-owned package.

### Calibration implementation and verification

- Mirror Watch remains one manifest identity and now exposes two explicit, non-fallback workflows. The existing
  `research-survey-report` path remains strictly AInvest-specific. The new
  `financial-product-competitor-research` path dispatches one goal-scoped
  `mirror-watch-competitor-researcher` for evidence-backed financial-product competitor analysis without projecting
  the AInvest personas, F01-F10 feature contract, voting tools or 3-2-1 aggregation into that worker.
- The new researcher prompt requires named competitors, a finite evidence plan, same-claim source URLs,
  observation/inference separation, information architecture, workflows, data/state models, mature component/library
  candidates and explicit adopt/defer/reject decisions. It forbids brand copying and forbids claiming the AInvest
  survey protocol unless the Orchestrator separately selects the original workflow.
- Benchmark provisioning now requires the exact ordered payload set `frontend-innovate`, `mirror-watch`, `opentest`
  before Mission creation. Focused coverage proves missing packages are installed, existing packages are not
  overwritten, every canonical catalog identity is verified, missing payload fails visibly, and Mission creation is
  last and idempotent.
- Generated payload is fresh and every payload source is tracked. The complete expert-squad suite passes 313 tests
  with 4,200 assertions and one pre-existing explicit skip; OpenCorvus typecheck passes. Benchmark coverage passes
  12 tests with 49 assertions, and historical-document health passes 21 tests with 70 assertions. Touched-file
  `git diff --check` passes.
- Final classification: no SDK or generic scheduler-infrastructure calibration is required. The only functional
  scope defect was owned by Mirror Watch and is repaired at the package source. The General and Multica findings were
  stale/racy test fixtures and were corrected without weakening runtime schemas, adding retries or changing product
  behavior.

## macOS continuation — Iteration 60: rendered-review capability projection audit

### Recall

- The operator requires task C to continue autonomously through real browser and MirrorTest acceptance, with progress
  observed from durable mailbox messages and defects classified at their actual ownership boundary. The immediate
  question is whether the Browser Model Context Protocol (MCP) chain failed and whether similar omissions exist.
- Acceptance retained: Build may use Node-launched Playwright for executable End-to-End (E2E) checks, but independent
  Visual QA must be able to open the task-scoped real page, inspect screenshots and interaction states, and register
  resolvable durable evidence. A preview-target artifact alone is not screenshot evidence.
- Hard constraints retained: `PromptProfileResolver` remains the sole capability projection source; do not inject
  Browser MCP globally, add a task-C branch, infer tools from prompt keywords, make `browser_preview` impersonate a
  browser client, or accept fabricated evidence identifiers. Package manifests declare domain capabilities.
- Sources read: this benchmark record, `AGENTS.md`, `specs/current/architecture/09-verification-evidence.md`, Visual QA
  agent/static/output tool code, Browser MCP builtin/config/permission code, PromptProfileResolver MCP projection,
  every repository expert-squad manifest, relevant package role overlays, and existing General/dynamic-package/
  Visual-QA tests.
- Repository-wide searches covered every `expert-squad.jsonc`, every `base_role` of `visual-qa`, `frontend-research`
  and `frontend-design`, every Browser MCP default tool ref, every prompt reference to Browser MCP/screenshots/real
  browser/rendered evidence, every `register_visual_qa_evidence` call and the final readable-evidence checks. No
  independent agent was delegated because the operator did not request sub-agent work.

### Runtime evidence and corrected ownership

- G5 Visual QA session `ses_08a485943ffdhpn4Im6KRpEtPw` invoked `browser_preview` once and no Browser MCP tool. Its
  database parts contain zero MCP/browser execution errors. The preview call persisted target
  `art_f75b85f0b001dWwj0kjW3M2s9J`, but produced no screenshot-bearing evidence.
- Formal project config materializes the builtin `browser` MCP server correctly. `PromptProfileResolver` already
  projects the exact declared Browser MCP refs for `frontend-replica-visual-reviewer`; its existing tests prove the
  scoped tool path and inactive-package isolation. The runtime chain therefore did not lose or fail an already
  declared tool.
- The General manifest declares no `default_mcp_tool_refs` for `visual-reviewer`. The direct cause is a General squad
  capability-package omission. This corrects the initial provisional infrastructure classification: the generic
  resolver and Browser MCP runtime are healthy; the active squad did not request the capability its own role needs.
- The Visual QA collector also accepted the invented syntactic refs
  `browser_preview_evidence:unavailable-fresh-rendered-screenshots` during incremental registration. Final submission
  correctly rejected them as unreadable, but delayed validation let false identifiers enter the check graph. That is
  a generic evidence referential-integrity defect in the Visual QA output tool, separate from the package omission.

### Similar-problem inventory

| Package / role                      | Browser MCP declaration                       | Evidence-backed decision                                                                                                                                               |
| ----------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend-replica-visual-reviewer`  | complete 17-tool browser set                  | Correct reference implementation; retain.                                                                                                                              |
| `frontend-replica-implementer`      | complete 17-tool browser set                  | Correct for implementation-owned rendered verification; retain.                                                                                                        |
| `general/visual-reviewer`           | none                                          | Defect: role owns fresh rendered and interaction review.                                                                                                               |
| `frontend-innovate-visual-reviewer` | none; only Browser Preview comparison helpers | Defect: comparison helpers do not provide ordinary navigation/screenshot/interaction.                                                                                  |
| `opentest-visual-reviewer`          | none                                          | Defect for optional GUI acceptance: runner output cannot replace direct fresh browser inspection.                                                                      |
| `frontend-innovate-implementer`     | none                                          | Defect: its overlay explicitly requires real-page screenshot, keyboard/focus and state verification.                                                                   |
| General `implementation-engineer`   | none                                          | Not proven as a package defect from its generic role overlay; G5 used real Node Playwright. Keep unchanged pending a role-level contract requiring direct Browser MCP. |
| `frontend-research` roles           | none                                          | Intentional: the stage consumes host-prepared webpage evidence and publishes investigation packets; do not broaden.                                                    |
| `frontend-design` roles             | no Browser MCP                                | Intentional in the current contract: source project/render helpers own draft materialization; do not broaden.                                                          |
| MirrorTest test implementer           | no Browser MCP; owns explicit command runner  | Intentional: executable Node Playwright belongs to the runner; independent browser judgment belongs to its visual reviewer.                                            |

### Repair plan

1. Add the already-proven 17 Browser MCP refs to the three rendered-review package roles and to the Frontend Innovate
   implementer whose own overlay explicitly owns real-page interaction verification. Do this in package manifests,
   not core prompts or role pools.
2. Regenerate the packaged expert-squad payload and extend General, Frontend Innovate, MirrorTest, Registry and Resolver
   tests to prove exact tool projection plus active/inactive package isolation. Reuse the existing Frontend Replica
   tool list as the behavioral contract; do not add a new host-side role gate.
3. Make `register_visual_qa_evidence` immediately resolve any claimed `browser_preview_evidence:*` against the current
   task/project when that context exists. Accept readable passed or failed evidence; reject missing/cross-task refs
   before collector insertion. Keep final operation/status acceptance checks unchanged.
4. Add incremental-tool regressions for nonexistent and cross-task Browser Preview refs, plus a readable failed
   evidence case. Run focused package/resolver/Visual-QA suites, payload trackedness/generation tests, OpenCorvus
   typecheck, document health and `git diff --check`.
5. Commit only benchmark-owned files with the `dsw-33987` prefix and push to `myhexin`. At the next true task idle
   boundary, reload only the benchmark-owned backend, retry the Visual QA stage, and require an actual Browser MCP
   screenshot/observe interaction in durable tool-call evidence before accepting G5.

## macOS continuation — Iteration 61: repair verification and reload boundary

### Implemented repair

- Added the exact existing 17-tool Browser MCP capability set to `general/visual-reviewer`,
  `frontend-innovate-visual-reviewer`, `frontend-innovate-implementer`, and `opentest-visual-reviewer`; no scheduler,
  global role pool, task-C condition, or host-side routing gate was added.
- Regenerated the built-in expert-squad payload from package sources. Repository projection tests now enumerate the
  complete Browser MCP ownership matrix and prove that sibling roles and inactive packages do not inherit it.
- `register_visual_qa_evidence` now resolves claimed `browser_preview_evidence:*` IDs in the current task/project
  before collector insertion. Missing, malformed, and cross-task references fail immediately; readable failed
  Browser Preview evidence remains valid diagnostic input and cannot become passing evidence at final submission.
- The only unrelated full-suite failure was a stale Multica test that treated the now-supported Skill `license`
  frontmatter as invalid. The canonical registry already intentionally accepts `license`; the regression now uses a
  genuinely unknown `unsupported_field` and still proves strict preview rejection before writes.

### Verification evidence

- `bun test packages/opencorvus/test/expert-squad --timeout 180000`: 314 passed, 1 skipped, 0 failed.
- `bun test test/visual-qa/output-tools.test.ts test/visual-qa/agent.test.ts --timeout 180000`: 37 passed, 0 failed.
- `bun run typecheck` from `packages/opencorvus`: passed.
- `bun test test/script/historical-docs-links.test.ts --timeout 180000`: 21 passed, 0 failed.
- Explicit `git diff --check` over the repair paths: passed.

### Durable mailbox result before reload

- The old runtime completed G5 Phase 06 and the follow-up Phase 07 as failed. Both failures independently report the
  same missing surface: the reviewer could see repository PNG/trace paths but had no task-level durable browser
  attachment/evidence ID or browser inspection capability. The reports did not contain a Browser MCP execution
  failure because the role never received those tools.
- Those tasks are terminal, so the benchmark is at a safe reload boundary. The next action is to commit/push this
  package and evidence fix, restart only the benchmark-owned backend, update the installed MirrorTest package through
  its canonical package manager path, and create a fresh G5 evidence-review task. Acceptance requires real Browser
  MCP tool-call evidence, not another prose assertion or local path.

## macOS continuation — Iteration 62: Integrity collector amendment contract

### Recall and repeated runtime evidence

- The fresh current-schema E2E Mission `01a03b3daabc3bc9` reproduced the same independent-review failure in two
  unrelated tasks. Phase 01's Integrity reviewer could not finalize after an evidence-graph validation error and was
  replaced by a fresh reviewer. Phase 03's reviewer then reported that a registered finding contained one evidence
  string that was not byte-identical to its cited check-item evidence and claimed there was no amendment/delete API.
- The Phase 03 substantive review still produced two valid simulator findings: the implementation used one shared
  xorshift stream instead of the required xoshiro256\*\*/SplitMix64 independent streams, and candle output omitted
  `tradeCount`. Those remain SUT/squad repair work and are not infrastructure findings.
- Repository-wide inspection covered every `register_integrity_*` tool, the consensus collector, check-graph
  validation, team-agent prompts and focused tests. `register_integrity_check_item`, reviewer, finding, round,
  required-repair and disagreement already use same-ID upsert semantics. The collector also remains open after a
  failed final validation. No new mutation engine or host workflow is required.

### Root cause and repair

- Root cause: the existing amendment behavior was invisible in both the tool descriptions and reviewer prompt. The
  final validation error reported only the graph mismatch and did not say that the collector remained open. The
  model therefore incorrectly inferred that reset/re-dispatch was the only recovery path.
- The Integrity evidence-row contract now states that every ID-bearing register tool is an upsert before final
  submission and that the same tool plus same ID overwrites the complete row. Check-item, reviewer, finding, round,
  required-repair and disagreement tool descriptions repeat their exact overwrite key.
- `submit_integrity_consensus` now states that validation errors leave the collector open. A check-graph failure
  returns an actionable recovery message: re-register the complete corrected ID-bearing row and retry; no reset is
  required. This is a prompt/capability-contract repair over the existing host behavior, not a gate or task-specific
  branch.
- Regression coverage creates detached finding and repair evidence, proves the first final submit fails, overwrites
  both records with the same IDs and supported evidence, and proves the second final submit records
  `needs_correction`. `bun test packages/opencorvus/test/integrity/team-agent.test.ts --timeout 180000` passes 19/19.

## Iteration 62 — Mirror Watch research-only planning closure

### Recall

- Mission `3779d1f866d5267d` remains the sole benchmark Mission in persistent project
  `crypto-trading-task-c-20260718-v3`; its exact persisted model is `hexin/gpt-5.6-terra`. Phase 01 and Phase 02/G1
  are terminal-successful and must not be rerun.
- Canonical mailbox event `pev_f75d9bc4c001llh8kRQMVgrvx3` reports that the bounded Mirror Watch secondary-review
  Task `tsk_f75d87aa6001TEtHwjv2qRMk9U` failed before domain dispatch because it had no durable research goal and no
  active task contract/spec snapshot.
- One bounded public task/status/board/trace snapshot and read-only formal-database inspection were taken after the
  explicit failure. The Task request contains the complete research scope, exact artifacts, acceptance criteria and
  evidence boundaries. Root session `ses_08a27831cffeXiJ4pMVnMpcWs8` persists
  `prompt_profile.active=mirror-watch` and `model=hexin/gpt-5.6-terra`; Orchestrator session
  `ses_08a2773d4ffeKG4DxA1E5FhkFp` is terminal. Database rows confirm zero goals, plans, plan nodes and decisions.
- The Orchestrator first issued one malformed `add_goal` call with null `reason`, then issued a complete goal contract
  with a real reason. The second call reached the owning persistence boundary and was correctly rejected with
  `no active task contract/spec snapshot; database unchanged`. It then failed the Task visibly. The malformed call is
  not causal because the corrected call reproduced the same structural blocker.
- Repository-wide inspection found that the new `financial-product-competitor-research` virtual workflow contains
  only goal-scoped `mirror-watch-competitor-researcher`, while its Orchestrator prompt assumes an already-existing
  durable goal. The only projected requirements and architect identities are explicitly AInvest-specific and cannot
  be used as a recovery path without violating the selected research-only contract.
- Classification: this is a Mirror Watch package workflow-closure defect introduced by the first calibration, not a
  generic scheduler/dispatcher defect. Task creation preserved the full input and the generic task manager correctly
  enforced referential integrity. No database edit, fallback, gate or task-C branch is authorized.

### Repair plan

1. Add research-only requirements and architect dynamic identities under the same Mirror Watch manifest. They must
   persist the bounded financial-product research contract and create exactly one executable research goal without
   loading or claiming AInvest personas, F01-F10, votes or aggregation.
2. Extend the immutable research workflow guidance and Orchestrator prompt to dispatch those two task-scoped planning
   owners before the existing goal-scoped competitor researcher. Keep the AInvest workflow and its owners unchanged.
3. Add package/projection tests for the exact three-node research workflow and a real architect-to-goal-to-researcher
   persistence regression. Regenerate payload, run focused and complete expert-squad suites, typecheck, document
   health and diff checks.
4. Commit and push with `dsw-33987`, build a coherent runtime snapshot, update the installed Mirror Watch package,
   then retry the failed secondary-review stage through the Mission rather than editing database rows or reusing the
   terminal failed Task.

### Repair and verification

- Mirror Watch `2026.07.18.1` now projects dedicated research-only planning owners:
  `mirror-watch-competitor-requirements-analyst` persists the bounded acceptance contract and
  `mirror-watch-competitor-research-architect` creates exactly one goal and one assembly owner before
  `mirror-watch-competitor-researcher` receives goal-scoped work. Neither planning role projects the AInvest delivery
  Skill or persona tool, and the separate eight-goal AInvest workflow is unchanged.
- The real persistence regression reproduces the formerly missing boundary with an active requirements snapshot,
  dispatches the new research architect, proves one active plan/goal/assembly owner, then successfully dispatches the
  exact competitor researcher through that goal. The existing AInvest architect promotion and no-orphan-goal
  regression continue to pass.
- Focused Mirror Watch package and persistence tests pass 15/15 with 556 assertions. Payload/repository projection
  tests pass 18/18 with 941 assertions, historical document health passes 21/21 with 70 assertions, and OpenCorvus
  typecheck passes.
- The complete expert-squad suite passes 315 tests with 4,263 assertions, one pre-existing explicit skip and zero
  failures. Generated payload trackedness/freshness and touched-file `git diff --check` pass.

## Iteration 63 — repeated compaction after post-summary tool growth

### Recall

- Mission `3779d1f866d5267d`, accepted Phase 01 and Phase 02/G1, failed evidence Task
  `tsk_f75d87aa6001TEtHwjv2qRMk9U`, persistent project `crypto-trading-task-c-20260718-v3`, formal database and exact
  `hexin/gpt-5.6-terra` model remain authoritative and must be preserved. The repaired Mirror Watch planning chain
  was exercised by the fresh Task `tsk_f7604f078001PgqCQoSiKGup4M`: requirements and architect completed, exactly
  one goal and one assembly owner were persisted, and the exact goal-scoped competitor researcher was dispatched.
- Canonical mailbox event `pev_f760e63330012390j9wuv9edsH` reports the fresh researcher terminated with
  `PromptBudgetOverflowError` after a valid structured compaction summary. One bounded public
  Task/status/board/trace snapshot and read-only formal-database inspection were taken only after that explicit
  failure; no additional mailbox poll or verbose process-log monitoring was performed.
- The researcher dispatch user text is about 1,933 characters and its frozen worker descriptor about 983 characters.
  Before the first summary, tool results had grown to tens of thousands of characters. After the valid 13,577-character
  structured summary, the same real turn accumulated new tool results of about 65,010, 46,461, 46,018, 84,019 and
  further characters before the provider overflow. Therefore the remaining prompt was not the already-summarized
  prompt: it contained substantial new, post-summary evidence.
- `SessionLoop.hasCompletedCompactionForSource` is used by all four automatic-compaction paths. Each path currently
  treats any valid same-source summary as proof that another compaction cannot shrink the prompt. Repository-wide
  call-site inspection covered the predictive branch, reactive provider-overflow branch, queued-control consumer and
  post-turn overflow branch. `SessionCompaction.process` additionally removes both the prior summary and its source
  user before selecting a compactable head, so a one-user long-running worker cannot form a second summary even when
  its post-summary tool history is large.
- Classification: repeated post-summary growth is a generic session compaction/lifecycle defect. The dispatcher kept
  the complete task input, the dedicated Mirror Watch workflow closed correctly, and the exact Terra worker started.
  Mirror Watch also exposed an independent squad self-stability defect: its bundled `web-read.sh` invokes undeclared
  `markitdown`, which is absent in the released runtime. These two defects must be repaired at their separate owners.
- Sources read and searched: this record and its prior Recall, public Task/status/board/trace surfaces, formal DB
  `session`/`message`/`part`/`worker_turn_descriptor` rows, every `PromptBudgetOverflowError` and
  `hasCompletedCompactionForSource` call site, `SessionCompaction` input selection/filter/prune logic,
  `Message.filterCompacted`/`toModelMessages`, predictive-compaction regressions, and the Mirror Watch web-read skill,
  script and package tests. No sub-agent was delegated because the operator did not request one.

### Repair plan

1. Replace the false binary “same source has ever been compacted” assumption with a compaction-coverage decision:
   a valid summary blocks a duplicate only when no provider-visible conversation material was added after that latest
   summary. Substantial post-summary assistant/tool work is a new compactable epoch and may produce another summary.
2. Make `SessionCompaction.process` select the new epoch from the same real dispatch anchor: preserve the source user
   as the immutable anchor, exclude prior valid summaries and already-compacted history, and summarize only material
   after the latest summary. Do not add synthetic messages, alternate sources, retries, task-kind branches or DB edits.
3. Add behavioral regressions for a same-source summary with and without post-summary growth, repeated input selection,
   and model-message filtering retaining only the newest handoff plus post-summary tail. Retain typed overflow when
   system/tool schemas or an unchanged summarized prompt are intrinsically too large.
4. Replace Mirror Watch web-read's undeclared CLI dependency with one declared single retrieval implementation owned
   by the package, update its Skill contract and package tests, regenerate payload, and prove the released package
   invokes no absent `markitdown` binary. Do not retain a dual-path compatibility branch.
5. Run focused session and Mirror Watch tests, the complete expert-squad suite, payload freshness, typecheck, historical
   document health and diff checks. Commit only owned paths with `dsw-33987`, push to `myhexin`, build a coherent
   runtime, canonically update the installed Mirror Watch package, then resume the Mission with a fresh Task while
   preserving both terminal failures as evidence.

### Repair and verification

- All four automatic-compaction decisions now distinguish an unchanged summarized prompt from a new same-source
  epoch containing provider-visible assistant, reasoning, tool, patch, file or snapshot material. A repeated epoch
  keeps the original real dispatch user as its anchor and compacts only material after the latest valid summary;
  no synthetic message, retry path, task-specific condition, database mutation or second source was introduced.
- Repeated-compaction regressions cover both sides of the decision, second-epoch input selection and final model
  projection after two same-source summaries. The expanded session suite passes 221 tests with 729 assertions and
  zero failures; OpenCorvus typecheck passes.
- Mirror Watch `2026.07.18.2` owns one declared web-read implementation through Jina Reader and strict `curl`
  invocation. The released script rejects malformed inputs, contains no `markitdown` dependency or alternate route,
  and a real retrieval of `https://example.com` returned Markdown successfully.
- Mirror Watch and generated-payload tests pass 20 tests with 564 assertions; the complete expert-squad suite is
  green, historical document health passes 21 tests with 70 assertions, and touched-file whitespace checks pass.
- The repair commit `1182427fce` and concurrent-safe merge commit `b36801dc95` were pushed to git-cc after the full
  pre-push typecheck, route inventory, API document, Overlay internationalization and secret checks passed. Persistent
  runtime `C:/Users/chuan/myhexin-local/benchmark-runtimes/opencorvus-b36801dc95` was built from that exact tree with
  frozen dependencies, generated SDK and release Windows process supervisor.
- Only benchmark-owned backend PID 19204 and Node/Vite PID 14768 were replaced. Runtime `b36801dc95` now owns backend
  PID 21400 and Node/Vite PID 19788; backend health is true against the formal database and Vite returns HTTP 200.
  The canonical package-update route atomically replaced installed Mirror Watch with `2026.07.18.2`; market state
  confirms `frontend-innovate`, `mirror-watch` and `opentest` are all installed.
- One normal wake at `2026-07-18T17:10:18.723Z` preserved Mission `3779d1f866d5267d` and session
  `ses_08a6afedaffevO4LkTTa1T9kQw`. It requires one fresh Phase 04 secondary-review Task, preserves both terminal
  failures as evidence, retains exact `hexin/gpt-5.6-terra`, and continues through the single active-squad protocol.
  No mailbox or status surface may be polled before fifteen minutes of real inactivity after this wake.

## Iteration 64 — repaired Mirror Watch delivery accepted; General G2 started

### Recall

- The current authority remains Mission `3779d1f866d5267d`, session `ses_08a6afedaffevO4LkTTa1T9kQw`, persistent
  project `crypto-trading-task-c-20260718-v3`, formal database and runtime `opencorvus-b36801dc95`. Phase 01 and
  Phase 02/G1 are accepted; terminal failed Tasks `tsk_f75d87aa6001TEtHwjv2qRMk9U` and
  `tsk_f7604f078001PgqCQoSiKGup4M` remain immutable failure evidence.
- After the recorded wake at `2026-07-18T17:10:18.723Z`, no durable mailbox event or check occurred for more than
  fifteen minutes. Exactly one canonical mailbox poll at the next heartbeat recorded the new events below; no
  verbose process logs, repeated status calls or intervention were used.
- Fresh Task `tsk_f7635c91b001uWHhUIq5SInubH` completed the repaired Mirror Watch research-only chain. Dedicated
  requirements and architect owners persisted the bounded contract, one goal and one assembly owner; the exact
  goal-scoped researcher delivered `docs/competitive-evidence-secondary-review.md` plus the permitted backlink in
  `docs/competitive-research.md`. Binance claims are bounded to confirmed resource/action/realtime/market-data
  categories, the other nine named competitors are recorded as no-change, and General design/roadmap files were not
  changed. Canonical terminal event is `pev_f7640f00b001CygjqkDUB2p3YE`.
- The Mission then selected General and created G2 Task `tsk_f7641c945001AlGqSwr4ISxyLX` for data migrations,
  idempotent seed and deterministic market generation. Requirements completed and solution architect session
  `ses_089bb8ad7ffeIBzeQ35xTf5jPB` reported healthy progress; there is no failure or inactivity evidence authorizing
  another wake or owner interruption.
- Read-only descriptor verification covers all three fresh Mirror Watch sessions and the two observed General G2
  sessions. Every descriptor persists explicit `hexin/gpt-5.6-terra`; Mirror roles project `expertSquadID=mirror-watch`
  and G2 roles project `expertSquadID=general`, proving the single active-squad transition and exact model contract.
- No defect is presently exposed. Continue mailbox-led observation only after another real fifteen-minute inactivity
  window; do not poll or schedule while the healthy G2 owner remains live.

### Subsequent G2 progress

- After more than fifteen minutes without a mailbox check or event, exactly one canonical poll recorded
  `goal.passed` event `pev_f765b007f001Tnh24uINgVsFV6` for G2 goal `gol_f76471205003uFyV7aoUM0qHm6`, covering the
  SQLite/Prisma migration, initialization and idempotent baseline seed. No failure, attention request, new worker
  session or terminal Task event was reported, so no scheduling intervention or additional status surface was used.
- The next eligible single poll recorded pass evidence for deterministic continuous market generation/aggregation and
  base simulator state (`gol_f76471205004cgF3ew4Bh0AsfR`) plus real-chain validation, hash audit evidence and quality
  records (`gol_f76471205005TiSS9bCxC7ztld`). It also recorded later pass events for the persistence and deterministic
  market goals. Repeated `goal.passed` titles alone do not prove duplicate dispatch or a lifecycle defect: they may
  represent an ordinary reopen-and-revalidate cycle, and no failure, attention request, new session identity or Task
  terminal event was reported. No status/trace/database expansion or scheduling intervention was used.

### Bounded repeated-pass diagnosis

- A later eligible mailbox poll recorded a third pass event for the deterministic-market goal while the Task remained
  nonterminal. Because this was the third same-goal pass without another mailbox category, the
  `opencorvus-debug-evidence` sequence was applied once: one public health/task/status/board/trace snapshot, one
  bounded follow-up after the first response was truncated, and targeted read-only formal-database rows. No process
  log, periodic status loop, cancellation, retry, restart or database mutation was used.
- The task root session is `ses_089be367effeedYJwU1baDeYxu` and its Orchestrator execution session is
  `ses_089be2e1fffePZDWypajsxRZxz`. The scheduler chronology proves the initial three Build owners completed, integrity
  review then reopened persistence and deterministic-market defects for ordinary correction Builds, and a second
  integrity pass subsequently opened a correction on the real-chain/hash-quality goal. Therefore the repeated
  `goal.passed` events are results of visible review-driven correction epochs, not duplicate concurrent dispatches.
- At snapshot `2026-07-18T19:00:40.919Z`, Task progress is 2/3 complete with zero failures. Current sole live owner
  `ses_08968aaf6ffe7F4FVy6XSXqkS4` is a goal-scoped `implementation-engineer` for
  `gol_f76471205005TiSS9bCxC7ztld`, is `streaming`, and had a persisted activity update about 31 seconds before the
  snapshot. Formal descriptor rows confirm this Build, the preceding integrity reviewer and preceding correction
  Build all use `expertSquadID=general` with explicit `hexin/gpt-5.6-terra`.
- Classification: healthy General-squad quality iteration, not an infrastructure scheduling/lifecycle defect. The
  first suspicious observable is explained by the persisted integrity chronology, there is no bad transition to
  repair, and the healthy live owner must not be interrupted. Resume mailbox-only observation after the next real
  fifteen-minute inactivity window.

### G2 terminal acceptance and G3 handoff

- The next eligible single mailbox poll recorded the corrected real-chain/hash-quality goal pass and canonical Task
  terminal event `pev_f76a560fc001qgSDZa10SJu4E1`. G2 completed after independent integrity artifact
  `art_f76a502cb001LwRvPbFnzHHEbn` reported `pass`, four reviewers and zero findings. The terminal evidence confirms
  a fresh isolated SQLite URL shared by migration, Prisma and market-data tests; WAL, foreign keys, 5,000 ms busy
  timeout, idempotent baseline seed, five symbols, seven segments, six intervals, continuous logical time and changed
  seed hash divergence. It also confirms G3/G4, REST/WebSocket, trading, frontend and MirrorTest were not started inside
  G2.
- The Mission naturally created General G3 Task `tsk_f76a63d89001MOb6PMTYpwikg2`. Requirements and architecture
  completed with three goals: persistent market REST/shared DTO/server-side indicators, realtime market recovery
  protocol, and real SQLite integration/quality verification. First goal `gol_f76ab37db0016Q6YWqfp2QM50Y` passed;
  a separate Build session already owns the second goal, with no failure or attention event.
- Formal descriptors for G3 requirements, architect and both observed Build sessions all persist
  `expertSquadID=general` with explicit `hexin/gpt-5.6-terra`; each Build is bound to its exact goal. No infrastructure
  or squad defect is exposed and no intervention is authorized while G3 continues healthy.
- A subsequent eligible single poll recorded passes for the realtime market recovery goal
  `gol_f76ab37db002Fx90bHFSevbav2` and real SQLite route/integration/quality goal
  `gol_f76ab37db0033tapol1juY5xX1`. G3 therefore has pass evidence for all three planned goals but no Task terminal
  event yet. Descriptor evidence confirms the third Build is exact-goal scoped and the newly started independent
  `system-integrity-reviewer` session `ses_08931a38dffeb5rz0inSzIXewC` is task scoped; both project General and explicit
  `hexin/gpt-5.6-terra`. This is a healthy review boundary, so no intervention or expanded status inspection was used.

## macOS continuation — Iteration 65: terminal refill reused stale worker ownership

### Recall

- The user required the fresh E2E Mission `01a03b3daabc3bc9` to continue autonomously from durable mailbox evidence,
  without compatibility paths, repeated task creation, verbose log monitoring, or infrastructure rules specialized
  to cryptocurrency behavior. OpenCorvus continues to use the formal SQLite database; PostgreSQL belongs only to the
  generated trading-system business data.
- Phase 03 Task `tsk_f76526fe8001alLMa5wHeWz1r1` received a valid independent `needs_correction` review. The responsible
  implementation owner repaired the deterministic simulator and completed goal `gol_f76575db9001fjSBuNl9Oj2UBv`
  at commit `6e92082`; durable `goal.passed`, terminal session, terminal dispatch ownership and
  `goal-refill-wake-dispatched` evidence all exist.
- Required acceptance remains the full benchmark matrix. This iteration repairs only the generic scheduling defect;
  simulator correctness and subsequent review remain expert-squad responsibilities.
- Read sources: this record and Recall; `orchestrator-core.txt`; task-description refill/closure rendering;
  runtime goal convergence tests; formal SQLite task, session, protocol-event, goal-run and tool-ownership facts.
- Repository-wide searches covered `goal refill`, terminal refill rendering, collaboration closure, dispatch ownership,
  review correction, task-loop wake tests and every current prompt assertion. After the user explicitly requested
  independent review, three read-only agents separately audited the architecture, liveness boundary and canonical
  message-source projection; none was allowed to edit or delegate further.

### Evidence and classification

- After the terminal refill wake, the Orchestrator emitted a prose-only stop claiming the repaired market-engine Goal
  was still held by its existing owner and that it would continue after terminal evidence arrived.
- The cited owner had already completed, its dispatch ownership was terminal, the Goal was passed, the refill fact had
  no live sibling goal runs, and the Orchestrator session then became idle while the task remained active.
- Causal chain: mailbox inactivity -> terminal owner and refill evidence -> refill wake accepted -> model reused stale
  historical ownership prose -> no real scheduler tool call -> active task stranded. This is a generic scheduler
  context/decision defect, not a simulator, expert-squad, PostgreSQL or mailbox-delivery defect.

### Rejected first design

- The first draft repeated the existing core-prompt rule that current refill facts outrank historical worker prose.
  This was not a root fix: commit `508222655` had already added that exact rule for an earlier occurrence, yet the
  current model turn still violated it. Repeating the sentence would overfit the prompt without closing the failure
  path. Draft commit `af2443971` existed locally, but it was never pushed or loaded by the benchmark backend; this
  design supersedes it by amending that unpushed commit rather than preserving a false intermediate repair.

### Repair design and verification contract

- Keep prompt-over-host behavior and the existing no-decision detector. Add no auto-retry, gate, state machine,
  keyword branch, retry counter or task-specific route.
- A detected `OrchestratorNoDecisionStopError` already persists one authoritative decision-contract artifact and then
  deliberately settles, because automatic self-wake previously amplified one stale decision into 80 repeated turns.
  The missing boundary is observability: the failure was absent from the only mailbox stream authorized for this
  benchmark, so the supervisor saw silence rather than a concrete recovery request.
- Persist one factual canonical `orchestrator.decision_contract.failed` protocol event in the same SQLite transaction
  as the failure artifact. Project it as an attention mailbox notification that cites the artifact, while leaving the
  task active and issuing no autonomous wake. This makes the real scheduler participant's failure visible without
  synthesizing a user message or copying a worker report. It is fail-stop plus durable escalation, not internal
  auto-recovery: this benchmark's outer supervisor, or an ordinary product operator, owns any later explicit wake.
- Regression tests must prove atomic artifact/event persistence, mailbox subject/body/evidence/source identity,
  repeated externally triggered failures remaining individually observable, and zero autonomous dispatch. After
  focused tests pass, amend the unpushed commit, restart only the benchmark-owned backend, and explicitly resume the
  same Mission once. Historical artifacts are not backfilled; if a later no-decision occurs, its new canonical event
  is the sole Mailbox recovery signal.

### Independent design review and local verification

- All three independent audits rejected prompt-only repetition, autonomous re-wake, task failure, synthetic worker or
  interaction messages, and a second scheduler. They independently converged on fail-stop plus durable escalation:
  one factual event linked to the authoritative artifact, non-waking Mailbox acknowledgement, and explicit external
  recovery ownership.
- The message-source audit found two additional integration obligations that the first implementation sketch missed:
  Overlay's tree writer must explicitly ignore this Mailbox-owned event, and every `mailbox.connected` frame must
  refetch canonical state so a disconnect cannot hide a committed failure. Both are implemented without alternate
  storage, replay cursors or client scheduling state.
- Focused persistence, scheduler, HTTP, Server-Sent Events (SSE), acknowledgement, Overlay event-policy and reconnect
  coverage passes 19 tests with 108 assertions. OpenCorvus and Overlay typechecks pass; route inventory, API docs,
  historical-document health and generated Software Development Kit (SDK) idempotence also pass. Runtime reload and
  same-Mission continuation remain required before this iteration is accepted.

### Runtime proof and supervised continuation

- Repair commit `f014a4426` and concurrent-safe merge commit `774324388` were pushed to git-cc after the full pre-push
  typecheck, route inventory, API docs, Overlay internationalization and secret checks passed. Only benchmark-owned
  backend PID `97899` was stopped; Vite PID `28172` remained live. The replacement backend reports healthy and names
  `/Users/yangheng/.local/share/opencorvus/opencorvus.db` as its database.
- Resuming Mission `01a03b3daabc3bc9` returned `created=false` with the original session
  `ses_08a1255beffeteQ6BBomCFXqrL`. Its completed turn persisted canonical event
  `pev_f76c3e786001ml3nXClEbdMZca` and linked artifact `art_f76c3e785001dRHUbrPQRCk2Hd`; the event exposes the exact
  stale-owner no-decision text, remains an attention Mailbox item, and caused no autonomous replay.
- The external supervisor used that durable item for one explicit same-Mission recovery. Two subsequent bounded
  Mailbox windows contained no new event, which is not sufficient evidence of a deadlock and does not authorize a
  second wake. Thread heartbeat `task-c-mailbox-supervisor` now checks only durable Mailbox every fifteen minutes and
  otherwise sleeps. Full Mission and browser/MirrorTest acceptance remain unachieved and must continue.

## macOS continuation — Iteration 66: Phase 03 conversation identity projection

### Recall

- The user reported that Phase 03 could not be opened in Overlay and then explicitly requested the UI bug be fixed.
  Acceptance requires the real Phase 03 button to hydrate the existing conversation, preserve every worker and helper
  message, show a bounded actionable error rather than a blank workspace when hydration fails, and pass a fresh
  Browser screenshot review. The same Mission, Task, formal SQLite database and persistent project remain authoritative.
- Hard constraints remain: no compatibility or fallback path, no Phase-03-specific branch, no hidden/synthetic message,
  no filtering of real compaction messages, no second identity source, no database mutation, and no interference with
  the live Mission owner. Session owner identity must remain sourced from the persisted worker descriptor/agent ledger;
  each message participant identity must remain sourced from its real persisted message author/agent.
- Read sources: this record and its Iteration 65 Recall; `conversation/view.ts`; task/session conversation routes;
  message bridge and session mirror; Overlay task selection, conversation hydrate, tree writer, board store, diagnostics,
  Conversation component, styles and locales; formal `session`, `message`, `part` and `worker_turn_descriptor` rows.
- Repository-wide searches enumerated every `projectConversationView`, `projectConversationAgentView`, `overlayMeta`,
  `hydrateConversationView`, `ensureSessionProjection`, `taskSwitching`, task-selection error/diagnostic and loading-state
  call site across OpenCorvus and Overlay production/tests. The only server projections are task hydrate, task session
  history, task older history, standalone session hydrate and their agent-ledger sibling projection. Overlay live and
  hydrated paths both currently pass per-message `agentID` into a session-owner invariant.

### Evidence, classification and repair contract

- Browser reproduction against `http://127.0.0.1:7878/ui/` selected the exact Phase 03 row while the connection stayed
  Online, but the main surface remained `New Mission`. The canonical conversation request returned HTTP 500 in 35 ms:
  `projectConversationView: session ses_0893a9567ffeM5xkuuX80qPbPr agentID drift: compaction -> source-investigator`.
- Formal SQLite proves one projected `source-investigator` worker descriptor for that session and real interleaved
  assistant messages authored by `source-investigator` and the registered `compaction` helper. This is normal runtime
  participation, not squad identity corruption. The infrastructure conflates truthful message participant identity
  with the execution session owner, then Overlay repeats the same invalid equality check.
- Introduce one explicit DTO distinction: `ConversationSessionView.agentID` remains the canonical session owner while
  `ConversationMessageView.agentID` remains the truthful message participant. Registered helper messages may differ
  from their owner; two different non-helper owners remain a hard error. Server view projection must consume the
  already-existing agent ledger, and live message envelopes must carry the same persisted session owner separately
  from message participant identity. Overlay indexes the session by owner and the message card by participant.
- Task selection failure must preserve the selected Task, clear the busy state, persist one structured selection error,
  and render a real inline error with retry through the ordinary `selectTask` path. A later successful selection clears
  the error. Tests must cover helper-before-owner, owner-before-helper, non-helper drift rejection, bridge and live-event
  owner identity, hydrate owner/participant separation, failed-selection error/retry, and unchanged ordinary sessions.

### Implementation and runtime acceptance

- The canonical conversation DTO now separates `sessionAgentID` (persisted execution-session owner) from `agentID`
  (truthful participant for one message). Task hydrate, per-session history, older history and standalone session hydrate
  all consume the existing agent ledger. Registered helpers may participate without replacing the owner; two ordinary
  worker identities still fail loudly. Root/system control ledger rows are deliberately excluded because their
  persisted identity names a control session kind rather than a callable display agent.
- Live `message.updated` and part-first envelopes carry the same two identities. Overlay creates/validates the session
  with `sessionAgentID` and the turn card/message with `agentID`; persisted hydrate enforces both against the server view.
  Failed task selection now keeps the exact selected task visible, renders a structured inline error and retries through
  the ordinary `selectTask` load. No helper message is filtered, and no compatibility branch, retry loop or task-specific
  gate was added.
- Independent pre-commit review found and closed one partial-hydrate edge: `setBoardData` can succeed before later view
  projection fails, so a board and partial cards may already exist. Selection errors now render even beside partial
  content, and the same-task early-return is disabled only while that explicit error exists; retry therefore clears the
  partial projection and performs the ordinary hydrate again. The regression fixture fails after installing a board,
  proves the error context survives, then proves the second real hydrate runs and clears it.
- The formal Phase 03 request now returns HTTP 200. For session `ses_0893a9567ffeM5xkuuX80qPbPr`, the real helper row is
  projected as `agentID=compaction`, `sessionAgentID=source-investigator`, while the session owner remains
  `source-investigator`. This directly replaces the former HTTP 500 drift error.
- First Browser MCP acceptance found a second Overlay-only defect after hydration succeeded: event-backed Integrity
  reasoning uses a canonical `protocol` order key, while the execution-disclosure renderer incorrectly required every
  card part to have a `part`-domain key. Domain validation remains owned by the tree writer at insertion; the renderer
  now uses any already-validated canonical timeline key only as stable disclosure identity. A second exact Phase 03
  click and visible screenshot showed the full Integrity card with neither `Card render failed` nor task-load error.
- Focused identity, task-selection and bridge coverage passes 62 tests; all nine tree-writer suites pass 123 tests;
  task/session conversation route suites pass 48 tests with 413 assertions; disclosure/i18n coverage passes. Generated
  OpenAPI/SDK is idempotent, and all eleven package typechecks pass. The route fixture's existing Integrity payload was
  updated to its required explicit agent identity.
- The full route suite also exposed a deterministic test-tool defect: an unresolved Promise did not keep the A2A restart
  seed process alive, so it could exit before the parent-owned kill boundary. The fixture now holds a real timer handle;
  the product scheduler was not changed. The process-restart E2E passes both alone and in the full 48-test route run.
- Only the benchmark-owned backend on port 7878 was restarted to load source changes; Vite and other OpenCorvus/Overlay
  processes were not touched. Phase 03 remains active and Mission-wide product/MirrorTest acceptance is still pending.

## Windows continuation — Iteration 67: greenfield frontend design contract

### Recall

- The operator required the same persistent crypto-trading Mission to continue with exact `hexin/gpt-5.6-terra`, the
  formal database, preinstalled `frontend-innovate`, `mirror-watch`, and `opentest`, no fallback/compatibility/gates,
  and final MirrorTest plus independent secondary review. General G4 is terminal accepted and must not reopen.
- Phase 09 Task `tsk_f77ccc221001KNRGrZDt8SZhun` terminal-failed after the operator explicitly authorized the accepted
  system design, implementation roadmap, competitive research, DTO/API/WebSocket contracts, and no-brand-copy rule as
  the greenfield design authority. The designer still persisted `blocked` because no prior screenshot/Figma/app scaffold
  existed. Preserve that Task and event `pev_f77e85b09001EgfcyNwW9ZrR2S` as failure evidence.
- Read sources include this record, the durable mailbox transcript, `frontend-design/agent.ts`, the dispatch adapter
  schema and tool, frontend-design prompt/process tests, and the full installed Frontend Innovate README, selector,
  experience-designer overlay, Registry/Resolver projection tests, and package-manager checklist.
- Repository-wide searches enumerated every `FrontendDesignAgent.analyze`, `buildUserPrompt`, `frontend_design` adapter
  schema, dynamic dispatch fixture, `visual-html-skeleton`, `web-clone-source/reference.png`, and Frontend Innovate
  competitor/source evidence call point. No second frontend-design prompt or active-squad source exists.

### Causal proof and repair contract

- The generic adapter unconditionally appended the webpage-replica contract to every design turn. Even its text-only
  preface was followed by stronger instructions that visual authority remained `web-clone-source/source-ir/*` and
  `reference.png`, and that production work must report `blocked` without a prior scaffold/screenshot. The Frontend
  Innovate experience-designer overlay independently said to block whenever competitor/source resources were absent.
- Causal chain: valid greenfield textual contracts -> frontend-design delegation -> unconditional parity prompt plus
  squad blocker -> no source-editable HTML/CSS draft -> no rendered screenshot/VisualRegionBinding -> G5 failure -> all
  G6-G9 dependencies stranded. This is a generic frontend-design/expert-squad capability-contract defect, not scheduler
  lifecycle, backend health, database state, or missing user authorization.
- The adapter input now requires one explicit semantic mode: `greenfield_original` or `reference_parity`. Greenfield
  authoring receives only the original-design contract, treats declared textual product/system/API/interaction inputs as
  authority, creates and renders the task-scoped skeleton, personally inspects and repairs its screenshot, and cannot
  classify the expected absence of a prior visual baseline as blocked. Reference parity retains the complete source-page,
  screenshot, region binding, and no-invention contract. This is explicit dispatch data and prompt composition, not a
  keyword classifier, fallback, host gate, or state machine.
- Frontend Innovate README, selector, and experience-designer overlay now use the same distinction: competitor screenshot
  rows are mandatory for claims that cite those references, while greenfield product research may inform information
  architecture and interaction semantics without being misrepresented as pixel evidence.

### Verification and remaining runtime work

- Frontend-design prompt/process coverage passes 19 tests with 248 assertions. It proves missing mode is rejected,
  greenfield prompts contain skeleton authoring/render/inspection and exclude every webpage-clone prerequisite, and
  reference-parity prompts preserve their strict evidence contract. Focused orchestrator frontend-design materialization,
  path-boundary, and no-live-acquisition coverage passes 5 tests; General package and package prompt projection tests pass
  when run with their existing extended timeout. The first full typecheck passed after the explicit mode was threaded
  through all production call sites.
- While verification continued, the separate staged browser-preview refactor changed concurrently and introduced an
  unrelated type error in `browser-preview/region-comparison.ts`: optional `screenshot_path` is assigned to a required
  field. Its package-tool provider test also timed out after an MCP connection closed. These are not evidence against the
  greenfield repair and must remain owned by that concurrent refactor; they currently prevent a truthful repository-wide
  green typecheck and prevent committing through the occupied index without mixing owners.
- Required continuation: commit only the owned frontend-design/package/record paths with `dsw-33987`, push to git-cc,
  build a coherent runtime, restart only the benchmark backend, replace the project Frontend Innovate package through the
  official project-scope import protocol, and create a fresh Phase 09 Task preserving the failed Task. Then continue G5-G9,
  General G10, final MirrorTest acceptance, and independent secondary review.
## Windows continuation — Iteration 68: greenfield visual-evidence registration contract

### Recall

- Continue the same persistent Mission `3779d1f866d5267d`, formal database, project
  `C:\Users\chuan\myhexin-local\benchmark-projects\crypto-trading-task-c-20260718-v3`, exact
  `hexin/gpt-5.6-terra`, installed `frontend-innovate`, `mirror-watch`, and `opentest`, and final MirrorTest plus
  independent secondary review. Preserve accepted G1-G4, failed Phase 09 Task `tsk_f77ccc221001KNRGrZDt8SZhun`,
  and current Phase 10 Task `tsk_f78f26f7f001KjXp9EHAVua46H`.
- The earlier greenfield prompt/package repair is already committed and pushed in runtime `95b9591390`; do not redo it.
  The next failure occurs after the repaired designer correctly authors and inspects the design, so it is a distinct tool
  contract boundary.
- Read sources: this record and durable Mailbox transcript; benchmark-debug, OpenCorvus evidence-debug, and expert-squad
  development instructions; `frontend-design/schema.ts`, `output-tools.ts`, `agent.ts`, their focused tests, installed
  Frontend Innovate package, and task-scoped visual artifacts.
- Repository-wide search enumerated every `update_frontend_visual_evidence`, `visual_validation_evidence`,
  `screenshot_artifact`, and `source_reference_artifact` definition/call point. The output tool and schema are the single
  result-registration authority; package prompts do not own artifact validation.

### Evidence and classification

- One canonical Mailbox poll after real inactivity observed the original designer complete source-editable HTML/CSS,
  Node-launched Playwright screenshots at 1280x800 and 900x700, screenshot SHA-256, personal overflow correction, and
  three-region `VisualRegionBinding`. The task commit is `bc25d7f`; the first goal passed.
- Runtime `95b9591390` then rejected every task-scoped screenshot representation at
  `update_frontend_visual_evidence`. Durable events cite the exact mismatch: greenfield has no external reference image,
  while the loaded validator still requires the reference-parity `source_reference_artifact`. Repeated G5 failures and
  designer redispatches are downstream reactions, not proof of duplicate infrastructure dispatch.
- Observable symptom -> valid greenfield screenshot cannot be registered -> loaded visual-evidence schema models only a
  source comparison -> final frontend template remains unavailable -> implementation dependencies repeatedly reopen.
  This belongs to the generic frontend-design/expert-squad tool contract, not scheduler lifecycle and not the product
  implementation squad. Fabricating a reference image, weakening parity validation, editing the database, or changing
  the project package prompt would be an invalid fallback.
- The current Windows worktree contains a concurrent platform/browser-preview/frontend-replica refactor that already
  touches the owning schema/tool/tests. Its working copy introduces the correct semantic split:
  `greenfield_original` accepts `kind=render_review` with rendered screenshot proof and no source reference;
  `reference_parity` accepts `kind=reference_comparison` with strict source-reference and hash proof. Those paths remain
  concurrent-owned and must not be overwritten, staged, or committed by this benchmark continuation.

### Verification and continuation contract

- Current-source focused frontend-design coverage produced 37 passes and one browser sidecar empty-JSON failure in a
  combined run. The exact failing reference-parity browser case passes alone, while a minimal two-test sequence that
  first executes the static-helper source contract reproduces Bun killing one dangling process and the later sidecar
  returning empty output. The greenfield collector terminal regression passes, so the evidence-contract behavior is
  independently green; the browser child-process lifecycle failure remains a separate unresolved toolchain defect in
  the same concurrently owned browser/frontend-design refactor and must not be dismissed as a proven transient flake.
- Once the concurrent owner commits or clears the overlapping paths, inspect the landed diff rather than recreating it.
  Verify greenfield `render_review`, strict parity `reference_comparison`, focused frontend-design suites, package
  typecheck and payload freshness. Then commit only benchmark-owned follow-up paths with `dsw-33987`, push to `myhexin`,
  build a coherent runtime, restart only the benchmark backend, update the project Frontend Innovate package through the
  official project-scope import protocol, resume the same Mission, and allow ordinary correction/finalization.
- Until ownership clears, continue read-only verification and report the semantic overlap. Do not edit the loaded runtime,
  project database, task evidence, or package prompt to bypass the validator. Vite and healthy unrelated owners remain
  untouched.

## macOS continuation — Iteration 67: Integrity correction parked after plan mutation

### Recall

- The user challenged the supervisor for continuing to sleep after the Phase 03 Integrity reviewer reported two
  blocking findings and the durable Mailbox then remained silent for about three hours. The required outcome is to
  continue the same Mission and Task, distinguish a real scheduler failure from squad work, repair the generic root
  cause with regression evidence, and never add automatic replay, a second scheduler, a task-specific branch, a
  compatibility path, a retry loop or a workflow state machine.
- One explicit same-Mission wake was issued at `2026-07-18T23:54Z`; `/mission/wake` returned `created=false` for Mission
  `01a03b3daabc3bc9` and existing Mission session `ses_08a1255beffeteQ6BBomCFXqrL`. No second recovery is authorized.
- Read sources: this benchmark record and its prior no-decision/durable-escalation iterations;
  `orchestrator/agent.ts`; `orchestrator/stateful-tool-names.ts`; `orchestrator/tools.ts`;
  `orchestrator/goal-lifecycle-tools.ts`; `prompt/core/orchestrator-core.txt`; `engine/describe.ts`; formal SQLite
  `protocol_event`, `message` and `part` evidence; and `test/orchestrator/no-decision-stop-process.test.ts`.
- Repository-wide search enumerated every `needs_correction`, `retry intent`, `needs_redispatch`,
  `classifyOrchestratorDecisionStop`, `schedulerParkAllowedFromSnapshot`, decision-effect metadata,
  `submit_integrity_consensus`, and no-decision persistence/test call site across production, tests and current specs.
  The only production stop classifier is `orchestrator/agent.ts`; decision-effect metadata is produced by the sole
  wrapper in `orchestrator/tools.ts`; retry intent is written by `goal-lifecycle-tools.ts::modify_goal`; current-state
  projection is owned by `engine/describe.ts`; durable fail-stop escalation remains the existing
  `recordOrchestratorDecisionContractFailure` artifact/event path.
- Independent liveness audit rejects prompt-only recovery and host auto-wake. Its architectural recommendation remains
  fail-stop plus atomic durable escalation to the outer supervisor. A follow-up independent audit is reviewing whether
  this specific failure should be represented as a nonterminal tool effect or a fresh-snapshot actionable-work
  postcondition; it is read-only and may not delegate further.

### Causal evidence and responsibility

- Mailbox event `pev_f76f33800001OzyLPpOzN78bnh` reported Integrity verdict `needs_correction`. The Integrity session
  then terminated normally and emitted `integrity.review.completed`.
- The parent Orchestrator did wake. Its durable assistant message explicitly said it would preserve the findings but
  would not start another implementation execution. It called `manage_task action=modify_goal`; the tool returned
  `retry intent recorded; current status remains passed`, and the session then emitted `session.idle` with no repair
  dispatch and no decision-contract failure.
- Direct trigger: the stop classifier treats any task decision-signature mutation as final
  `orchestratorDecisionEffect=decision`. A goal-contract mutation therefore satisfies the current classifier even when
  it intentionally creates `needs_redispatch` work and no worker owns that work.
- Deep cause: the system conflates a durable plan mutation with a settled scheduler decision. Prompt text already says
  non-pass review requires responsible same-task repair, but also says never dispatch a passed goal merely for status
  convergence. The tool truthfully preserves historical passed status while recording retry intent. Without an
  explicit nonterminal effect/postcondition, the model can stop after the mutation and the fail-stop detector cannot
  distinguish that incomplete decision from a dispatch, operator question or terminal lifecycle action.
- This is generic Orchestrator liveness infrastructure, not a cryptocurrency implementation defect: the failure can
  occur after any review or operator correction that mutates a terminal goal contract. The two underlying simulator
  and TypeScript findings remain expert-squad responsibilities. After the explicit wake, durable protocol proves the
  Orchestrator resumed and dispatched `source-investigator`; protocol activity continued immediately before this audit.

### Repair contract

- Preserve prompt-over-host scheduling: the LLM still chooses the responsible worker and repair. The host may only
  detect that a wake settled without a terminal task, operator-owned wait, live worker or completed scheduling action;
  it must persist one existing decision-contract failure event and stop. It must never choose or dispatch the repair.
- Represent plan-only mutations that leave newly actionable work as nonterminal scheduling effects, or equivalently
  validate the fresh post-tool `TaskDesc` before accepting the stop. Choose one single-source design after the
  independent audit. Do not key off prose, task titles, Integrity names, cryptocurrency terms or raw output strings.
- A legitimate park remains valid when only live owned work remains. Dispatch, question and terminal lifecycle tools
  remain settled decisions. A changed terminal goal with retry intent and no live owner must produce exactly one
  `orchestrator.decision_contract.failed` Mailbox item and zero autonomous dispatches.
- Add regressions reproducing the real sequence: blocking goal passes; `modify_goal` records retry intent; Orchestrator
  stops without dispatch; one atomic fail-stop artifact/event becomes visible. Also prove the same mutation followed by
  a real dispatch is accepted, and the existing live-worker park remains accepted.
- Update the core prompt/tool result only to remove the discovered semantic ambiguity; prompt wording is a probability
  improvement, while the durable fail-stop detector is the observable safety boundary. Run focused no-decision,
  goal-lifecycle, describe and prompt suites; OpenCorvus typecheck; historical-document health; then commit with
  `dsw-33987` and push `v0.0.9beta` to `myhexin`. Do not restart the currently running backend without explicit user
  authorization.

### Independent review and implementation evidence

- The follow-up independent liveness audit selected the same two-layer design: explicit nonterminal `continuation`
  effect plus fresh `TaskDesc` only as proof of a legitimate live-worker park. It rejected prompt-only handling and a
  broad actionable-work postcondition because task-level stage ownership, explicit future wake and operator
  interaction cannot be inferred from the current goal-only park predicate without turning the host into a workflow
  gate. It also required the continuation value to survive the real persisted-tool message collector and required
  manage-task action semantics to be exhaustive.
- `OrchestratorDecisionEffect` now distinguishes `continuation` from settled `decision`. All four goal-plan actions are
  declared in one compile-time exhaustive `MANAGE_TASK_ACTION_EFFECT` record; adding another manage-task action cannot
  silently inherit semantics. The public manage-task wrapper stamps successful or refused plan mutations as
  continuation, while non-plan actions continue to derive their effect from real durable state change.
- The wake collector reads the continuation metadata from the persisted tool part. A stop after continuation produces
  the existing fail-stop artifact and canonical Mailbox attention event unless a later settled decision exists or the
  fresh snapshot proves a legitimate live blocking worker park. A continuation made after an earlier decision also
  requires a later decision. No action name, review verdict, task title, output text or cryptocurrency term is parsed
  by the classifier.
- The core prompt and `modify_goal` tool result now state the same semantic fact: historical passed status plus retry
  intent means `needs_redispatch`, and plan mutation is not itself a settled scheduling decision. The LLM still chooses
  the exact projected repair owner; the host performs no dispatch or wake.
- Focused classifier, persisted-message/fail-stop/Mailbox and core-prompt suites pass 37 tests with 144 assertions. The
  real manage-task metadata/workspace regression passes with 9 assertions. Goal attempt/supersede regressions pass 34
  tests, package TypeScript typecheck passes, historical-document health passes 21 tests, and `git diff --check` is
  clean. The benchmark backend was not restarted, so the active Mission continues on the already loaded runtime while
  this generic repair is committed for the next authorized reload.
## macOS continuation — Iteration 68: Integrity durable Mailbox evidence projection

### Recall

- The user requires the same Mission `01a03b3daabc3bc9` to continue without another wake or Task rebuild. Supervision
  may read only durable Mailbox progress, must distinguish infrastructure stability from expert-squad implementation
  quality, and must repair generic root causes rather than add compatibility paths, retry loops, a second scheduler,
  a workflow state machine or a task-specific gate.
- Phase 05 implementation workers persisted two complete sets of canonical `mailbox.message` protocol events. After an
  operator answer enabled the already-existing channel and cited the first five event IDs, a third independent Integrity
  attempt again requested an API/CLI or filesystem path because it searched the project-local `events.ndjson` and its
  visible context contained neither the durable events nor a Mailbox retrieval tool.
- Read sources: this benchmark record; formal SQLite `engine_interaction_request` and `protocol_event` evidence;
  `engine/mailbox.ts`; `engine/describe.ts`; `orchestrator/integrity-review-stage.ts`; `integrity/replay-context.ts`;
  Integrity prompt/tests; and Mailbox tool/route tests. Repository-wide search enumerated every
  `listRecentTaskMailboxMessages`, `MailboxSchedulerMessage`, `mailbox.message`, `send_mailbox_message`, Integrity replay
  packet schema/builder and Integrity stage context-packet call site.
- The worktree contains an unrelated untracked `C:/` path, which must remain untouched and unstaged. The active backend
  remains PID `96644`; this repair does not authorize restarting it.

### Causal evidence and repair contract

- Observable fact: formal SQLite contains the five requested phase messages as canonical `protocol_event` rows, and
  `engine/describe.ts` already projects recent task Mailbox messages into the Orchestrator task description. The worker
  tool and persistence path are therefore healthy.
- Direct trigger: Integrity receives replay, implementation, frontend-design and Visual QA context packets only.
  `IntegrityReplayContext` contains diffs, runs, outcomes and prior reviews, but no durable Mailbox messages. Integrity
  then searches a project-local event mirror that is not the protocol database and honestly concludes no evidence is
  visible.
- Deep cause: the durable evidence has two consumers but only the scheduler projection was implemented. Integrity is an
  independent reviewer and cannot inherit the Orchestrator's private task description. This is a generic infrastructure
  evidence-projection defect, not failure by the cryptocurrency squad to emit messages.
- Extend the single Integrity replay packet with bounded, task-scoped canonical Mailbox messages sourced directly from
  `listRecentTaskMailboxMessages(taskID)`. Replace the packet schema version rather than retain a compatibility reader.
  Render event ID, timestamp, sender/goal/category/attention/subject/body/evidence references and progress so the reviewer
  can audit both existence and content. Do not add another API, hidden message, filesystem mirror or reviewer-specific
  retry behavior.
- Add regression coverage proving replay construction and prompt rendering expose canonical current-task messages, do
  not expose another task's messages, and round-trip the strict packet schema. Run focused Mailbox/Integrity/Orchestrator
  tests, package typecheck and document health, then commit with `dsw-33987` and push `myhexin/v0.0.9beta`. A runtime
  reload, if needed for the active Mission, requires separate authorization.

### Independent review corrections and verification

- Independent review confirmed the root-cause classification and the single-source projection, but blocked the first
  draft because the current architecture still named replay packet v2 and the nested Mailbox shape was not strict or
  task-bound. The review also demonstrated that lineage/input equality alone would not reject a schema-valid packet
  containing a foreign-task Mailbox row.
- The final v3 contract makes `MailboxSchedulerMessage` strict and carries `taskID`. The database reader rejects payload
  task identity that differs from the indexed event task; replay packet parsing rejects every Mailbox task that differs
  from its lineage; `reviewIntegrity` rejects lineage that differs from its explicit task input. These are integrity
  constraints at storage, transport and consumer boundaries, not scheduling gates.
- Regression coverage rejects nested unknown keys, a foreign nested Mailbox task, a durable payload/index task drift and
  a foreign replay context at the active Integrity consumer. The active streaming review test proves event ID, body and
  evidence refs survive packet parsing and appear in the real captured Integrity prompt. Ordinary current-task evidence
  remains bounded by the existing scheduler Mailbox limit and another task's normal event remains absent.
- Focused replay/Mailbox suites pass 22 tests with 111 assertions. Active Integrity/team/fact-check suites pass 24 tests
  with 170 assertions. Package TypeScript typecheck and historical document health remain required after remote merge;
  the benchmark backend has not been restarted.
- The final independent read-only verdict reports no remaining blocker and confirms the change adds only evidence
  projection and data-integrity constraints. Its bounded-window wording advisory is closed by labelling the prompt as
  the newest selected messages rendered oldest-first. A pre-merge combined documentation run passed 116 of 117 tests;
  the sole selector-catalog assertion is stale against the remote expert-squad repair and is expected to resolve when
  the three already-fetched `myhexin/v0.0.9beta` commits are merged, then must be rerun rather than waived.
- Post-merge verification proved the remote production resolver intentionally consumes
  `discoverExternalPackages(projectDirectory)`, the strict Registry snapshot that combines project and user-global
  packages. The homogeneity test alone still asserted the removed project-only discovery name. Its assertion now pins
  the external catalog call and rejects the former project-only call; no production behavior changed for this repair.

## macOS continuation — Iteration 69: General independent-review ownership routing

### Recall

- The user requires unattended continuation of Mission `01a03b3daabc3bc9` through the formal SQLite durable Mailbox,
  with infrastructure responsible only for generic dispatch stability and the active General squad responsible for
  functional delivery and its own routing quality. The repair must not introduce compatibility behavior, an automatic
  retry loop, a second scheduler, a workflow state machine, a task-specific gate, or another Mission/Task.
- G4 Task `tsk_f7925cc19001eu6v6bUFa6xIRR` has a final verification Goal whose terminal requirements combine real
  PostgreSQL/API evidence with a new independent Integrity verdict. After the first independent review returned
  `needs_correction`, implementation attempts repaired every named finding and repeatedly proved the Mission database,
  Fastify inject, pagination, matching persistence, and typecheck commands green.
- Read sources: this benchmark record; formal SQLite `protocol_event` and `decision_log` rows; General package manifest,
  README and Orchestrator/implementation/Integrity overlays; common Orchestrator review-correction prompt; dynamic
  projected-agent rendering; failed-goal description; General package and scheduler-projection tests; current
  architecture control and expert-squad boundaries.
- Repository-wide searches enumerated every General `implementation-engineer` and `system-integrity-reviewer`
  projection/virtual-workflow node, every common independent-review and non-pass repair instruction, the failed-goal
  diagnostic rendering path, and all tests that assert the General scheduler prompt or projected descriptions.
- Git baseline is `v0.0.10beta` at `64e5ce2b9`, already synchronized with `myhexin/v0.0.10beta`. The unrelated untracked
  `C:/` path remains untouched. Backend PID `24378` and Vite PID `28172` must not be restarted by this repair.

### Causal evidence

1. Observable symptom: after implementation attempt `4e9b81f9` completed all real checks, the same Goal was dispatched
   again to `implementation-engineer` as attempts `d4124138` and `766a8fe9`; the latter again completed the same real
   checks. Every implementation report explicitly said only a new independent Integrity verdict remained.
2. Direct trigger: the scheduler treated the Goal's failed terminal state as another implementation retry even though
   the persisted `execution_report_evidence.error` named a non-transferable review-owned evidence gap. One intervening
   attempt also lacked the already task-specified database environment, but the next attempt corrected that and still
   could not satisfy the review-owned requirement.
3. Deep cause: common prompt text says to choose the responsible projected owner, and General declares
   `system-integrity-reviewer`, but the General scheduler overlay does not make ownership non-transferability explicit:
   an implementation worker may repair review findings, but it cannot create the independent re-review verdict. The
   failed Goal remains implementation-shaped, so the model overweights the prior Goal owner and retries it.
4. Why prior behavior did not converge: the fail-stop correctly exposed one non-decision turn and the worker protocols
   honestly refused to self-approve. Neither mechanism tells the General scheduler that a verified repair plus an
   outstanding independent verdict changes the next evidence owner even when the same Goal remains failed.

### Repair plan

- Strengthen only the General scheduler capability overlay: independent review evidence is non-transferable. Once the
  implementation owner has produced the requested repair/verification evidence and the remaining blocker is a fresh
  independent verdict, dispatch `system-integrity-reviewer`; do not redispatch `implementation-engineer` merely because
  the containing Goal is failed. Conversely, concrete review findings still route to the owner of the affected
  implementation surface before re-review.
- Keep this as natural-language capability ownership, not a host invariant or adapter ladder. Do not parse report text,
  verdict names, Goal titles, retry counts, or task-specific terms in host code.
- Add a General-package regression proving the active scheduler overlay carries the non-transferable review boundary,
  and a real scheduler-composition assertion proving the rendered General prompt contains it alongside both exact
  projected identities. Existing package-isolation tests must continue proving external squads do not inherit General.
- Run the focused General package and scheduler prompt suites, package TypeScript typecheck, historical document links,
  document health, and `git diff --check`; obtain independent read-only review; then commit with `dsw-33987` and push
  `myhexin/v0.0.10beta`. The running backend remains unchanged until separate authorization.
- The first combined focused run exposed an unrelated stale scheduler-schema fixture: its Figma dispatch supplied a
  reference URL but omitted the now-required explicit `mode`. Update that test input to `reference_parity`; production
  dispatch validation remains unchanged and strict.

### Independent-agent feedback

- `liveness_audit` confirmed that implementation and Integrity toolchains are healthy, while Orchestrator made repeated
  semantic decisions. It reconstructed two dispatches from one Orchestrator session: after attempt `4e9b81f9` had
  already returned `status=running`, the same wake dispatched the same Goal again; the execution lease correctly
  serialized the stale second decision until the first worker ended. The lease did not invent the duplicate and must
  not become a semantic gate.
- The audit also proved later internal refill turns described the one historical operator retry as a current user
  request. Historical operator intent is conversation evidence, not present-wake provenance; only the current wake's
  `operatorMessage` / `operatorIntent` can authorize that wording.
- Extend the prompt-only repair accordingly: the real goal-scoped build `status=running` result and common scheduler
  prompt must tell Orchestrator that this live Goal owns the current wake and cannot be dispatched again before terminal
  refill evidence. Strengthen the existing internal-wake notice so it explicitly makes prior user/retry messages audit
  history rather than current authorization. Add regressions at the real build tool-result and internal-wake prompt
  rendering paths. Do not modify execution leases, queue admission, lifecycle state, or dispatch validation.
- The independent audit rejects completion without these two regressions and a final read-only diff review.
- The stale internal-wake source assertion was updated to the current provenance contract. The session-reuse regression
  now executes `Orchestrator.processTask` first with a user turn and then with an internal wake, resolves the real runtime
  system function both times, and proves only the internal wake carries historical-intent isolation while both carry the
  common live-Goal dispatch rule. A real goal-scoped `dispatch_agent` regression proves the returned build result carries
  the same stop/terminal-refill instruction.
- Final verification: 48 focused General projection, scheduler runtime, wake-provenance, session-reuse, no-decision and
  core-prompt tests pass with 814 assertions; the real build tool-result test passes with 18 assertions; package
  TypeScript typecheck passes; 82 historical-link/document-health tests pass with 1,375 assertions; `git diff --check`
  passes. Final independent read-only review reports no blocker and confirms the diff remains prompt-over-host with no
  gate, workflow state, fixed adapter ladder, queue rule, or execution-lease change.
