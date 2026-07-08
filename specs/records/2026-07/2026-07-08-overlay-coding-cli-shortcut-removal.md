# Overlay Coding CLI Shortcut Removal

Date: 2026-07-08
Status: Implementation record
Owner: Codex

## Recall

### User Request

The user asked to delete the CLI shortcut shown in the workspace command dock
beside the directory bar. The attached screenshot shows the split coding CLI
launcher, not the backend CLI capability.

### Acceptance Criteria

- Remove the workspace command dock coding CLI shortcut and menu from the
  Overlay UI.
- Do not delete the backend `/coding/cli/*` routes, the coding CLI discovery
  service, or the system-terminal launch capability.
- Keep the editor launcher and terminal layout controls in the same workspace
  command dock.
- Update tests so the removed shortcut cannot silently return.
- For frontend UI acceptance, run a real browser test or browser screenshot
  path that observes the workspace command dock after the deletion.

### Hard Constraints

- No fallback, compatibility alias, UI-only hiding filter, or second source.
- Preserve unrelated dirty worktree changes.
- Do not restart, refresh, kill, or otherwise disturb the user's running
  OpenCorvus / overlay processes.
- Use Node for Playwright browser tests.
- Keep specs under `specs/records/2026-07/` and update the monthly index.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-overlay-preview-cli-root-repair.md`
- `specs/records/2026-07/2026-07-06-right-toolbar-responsive-panels.md`
- `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md`
- `packages/overlay/src/components/WorkspaceCodingCliLaunchers.tsx`
- `packages/overlay/src/components/TaskDirBar.tsx`
- `packages/overlay/test/terminal.test.ts`

### Whole-Repository Search Evidence

- `rg -n "coding\\.cli|cliID|Coding CLI|coding cli|CodingCli|cliProfiles|terminalProfile|SystemTerminal|open.*cli|CLI" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.tsx"`
  found the backend coding CLI routes/services/tests and the Overlay shortcut
  component. The request is scoped to the Overlay shortcut.
- `rg -n "WorkspaceCodingCliLaunchers|workspace-coding-cli|coding_cli\\.open|coding_cli|listCodingCliProfiles|openCodingCli|coding-cli" packages/overlay/src packages/overlay/test specs/records/2026-07/README.md -g "*.ts" -g "*.tsx" -g "*.css" -g "*.json" -g "*.md"`
  found the component, its TaskDirBar mount, CSS, i18n strings, and tests.
- `rg -n "workspace-command-dock|workspace-command-divider|workspace-editor|workspace-layout|task-cwd|task-meta" packages/overlay/src/styles packages/overlay/test -g "*.css" -g "*.ts" -g "*.tsx"`
  found the command dock layout tests and style guards that need updates.

### Independent Agent Feedback

No independent sub-agent feedback was used. The change is a narrow UI deletion
with direct source and browser test coverage.

## Diagnosis

The visible shortcut is a dedicated Overlay component,
`WorkspaceCodingCliLaunchers`, mounted between the editor launcher and terminal
layout controls in `ProjectDirectoryBar`. It eagerly fetches coding CLI
profiles and terminal profiles when the active directory changes, then launches
the selected CLI through `openCodingCli`.

The backend coding CLI path is still a valid capability repaired on 2026-07-05.
Deleting the shortcut should therefore remove only the front-end affordance and
its style/i18n/test dependencies. Removing the backend route would exceed the
user request and break the single-source launch capability used by direct API
tests.

## Callpoint Inventory

| File | Current Role | Required Action |
| --- | --- | --- |
| `packages/overlay/src/components/TaskDirBar.tsx` | Mounts the workspace command dock. | Remove `WorkspaceCodingCliLaunchers` import, mount, and adjacent divider. |
| `packages/overlay/src/components/WorkspaceCodingCliLaunchers.tsx` | Implements the CLI shortcut/menu. | Delete the component file. |
| `packages/overlay/src/services/coding-cli.ts` | Frontend API client used only by the deleted shortcut. | Delete the service file while preserving backend coding CLI routes. |
| `packages/overlay/src/components/Icon.tsx` | Contains coding CLI shortcut icon definitions. | Remove shortcut-only icon names and SVG bodies. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Styles editor, CLI, terminal dock controls and CLI menu. | Remove CLI selectors and keep shared editor/terminal styles valid. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Contains shortcut labels. | Remove now-unused `coding_cli.*` labels. |
| `packages/overlay/test/browser/pane-collapse-layout.test.ts` | Browser visual/layout coverage for the command dock. | Replace presence/interaction assertions with absence assertions and layout checks for remaining controls. |
| `packages/overlay/test/browser/workspace-terminal-open.test.ts` | Browser test for terminal and coding CLI launchers. | Remove coding CLI shortcut scenarios or invert them to prove absence while keeping terminal coverage. |
| `packages/overlay/test/terminal.test.ts` | Static guard for terminal profile reload behavior. | Remove source dependency on the deleted component. |
| `packages/overlay/test/editor-brand-icons.test.ts` | CSS icon-token guard for editor and coding CLI. | Remove CLI-specific CSS expectations. |
| `packages/overlay/test/overlay-architecture-guards.test.ts` | CSS/chrome class guard. | Remove CLI class requirement. |
| `packages/overlay/test/browser/popup-contrast-matrix.test.ts` | Popup contrast sample includes CLI menu. | Remove deleted menu sample. |

## Verification Plan

- `bun test packages/overlay/test/terminal.test.ts packages/overlay/test/editor-brand-icons.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/workspace-split-launcher-primitive.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/pane-collapse-layout.test.ts packages/overlay/test/browser/workspace-terminal-open.test.ts packages/overlay/test/browser/popup-contrast-matrix.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- Manual diff review for `WorkspaceCodingCliLaunchers` / `workspace-coding-cli` leakage.
