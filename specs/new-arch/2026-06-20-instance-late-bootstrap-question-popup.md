# Instance Late Bootstrap Question Popup Repair (2026-06-20)

## Problem

The running overlay showed a `question` tool row without the interaction dialog.
Log and database evidence showed:

- `Question.ask` published `que_ee303f93e001rHlHuZ4hdiHv9V`.
- The session chain was valid: orchestrator session -> task root session -> `engine_task.session_id`.
- No `engine_interaction_request` row was written for the question.
- The project log for `economy_1` had `creating instance` but no `bootstrapping`.

Root cause: a bare `Instance.provide({ directory, fn })` can create and cache a project instance before a server route later enters the same directory with `init: InstanceBootstrap`. Existing cached contexts do not currently run a late `init`, so `EngineService.init()` is skipped for that instance. Without `EngineInteraction.subscribe()`, task-scoped `Question.Event.Asked` events never become task interactions, leaving the dialog source empty.

## Call-Point Inventory

Whole-repo grep before implementation:

```text
rg -n "Instance\.provide\(\{[^\n]*init|init:\s*InstanceBootstrap|init:\s*\(\)|provide\(\{\s*directory" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

Relevant call points:

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/server/server.ts` | Server project routes pass the canonical `InstanceBootstrap`. This must work even when the instance cache already exists. |
| `packages/opencorvus/src/cli/bootstrap.ts` | Command-line bootstrap uses the same `InstanceBootstrap`; keep the same semantics. |
| `packages/opencorvus/src/channel/slack.ts` | Slack project execution also uses `InstanceBootstrap`; late init must not double-register services. |
| `packages/opencorvus/src/server/routes/pty.ts` | Bare project provide can still create a cached context without service bootstrap. This is valid, but must not permanently prevent later bootstrap. |
| `packages/opencorvus/src/engine/runtime.ts` | Existing BH-028 acceptance says pending interactions block active runs and resolved interaction rows clear their own blocker. Keep this central runtime projection working while verifying the question bridge. |
| `packages/opencorvus/test/project/instance-cache.test.ts` | Existing cached instance refresh tests are adjacent and must remain valid. |
| `packages/opencorvus/test/server/orchestrator-bridge-init.test.ts` | Add the regression for late bootstrap installing the question interaction bridge. |
| `packages/opencorvus/test/engine/interaction-permission.test.ts` | Existing interaction regression must keep passing; failure here indicates the central runtime projection drifted. |

## Design

Keep `Instance.provide` as the single source. Do not add UI projection fallback and do not mirror raw `question.asked` events into task cards.

Add per-context init tracking:

- The first cached context still runs the base context bootstrap.
- If a later `Instance.provide` supplies an `init` function that has not run for that context, run it inside the same instance context before `fn`.
- Track init by function identity and store the in-flight promise so concurrent callers share one init.
- If init fails, remove the promise so the next caller can retry the real init rather than being stuck in a silently broken state.

## Acceptance

- A bare cached instance followed by `init: InstanceBootstrap` installs `EngineInteraction.subscribe`.
- An orchestrator child session question writes one `engine_interaction_request` row and can be surfaced by the existing dialog host.
- Repeated calls with the same init function do not duplicate init work.
- No fallback, raw event UI bypass, or compatibility path is added.

## Adjacent Blocking Projection

During verification, `packages/opencorvus/test/engine/interaction-permission.test.ts` exposed that the BH-028 runtime projection had drifted: `EngineRuntime.syncRun` no longer marked active runs blocked for pending interactions.

Repair shape:

- `syncRun` first checks `findPendingInteractions(run.id)`.
- Pending permission/question interactions set the active run to `blocked` with `blocking_reason` equal to the interaction type.
- If no pending interaction remains, `syncRun` clears only blockers that have a resolved interaction row for the same run and same type, with `time_updated` not earlier than the current blocked run artifact.
- A pre-existing `blocked(question)` or `blocked(permission)` run with no resolved interaction row stays blocked; no guessed clearing path is added.
