# E01 NVIDIA Research and Valuation Website

Date: 2026-07-25
Status: Active retest
Acceptance: Not yet achieved

## Scope

Research NVIDIA's recent four quarters and three completed fiscal years, retain
source provenance, normalize financial and competitor data, implement an
auditable three-scenario valuation model, and deliver a runnable Chinese
desktop research site whose assumptions, target price, upside, and
recommendation update through real interactions.

## Run history

| Run | Task | Result | Root evidence |
| --- | --- | --- | --- |
| Preflight 1 | none | Failed | Benchmark imported undeclared `puppeteer-core`. |
| Preflight 2 | none | Failed | Hand-built Overlay settings drifted from the canonical schema. |
| Initial Task | `tsk_f9928f169001XaE6A7x95oumXt` | Failed | Terminal synchronous intent result was treated as an in-flight dispatch. |
| Rerun 1 | `tsk_f9933252d001TKMpiAbp3UiC16` | Failed | Target-local dispatch contract did not explain `final_message_id`; Orchestrator scheduled an internal wait. |
| Rerun 2 | `tsk_f9939457e001jmhaHnBoHcpyL9` | Failed | Nested Architect `ir_json` validation returned no legal discriminator diagnostics. |
| Rerun 3 | `tsk_f99450a7d001Yo1Cy1rsZp4tyq` | Failed | All dependent Goals were started immediately; background builds were then rejected by a closing Instance lease. |
| Rerun 4 | `tsk_f995b4663001yZIhiQ58IW3HMf` | Failed | Bootstrap build and Host observation succeeded, but contradictory lifecycle wording made the Orchestrator wait for an automatically produced Goal result that does not exist. |
| Rerun 5 | `tsk_f997ca2ff001k6Hbrtm9Uip4xS` | Failed | Browser sidecar closed before report-time page evaluation and screenshot capture. |
| Rerun 6 | `tsk_f9986692a001rCI0vOW1nom3oA` | Interrupted | Intent analysis and one research Session completed, but the runner disappeared while a second research Session was streaming; the real database retains an active Task with zero Goals and no live producer. |
| Rerun 7 | pending | Pending | Clean-project validation after common infrastructure repairs. |

## Proven repairs

- Node-launched headed Playwright sidecar replaces undeclared browser
  dependencies.
- Persisted Overlay settings derive from the canonical fixture.
- Synchronous terminal adapter results open a new scheduler decision epoch.
- Each projected target documents its exact strict input fields.
- Architect execute-time schema errors expose paths and legal discriminator
  values without mutating the draft collector.
- Only Goals explicitly visible as dispatchable may be started; dependencies do
  not delay an already-dispatched worker.
- Registered background Instance activities may re-enter their inherited
  closing lease while closure waits; detached callbacks remain rejected.
- Workload-review `goal_ids` is immutable exact scope; an empty array means
  zero Goals and cannot be widened by later coordination.
- Terminal Build Session and Host observation facts require an explicit
  `complete_goal`, retry/correction, or failure decision; they do not
  auto-create a Goal result.
- Interrupted benchmark reports are captured before browser/server teardown,
  and browser cleanup no longer manufactures `ERR_ABORTED` failures by closing
  pages separately.

## Quality judgment

No investment-site quality score is assigned yet. Runs 1–6 are infrastructure
and orchestration failures and did not deliver the requested product. Treating
their terminal Sessions or partial scaffold as an acceptable investment
deliverable would be false evidence.

## Pending acceptance

- Complete the full Goal graph.
- Verify current-source provenance and normalized data.
- Run `bun run verify` without network access.
- Start the real desktop site.
- Exercise scenarios, custom inputs, source navigation, validation errors, and
  keyboard focus with Node Playwright.
- Inspect and archive product screenshots.
- Score source quality, completeness, functionality, visual quality,
  traceability, and scope control.
