# Clone-First Frontend Handoff Fix

## Evidence

- The fresh Kimi overlay run reached `architect` and never persisted goals.
- The architect session registered 7 goals, 16 contracts, 20 dependency reasons, and repeatedly repaired contract blockers before any build work started.
- The requirements snapshot converted source maintainability into a hard final rule: no unmodified generated DOM region with 200+ elements may remain.
- The frontend_design report set `final_delivery_mode=maintainable_replacement_required` and published a large `baseline_replacement_plan`, even though the immediate benchmark gate was visual clone similarity >= 80%.

## Root Cause

The source handoff conflates two different phases:

1. Clone-first acceptance: adopt the frontend-design skeleton/source baseline into the root app and reach the requested visual threshold.
2. Later maintainability/refactor work: replace specific generated/source-dom regions with semantic components/data modules where the PRD or source debt actually requires it.

Because the handoff made phase 2 a prerequisite for phase 1, Requirements and Architect planned a full semantic rewrite before the 80% visual gate. Kimi then tried to satisfy every graph surface instead of letting Build start from the existing source baseline.

## Fix

- In host-prepared webpage-clone frontend_design turns, keep `final_delivery_mode=visual_baseline_allowed` unless the user explicitly asks to replace generated/source-dom regions before acceptance.
- Keep `sourceDomReplacementPlan.ts` as a known-problem map, but do not publish it as a blocking `baseline_replacement_plan` for clone-first mode.
- Add a dynamic clone-first handoff section derived from decision_log entries. It tells Requirements, Architect, Build, and Delivery that maintainability means source-derived baseline adoption, reusable components/libraries for targeted refinements, no screenshot/iframe/freehand rebuild, and explicit reporting of remaining generated regions.
- In that dynamic section, tell Architect to use a minimal phase graph for clone-first webpage replicas: baseline adoption, targeted visual/responsive gap patching, and final overlay/report verification. Do not split by header/content/footer unless the request truly requires separate feature implementation.

## Non-Fix

- Do not bypass decision_log.
- Do not add host-side state-machine guards to stop Architect.
- Do not remove source audit behavior for true `maintainable_replacement_required` tasks.
