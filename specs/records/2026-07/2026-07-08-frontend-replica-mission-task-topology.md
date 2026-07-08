# Frontend Replica Mission Task Topology

## Recall

User correction:

- The repeated `frontend-research` behavior is an expert-squad configuration bug, not merely a single-task execution mistake.
- The intended frontend replica shape is not one task implementing every page.
- A multi-page or page-family clone must create multiple Mission-owned tasks: first a serial template task, then parallel subpage tasks that consume the template.
- Inspect and repair the erroneous expert-squad configuration.

Acceptance criteria:

- The frontend-replica expert squad must explicitly override the generic Mission batching default for multi-page or page-family replica work.
- Mission must create a prerequisite template/source-baseline task before subpage implementation tasks.
- Subpage tasks may run in parallel only after the template task is terminal and only when they own disjoint page/subpage scopes, files, and acceptance surfaces.
- A single subpage task still uses the normal workflow and Architect component-per-goal decomposition.
- `subpage_research_tasks` and similar evidence-gap packets must not cause same-task repeated `frontend_research` loops after a valid task-scope research artifact exists.
- The change must not reintroduce `frontend_design` as a normal workflow stage after the 2026-07-07 disconnect. Template creation is a Mission task topology concept, not a second workflow engine.

Hard constraints:

- No fallback, compatibility alias, host-side gate, second active profile field, or package-owned workflow engine.
- Keep `PromptProfileResolver` as the only active expert-squad projection surface.
- Do not change the global Mission default unless frontend-replica-specific evidence proves a generic rule is wrong.
- Do not create a new worktree or interfere with running OpenCorvus / overlay processes.
- Use `specs/records/2026-07/` as the only new record location and update the monthly index.
- Update generated expert-squad payload if package source prompts change.

Sources read:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-02-frontend-replica-workflow-goal-discipline.md`
- `specs/records/2026-07/2026-07-07-frontend-replica-frontend-design-disconnect.md`
- `specs/records/2026-07/2026-07-07-unified-scheduler-dispatch-tool.md`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `.opencorvus/expert-squads/builtin/frontend-replica/README.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/selector.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/mission/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/orchestrator/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/requirements/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/architect/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/frontend-design/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/frontend-research/system.md`
- `.opencorvus/expert-squads/builtin/frontend-replica/agents/build/system.md`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`

Whole-repository search evidence:

- `rg -n "subpage_research_tasks|frontend_design|frontend-design|frontend_research|frontend-research|create_task|panel\\.create_task|parallel|template|skeleton|source project|web-clone" .opencorvus/expert-squads/builtin/frontend-replica packages/opencorvus/src/prompt packages/opencorvus/src/build packages/opencorvus/src/engine packages/opencorvus/src/expert-squad packages/opencorvus/test specs/current specs/records/2026-07 -g "*.md" -g "*.txt" -g "*.ts" -g "*.tsx" -g "*.jsonc"` showed the existing frontend-replica package emphasizes per-goal component decomposition and repeated-agent avoidance, but has no Mission-level template-then-subpage task topology rule.
- `Select-String packages/opencorvus/src/prompt/core/mission-core.txt -Pattern "TASK GRANULARITY","panel.create_task","parallel","single self-contained","independent"` showed the global Mission default says to bundle related frontier items into one request and let Architect split goals unless split cause is explicit.
- `rg -n "frontend-replica|Frontend Replica|mission|selector|frontend_design|frontend-design|frontend_research|subpage|template|goal" packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts` showed the focused frontend-replica prompt test currently does not load the `mission` overlay and therefore could not catch the missing Mission topology.
- `rg -n "generate-expert-squad-payload|payload.ts|expert-squad.*payload" package.json packages/opencorvus/package.json packages/opencorvus/script packages/opencorvus/src/expert-squad -g "*.ts" -g "*.json"` showed `packages/opencorvus/src/expert-squad/payload.ts` is generated from `.opencorvus/expert-squads/<namespace>/<id>/` and must be regenerated when package prompts change.

Runtime evidence from the cancelled task:

- Task `tsk_f4123ee04001SBYBuD7fJryia1` was Mission-owned (`metadata.actor=mission`) and used active profile `frontend-replica`.
- It created a single workflow task titled `Phase 01: Audit Repair Futures Clone`, produced no goals, and repeated `frontend_research` three times.
- The Orchestrator text after the first research artifact said it was dispatching fresh source-page investigations for open gaps such as the quotes anchor, so advisory subpage packets became same-task research redispatches instead of Mission-level future task scopes.

## Diagnosis

The root problem is a missing frontend-replica Mission topology rule.

Global Mission core is intentionally conservative: it batches related frontier items into one engine task and delegates internal decomposition to the executor Architect. That is correct for most tasks. It is wrong for page-family replica missions where the shared template/source baseline is a prerequisite and each subpage should become an independent acceptance unit after that prerequisite is terminal.

The frontend-replica package currently defines source evidence, component-per-goal decomposition, desktop-only scope, and repeated-agent avoidance. Its Mission overlay only says to track progress by user-visible component or region. That pushes the model toward one page-level workflow task with many goals, but it never tells Mission to create:

1. a serial template/source-baseline task;
2. then separate subpage/page tasks after the template artifact exists;
3. parallel only when those subpage tasks are independent.

The 2026-07-07 frontend-design disconnect adds an important boundary: the fix must not restore `frontend_design` as the normal frontend-replica workflow stage. The "template task" is a Mission-dispatched engine task that can ask the normal workflow to produce or repair shared source/template assets and implementation contracts. It is not a package-owned workflow, hidden second pipeline, or automatic `frontend_design` stage.

## Plan

1. Strengthen `.opencorvus/expert-squads/builtin/frontend-replica/agents/mission/system.md` with a frontend-replica-specific task topology:
   - single-page tasks may remain one workflow task with component-per-goal Architect decomposition;
   - multi-page/page-family/subpage missions must first dispatch one serial template/source-baseline task;
   - parallel subpage tasks start only after the template task is terminal and must cite the template artifact path and ownership boundaries.
2. Update `.opencorvus/expert-squads/builtin/frontend-replica/selector.md` and `README.md` so the visible expert contract contains the same Mission-level topology and does not present goal decomposition as the only granularity boundary.
3. Update `.opencorvus/expert-squads/builtin/frontend-replica/agents/orchestrator/system.md` to stop same-task `frontend_research` redispatch from `subpage_research_tasks` packets after a valid research artifact exists. It should either consume the packets downstream, fail the current task if scope is invalid, or propose separate Mission-visible follow-up scope with evidence.
4. Extend `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts` to load the Mission overlay and assert the template-then-subpage topology, parallel independence rule, and no same-task subpage research redispatch rule.
5. Regenerate `packages/opencorvus/src/expert-squad/payload.ts`.
6. Validate with focused prompt tests, docs link tests, generated payload consistency, typecheck if generated TypeScript changes, and `git diff --check`.

## Validation Targets

- `bun -e "...runProcessWithInactivityTimeout(... bun run packages/opencorvus/script/generate-expert-squad-payload.ts ...)"`
- `bun -e "...runProcessWithInactivityTimeout(... bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts ...)"`
- `bun -e "...runProcessWithInactivityTimeout(... bun test packages/opencorvus/test/script/historical-docs-links.test.ts ...)"`
- `bun -e "...runProcessWithInactivityTimeout(... bun run --cwd packages/opencorvus typecheck ...)"`
- `git diff --check`
