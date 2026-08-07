# Frontend Design Canonical Render Evidence

## Recall

### Original user requirement

Investigate and fix why Task `tsk_f802684850012OpovnGW0NRPJb` reported a visual-evidence failure during an original Frontend Innovate design turn even though the user did not provide or require an external visual reference for that early design stage.

### Acceptance criteria

1. `greenfield_original` continues to require a real rendered screenshot review of the source-editable HTML/CSS design, but never requires a source/reference screenshot or parity comparison.
2. Frontend Design has one canonical tool that renders the declared `visual-html-skeleton` entrypoint, writes the task-scoped screenshot artifact, computes its SHA-256 digest, and registers the resulting `render_review` evidence with the same browser backend used by submit-time verification.
3. Agents are instructed to use the canonical capture tool rather than producing a screenshot with an unrelated Chrome command and registering its digest afterward.
4. `reference_parity` keeps its existing explicit source-reference and comparison-evidence requirements; the repair must not weaken forged, stale, copied-reference, path-boundary, or hash validation.
5. Status diagnostics continue to expose a real rendered-output reproducibility failure when an externally produced screenshot does not match a fresh canonical render.
6. Focused frontend-design tool, prompt, adapter-contract, typecheck, and document-health tests pass.
7. No running OpenCorvus or Overlay process is stopped, restarted, refreshed, or reloaded.

### Hard constraints

- Do not bypass or relax the submit-time screenshot verification.
- Do not add a fallback renderer, compatibility alias, workflow gate, or second visual-evidence source.
- The capture tool owns PNG materialization and digest derivation; the model supplies review semantics, not a claimed hash.
- Use Node-launched Playwright through the existing browser sidecar. Do not use Bun to launch Playwright.
- Preserve `greenfield_original` versus `reference_parity` as the existing explicit design-authority distinction.
- Commit subjects use the `dsw-33987` prefix and the delivery branch is `v0.0.12beta` on `legacy-remote`.

### Sources read

- `AGENTS.md`
- Task/session/decision evidence in `/Users/yangheng/.local/share/opencorvus/opencorvus.db`
- `specs/records/2026-06/2026-06-29-frontend-design-visual-evidence-capture-mode.md`
- `specs/records/2026-07/2026-07-07-frontend-innovate-html-design-ground-truth.md`
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- `packages/opencorvus/src/frontend-design/agent.ts`
- `packages/opencorvus/src/frontend-design/schema.ts`
- `packages/opencorvus/src/frontend-design/output-tools.ts`
- `packages/opencorvus/src/frontend-design/static-tools.ts`
- `packages/opencorvus/src/agent/dispatch-adapter-contract.ts`
- focused frontend-design and orchestrator tests

### Whole-repository search evidence

Repository-wide `rg` enumerated every current `visual_baseline_input`, `source_baseline_input`, `visual_validation_evidence`, `update_frontend_visual_evidence`, `rendered_entrypoint_hash_mismatch`, `greenfield_original`, `reference_parity`, frontend-design private tool ID, and build-handoff projection call point.

| Call point | Disposition |
| --- | --- |
| `frontend-design/agent.ts::renderModeSpecificEvidenceContract` | Update the Greenfield and Reference-Parity instructions to use one canonical capture-and-register tool for rendered skeleton screenshots. |
| `frontend-design/output-tools.ts::renderVisualHtmlSkeletonScreenshotForValidation` | Reuse unchanged as the single browser renderer for both capture and submit-time fresh verification. |
| `frontend-design/output-tools.ts::validateRenderedScreenshotEvidenceForSubmit` | Keep strict file, raster, digest, source-reference, and fresh-render validation unchanged. |
| `frontend-design/output-tools.ts::update_frontend_visual_evidence` | Keep as the explicit registration/update surface for already materialized evidence and negative-path testing; do not weaken validation. |
| `frontend-design/output-tools.ts::createFrontendTemplateOutputTools` | Add the canonical capture tool beside evidence registration; resolve and validate the entrypoint/output path under the real task artifact root, render, persist, hash, and upsert one mode-correct evidence row. |
| `frontend-design/static-tools.ts` | Add the canonical tool ID to the frontend-design output tool catalog. |
| `agent/dispatch-adapter-contract.ts` | Add the same private stage tool ID so the adapter contract and live tool surface remain identical. |
| `frontend-design/schema.ts` | Reuse the existing strict visual evidence schemas; add only a capture request schema if necessary, without duplicating final evidence semantics. |
| `frontend-design/output-incremental-tools.test.ts` | Add positive canonical capture/finalization coverage and negative path/mode coverage while preserving existing hash-mismatch regressions. |
| `frontend-design/prompt.test.ts` | Assert that original design does not require external visual authority and directs the model to canonical capture. |
| `agent/dispatch-adapter-contract` and tool-surface tests | Assert the new tool is projected exactly once as a frontend-design-owned terminal-stage helper. |
| `agent/dispatch-adapter-input.ts` | State that every material row names one regular file; directories must be enumerated as explicit file rows. |
| `orchestrator/frontend-design-tool.ts` | Verify the resolved material is a regular file before reading it and report the offending material path without traversing directories. |
| `expert-squad/package-tool-bundle.ts` | Resolve extensionless relative code imports once through Bun's resolver before closure loading; keep explicit JSON/text imports on their declared loaders. |
| `expert-squad/package-tool-bundle.test.ts` | Preserve source-closure, JSON/text-loader, digest, and parallel preparation coverage while preventing sibling tests from deleting shared fixtures or replacing the process-global compiler. |
| Build/Architect/Visual QA handoff consumers | No semantic change: they continue to consume the existing `frontend_project.role`, design authority, and finalized evidence rows. |

### Independent agent feedback

None. The user did not request delegated or parallel-agent work.

## Causal chain

- Observable symptom: `inspect_frontend_result_status` repeatedly returned `blocked_by_visual_evidence` for `visual-markets-1440`.
- Direct trigger: the registered PNG digest `52aa8125...` differed from the fresh submit-validator render digest `697d8c65...`.
- Proven capture boundary: the task artifact records the registered screenshots as Google Chrome CLI captures with custom flags, while submit verification launches the existing Node/Playwright browser sidecar.
- Deeper design flaw: Frontend Design requires byte-identical fresh-render proof but exposes no canonical capture tool. The model must independently choose a browser command, flags, timing, output path, and digest, so two individually deterministic renderers can produce different raster bytes.
- Why retry did not repair it: the validator does not materialize its fresh-render PNG, so the model could observe only the alternate digest and could neither compare pixels nor register the canonical artifact honestly.
- Separate earlier symptom: an orchestrator dispatch supplied `docs/01-research/evidence/` as a file material and received `EISDIR`; the retry removed that directory and reached the distinct render-reproducibility failure.
- Root repair: make the existing Playwright sidecar renderer the sole screenshot materialization and verification implementation for Frontend Design evidence.

## Implementation plan

1. Define a strict capture request that contains evidence identity, entrypoint, output artifact path, viewport dimensions, capture mode, review status/summary, and reference-comparison fields only when the active mode requires them.
2. Add a frontend-design stage tool that validates task-root paths, renders through `renderVisualHtmlSkeletonScreenshotForValidation`, atomically writes the PNG, derives SHA-256, and upserts the canonical evidence row.
3. Update mode-specific prompting and tool descriptions so models use canonical capture; keep direct registration for explicit evidence updates and negative validation.
4. Add positive Greenfield capture/final-submit coverage, Reference-Parity source authority coverage, path rejection, and tool-surface/prompt regressions.
5. Run focused tests, package typecheck, documentation health, diff review, commit, and push.

## Verification ledger

### Codex review feedback

The first implementation review confirmed that the same Task had an earlier independent `EISDIR` failure. Whole-repository inspection found that `materials[].path` was described as a local resource while the materializer unconditionally called `readFile`; the contract did not tell the Orchestrator that each row must identify one regular file. The repair therefore also makes the single-file boundary explicit in the dispatch schema, verifies it before reading, and rejects directories with an actionable error. It deliberately does not traverse or infer directory contents.

The complete Frontend Design suite then reproduced the same `prepare-source-context` package-tool compile failure under concurrent test load, while the exact prompt test passed alone. Repeating the same two-file test produced one failure and one pass, proving nondeterministic resolution rather than a missing source file. A first attempt to return resolved paths for every relative import changed explicit JSON/text import semantics and was rejected by focused package-tool tests. The corrected repair uses Bun's resolver only for extensionless relative code imports, validates that the result is an allowed package-owned TypeScript or JavaScript file, and leaves explicit JSON/text assets on their declared loaders. This removes the unresolved-import race without serializing the production compiler or adding a fallback path.

Focused package-tool verification also exposed two test ownership bugs: the file-level `afterEach` deleted every concurrently created fixture root, including roots still owned by sibling tests, and one case spies on the process-global `Bun.build` while siblings invoke it. The suite now runs serially and cleans fixture roots once after all cases settle, so tests cannot delete or replace compiler state owned by siblings.

The same independent runtime-digest fixture had also drifted from the production plugin closure: production resolves both `zod` and `property-information`, while the fixture resolved only `zod`. The fixture now mirrors both declared runtime dependencies so its digest comparison measures the current closure rather than a stale compiler configuration.

- `bun test packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts --timeout 120000`: 20 passed, 0 failed.
- Focused schema, prompt, and adapter-contract tests: 26 passed, 0 failed.
- `bun test packages/opencorvus/test/expert-squad/package-tool-bundle.test.ts --timeout 120000`: 18 passed, 0 failed.
- `bun test packages/opencorvus/test/frontend-design --timeout 120000`: 89 passed, 2 intentionally skipped, 0 failed.
- Focused Orchestrator material-directory rejection: 1 passed, 0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Historical-link and document-health tests: 82 passed, 0 failed.
