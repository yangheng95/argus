# Left Dock direct launch and alignment

## Recall

### User requirements

- Correct the visible component alignment shown in the supplied OpenCorvus screenshot.
- Project headings directly below `Chats` and `Projects` must not have an extra indentation.
- Preserve the indentation of every deeper Mission, Chat, Work, and Task level.
- Add `New mission` immediately below `New chat` in the left Dock.
- `New chat` and `New mission` must open and focus the corresponding Composer input directly.
- Remove the Chat/Mission intent selector from `ChatComposer`; launch intent must come from the explicit Dock entry.

### Acceptance

- The leading icon of every top-level project group shares the same visual x-axis as the `Chats` and `Projects` headings.
- `.project-group-body` and nested row indentation remain unchanged.
- `New chat` enters Chat mode and focuses the textarea.
- `New mission` enters Mission mode and focuses the same textarea.
- No `composer-intent-selector` or its retired menu CSS remains.
- Focused source tests, Overlay typecheck, real Vite interaction, Node Playwright, and inspected screenshots pass.

### Constraints

- Preserve all unrelated dirty-worktree changes and stage only task-owned hunks.
- Reuse the existing Button, Icon, WorkLedger, shared ChatComposer, and anonymous-project launcher.
- Do not add another Composer, hidden message, fallback path, or client-only mode source.
- Do not restart or interfere with an existing OpenCorvus process.

### Read sources

- `specs/records/2026-07/2026-07-25-anonymous-project-chats-promotion-and-attachments.md`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/styles/surfaces/sidebar.css`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- `packages/overlay/src/styles/surfaces/composer.css`

### Full-repository grep

| Surface | Findings | Decision |
| --- | --- | --- |
| `openGlobalChatLauncher` | One canonical anonymous-project launcher in `workspace.ts`; WorkLedger invoked it directly | Keep it as the single directory/lifecycle path and invoke it from the main launch-mode owner |
| `composerMode` / `onComposerModeChange` | Mode was owned in `main.tsx`, but also changed through the Composer intent menu | Keep `composerMode` in `main.tsx`; delete the second visible selector source |
| `selectedExpertSquadIDs` | Only the retired Composer submenu populated the selection | Delete the dead selection signal/props; explicit `@squad` and Mission Skill directives remain authoritative |
| `project-group-toggle` | Top-level group label has its own padding while nested rows use `.project-group-body` | Change only the header inline inset by section context; do not change body indentation |
| `work-ledger-new-chat` | One left-Dock entry existed | Add the sibling `work-ledger-new-mission` entry and route both through explicit main callbacks |
| `composer-intent-*` | Component markup, CSS, source tests, and browser tests referenced the retired selector | Delete product markup/CSS and replace affected acceptance coverage with direct-entry assertions |

### Independent-agent feedback

- No sub-agent was requested or used.

## Causal chain

The section heading, project list wrapper, and project toggle each owned separate horizontal insets. The toggle inset was therefore added on top of the section/list inset, so top-level project icons appeared indented even though nested-body indentation was correct. Separately, creation intent existed in both the left Dock and the Composer selector, forcing users to choose Chat or Mission after initiating creation. The correction gives top-level headers a context-aware leading inset while leaving the nested body unchanged, and makes the two Dock buttons the sole launch-intent source.

## Implementation

1. Add `onCreateGlobalChat` and `onCreateGlobalMission` to WorkLedger and render two adjacent primary navigation rows.
2. In `main.tsx`, run the canonical anonymous launcher, set the requested mode, clear the selected record, reveal the corresponding home surface, and focus the shared textarea.
3. Remove the Composer Chat/Mission intent dropdown, multi-select state, callbacks, and retired styles.
4. Introduce a project-header-only inline inset: regular project rows use `0`, pinned wrappers use `4px`, and anonymous Chats groups use `14px`; `.project-group-body` remains `12px`.
5. Update source and real-browser tests for direct launch, focus, top-level alignment, and preserved child indentation.

## Verification record

- `bun test` over the nine focused Dock, Composer, Mission, Chat, settings, density, and alignment files: **83 passed, 0 failed, 971 assertions**.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: **21 passed, 0 failed**.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts`: passed using Node-owned Playwright and the real built Overlay.
- Browser assertions proved:
  - `New mission` focuses `[data-ui="mission-composer-input"]`.
  - `New chat` focuses `[data-ui="coding-assistant-composer-input"]`.
  - `composer-intent-selector` is absent.
  - Chats heading/project-header x positions match within `0.5px`.
  - Projects heading/project-header x positions match within `0.5px`.
  - the nested Chat icon remains indented beyond its project header.
- Inspected visual evidence: `.scratch/left-dock-direct-launch-alignment.png`. It shows two aligned primary creation rows, flush top-level anonymous/named project headers, and preserved nested Chat indentation.
- A monolithic parallel `bun test packages/overlay/test/*.test.ts` run was stopped after unrelated shared-module contamination and concurrent missing/renamed files produced failures across settings, task-directory, style-coverage, and browser-runner owners. The isolated task-owned matrix above remained green.
- `bun run --cwd packages/overlay typecheck`: passed after the concurrent MCP App schema owner completed its in-progress edit.
