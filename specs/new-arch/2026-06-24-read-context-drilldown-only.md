# Read Context Drilldown Only - 2026-06-24

## Acronyms

- DB: Database, the persisted task/session/artifact store.
- LLM: Large Language Model, the model running the orchestrator turn.

## Objective

Specialize `read_context` into an explicit drilldown tool that only returns
state not already injected into the orchestrator prompt. The tool should stop
serving as a task-state refresh surface for normal scheduling.

## Recall

- `2026-06-24-scheduler-compact-read-context.md`: removed default `scope=all`
  but still kept scopes that duplicated scheduler prompt state.
- `renderTaskDescription(describeTask(...))` is injected on every orchestrator
  wake and already contains task request, research summaries, runtime facts,
  dispatchable goals, blocked goals, terminal refill facts, goals, latest
  acceptance verdict, recent stream failures, and agent/tool failure facts.
- `orchestrator/agent.ts` also injects latest active-run acceptance/evaluation
  summaries with pointers to persisted rows.

## Call-Point Sweep

Command basis:

```powershell
rg -n -F "read_context" packages/opencorvus/src packages/opencorvus/test specs/new-arch -g "!packages/opencorvus/src/provider/models-snapshot.ts"
rg -n -F "renderTaskDescription" packages/opencorvus/src packages/opencorvus/test -g "!packages/opencorvus/src/provider/models-snapshot.ts"
rg -n -F "createDecisionLog" packages/opencorvus/src/orchestrator packages/opencorvus/src/engine
```

| Surface                                | Decision                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_context scope=goals`             | Delete. `renderTaskDescription` already renders goals, dispatchable IDs, live run facts, terminal refill facts, and orphan facts every wake.                                       |
| `read_context scope=evaluations`       | Delete. Active-run evaluation is already injected by `orchestrator/agent.ts`; historical evaluation dumps are not scheduling input.                                                |
| `read_context scope=deliveries`        | Delete. Active-run acceptance is already injected by `orchestrator/agent.ts`; historical delivery lists are not scheduling input.                                                  |
| `read_context scope=research`          | Delete. `renderTaskDescription` already renders deep/frontend research artifact IDs, session IDs, stale status, source URLs, bundle paths, coverage counts, and bounded summaries. |
| `read_context scope=integrity_history` | Keep. Multi-round root history and artifact-missing status are repair drilldown, not ordinary scheduler state.                                                                     |
| `read_context scope=fact_checks`       | Keep. Fact-check attempt rows are audit drilldown and are not rendered in the normal task snapshot.                                                                                |
| `read_context scope=decisions`         | Keep. Decision-log review/general history is a bounded audit drilldown for recurrence and stale-artifact recovery.                                                                 |
| Orchestrator prompt/tool descriptions  | Remove guidance telling the scheduler to call `read_context({scope:"goals"})` for normal dispatch or after wait.                                                                   |
| Workload-analysis status               | Render as `workload_analysis=not_run/current/stale` in the normal task snapshot. It is a scheduler fact, not a read-context drilldown.                                             |

## Design

`read_context` remains one tool because the session snapshot projection and
decision-effect plumbing already treat it as a read-only observation. Its schema
is narrowed to:

- `integrity_history`
- `fact_checks`
- `decisions`

The tool description must say it is not a normal scheduler refresh tool. It
should be used only when the current prompt points to a persisted artifact,
fact-check attempt, or decision-log history that needs drilldown.

## Acceptance

- `read_context` schema rejects omitted scope, `all`, `goals`, `evaluations`,
  `deliveries`, and `research`.
- Integrity history, fact-check attempts, and decision-log output remain
  reachable through their dedicated scopes.
- Orchestrator prompt no longer instructs normal dispatch, refill, or wait
  recovery to call `read_context({scope:"goals"})`.
- Workload-analysis status is visible in `renderTaskDescription` as one compact
  task snapshot fact and no prompt says `read_context` exposes it.
- The implementation removes now-dead research/goal/evaluation/delivery
  read-context rendering helpers and caps instead of leaving a hidden parallel
  state refresh path.
