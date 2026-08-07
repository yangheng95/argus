# Default Agent Parallelism Five

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | “把默认并行度调整为5个”。 |
| Acceptance criteria | When neither the current Task budget nor merged project/user assistant configuration specifies `max_executor_groups`, the effective parallel Agent ceiling is exactly 5. An explicit Task budget remains highest priority and an explicit assistant configuration remains the next priority. `GET /config`, Overlay Composer, Task description, and scheduler execution observe the same value through existing projection paths. |
| Hard constraints | Change the single default source only. Do not add a second default, fallback, compatibility alias, Host admission gate, state machine, UI-local guessed value, or generated-schema constant. Preserve all unrelated dirty-worktree changes and do not change or run User Interface automated tests. |
| Sources read | `packages/opencorvus/src/engine/config.ts`, `engine/helpers.ts`, `engine/describe.ts`, `server/routes/config.ts`, `config/config.ts`, Overlay `composer-run-controls.ts`, current configuration architecture, public configuration docs, Engine configuration tests, and the preceding ready-frontier parallel-dispatch record. |
| Whole-repository grep | Searches covered every `max_executor_groups`, `agent_parallelism`, and parallelism occurrence across `packages/**` and `specs/**`, excluding generated OpenAPI/JavaScript SDK bulk output after confirming they describe only the optional positive-integer field. `EngineConfig.DEFAULTS.max_executor_groups` is the sole hardcoded runtime default. `EngineConfig.get()` merges an explicit assistant value over it; `effectiveMaxAgentParallelism()` gives a Task budget first priority; `configResponse()` projects the resolved default into `GET /config`; Overlay reads that server value without a local default; `describeTask()` renders the effective Task budget. Public docs use `4` only as an explicit configuration example, not a default claim. |
| Git baseline | Branch `v0.0.26beta` and `legacy-remote/v0.0.26beta` both resolve to `86947b221adbb5162c920f312521770787860e72`. Existing Overlay, Composer, screenshot, and preload changes are concurrent work and remain untouched. |
| Independent agent feedback | None. The user did not request delegated or parallel audit, so the active collaboration policy prohibits inferred sub-agent spawning. The primary agent owns the required second review. |

## Cause And Decision

The prior runtime default is the literal `3` in
`EngineConfig.DEFAULTS.max_executor_groups`. Every default-consuming surface
already converges through this object, so changing any route, Overlay service,
Task description, generated schema, or manifest would create a second source.

The direct correction is therefore:

1. Change that one literal from 3 to 5.
2. Keep the existing precedence chain unchanged:
   Task budget → merged assistant configuration → EngineConfig default.
3. Replace the directly encountered retirement-only negative test with a
   positive EngineConfig contract proving both the new default and explicit
   configuration override.
4. State the numeric default in current architecture so operator-facing
   behavior is unambiguous; keep public examples as examples.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/opencorvus/src/engine/config.ts` | Replace the sole default literal `3` with `5`; preserve merge and exported-default behavior. |
| `packages/opencorvus/src/engine/helpers.ts` | Preserve Task budget → live EngineConfig precedence. |
| `packages/opencorvus/src/server/routes/config.ts` | Preserve resolved default projection into `GET /config`. |
| `packages/opencorvus/src/engine/describe.ts` | Preserve rendering of effective `agent_parallelism`. |
| `packages/overlay/src/services/composer-run-controls.ts` and `ChatComposer.tsx` | Preserve server-config projection and UI controls; no UI change or UI test. |
| `packages/opencorvus/src/config/config.ts`, OpenAPI, and generated SDK | Preserve optional positive-integer schema; the numeric runtime default is not schema-owned. |
| `packages/opencorvus/test/engine/config-retired-repair-loop.test.ts` | Delete the encountered retirement-only negative contract. |
| `packages/opencorvus/test/engine/config-defaults.test.ts` | Add positive tests for default 5, explicit assistant override, and the real project-scoped `GET /config` projection. |
| `specs/current/architecture/05-config.md` | Record 5 as the canonical no-override default and preserve the precedence boundary. |
| Public English and Chinese configuration examples | Preserve explicit example value 4; it demonstrates an override and makes no default claim. |

## Implementation And Verification Plan

1. Commit and push this Recall before product changes.
2. Change the single EngineConfig default, replace the negative retirement test
   with positive default/override coverage, and update current architecture.
3. Run the focused Engine configuration contract, OpenCorvus TypeScript
   checking, historical-document links, product-document single-source,
   document health, owner grep, and `git diff --check`.
4. Perform a second exact-diff and precedence review, update this record, fetch
   and converge remote changes, commit only task-owned paths through a
   current-HEAD isolated index, push through normal hooks, and verify remote
   convergence.

## Progress

- [x] Default owner, precedence, route/UI/runtime projections, schema/docs,
      tests, Git baseline, and unrelated worktree state inspected.
- [x] Recall commit `6fe22b900a` and legacy remote push complete.
- [x] Default, positive contract, and architecture update complete.
- [x] Implementation commit `b7ae2051c5`, complete pre-push hook, legacy remote push,
      and immediate remote convergence complete.

## Verification And Second Review

- The focused EngineConfig and real project-scoped configuration route
  contracts passed: 3 tests, 0 failures, 6 expectations. They prove the
  complete default object contains `max_executor_groups: 5`, an explicit
  assistant value remains authoritative, and `GET /config` publishes 5 when
  no override exists.
- Historical index, product documentation single-source, and document-health
  contracts passed: 73 tests, 0 failures, 1378 expectations.
- OpenCorvus TypeScript checking and `git diff --check` passed.
- Final owner grep confirms production and current architecture contain one
  numeric default: `EngineConfig.DEFAULTS.max_executor_groups = 5`. The two
  remaining `max_executor_groups: 3` occurrences are explicit
  `describe-build-host-observation` test fixtures that verify rendered supplied
  budgets; they are not default sources and remain unchanged.
- Second review traced the full precedence and projection chain:
  `effectiveMaxAgentParallelism()` returns an explicit Task budget first,
  otherwise `EngineConfig.get()` returns an explicit merged assistant value or
  the default 5; `configResponse()` publishes that resolved value; Overlay
  reads it without guessing a local default. OpenAPI and generated Software
  Development Kit schemas remain shape-only and therefore require no
  regeneration.
- The encountered `config-retired-repair-loop.test.ts` contained only negative
  retirement assertions. It was deleted and replaced by current positive
  runtime and HTTP contracts.
