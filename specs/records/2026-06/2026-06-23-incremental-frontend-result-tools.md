# Incremental Frontend Result Tools

Date: 2026-06-23

## Problem

`frontend-design` still exposes `submit_frontend_template` as one large terminal payload. Provider-side structured output for that giant schema is unstable; a single missing or malformed leaf forces the agent to retry the entire result. This is worse for webpage clone tasks because the payload includes skeleton, material inventory, component reuse, validation evidence, project metadata, and review notes in one call.

`frontend-research` already uses registration tools plus `submit_research_brief({ final: true })`, but failed finalization reports generic parse/semantic errors. The model can see that the final failed, but not which registration tool should be called next.

## Callpoint Inventory

`frontend-design` result path:

- `packages/opencorvus/src/frontend-design/schema.ts`: defines the current terminal input schema and compact item schemas.
- `packages/opencorvus/src/frontend-design/output-tools.ts`: owns the collector, validation, report builder, and `submit_frontend_template`.
- `packages/opencorvus/src/frontend-design/agent.ts`: exposes only `submit_frontend_template` from the output toolkit through `createFrontendSubmitTools`.
- `packages/opencorvus/src/frontend-design/static-tools.ts`: lists the session-visible tool IDs.
- `packages/opencorvus/src/prompt/core/frontend-design-core.txt`: instructs the agent to submit one full contract.
- `packages/opencorvus/src/frontend-design/host-prepared-source-project.ts`: repeats host-prepared instructions for final submission.
- `packages/opencorvus/test/frontend-design/*`: validates schema shape, prompt text, runtime tool exposure, and output validation.

`frontend-research` result path:

- `packages/opencorvus/src/research/output-tools.ts`: already owns an incremental collector and small finalizer.
- `packages/opencorvus/src/research/agent.ts`: exposes all research registration tools and `submit_research_brief`.
- `packages/opencorvus/test/research/output-tools.test.ts`: validates no old giant payload is accepted and incomplete collectors remain open.

## Design

`frontend-design` should match the research collector pattern:

- Add typed `update_*` tools for each stable template fragment. Do not split verbs into `set_*` and `add_*`; every fragment write is an update so the prompt surface is shorter and consistent.
- Store fragments in one collector draft. The collector is the only source of truth.
- Keep `submit_frontend_template` as the terminal tool name, but reduce its schema to `{ final: true, fact_check_items?: [...] }`.
- On finalization, assemble the draft into the existing canonical `FrontendTemplateFinalSchema`, then run the existing semantic and artifact validation.
- If finalization fails because fields are missing, return a `MISSING_FRONTEND_TEMPLATE_RESULT` tool result with exact next `update_*` calls. Do not finalize and do not ask the agent to retry the giant result.
- If finalization fails because semantic/artifact validation fails, keep the collector open and include the validation detail plus the status tool name. The model should correct the bad fragment with the matching `update_*` tool.

`frontend-research` should not be rebuilt:

- Add a status tool or status text that maps collector gaps to registration tools.
- Make `submit_research_brief` incomplete/semantic failures include the same missing-action list.
- Keep `submit_research_brief` small and keep rejecting old giant payloads.

## Tool Surface

Frontend design session tools must include:

- `update_frontend_basics`
- `update_frontend_text`
- `update_frontend_item`
- `update_frontend_material`
- `update_frontend_project`
- `update_frontend_component_reuse`
- `update_frontend_baseline`
- `update_frontend_phase`
- `update_frontend_visual_evidence`
- `update_frontend_iteration_note`
- `update_frontend_reference`
- `update_frontend_question`
- `inspect_frontend_result_status`
- `submit_frontend_template`

Research session tools should expose consistent `update_*` result tools, with `submit_research_brief` staying as the terminal tool:

- `inspect_research_result_status`

## Acceptance

- `frontend-design` runtime no longer exposes only a giant terminal result schema.
- `submit_frontend_template` accepts only the small finalizer payload in the session tool surface.
- Missing frontend-design content returns `update_*` instructions without closing the collector.
- Research finalization failures return `update_*` instructions without closing the collector.
- Existing artifact and semantic validation still run on the assembled canonical final result.
- Tests cover the new incremental frontend-design submit flow and research missing-status flow.
