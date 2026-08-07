# Frontend Design Visual Evidence Capture Mode

## Recall

- User request: fix the frontend-design loop that prevented a TradingView
  World Economy replica task from reaching Architect goals.
- Observed incident: task `tsk_f13306d200015GuqFDlEu213LJ` completed
  `frontend_research`, then `frontend_design` repeatedly called
  `submit_frontend_template({ final: true })` and received the same visual
  evidence validation error. The task was later cancelled externally.
- Acceptance criteria:
  - visual-baseline evidence must distinguish viewport screenshots from
    full-page screenshots in structured data;
  - submit-time evidence validation must render with the same capture mode used
    by the registered screenshot;
  - `inspect_frontend_result_status` must not report ready when the current
    visual evidence is guaranteed to fail submit validation;
  - validation failures must name the specific visual evidence mismatch instead
    of collapsing all failures into generic evidence missing;
  - existing anti-forgery checks for real raster files, source reference
    separation, and re-rendered entrypoint matching remain strict.
- Hard constraints: no fallback or compatibility bypass, no broad git reset, no
  weakening screenshot provenance, no OpenCorvus/overlay restart, and no
  additional worktree.
- Read before implementation:
  - `AGENTS.md`
  - `specs/records/2026-06/2026-06-21-dispatch-algorithm-agent-audit.md`
  - `specs/records/2026-06/2026-06-21-frontend-design-research-adversarial-repair.md`
  - `specs/records/2026-06/2026-06-23-incremental-frontend-result-tools.md`
  - `specs/records/2026-06/2026-06-23-visual-skeleton-region-comparison-root-repair.md`
  - `specs/records/2026-06/2026-06-27-frontend-design-reference-artifact-role-repair.md`
  - `packages/opencorvus/src/frontend-design/schema.ts`
  - `packages/opencorvus/src/frontend-design/output-tools.ts`
  - `packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts`
  - `packages/opencorvus/test/frontend-design/schema.test.ts`
- Whole-repository grep:
  - `rg -n "visual_validation_evidence|renderedEntrypointMatchesScreenshot|renderVisualHtmlSkeletonScreenshotForValidation|viewportDimensionsFromLabel|screenshot_sha256|source_reference_sha256|inspectVisualBaselineQualityForSubmit|inspect_frontend_result_status|submit_frontend_template|ToolVisualValidationEvidenceSchema|VisualValidationEvidence" packages/opencorvus/src packages/opencorvus/test specs -S`
  - `rg -n "capture_mode|full_page|fullPage|viewport.*full|desktop full-page|full-page|screenshot_artifact|render_target" packages/opencorvus/src/frontend-design packages/opencorvus/test/frontend-design specs/records/2026-06 -S`
- Independent agent feedback: not spawned in this turn because the active tool
  policy allows sub-agents only when the user explicitly asks for delegation.
  The historical independent audit records above are treated as external
  constraints: preserve AGENT-033 through AGENT-040 anti-forgery behavior and
  the 2026-06-23 incremental collector design.

## Root Cause

The registered visual evidence for the failed task pointed at
`visual-html-skeleton/desktop-render.png` with SHA-256
`d7ede330ba839af38a5f14ff37d4f488fcd887ba1d2e93ce7c17d57e8144e310`. The file
is a `1440x6619` full-page screenshot.

The evidence row recorded `viewport: "1440x900 desktop full-page"`. The submit
validator parsed the first `1440x900` token, re-rendered
`visual-html-skeleton/index.html` with a 1440 by 900 viewport and
`fullPage: false`, and produced SHA-256
`addb803246e953811a2361c126e8f2da3abe743af8d2d2196862c75184d39b4b`.

The mismatch was legitimate, but the tool result collapsed it into the generic
"artifact-backed rendered screenshot review evidence" error. The status tool
still said `ready_for_submit_validation` because it checked fragment counts and
not the submit-grade evidence chain. The model therefore retried the same
semantic correction class several times.

## Callpoint Inventory

| Surface | Current role | Required change |
| --- | --- | --- |
| `schema.ts::VisualValidationEvidenceSchema` | Stores rendered skeleton evidence with free-form `viewport`. | Add structured `capture_mode` to make viewport/full-page semantics explicit. |
| `schema.ts::ToolVisualValidationEvidenceSchema` | Same fields for incremental tool input. | Add the same strict field so unknown aliases still fail. |
| `output-tools.ts::renderVisualHtmlSkeletonScreenshotForValidation` | Re-renders screenshots for submit evidence verification. | Accept capture mode and call Playwright with matching `fullPage`. |
| `output-tools.ts::renderedEntrypointMatchesScreenshot` | Compares fresh render hash with registered screenshot hash. | Use structured capture mode and image dimensions when appropriate. |
| `output-tools.ts::isUsableRenderedScreenshotEvidenceForSubmit` | Returns boolean and hides failure reason. | Return structured diagnostics for field/path/hash/capture-mode failures. |
| `output-tools.ts::inspect_frontend_result_status` | Reports ready based on fragment counts. | Run submit-grade visual evidence diagnostics when a visual baseline is otherwise ready. |
| `output-tools.ts::submit_frontend_template` | Throws one generic evidence-missing message. | Include the first concrete diagnostic while preserving strict rejection. |
| `prompt/core/frontend-design-core.txt` and agent prompt fragments | Tell the agent to register viewport text. | Teach `capture_mode` and tell agents to avoid ambiguous "full-page" text in `viewport`. |
| `frontend-design` tests | Cover forged images and stale entrypoints. | Add full-page success, viewport/full-page mismatch, and status diagnostic regressions. |

## Plan

1. Extend visual validation evidence schemas with
   `capture_mode: "viewport" | "full_page"`.
2. Render screenshots with the registered capture mode during submit
   verification.
3. Replace boolean-only evidence validation with diagnostics that preserve the
   first concrete failure reason.
4. Make `inspect_frontend_result_status` surface `blocked_by_visual_evidence`
   for submit-grade visual evidence failures.
5. Update prompts/descriptions so models register explicit capture mode instead
   of embedding full-page semantics in viewport text.
6. Add focused regression tests and run frontend-design schema/output tests plus
   docs link health for the new spec record.

## Acceptance

- A full-page `1440x6619` skeleton screenshot with
  `capture_mode: "full_page"` passes submit validation when the fresh render
  hash matches.
- The same full-page screenshot with `capture_mode: "viewport"` fails with a
  diagnostic that names a rendered screenshot hash mismatch.
- `inspect_frontend_result_status` reports `blocked_by_visual_evidence` for the
  mismatch and does not instruct the model to submit.
- Existing forged-image, copied-reference, local-preview, and stale-entrypoint
  tests continue to pass.

## Verification

- `bun test packages/opencorvus/test/frontend-design/schema.test.ts packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/frontend-design/prompt.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/frontend-design --timeout 120000` reached
  84 passing tests, 2 skipped tests, and 1 transient Windows `EBUSY` failure
  while deleting a temporary SQLite WAL file in
  `visual-region-binding-tool.test.ts`.
- `bun test packages/opencorvus/test/frontend-design/visual-region-binding-tool.test.ts --timeout 120000`
  then passed all 5 tests, confirming the failed full-directory run was a test
  database cleanup lock rather than this repair.
