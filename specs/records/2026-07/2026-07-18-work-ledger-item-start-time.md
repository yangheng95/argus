# Work Ledger Item Start Time

Status: completed and delivered to git-cc

## Recall

| Item | Detail |
| --- | --- |
| User request | Add the current Task, Chat, and Mission start time to the Work Ledger row hover popup shown in the supplied screenshot. |
| Acceptance criteria | The existing Kobalte Work Ledger Tooltip remains the only item hover surface. A started Task, Chat, or Mission visibly shows a localized `Started` label, an exact local start timestamp, and the compact relative start time in the headline. The semantic HTML `time` values use the same canonical timestamp. A queued Task with no execution start omits both time presentations instead of showing its creation time. Real desktop browser coverage opens and checks Task, Chat, Mission, and not-started Task popups, and task-scoped screenshots are visually reviewed. |
| Hard constraints | Preserve the mature Tooltip, Work Ledger response, time-formatting utilities, and current compact desktop geometry. Do not add a hover fetch, native `title`, frontend fallback from `started` to `created`, second popup, state machine, mobile/tablet scope, new worktree, or intervention in the running OpenCorvus/Overlay. Use `EngineTaskTable.time_started` as the Task execution-start authority; Chat and Mission start with their persisted session creation time. Run Playwright through Node. Commit subjects start with `dsw-33987` and push to `myhexin`. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f60e864b-106e-4809-bf29-2786ea3a770c.png`, inspected at original `1076x291` resolution. The current compact popup contains a title, an unlabeled relative value (`2d ago`), and the folder name, but no visible exact/labeled start-time fact. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/records/2026-07/2026-07-17-work-ledger-compact-context-tooltips.md`; the recent Work Ledger hover/tooltip records; current Work Ledger backend projection/route/schema, Overlay service/component/styles/i18n, time utilities, focused source tests, route tests, and the Node browser fixture. |
| Whole-repository search evidence | `packages/opencorvus/src/work-ledger/projection.ts` is the single Work Ledger response owner. `MissionTaskProjection.started` already exposes `EngineTaskTable.time_started`, while the Work Ledger task adapter currently discards it and exports only `created`/`updated`. Standalone Task projection also has direct access to `task.time_started`. Mission and Chat adapters have canonical session creation timestamps. `packages/overlay/src/components/WorkLedger.tsx` is the sole item-summary Tooltip producer and currently formats `row.created` as `tooltipStartTime`; `packages/overlay/src/services/work-ledger.ts` is the frontend row contract. `work-ledger-consolidation.test.ts`, `project-ledger-group-browser.test.ts`, `work-ledger-fixture.ts`, and `work-ledger-routes.test.ts` are the direct regression/fixture owners. The Work Ledger OpenAPI response is generated into `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/**`; API reference MDX is generated from the same schema. No database schema or migration is required. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | The task plan was committed and pushed at `fe12be0f3` on `work-v0.0.9beta-yr-0718`, after the pre-existing interaction-response chronology work was independently committed at `d70f5bb40`. |

## Causal chain

1. The popup already renders a relative value, but it is computed from `row.created` and therefore only proves when the record was created.
2. Task execution has a separate canonical `time_started`; queued Tasks deliberately keep it null, and Task restarts can establish a start distinct from creation.
3. The Work Ledger backend adapter drops that field, so the frontend cannot truthfully render execution start and previously relabeled creation time instead.
4. The root repair is a required Work Ledger `started` projection (`number | null` for Tasks, session-created timestamp for Chat/Mission), followed by one Tooltip presentation that formats only this field. No frontend fallback is valid.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/work-ledger/projection.ts` | Add `started` to Task, Chat, and Mission row schemas. Project Mission-child and standalone Task starts from their canonical task fields; project Chat/Mission starts from session creation. Keep Project rows unchanged. |
| `packages/opencorvus/test/server/work-ledger-routes.test.ts` | Seed distinct creation/start values and prove Mission, nested Task, standalone queued Task, and Chat projections, including null omission semantics for a not-started Task. |
| `packages/overlay/src/services/work-ledger.ts` | Mirror the generated contract: all item rows expose `started`, with Task allowing null. |
| `packages/overlay/src/components/WorkLedger.tsx` | Replace the misleading `created`-based formatter with `started`-only relative and exact formatters. Add one localized exact start fact to the existing Tooltip and omit all time nodes when start is null. |
| `packages/overlay/src/styles/surfaces/work-ledger.css` and locale catalogs | Add only the compact label/value row styling and the `work_ledger.tooltip.started` localization. Reuse current tokens and `detailStamp`; do not add a custom date formatter or popup primitive. |
| `packages/overlay/test/work-ledger-consolidation.test.ts` | Assert the unified row contract, the absence of `created` fallback, exact/relative time owners, localization, and compact styles. |
| `packages/overlay/test/browser/work-ledger-fixture.ts` | Preserve canonical task start values when constructing generic Work Ledger browser fixtures. |
| `packages/overlay/test/browser/project-ledger-group-browser.test.ts` | Use distinct start values and verify started Task, Mission, Chat, and queued Task hover behavior, accessibility/dateTime ownership, geometry, and scoped screenshots. |
| Generated API/SDK/docs | Regenerate OpenAPI, the JavaScript SDK, and API MDX from the runtime route schema; do not hand-edit generated contracts. |

## Implementation and verification plan

1. Add failing backend and Overlay assertions for the true start-time contract and the queued-Task omission behavior.
2. Implement the backend projection and existing Tooltip composition, then regenerate API/SDK/docs with the repository toolchain.
3. Run focused backend/Overlay tests, typecheck, i18n, API route/OpenAPI checks, and the Node-launched desktop browser fixture.
4. Inspect the Task, Chat, and Mission popup screenshots at original resolution, correct any density/overflow issue, and rerun until visually accepted.
5. Run documentation health and exact diff checks, update this record with evidence, stage only task-owned files, commit, and push to git-cc.

## Verification commands

```powershell
bun test packages/opencorvus/test/server/work-ledger-routes.test.ts
bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/work-ledger-fixture.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run api:routes-check
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Progress

- [x] Supplied screenshot, current behavior, semantic data authority, historical decisions, and direct call sites inspected.
- [x] Regression assertions added and observed failing against the missing backend/frontend `started` contract.
- [x] Backend contract, generated artifacts, and Tooltip presentation implemented.
- [x] Focused/type/i18n/API/browser verification and visual review passed.
- [x] Exact diff review, commit, and git-cc push completed.

## Implementation result

- Task rows now project `EngineTaskTable.time_started` as the only execution-start authority. Mission child Tasks preserve the same nullable start; queued Tasks remain null and render no start-time fact.
- Mission and Chat rows project their persisted session creation timestamp as `started`.
- The existing item Tooltip renders one localized exact start row and, while it remains meaningfully shorter, the same timestamp as a relative headline value. Both semantic `time` elements share the canonical ISO timestamp.
- OpenAPI and the JavaScript SDK were regenerated from the route schema; no hand-edited or parallel contract was added.

## Verification evidence

| Check | Result |
| --- | --- |
| Backend route regression | `8 pass`, `71 expect()` calls. Covers Mission, nested Task, standalone queued Task, and Chat start projection. |
| Overlay source/fixture regressions | `11 pass`, `364 expect()` calls. Covers the frontend row contract, no creation-time fallback, localization, and fixture start preservation. |
| Overlay typecheck and i18n | Both passed. |
| API and SDK | `api:routes-check` passed all 6 rules across 31 files; `docs:check` passed with 274 operations across 24 groups; JavaScript SDK typecheck passed. |
| Desktop browser | Node-launched browser test passed. It exercised started Task, queued Task, Mission, and Chat hover popups with canonical `dateTime` assertions. |
| Visual review | Original-resolution Task, Mission, and Chat Tooltip screenshots were inspected. The resulting popup is `300x94`, retains one-line ellipsis and compact spacing, and shows the labeled exact start without overflow. |
| Documentation health | Historical links, document health, and product-doc single-source suites passed: `84 pass`, `1333 expect()` calls. |
| Git delivery | Implementation commit `a46b766a8` (`dsw-33987 add Work Ledger item start time`) passed the repository pre-push hook and was pushed to `myhexin/work-v0.0.9beta-yr-0718`. The hook independently passed 10 package typechecks, API route checks, generated-doc consistency, Overlay i18n, and the tracked-source secret scan. |
