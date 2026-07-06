# 2026-07-06 Left Extension Activity Consolidation

## Recall

- User request: the three left toolbar controls shown as wrench, package, and
  cable icons are hard to understand and unpleasant to operate.
- Acceptance criteria:
  - Replace the three separate Tool / Skill / MCP activity buttons with one
    left toolbar entry for the shared extension-management domain.
  - The new panel exposes visible text controls for Tools, Skills, and MCP
    instead of requiring users to memorize three adjacent icons.
  - Skill unmounted-count signal remains visible without creating a second
    skill source.
  - Tools, Skills, and MCP keep their existing backend sources and directory
    binding; no local fallback, compatibility route, or duplicate projection
    list is added.
  - The old `tool`, `skill`, and `mcp` left activity IDs are deleted from the
    left activity shell rather than kept as hidden aliases.
  - Frontend validation includes focused tests plus a real rendered overlay
    screenshot reviewed after the change.
- Hard constraints:
  - No fallback, compatibility branch, hidden gate, or second source.
  - Do not restart, refresh, kill, or otherwise interfere with the user's
    running OpenCorvus / overlay process; use isolated browser test fixtures.
  - Playwright validation on Windows must use Node, not Bun.
  - Existing dirty worktree changes are treated as user/project state and must
    not be reverted.
  - Code changes require focused tests.
- Sources read:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `specs/current/architecture/07-panel.md`
  - `specs/records/2026-07/2026-07-05-tool-skill-mcp-vertical-panel-repair.md`
  - `specs/records/2026-06/2026-06-17-skill-mcp-panel-single-source.md`
  - `packages/overlay/src/main.tsx`
  - `packages/overlay/src/index.html`
  - `packages/overlay/src/components/SideActivityToolbar.tsx`
  - `packages/overlay/src/components/settings/SkillMarketPanel.tsx`
  - `packages/overlay/src/components/ui/SegmentedControl.tsx`
  - `packages/overlay/src/components/Icon.tsx`
  - `packages/overlay/src/styles/surfaces/activity.css`
  - `packages/overlay/src/i18n/en-US.json`
  - `packages/overlay/src/i18n/zh-CN.json`
  - `packages/overlay/test/left-activity-toolbar.test.ts`
  - `packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts`
- Whole-repository search evidence:
  - `rg -n 'leftPanelTools|leftPanelSkills|leftPanelMcp|data-activity="tool"|data-activity="skill"|data-activity="mcp"|id: "tool"|id: "skill"|id: "mcp"|sidebar-tool|skillButton|mcpButton' packages/overlay/src packages/overlay/test specs/records/2026-07 specs/records/2026-06 specs/current`
  - `rg -n 'side-activity|SideActivityToolbar|data-activity|leftActivities|rightActivities|activity\.tooltip|activity\.' packages/overlay/src packages/overlay/test specs/current specs/records/2026-07 specs/records/2026-06`
- Independent agent feedback:
  - None used for this focused UI repair; no user request for subagents.

## Plan

1. Replace left activity type values `tool`, `skill`, and `mcp` with a single
   `extensions` activity and one `leftPanelExtensions` body.
2. Export a compact `ExtensionActivityPanel` from the extension settings module.
   It uses the existing segmented-control primitive to switch among Tools,
   Skills, and MCP with visible labels and a Skill badge.
3. Mount only the consolidated extension panel in `main.tsx`. Keep each child
   panel active only when its visible segment is selected so inactive routes do
   not load their data.
4. Rename compact side-panel CSS from `sidebar-tool-panel` to
   `sidebar-extension-panel` and style the segmented control/header as the
   single outer navigation for this resource domain.
5. Update i18n keys and tests to assert the deleted old activity IDs and the
   new consolidated activity shape.
6. Run targeted unit/static tests, browser fixture tests through Node, typecheck,
   i18n check, docs link validation for the new spec, and inspect the generated
   screenshot before final review.
