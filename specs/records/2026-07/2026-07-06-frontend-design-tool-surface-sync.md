# Frontend Design Tool Surface Sync

Date: 2026-07-06

## Recall

User request:

- Diagnose and fix why task `tsk_f35383534001EfPelzeSfvvgNv` did not produce a `frontend-design` agent session for a TradingView futures page replica task.
- The live task debug showed the task was a frontend replica with source URL evidence, per-component goals, and strict no-fallback visual acceptance requirements.

Acceptance criteria:

- `frontend_design` can start with the current runtime tool surface when `update_frontend_visual_region_binding` is exposed.
- Static frontend-design session tool IDs and runtime submit tools stay synchronized by a regression test.
- The fix does not add fallback, aliases, gates, or a second tool surface authority.
- The repair record remains under `specs/records/2026-07/` and is indexed by the July records README.

Hard constraints:

- No fallback or compatibility path. A mismatched tool surface must remain a hard error.
- Do not reset, revert, or overwrite unrelated dirty worktree changes.
- Do not restart or refresh a running OpenCorvus or overlay process.
- Do not create a new worktree.
- Code changes must have focused tests.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-frontend-replica-goal-bound-reference-crops.md`
- `packages/opencorvus/src/frontend-design/static-tools.ts`
- `packages/opencorvus/src/frontend-design/agent.ts`
- `packages/opencorvus/src/frontend-design/output-tools.ts`
- `packages/opencorvus/test/frontend-design/prompt.test.ts`

Whole-repository search evidence:

- `rg -n "frontend-design|frontend_design|frontend design|frontendDesign|design" packages specs .opencorvus -g '!node_modules'`
- `rg -n "runtime tool surface diverged|tool surface diverged|update_frontend_visual_region_binding|frontend_design|frontend-design" packages/opencorvus/src packages/opencorvus/test .opencorvus -g '!node_modules'`
- `rg -n "FRONTEND_DESIGN_SESSION_TOOL_IDS|update_frontend_visual_region_binding|runtime tool surface diverged" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 -g '!node_modules'`

Independent agent feedback:

- Not used for this narrow tool-surface repair. The live database evidence and repository callpoint inventory were enough to prove the cause.

## Evidence

The task did select `frontend-replica` and projected `frontend_design` into the scheduler tool surface. The live `part` rows showed two `frontend_design` calls, both failing before a child session was created:

```text
frontend-design runtime tool surface diverged from static definition:
missing=[] extra=[update_frontend_visual_region_binding]
```

The direct code path is:

- `packages/opencorvus/src/frontend-design/output-tools.ts` defines `update_frontend_visual_region_binding`.
- `packages/opencorvus/src/frontend-design/agent.ts` includes `update_frontend_visual_region_binding` in `createFrontendSubmitTools`.
- `packages/opencorvus/src/frontend-design/agent.ts` compares the composed runtime tools against `FRONTEND_DESIGN_SESSION_TOOL_IDS`.
- `packages/opencorvus/src/frontend-design/static-tools.ts` omitted `update_frontend_visual_region_binding` from `FRONTEND_DESIGN_SESSION_TOOL_IDS`, so the strict surface check correctly rejected the runtime surface as divergent.

The deeper issue was not missing expert-squad projection. The expert squad was selected and the tool was called. The failure was a stale static frontend-design session tool list after the visual region binding submit tool was added.

## Repair Plan

1. Add `update_frontend_visual_region_binding` to `FRONTEND_DESIGN_SESSION_TOOL_IDS`.
2. Add a regression test that every incremental frontend submit tool exposed by `createFrontendSubmitTools(createFrontendTemplateOutputTools())` is listed in `FRONTEND_DESIGN_SESSION_TOOL_IDS`.
3. Keep the existing strict runtime-vs-static assertion. It is a data-integrity constraint, not a fallback or gate.
4. Run focused frontend-design and frontend-replica tests plus docs link validation and `git diff --check`.

## Verification Plan

- `bun test packages/opencorvus/test/frontend-design/prompt.test.ts`
- `bun test packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts`
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
