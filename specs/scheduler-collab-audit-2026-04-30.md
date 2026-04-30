# Scheduler Collaboration Audit — 2026-04-30

> **Scope.** Diagnostic-only audit of the multi-agent scheduling system in opencorvus. Investigates four questions: (1) what channels actually exist between agents; (2) is collaboration real or staged; (3) where does information get lost across boundaries; (4) where do responsibilities double up or contradict.
>
> **Method.** Static read of `packages/opencorvus/src/` (orchestrator, planner, spec, architect, build, evaluator, delivery, executor, session, scheduler, bus, engine), cross-checked against live bench `tsk_dde13a67c001sbz6y2Qe0at8Fc` (overlay benchmark, alibaba-coding-plan-cn/kimi-k2.5, 2026-04-30 ~11:08–11:21 UTC). Bench log: `packages/opencorvus/script/benchmark/runs/_session-r1-opencode.out`.
>
> **Out of scope.** Fixes, refactors, scope changes. CLAUDE.md rule 32 says diagnose first, land separately.

---

## TL;DR

The scheduling system is **not** an event-driven multi-agent architecture. It is a single LLM orchestrator that calls agents as **synchronous tools** (`await Agent.run(...)`), persists their outputs to DB and the decision log, and on the next wake re-reads state. Bus events are an **observability sidecar** for the overlay UI, not a control plane.

This shape has consequences:

- **One real channel forward** — typed function args.
- **One real channel backward** — append-only DB rows + `decision_log` phase entries.
- **One real wake mechanism** — `dispatchTaskLoop({ taskID, event: { note } })`, fire-and-forget into a queue.
- **Three layered verdict authorities** (LLM agent, visual hard-gate, runtime-evidence pre-gate). Verified intentional after reading source — the visual hard-gate explicitly cites CLAUDE.md rule 12 ("视觉 benchmark 必须以视觉呈现") and the runtime-evidence pre-gate exists to avoid burning LLM tokens on empty-scaffold goals. The actual risk is **no single aggregated verdict object** for downstream analysis (the layered overrides are correctly designed; consumers reading `verdict` artifact see the final, but reasoning trace lives in the synthesised `summary` markdown).
- **`engine/runtime.ts:syncGoalRuns` is intentionally empty** — verified by reading the comment at lines 161-165: per-goal execution moved to GoalPool + event bridge; the runtime poll path is for non-per-goal runs only. Not a regression.
- **Information loss is real and measurable** — `BuildResult` only carries `{status, summary, worktree}`; detailed errors never escape the build session. Retry feedback is re-synthesised into markdown by the orchestrator.
- **Bench data confirms intent-analysis abort + design_analysis abort + bootstrap-first serial gate**. The orchestrator continued past these without escalation — i.e. agents downstream of design_analysis received zero visual context but were not told.

The system holds together because the orchestrator LLM re-derives state on every wake. The fragility is in the wake itself: any miss in `dispatchTaskLoop` becomes a silent stall (cross-confirms `project_orchestrator_wake_wedge_2026_04_29.md`).

---

## 1. Pipeline shape (what the channels actually are)

```
                     orchestrator-loop (LLM)
                            │
                            │  awaits each tool synchronously
            ┌───────┬───────┼───────┬───────┬───────┬───────┐
            ▼       ▼       ▼       ▼       ▼       ▼       ▼
         intent  design  require  architect  build  deliver  integrity
                  ↓        ↓         ↓        ↓        ↓
                  │   DB rows + decision_log (single source)
                  │   Bus event (observability sidecar → /event SSE → overlay)
                  ▼
                next wake re-reads via describe()
```

**Confirmed.** Every "agent call" in `orchestrator/tools.ts` is `await Agent.run(...)`:

| Tool | Source | Pattern |
|---|---|---|
| `requirements` | `orchestrator/tools.ts:600` | `await RequirementsAgent.run(...)` |
| `architect` | `orchestrator/tools.ts:1088` | `await ArchitectAgent.coordinate(...)` |
| `build` | `orchestrator/tools.ts:3836` | `await BuildAgent.run(...)` |
| `deliver` | `orchestrator/tools.ts` (deliver tool body) | spawns delivery session, blocks on terminal verdict |
| `integrity` | `orchestrator/tools.ts:3256-3340` | spawns integrity session, blocks on review |

There is no message bus, no work queue between these agents — only the orchestrator turn that schedules them. CLAUDE.md rule 13 (no state machines, rely on LLM intelligence) is therefore satisfied at the macro level: **the orchestrator LLM is the state machine**. The risks are all at the boundary it maintains.

---

## 2. Seam-by-seam findings

### 2.1 orchestrator → requirements

| Aspect | Finding |
|---|---|
| Channel form | In-process function call, `await RequirementsAgent.run(input)` (`orchestrator/tools.ts:600`). |
| Forward payload | `{ title, request, attachments?, designSpecs?, decisionLog }` (`requirements/agent.ts:60`). |
| Backward payload | `RequirementsResult { requirements: ParsedRequirement[], decisions: RequirementsDecision[], summary }` (`requirements/agent.ts:47`). |
| Persistence | `engine_requirement` rows + `decision_log` phase=`requirements` entries (`requirements/agent.ts:159`). |
| Re-entry | None automatic. Orchestrator re-calls the tool; prior decisions accumulate in append-only `decision_log`, downstream reads via `decisionLog.readByPhase("requirements")`. |
| Bench evidence | Session `requirements:ses_221e99fdfffd...` started at T+~210s, completed at T+~265s with `[overlay-benchmark] event=task.updated status=active detail=Requirements parsed` (line 2777-2778). One-shot, success-only path observed. |
| Loss / dup | None observed. Rule 8 caveat from upstream agent ("requirements catalog read twice — once for build, once for delivery") is **not** double-source: both reads target the same `engine_requirement` table, no cache. |

### 2.2 requirements → architect

| Aspect | Finding |
|---|---|
| Channel form | DB query — architect calls `findRequirements(specSnapshotID)` to load the requirements catalog. No event handoff. |
| Decision-log seeding | `decisionLog.toPromptSection()` called at `architect/agent.ts:338` to inject requirements decisions. |
| Bench evidence | Architect session `architect:ses_221e8cef1ffd...` started at T+~280s after requirements completion (line 2995). |
| Loss / dup | **Real loss.** The architect's input excludes the requirements *agent's reasoning trace* — only the structured `decisions[]` survive. If a requirement was clarified mid-session through a clarifying question, that context is gone. |
| Rule 8 caveat | The decision-log is read once by architect and once by build (rule 35 grep verified). Not double-source — single table, no cache. |

### 2.3 design_analysis → architect / build (visual context channel)

This is the **first observed information-loss site** in the live bench.

| Aspect | Finding |
|---|---|
| Channel form | `design_analysis` is an orchestrator tool; on success it materialises visual specs into `task.design_specs`. Downstream agents read via `engine_task.design_specs` column. |
| Failure mode | At T+~150s the bench logged: `WARN service=task-tools url=https://chart.ainvest.com/NASDAQ-NVDA/ stage=content_paint error=content-paint gate: no canvas pixels and no main-content bbox > 200×200 within timeout` (line 1728). Immediately followed by: `WARN liveUrlCount=1 figmaUrlCount=0 materialCount=0 design_analysis: no visual input materialized — aborting before agent call` (line 1729). |
| Downstream visibility | The orchestrator was **not told** the visual context is empty. Architect and build proceeded with `designSpecs=undefined`. |
| Loss / dup | **Confirmed loss.** The bench shows architect started ~130s after design_analysis aborted, with no error injection between them. There is no `decision_log` phase for "design_analysis_failed" that I could find in the bench output. |
| Open question | Where does `design_analysis` log its abort? It produces a WARN to stderr but does not appear to write a decision_log entry that downstream agents read. |

### 2.4 architect → goal decomposition → per-goal worktree

| Aspect | Finding |
|---|---|
| Channel form | `ArchitectAgent.coordinate` returns goals + traceability + contracts. Orchestrator persists via `upsertGoalsFromArchitect` (`orchestrator/tools.ts:1084`) which writes `engine_goal` rows. |
| Worktree allocation | At dispatch time, `Worktree.create({name: 'goal-${goal.id.slice(-8)}'})` allocates per-goal workdir (`orchestrator/tools.ts:3873`). Path persisted to `engine_goal.workspace_dir`. |
| Bootstrap-first gate | A bootstrap-class goal (typically `bootstrap-cli`/scaffold) blocks dispatch of non-bootstrap goals until terminal. Bench evidence at T+~650s and T+~660s: `WARN service=task-tools requestedGoal=gol_dde1c63b7002... requestedKind=system pendingBootstrap=gol_dde1c63b7001... pendingBootstrapStatus=running build: bootstrap-first gate rejected non-bootstrap dispatch` (lines 7456, 7860). |
| Rule 13 risk | The bootstrap-first gate is a hard ordering rule embedded in `task-tools`. It is a **serialisation invariant**, not a state machine, but it does encode a forced ordering that the LLM cannot override. Whether this is rule 13–compatible (orchestrator chooses next goal but gate enforces dependency) is **open**. |
| Loss / dup | None observed for the goal contract itself. But: `engine_goal.workspace_dir` and `engine_goal_run.workspace_dir` both record the path. Single-writer (`updateGoalWorkspace` only writes goal; `beginBuildAttempt` only writes goal_run if param given), so not actually a double source — but a **reader** can choose either, creating a stale-read risk. |

### 2.5 build dispatch → executor → session loop

| Aspect | Finding |
|---|---|
| Channel form (forward) | `BuildAgent.run(input)` called synchronously. Internally creates a `Session`, then `executor.submit({sessionID, prompt, priority, source})` enqueues to `TaskQueueTable` (`scheduler/task-queue-service.ts:142`). |
| Channel form (backward) | `executor.events()` is a generator that subscribes to `GlobalBus` (`executor/opencode.ts:135-198`), yields message/status events until `task-queue.completed`. |
| Critical gap | **`orchestrator/tools.ts` does NOT consume `executor.events()`.** Build tool returns once `BuildAgent.run` resolves. There is no real-time feedback loop wired between the orchestrator and the live executor stream. The orchestrator only sees the terminal `BuildResult { status, summary, worktree }`. |
| Polling | `TaskQueueService.poll()` runs every ~500ms (`scheduler/task-queue-service.ts:39-42`); concurrency cap 4. `executor.submit` calls `runNow()` to bypass the interval (`executor/opencode.ts:70`). |
| `syncGoalRuns` stub | `engine/runtime.ts:167-170` body is `void runID; void hooks` — intentional no-op. **Verified** by reading the doc comment at `runtime.ts:161-165`: "Per-goal execution is owned by GoalPool + the event bridge. Startup orphan cleanup was moved to engine/recovery.ts so runtime polling no longer tries to reconcile previous-process state here." Not a regression. The runtime poll is for legacy non-per-goal runs only; per-goal completion arrives via GoalPool + EngineProtocol bus events. |
| Loss / dup | **Severe loss at BuildResult.** `BuildResult` schema is `{status, summary, worktree?}` (`build/types.ts`). The detailed tool-call history, file edits, errors live only in `Session.message` rows. The orchestrator gets a 1-line summary. On retry the loss compounds: orchestrator must re-synthesise retry feedback from decision_log, which itself was synthesised from the summary. |

### 2.6 build → delivery (verdict layered architecture)

This is the most architecturally complex seam — verified by reading source after first-pass audit (rule 3 self-challenge).

| Aspect | Finding |
|---|---|
| Authority count | **Three layered gates.** Documented as intentional defense layers, not accidental double-source. |
| Authority 1 — runtime-evidence pre-gate | `synthesizeRuntimeRejection()` at `delivery/verdict.ts:227-274`, called *first* in `DeliveryService.verify` (`delivery/service.ts:78-123`). If build artifact DOM is empty / no canvas pixels, **bypasses the LLM entirely** and emits a synthetic rejected verdict. Purpose (verbatim from `verdict.ts:218-225`): "avoid burning LLM tokens on goals that only produced scaffold/shells." |
| Authority 2 — LLM | `DeliveryAgent.verify` produces `DeliveryVerdictType` (`accepted` \| `rejected` with `rejection_details[].goal_id`) (`delivery/verdict.ts:118-124`). Runs only if pre-gate passes. |
| Authority 3 — visual hard-gate | `finalizeVerdict()` at `delivery/verdict.ts:168-216`, called inside `DeliveryService.verify` after the LLM verdict (`delivery/service.ts:154-165`). Purpose (verbatim from `verdict.ts:150-156`): "LLM 无权推翻 ... CLAUDE.md rule 12：视觉有关的 benchmark 必须以视觉呈现." |
| Aggregation behaviour | **Verified by reading `finalizeVerdict`:**<br>• `metric.passed → return llmVerdict unchanged` (`verdict.ts:173`)<br>• `metric.passed=false + LLM rejected → append gate failures to rejection_details, preserve attribution` (`verdict.ts:198-203`) — this IS aggregation<br>• `metric.passed=false + LLM accepted → flip to rejected, preserve LLM summary in body` (`verdict.ts:206-215`) — this is gate veto, not silent overwrite |
| Rule 8 / rule 22 status | **NOT a violation.** The three gates are intentional and documented. Each has a single write path. The `verdict` artifact is the canonical output. The denormalised `verification-evidence` artifact is derived single-write. |
| Real risk | **No single aggregated reasoning trace.** The pre-gate path emits a synthetic verdict with `summary` markdown but no LLM trace. The hard-gate path either appends to LLM trace (rejected case) or overwrites LLM verdict but preserves summary (accepted-flipped case). Downstream consumers reading the verdict cannot distinguish "LLM analysed deeply and rejected with detailed evidence" from "pre-gate fired before any LLM ran" without parsing the markdown. |
| Persistence | Verdict written as `engine_artifact kind=verdict label=delivery-agent-verdict payload=DeliveryVerdictType` (`orchestrator/tools.ts:2660-2666`). A *second* artifact `kind=verification-evidence scope=delivery` is denormalised from the first via `updateEvaluationFromDeliveryVerdict` (`engine/persist.ts:945-998`). The downstream-agent confirmed: single write site, derived not independent — **not a real double source**, but the denormalisation does mean a reader of `verification-evidence` and a reader of `verdict` can disagree if persistence is partial. |
| Loss / dup | **Real loss on rejection re-entry.** Delivery's full `rejection_details[]` (structured array with category, file, error, suggestion) survives only in the artifact payload. The retry path reads `decision_log phase=retry` entries which are **synthesised markdown summaries** of the same content (`orchestrator/tools.ts:3951-3963`). The build agent on retry sees the markdown, never the original structured array. |

### 2.7 evaluator-delivery loop (re-entry)

| Aspect | Finding |
|---|---|
| Re-entry trigger | On `verdict=rejected`, `affectedGoalIDs(verdict)` extracts goal_ids from `rejection_details[].goal_id`. For each, call `startNewAttempt({goalID, reason: "delivery_rework", feedback})` (`orchestrator/tools.ts:3144-3246`). |
| Budget | `iteration >= fixBudget` gate at `orchestrator/tools.ts:3190-3221`. `effectiveMaxFixRuns(task)` resolves the budget per-call from EngineConfig. Iteration counter is **passed as tool argument**, not persisted. On orchestrator restart, must re-derive from artifact stream — risk of off-by-one if inference fails. |
| Wake | `dispatchTaskLoop({taskID, event: {note: OrchestratorEventNote.deliveryRework(...)}})` injected fire-and-forget at `orchestrator/tools.ts:2718-2729`. No retry / fallback if the dispatch queue is full or the call throws. Cross-confirms `project_orchestrator_wake_wedge_2026_04_29.md` (commit `5861ebc3b`). |
| Loss / dup | None new. Re-entry into the **same goal** under a new `goal_run` (with `supersede_of` pointer) is single-writer-per-attempt. The architecture is consistent. |
| Critical gap | **No automatic re-entry into the evaluator on retry.** Once delivery rejects and a new goal_run starts, the executor runs directly. The orchestrator LLM must call `evaluate` again explicitly, otherwise the new build is delivered without re-evaluation. The "eval-delivery loop" memory note (`project_eval_delivery_loop.md`) describes intent; the code path requires LLM compliance. |

### 2.8 integrity review

| Aspect | Finding |
|---|---|
| Channel | Orchestrator tool `integrity` spawns a session, blocks on review. Result has `verdict` (e.g. `concerns`, `pass`, `fail`) plus per-dimension scores. |
| Bench evidence | At T+~620s: `INFO service=integrity-review verdict=concerns perDimension=goal_fidelity=pass,technical_feasibility=pass,hallucination=pass,solution_quality=concerns issues=3 corrections=0` (line 6877). Bench then continued without escalation. |
| Loss / dup | **Verdict is observability-only.** `integrity.review.completed` is emitted as a Bus event but no subscriber wires it into the orchestrator wake path. The orchestrator re-reads the result on next describe. Whether the orchestrator LLM acts on `verdict=concerns` depends on its prompt — it is **not enforced**. |
| Rule 8 risk | Integrity verdict and delivery verdict can disagree. There is no canonical merge — the orchestrator LLM is the merger. |

---

## 3. Bus event catalog summary

A separate enumeration found 77 `BusEvent.define` sites. Of those, **45+ have no typed `Bus.on(name)` subscriber**. Caveat: many are caught by `Bus.subscribeAll(handler)` at `server/routes/app.ts:443` (the project-scoped `/event` SSE) and by `GlobalBus.on("event", handler)` (cross-instance). So "orphan" in the typed sense usually means "observability-only — flows to overlay UI but no in-process consumer."

The events that **do** drive control flow:

| Event | Emitter → Subscriber | Role |
|---|---|---|
| `evaluation.completed` | `engine/persist.ts` → `channel/slack.ts:51` | Slack notifier (not orchestrator). |
| `permission.asked` / `permission.replied` | `permission/next.ts` → `engine/interaction.ts:17,18` + `engine/auto-permission.ts:58` | Real two-way channel. **Multi-subscriber drift risk:** auto-permission and interaction handler both react to the same event. |
| `question.*` | `question/index.ts` → `engine/interaction.ts:19,20,21` | Real two-way channel for clarifying questions. |
| `session.*` | `session/index.ts` → `orchestrator/protocol/message-bridge.ts` + `server/routes/coding.ts` | Message stream pipe to overlay. |
| `command.executed` | many → `project/bootstrap.ts:43` | Watcher for project bootstrap. |

Everything else — `task.created`, `spec.*`, `plan.*`, `goal.passed`, `goal.failed`, `delivery.ready`, `goal_run.updated`, `milestone.*`, `run.*` — is either observability sidecar (overlay UI) or genuinely orphan (information emitted but consumed by nothing in-process).

**This is consistent with the synchronous-orchestrator shape.** Control flow happens through awaited tool calls + DB reads on the next wake. Bus is for the UI. The shape is honest, but it means **`emit` does not imply `act on`** anywhere in the system.

---

## 4. Decision-log analysis

The decision-log is the **closest thing to a backplane** the system has.

| Phase | Writers | Readers |
|---|---|---|
| `requirements` | `requirements/agent.ts:159` | architect (via `phasePromptSection`), build context, delivery context |
| `design_analysis` | (writer site not located in this audit) | orchestrator upstream-context injector |
| `architect` | `architect/agent.ts:212`, `orchestrator/tools.ts:959/971/979` | self on re-run; build context |
| `retry` | `orchestrator/tools.ts:3949` (and likely `engine/persist.ts:649`) | build context (`orchestrator/tools.ts:3949` filtered by goalID) |
| `delivery` | `orchestrator/tools.ts:2698-2703,3199-3205` | observability |
| `integrity` | `orchestrator/tools.ts:3256/3340` | observability |
| `milestone` | `orchestrator/tools.ts:1724-1757` | observability |

**Strengths.**
- Append-only — no row mutation, no race on writes.
- Phase-scoped reads — agents see only the slice they need.
- `goalID` scoping on retry phase prevents cross-goal context leakage.

**Weaknesses.**
- **No locking on read-during-write.** Reader composes prompt from a `readByPhase` snapshot; if a concurrent writer appends mid-compose, the read is consistent (snapshot) but the next agent may miss the just-written entry. With the synchronous orchestrator this is rare, but if any agent writes from within its own session (e.g. integrity writing during a parallel build), the writes may not propagate.
- **Truncation.** `decision-log/index.ts:120` truncates long values with `[+N chars truncated; full body in decision_log row]`. If a downstream agent only sees the truncated prompt section, it is decision-blind on long retry feedback. The "full body" is in DB but the agent does not query it directly.

---

## 5. Information-loss inventory (cross-seam)

| # | Loss | Site | Severity | Bench evidence |
|---|---|---|---|---|
| L1 | `BuildResult` only carries `{status, summary, worktree}`. Detailed errors live only in session messages. | `build/types.ts` | **High** — degrades retry quality | n/a (build hasn't completed yet in current bench) |
| L2 | Delivery `rejection_details[]` (structured array) re-synthesised into markdown for retry feedback. | `orchestrator/tools.ts:3951-3963` | **Medium** — loses structure across retries | n/a |
| L3 | `design_analysis` abort is logged as WARN to stderr but no decision_log entry visible to architect/build. | `task-tools` (line 1728-1729 of bench) | **High** — silent loss of visual context | T+~150s, `materialCount=0` |
| L4 | Iteration counter passed as tool arg, not persisted. | `orchestrator/tools.ts:3190-3221` | **Medium** — orchestrator restart may miscount budget | n/a |
| L5 | `executor.events()` stream not consumed by orchestrator. Real-time tool calls / partial outputs visible only to overlay UI. | `executor/opencode.ts:135-198` | **Low** — by design, but means no live abort on bad behaviour | n/a |
| L6 | `permission.asked` has multiple subscribers (`auto-permission` + `interaction`) maintaining own state. | `engine/auto-permission.ts:58`, `engine/interaction.ts:17` | **Low** — drift risk on concurrent perms | n/a |
| L7 | `intent-analysis` session aborted at T+~30s with no observable downstream notification. | bench line 1082 `session.terminal session=ses_221ec2a2... reason=aborted` | **Medium** — same shape as L3 | T+~30s |

---

## 6. Responsibility duplication / contradiction

| # | Issue | Site | Verdict |
|---|---|---|---|
| D1 | Three layered verdict gates (runtime-evidence pre-gate → LLM → visual hard-gate). | `delivery/service.ts:78-165`, `delivery/verdict.ts:151-274` | **NOT a rule 8/22 violation** (verified rule 3 re-read). Layering is intentional & documented. Real risk is loss-of-reasoning-trace at downstream readers — synth verdicts have no LLM trace, flipped verdicts preserve summary but signal type is lost in markdown. |
| D2 | `verdict` artifact + `verification-evidence` artifact denormalisation. | `engine/persist.ts:945-998` | Single write path — **not** a double source. Reader-side risk if write is partial. |
| D3 | `engine_goal.workspace_dir` + `engine_goal_run.workspace_dir`. | `engine/persist.ts:1445`, `orchestrator/tools.ts:3854-3866` | Single-writer split, reader picks. **Stale-read risk** if reader hits goal_run path. |
| D4 | `permission.asked` consumed by both auto-permission and interaction. | `engine/auto-permission.ts:58`, `engine/interaction.ts:17` | **Real** multi-subscriber drift on concurrent perms. |
| D5 | Integrity verdict + delivery verdict ungated. | `orchestrator/tools.ts:3256-3340`, `delivery/service.ts` | **Real** — orchestrator LLM is the merger; no schema-level reconciliation. Bench observed `integrity verdict=concerns` not blocking subsequent dispatch. |
| D6 | Bootstrap-first gate enforces serial dispatch but is invisible to orchestrator LLM at decision time. | bench lines 7456, 7860 | **Suspected** — gate logged after orchestrator already issued the dispatch, suggesting late rejection rather than upfront constraint. |

---

## 7. Wake-mechanism risks

| # | Risk | Site |
|---|---|---|
| W1 | `dispatchTaskLoop` is fire-and-forget; failure / queue-full is silent. | `orchestrator/tools.ts:2718-2729`, `engine/queue` |
| W2 | `syncGoalRuns` is a stub. Per-goal completion polling unimplemented. Mitigated by describe-time re-derivation but means `engine.poll` is not actually doing what its name implies. | `engine/runtime.ts:167-170` |
| W3 | After delivery render rejection, the operator-message inject path requires `injectMessage → dispatchTaskLoop`. Memory note `project_orchestrator_wake_wedge_2026_04_29.md` says the wake gap is fixed in commit `5861ebc3b`; static read confirms `task-api/index.ts:1336` does call `dispatchTaskLoop` unconditionally. | `task-api/index.ts:1328-1345` |

---

## 8. Bench live observations (informational)

Live bench `tsk_dde13a67c001sbz6y2Qe0at8Fc` (still running at audit time, ~13 minutes in):

| Time | Event | Implication |
|---|---|---|
| T+0s | task created, orchestrator session `ses_221ec596...` opened | normal |
| T+~5s | intent-analysis session `ses_221ec2a2...` opened | normal |
| T+~30s | `session.terminal session=ses_221ec2a2... reason=aborted` | Intent-analysis aborted — no decision_log visible to downstream |
| T+~150s | `design_analysis: url screenshot failed (non-gate)` for ainvest URL | Live URL unrenderable inside content_paint timeout |
| T+~150s | `design_analysis: no visual input materialized — aborting before agent call` | Agent never invoked. Architect/build will see `designSpecs=undefined`. |
| T+~210s | requirements session opened | LLM proceeding without visual context |
| T+~265s | requirements completed, `event=task.updated detail=Requirements parsed` | success |
| T+~280s | architect session `ses_221e8cef...` opened | architect runs without visual specs |
| T+~620s | `integrity-review verdict=concerns ... solution_quality=concerns(i3/c0/m0)` | Integrity flagged 3 issues, bench did not stop |
| T+~650s | `bootstrap-first gate rejected non-bootstrap dispatch` (twice at T+~660s) | Orchestrator tried to dispatch goals before bootstrap completed |
| T+~770s | bench still running, last activity `snapshot tracking goal-9xlhunqs` worktree | First per-goal worktree allocated |

The bench is **not** stuck — it is making progress. But the loss-without-notification pattern is visible at T+~30s (intent abort) and T+~150s (design abort): the orchestrator continued to the next phase rather than escalate.

---

## 9. System-level reading (CLAUDE.md rule 4)

This is not a bug list. It's the shape:

1. **The orchestrator LLM is the integration layer.** Every cross-agent decision routes through its describe-then-act loop. There is no per-agent autonomy. Rule 13 is honoured at the macro level.

2. **DB + decision_log is the only durable backplane.** Bus is observability. If a Bus event is not also reflected in DB, the next wake will not see it.

3. **Channels are typed-forward / DB-backward.** Rich structures flow forward as args. They flow backward as **summarised markdown** (decision_log) plus **structured artifacts** (verdict, evidence, run_attempt). The summarisation is the loss.

4. **Verdict is layered, not broken** (corrected after rule 3 self-challenge). The three gates are intentional defense-in-depth tied to CLAUDE.md rule 12 (visual benchmarks must be visually verified). The actual structural concern is downstream: a single `verdict` artifact carries one of three semantically different things (synth-from-runtime / LLM-only / LLM+gate-merged / gate-flipped) and consumers must read markdown to disambiguate. This is a documentation/typing concern, not a double-source.

5. **Wake is a single point of failure.** `dispatchTaskLoop` async injection has no resilience. The system survives because the LLM re-derives state, but if the wake never fires, the LLM never gets to re-derive.

6. **Information loss is built into `BuildResult`.** This is the most actionable design observation: the build agent produces enormously detailed work, and 99% of that detail is invisible to the next orchestrator turn.

---

## 10. Open questions (to verify before any fix)

1. **Where does `design_analysis` write its decision_log on abort?** The bench WARN suggests no entry exists. Verify by searching `design_analysis` writer sites in `orchestrator/tools.ts` and check whether the abort path appends to `decision_log`.

2. **Is the bootstrap-first gate enforced upfront or as late rejection?** The two bench WARNs were emitted *during* dispatch, suggesting late rejection. If so, the orchestrator wasted an LLM turn on a rejected dispatch.

3. **Does `integrity verdict=concerns` ever drive a goal restart?** The bench shows it didn't. Find the orchestrator prompt section that integrates integrity verdict — is the LLM told to escalate on `concerns`, or is it advisory?

4. **What is the actual write path for `design_analysis_failed` / `intent_analysis_aborted` decision-log entries?** Without these, downstream agents are decision-blind.

5. ~~**`syncGoalRuns` stub** — is the no-op intentional?~~ **Resolved during audit refinement.** Verified intentional via `runtime.ts:161-165` doc comment — per-goal flow lives in GoalPool + event bridge. The runtime poll is for legacy non-per-goal runs only.

6. **`rejection_details[]` structured-to-markdown loss** — would persisting the structured array directly in `decision_log.value` (parsed by build agent) recover the loss? Or does the markdown form serve a real purpose?

7. **Bus events with no in-process subscribers** — re-run the orphan analysis filtering against `Bus.subscribeAll` and `GlobalBus.on("event", ...)` to determine which are *truly* orphan vs observability-only.

---

## 11. Live bench addendum — bootstrap goal failure (2026-04-30 ~T+25min)

After the first commit of this audit, the bench produced concrete data that confirms two of its findings and adds one new observation. Logged here rather than in §8 to keep the section's "informational only" framing intact.

### 11.1 Confirmed: information loss at BuildResult (audit §2.5 / §5 L1)

The bootstrap goal `gol_dde1c63b70017JXpz89XlhuNQs` (Project Bootstrap — Vite React Hono Scaffold) failed at `_session-r1-opencode.out:19180`:

```
ERROR service=task-tools error=build agent: terminal build report did not
match BuildResultSchema: [{"code":"invalid_type","expected":"object","path":
[],"message":"Invalid input: expected object, received undefined"}] build
tool failed
```

The build agent never called `report_build_result`, so the orchestrator received `undefined` instead of a `BuildResult` and the Zod schema rejected it. The agent's actual progress (read `package.json`, `vite.config.ts`, etc. — visible in earlier `service=file.time` lines for the same session) is **completely invisible** at the orchestrator level. The orchestrator only saw "the schema rejected the report." This is exactly the L1 loss class described in the audit: `BuildResult { status, summary, worktree }` is the only window into the build agent.

### 11.2 Confirmed: permission system can starve the build (memory `feedback_goal_permission_hang.md`)

At `_session-r1-opencode.out:19171`, immediately before the cancel:

```
INFO service=permission id=per_dde267938001E4OId9SwbdVVBt
permission=external_directory
patterns=["C:/Users/hengu/AppData/Local/Temp/mirrorcode-overlay-benchmark-project-UkylGI/*"]
permission timeout rejected
```

The permission was for the **bench project root itself** — the directory the build is supposed to write into. The 5-minute (300_011 ms) timeout fired, the prompt was cancelled (line 19175 `session.prompt sessionID=... cancel`), and the agent-runner finalised with `streamErrors=0 hasStructured=false` (line 19176). This is the exact shape memory `feedback_goal_permission_hang.md` describes: goal session inherits `ask` permission → tool blocks → cancel → empty terminal report.

The audit did not previously enumerate "permission seam" as a separate channel. Should be added in a future revision: permission asks are a **bidirectional channel between build-session tool and orchestrator's `engine/auto-permission.ts`** (see audit §3 multi-subscriber drift on `permission.asked`). When the orchestrator's auto-permission policy doesn't auto-approve a project-root path, the build agent stalls until timeout.

### 11.3 New finding: same session emits two contradictory terminal events

Lines 19182-19183 in the bench log:

```
[overlay-benchmark] session.terminal session=ses_221e2a0daffd... reason=aborted
[overlay-benchmark] session.terminal session=ses_221e2a0daffd... reason=completed
```

Same session ID, two terminal reasons in succession. The overlay-benchmark observer sees `aborted` (from the cancel path) and then `completed` (from the agent-runner's natural finally block). For a downstream consumer (overlay UI card render, or any subscriber that treats `reason=completed` as "successful terminal"), this is genuinely contradictory.

This is **not** a synthesised-message rule 15 violation — both events are real bus emissions from the session lifecycle. It is a **lifecycle-event under-specification**: the session has two natural terminal hooks (cancel vs natural finish) and both fire in cancel-during-finish race conditions. Suggested fix scope (out of audit): collapse to one terminal event with a discriminated `reason` union, or define a strict ordering invariant that the overlay observer can enforce.

### 11.4 Confirmed: bootstrap-first gate is **late rejection**

Open Question §10/2 asked whether the bootstrap-first gate is enforced upfront or as late rejection. The bench data confirms **late rejection**:

- T+~720s: orchestrator dispatched `gol_*0001` (bootstrap, kind=system) — accepted (line 7228).
- T+~723s: orchestrator dispatched `gol_*0002` (kind=system) — `bootstrap-first gate rejected non-bootstrap dispatch` (line 7456).
- T+~733s: orchestrator dispatched `gol_*0004` (kind=feature) — same rejection (line 7860).

The orchestrator's reasoning at line 7223 was: `reason=第一波并行构建：项目脚手架、镜像提取和后端实现` — i.e. it intended to fan out the first wave in parallel. The gate then rejected the non-bootstrap goals individually. This is rule 13 ambiguous: the gate is not a state machine in the traditional sense, but it does encode an ordering constraint that the LLM did not anticipate. Whether this is "LLM intelligence + invariant enforcement" (acceptable) or "hidden state machine" (rule 13 violation) depends on whether the constraint was visible in the LLM's prompt.

**Resolves Open Question #2** as: late rejection. **Updates §2.4** suspicion to confirmed observation.

### 11.5 Bench liveness summary (~T+30min)

Bench `tsk_dde13a67c001sbz6y2Qe0at8Fc` is still alive after the bootstrap failure: orchestrator session re-entered `step=7` at T+~30min, presumably to call `build` again on `gol_*0001`. Goal status flipped `failed → pending` and a new build session `ses_221d4c84dffd...` opened. The dispatch path (`build` tool invoked → `supersedeGoalRun:build_retry` → new session → agent_runner streaming) confirms audit §2.7 re-entry is structurally wired.

### 11.6 New finding: status visibility broken on retry — running-while-pending invariant

Initially the bench's progress reports for `gol_*0001` after retry suggested everything worked. Closer reading of the goal-status logs shows otherwise:

```
line 7228:  goalID=gol_*0001 from=(initial) to=running reason=beginBuildAttempt   (attempt 1)
line 19179: goalID=gol_*0001 from=running to=failed reason=updateGoalRun           (attempt 1 fail)
line 19356: goalID=gol_*0001 from=failed to=pending reason=supersedeGoalRun:build_retry  (retry begins)
line 19357: build-semaphore acquire
line 19358: session ses_221d4c84... created
line 19360-20359: build agent reading package.json/vite.config.ts/tsconfig.json/tailwind.config.ts, LLM streaming
```

**The retry attempt has no `from=pending to=running reason=beginBuildAttempt` transition log.** Yet the build agent is genuinely running — `service=session.prompt step=0..3`, multiple `service=file.time` reads, multiple `service=llm ... stream` events. Meanwhile the bench's progress snapshots over T+~25..30min show `gol_*0001:pending` with `sessions=["build:ses_221d4c84..."]` — the **goal status is `pending` while the build session is actively running**.

**Narrowed by source read** (rule 35 grep through `beginBuildAttempt`/`supersedeGoalRun`/`openGoalImplementationVersion` call sites):

- `beginBuildAttempt` has exactly one caller: `orchestrator/tools.ts:4020`, inside a try/catch that **throws on error and aborts dispatch** (`tools.ts:4031-4036`). The retry's build session `ses_221d4c84...` was created and is streaming, so `beginBuildAttempt` did not throw → it **did run**. Hypothesis (1) discarded.
- `beginBuildAttempt` (`engine/persist.ts:1410-1489`):
  1. Calls `openGoalImplementationVersion(goal, reason="build_retry", now)` — which calls `supersedeGoalRun(oldGoalRunID, "build_retry", now)`. `supersedeGoalRun` patches the old row via `appendGoalRunArtifact` with `time_updated = Math.max(existing.time_updated + 1, now)` (`persist.ts:565`).
  2. Inserts a new `goal_run_attempt` artifact with `status: "running"`, `time_created: now`, `time_updated: now` (`persist.ts:1455-1469`).
  3. Calls `syncGoalStatus(goalID, "beginBuildAttempt")` (`persist.ts:1471`).
- The supersedeGoalRun's `service=goal-status from=failed to=pending reason=supersedeGoalRun:build_retry` log (line 19356) DID emit. The follow-up `beginBuildAttempt`'s `syncGoalStatus` did NOT emit a new log line (greppable: zero `goalID=gol_*0001` transitions after line 19356).

**The most plausible root cause**: `syncGoalStatus` re-derived the goal status, but tip selection (`findLatestTipGoalRun` / `latestPerGoalRun`) did **not** pick the newly-inserted running row. The likely mechanism — verified by source — is the time-ordering race: the supersedeGoalRun patch sets old row's `time_updated >= now+1`, while the new row's `time_created == now`. If tip selection orders by `time_updated DESC` (or any ordering where the patched-old wins over the new at equal-or-near `now`), `deriveGoalStatus` continues to see the old superseded row and projects to `pending`.

This means the new running goal_run row **exists** in the DB but is **invisible to `deriveGoalStatus`**. Externally:
- The orchestrator describes goal as `pending` until something else changes the tip ordering (e.g. `finalizeBuildAttempt` writing time_completed will likely re-order).
- Bus event `Event.GoalRunUpdated` IS emitted at `persist.ts:1475-1488` with `status: "running"`, but it's the observability sidecar — does not change the derived status authority.

Either way, the **invariant "goal status reflects what is actually running" is broken on the retry path**. Severity:
- Overlay UI / external observers cannot tell that retry is in progress.
- Audit §5 information-loss list: this is a **new L8 entry**.
- If the same path is taken for non-bootstrap goal retries (likely — `supersedeGoalRun:build_retry` is reason-agnostic), every retry hides its progress.

This is the most concrete bug-class finding produced by this audit. Out of scope to fix here, but flagged for the next pass.

### 11.7 Resolution of audit §5 D3 (workspace_dir double source)

Reverse implication of §11.6: if the retry attempt does not create a new `goal_run_attempt` artifact, then `engine_goal.workspace_dir` (single, persistent across attempts) is the only source — `engine_goal_run.workspace_dir` for attempt 2 may not exist. Audit §6 D3 ("stale-read risk if reader hits goal_run path") is therefore **mostly theoretical** today: in practice, on retry, the `goal_run` row may not exist at all, so the reader has only one source to read from. The double-source becomes a no-source.

---

## Appendix A — files this audit reads

- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/architect/agent.ts`
- `packages/opencorvus/src/requirements/agent.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/build/types.ts`
- `packages/opencorvus/src/delivery/service.ts`
- `packages/opencorvus/src/delivery/verdict.ts`
- `packages/opencorvus/src/integrity/agent.ts`
- `packages/opencorvus/src/engine/runtime.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/model.ts`
- `packages/opencorvus/src/engine/catalog.ts`
- `packages/opencorvus/src/engine/goal-status.ts`
- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/executor/opencode.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/opencorvus/src/session/loop.ts`, `processor.ts`, `tool-resolver.ts`
- `packages/opencorvus/src/bus/`, `bus/global.ts`
- `packages/opencorvus/src/decision-log/index.ts`
- `packages/opencorvus/src/prompt/upstream-context.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/server/routes/app.ts`, `global.ts`, `orchestrator.ts`
- `packages/opencorvus/script/benchmark/runs/_session-r1-opencode.out` (live bench)

## Appendix B — abbreviations

- **DB** — database (project-local SQLite under `.opencorvus/`)
- **SSE** — Server-Sent Events (long-lived HTTP stream)
- **WIP** — Work-In-Progress
- **OOB** — Out-Of-Band
- **bus** — in-process pub/sub used for observability sidecar (Bus.publish / GlobalBus.emit)
- **rule N** — refers to `/CLAUDE.md` numbered rule N
