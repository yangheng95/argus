# Codex Settings Button Format Convergence

## Recall

| Item | Detail |
| --- | --- |
| User request | “当前项目中的按钮格式可以参考 codex 设置页面调整（如图）”。Reference image: `C:/Users/10132/AppData/Local/Temp/codex-clipboard-51b2c604-8692-426c-815d-46060018416a.png`. |
| Acceptance criteria | Overlay text buttons use the reference's calm control language: rounded shared geometry, quiet white/light-neutral surfaces, soft one-pixel borders, no resting or hover elevation, consistent icon/text spacing, and a subdued disabled state. General Settings segmented permission controls use the same rounded geometry and flat surface rhythm. Icon-only titlebar/window/list actions keep their existing specialized interaction chrome. The real General Settings page and a focused cross-theme Button fixture must be screenshot-reviewed after implementation. |
| Hard constraints | Desktop-only; preserve `ui/Button` as the only production JSX button owner and Kobalte segmented semantics; no fallback, second button implementation, raw per-page colors, new worktree, temporary iframe, Bun-launched Playwright, or restart/refresh of the user's running OpenCorvus/Overlay. Preserve unrelated dirty Expert Squad and spec-index edits. Every production change requires focused tests, Node-launched browser verification, a second review, a `dsw-33987` commit, and push to `legacy-remote`. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/99-principles.md`; `2026-07-09-codex-reference-light-theme.md`; `2026-07-16-overlay-worktree-shortcuts-chat-files-and-button-system.md`; `2026-07-16-overlay-small-window-typography-clipping-refinement.md`; `ui/Button.tsx`; `button.css`; `design-language.css`; `settings.css`; Button/radius/settings unit and Node browser tests. |
| Baseline visual evidence | The real Vite-rendered General Settings page at `http://127.0.0.1:5186/` shows square four-pixel segmented corners, a visibly bordered/elevated outline contract, and inconsistent geometry between shared buttons and permission segments. The supplied Codex screenshot shows flatter surfaced controls with softer borders, larger rounded corners, and no visible elevation. |
| Whole-repository grep | `rg` enumerated every `Button` call site (59 TSX owners, 186 direct mounts), proved that production component JSX has no literal `<button>` outside `ui/Button`, listed all 17 CSS files that project `--oc-button-*` overrides, enumerated every Settings variant call site, and found the relevant Button/radius/settings source and browser regressions. |
| Independent agent feedback | None. The user did not request sub-agents and the active collaboration contract forbids unrequested delegation. |
| Git baseline | Branch `work-v0.0.6beta-yr-0716`; `HEAD`, `origin/work-v0.0.6beta-yr-0716`, and `legacy-remote/work-v0.0.6beta-yr-0716` were synchronized before implementation. Existing dirty files are `packages/opencorvus/src/expert-squad/payload.ts`, `packages/opencorvus/src/skill/builtin-payload.ts`, `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`, `specs/README.md`, and `specs/records/2026-07/README.md`; they are not owned by this task except for separable index additions. |

## Diagnosis

The project already has the correct architecture: `ui/Button` owns production JSX and `button.css` owns its visual contract. The inconsistency is inside that contract and one mature Settings primitive. The outline variant mixes a surfaced background with a resting shadow, then increases both border strength and elevation on hover. Meanwhile `.s-segmented` and `.s-segmented-btn` still use the smaller `--oc-radius-soft`, so the General Settings page visibly combines two corner systems. This is a style-source mismatch, not a reason to add a new component or change button call sites.

## Call-Site Disposition

| Surface / exhaustive owner set | Decision |
| --- | --- |
| Shared component owner: `components/ui/Button.tsx`; generated button escape hatch: `utils/dom-utils.ts` | Keep API/data attributes and generated `oc-button` contract unchanged. |
| App/dialog/board/message owners: `AgentSessionReplyBox`, `App`, `AppDialogHost`, `Board`, `CardHeader`, `CardHeaderChrome`, `CardParts`, `ChatBubble`, `ChatComposer`, `ChatHeaderRightToolbarToggle`, `ConfigDialogHost`, `ConnectionBadge`, `ConnectionBanner`, `Conversation`, `ConversationAgentRail`, `GoalDialogHost`, `GoalGroup`, `InlineToolPart`, `InteractionCard`, `LedgerList`, `LedgerRowMainButton`, `ReasoningPart`, `SessionDialogHost`, `WorkLedger`, and `main.tsx` | Inherit the shared flat outline contract; retain local layout variables and semantic variants. |
| Workspace/file/browser owners: `BrowserPreviewPanel`, `FileChangesPanel`, `FileEditorPane`, `FileExplorerPanel`, `ImagePreview`, `LogViewer`, `MemoryPanel`, `NotificationCenter`, `ProjectLedgerGroup`, `RightDock`, `SideActivityToolbar`, `TaskDirBar`, `TaskProgressBar`, `TerminalPanel`, `TracePanel`, `WorkspaceSplitLauncher`, and `SearchField` | Inherit the shared contract. Preserve transparent icon actions, row-main buttons, split-launcher geometry, and other explicit `--oc-button-*` owner overrides. |
| Titlebar/specialized owners: `TitlebarMenubar`, `TitlebarNavigation`, `WindowControls`, and `ArmedConfirmButton` | Preserve titlebar/window-control/icon-only chrome and confirmation behavior; shared focus and disabled semantics remain. |
| Settings owners: `AgentModelsPanel`, `ArchivePanel`, `ChannelsPanel`, `ExpertSquadPanel`, `GeneralPanel`, `NetworkPanel`, `ProvidersPanel`, `ServerConnectionSettingsGroup`, and `SkillMarketPanel` | Inherit flat shared outline buttons. Do not edit the concurrently dirty `ExpertSquadPanel.tsx`; its existing `Button` mounts receive CSS automatically. |
| CSS override owners: `activity.css`, `card.css`, `chat-bubble.css`, `composer.css`, `conversation.css`, `field.css`, `inspector.css`, `markdown.css`, `messages.css`, `notifications.css`, `settings.css`, `sidebar.css`, `titlebar.css`, `work-ledger.css`, and `workspace.css` | Preserve intentional per-surface geometry/chrome. Only `settings.css` changes because it directly owns the mismatched segmented control. |
| Shared `button.css` outline state | Remove resting and hover elevation; keep a quiet surfaced fill, soft border, shared large radius, focus ring, semantic tone, and transitions. |
| `.s-segmented` / `.s-segmented-btn` in `settings.css` | Replace soft corners with the shared large corner token, keep Kobalte/ARIA pressed semantics and semantic Allow/Ask/Deny colors, and retain existing 36px General Settings control height. |
| Tests | Extend `button-primitive.test.ts` and Settings primitive coverage for flat outline chrome and shared large segmented corners. Add/extend a Node browser visual fixture that measures radius, shadow, border, hover stability, disabled state, and captures light/dark screenshots. |

## Implementation Plan

1. Update the shared outline variant to the flat Codex-settings surface contract without altering component API or specialized chrome overrides.
2. Align Settings segmented outer/inner corner geometry with the shared Button radius while preserving semantics and state colors.
3. Update focused source tests and a Node-launched browser visual regression with computed-style assertions and task-scoped screenshots.
4. Run focused tests, Overlay typecheck/i18n/build, docs health, and `git diff --check`.
5. Reload only the isolated Vite verification tab, inspect the real General Settings screenshot, correct any visual mismatch, perform a second diff review, selectively commit task-owned hunks, and push the current branch to `legacy-remote`.

## Verification Plan

```powershell
bun test packages/overlay/test/button-primitive.test.ts packages/overlay/test/button-primitive-chrome.test.ts packages/overlay/test/settings-button-format.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/button-format-browser.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
git diff --check -- <task-owned-files>
```

## Result

- Shared outline buttons retain the existing quiet surfaced fill and one-pixel border, but resting, hover, and keyboard-focus elevation are now all `none`; focus visibility remains owned by the shared accent outline.
- Settings segmented containers and items now use `--oc-radius-large` instead of `--oc-radius-soft`, matching the shared Button corner system while preserving Kobalte toggle-group semantics, General Settings 36px height, and Allow/Ask/Deny semantic colors.
- `Button.tsx`, every production Button call site, specialized icon/window control chrome, and the concurrently dirty `ExpertSquadPanel.tsx` were unchanged.

## Validation

- PASS: focused source regressions — 12 tests, 71 assertions across `button-primitive`, `button-primitive-chrome`, and `settings-button-format`.
- PASS: Node-launched browser regression — 1 test covering light/dark outline rest/hover, one-pixel border, 8px radius, disabled opacity, segmented outer/item radius, and screenshot creation.
- PASS: Overlay TypeScript, panel i18n, and production Vite build (2,456 modules transformed).
- PASS: historical document links and product-document single-source checks.
- PASS: scoped `git diff --check`.
- PASS after selective staging: document-health's tracked-record assertion accepts the monthly README link and new record; the combined documentation suite passed 78/78.
- The root `specs/README.md` worktree summary includes this Button-format scope, but its single July summary line was concurrently extended by another task with `content-inset` scope during selective staging. That inseparable root-index hunk is intentionally left unstaged; the task-owned monthly index is staged and authoritative for dated records.

## Visual Review

| Evidence | Review |
| --- | --- |
| `.scratch/button-format-light.png` | Light-theme outline and disabled actions are flat surfaced controls with soft borders and no elevation; the selected permission item and its group share the same rounded geometry. |
| `.scratch/button-format-dark.png` | Dark theme keeps the same geometry and state separation without adding shadow or losing readable text. |
| `.scratch/button-format-live-providers.png` | Real Providers Settings page shows the shared Refresh outline control beside the unchanged accent Add action; spacing, hierarchy, and flat surface language match the supplied Codex Settings reference without changing primary semantics. |
| Real General Settings page (Browser screenshot reviewed in-session) | All five Allow/Ask/Deny groups render the larger shared corners consistently; rows, semantic state colors, and navigation remain unchanged. |

## Existing Validation Debt Observed

The initial broad suite also exposed two current-branch failures outside this diff. `flat-redesign-radius-coverage.test.ts` rejects 15 already-committed focused-popup/search/raw-radius call sites, and `settings-primitives.test.ts` rejects the already-committed `ArchivePanel.tsx` direct `.s-*` markup. `git status`/diff evidence confirms none of those production files are modified by this task, and neither failure names the changed Button or segmented declarations. They are recorded rather than weakened, bypassed, or represented as passing.

## Second Review

The final production diff is limited to four declaration replacements: two outline shadows become `none`, and two segmented radii switch from the existing soft token to the existing large token. No new component, token, fallback, hard-coded color, semantic branch, or alternate button owner was introduced. The browser fixture verifies computed styles rather than screenshot existence alone, while the real Providers and General pages provide the required task-scoped visual evidence.
