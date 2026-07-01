# Frontend Replica Blank Filler Geometry Repair

Date: 2026-07-01

## Recall

User request:

- Investigate why a TradingView forex page replica screenshot contains large
  blank bands.
- Identify where the workflow said to fill blank page height.
- Explain how to solve it.

Acceptance criteria:

- The frontend-replica expert squad must not turn source page height, region y
  coordinates, footer transition position, or full-page screenshot height into
  permission to add blank spacer, margin, padding, or `min-height` filler.
- Build must restore missing source-backed content/assets or report the exact
  blocker; it must not align footer/page boundaries by empty CSS.
- Visual QA must block blank filler bands between completed regions and return
  DOM/source-module repair facts.
- Frontend Design must phrase geometry as evidence for real visible source
  content, not as a skeleton height target.
- Per the operator correction during implementation, do not edit prompts outside
  the expert-squad prompt surface. The allowed prompt surfaces are
  `frontend-replica-expert-squad.md` and the `frontend-replica` built-in prompt
  profile overlays.
- Add focused tests for the expert-squad prompt contracts and update this
  monthly record index.

Hard constraints:

- No fallback, no compatibility path, no keyword-matching host gate, and no
  deterministic CSS blacklist pretending to solve visual quality.
- No broad git reset and no destructive worktree operations.
- Do not touch unrelated dirty worktree content.
- Do not restart, kill, refresh, or otherwise interfere with running
  OpenCorvus / overlay processes.
- Every code or prompt change needs focused tests.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
- `specs/records/2026-06/2026-06-30-browser-preview-viewport-slice-binding.md`
- `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/prompt/core/frontend-design-core.txt`
- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/acceptance/visual-evidence.ts`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts`
- `packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts`
- `packages/opencorvus/test/frontend-design/prompt.test.ts`

Whole-repository search evidence:

- `rg -n "fake spacers|min-height filler|footer y|y≈|footer transition|page geometry|visual-evidence-bundle|scroll slices|compare_scroll_slices|full-page|placeholder regions|source order|spacing rhythm" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "空白|留白|填充|补齐|凑|height|min-height|spacer|placeholder|full[- ]?page|scroll|vertical|rhythm|spacing|blank|gap|footer|idea|thumbnail|canvas" packages/opencorvus/src/prompt packages/opencorvus/test/frontend-design`
- `rg -n "填充|空白|留白|spacer|blank|filler|placeholder|footer transition|y≈5222|5158|full-page|page geometry" <task-runtime frontend-design artifacts>`

Independent agent feedback:

- None spawned. This is a focused prompt-contract repair with direct artifact,
  prompt, test, and runtime evidence; no user-requested independent audit was
  needed.

## Failure Chain

The source request and active requirement rows asked for desktop reference
parity, source-backed assets, component slices, and full-page visual evidence.
They did not ask for blank space.

The direct implementation defect in the forex replica was:

- FAQ/footer transition was adjusted with a large CSS bottom margin.
- Ideas cards reserved a thumbnail-height slot with top padding but did not
  render the source-backed thumbnails/canvas captures.

The upstream ambiguity was not a positive "fill blank space" rule. It was the
combination of geometry wording such as footer transition y coordinates,
full-page height, and page geometry with incomplete content restoration. The
agent treated a reference y coordinate as a target CSS height instead of using
it to locate real source-backed visible content.

The existing frontend_design prompt already forbids fake spacers and
`min-height` filler, but Build and Visual QA did not explicitly say that source
geometry cannot be satisfied by blank vertical filler. Visual evidence bundle
validation is intentionally not the right place to add a CSS keyword gate: it
checks durable evidence shape and reference-comparison identity, while the
visual judgment must remain source-backed and screenshot-based.

## Repair Plan

The operator interrupted the initial plan and clarified: do not edit prompts
outside the expert squad. Therefore the repair is confined to the
frontend-replica expert-squad skill and built-in profile overlays.

1. Update frontend-replica Build overlay:
   - Source y coordinates, full-page height, and footer transition positions
     are diagnostic facts for locating visible content.
   - They cannot be satisfied with blank spacer, margin, padding, or
     `min-height` filler.
   - If content is missing, restore the source-backed content/assets or report
     the blocker.
2. Update frontend-replica Visual QA overlay:
   - Blank filler bands inserted to align source geometry are production
     blockers for clone/parity tasks.
   - Visual QA must tie them to the owning DOM/source module and require real
     content restoration or removal of the fabricated spacing.
3. Update frontend-replica Frontend Design overlay:
   - Page/region geometry in the visual skeleton is evidence for visible source
     content and region boundaries, not a license to create empty canvas height.
4. Update `frontend-replica-expert-squad.md` with the same squad-level rule so
   Orchestrator chooses the correct expert profile with the incident boundary
   visible before downstream dispatch.
5. Update focused expert-squad prompt tests.
6. Update the July record index and run docs health/link verification.

## Implementation Notes

- Added a `Blank filler geometry boundary` section to the
  `frontend-replica-expert-squad` skill.
- Updated only the `frontend-replica` built-in prompt profile overlays for
  Requirements, Architect, Frontend Design, Build, Visual QA, Integrity, and
  Orchestrator.
- Did not modify `packages/opencorvus/src/prompt/core/*.txt` after the operator
  clarified that prompt edits outside expert-squad surfaces are forbidden.
- Kept the repair semantic and evidence-driven: source geometry must point to
  visible source regions/content/assets; it must not be converted into blank
  CSS spacing.

## Validation Results

- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 60000`
