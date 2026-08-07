# Frontend Replica Desktop Adaptive Viewports

Date: 2026-07-01

## Recall

User request:

- "与没有告诉前端复刻专家团需要多viewport检查桌面自适应/响应式布局，但不需要考虑非桌面版本？"

Acceptance criteria:

- The frontend-replica expert squad must distinguish desktop adaptive viewport checks from tablet/mobile/non-desktop migration.
- Requirements and Architect must be allowed to keep explicitly requested desktop-width adaptation inside the desktop replica scope.
- Build and Visual QA must be instructed to verify scoped desktop-width layout behavior with multiple desktop-class viewports when the current desktop contract requires it.
- Default frontend replica scope must still not create tablet/mobile/non-desktop requirements, goals, screenshots, blockers, or acceptance.
- Tests must assert the distinction so future prompt edits do not collapse desktop adaptive checks back into non-desktop scope.

Hard constraints:

- No fallback or parallel prompt source.
- Do not broaden ordinary desktop-only replica tasks into tablet/mobile work.
- Do not touch unrelated dirty files, especially `packages/opencorvus/src/provider/models-snapshot.ts`.
- Prompt changes need focused tests and docs index validation.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-26-frontend-replica-desktop-only-decision-surface.md`
- `specs/records/2026-06/2026-06-30-thick-expert-squad-prompts.md`
- `specs/records/2026-07/2026-07-01-visual-qa-multi-viewport-alignment.md`
- `specs/records/2026-07/2026-07-01-frontend-replica-requirements-webpage-generation.md`
- `specs/records/2026-07/2026-07-01-expert-squad-concrete-prompts.md`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
- `packages/opencorvus/src/prompt/core/requirements-core.txt`
- `packages/opencorvus/src/prompt/core/architect-core.txt`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`

Whole-repository search evidence:

- `rg -n "前端复刻|复刻|clone|parity|frontend.*expert|expert.*frontend|expert squad|专家|viewport|desktop|mobile|tablet|responsive|响应式|自适应|visual QA|visual_qa" specs packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test -S`
- `rg -n "frontend-replica|desktop-only|desktop|viewport|responsive|multi-viewport|tablet|mobile|Requirements|Visual QA|Build|webpage-generation|桌面|响应式|自适应" packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/test/agent packages/opencorvus/src/skill/builtin packages/opencorvus/src/prompt/core -S`
- `rg -n "desktop only|desktop-only|tablet/mobile|non-desktop|responsive|multi-end|viewport|constrained|narrow|Visual QA|Build|Requirements" packages/opencorvus/src/prompt/core/*.txt packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md -S`

Independent agent feedback:

- Not used; this is a narrow prompt contract correction and the current tool policy does not expose sub-agent spawning unless explicitly requested.

## Finding

The existing prompt surfaces correctly prevent default tablet/mobile work, but they conflate scoped desktop-width adaptation with non-desktop responsive migration. `visual-qa-core.txt` especially says constrained/narrow viewports require non-desktop authorization, which can make agents skip desktop-class layout checks such as wide desktop, standard desktop, and constrained desktop widths.

## Decision

Keep the desktop-only default, but define desktop adaptive viewport checks as an allowed desktop verification surface when the current user request, reference evidence, or frontend design contract explicitly names desktop width scaling, overflow, wrapping, gutters, sticky controls, or layout stability across desktop-class widths.

Do not introduce tablet/mobile work. The allowed viewport set is desktop-class only; non-desktop viewports remain a separate current multi-end migration scope.

## Validation Plan

- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
