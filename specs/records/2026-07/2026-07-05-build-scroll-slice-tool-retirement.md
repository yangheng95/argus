# 2026-07-05 Remove build-agent scroll-slice screenshot tool

## Recall

User request:

- `把逐屏滚动截屏从build agent的工具删掉`

Acceptance criteria:

- Build agent no longer exposes `browser_preview_compare_scroll_slices` in its visible tool surface or resolved tool registry.
- Build core prompt and frontend-replica Build overlay stop instructing Build to call the retired scroll-slice comparison tool.
- Visual QA keeps `browser_preview_compare_scroll_slices`; this is a build-only retirement, not a global tool deletion.
- Architecture/docs/tests reflect the new ownership split: Build keeps module binding plus ordinary screenshots, Visual QA keeps scroll-slice supporting `visual_diff`.
- No fallback alias, compatibility wrapper, or hidden replacement path is introduced for Build.

Hard constraints:

- Do not retire `browser_preview_compare_scroll_slices` globally.
- Do not revert or overwrite unrelated dirty workspace changes.
- Keep the single-source tool contract: remove the Build exposure itself instead of only changing prose.
- Any code/doc change must ship with focused verification.

Sources read:

- `specs/README.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/17-agent-team-infrastructure.html`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-04-retire-url-screenshot.md`
- `specs/records/2026-06/2026-06-29-remove-region-diff-agent-tool.md`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `.opencorvus/expert-squads/frontend-replica/agents/build/system.md`
- `.opencorvus/expert-squads/frontend-replica/agents/orchestrator/system.md`
- `packages/opencorvus/test/agent/agent.test.ts`
- `packages/opencorvus/test/tool/browser-preview.test.ts`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts`
- `packages/opencorvus/test/build-agent/external-system.test.ts`

Whole-repository search evidence:

- `rg -n "compare_scroll_slices|scroll_slices|screen-by-screen|first-viewport|page-slice visual_diff|browser_preview_reference_regions" packages/opencorvus/src packages/opencorvus/test .opencorvus specs/current specs/records/2026-07 -g "*"`
- `rg -n "browser_preview_compare_scroll_slices" packages/opencorvus/src packages/opencorvus/test .opencorvus specs/current -g "*.ts" -g "*.txt" -g "*.md" -g "*.html"`
- `git diff -- packages/opencorvus/src/agent/tool-pool-contract.ts packages/opencorvus/src/agent/agent.ts packages/opencorvus/src/prompt/core/build-core.txt .opencorvus/expert-squads/frontend-replica/agents/build/system.md .opencorvus/expert-squads/frontend-replica/agents/orchestrator/system.md specs/current/architecture/17-agent-team-infrastructure.html specs/records/2026-07/README.md packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/tool/browser-preview.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/build-agent/external-system.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts`

Independent agent feedback:

- None. The current task is a scoped tool-surface retirement; direct code inspection plus whole-repository grep is sufficient, and the user did not request parallel subagent review.

## Decision

Retire `browser_preview_compare_scroll_slices` from the Build role only.

The single source of Build tool exposure is `AgentToolPool.roleAssignments.build.private`. Build keeps `browser_preview_reference_regions` for one module-binding comparison and ordinary Browser MCP screenshot/observe inspection when that toolset is exposed. Scroll-slice supporting `visual_diff` remains a Visual QA responsibility.

## Implementation Plan

1. Remove `browser_preview_compare_scroll_slices` from the Build private tool list while keeping the shared loader for Visual QA.
2. Rewrite Build-facing prompts/overlays so Build no longer claims first-viewport or screen-by-screen scroll-slice work.
3. Update frontend-replica orchestration wording and current architecture docs to reflect the ownership split.
4. Update tests to assert Build absence and Visual QA retention.

## Verification Plan

- `bun test packages/opencorvus/test/agent/agent.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/build-agent/external-system.test.ts --timeout 30000`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 30000`
- `bun run --cwd packages/opencorvus typecheck`

## Final Validation Results

- `bun test packages/opencorvus/test/agent/agent.test.ts --timeout 30000` passed: 68 pass, 0 fail.
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 30000` passed: 19 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 30000` passed: 22 pass, 0 fail.
- `bun test packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/build-agent/external-system.test.ts --timeout 30000` passed: 15 pass, 0 fail.
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts --timeout 30000` passed: 15 pass, 0 fail.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 30000` passed: 66 pass, 0 fail.
- `bun run --cwd packages/opencorvus typecheck` passed.
