# Visual Fidelity Evidence Chain Remediation

Date: 2026-06-08

## Problem

The TradingView world-economy task reached `completed` while the delivered page was visually far from the reference. The failure was not caused by the absence of visual mechanisms. It was caused by disconnected mechanisms that did not share one authoritative visual evidence contract.

Observed failure facts from task `tsk_ea1f96e8600175laadqmBbW2Tu`:

- `webpage_evaluate` recorded `overallScore=73`, `passed=false`, and `pixelDiffPercent=22.36%`.
- `webpage_vision_judge` produced high-quality visual differences with `accepted=false`, but schema alias mismatch turned the result into `vision-judge-failure.json` instead of a durable `vision-judge.json`.
- Architect accepted a final visual acceptance shape that only required an essential `on_integrity` `llm_judge`, without region-level visual coverage.
- The final judge path consumed `acceptance_summary` text, not actual `reference.png` and rendered screenshots.
- Integrity had prompts that asked reviewers to inspect runtime/visual evidence, but no first-class integrity tool for running the same reference-vs-rendered visual comparison that frontend-design used.

## Non-Goals

- Do not add a host-side route bypass, workflow state machine, or prompt-over-host rule that decides which agent action comes next.
- Do not add fallback visual scoring paths. There must be one evidence contract and one current evidence bundle per visual reference task.
- Do not accept screenshots, iframe previews, rendered `reference.png`, hidden semantic layers, or static text reports as substitutes for a rendered application screenshot.
- Do not make Build or Integrity depend on raw webpage extraction internals when the frontend-design handoff already materialized `web-clone-source`.

## Root Cause

The chain treated visual fidelity as prose in several places where it needed to be structured evidence:

1. `frontend_design` could submit a template while measured visual comparison was below threshold, as long as the mismatch was described as handoff debt.
2. `webpage_vision_judge` failures wrote diagnostics but did not produce a normalized negative verdict artifact when the model returned equivalent provider field aliases.
3. `architect` only checked that a final visual `llm_judge` existed. It did not require that the final verification goal enumerate the same visual regions that frontend-design marked as authoritative.
4. `metrics` `llm_judge` supports only `acceptance_summary`, `changed_files`, and `requirement_text`. That makes a visual judge read reports instead of seeing pixels.
5. `integrity` tools expose code/diff/context inspection and guarded commands, but do not expose a bounded "render current app, compare against reference, return numeric + qualitative visual evidence" tool.
6. Integrity traceability and severity discipline require findings to anchor to REQ / AcceptanceSpec / user quote. When architect did not create strict region acceptance specs, many visual defects lost their severity anchor.

## Call Point Inventory

| Area | Current File(s) | Current Behavior | Required Change |
| --- | --- | --- | --- |
| Frontend design visual tools | `packages/opencorvus/src/frontend-design/tools/webpage-evaluate.ts`, `webpage-vision-judge.ts` | Numeric and qualitative visual evidence can be generated, but only frontend-design has direct tool access. | Keep these tools as the single comparison implementation; expose their evidence through shared visual evidence helpers instead of duplicating logic. |
| Frontend design handoff | `packages/opencorvus/src/frontend-design/agent.ts`, `handoff.ts`, `output-tools.ts`, `prompt/core/frontend-design-core.txt` | Handoff can describe visual debt while still publishing a "complete" template. | Handoff must publish a structured visual evidence bundle and region matrix. A region is `complete` only when latest numeric and qualitative evidence for that region is passing or explicitly marked deferred with a downstream acceptance owner. |
| Web clone evidence integrity | `packages/opencorvus/src/web-clone/evidence-integrity.ts`, `context.ts`, `source-skeleton.ts` | Validates presence and integrity of source evidence files such as `reference.png`, `eval-result.json`, and `vision-judge.json`. | Extend to validate the latest current visual evidence bundle: reference PNG, rendered PNG, eval result, vision verdict, viewport, source commit/worktree provenance, and region coverage. |
| Architect fidelity validation | `packages/opencorvus/src/architect/output-tools.ts`, `fidelity.ts`, `prompt/core/architect-core.txt` | `missing_final_visual_acceptance` is only a concern and only checks for a final essential `llm_judge`. | Require a final verification/integration goal whose acceptance specs enumerate every required visual region and reference the visual evidence bundle contract. Missing region coverage means the architect has not produced positive visual-fidelity ownership for reference-driven UI tasks. |
| Acceptance judge inputs | `packages/opencorvus/src/acceptance/types.ts`, `metrics/executor.ts`, tests under `packages/opencorvus/test/metrics` | Judge inputs are text-only: `acceptance_summary`, `changed_files`, `requirement_text`. | Add visual evidence input support that passes structured references to rendered/reference image artifacts and evaluation reports. Visual-fidelity judge specs must receive visual evidence artifacts instead of text-only inputs. |
| Integrity tools | `packages/opencorvus/src/integrity/acceptance-tools.ts`, `team-agent.ts`, `prompt/core/integrity-team-core.txt` | Reviewers can run commands and inspect context, but visual comparison is not a first-class scoped tool. | Add a scoped integrity visual comparison tool that starts from a proven repository root, renders the app, compares against the authoritative reference, and returns the current visual evidence bundle. |
| Orchestrator evidence plumbing | `packages/opencorvus/src/orchestrator/tools.ts`, `webpage-evidence.ts`, `engine/git.ts` | Frontend-design evidence and acceptance summaries are passed as text/context. | Persist and pass visual evidence bundle IDs through task artifacts and build/integrity acceptance context. |
| Prompt/tests | `packages/opencorvus/test/frontend-design/*`, architect fidelity regression tests, `test/integrity/*`, `test/prompt/*` | Tests verify prompt strings and minimal final judge existence. | Add regression tests for region coverage, visual evidence bundle propagation, and integrity-side visual comparison. |

## Target Contract

Introduce a single structured visual evidence contract for reference-driven UI tasks.

```ts
type VisualEvidenceBundle = {
  id: string
  taskID: string
  source: "frontend_design" | "build" | "integrity"
  reference: {
    path: string
    sha256: string
    width: number
    height: number
  }
  rendered: {
    path: string
    sha256: string
    width: number
    height: number
    capturedAt: string
    viewport: { width: number; height: number; deviceScaleFactor?: number }
    appURL: string
    projectDirectory: string
    commitRef?: string
  }
  evaluation: {
    path: string
    overallScore: number
    passThreshold: number
    passed: boolean
    ssimScore: number
    pixelDiffPercent: number
    dimensionsMatch: boolean
  }
  vision: {
    path: string
    accepted: boolean
    differenceCount: number
    criticalCount: number
    majorCount: number
    minorCount: number
  }
  regions: VisualRegionEvidence[]
}

type VisualRegionEvidence = {
  id: string
  label: string
  requirementIDs: string[]
  acceptanceSpecIDs: string[]
  sourceRefs: string[]
  viewport: string
  bounds?: { x: number; y: number; width: number; height: number }
  required: boolean
  status: "passing" | "failing" | "deferred"
  evidenceRefs: string[]
  notes: string
}
```

The bundle is not a new workflow decision mechanism. It is the single evidence object that existing frontend-design, architect, build, and integrity stages must consume when they claim visual fidelity.

## Required Behavior

### 1. Frontend Design

Frontend-design must publish two separate facts:

- `visual_baseline_status`: the current measured state of the skeleton or target render.
- `implementation_handoff_status`: whether Build has enough source evidence to proceed.

These must not collapse into one "template complete" claim.

Rules:

- If `webpage_evaluate.passed=false`, frontend-design may still hand off source material, but the handoff must say `visual_baseline_status=failing`.
- Every failing region from `webpage_vision_judge` must become either:
  - a `VisualRegionEvidence` row with `status=failing`, or
  - a deferred region row with a downstream acceptance spec requirement.
- `record_frontend_replacement_result(status="completed")` must require evidence refs that include a fresh rendered screenshot and either a passing evaluation for that region or an accepted qualitative verdict for that region.
- `vision-judge-failure.json` is diagnostic only. It must never be treated as "no visible differences"; downstream context must surface it as missing visual verdict plus failure diagnostics.

### 2. Webpage Vision Judge

The immediate alias fix already landed in commit `3493c0269`, but the full contract needs stronger failure behavior.

Rules:

- Provider aliases must normalize without dropping findings:
  - `see`, `what_you_see`, `whatYouSee` -> `observed`
  - `should_see`, `shouldSee`, `what_you_should_see`, `whatYouShouldSee` -> `expected`
  - `fix`, `fixHint` -> `fix_hint`
- If schema validation still fails and a parseable object is present in the error cause, write a normalized negative diagnostic artifact that preserves the raw differences. Do not synthesize `accepted=true`.
- Tests must replay the exact TradingView-style failure shape: `severity`, `region`, `see`, `should_see`, `fix`, `accepted:false`.

### 3. Architect

Architect must convert visual regions into acceptance ownership, not just final prose.

Rules:

- For reference-driven UI tasks, `requireReferenceCoverage=true` must require:
  - at least one `register_reference_coverage` row for the authoritative reference screenshot;
  - one final verification/integration goal;
  - region-specific acceptance specs for every required visual region named in `visual_consistency_contract`, `visual_layout`, or frontend-design region evidence.
- Each required visual region must appear in an acceptance spec title, scenario, or scorer criteria.
- The final verification goal must require a visual evidence bundle, not only an `acceptance_summary` judge.
- `missing_final_visual_acceptance` must remain about graph validity, while missing required region coverage for a reference-driven task means the graph has no positive ownership evidence for a user-visible requirement.

Example final verification acceptance spec:

```json
{
  "id": "acc-final-visual-bundle-desktop",
  "source_requirement_id": "REQ-visual-fidelity",
  "goal_id": "goal_final_visual_verification",
  "title": "Desktop visual evidence bundle passes for all required reference regions",
  "scenario": {
    "given": ["the built target app is served from the reviewed repository root"],
    "when": ["the app is rendered at the primary desktop viewport and compared with reference.png"],
    "then": [
      "the latest VisualEvidenceBundle has evaluation.passed=true",
      "the latest VisualEvidenceBundle has vision.accepted=true",
      "all required regions have status=passing",
      "the bundle rendered commit/worktree matches the reviewed code"
    ]
  },
  "scorers": [
    {
      "type": "prebuilt",
      "name": "visual-evidence-bundle",
      "spec": { "kind": "visual_evidence_bundle", "viewport": "desktop-primary" },
      "expect": { "status": "passed" }
    }
  ],
  "severity": "essential",
  "trigger": "on_integrity"
}
```

### 4. Build

Build may still use normal code/test tools, but visual claims must reference the bundle.

Rules:

- A build report for a visual goal cannot claim visual parity from build/typecheck/grep.
- When a visual goal changes a rendered surface, the report must include:
  - the visual region IDs touched;
  - screenshot artifact path(s);
  - eval result path and score;
  - vision verdict path and accepted/difference counts;
  - exact remaining failing regions, if any.
- If a goal only fixes a subset of failing regions, it must report that scope explicitly instead of writing a global "visual verification completed" statement.

### 5. Metrics / Acceptance

The `llm_judge` scorer is useful for qualitative review, but text-only inputs are invalid for visual fidelity.

Rules:

- Add a `visual_evidence` input kind to acceptance judge config.
- If an acceptance scorer criteria contains final rendered-vs-reference visual fidelity language and `inputs` omits `visual_evidence`, mark the metric non-fresh with a diagnostic that says visual evidence is missing.
- Add a prebuilt scorer kind for `visual_evidence_bundle` so non-LLM acceptance can assert numeric and artifact freshness facts.
- Keep LLM judge for qualitative differences only after the numeric evidence exists.

### 6. Integrity

Integrity must be able to reproduce the final visual comparison from the reviewed repository root.

Add `inspect_visual_evidence` or equivalent scoped tool to `createIntegrityAcceptanceTools`.

Required tool behavior:

1. Resolve the authoritative reference from the task's frontend-design handoff or visual evidence bundle.
2. Start or use a preview server from the reviewed repository root, not a stale URL.
3. Capture rendered screenshots using Node/Playwright on Windows; do not use Bun to start Playwright.
4. Run the same visual evaluation implementation used by `webpage_evaluate`.
5. Run the same qualitative comparison implementation used by `webpage_vision_judge` when a vision-capable model is available.
6. Return a `VisualEvidenceBundle` summary and artifact paths.

Integrity prompt changes:

- When the task is a webpage replica or has visual reference coverage, at least one reviewer perspective must inspect the visual evidence bundle.
- A final pass cannot rely on executor report language for visual fidelity when a bundle is absent, stale, or failing.
- If architect did not create region-level visual acceptance specs, integrity must file a graph/requirements finding anchored to the original visual request or `visual_consistency_contract`, not silently downgrade the visual defects.

### 7. Orchestrator

The orchestrator must pass visual evidence as structured context, not just decision-log prose.

Rules:

- `frontend_design` result should persist the latest `VisualEvidenceBundle` artifact ID when available.
- Build retry feedback should include failing region IDs and bundle artifact paths, not only summarized differences.
- Integrity input should include the latest bundle ID(s), current reference path, and expected final verification goal ID.
- After integrity returns non-pass for visual fidelity, orchestrator should dispatch the smallest responsible repair path:
  - local implementation bug -> build retry;
  - missing region acceptance specs -> modify_goal / architect repair;
  - missing requirements for explicit visual promise -> requirements repair.

## Tests

### Unit Tests

- `packages/opencorvus/test/frontend-design/webpage-vision-judge.test.ts`
  - Preserve existing alias test.
  - Add exact raw object from TradingView failure: `see`, `should_see`, `fix`, `accepted:false`.

- Architect fidelity regression tests
  - Reference-driven task with final `llm_judge` but no region specs produces unresolved architect validation evidence.
  - Reference-driven task with region specs and final visual bundle prebuilt scorer passes validation.

- `packages/opencorvus/test/metrics/executor.test.ts`
  - Visual fidelity judge without `visual_evidence` is non-fresh with diagnostic.
  - Visual fidelity judge with bundle evidence receives artifact references.

- `packages/opencorvus/test/integrity/acceptance-tools.test.ts`
  - Integrity tool exposes visual evidence inspection when frontend-design contract references `reference.png`.
  - Tool result includes reference path, rendered path, score, threshold, verdict, and provenance.

- `packages/opencorvus/test/prompt/integrity-severity-prompt.test.ts`
  - Prompt requires visual evidence bundle inspection for webpage replica tasks.

### Integration Tests

- Synthetic task where `webpage_evaluate` returns `passed=false`:
  - frontend-design handoff is allowed only as `visual_baseline_status=failing`;
  - architect must create failing-region follow-up acceptance ownership;
  - final integrity has no positive visual-fidelity evidence without a passing bundle.

- Synthetic task where executor report claims "visual verification passed" but no rendered screenshot exists:
  - integrity must report missing visual evidence.

- Synthetic task where rendered screenshot differs from reference but all grep heuristics pass:
  - final status must remain not completed until visual evidence passes.

## Acceptance Criteria

- A reference-driven webpage replica has no positive completion evidence from build/typecheck/grep plus text-only judge alone.
- Every required visual region has an owner, acceptance spec, and evidence row.
- The final visual acceptance proof contains:
  - valid authoritative reference PNG;
  - rendered screenshot from reviewed repository root;
  - numeric visual evaluation with configured threshold;
  - qualitative verdict with `accepted=true`;
  - region coverage summary with all required regions passing.
- Failing or missing visual evidence is visible to the right-side task evidence stream and integrity report.
- Existing non-visual workflows are unaffected.

## Rollout Plan

1. Finish `webpage_vision_judge` alias/error-preservation fixes.
2. Define `VisualEvidenceBundle` types and serializer under `packages/opencorvus/src/acceptance` or `web-clone`.
3. Update frontend-design handoff to publish bundle and region status.
4. Update architect validation and prompt to require region-level visual acceptance specs for reference-driven UI tasks.
5. Add visual evidence input/prebuilt scorer support to metrics/acceptance.
6. Add integrity-side visual evidence inspection tool using the shared comparison implementation.
7. Update orchestrator context plumbing and retry feedback.
8. Add unit and integration tests listed above.
9. Re-run a TradingView-style benchmark task and verify that the previous false-positive completion now produces actionable failing region evidence instead of `completed`.

## Open Decisions

- Exact artifact storage kind for `VisualEvidenceBundle`: reuse `verification-evidence` or add a specific `visual-evidence-bundle` artifact kind.
- Region bounds source: derive from `source-ir/layout-map.json` when available; otherwise require region label and section-level evidence only.
- Whether final high-fidelity threshold should be fixed at `96` for webpage replicas or configurable per `visual_consistency_contract`.
- Whether qualitative vision review should be mandatory when no vision-capable model is configured, or whether numeric evidence plus explicit "vision unavailable" should keep the task non-fresh.
