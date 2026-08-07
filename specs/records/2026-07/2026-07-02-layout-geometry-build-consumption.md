# Layout Geometry Build Consumption Repair

Date: 2026-07-02

## Recall

User request:

- The current layout alignment tool is not working; the rendered page is still visibly misaligned.
- The attached screenshot of the TradingView indices clone shows the main market summary section left-aligned near the page edge while later content such as `Index collections` is centered on a different rail.

Acceptance criteria:

- `browser_preview_layout_geometry` must produce structured evidence for cross-region layout alignment, not only per-region boxes.
- Layout geometry diagnostics that Visual QA cites for a failed report must reach Build as first-class diagnostic evidence, not only as plain text refs.
- Build passed reports must prove they consumed dispatched Visual QA diagnostic evidence before claiming `status="passed"`.
- Visual QA and Build prompts must tell agents to use geometry manifests for page-edge / shared-rail drift while preserving `VisualEvidenceBundle` as the formal rendered-vs-reference authority.
- Add focused regression tests for geometry alignment summaries and Visual QA -> Build evidence transport.
- No fallback, compatibility path, host gate, fake E2E claim, worktree creation, process restart, or broad git reset.

Hard constraints:

- Preserve existing dirty worktree changes; several Visual QA / Build evidence repairs are already unstaged.
- Do not grant Build direct access to `browser_preview_layout_geometry`; Visual QA remains the owner of that tool.
- `layout-geometry` evidence is supporting diagnostic evidence only, not `reference-comparison` proof.
- Visual changes still need real browser screenshot review before final delivery.
- Every code change requires targeted tests.

Sources read:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-02-visual-qa-annotated-repair-consumption.md`
- `specs/records/2026-07/2026-07-02-visual-evidence-bundle-authority-repair.md`
- `specs/records/2026-07/2026-07-01-visual-qa-multi-viewport-alignment.md`
- `specs/records/2026-06/2026-06-29-browser-preview-layout-geometry-diagnostic.md`
- `specs/records/2026-06/2026-06-30-visual-qa-problem-dom-report.md`
- `packages/opencorvus/src/browser-preview/layout-geometry-diagnostic.ts`
- `packages/opencorvus/src/tool/browser-preview-layout-geometry.ts`
- `packages/opencorvus/src/browser-preview/persist.ts`
- `packages/opencorvus/src/acceptance/visual-evidence.ts`
- `packages/opencorvus/src/build/evidence-pack.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/build/prompt-context.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/visual-qa/schema.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/test/browser-preview/layout-geometry-diagnostic.test.ts`
- `packages/opencorvus/test/orchestrator/build-feedback-context.test.ts`

Whole-repository search evidence:

- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' --glob '!**/.git/**' "layout.*geometry|geometry.*layout|alignment|align|misalign|crooked|skew|歪|对齐|left rail|content rail|main.*rail|browser_preview.*geometry|geometry_diagnostic|layout_diagnostic" packages specs AGENTS.md -S`
- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' "browser_preview_layout_geometry|layout-geometry|LayoutGeometry|layoutGeometry|layout_geometry" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 specs/records/2026-07 -S`
- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' "composeLatestAcceptanceFeedbackForBuild|composeLatestVisualQaFeedbackForBuild|renderVisualQaProblemDomFeedback|visualQaFeedback|Visual QA Repair Overlay|production_blockers|problem_dom_regions|layout-geometry" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' "ths-0658675194|sandbox\\.f2e\\.legacy-remote|/indices|Market summary|Index collections|layout-geometry" . -S`

Independent agent feedback:

- No independent subagent was launched for this narrow continuation. Existing records from 2026-07-02 already contain independent-agent findings for VisualEvidenceBundle authority and annotated Visual QA repair consumption; this repair builds on those records without adding another worktree or recursive delegation.

## Root Cause

The existing layout geometry tool captures page overflow and per-region box / margin / padding / edge metrics. It does not produce a first-class cross-region alignment summary such as "market summary left edge and index collections left edge are on different rails." For a page-level drift like the attached screenshot, Visual QA must infer the relationship manually.

The second break is transport. When Visual QA cites `layout-geometry` evidence in a blocker, Build currently receives only text refs in the Visual QA feedback. Build Evidence Pack can dispatch target references, previous output, comparison artifacts, and annotated Visual QA screenshots, but it has no role for Visual QA diagnostic manifests. A later Build can therefore claim it repaired the page without reading the geometry manifest that showed the rail drift.

This is not a reason to give Build direct access to the Visual QA geometry tool. The correct boundary is:

- Visual QA owns calling `browser_preview_layout_geometry`.
- Host stores and transports the resulting manifest as diagnostic evidence.
- Build consumes the manifest and the annotated screenshots during repair.
- Formal reference acceptance still comes from task-scoped `VisualEvidenceBundle` / `reference-comparison` evidence.

## Repair Plan

1. Extend `browser_preview_layout_geometry` with optional `alignmentGroups` that summarize shared-edge / width / center alignment across named regions in the same viewport sample.
2. Keep the tool status tied to capture success; alignment groups are diagnostic metrics, not a host pass/fail gate.
3. Extend Build Evidence Pack with a `visual_qa_diagnostic` role for Visual QA-produced diagnostic artifacts such as `layout-geometry` manifests.
4. Resolve latest failed Visual QA report evidence refs that point at readable `browser_preview_evidence` with `operationKind="layout-geometry"` and dispatch their manifest files to Build.
5. Generalize Build consumed evidence reporting so passed reports must list dispatched Visual QA diagnostic refs as well as annotated screenshot refs.
6. Render production blocker evidence refs, geometry diagnostics, annotated screenshots, and consumption obligations in the Build prompt.
7. Add regression tests for:
   - alignment group metric generation;
   - layout-geometry manifest transport from Visual QA report to Build Evidence Pack;
   - passed Build rejection when dispatched diagnostic refs were not consumed;
   - prompt wording that Build consumes Visual QA diagnostics without treating them as target references.

## Validation Plan

- `bun test packages/opencorvus/test/browser-preview/layout-geometry-diagnostic.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/build-agent/types.test.ts packages/opencorvus/test/build-agent/contract-error.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/orchestrator/build-feedback-context.test.ts packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
- Real browser screenshot review of the supplied sandbox page or an equivalent local preview target, using Node/Playwright rather than Bun Playwright.

## Validation Results

- The supplied sandbox URL `https://ths-0658675194-9999-sandbox.f2e.myhexin.com/indices` returned `net::ERR_CONNECTION_CLOSED` in the in-app browser and standalone Chromium.
- `curl -k` and plain HTTP GET could retrieve the same current HTML/CSS/JS resources from the sandbox host, while Chromium direct HTTP navigation received an empty `502 Bad Gateway` response. This is browser/gateway behavior, not a valid visual screenshot.
- A temporary localhost diagnostic proxy served the current sandbox HTML/CSS/JS resources to Node/Playwright at `2048x1052` and produced `.scratch/layout-geometry-sandbox-proxy-full.png`.
- Manual screenshot review confirmed the page is still visually misaligned: `Market summary` section left edge is `x=40`, while the actual lower `Index collections` and `Ideas` sections start at `x=344`, a `304px` rail drift.
- Additional heading/section enumeration confirmed `News` is also on the shifted downstream rail: its section starts at `x=344` and its heading text is internally padded to `x=384`. This enumeration is useful as a discovery audit, but it is not the submitted acceptance algorithm because it also sees top tabs and footer headings and can miss sections when display text varies.
- The durable check must define explicit task-scoped regions for the shared content rail, for example `market-summary`, `index-collections`, `ideas`, `top-stories`, `news`, and `faq`, then pass those region ids in one `alignmentGroups` left-edge group.
- This validation does not claim the sandbox page is fixed. It confirms the failure mode that the repaired geometry path must expose and forward to Build.
