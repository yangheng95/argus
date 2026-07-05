# Tool Skill MCP Vertical Panel Repair

## Recall

User request:

- The Tool / Skill / MCP toolbar panel layout is unacceptable because a requested vertical layout still contains an internal horizontal layout.
- The panel is too narrow to operate comfortably.
- The Tool / Skill / MCP panels must be fully vertical.
- Clicking an agent tab must collapse or expand that agent section.
- The panel layout must be adjustable by dragging.
- The Skill pool currently does not show every available skill, and refresh does not recover the missing entries.

Acceptance criteria:

- The compact Tool / Skill / MCP panels use a single-column vertical flow: agent tabs appear above their detail section, not beside it.
- Clicking an already-open agent tab collapses the detail; clicking a collapsed or different tab expands that detail.
- The existing left-pane resizer remains the only drag-adjustment mechanism for the toolbar panel width, and browser coverage proves it still works while the Skill panel is open.
- The Skill pool renders the authoritative skill matrix returned by `/skill/mounts`; it must not maintain a separate UI fallback list or try to recover missing skills locally.
- The missing-skill issue is verified against the existing backend skill-projection repair record and focused tests instead of adding a second projection source in the overlay.
- The repair has real browser screenshots reviewed through Playwright / Node, not only lint, typecheck, DOM text, or screenshot filenames.

Hard constraints retained:

- No fallback, compatibility branch, hidden gate, second skill source, or UI-only recovery path.
- No process restart, refresh, kill, or interference with the user's running OpenCorvus / overlay instance.
- Playwright browser validation on Windows must be launched through Node, not Bun.
- Any code change must include focused tests.
- Specs and implementation records stay under `specs/`.

Sources read before implementation:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`
- `specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/src/styles/surfaces/activity.css`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/SideActivityToolbar.tsx`
- `packages/overlay/src/services/extensions.ts`
- `packages/overlay/test/browser/expert-squad-panel.test.ts`
- `packages/overlay/test/browser/skill-mcp-panel-browser.test.ts`
- `packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`
- `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- `packages/overlay/test/browser/left-pane-resizer-browser.test.ts`
- `packages/overlay/test/browser-runner.mjs`

Whole-repository search evidence:

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\\.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection" ...`
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" ...`
- `rg --files .opencorvus/expert-squads ... | sort`
- `rg -n "Projected Tool Pool|BUILT-IN TOOLS|tool pool|Tool Pool|skill|MCP|mcp|active_skill_projection|Skill Pool|skill pool|available skill|projected" ...`
- `rg -n "agent-capability|agent-skill|capability-pool|tool-panel-toolbar|extension-settings-group|extension-settings-body|skill-mcp|tool panel|right toolbar|sidebar" ...`
- `rg -n "leftPanel|side-activity|sidebar-tool-panel|data-activity|leftPanelTools|leftPanelSkills|leftPanelMcp" ...`
- `rg -n "renderCapabilityAgentTabs|activeCapabilityAgent|activeSkillAgent|agent-capability-layout|agent-skill-tab-layout|agent-skill-pool|capability-pool" packages/overlay/src/components/settings/SkillMarketPanel.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/src/styles/surfaces/activity.css packages/overlay/test/browser -g "*.ts" -g "*.tsx"`

Findings:

- `SkillMarketPanel.tsx` currently defaults both capability and skill agent detail views to the first available agent. This makes every Tool / Skill / MCP compact panel auto-expanded and prevents a real collapsed state.
- `renderCapabilityAgentTabs()` renders a tab list and detail section as siblings inside `.agent-capability-layout`; CSS turns that layout into two grid columns.
- The Skill panel repeats the same two-column pattern through `.agent-skill-tab-layout`.
- The compact left toolbar panel already has a left-pane resizer in `main.tsx`; adding a second resize mechanism would create a duplicate control source. The correct repair is to keep that resizer and prove it works for this panel.
- The backend skill-projection completeness record already repaired missing skills at `PromptProfileResolver.resolveSkillProjection()`, with `/skill/mounts`, `SkillTool`, catalog `active_skill_projection`, and system prompt rendering sharing one projection surface. The overlay should trust that matrix and not invent a local fallback.

Independent agent feedback:

- None used for this focused UI repair.

## Repair Plan

1. Change the Tool / Skill / MCP agent selection state from "always first row" to "explicitly open or collapsed". Existing selected agents remain selected only while still present in the returned matrix.
2. Make clicking the selected tab clear the active agent, while clicking any inactive tab opens that agent.
3. Scope the vertical layout to compact Tool / Skill / MCP panels so the left toolbar stops using the horizontal grid. The tab strip, detail, pool, and configured MCP sections should stack and let the panel body scroll.
4. Preserve the existing left-pane resizer as the only width adjustment control and add browser coverage that it changes panel width while Skill is open.
5. Update browser tests to assert vertical geometry, collapse / expand semantics, skill-pool row visibility, and real screenshot output.
6. Re-run focused backend skill projection tests to verify the reported missing-skill class remains fixed at the single backend source.

## Validation Plan

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/tool/skill.test.ts`
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check -- packages/overlay/src/components/settings/SkillMarketPanel.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/src/styles/surfaces/activity.css packages/overlay/test/browser/skill-mount-matrix-browser.test.ts packages/overlay/test/browser/side-activity-toolbar-browser.test.ts specs/records/2026-07/README.md specs/records/2026-07/2026-07-05-tool-skill-mcp-vertical-panel-repair.md`

## Validation Results

- `git diff --check -- packages/overlay/src/components/settings/SkillMarketPanel.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/src/styles/surfaces/activity.css packages/overlay/test/browser/skill-mount-matrix-browser.test.ts packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts specs/records/2026-07/README.md specs/records/2026-07/2026-07-05-tool-skill-mcp-vertical-panel-repair.md` passed.
- `bun run --cwd packages/overlay typecheck` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mount-matrix-browser.test.ts packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts` passed: 5 pass, 0 fail.
- Browser screenshots reviewed manually: `.scratch/left-tool-panel.png`, `.scratch/left-skill-panel.png`, and `.scratch/left-mcp-panel.png` show a vertical agent tab stack, expanded detail below the selected tab list, and vertically reachable pools.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/tool/skill.test.ts` passed: 105 pass, 1 skip, 0 fail, 659 `expect()` calls.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass, 0 fail, 66 `expect()` calls.
