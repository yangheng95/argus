# Frontend Replica Workflow Goal Discipline

Date: 2026-07-02

## Recall

User request:

- `更新前端复刻的专家团skill，前端复刻是workflow类型的任务，除了重试之外，一般不回头调用已经执行过的agent，build，integrity和visual qa除外。如果用户没有说明，则补充指令需要一个一个组件复刻，禁止几个组件混入一个goal，一般需要10个以上的goal。`

Acceptance criteria:

- The frontend-replica expert-squad skill must explicitly classify frontend replica work as a `workflow` / `pipeline` task.
- The skill must tell Orchestrator to advance through already recorded evidence instead of calling already executed agents again, except for explicit retry and the ordinary repair/review surfaces: Build, Integrity, and Visual QA.
- The default goal decomposition must be one source component or region per goal, not multiple components mixed into one goal.
- If the operator does not specify goal granularity, normal webpage replica decomposition should expect at least 10 goals.
- The change must preserve existing desktop-only, browser preview ownership, blank-filler geometry, and source-evidence contracts.
- Add focused regression tests for the skill/prompt contract and run docs index validation.

Hard constraints:

- No fallback, no compatibility path, no host-side gate, and no new workflow branch.
- Do not copy workflow mechanics into role overlays that tests intentionally keep role-scoped.
- Do not touch unrelated dirty worktree content, especially `packages/opencorvus/src/provider/models-snapshot.ts`.
- Do not create a worktree or interfere with running OpenCorvus / overlay processes.
- Specs remain under the root `specs/` tree and must update the monthly README.

Sources read:

- `C:/Users/chuan/.codex/skills/.system/skill-creator/SKILL.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/artifacts/tv2ainvest.md`
- `specs/records/2026-06/2026-06-29-frontend-replica-tool-ownership-prompt.md`
- `specs/records/2026-06/2026-06-30-thick-expert-squad-prompts.md`
- `specs/records/2026-07/2026-07-01-frontend-replica-requirements-webpage-generation.md`
- `specs/records/2026-07/2026-07-01-frontend-replica-desktop-adaptive-viewports.md`
- `specs/records/2026-07/2026-07-01-frontend-replica-blank-filler-geometry.md`
- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`

Whole-repository search evidence:

- `rg -n "frontend-replica|frontend replica|webpage-replica|前端复刻|复刻|expert squad|专家团" packages/opencorvus/src packages/opencorvus/test specs -g '!**/models-snapshot.ts' -g '!**/node_modules/**'`
- `rg --files packages/opencorvus/src packages/opencorvus/test specs | rg "frontend|replica|skill|webpage"`
- `rg -n "frontend-replica|frontend replica|replica expert|expert-squad|select_expert_squad|workflow|pipeline|frontend_research|frontend_design|visual_qa|integrity|component-per-goal|one-goal-per-component|one accountable goal|goal" packages/opencorvus/src/skill packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src/prompt/core packages/opencorvus/src/engine/workflow.ts packages/opencorvus/test/agent packages/opencorvus/test/engine -S`
- `rg -n "workflow|pipeline|frontend_research|frontend_design|rerun|re-run|not repeatable|already persisted|same source|component-per-goal|goal" specs/current/architecture/18-webpage-replica-agent-workflow.md specs/records/2026-07/2026-07-01-frontend-replica-requirements-webpage-generation.md specs/records/2026-07/2026-07-01-frontend-replica-desktop-adaptive-viewports.md specs/records/2026-07/2026-07-01-frontend-replica-blank-filler-geometry.md specs/records/2026-06/2026-06-30-thick-expert-squad-prompts.md specs/records/2026-06/2026-06-29-frontend-replica-tool-ownership-prompt.md -S`
- `rg -n "do not rerun|do not re-run|re-run requirements|re-run architect|frontend_design|frontend_research|Plan closure|fixed lifecycle|not repeatable repair tools|same-graph repair|visual QA|Integrity" packages/opencorvus/src/prompt/core/orchestrator-core.txt packages/opencorvus/test/agent/core-prompt-hygiene.test.ts -S`
- `rg -n "skill\\.ts|frontend-replica-expert-squad|frontendReplicaExpertSquad|mounted_agents|required_tools|agents:" packages/opencorvus/src/skill packages/opencorvus/test/skill packages/opencorvus/test/tool packages/opencorvus/test/agent -S`

Independent agent feedback:

- Not spawned. The available sub-agent tool policy only permits spawning when the user explicitly asks for sub-agents, delegation, or parallel agent work; this task is a focused skill/prompt contract update and did not include that authorization.

## Finding

The durable architecture already says webpage replica work is a `pipeline`
workflow. The core Orchestrator prompt already discourages repeated
`frontend_research` / `frontend_design` loops and routes ordinary refinements
through downstream agents using persisted artifacts. The frontend-replica
skill, however, does not state the stricter domain-specific default the user is
asking for: one-way workflow progression, no repeated already executed agents
except retry / Build / Integrity / Visual QA, and default component-per-goal
decomposition with at least 10 goals for normal webpage replicas.

The right single source for this user-facing expert-squad rule is
`packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`.
`PromptProfile.builtIns["frontend-replica"]` can carry the goal granularity
discipline for Architect/Orchestrator, but broad workflow mechanics must stay
out of generic role overlays because `prompt-profile.test.ts` intentionally
rejects workflow-wrapper text in overlays.

## Implementation Plan

1. Add a Workflow progression section to the frontend-replica expert-squad skill.
2. Add a Goal decomposition section to the same skill, preserving existing
   desktop-only, browser-preview, and blank-filler sections.
3. Strengthen the frontend-replica Architect and Orchestrator overlays only
   where they can carry role-owned goal granularity without workflow mechanics.
4. Add regression assertions in `frontend-replica-desktop-only.test.ts` and
   `prompt-profile.test.ts`.
5. Run focused prompt tests, docs link validation, `git diff --check`, and
   self-review before commit/push.

## Implementation Notes

- Updated `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
  to state that frontend replica is a workflow / pipeline task, not a direct
  single Build task.
- Added skill guidance that already executed task-scope agents should not be
  called again for another angle once valid artifacts exist. The explicit
  exceptions are failed/incomplete retry, Build implementation or repair,
  Visual QA review/re-review, and Integrity review/re-review after repair.
- Added default goal decomposition guidance: one source component or meaningful
  source region per goal, no multi-component or whole-page Build goals, and
  normal webpage replicas generally need 10 or more goals unless source
  evidence proves fewer meaningful components.
- Updated only the frontend-replica Architect and Orchestrator overlays with
  role-owned goal granularity guidance. Broad workflow mechanics remain in the
  Orchestrator skill, not in every role overlay.
- Left `packages/opencorvus/src/provider/models-snapshot.ts` untouched because
  it was an unrelated pre-existing dirty file.

## Validation Results

- `bun -e "...runProcessWithInactivityTimeout(... bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts ...)"`: 25 pass, 0 fail.
- `bun -e "...runProcessWithInactivityTimeout(... bun test packages/opencorvus/test/script/historical-docs-links.test.ts ...)"`: 19 pass, 0 fail.
- `bun -e "...runProcessWithInactivityTimeout(... bun run --cwd packages/opencorvus typecheck ...)"`: passed (`tsc --noEmit`).
- `git diff --check`: passed.

Self-review:

- The skill frontmatter still mounts only to Orchestrator and still requires
  only `select_expert_squad`.
- Existing desktop-only, browser preview ownership, blank-filler geometry, and
  source-evidence assertions remain in place.
- The role-overlay pressure test still passes, confirming the update did not
  add forbidden workflow-wrapper mechanics to role overlays.
