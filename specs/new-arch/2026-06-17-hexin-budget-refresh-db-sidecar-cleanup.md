# 2026-06-17 Hexin Budget Refresh, DB Reset Notice, Sidecar Cleanup

## Request

- Refresh the Hexin budget display every 10 minutes while the current OpenCorvus model provider is `hexin`.
- Mark the budget red when remaining balance is below 20 USD.
- Replace the wide third-row budget layout with a compact single-row selector layout.
- Stop automatically deleting/recreating the SQLite database on schema drift. Surface that a DB reset is required and include the concrete database path.
- Automatically clean old extracted embedded sidecar payload directories so repeated overlay starts do not retain many obsolete binary trees.

## Call Point Inventory

| Area                | Evidence                                                                                                                                                                                                | Decision                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hexin budget route  | `packages/opencorvus/src/server/routes/provider.ts` owns `GET /provider/hexin/budget`. `specs/bug-hunt-2026-06-17.md` BH-005 reports upstream error body can echo secrets.                              | Keep one route. Tighten response schema and redact upstream error bodies; never return provider bearer text.                                            |
| Hexin budget client | `packages/overlay/src/components/ExecutorSelector.tsx` creates a resource keyed only by Hexin model name. BH-053 reports stale key risk.                                                                | Key resource by model, directory, task context refresh, and a timer tick.                                                                               |
| Hexin display       | Current CSS renders `.executor-budget-row` as a full-width strip under both chips. Screenshot shows it visually competes with the selector. Follow-up feedback rejected the remaining multi-row layout. | Move budget content into the OpenCorvus chip label row so Expert Squad, OpenCorvus, budget, and External executor occupy one meta row.                  |
| Budget threshold    | Existing backend response includes `remaining`; the request specifically says below 20 USD should be red.                                                                                               | UI computes low balance as `remaining < 20` and renders the red state. `overBudget` remains exposed as a separate data attribute for diagnostics.       |
| Directory policy    | `packages/overlay/test/api-directory-injection.test.ts` enumerates `provider` but not `provider/hexin/budget`; shared policy currently treats provider routes as project-scoped.                        | Add the concrete budget route to the injection test inventory.                                                                                          |
| DB schema drift     | `packages/opencorvus/src/storage/db.ts` currently calls `recreateWithCurrentSchema()` on drift or schema apply failure. `specs/db-schema-drift-reset-2026-06-03.md` documents the old reset decision.   | Replace automatic recreation with a thrown reset-required error containing `Database.Path()`. Keep explicit `Database.reset()` as the destructive path. |
| DB reset route      | `packages/opencorvus/src/server/routes/global.ts` calls `Database.reset(projectDir)`. BH-024 reports arbitrary `projectDir` deletion risk.                                                              | Validate `projectDir` is an absolute filesystem path before deletion and reject relative input with HTTP 400.                                           |
| Sidecar extraction  | `packages/overlay/src-tauri/src/main.rs` extracts to `app_local_data_dir()/embedded/sidecar-${EMBEDDED_SERVER_STAMP}` and never removes older stamp dirs.                                               | Add a cleanup pass that removes sibling `sidecar-*` directories except the current stamp before ensuring current extraction.                            |
| Sidecar tests       | `packages/overlay/src-tauri/src/main.rs` already contains unit tests for sidecar cwd and embedded payload metadata.                                                                                     | Add Rust unit tests for stale sidecar dir selection and preservation of non-sidecar entries/current payload dir.                                        |

## Contracts

- Budget refresh interval: `10 * 60 * 1000` milliseconds, active only while a Hexin model is selected and the overlay is connected.
- Low balance: remaining value below 20 USD.
- Budget row:
  - Must render inside the OpenCorvus selector label row when model provider is `hexin`.
  - Must not force the executor selector to span a second grid row.
  - Must have status semantics for loading/value/error.
  - Must not request the budget endpoint for non-Hexin models.
- DB drift:
  - Must not remove `opencorvus.db`, `opencorvus.db-wal`, or `opencorvus.db-shm` from `Database.Client()`.
  - Must throw an actionable error that contains the database path and reset endpoint/command hint.
- Sidecar cleanup:
  - Only children whose name starts with `sidecar-` under the embedded payload parent are eligible.
  - The current `sidecar-${EMBEDDED_SERVER_STAMP}` directory is never removed by the cleanup pass.

## Verification

- Passed: `bun test packages/overlay/test/executor-selector-dualbar.test.ts packages/overlay/test/api-directory-injection.test.ts`
- Passed: `bun test --timeout 60000 packages/opencorvus/test/storage/db-path.test.ts packages/opencorvus/test/server/provider-hexin-budget.test.ts packages/opencorvus/test/server/directory-required.test.ts`
- Passed: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml stale_embedded_sidecar`
- Passed: `bun run api:routes-check`
- Passed: `bun run --cwd packages/overlay typecheck`
- Passed: `bun run --cwd packages/opencorvus typecheck`
- Passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/executor-selector-redesign.test.ts`
- Passed: `bun run overlay:i18n-check`
- Visual review: `.scratch/hexin-budget-visual-qa-one-line.png`, Expert Squad, OpenCorvus plus Hexin budget, and External executor share one meta row (`top=644.52`, row height `35.11` in the fixture); `remaining=19.99` rendered red with `data-low-budget="true"`.
