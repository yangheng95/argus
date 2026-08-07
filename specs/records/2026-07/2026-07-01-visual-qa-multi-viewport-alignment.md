# Visual QA Multi-Viewport Alignment Check

Date: 2026-07-01

## Recall

User request:

- Add a Visual QA check item for multi-viewport alignment.

Acceptance criteria:

- Visual QA has a first-class `multi-viewport-alignment` check category.
- If a Visual QA report actually covers more than one distinct viewport, the report must register a `multi-viewport-alignment` check item.
- The multi-viewport alignment check must itself cite at least two distinct viewports and have coverage tied to that check.
- Prompt instructions must not expand ordinary desktop-only replica / clone tasks into tablet/mobile validation; multi-viewport alignment applies only when the current task explicitly authorizes multi-viewport / responsive / multi-end scope or Visual QA actually inspects multiple viewports.
- Tests cover rejection without the check item and acceptance with the check item.

Hard constraints:

- Preserve the existing dirty `packages/opencorvus/src/provider/models-snapshot.ts` change; it is unrelated.
- No fallback, no dual source, no host lifecycle gate, no new worktree, no process restart.
- Update tests with the code change.

Sources read:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-01-review-item-registration-tools.md`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/visual-qa/agent.ts`
- `packages/opencorvus/src/visual-qa/schema.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/test/visual-qa/output-tools.test.ts`
- `packages/opencorvus/test/visual-qa/agent.test.ts`
- `packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts`

Whole-repository search evidence:

- `rg -n "multi.*viewport|viewport.*align|alignment|check_items|check item|VisualQaCheck|category|viewports" packages/opencorvus/src/visual-qa packages/opencorvus/test/visual-qa specs/records/2026-07 specs/current/architecture -g "*.ts" -g "*.md"`
- `rg -n "VisualQaCheck|VisualQa.*Schema|check_items|register_visual_qa_check_item|category" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "VisualQaAgent\\.analyze|referenceParityRequired|requiredReferenceRegions|visual.*qa" packages/opencorvus/src/orchestrator packages/opencorvus/src -g "*.ts"`
- `rg -n "buildVisualQaUserPrompt|VisualQaTestHooks|multi|viewport" packages/opencorvus/test/visual-qa packages/opencorvus/test -g "*.ts"`

Independent agent feedback:

- Not requested for this narrow Visual QA check-category change.

## Decision

Use one explicit category string, `multi-viewport-alignment`, exported from the Visual QA schema module and consumed by the output tool graph validation and prompt tests.

The graph validator will derive whether a submitted report is multi-viewport from registered check items, coverage rows, evidence rows, and DOM problem regions. When more than one distinct numeric viewport appears, final submission requires a `multi-viewport-alignment` check item and a coverage row for that check with at least two distinct viewports.

This does not add tablet/mobile review to desktop-only clone tasks. It only makes multi-viewport work explicit when the task or evidence already brought multiple viewports into scope.

## Validation Plan

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
