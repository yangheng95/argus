# Mission Board User Interface Repair and Delete Plan

Status: implemented and visually verified.
Date: 2026-08-06

## Recall

### User request

- Keep the Create Task dialog at one appropriate width instead of changing size.
- Remove the conversation thumbnail rail from the Mission Board detail surface.
- Repair the misplaced content and actions in the competitor-research interaction dialog.
- Support permanent Mission deletion from a card context menu.

### Acceptance criteria

1. Manual and Artificial Intelligence creation share one 760-pixel scaled dialog width; only a genuinely narrower viewport may clamp it.
2. `ConversationAgentRail` is owned by the conversation view and is absent from the Mission Board view.
3. A short interaction dialog uses its natural content height. A long interaction keeps the header and reply actions visible while only the content region scrolls, capped at 640 scaled pixels.
4. Right-clicking a Mission card opens the canonical Kobalte context menu. Selecting Delete opens an explicit permanent-delete confirmation.
5. Confirmed deletion calls the existing `DELETE /mission/:missionID` contract, which closes execution and deletes the Mission Session and conversation history, then refreshes the shared Mission projection.
6. The four surfaces are verified in a real running desktop page and manually reviewed from fresh screenshots. No User Interface automation test is added, changed, or run.

### Hard constraints

- Mission remains the card identity and Task remains nested execution detail.
- The existing Mission delete route and shared Mission-board store remain the only deletion and refresh authorities.
- Do not represent deletion as archive, add a second delete path, or add local optimistic Mission records.
- Use the existing Dialog, ContextMenu, Button, Icon, localization, and diagnostic primitives.
- Do not add, modify, or run User Interface automation tests. The two existing context-menu source-assertion tests encountered during investigation are removed under the repository User Interface test prohibition.
- No database schema change, migration, worktree, fallback, or persisted presentation state.
- Preserve unrelated work. Commit subjects begin with `dsw-33987` and delivery is pushed to `legacy-remote`.

### Sources read

- `specs/records/2026-08/2026-08-06-mission-board-creation-and-summary-design.md`
- `specs/records/2026-08/2026-08-06-mission-board-creation-and-summary-implementation-plan.md`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/src/components/InteractionDialogHost.tsx`
- `packages/overlay/src/components/InteractionCard.tsx`
- `packages/overlay/src/components/MissionBoard.tsx`
- `packages/overlay/src/components/MissionCreateDialog.tsx`
- `packages/overlay/src/components/ui/ContextMenu.tsx`
- `packages/overlay/src/components/ui/Dialog.tsx`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/styles/surfaces/dialog.css`
- `packages/overlay/src/styles/surfaces/mission-board.css`
- `packages/overlay/src/styles/surfaces/workspace.css`
- `packages/overlay/src/services/mission.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- User screenshots of all three visual defects.

### Whole-repository search result

- The Mission create surface sets `width`, but does not define one stable `inline-size` and minimum intrinsic width contract independent of mode content.
- `ConversationAgentRail` is mounted directly under `workspace-main`, outside both exclusive `center-workbench-view` surfaces, so switching to the Mission Board leaves the rail visible.
- The interaction dialog and nested interaction card both use `minmax(0, 1fr)` rows. In Chromium the nested fractional rows consume the available maximum block size and leave an empty action background below short content.
- `deleteMission` and `DELETE /mission/:missionID` already provide permanent Mission deletion. The route closes active execution, deletes the Session, and therefore removes the conversation history.
- The repository already has one accessible Kobalte-backed `ContextMenu` primitive and one shared application confirmation dialog.

### Independent agent feedback

None requested. No sub-agent was used.

## Confirmed design

- Give the creation surface one tokenized preferred inline size of 760 scaled pixels and one viewport cap. Manual and Artificial Intelligence modes change fields, not their dialog shell.
- Move the existing conversation rail host inside `centerWorkbenchConversation`. This repairs component ownership instead of hiding an out-of-scope overlay with another selector.
- Replace the nested interaction fractional-height grids with a flex column whose content owns a maximum scroll height and whose action row stays adjacent to the content.
- Wrap each Mission card with the canonical context-menu root and trigger. The menu has one destructive Delete action. Main owns confirmation and the existing delete service call; the board owns only its busy presentation and invokes the shared reload after success.

## Implementation sequence

1. Remove the encountered obsolete User Interface context-menu assertion tests without running them.
2. Repair create-dialog sizing, conversation-rail ownership, and interaction-dialog intrinsic height.
3. Add localized Mission-card delete copy, context-menu composition, confirmation, existing delete-service invocation, diagnostics, and shared refresh.
4. Run localization, Overlay typecheck, production build, documentation health, historical links, and `git diff --check`; do not run User Interface tests.
5. Start the real page, exercise all four surfaces, capture and personally inspect screenshots, then correct any remaining visual defect.
6. Perform a second diff review, commit exact files, push `legacy-remote`, and rebuild the Windows desktop client package because the last package predates this repair.

## Implementation result

- The Create Task shell now owns one exact 760-scaled-pixel inline-size contract with a shell-width cap. Manual and Artificial Intelligence modes measured the same `692.21875` rendered pixels in the isolated page.
- `ConversationAgentRail` now mounts inside `centerWorkbenchConversation`; the Task Board view measured zero visible rail hosts.
- The interaction dialog and card are flex columns. Short content measured a 192.25-pixel dialog with the action row directly adjacent to content; the full competitor-research prompt measured a capped 640-pixel dialog with a 527.75-pixel scroll region and a 57-pixel fixed action row. The measured content-to-action gap was zero in both cases.
- Mission cards use the canonical context-menu primitive and an explicit irreversible confirmation. The first real delete attempt exposed a cancellation-provenance contract mismatch; the Task Board now uses the existing `overlay.work_ledger` surface identity accepted by `TaskCancellationRequestBody` instead of inventing a second surface identity.
- A confirmed isolated Mission deletion changed the rendered card count from one to zero and left zero Session, Task, and interaction rows in the isolated database.

## Visual evidence

- `specs/artifacts/mission-board-ui-repair-board.png`: Task Board without the conversation rail.
- `specs/artifacts/mission-board-ui-repair-create-manual.png`: fixed-width manual creation mode.
- `specs/artifacts/mission-board-ui-repair-create-ai.png`: same-width Artificial Intelligence creation mode.
- `specs/artifacts/mission-board-ui-repair-competitor-dialog.png`: long competitor-research interaction with a bounded content region and adjacent actions.
- `specs/artifacts/mission-board-ui-repair-context-menu.png`: Mission-card context menu.
- `specs/artifacts/mission-board-ui-repair-delete-confirm.png`: permanent-delete confirmation.
- `specs/artifacts/mission-board-ui-repair-delete-complete.png`: empty Task Board after the real delete completed.

## Verification evidence

- Overlay TypeScript typecheck: passed.
- Overlay localization completeness check: passed.
- Overlay production build: passed with `NODE_OPTIONS=--max-old-space-size=8192`; 7,077 modules transformed.
- Historical documentation links: passed, two tests.
- `git diff --check`: passed.
- Real-page interaction and manual screenshot review: passed for the four requested defects and the permanent-delete lifecycle.
- No User Interface automation test was added, modified, or run. The two encountered source-assertion User Interface tests were deleted as required by repository policy.

## Windows client package

The client was rebuilt from commit `797b8c1b38` at version `0.0.32-beta`. SDK generation, the 7,077-module Overlay production build, embedded Windows backend, Tauri release executable, MSI, and NSIS build completed. Initial staging found the previous portable client still running from the canonical output directory; after verifying and stopping that exact old package process, the repository's `--skip-build` staging path reused the newly built release inputs and the canonical release-asset validator passed for `windows-x64`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/overlay/dist-artifacts/windows-x64/opencorvus-overlay.exe` | 219,314,688 | `484A6ABEE00DCA316DF104AA7FFEAA54AE42984A871F2B123181D58729F79CE1` |
| `packages/overlay/dist-artifacts/windows-x64/OpenCorvus_0.0.32-beta_x64_en-US.msi` | 210,636,800 | `6D40A7645997F5AF487658A5F0AF3B0D8DF3961E51E1DD6BBE5F43FC70F29ABF` |
| `packages/overlay/dist-artifacts/windows-x64/OpenCorvus_0.0.32-beta_x64-setup.exe` | 210,087,752 | `21E6531690CEA37C0A868C19850BE65FF104DF2E96A46684C86D90D6C35A5D03` |
