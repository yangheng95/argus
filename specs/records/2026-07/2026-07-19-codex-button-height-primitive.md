# Codex Button Height Primitive Convergence

## Recall

| Item | Detail |
| --- | --- |
| User request | “这些按钮太高了，调整成和 codex 一致；在 primitve 中统一修改。” Five supplied screenshots cover Skill Market install/policy actions, Provider refresh/add actions, Network save, and the app quit confirmation. |
| Acceptance criteria | Canonical text buttons use a compact 28 CSS-pixel medium height, producing 49 physical pixels at the current Windows 175% display scale instead of the current 56. Compact text buttons remain 24 CSS pixels and icon-only controls remain 32 CSS pixels. Search, text, select, segmented, and other form controls retain their existing 32 CSS-pixel contract. All affected surfaces inherit the change from `Button` primitive CSS; feature pages add no height overrides. |
| Hard constraints | Desktop-only; preserve the Solid `Button` API, semantic variants, keyboard focus, disabled behavior, and icon geometry. No feature-level patches, fallback component, duplicate height source, new worktree, temporary iframe, Bun-launched Playwright, or interference with the user's running OpenCorvus/Overlay. Use an isolated Vite target, Node/Playwright regression coverage, and in-app Browser screenshots. Commit subject starts with `dsw-33987` and delivery pushes to `legacy-remote`. |
| Sources read | Root `AGENTS.md`; Browser skill; `2026-07-16-codex-settings-button-format.md`; `2026-07-18-codex-control-primitives-convergence.md`; `2026-07-19-left-rail-navigation-row-height-primitive.md`; `Button.tsx`; `button.css`; `design-language.css`; Button/density/Settings/browser tests; all five supplied screenshots at original resolution. |
| Baseline visual evidence | The supplied dark button regions are 55–56 physical pixels high. Windows reports `AppliedDPI=168`, or 175%, which proves the rendered source is the current 32 CSS-pixel medium Button contract (`32 × 1.75 = 56`). The target 28 CSS-pixel medium height renders as 49 physical pixels at the same scale and removes the extra vertical bulk without shrinking 32 CSS-pixel fields or circular icon actions. |
| Whole-repository grep | `Button` has 53 TSX import owners and 182 literal mounts: 83 `md`, 49 `sm`, 16 `mini`, and 61 `icon` size declarations occur in those owners (conditional branches account for declarations exceeding literal mounts). `button.css` is the only default size owner. Surface CSS contains explicit task-specific height projections in `card.css`, `chat-bubble.css`, `composer.css`, `conversation.css`, `inspector.css`, `mailbox.css`, `markdown.css`, `messages.css`, `sidebar.css`, `titlebar.css`, `work-ledger.css`, and `workspace.css`; those specialized projections remain unchanged. Settings has layout-only Button selectors and no height override for the photographed controls. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Branch `work-v0.0.10beta-yr-0719`; clean `HEAD` `e789b09da` is synchronized with `legacy-remote/work-v0.0.10beta-yr-0719` after fetch (`0 0` divergence). |

## Diagnosis

The photographed pages are not independently stretching their buttons. Every photographed action declares `size="md"` and reaches the shared `.oc-button` recipe, where medium height is coupled to `--oc-density-control-height` (32 CSS pixels). That token is also the correct height source for text fields and selects, so globally shrinking it would incorrectly compress form inputs. The root mismatch is one shared token serving two distinct visual roles, not a Settings layout bug.

The Button size scale also leaves `mini` without its own height declaration, so it inherits the 32 CSS-pixel base despite its compact padding and type. Correcting the primitive means giving text buttons one explicit density source: 28 CSS pixels for `md`, 24 for `mini`/`sm`, and the existing 32 for semantic icon buttons.

## Call-Site Disposition

| Owner set | Decision |
| --- | --- |
| Primitive owner: `components/ui/Button.tsx`; visual owner: `styles/primitives/button.css`; density owner: `styles/tokens/design-language.css` | Keep the component API/data attributes. Add one text-button density token, route base/`md` to 28 CSS pixels, route `mini` and `sm` to the existing 24 CSS-pixel chip density, and preserve 32 CSS-pixel `icon`. |
| Settings owners: `AgentModelsPanel`, `ArchivePanel`, `ChannelsPanel`, `ExpertSquadPanel`, `GeneralPanel`, `NetworkPanel`, `ProvidersPanel`, `ServerConnectionSettingsGroup`, `SkillMarketPanel` | Keep all JSX and page CSS unchanged. The photographed Install Skill, Ask on use, Refresh, Add, Save, Cancel, and Quit actions inherit the medium primitive height. |
| Dialog/app/board/message owners: `AgentSessionReplyBox`, `App`, `AppDialogHost`, `Board`, `CardHeader`, `CardHeaderChrome`, `CardParts`, `ChatBubble`, `ChatComposer`, `ChatHeaderRightDockToggle`, `ComposerModelSelector`, `ConfigDialogHost`, `ConnectionBadge`, `ConnectionBanner`, `Conversation`, `ConversationAgentRail`, `GoalDialogHost`, `GoalGroup`, `InlineToolPart`, `InteractionCard`, `LedgerList`, `LedgerRowMainButton`, `ReasoningPart`, `SessionDialogHost`, `WorkLedger`, `main.tsx` | Inherit semantic size changes. Explicit surface-owned row/action heights continue to win through `--oc-button-height`; no caller patch is added. |
| Workspace/file/utility owners: `BrowserPreviewPanel`, `FileChangesPanel`, `FileChangesView`, `FileEditorPane`, `FileExplorerPanel`, `ImagePreview`, `LogViewer`, `MailboxPanel`, `MemoryPanel`, `ProjectLedgerGroup`, `RightDock`, `TaskDirBar`, `TaskProgressBar`, `TracePanel`, `WorkspaceSplitLauncher` | Inherit semantic size changes where no specialized height exists. Preserve the current surface projections for embedded actions and row controls. |
| Titlebar/window owners: `TitlebarMenubar`, `TitlebarNavigation`, `WindowControls` | Preserve 24 CSS-pixel compact navigation controls and 32 CSS-pixel circular icon/window controls. |
| Explicit CSS projection owners: `card.css`, `chat-bubble.css`, `composer.css`, `conversation.css`, `inspector.css`, `mailbox.css`, `markdown.css`, `messages.css`, `sidebar.css`, `titlebar.css`, `work-ledger.css`, `workspace.css` | Retain every existing contextual height. This task changes only the primitive default/semantic size mapping and does not create a second surface recipe. |
| Tests | Extend density and Button primitive tests to prove the 28/24/32 split. Update the Node/Playwright Button-format regression to assert rendered height and produce task-scoped screenshots. Verify the real isolated Settings/quit surfaces visually. |

## Implementation Plan

1. Add the canonical medium text-button density token beside existing control/icon/chip density tokens.
2. Route the Button primitive base and `md` size to 28 CSS pixels, `mini`/`sm` to 24 CSS pixels, and keep `icon` at 32 CSS pixels.
3. Update focused unit and Node/Playwright regressions for semantic height ownership and rendered geometry.
4. Run focused tests, Overlay TypeScript/i18n/build, historical-document health, and `git diff --check`.
5. Start only an isolated Vite verification target, inspect the photographed Settings and quit-dialog surfaces in the in-app Browser, correct any visual discrepancy, then perform a second diff review.
6. Record final evidence here, commit with the required prefix, push the current branch to `legacy-remote`, and confirm remote synchronization.

## Verification Plan

```powershell
bun test packages/overlay/test/button-primitive.test.ts packages/overlay/test/design-density-tokens.test.ts packages/overlay/test/settings-button-format.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/button-format-browser.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Result

- The density system now owns distinct single sources for medium text buttons
  (`--oc-density-button-height`, 28 CSS pixels), form controls (32 CSS
  pixels), icon buttons (32 CSS pixels), and compact text buttons/chips (24
  CSS pixels). The shared Button primitive routes base/`md`, `mini`/`sm`, and
  `icon` to those respective sources; no photographed Settings surface gained
  a local height rule.
- PASS: 16 focused density, Button primitive, and Settings-format tests with 96
  assertions. The new expectations failed before the primitive change and
  passed after it.
- PASS: Node-launched Playwright Button-format and close-confirmation fixtures.
  Rendered geometry is `md=28`, `mini=24`, `sm=24`, and `icon=32`; Cancel and
  Quit both render at 28 CSS pixels with the existing 8 CSS-pixel radius.
- Visual review PASS at original resolution for
  `packages/overlay/.scratch/button-format-light.png`,
  `packages/overlay/.scratch/button-format-dark.png`, and
  `packages/overlay/.scratch/close-confirm-dialog-desktop.png`. Text remains
  vertically centered, icons are not compressed, focus/disabled chrome is
  intact, and the controls match the compact Codex rhythm.
- Real isolated Settings visual review PASS at 1280x720 through the in-app
  Browser: Network Save/Test/Delete actions, Providers Refresh/Add/Configure
  actions, and Skill Market Install Skill / Ask-on-use actions all compute to
  28 CSS pixels. The Back action remains compact at 24 CSS pixels and adjacent
  text/search controls remain 32 CSS pixels. The user's running
  OpenCorvus/Overlay and backend were not restarted, refreshed, or stopped.
- PASS: Overlay TypeScript, localization, Vite production build, 128 Overlay
  architecture/token-closure guards, 21 historical-document tests, and
  `git diff --check`. The production build retains the repository's existing
  large-chunk advisory without a build failure.
- During the required full verification, token closure exposed three older
  invalid Work Ledger token references and its focused suite exposed one stale
  Project-selection string assertion. They were root-caused against history,
  repaired with the existing canonical tokens/current selection contract,
  validated by 12 focused tests plus the real Node/Playwright Work Ledger
  fixture, visually inspected, and committed separately as `d24c356ac` so they
  are not mixed into this primitive change.

## Second Review

- The causal fix stays at the shared primitive boundary: one new semantic
  button-density token and one size mapping. Search fields, inputs, selects,
  segmented controls, circular icon actions, and every explicit task-scoped
  `--oc-button-height` projection retain their existing owners.
- The complete caller inventory was rechecked after implementation. The
  photographed controls all use `Button size="md"`; no feature-level patch,
  alternate component, fallback, compatibility selector, gate, or hidden
  interaction path was introduced.
- Rendered tests cover every primitive size and the real quit dialog; isolated
  production UI inspection covers all supplied Settings examples. Visual and
  computed evidence agree on the 28/24/32 CSS-pixel split.
