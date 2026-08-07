# 2026-06-03 Frontend Research Direct Investigation Fix

## Problem

`frontend-research` was incorrectly implemented as a coordinator that delegated
source-backed webpage investigation to `BuildAgent`. That polluted the workflow:
a build session could appear before requirements and architect even though the
normal pipeline is `frontend_design + frontend_research -> requirements ->
architect -> per-goal build -> integrity`.

The root cause is not the overlay card placement. The root cause is the runtime
and prompt contract that made build responsible for research.

## Callpoint Inventory

Full-repo grep covered these related surfaces before implementation:

| Surface                                                                                 | Current issue                                                             | Fix                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/frontend-research/agent.ts`                                                        | Disables retrieval tools and installs `delegate_deep_research_to_build`.  | Prepare webpage evidence for source URLs, expose normal read-only retrieval through `runResearchSession`, and only submit `frontend_research_brief`. |
| `src/frontend-research/build-delegation.ts`                                             | Calls `BuildAgent.run` for no-change investigation packets.               | Delete; no replacement wrapper.                                                                                                                      |
| `src/research/agent.ts`                                                                 | Has extension hooks only used by the deleted build delegation path.       | Remove the unused additional-tool and retrieval-disable branches.                                                                                    |
| `src/prompt/core/frontend-research-core.txt`                                            | Tells the agent not to investigate and to delegate to build.              | Rewrite as direct initial/source-backed webpage investigation with prepared evidence plus webfetch for textual gaps.                                 |
| `src/prompt/core/orchestrator-core.txt`                                                 | Teaches orchestrator that frontend-research delegates to build workers.   | Teach frontend-research as an evidence-producing stage before requirements/architect; build only runs after architect goals.                         |
| `src/orchestrator/tools.ts`                                                             | Tool description and source URL schema mention build delegation.          | Describe direct read-only investigation and downstream handoff.                                                                                      |
| `src/engine/workflow.ts`                                                                | Workflow hint says frontend-research delegates deep packets to build.     | Describe direct initial investigation and advisory handoff.                                                                                          |
| `src/agent/role-contract.ts` / `src/agent/agent.ts`                                     | Role says coordinator/no direct investigation; registry exposes no tools. | Role becomes direct read-only webpage research; registry exposes read-only retrieval except websearch.                                               |
| `src/research/webpage-prd-evidence.ts`                                                  | Prompt section still points missing facts to delegated build packets.     | Point missing facts to frontend-research's own read-only tools and open questions.                                                                   |
| Tests under `test/frontend-research`, `test/agent`, `test/orchestrator`, `test/session` | Tests pin the wrong build-delegation contract.                            | Replace with tests that prove no build delegate tool exists and direct retrieval is available.                                                       |
| Specs `01-agents.md` and `2026-06-03-frontend-research-agent.md`                        | Historical docs encode build delegation as a revised design.              | Mark that revision superseded and document direct investigation.                                                                                     |

## Design

- `frontend-research` is a read-only webpage research agent, not a build
  coordinator.
- It starts from rendered webpage evidence when source URLs exist, uses
  read-only retrieval for source pages or linked textual gaps, and produces one
  `frontend_research_brief` with `webpage_contract`.
- It never writes project files, never creates implementation templates, never
  emits REQ rows, never creates goals, and never calls build.
- Downstream investigation/implementation decomposition happens through
  `requirements` and `architect`; per-goal build only starts after architect
  creates the goal graph.
- `subpage_research_tasks` remain advisory evidence for downstream agents; they
  are not direct tool commands and not build dispatch packets.

## Verification Plan

- Run focused tests:
  - `bun test test/frontend-research test/agent/context-tools.test.ts test/agent/role-contract.test.ts test/agent/core-prompt-hygiene.test.ts test/orchestrator/orchestrator-tool-descriptions.test.ts test/session/extra-tools.test.ts`
- Run `rg` after the patch to ensure removed identifiers do not remain in
  runtime or tests. Historical specs may mention superseded strings as context:
  - `delegate_deep_research_to_build`
  - `collect_frontend_research_evidence`
  - `build-delegation`
  - `delegates deep investigation packets to build`

## 2026-06-03 Webpage Evidence Dissolution Follow-up

The direct-investigation fix still left a wrong coupling: `frontend-research`
read prepared webpage evidence through `frontend-design/webpage-evidence` paths. That made
an independent research agent depend on a legacy implementation name from the
frontend-design tool surface.

Corrected architecture:

- Canonical rendered webpage evidence lives under
  `.opencorvus/runtime/tasks/<taskID>/frontend-design/webpage-evidence/`.
- `frontend-research` consumes a prepared webpage evidence package. Its prompt
  says "webpage evidence root" and never treats a package implementation name as
  routing or ownership.
- `.opencorvus/.../frontend-design/webpage-evidence/` is the canonical prepared
  evidence package. Retired artifact aliases are not promoted.
- Browser capture remains host-owned infrastructure. The older
  `src/browser/webpage/extract.ts` implementation belongs to the browser
  Node sidecar / frontend-design tool boundary; agents should see only
  `webpage_*` tools and task-runtime evidence paths.

This is intentionally different from deleting the extraction implementation in
one patch. The stable boundary is the artifact contract and tool names; the
browser capture source stays under `src/browser/webpage` and tool wrappers stay
under `src/frontend-design/tools`.
