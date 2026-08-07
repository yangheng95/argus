# Rendered Reference Acceptance Redesign

Date: 2026-07-03

## Recall

User request:

- Redesign the acceptance scheme from scratch.
- The acceptance must use absolute rendered-vs-reference comparison, not the
  deprecated or restored `VisualEvidenceBundle` authority.
- The full chain must be smooth, including task context and image assets.
- User clarification: the intended product model is one webpage-resource
  capture, Build writes the webpage from those captured resources, and final
  acceptance has no authority relationship to webpage resources. Final
  acceptance is only from visual feedback on the current rendered result.

Acceptance criteria:

- There is one formal final acceptance source: latest task-scoped visual
  feedback verification for the current rendered result.
- Passing current rendered visual feedback verification is sufficient for
  visual acceptance. A first failed verification routes concrete visual feedback
  back to Build repair; a second consecutive failed verification on the same
  task is terminal evidence for `fail_task`, not an Integrity-owned visual
  re-judgement or another blind Build loop.
- Webpage resources are captured once and used only as Build input; source
  package completeness, source manifests, CSS/DOM extraction, and asset reuse
  are not final acceptance criteria.
- Reference-page tasks pass only from current visual feedback evidence:
  rendered screenshots, visual comparison artifacts when present, Visual QA
  annotations, and the task/run-scoped visual-feedback verification artifact
  summarizing them.
- Build, Visual QA, metrics / acceptance, Orchestrator, and UI projections all
  consume the same visual feedback ids and context ids. Integrity may read only
  a sanitized Visual QA implementation-defect context, not Visual QA's visual
  verdict, reference-comparison authority, or VisualFeedbackVerification
  pointer.
- Captured source assets, rendered screenshots, side-by-side images, diffs, and
  Visual QA annotations are durable, task-scoped, path-readable, hash-checked,
  and visible to the agents that need them, but only post-build visual feedback
  can drive final acceptance.
- No fallback, compatibility branch, host gate, fake pass, hidden message path,
  or stale artifact acceptance.

Hard constraints:

- `VisualEvidenceBundle` must not be the acceptance authority.
- Do not preserve old Bundle authority as a compatibility route.
- Do not make `webpage-evidence`, `web-clone-source`, source manifests,
  DOM/CSS/source asset inventories, or Build's resource-consumption self-report
  a final acceptance authority.
- Do not let Visual QA prose, raw screenshots, source-binding screenshots,
  scroll-slice support images, typecheck/build success, or Integrity summaries
  satisfy formal visual acceptance by themselves.
- Do not let Integrity validate, replace, or re-judge final visual acceptance.
  Integrity owns implementation completeness / correctness review; Visual QA
  and visual-feedback verification own the rendered visual verdict.
- Do not re-run resource capture as a repair convenience when the issue is
  post-build visual feedback; reuse the one captured resource handoff and send
  concrete visual feedback back to Build.
- Desktop-only replica scope remains desktop-only unless the task explicitly
  asks for tablet/mobile/multi-end migration.
- Specs stay under `specs/`; implementation changes must have focused tests.
- Existing dirty worktree changes are not reverted or overwritten.

Sources read:

- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-visual-evidence-bundle-producer.md`
- `specs/records/2026-07/2026-07-02-visual-evidence-bundle-authority-repair.md`
- `specs/records/2026-07/2026-07-03-screenshot-comparison-guidance.md`
- `packages/opencorvus/src/acceptance/types.ts`
- `packages/opencorvus/src/acceptance/visual-evidence.ts`
- `packages/opencorvus/src/acceptance/visual-evidence-materializer.ts`
- `packages/opencorvus/src/browser-preview/comparison-guidance.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/prompt/core/architect-core.txt`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `packages/opencorvus/src/integrity/acceptance-tools.ts`
- `packages/opencorvus/src/integrity/team-agent.ts`

Whole-repository search evidence:

- `rg -n "VisualEvidenceBundle|visual_evidence_bundle|inspect_visual_evidence|reference_comparison|requiredReferenceRegions|authoritative-rendered-reference-visual|absolute compare|absolute comparison|SSIM|ssim" specs packages AGENTS.md`
- `rg -n "VisualEvidenceBundle.*废弃|废弃.*VisualEvidenceBundle|deprecated.*VisualEvidenceBundle|retire.*VisualEvidenceBundle|absolute.*视觉|绝对.*比|绝对比|absolute.*comparison|direct.*comparison" specs packages AGENTS.md -S`
- `rg -n "materializeVisualEvidenceBundle|renderVisualEvidenceBundleMaterializationSummary|collectVisualEvidenceMaterializationRefs|visual_evidence_bundle_materialization|inspect_visual_evidence|readLatestTaskVisualEvidenceBundleSync|validateVisualEvidenceBundleReferenceComparisons|authoritative-rendered-reference-visual|reference_comparison_evidence" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/visual-qa/output-tools.ts packages/opencorvus/src/integrity -S -C 4`
- `rg -n "screenshot-stitch|ScreenshotStitch|stitch|reference-comparison|compareScroll|compareBrowserPreview|browser_preview_compare|visual-evidence-bundle|VisualEvidenceBundle|register_visual_evidence_acceptance|contract_audit|llm_judge" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 specs/current -S`
- `rg -n "asset_manifest|asset manifest|image asset|source asset|reference_artifacts|reference_artifact|web-clone-source|source_image|rendered_screenshot|side-by-side|side_by_side|diff PNG|diff_png|sha256|hash mismatch|blank crop" packages/opencorvus/src packages/opencorvus/test specs -S`
- `rg -n "BuildInputEvidence|input evidence|evidence manifest|build evidence|latest_visual_evidence_bundle|referenceParityRequired|requiredReferenceRegions|visualQaReference|reference_parity|ResourceHandoffContext|VisualFeedbackContext|acceptance_spec_id" packages/opencorvus/src packages/opencorvus/test specs -S`
- `rg -n "visual_evidence_bundle|VisualEvidenceBundle|reference_comparison|reference-comparison|browser_preview_evidence|visual_qa|visual QA|integrity|acceptance" packages/overlay packages/web packages/sdk packages/opencorvus/src/server packages/opencorvus/src/metrics packages/opencorvus/test/metrics -S`
- `rg -n "prebuilt.*visual|visual-evidence-bundle|rendered-reference|visual_evidence|browser_preview_evidence|reference-comparison|reference_comparison" packages/opencorvus/src/metrics packages/opencorvus/test/metrics packages/opencorvus/src/acceptance packages/opencorvus/test/acceptance packages/opencorvus/src/architect packages/opencorvus/test/architect -S`
- `rg -n "composeLatestVisualQaFeedbackForBuild|composeLatestAcceptanceFeedbackForBuild|renderIntegrityFeedback|visualQaFeedback|acceptanceFeedback|BuildInputEvidenceManifest|comparisonArtifacts|targetReferences|latestBrowserPreviewEvidenceIDs|findLatestAcceptanceEvidence|persistEvidence" packages/opencorvus/src packages/opencorvus/test -S`

Independent agent feedback:

- Read-only explorer `Copernicus` independently confirmed that Bundle residue
  remains a production closed loop: acceptance schema and generated SDKs expose
  the old scorer, Architect still emits it, Visual QA derives parity from it,
  Orchestrator materializes and validates it, Integrity blocks on it, Metrics
  scores it, and tests enforce it.
- `Copernicus` also separated active root-cause surfaces from historical docs:
  June records and earlier July Bundle repair records explain drift, but they
  are not current blockers unless active prompts, schema, routes, generated SDKs,
  evaluators, or workflow consumers still point to the old contract.
- The impact expansion launched two additional read-only explorer lanes for
  the positive visual-feedback / asset chain and the API / SDK / UI / metrics
  perimeter. They were instructed not to edit files, restart OpenCorvus /
  overlay processes, or delegate child agents. This record keeps local grep
  evidence as the reproducible trace and incorporates returned independent
  findings when they arrive.

## Current Conflict

The current repository does not treat `VisualEvidenceBundle` as deleted. It is
still a production acceptance authority:

- Architect prompt still tells agents to use
  `register_visual_evidence_acceptance` and a prebuilt
  `visual-evidence-bundle` scorer for final visual parity.
- Visual QA prompt still says scroll-slice comparison is only supporting
  evidence and cannot replace a scoped `VisualEvidenceBundle`.
- Orchestrator still materializes `VisualEvidenceBundle` after Visual QA and
  uses materialization / validation failure to make `effective_accepted=false`.
- Integrity prompt and tools still require `inspect_visual_evidence` before
  passing reference visual fidelity.
- Tests still assert missing Bundle behavior.

History confirms that a screenshot-stitch direction existed in commit
`66162f20d6 refactor: replace visual comparison with screenshot stitch`, but
that commit is not an ancestor of current `HEAD`. Later commits, including
`ea7ee6a236 fix(opencorvus): materialize visual evidence bundles`, restored the
Bundle path. Therefore the blocker is not a single stale phrase; it is a
reintroduced acceptance contract.

## History Trace

The cleanup was not merged into the current delivery line.

- `git merge-base --is-ancestor 66162f20d6 HEAD` returned exit code `1`.
  `git branch --all --contains 66162f20d6` only showed
  `origin/codex/light-screenshot-stitch-20260621`.
- `git show --stat 66162f20d6` shows the abandoned cleanup deleted
  `packages/opencorvus/src/acceptance/visual-evidence.ts`,
  `browser-preview/region-comparison.ts`, scroll-slice comparison, local module
  source binding, related tools, tests, and SDK/OpenAPI Bundle surfaces while
  adding `browser-preview/screenshot-stitch.ts`.
- Current `HEAD` still contains the earlier Bundle introduction:
  `21a6905730 feat(acceptance): thread visual evidence bundles through review`
  is on the current ancestry and added the Bundle schema, Architect scorer,
  Integrity inspection, Metrics evaluator, Orchestrator threading, and tests.
- `935b512fad fix: make visual evidence advisory` changed some visual evidence
  behavior from hard failure to advisory, but it did not remove the active
  schema / scorer / tool / SDK contract.
- `ea7ee6a236 fix(opencorvus): materialize visual evidence bundles` is on the
  current ancestry and added
  `packages/opencorvus/src/acceptance/visual-evidence-materializer.ts`,
  materializer tests, Orchestrator wiring, and the July producer record.

Therefore this is not "deleted but not thoroughly cleaned" on current `HEAD`.
The accurate history is: Bundle was introduced on the active line, a separate
branch deleted/replaced it with screenshot stitch, that branch was not merged,
and the active line later doubled down by materializing Bundle from
browser-preview evidence.

## Corrected Pipeline Model

The acceptance chain has two separate one-way flows. Mixing them is the root of
Build receiving useless feedback and making random edits.

```text
one-shot resource capture -> Build implementation input
post-build rendered visual feedback -> Build repair input and final acceptance
```

### Resource Handoff Chain

This chain exists to give Build useful material:

1. Host captures webpage resources once for the task.
2. The resource handoff includes source screenshots, DOM / CSS / source IR,
   content model, interaction hints, source assets, and image assets.
3. Orchestrator builds a typed `ResourceHandoffContext` and a
   `BuildInputEvidenceManifest` from that handoff.
4. Build uses those resources to implement the page and records which resource
   refs it consumed.

This chain can fail a Build dispatch when required input is missing or
unreadable. It cannot pass or fail final task acceptance after a rendered
implementation exists.

### Visual Feedback Chain

This chain controls repair and final acceptance:

1. Browser Preview captures the current rendered implementation from the task
   preview target.
2. Visual QA inspects visible output and writes structured visual feedback:
   current screenshots, comparison images when useful, annotated problem
   screenshots, layout/geometry diagnostics, selectors, bounding boxes, and
   concrete required corrections.
3. Orchestrator builds a typed `VisualFeedbackContext` from the latest visual
   feedback and forwards it to Build as separated evidence roles:
   `previous_output`, `comparison_artifact`, `visual_qa_annotation`, and
   `visual_qa_diagnostic`.
4. Build must consume these feedback artifacts and report the exact refs it
   used before claiming `status="passed"`.
5. Visual QA / visual-feedback verification produces the final visual
   acceptance verdict for the current rendered result. Metrics / acceptance
   consume that verification artifact. Integrity does not re-judge it; it only
   audits whether the implementation is complete and correct against the task
   contract.

The reference screenshot or target visual image can be a visual target input,
but final acceptance treats it as a visual comparison image, not as authority to
re-open the webpage resource package. DOM, CSS, asset manifests, and
`web-clone-source` stay on the Build-input side of the boundary.

## Current Chain Breakage

The current code has useful pieces, but they do not form the intended loop:

- `packages/opencorvus/src/build/evidence-pack.ts` defines the right roles:
  `target_reference`, `previous_output`, `comparison_artifact`,
  `visual_qa_annotation`, and `visual_qa_diagnostic`.
- `packages/opencorvus/src/orchestrator/tools.ts` currently composes target
  references, previous rendered output, Visual QA annotations, and
  layout-geometry diagnostics, but `composeBuildEvidencePack()` does not fill
  `comparisonArtifacts`. Build can therefore miss the actual visual
  side-by-side / diff artifacts it needs for repair.
- `visualQaDiagnosticEvidenceForBuild()` only forwards `layout-geometry`
  browser-preview evidence. It ignores `reference-comparison` and
  `preview-capture` visual artifacts even when Visual QA cited them.
- `composeLatestVisualQaFeedbackForBuild()` renders text and DOM-region facts,
  but the repair loop only works when the corresponding images are also
  attached in the separated evidence roles.
- `latestBrowserPreviewEvidenceIDs()` indexes only `preview-capture`, not the
  full latest visual feedback set.
- `persistBrowserPreviewEvidence()` writes `run_id`, `goal_run_id`, and
  `acceptance_id` as `null`, so current visual feedback cannot yet prove it
  belongs to the active run / goal / acceptance.

The repair is not to ask Build to be more careful in prose. The repair is to
make Orchestrator pass Build a typed `VisualFeedbackContext` plus the concrete
image artifacts that correspond to that context.

## Expanded Impact Surface

This redesign must cover every active producer, consumer, schema, generated
client, and display projection that can still make a task pass, fail, or appear
blocked for the old reason. Historical records are evidence of how the contract
drifted, not current pass/fail authority by themselves.

| Surface | Current evidence | Required change |
| --- | --- | --- |
| Acceptance schema | `packages/opencorvus/src/acceptance/types.ts` still includes `visual-evidence-bundle` in `PREBUILT_SCORER_NAMES`, `visual_evidence_bundle` spec kind, and `visual_evidence` judge input. | Replace the active visual scorer/input contract with visual-feedback verification evidence. Do not leave Bundle or resource-manifest validation as alternate final acceptance scorers. |
| Generated SDK / OpenAPI | `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/types.gen.ts`, and `packages/sdk/js/src/gen/sdk.gen.ts` expose `visual-evidence-bundle`, `visual_evidence_bundle`, and `visual_evidence`. | Regenerate after schema changes; stale generated clients would keep accepting or advertising the removed authority. |
| Architect tools and prompts | `packages/opencorvus/src/architect/output-tools.ts` and `packages/opencorvus/src/prompt/core/architect-core.txt` still describe `visual-evidence-bundle`, `register_visual_evidence_acceptance`, and `llm_judge:visual_evidence`; tests assert those strings. | Rename or replace the helper so Architect registers a final visual-feedback acceptance contract, not a webpage-resource or Bundle contract. |
| Browser Preview evidence | `packages/opencorvus/src/browser-preview/persist.ts` persists `reference-comparison` rows and requires passed rows to have `cropIntent` plus required artifact paths. `packages/opencorvus/src/browser-preview/region-comparison.ts` writes side-by-side artifacts. | Reuse this as visual feedback evidence, but add current run / goal / acceptance ids and feedback-set projection. Do not make source package readability part of final acceptance. |
| Supporting comparison tools | `packages/opencorvus/src/browser-preview/scroll-slice-comparison.ts` and `packages/opencorvus/src/tool/browser-preview-compare-scroll-slices.ts` explicitly say scroll slices are supporting `visual_diff` evidence, not reference-comparison proof. | Keep scroll-slice output diagnostic-only. It must not satisfy formal visual-feedback acceptance by itself. |
| Build context and input evidence | `packages/opencorvus/src/build/evidence-pack.ts` already separates target references, previous output, comparison artifacts, Visual QA annotations, and Visual QA diagnostics. `packages/opencorvus/src/orchestrator/tools.ts` composes those roles, but current feedback is partial and resource/acceptance semantics are blurred. | Make `ResourceHandoffContext` and `VisualFeedbackContext` explicit. Build receives source resources once, then receives post-build visual feedback artifacts for repair. Build must consume typed ids, not prose paths or stale local filenames. |
| Frontend design source package | `packages/opencorvus/src/frontend-design/host-prepared-source-project.ts`, `packages/opencorvus/src/frontend-design/output-tools.ts`, and architecture records treat `web-clone-source/*` and `reference.png` as source evidence. | Preserve source evidence as Build input only. Its existence or manifest health cannot be the final visual acceptance source. |
| Visual QA report semantics | `packages/opencorvus/src/visual-qa/schema.ts`, `packages/opencorvus/src/visual-qa/output-tools.ts`, `packages/opencorvus/src/visual-qa/acceptance-semantics.ts`, and tests still center `reference_parity.reference_comparison_evidence_refs`. | Visual QA must produce actionable visual feedback evidence. Its `accepted=true` must be backed by current rendered screenshots / comparison or annotation evidence, but acceptance must not inspect webpage resource manifests. |
| Integrity tools and prompt | `packages/opencorvus/src/integrity/acceptance-tools.ts`, `packages/opencorvus/src/integrity/team-agent.ts`, and `packages/opencorvus/src/prompt/core/integrity-team-core.txt` still route through visual evidence inspection. | Remove final visual-verdict inspection from Integrity. Integrity may inspect only sanitized Visual QA implementation-defect context, but it must not expose `inspect_visual_feedback_evidence`, validate `VisualFeedbackVerification`, read visual verdict fields, or pass/fail visual acceptance. |
| Orchestrator workflow | `packages/opencorvus/src/orchestrator/tools.ts` imports Bundle materialization, passes `latest_visual_evidence_bundle`, appends `visual_evidence_bundle_*` decision-log rows, and derives Visual QA reference parity from Bundle state. | Orchestrator must build `ResourceHandoffContext` before Build and `VisualFeedbackContext` after Build. Final lifecycle consumes latest visual-feedback verification for visual acceptance plus Integrity review for implementation correctness, not resource capture state. |
| Metrics / benchmark evaluator | `packages/opencorvus/src/metrics/executor.ts` imports Bundle schema, feeds judges `visual_evidence`, and only implements prebuilt `name="visual-evidence-bundle"`. | Add a deterministic visual-feedback evaluator and update judge inputs. Otherwise benchmark acceptance keeps failing on the retired input. |
| Overlay / UI projection | Targeted search did not find direct Bundle strings in overlay, but overlay projects `acceptance.ready`, `acceptance.evidence.updated`, and Integrity cards. | UI must surface the new verification-evidence and comparison artifact attachments; it must not display stale Bundle materialization as the visual blocker. |
| Historical specs / docs | July records still document Bundle authority repair, while this record supersedes it. | Do not rewrite history as if it never happened. Update current architecture and README pointers when implementation lands so active docs have one source. |
| Runtime artifacts / database rows | Existing tasks may have old `visual-evidence-bundle.json`, `visual_evidence_bundle_*` decision logs, resource manifests, and Visual QA self-reported refs. | New acceptance must ignore old Bundle artifacts and source-resource state as authority. It requires current visual feedback evidence for the rendered implementation. |

## New Acceptance Authority

Formal visual acceptance for reference-driven UI work is:

```text
Latest task/run-scoped visual feedback evidence for the current rendered result
plus one visual-feedback verification-evidence artifact that summarizes the
visual feedback set and pass/fail reasons.
```

The rendered visual feedback artifacts are the image truth. The
verification-evidence row is the decision projection. Webpage resources are
Build input; they do not own final lifecycle authority. Visual QA owns the
rendered visual verdict through visual-feedback verification. Integrity reports
are implementation review evidence only; Orchestrator still owns
`complete_task` / `fail_task`.

The lifecycle response to failed rendered visual feedback is bounded by the
verification attempts, not by Integrity. One failed visual-feedback
verification sends the comparison / annotation / diagnostic evidence back to
Build repair. Two consecutive failed visual-feedback verifications for the same
task mean the rendered target was not achieved; Orchestrator must fail the task
with the concrete visual blockers instead of sending the visual verdict to
Integrity or continuing a blind repair loop. This policy is prompt-oriented:
tool results expose the current verification status and consecutive failed
attempt count, while Orchestrator chooses `build` or `fail_task` from those
facts.

`VisualEvidenceBundle` is removed from the authority path. It can only be
deleted or, while removal is in progress, treated as historical dead code. It
must not appear in prompts, active scorers, pass blockers, UI acceptance badges,
or Integrity tools. `VisualFeedbackVerification` must likewise not become an
Integrity-owned verdict; it belongs to Visual QA / acceptance.

## Required Artifact Contract

Each formal visual feedback set must include persisted artifacts for the current
rendered implementation:

- `task_id`, `run_id`, `target_id`, `goal_id` when scoped to a goal, and
  `acceptance_spec_id` when produced for final visual acceptance.
- Current rendered screenshot path, sha256, width, height, viewport id, state id,
  and preview target id.
- Optional `browser_preview_evidence(operationKind="reference-comparison")`
  rows when a visual target image is available and region comparison is useful.
  These rows store source/target crop, rendered implementation crop,
  side-by-side PNG, optional diff PNG, and `comparison_guidance`.
- Visual QA annotation images and diagnostic artifacts for failed feedback,
  including selectors, bounding boxes, code-search terms, problem region ids,
  and required corrections.
- Machine diagnostics for rendered evidence: crop health, content nonblank
  metrics, console/page-error summary, path readability, hash verification, and
  current preview-target binding.
- A human-readable failure reason when the feedback status is failed.

The visual-feedback verification artifact must include:

- The exact visual feedback artifact ids used for the verdict.
- Missing rendered evidence ids.
- Failed visual feedback ids and reasons.
- Visual artifact readability/currentness results.
- The final verdict for the visual acceptance spec.

## Context Chain

The task context must keep resource handoff and visual feedback separate.

`ResourceHandoffContext` is passed to Build before implementation:

- `taskID`, `runID`, `projectID`, `projectRoot`, `activeSpecVersionID`,
  `activePlanVersionID`.
- Original user request and normalized desktop-only scope.
- One-shot webpage capture ids and resource root.
- Source screenshot, DOM/style evidence, interaction evidence, and image asset
  manifest ids.
- Build input evidence manifest id and attachment refs.

`VisualFeedbackContext` is passed to Build repair, Visual QA, metrics /
acceptance, and UI projection after implementation:

- `taskID`, `runID`, `projectID`, `projectRoot`, active goal ids, and current
  preview target id.
- Current rendered output screenshot ids.
- Latest visual comparison / annotation / diagnostic ids.
- Failed visual feedback reasons, selectors, bounding boxes, and concrete
  required corrections.
- Previous rendered output ids when useful for delta repair.

Agents must not reconstruct this context from prose, titles, or file names. The
Orchestrator builds both contexts from task artifacts and passes the appropriate
one into Build, Visual QA, metrics / acceptance, and UI projection. Integrity
receives only the implementation review context it needs, plus sanitized Visual
QA implementation-defect summaries when relevant.

## Image Asset Chain

Image assets must be task-scoped and addressable by artifact id, but there are
two different meanings:

### Build Input Assets

1. Frontend research/design captures source reference screenshots and image
   assets into the task runtime directory.
2. Each image asset has `asset_id`, original URL when known, local path, sha256,
   media type, dimensions, and owning source region ids.
3. Build receives the asset manifest through its input evidence manifest. It
   may reuse only manifest assets or deliberately produce code-native
   replacements recorded in the implementation notes.

Build input asset failures are Build-input failures. They do not become final
acceptance failures after a current rendered visual feedback set exists.

### Visual Feedback Assets

1. Browser Preview captures rendered screenshots from the current task preview
   target, not from arbitrary localhost URLs.
2. Visual feedback artifacts store current rendered screenshots, annotations,
   side-by-side/diff images when present, and diagnostic manifests.
3. Tool results include image attachments so agents can inspect them in the UI.
4. Verification fails if a visual feedback image path is missing, unreadable,
   mismatched by hash, blank, or not tied to the current task/run/target.

No agent should pass a visual acceptance based on a screenshot path string that
has not been resolved and read by the artifact service.

## Stage Responsibilities

### Architect

- Registers final visual-feedback acceptance on the integration/verification
  goal.
- Does not register `visual-evidence-bundle`.
- Uses a new prebuilt scorer name such as `visual-feedback-verification` or a
  contract audit that points to the visual feedback artifact contract.
- Does not register webpage resource-package completeness as final acceptance.

### Build

- Consumes `ResourceHandoffContext` and source asset manifest for the initial
  implementation.
- On repair, consumes `VisualFeedbackContext`: previous rendered output,
  comparison artifacts, Visual QA annotations, diagnostics, selectors, and
  required corrections.
- Reports changed files, resource usage, visual feedback refs consumed, and the
  current rendered output / comparison ids it rechecked.
- Cannot satisfy acceptance by docs, typecheck, or Visual QA prose.

### Browser Preview / Evidence Producer

- Owns current rendered screenshot capture and optional visual target
  comparison capture.
- Produces `browser_preview_evidence` rows for preview capture,
  `reference-comparison`, layout geometry, and other visual diagnostics.
- Exposes agent-facing tools for inspection, but formal comparison generation
  may stay host-owned if needed for isolation.

### Visual QA

- Inspects the current rendered UI states and visual feedback artifacts.
- `accepted=true` is valid only when current rendered evidence is readable,
  task/run/target current, and the visual feedback contains no blocking visual
  defects or is explicitly accompanied by an accepted product-scope variance
  from the original task.
- Source-binding, layout geometry, scroll slices, screenshots, and annotations
  remain useful diagnostics; webpage resource manifests do not participate in
  final acceptance.

### Integrity

- Does not own visual acceptance and must not expose a final visual-verdict
  inspection tool.
- May read sanitized Visual QA implementation-defect context to identify code,
  data, interaction, routing, component, or maintainability defects that Visual
  QA surfaced.
- This context excludes Visual QA report summary, final verdict fields,
  reference-comparison authority, and visual-feedback-verification pointers. It
  keeps implementation localization fields such as changed files, unresolved
  code module problems, DOM locators, bounding boxes, computed styles, and
  code-search terms.
- May reject for implementation incompleteness, contract mismatch, broken
  routing, missing required files, data/interaction defects, or contradictions
  with the original request.
- Must not reject final visual acceptance because `webpage-evidence`,
  `web-clone-source`, or source asset manifests are missing after Build has a
  current rendered visual feedback set.
- Must not call `inspect_visual_evidence` or block/pass on Bundle state.
- Must not validate `VisualFeedbackVerification`, require visual comparison
  refs, or turn Visual QA's verdict into a second Integrity-owned visual gate.

### Orchestrator

- Builds the typed resource handoff before Build and the typed visual feedback
  context after Build.
- Runs or requests browser preview / Visual QA after Build to produce current
  visual feedback.
- Persists one task/run-scoped `verification-evidence` row from the visual
  feedback set with `label="visual-feedback-verification"` and
  `scope="visual_feedback"`.
- Final lifecycle decisions consume that verification-evidence row for visual
  acceptance and Integrity consensus for implementation correctness, not stale
  Visual QA prose or Bundle materialization.
- Does not re-run webpage resource capture to paper over broken visual feedback;
  it sends concrete visual feedback back to Build.

## Migration Plan

1. Add `visual-feedback-verification` to acceptance scorer types and remove
   `visual-evidence-bundle` from active prompt guidance.
2. Add canonical visual-feedback-set reader/writer under the browser preview or
   verification evidence layer.
3. Remove final visual-verdict inspection from Integrity tools and prompt.
   Integrity keeps implementation evidence tools and sanitized Visual QA
   implementation-defect context only.
4. Remove Orchestrator post-Visual-QA Bundle materialization and validation.
5. Update Visual QA output semantics to require current rendered visual
   feedback evidence, not webpage resource evidence, for final acceptance.
6. Update Architect prompt/tool output to register visual-feedback acceptance
   instead of Bundle or webpage-resource acceptance.
7. Delete or retire `acceptance/visual-evidence.ts` and
   `acceptance/visual-evidence-materializer.ts` once all imports are removed.
8. Update SDK/OpenAPI snapshots after schema changes.
9. Update docs and monthly records that currently claim Bundle is the formal
   authority.
10. Split Orchestrator context rendering into explicit `ResourceHandoffContext`
    and `VisualFeedbackContext` so Build receives the right feedback for the
    right phase.

## Implementation Slices

The implementation should be sliced by ownership, not by string replacement:

1. Schema / SDK slice: acceptance scorer types, generated OpenAPI / SDK, and
   Architect-visible tool schema.
2. Evidence slice: visual-feedback-set reader/writer, verification-evidence
   summary, rendered screenshot readability/hash/currentness checks.
3. Workflow slice: Orchestrator resource/feedback context split, Visual QA
   invocation, visual-feedback verification production, metrics / acceptance
   consumption, Integrity implementation review, lifecycle projection, and
   decision-log removal.
4. Agent prompt slice: Architect, Build, Visual QA, Integrity, and relevant
   tests that currently assert Bundle wording or self-reported parity refs.
5. Benchmark / UI slice: metrics executor, benchmark fixtures, overlay
   projection for new evidence attachments, and docs.

Each slice must remove the old active path in the same change that introduces
the new one. A temporary parallel Bundle path would recreate the exact
dual-source failure this plan is meant to eliminate.

## Test Plan

Focused tests must cover:

- Architect emits `visual-feedback-verification`, not
  `visual-evidence-bundle`.
- Visual QA `accepted=true` becomes ineffective when current rendered visual
  feedback rows are missing, unreadable, stale, failed, or attached to another
  task/run/preview target.
- Visual QA accepts when current rendered visual feedback rows are readable,
  current, and contain no blocking visual defects.
- Integrity does not expose or consume a final visual-feedback verification
  inspection tool; it can still fail implementation defects reported by Visual
  QA context without becoming the visual verdict owner.
- Orchestrator no longer appends `visual_evidence_bundle_*` decision-log rows.
- Acceptance workflow projection marks visual QA / metrics acceptance according
  to the visual-feedback verification artifact, while Integrity status reflects
  implementation correctness.
- Browser Preview visual feedback artifacts expose readable image attachments
  and current preview target binding.
- Build initial dispatch receives source assets through `ResourceHandoffContext`
  and `BuildInputEvidenceManifest`.
- Build repair dispatch receives visual feedback through `VisualFeedbackContext`
  plus separated `previous_output`, `comparison_artifact`,
  `visual_qa_annotation`, and `visual_qa_diagnostic` evidence roles.
- Build `status="passed"` is rejected when a repair dispatch included Visual
  QA annotation/diagnostic evidence but the BuildResult does not list the
  consumed visual feedback refs.
- Rendered visual feedback checks fail on unreadable rendered screenshot, hash
  mismatch, blank crop, stale preview target, or wrong task/run binding.
- Generated SDK/OpenAPI no longer expose `visual-evidence-bundle` or
  `visual_evidence_bundle`.
- Metrics prebuilt acceptance uses visual feedback verification evidence and
  rejects old Bundle-only input.
- UI projection renders the new verification-evidence and comparison
  attachments without claiming Bundle materialization is the blocker.

Counterfactual tests must cover:

- Passing current visual feedback rows plus no Bundle passes the visual
  acceptance spec.
- Passing Bundle plus missing current visual feedback rows fails.
- Passing source resource manifests plus missing current visual feedback rows
  fails final visual acceptance.
- Passing current visual feedback rows still passes final visual acceptance
  when old webpage resource manifests are missing or stale after Build.
- Passing visual feedback rows from another task, run, viewport, state, or stale
  preview target fail.
- Source-binding, scroll-slice-only, resource-manifest-only, or Build self-report
  evidence fails formal visual acceptance.
- Desktop-only replica tasks are not silently expanded to mobile/tablet
  acceptance unless the user explicitly requested it.

Suggested validation commands:

```bash
bun test packages/opencorvus/test/architect/output-tools.test.ts packages/opencorvus/test/architect/grep-only-as-rejection.test.ts --timeout 120000
bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts --timeout 120000
bun test packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/integrity/team-agent.test.ts --timeout 120000
bun test packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts --timeout 120000
bun test packages/opencorvus/test/orchestrator/build-feedback-context.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts --timeout 120000
bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts packages/opencorvus/test/tool/browser-preview.test.ts --timeout 120000
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000
bun run --cwd packages/opencorvus typecheck
git diff --check
```

## Dead Code To Remove

The following surfaces become obsolete under this design:

- `VisualEvidenceBundleSchema`, `VisualRegionEvidence`, and Bundle validators.
- `materializeVisualEvidenceBundleFromEvidenceRefs`.
- `readLatestTaskVisualEvidenceBundleSync`.
- `inspect_visual_evidence`.
- `visual-evidence-bundle` prebuilt scorer and prompt guidance.
- Decision-log rows keyed `visual_evidence_bundle_*`.
- Tests whose expected output includes Bundle materialization or Bundle pass
  requirements.

This record does not delete them yet; deletion belongs to the implementation
step and must be verified with focused tests.

## Bias Controls

- Do not treat title, slug, label, or artifact naming similarity as causal
  evidence. A pass/fail claim needs tool output, database row payload,
  decision-log text, schema, code path, or test assertion.
- Do not count historical docs as active blockers unless an active prompt,
  schema, route, generated SDK, evaluator, or workflow consumer still points to
  the old contract.
- Do not count a raw screenshot path as visual evidence until the artifact
  service resolves and reads it, checks ownership, and verifies hash, nonblank,
  and currentness constraints.
- Do not allow Visual QA prose, Integrity prose, build success, generated UI
  screenshots, source packages, or scroll slices to substitute for the formal
  visual-feedback verification artifact.
- Do not delete unrelated `visual_evidence` surfaces blindly. For example,
  frontend-design visual validation evidence is a source/reporting concept, not
  necessarily the retired Bundle authority path.
- Re-run a whole-repository grep after every implementation slice. The expected
  remaining Bundle matches after deletion are historical records only, clearly
  labeled as superseded.

## Acceptance Of This Plan

This plan is the new visual acceptance direction. Any implementation that keeps
`VisualEvidenceBundle`, webpage resource manifests, source packages, or Build
resource-consumption reports as final pass/fail authority violates the user's
updated request and creates a dual-source acceptance path.

The only final acceptance authority is current rendered visual feedback. The
resource capture chain exists to make Build competent; the visual feedback chain
exists to make Build repair correctly and to decide final acceptance.
