# Frontend Visual QA Dedicated Agent Plan (2026-06-08)

## Scope

Add a dedicated orchestrator-dispatched frontend UI/UX QA stage built on the existing `visual-qa` agent identity. UI means User Interface, UX means User Experience, and QA means Quality Assurance. The stage consumes task-scoped `frontend_design` / build evidence, runs real visual/runtime checks, may repair in-scope defects, supports skills, and submits one structured terminal report.

## Call Point Inventory

| Surface | Current evidence | Change |
| --- | --- | --- |
| Agent registry | `AgentRoleID` already includes `visual-qa`; `Agent.state()` registers it with build-grade tools and skill permission. | Keep identity; tighten prompt and add stage runner/output tools. |
| Tool registry | Special-cases `visual-qa` to allow acceptance tools and deny webpage analysis tools. | Reuse; no new webpage extraction tools. |
| Skill tool | `SkillTool` distinguishes webpage analysis/extraction tool hints from webpage acceptance tool hints. | Allow `visual-qa` to load acceptance skills such as `webpage_render`; keep extraction skills limited to `frontend-design`. |
| Session kind | `SESSION_KINDS` lacks `visual-qa`. | Add `visual-qa` so the dedicated stage has a real child session kind. |
| Orchestrator agent include list | No `visual_qa` workflow tool. | Add `visual_qa` dispatch tool. |
| Orchestrator prompt | Mentions frontend tools and integrity but not dedicated visual QA. | Document `visual_qa` as optional post-build / post-repair UI evidence stage, not a gate. |
| Stage runner modules | No `src/visual-qa/*` module. | Add `agent.ts`, `output-tools.ts`, `schema.ts`, `static-tools.ts`, and `index.ts`. |
| Tests | Existing tests cover registry-level `visual-qa`. | Add output-tool tests, agent-runner wiring tests, and orchestrator tool/registry prompt tests. |

## Tool Surface

`visual-qa` dedicated stage gets:

- Context: `read_file`, `find_files`, `search_code`, `list_directory`, `memory_search`, `memory_get`
- Utility: `skill`
- Implementation/repair: `bash`, `edit`, `write`, `apply_patch`
- Visual acceptance: `webpage_render`, `webpage_evaluate`, `webpage_text_diff`, `webpage_vision_judge`

It must not get:

- `webpage_extract`, `webpage_compile`, `webpage_analyze`, `webpage_runtime_state`
- `url_screenshot`, `create_frontend_skeleton_project`
- `task`, `panel`, `websearch` by default

## Output Contract

Terminal tool: `submit_visual_qa_report`

Required shape:

- `accepted: boolean`
- `summary: string`
- `coverage[]`: region / viewport / state / source refs / evidence refs
- `findings[]`: severity / claim / reproduction / evidence refs / source refs / status
- `repairs[]`: changed files / reason / verification
- `evidence[]`: type / path-or-url / viewport / state / note
- `commands[]`: command / cwd / passed / detail
- `changed_files[]`
- `open_questions[]`

## Orchestration

Use `visual_qa` after build when task context has frontend/UI/visual surface and fresh visual/runtime evidence is needed before integrity, especially after visual integrity findings or for high-fidelity webpage clones. It is not a hard host-side gate. Integrity remains final acceptance.
