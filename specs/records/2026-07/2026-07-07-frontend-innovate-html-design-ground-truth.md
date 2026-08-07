# Frontend Innovate HTML Design Ground Truth

## Recall

### User Request

- Current carried objective: move/redefine the frontend-design role for the frontend-innovate expert squad. It must investigate competitor webpages derived from frontend_research parsed source pages, take screenshots, redesign the webpage, and deliver an HTML design draft. The user's hypothesis is that frontend-innovate is basically frontend-replica plus a design agent, with the reference ground truth changed to the HTML design draft.
- Earlier same-thread hard constraint remains active: frontend-design must be disconnected from the normal frontend-replica workflow only; do not delete the frontend-design agent, tools, prompts, modules, or historical handoff consumers.

### Acceptance Criteria

- The built-in frontend-replica path must remain disconnected from `frontend_design` as recorded in `2026-07-07-frontend-replica-frontend-design-disconnect.md`.
- Frontend-innovate must have a scheduler-visible workflow path that includes `frontend_design`; selecting/using the frontend-innovate package cannot rely on the default replica pipeline silently exposing a disconnected target.
- Frontend-innovate `frontend-design` must be redefined as a competitor-informed redesign owner: consume source-page evidence from frontend_research, inspect evidence-backed competitor/design reference pages, capture screenshot evidence, compare multiple directions, select one, and deliver a source-editable HTML/CSS design draft.
- The HTML design draft must be the downstream reference ground truth for Build, Visual QA, and Integrity in frontend-innovate. The original source page and competitor pages remain evidence inputs, not the final parity target.
- The implementation must not add fallback, compatibility aliases, gates, second active expert-squad state, synthetic messages, or a package-owned workflow engine.
- Code changes must have focused tests covering workflow target projection, frontend-innovate dynamic attributes/prompt projection, frontend-design output contract, and payload/package validity.

### Hard Constraints

- Expert squad identity remains manifest `id`; directory names, labels, selector names, tool names, and similar naming are not identity evidence.
- `prompt_profile.active` remains the single active expert-squad source.
- `PromptProfileResolver` remains the runtime projection source.
- `WorkflowRegistry` remains the single workflow definition source. Expert squads may select an existing registry workflow but must not define a second workflow engine.
- No fallback/compatibility logic. Missing evidence must be visible as blocked/incomplete, not silently substituted.
- Competitor pages must be evidence-backed by user-supplied URLs, frontend_research/deep_research output, or task material. `frontend_design` must not invent competitor URLs.
- Visual output must be proven by real rendered screenshot evidence when a visual deliverable is claimed.

### Landed Material Read Before Edits

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-frontend-innovate-design-philosophy.md`
- `specs/records/2026-07/2026-07-02-frontend-innovate-sloppy-review.md`
- `specs/records/2026-07/2026-07-06-expert-squad-formal-contracts.md`
- `specs/records/2026-07/2026-07-07-frontend-replica-frontend-design-disconnect.md`
- `.opencorvus/expert-squads/builtin/frontend-innovate/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/frontend-innovate/selector.md`
- `.opencorvus/expert-squads/builtin/frontend-innovate/agents/frontend-design/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/selector.md`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/frontend-design/agent.ts`
- `packages/opencorvus/src/frontend-design/schema.ts`
- `packages/opencorvus/src/frontend-design/output-tools.ts`
- `packages/opencorvus/src/frontend-design/handoff.ts`
- `packages/opencorvus/src/build/prompt-context.ts`
- `packages/opencorvus/src/visual-qa/context.ts`

### Whole-Repo Grep Evidence

- `rg -n "frontend-innovate|frontend_design|visual-html-skeleton|source_reference_artifact|visual_validation_evidence|require_design_direction_contract|dispatch_agent target=frontend_design|design draft|competitor|竞品|ground truth" ...` showed frontend-innovate already declares a `frontend-design` agent and `require_design_direction_contract`, but the role still speaks in terms of generic design-resource synthesis and old source-derived visual skeletons.
- `rg -n "default_workflow|workflow_id|WorkflowRegistry|capability_projection.*workflow|dispatch_agent" ...` showed `dispatch_agent` target validation is driven by the active `MiniWorkflow`; after the replica disconnect, the default `pipeline` no longer exposes `frontend_design`.
- `rg -n "dynamicAttributes|requireDesignDirectionContract|frontend_design" packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/src/orchestrator/tools.ts` showed the only frontend-design package-specific runtime attribute is `requireDesignDirectionContract`, which is passed into `FrontendDesignAgent.analyze`.
- `rg -n "source_reference_artifact|screenshot_artifact|visual_validation_evidence" packages/opencorvus/src/frontend-design packages/opencorvus/src/build packages/opencorvus/src/visual-qa ...` showed the current visual baseline contract treats `web-clone-source/reference.png` as the source reference. That is correct for replica, but wrong as the final parity target for innovate redesign.
- `rg -n "workflowID|workflow.selected|defaultIDForTaskKind|select_expert_squad" packages/opencorvus/src packages/opencorvus/test` showed task workflow selection is currently emitted from `WorkflowRegistry.defaultIDForTaskKind`, before active expert-squad capability is used to build the scheduler tool table.

### Independent Agent Feedback

- No separate subagent was used in this pass. The current decision is based on local source, specs, and focused grep evidence.

## Analysis

The user's high-level model is directionally correct but incomplete. Frontend-innovate can be modeled as the frontend-replica development path plus a design stage only if the workflow and downstream evidence semantics change together.

If only the prompt says "run frontend_design" while the active workflow remains the replica `pipeline`, `dispatch_agent.target=frontend_design` is rejected by the workflow-scoped schema. If `frontend_design` is put back into the default `pipeline`, frontend-replica regresses and violates the prior disconnect request.

The correct architecture is:

1. Keep `pipeline` as the replica/default workflow without `frontend_design`.
2. Add a registry-owned built-in frontend-innovate workflow that includes `frontend_design` after frontend_research/deep_research and before requirements/architect.
3. Let the active frontend-innovate expert-squad package select that registry workflow through projected manifest data. This keeps workflow definition in `WorkflowRegistry` and active selection in `prompt_profile.active`.
4. Add frontend-innovate runtime attributes for HTML design ground truth so `FrontendDesignAgent` and its output tools enforce the redesign contract only when the active package requires it.
5. Update package prompts/selector/README so the design agent investigates evidence-backed competitor references and produces `visual-html-skeleton` as the task-scoped HTML design draft.
6. Update downstream handoff guidance so Build/Visual QA/Integrity treat the rendered HTML design draft evidence as the innovate parity target. Original source and competitor pages remain cited inputs and constraints, not the final reference target.

The main risk is competitor discovery. Letting `frontend_design` guess competitor webpages would reintroduce hallucinated references and a hidden fallback path. The safer contract is that frontend_research/deep_research or user input must provide competitor/design reference URLs or artifacts; frontend_design can inspect and screenshot those evidence-backed references, but it must report blocked if the redesign request requires competitor comparison and no competitor evidence exists.

## Implementation Plan

- Extend manifest dynamic attributes with a scheduler workflow preference and frontend-design HTML design ground-truth requirement.
- Add a `frontend_innovate` built-in workflow in `WorkflowRegistry`: `frontend_research` / `deep_research` -> `frontend_design` -> `analyze_intent` / `requirements` -> `architect` -> `workload_analysis` -> per-goal `build` -> `visual_qa` / `integrity` -> `fact_check`.
- In the Orchestrator scheduler setup, resolve active expert-squad capability before workflow selection and let a declared active workflow override the global default for workflow tasks.
- Pass the frontend-innovate HTML design-ground-truth attribute into `FrontendDesignAgent.analyze` and `createFrontendTemplateOutputTools`.
- Enforce the required HTML design draft output when the attribute is enabled: `final_acceptance_mode=visual_baseline_allowed`, `frontend_project.role=visual_baseline_input`, source-editable `visual-html-skeleton`, structured rendered screenshot evidence, at least two design directions, selected direction, and anti-slop review.
- Update frontend-innovate package README, selector, and `agents/frontend-design/system.md` to define competitor evidence handling, screenshot proof, and HTML design draft ground truth.
- Regenerate `packages/opencorvus/src/expert-squad/payload.ts`.
- Add/adjust tests for workflow projection, frontend-innovate scheduler workflow selection, frontend-design dynamic contract enforcement, and package payload generation.

## Non-Goals

- Do not delete frontend-design files from frontend-replica.
- Do not add package-local MCP servers unless there is a real new service to expose. Existing Browser Preview/webpage evidence/Figma MCP paths are the mature toolchain; inventing a package MCP wrapper would create another source of truth.
- Do not implement web search as a fallback competitor finder inside frontend_design. Use user-provided, frontend_research, or deep_research evidence.

## Implementation Update

- `WorkflowRegistry` now keeps the default `pipeline` without `frontend_design` and adds a registry-owned `frontend_innovate` workflow with `frontend_design` between source/deep research and downstream requirements/architecture/build/review.
- Frontend-innovate projects select that workflow through manifest-projected dynamic attributes; `prompt_profile.active` remains the only active expert-squad source and `PromptProfileResolver` remains the runtime projection owner.
- `FrontendDesignAgent` and its output tools now receive `requireHtmlDesignGroundTruth` for frontend-innovate. That mode requires `final_acceptance_mode=visual_baseline_allowed`, `frontend_project.role=visual_baseline_input`, at least two design directions, one selected direction, anti-slop review, rendered `visual-html-skeleton` validation evidence, and structured competitor/reference webpage evidence.
- Competitor/reference evidence is now a first-class `competitor_reference_evidence` contract and `update_frontend_competitor_reference` tool row. Each row carries evidence source, source-page ref, HTTP(S) competitor/reference URL, raster screenshot artifact, SHA-256 digest, viewport, inspected elements, selected-direction influence, and durable source refs.
- Frontend-innovate README, selector, frontend-design system prompt, payload projection, decision-log manifest, Build handoff, Visual QA/Integrity context flow, and focused tests were updated so prose-only competitor discussion is rejected; downstream agents receive competitor screenshots as rationale/input evidence while the HTML design draft screenshot remains the visual ground truth.
- The orchestrator focused test now waits for completed goal workspace pointers to be reclaimed after asynchronous goal-scoped builds. This fixes the Windows teardown race where the test could remove the parent temp directory before the final background worktree cleanup completed.

## Verification

- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun test packages/opencorvus/test/frontend-design/handoff.test.ts -t "frontend-innovate goal-scoped handoff keeps HTML design ground truth guidance"`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend innovate expert squad runs visible skill selection through design, build drafts, visual QA, and integrity"`
- `bun test packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts -t "frontend innovate HTML design ground-truth contract"`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "resolves frontend design dynamic attributes|frontend innovate active package declares"`
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts -t "pipeline dispatch_agent target schema"`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
- `bun run typecheck`
