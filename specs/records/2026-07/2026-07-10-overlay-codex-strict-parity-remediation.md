# Overlay Codex Strict Parity Remediation

## Recall

User request:

- Previous delivery was rejected because the Overlay UI (User Interface, 用户界面) is still far from the Codex desktop reference.
- Strictly redo the Overlay Codex-style replica against five reference screenshots.
- Updated constraint: prioritize surfaces and actions that both Codex and OpenCorvus actually share. Do not invent Codex-only account actions such as Log Out when OpenCorvus has no login/account session operation.
- Fix layout, menus, settings, command palette, message panel collapsed tool/thinking style, and every small control.
- Use real screenshots as the verification loop and an independent agent as adjudicator.
- Do not mark the goal complete until the UI is genuinely similar.
- Updated objective: iterate up to 100 review rounds; every round must find a different batch of style differences unless no different Codex-style differences can be found.
- 2026-07-10 additional user requirement: the composer `Chat` mode and expert squad choice are mutually exclusive and must be represented by one dropdown, not two adjacent controls. The visible selector should weaken the explicit `Mission` concept: `Mission` remains an internal execution path, while choosing an expert squad means "run with this squad" and binds that squad to the mission path. Plain `Chat` must not inherit or submit an expert-squad `promptProfile`.
- 2026-07-10 additional user requirement: the Expert Squads settings-page configuration must be positioned at the upper-left of the content workspace, rather than inheriting the centered General-settings column.
- 2026-07-10 additional user requirement: conversation messages must become low-information-density inline cards. The outer message window is removed entirely: the message surface stays transparent and borderless at rest and on hover; hover/focus reveals only essential metadata and actions without drawing a window. Body content supports inline rich text through the shared renderer, and the message-part architecture must support sandboxed iframe-style embeds through an explicit typed extension rather than allowing raw Markdown HTML.
- 2026-07-10 additional user requirement: do not omit i18n validation. Every UI batch must verify that visible product copy continues to use translation keys, `en-US` and `zh-CN` contracts remain aligned, and the repository's panel-i18n checker and runtime i18n tests pass.

Acceptance criteria:

- Empty home must match the Codex desktop structure: wide neutral left rail, File/Edit/View/Help top menubar, mostly white canvas, centered large prompt title, large centered composer with control row, suggestions/rate-limit style lower content where applicable.
- Settings must read as the Codex settings page, not a compact OpenCorvus config modal: broad left settings rail with search/back/grouping, centered content column, low wide grouped setting rows, quiet neutral surfaces.
- Menus must use the Codex desktop top-level menu model and geometry, especially File menu ordering, separators, shortcut column, and panel width.
- Command palette must match Codex's wide "Search chats or run a command" surface with grouped chat/project rows and shortcut chips, not a narrow command-only developer list.
- Conversation view must match the Codex content hierarchy: left rail remains the visual anchor, transcript sits in a centered text column on a white canvas, header is light, composer is large and centered.
- Tool calls and reasoning must default collapsed in the message panel, but body messages must remain visible by default. Expanded tool/reasoning content must use the same quiet Codex disclosure style.
- Message body is always the primary visible surface. Role, time, duration, trace, copy, cancel, and similar controls occupy one hover/focus toolbar; they must not be split across header, body action row, and footer. Hover must not add a card background, border, shadow, or vertical lift.
- Rich text and embeds use one message-part pipeline. Markdown HTML remains escaped; iframe support is an explicit validated `embed` part rendered with a restrictive sandbox and referrer policy.
- Composer bottom controls must expose one single intent dropdown combining `Chat` and available expert squads. A separate `Chat` selector plus separate expert-squad selector is a rejected dual-control UI. The dropdown should not expose a standalone `Mission` option; expert squad options imply the mission path.
- Each iteration must produce either a code/test/screenshot closure or a clear recorded reason why that difference is not yet fixed. No visual pass can be based only on tests, DOM existence, or previous benchmark pass.

Hard constraints:

- No fallback, compatibility branch, second source, keyword gate, or separate UI tree.
- No raw mechanical clone that breaks OpenCorvus semantics; adapt Codex information architecture and visual grammar through existing primitives.
- Do not restart, close, refresh, or kill the user's running OpenCorvus / Overlay process.
- Browser verification uses Node.js Playwright on Windows, not Bun.
- Code changes require targeted tests plus real screenshot inspection.
- Commit subjects must start with `dsw-33987`; push must go to `myhexin`.
- The current worktree has many unrelated dirty files; do not stage, revert, or overwrite unrelated work.

Reference screenshots:

- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-1.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-2.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-3.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-4.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-5.png`

Current screenshots reviewed before this remediation:

- `.scratch/overlay-empty-home-composer-light.png`
- `.scratch/config-dialog-resizer.png`
- `.scratch/titlebar-settings-menu-open.png`
- `.scratch/command-palette-dialog-primitive.png`
- `.scratch/overlay-codex-message-expanded-default.png`
- `.scratch/overlay-codex-tool-reasoning-expanded.png`

Persisted records read before implementation:

- `specs/records/2026-07/2026-07-09-overlay-codex-full-style-parity.md`
- `specs/records/2026-07/README.md`
- `specs/README.md`

Whole-repository searches performed:

- `rg -n "ui-rail-width|leftPanel|sidebar|workLedgerPanel|work_ledger\.title|Projects|chat-composer|chat-input|chat-header|conversation-body|Conversation|CommandPalette|cmdk|config-sidebar|config-content|config-dialog|titlebar-menubar|TitlebarMenubar|Settings|Config" packages/overlay/src packages/overlay/test`
- `rg -n "ReasoningPart|InlineToolPart|ToolPart|toolToCardNode|defaultExpandedForNode|collectLatestActivityText|ChatBubble|CardHeader|Card\(|reasoning-toggle|msg-tool|msg-reasoning|Steer|scoped guidance" packages/overlay/src packages/overlay/test`
- `rg -n -- "--ui-rail-width|--ui-chat-message-content-width|--ui-chat-message-scroll-width|--chat-composer|max-width|left-panel|sidebar|cmdk|config-sidebar|config-content|titlebar-menubar-panel|chat-input|rail-surface|chat-canvas|menu-panel" packages/overlay/src/styles packages/overlay/test`
- `rg -n "fallback|兜底|compat|legacy|visibility|audience|synthetic|ignored|gate|state machine" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test`

Single-source implementation surfaces confirmed:

- App skeleton and mount points: `packages/overlay/src/index.html`.
- Global theme and proportions: `packages/overlay/src/styles/tokens/design-language.css`, `packages/overlay/src/styles/cascade/light.css`.
- Sidebar and work ledger: `packages/overlay/src/styles/surfaces/sidebar.css`, `packages/overlay/src/styles/surfaces/work-ledger.css`.
- Top menubar: `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`, `packages/overlay/src/styles/surfaces/titlebar.css`.
- Empty/conversation/composer geometry: `packages/overlay/src/components/Conversation.tsx`, `packages/overlay/src/components/ChatComposer.tsx`, `packages/overlay/src/styles/surfaces/conversation.css`, `packages/overlay/src/styles/surfaces/composer.css`.
- Settings: `packages/overlay/src/components/ConfigDialogHost.tsx`, `packages/overlay/src/components/settings/**`, `packages/overlay/src/styles/surfaces/settings.css`.
- Command palette: `packages/overlay/src/components/CommandPalette.tsx`, `packages/overlay/src/styles/surfaces/cmdk.css`.
- Message body/tool/reasoning ownership: `packages/overlay/src/components/ChatBubble.tsx`, `packages/overlay/src/components/Card.tsx`, `packages/overlay/src/components/CardParts.tsx`, `packages/overlay/src/components/ReasoningPart.tsx`, `packages/overlay/src/components/InlineToolPart.tsx`, `packages/overlay/src/styles/surfaces/chat-bubble.css`, `packages/overlay/src/styles/surfaces/messages.css`.

Independent agent feedback:

- New strict adjudicator `Plato` was started on 2026-07-10 with the five reference screenshots and current Overlay screenshots.
- `Plato` returned first-round status: not accepted. It found P0 structural mismatches, not minor visual drift.
- P0 feedback: left rail uses project-workspace IA instead of Codex chat IA; top menus are OpenCorvus-specific instead of `File / Edit / View / Help`; empty home lacks Codex prompt/composer/suggestion structure; composer structure and controls differ; settings is a config modal rather than Codex settings page; command palette is command/settings-oriented instead of chat/search-oriented; transcript still looks like an agent log panel.
- P1/P2 feedback: rail width/color, brand exposure, online badge, menu geometry, palette dimming, settings control primitives, reasoning/tool language, typography, radii, purple/blue palette, and missing account footer all remain off.
- Final acceptance is blocked until regenerated screenshots are reviewed by an independent adjudicator after fixes.
- Second strict adjudicator `Hooke` reviewed the regenerated full-window evidence and returned `NOT ACCEPTED`.
- `Hooke` P0: the empty-home suggestion still exposed “Plan a focused automation mission” as a standalone Mission action, contradicting the unified Chat/expert-squad intent model.
- `Hooke` P1: rail width and row metadata remain too dense; the composer is too wide and lacks an obvious dropdown affordance; settings lacks Codex page hierarchy; command palette is oversized and lacks Unread/Suggested grouping; the transcript still has an oversized user card and centered runtime status.
- `Hooke` confirmed that Chat and expert squads occupy one mutually exclusive selector position and that tools/reasoning are collapsed by default, but it did not accept the surrounding visual hierarchy.

## Failure Analysis

The previous pass was invalid because it treated targeted browser tests, screenshot generation, and a broad "PASS" from the prior adjudicator as equivalent to Codex visual parity. That skipped the core reference comparison:

- It did not enforce the Codex global information architecture.
- It accepted a pale-blue OpenCorvus shell while the reference uses a neutral Codex desktop surface.
- It accepted a compact settings dialog while the reference is a broad settings page.
- It accepted a settings-oriented top menu while the reference uses File/Edit/View/Help and a Codex File menu.
- It accepted a narrow command-list palette while the reference is a wide chat/command search panel.
- It accepted a cropped message-card screenshot as transcript parity evidence.

This remediation treats the prior result as not achieved.

## 100-Round Audit Protocol

- `Round N` must identify a new batch of differences not already closed in previous rounds.
- A round can close only with a screenshot and, when code changed, a targeted test or static guard.
- If a round finds differences that are intentionally deferred, the reason and affected surface must be recorded.
- The goal can be accepted before 100 rounds only if a round cannot find any new style differences against the five reference screenshots and the independent adjudicator also cannot find any.
- No round may pass on function-only evidence.

## Round 1 Differences

Status: in progress.

Batch 1 structural differences to fix first:

1. Left rail geometry: current rail is about 280px in the 1280px fixture and pale blue; reference rail is materially wider in the desktop screenshot and neutral grey.
2. Top menubar: current top-level menus are OpenCorvus-specific `Project / Provider / Run / View / Settings / Help`; reference uses `File / Edit / View / Help` with browser-like back/forward chrome.
3. Brand/titlebar: current `OpenCorvus Workspace` brand dominates the titlebar; reference has a small app/sidebar icon region and muted system menu text.
4. Empty page: current empty state centers an icon and "Conversation updates will appear here"; reference centers a large prompt title above the composer.
5. Composer scale: current composer is a compact bottom bar; reference composer is a large centered rounded input panel with attachments row, lower controls, and a black circular send button.
6. Sidebar content model: current rail only shows `Projects`, search, and "No work yet"; reference shows New chat, Search with shortcut, Scheduled, Plugins, pinned chats, project chats, and user/account footer.
7. Settings model: current settings is a fullscreen dialog with `Config & Settings` header and close icon; reference settings is a page with `Back to app`, search, grouped nav, and large centered content.
8. Settings rail width: current config rail is about 280px; reference settings rail is about 445px at the screenshot width.
9. Menu panel semantics: current opened menu lists setting tabs; reference File menu rhythm should be adapted only for OpenCorvus-backed actions: New Window, New Chat, Quick Chat, Open Folder, Close, Settings, Exit, separators, and shortcuts. Do not add Log Out because OpenCorvus has no login operation.
10. Command palette semantics: current palette lists task/settings/theme commands; reference lists chats first, unread chats, suggested actions, project labels, and Ctrl+number shortcut chips.
11. Command palette geometry: current palette is narrower and high; reference panel is wider, lower, and overlays a globally dimmed conversation.
12. Message screenshot evidence: current message evidence is a cropped agent card; reference conversation evidence is the full app with transcript column, header, composer, and rail.
13. Message chrome: current agent bubble still shows avatar/title/duration/footer and a scoped `Steer` input; reference transcript body is much quieter and not framed as an agent card by default.
14. Tool/reasoning expanded style: current expanded reasoning/tool blocks still look like OpenCorvus card surfaces; reference style requires compact disclosure rows and body-first transcript.

Round 1 implementation scope:

- Change the light palette and rail width through shared tokens.
- Move titlebar menu model toward Codex's File/Edit/View/Help without creating a second menubar.
- Replace empty state with Codex-style prompt heading and remove the large centered icon from the empty global home.
- Resize and restyle the composer toward the reference.
- Restyle settings shell and config sidebar toward the Codex settings page.
- Rework command palette data/visuals toward the Codex chat search panel.
- Reduce message bubble chrome for assistant/agent body display and keep tool/reasoning collapsed.

Independent adjudicator additions:

- Rail IA must include Codex-like top actions, grouped chat/project list rhythm, and account footer; width/color alone is insufficient.
- File menu must carry Codex desktop command grouping and shortcuts; exposing settings sections directly in the top menu is not acceptable.
- Empty home must include the Codex project prompt and composer context row; a generic empty icon cannot remain the primary empty state.
- Settings must introduce `Back to app`, search, section grouping, and low wide option rows.
- Command palette must list chats/unread/suggested items with project names and shortcut chips.
- Transcript must not present normal assistant body as an OpenCorvus agent-control card.

## Verification Plan

Static and unit checks:

```powershell
git diff --check -- <changed files>
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/overlay/test/theme-palette-intent.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/config-panel-sizing.test.ts packages/overlay/test/command-palette-primitive.test.ts packages/overlay/test/titlebar-menubar-primitive.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/reasoning-part.test.ts packages/overlay/test/card-collapsed-preview.test.ts
```

Browser screenshot checks, with Node runner:

```powershell
$env:OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS='120000'
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts packages/overlay/test/browser/command-palette.test.ts packages/overlay/test/browser/titlebar-menu-order.test.ts packages/overlay/test/browser/config-dialog-resizer.test.ts packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts packages/overlay/test/browser/reasoning-toggle-button-browser.test.ts
```

Required visual review artifacts:

- Empty home screenshot after Round 1.
- Settings screenshot after Round 1.
- File menu screenshot after Round 1.
- Command palette screenshot after Round 1.
- Full conversation screenshot after Round 1.
- Message detail screenshot for collapsed and expanded reasoning/tool rows after Round 1.

Acceptance remains blocked until an independent adjudicator reviews the regenerated screenshots.

## 2026-07-11 Full-Surface Reopen

### Recall

- User rejected the delivered comparison because the current Overlay is visibly unlike the Codex references and explicitly required every page, not only the left rail, to be checked.
- The previous functionality-integrity `PASS` proved behavior and contracts, not visual parity. It is not valid evidence for this visual objective.
- Scope is every reachable Overlay surface: global home, transcript, Work Ledger rail, titlebar menus, command palette, settings and every settings tab, Expert Squads, provider/model configuration, skills/plugins, channel configuration, browser preview, screenshot browser, file explorer/editor, diff, terminal/logs, workflow/requirements/architect/goals, notifications, dialogs, popovers, loading/error/empty states.
- Desktop reference parity remains the only authorized viewport scope. Mobile/tablet work is not added.
- Existing unrelated dirty work remains protected. No running OpenCorvus/Overlay process may be restarted, refreshed, closed, or killed.

### New root-cause evidence

- The mismatch is both design-language and implementation-structure failure. The current 4199 screenshot shows underscaled typography, compressed titlebar, weak hierarchy, an asset-tree-like Work Ledger, sparse transcript metadata rows, oversized empty whitespace, and notification cards that visually dominate the transcript.
- `packages/overlay/src/styles/tokens/design-language.css` currently defines a 13px body/control/meta scale, 10px tiny text, 36px titlebar, and a 270-360px rail. These values are materially denser than the reference rhythm.
- `packages/overlay/test/design-density-tokens.test.ts` does not merely lag behind the reference: it actively asserts 13px body/control/meta values, explicitly rejects 14px body, and explicitly rejects a 445px settings/reference rail dimension. The visual regression is therefore encoded in the acceptance suite.
- Shared primitives alone cannot repair the result. The Work Ledger row model exposes UUID directory names and nested task metadata where the reference uses human chat/project hierarchy; settings, workbench panels, and transcript each need page-specific structural correction after shared token repair.

### Required audit matrix

| Surface family | Shared design checks | Structural checks | Evidence required |
| --- | --- | --- | --- |
| Shell / rail / titlebar | typography, neutral palette, icon size, row height, separators, hover | Codex navigation hierarchy, human labels, pinned/projects grouping, account footer | full-window screenshot plus reference overlay comparison |
| Home / composer | display scale, composer radius/shadow/padding, control weight | centered prompt composition, project/runtime context row, suggestions | empty-home screenshot |
| Transcript | body width/line-height, disclosure density, hover controls | body-first message flow, collapsed internal context, non-dominant notifications | long transcript and tool/reasoning screenshots |
| Settings | 445px-class navigation rail, page typography, wide rows, control geometry | Back/search/groups, every tab reachable, Expert Squads upper-left exception | one screenshot per settings tab |
| Menus / command palette / dialogs | popup geometry, dimming, shortcut chips, focus | Codex command grouping backed by real OpenCorvus actions | opened-state screenshots |
| Workbench panels | shared header/control/table tokens | workflow, requirements, architect, goals, files, diff, browser, screenshots, notifications each preserve their domain layout | screenshot per panel and meaningful state |
| Error/loading/empty states | quiet status hierarchy, contrast | no fake content or fallback; state remains actionable | targeted state screenshots |

Visual acceptance is reopened and blocked until this full matrix is completed and a fresh independent read-only adjudicator returns `PASS` against regenerated evidence.

### Independent full-surface audit result

- Independent read-only auditor Euclid returned `FAIL`.
- P0 root cause: the left rail is project/runtime-first rather than chat-first. UUID projects, Missions, and child tasks are promoted into the primary navigation hierarchy instead of remaining lightweight metadata attached to human conversations.
- P0 root cause: settings remains implemented through a fullscreen Dialog host, while command palette and ordinary modals share the same dialog lifecycle; CSS similarity cannot make these distinct page/palette/modal geometries equivalent.
- P0 root cause: the center area is a multi-panel IDE workbench (workflow, requirements, architect, goals, explorer, diff, browser, screenshots, notifications, file) rather than one stable conversation canvas with subordinate task artifacts.
- P1 findings cover every audited family: Provider/Agent Models form a configuration matrix; Skills/Skill Market/MCP form a second extension-management design system; Browser Preview, Explorer/Editor, Diff, and Terminal lack one shared workbench shell; command-palette grouping is still command-heavy; dialogs have not been visually classified and reviewed by purpose.
- The auditor explicitly rejected a visual PASS for every surface without a current real screenshot and identified the user-provided left-rail comparison as direct P0 failure evidence.

### First shared correction

- Removed viewport-dependent automatic UI scaling from `applyZoom`; only explicit user zoom now changes `--ui-scale`. The old behavior scaled typography with viewport geometry and rendered the entire product as a thumbnail.
- Recalibrated shared typography and density to a 14px body/control baseline, 32px display tier, 48px titlebar/context/header rhythm, 32px control tier, and a 300-445px desktop rail range.
- Increased primary navigation and Work Ledger row heights, and settings tab height, through their owning shared rules.
- Removed the top-level `Run` menu. Model, expert-squad, and permission controls remain reachable through their actual composer/settings owners rather than being promoted into a control-console menu.
- Removed ambient radial/linear workspace gradients from light, dark, and VS Code dark themes. The first post-change browser screenshot exposed black GPU/compositor blocks exactly on the gradient-backed workspace; the flat surface token removed that rendering defect and matches the reference canvas language.
- Removed the unreferenced `provider.title` i18n key from both locales.

Verification for this correction: 57 shared density/layout tests, 41 titlebar/density/layout tests, Overlay typecheck, strict i18n, production Vite build, and the real Node titlebar browser test pass. This evidence validates only the shared correction; the full-surface visual objective remains `FAIL` pending structural remediation and the screenshot matrix.

### User correction: preserve Run during the complete redo

- The user explicitly rejected deleting the `Run` top-level menu and ordered a complete redo.
- `Run` is an OpenCorvus-native capability and is a deliberate adaptation dimension, not a Codex parity defect. The accepted menu model is `File / Edit / View / Run / Help`.
- The previous audit overreached by treating the reference's lack of `Run` as deletion evidence. The correct requirement is to preserve Run while making its trigger, menu geometry, grouping, shortcuts, hover/focus behavior, and density follow the same desktop language as the other menus.
- Model selection, Agent Models, Expert Squads, and Permissions remain backed by their real owners; Run is a navigation surface over those capabilities, not a second state source.
- The first-shared-correction bullet that described Run removal is superseded by this section. Tests must positively assert Run remains present and reachable.
- "Complete redo" means the full structural program proceeds; it does not authorize removing OpenCorvus-specific functionality merely because Codex lacks an equivalent control.

## Round 2 Evidence

Status: in progress; the full parity goal remains unaccepted.

Closed batch:

- The composer now places one attachment menu plus the mutually exclusive Chat/expert-squad selector on the left, with model and send controls on the right. File and folder attachment actions share the single `+` menu instead of adding a second visible folder button.
- General settings now owns real permissions, behavior, and database controls. Appearance owns theme and locale. Network owns the server connection group. The selected settings title follows the active tab.
- Settings now declares one Kobalte `TabPanel` per tab, fixing stale `aria-controls` after keyboard navigation.
- The Expert Squads configuration page is a workspace-scale exception to the centered settings column. Its title, toolbar, catalog overview, list, and detail surface begin at the content area's upper-left; the replace/import controls are left-aligned directly below the page title.

Authoritative evidence:

- `packages/overlay/test/config-panel-sizing.test.ts` asserts the Expert Squads top-left CSS owner.
- `packages/overlay/test/browser/expert-squad-panel.test.ts` uses the real File -> Settings -> Expert Squads path at 1902x1314 and asserts title, panel, and toolbar insets against `#configContent`.
- `.scratch/expert-squad-settings-page.png` is the reviewed full-window screenshot.
- Targeted static test: `bun test packages/overlay/test/config-panel-sizing.test.ts` passed 15 tests.
- Targeted browser test: `node --test --test-name-pattern="expert squads settings renders" packages/overlay/test/browser/expert-squad-panel.test.ts` passed under `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`.

New differences still open after this batch:

- Empty-home title and composer vertical rhythm still require comparison after the latest non-overlap change.
- Sidebar and titlebar typography remain smaller and denser than the five Codex references.
- Conversation header actions and message action-row geometry still differ from the reference.
- Command palette still lacks a truthful unread grouping because the current work-ledger projection has no unread source field; this must not be invented as UI-only state.
- Independent adjudication must be rerun after the next full screenshot set.

## Round 3 Evidence

Status: in progress; the goal remains active and unaccepted.

Closed batch:

- Empty-home suggestions now use three flat 52px rows with continuous separators, 18px labels/icons, and no rounded-row override. The prior CSS declared `border-radius: 0` and then overrode it with a large radius in the same owner rule.
- Titlebar menu labels, static sidebar actions, section labels, and Work Ledger rows now use localized Codex-scale typography and row heights without globally scaling the main canvas or changing the verified 444px rail width.
- The homepage browser fixture now asserts suggestion row heights/radii and computed chrome typography/row geometry, in addition to the existing title/composer/context vertical-order checks.

Authoritative evidence:

- `.scratch/overlay-empty-home-composer-light.png` was regenerated at 1902x1314 and visually inspected after the changes.
- `node test/browser-runner.mjs test/browser/command-palette.test.ts` passed with the new geometry assertions.
- `bun run typecheck` passed in `packages/overlay`.
- `bun test test/work-ledger-consolidation.test.ts test/titlebar-menubar-primitive.test.ts test/mission-i18n.test.ts` passed 100 tests.
- A misleading black region appeared only in the original-detail previewer. Direct PNG pixel samples at workspace coordinates were opaque white (`A=255, R=255, G=255, B=255`), and the high-detail image render was normal. The application screenshot itself did not regress to a dark theme.

New differences still open after this batch:

- The home composer lacks the richer OpenCorvus-backed workspace/version context strip visible under the Codex reference composer. Any addition must project existing project/runtime data and must not invent UI-only state.
- The available full-conversation screenshot is stale and command-palette-obscured; current message screenshots cover only the message component. A fresh full-window conversation screenshot is required before acceptance.
- Conversation header controls and assistant message action-row spacing still require direct full-page comparison.
- Command palette unread grouping remains unavailable until a truthful unread source exists.
- Independent adjudicator `019f49fb-f16a-7303-a714-5a1ec674cd71` is running read-only against the five references and latest artifacts; its findings must be recorded before the next implementation batch.

## Round 4 Evidence

Status: the message-panel requirement is implemented and verified; the full Overlay parity goal remains active and unaccepted.

Closed batch:

- Normal user and assistant messages are body-first, transparent, borderless, radius-free, and shadow-free at rest and on hover. The former outer message-card window, persistent header, footer, activity count, and card-level collapse state were removed.
- Essential role, timestamp, duration, guidance, and copy actions now live in one absolute hover/focus toolbar. The toolbar is absent from pointer and visual flow at rest and does not create a window when shown.
- Message body rich text continues through the shared Markdown renderer. Raw Markdown HTML remains escaped.
- Extensible inline media now uses one typed `embed` message part shared by the transport protocol, server conversation projection, and Overlay renderer. It accepts only absolute HTTP(S) URLs, a non-empty title, and a bounded aspect ratio.
- Embedded documents render in a lazy iframe with `referrerPolicy="no-referrer"` and a sandbox that excludes `allow-same-origin`; malformed and `javascript:` embeds are rejected before display.
- Reasoning and tool output remain under the readable `Work details` disclosure, while the正文 remains visible by default.
- Agent guidance controls were split into shared trigger/form primitives so the top-level trigger can belong to the hover toolbar without overlapping or intercepting the `Work details` disclosure.
- The Solid application host now owns the full flex height after the shell moved from static HTML into `App.tsx`; this fixes the 117px collapsed application viewport without restoring a second shell source.

Authoritative evidence:

- `packages/overlay/.scratch/overlay-codex-conversation-default.png` shows the default full conversation with transparent inline messages, rich embed, and no persistent metadata toolbar.
- `packages/overlay/.scratch/overlay-codex-conversation-hover.png` shows the same message with essential metadata/actions revealed on hover and no outer card surface.
- `packages/overlay/.scratch/overlay-codex-message-expanded-default.png` shows the inline body, embed, and collapsed work-detail control in the message crop.
- `node test/browser-runner.mjs test/browser/chat-bubble-disclosure-button-browser.test.ts` passed against a real browser fixture and a real iframe document.
- `bun test packages/opencorvus/test/server/conversation-view.test.ts` passed 17 tests.
- `bun test packages/transport-protocol/test/contract.test.ts` passed 26 tests.
- `bun run typecheck` passed in `packages/overlay`.

Independent adjudication already received for the preceding full artifact set: NOT ACCEPTED. It identified remaining sidebar density, settings geometry, menu/palette fidelity, and stale screenshot contradictions. The Round 4 message artifacts require a focused read-only re-review; closing this message batch does not override the overall rejection.

Focused Round 4 adjudication result: NOT ACCEPTED on first review.

- P1: `overlay-architecture-guards.test.ts` still enforced an execution rail and opaque agent background while the new message contract required transparency.
- P1: `agent-summary-card-browser.test.ts` still waited for the deleted whole-card disclosure and collapsed preview.
- P1: every embed received forms, popups, and scripts without an explicit capability declaration.
- P2: the embed fixture was full-lane and too tall; keyboard focus had no real browser coverage.
- P3: the iframe caption used an overlay shadow treatment.

Corrections after the rejection:

- The execution-rail guard now enforces role-independent transparent message chrome. The old agent-summary browser test now verifies visible正文 and collapsed `Work details` instead of a collapsed outer card.
- Remaining scroll and visual-stress fixtures no longer create or inspect deleted chat-bubble heads. The scroll fixture uses visible inline bodies and an explicit fixed row height solely to establish its scroll-button precondition.
- `sandboxPermissions` is now a required typed embed field. The protocol accepts only explicit `scripts`, `forms`, and `popups` values, rejects unknown or duplicate permissions, and maps only requested capabilities to iframe sandbox tokens.
- The browser fixture requests only `scripts`. Its iframe performs real same-origin parent-document access and popup attempts; the test confirms both are blocked through a sandbox probe.
- Embed width is capped at 520 token pixels, its aspect-ratio viewport is separate from the caption, and the caption is now a static text line without background or shadow.
- Browser coverage now uses Tab and Shift+Tab to verify that focus reveals the toolbar and leaving it hides the toolbar.
- Regenerated default and hover screenshots were visually inspected. The default message remains windowless; hover adds only the metadata/action row; the iframe no longer spans the message lane.

Focused Round 4 second adjudication result: ACCEPTED. The independent read-only adjudicator found no remaining issue that blocks the message-panel requirement. This acceptance is scoped to Round 4 only; the full Overlay parity goal remains active because the earlier sidebar, settings, menu, palette, and whole-shell differences are still open.

New differences still open after this batch:

- Expanded reasoning/tool rows still need direct comparison against the Codex disclosure treatment; nested detail content may still carry more surface chrome than the reference.
- The full shell remains subject to the independent adjudicator's open sidebar, settings, top-menu, command-palette, and typography findings.
- A fresh complete artifact set must replace stale menu and palette screenshots before the full parity goal can be accepted.

## Round 5 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- A fresh 1902x1314 General-settings screenshot proves that the full-window shell, 444px rail, back/search navigation, title position, and centered content width are now close to the reference.
- The remaining settings mismatch is content density: OpenCorvus compresses six permission rows, behaviour, and database controls into the first viewport, while the Codex reference uses substantially taller rows, larger title/description typography, wider group rhythm, and larger touch targets.
- The permission introduction is currently rendered as a fake first `SettingsRow` inside the bordered group. The reference treats explanatory copy as group-level text above the row surface.

Recall and call-point audit:

- `SettingsGroup`, `SettingsRow`, and `SettingsSegmented` in `packages/overlay/src/components/settings/primitives.tsx` are the single shared setting-row source.
- All settings panels were enumerated with `rg -n '<SettingsGroup|<SettingsRow' packages/overlay/src/components --glob '*.tsx'`.
- Standard full-window density ownership is in `packages/overlay/src/styles/surfaces/settings.css` under `#configDialog .s-*`; the Expert Squads panel is an explicit workspace-scale exception and must retain its denser operational layout.
- Existing geometry coverage is in `packages/overlay/test/config-panel-sizing.test.ts`, `packages/overlay/test/settings-primitives.test.ts`, and `packages/overlay/test/browser/config-dialog-resizer.test.ts`.

Acceptance for this batch:

- Group descriptions use a first-class primitive slot outside `.s-group-body`; no fake description-only settings row remains in Permissions.
- Standard non-Expert-Squads settings rows have Codex-like low-density geometry and readable title/description typography.
- Permission segmented controls and checkbox switches meet the larger visual/touch geometry visible in the reference.
- The 1902x1314 screenshot is regenerated and visually reviewed; browser assertions measure row, typography, group description, segmented, and switch geometry.

## Round 5 Evidence

Status: implementation and primary-agent visual review complete; independent adjudication pending.

Closed batch:

- `SettingsGroup` now owns a first-class `description` slot between its heading and body. Permissions uses this slot, so explanatory copy no longer masquerades as a bordered settings row.
- Standard non-Expert-Squads settings pages now use 76px minimum rows, 17px titles, 16px descriptions, 40px panel group rhythm, 30px segmented buttons, and 44x26px switches at base scale.
- The operational Expert Squads workspace is explicitly excluded through its existing `data-config-panel="expert-squad"` identity, preserving the user-requested upper-left manager density without creating a second component tree.
- The stale sidebar test that required a literal `calc(12px...)` radius now verifies the canonical `--oc-radius-large` token already used by production.

Authoritative evidence:

- `packages/overlay/.scratch/config-dialog-resizer.png` was regenerated at 1902x1314 and visually inspected against reference image 2.
- The browser test asserts exactly six real permission rows, description ownership outside `.s-group-body`, row height, title/description font size, segmented button height, switch size, centered panel width, sidebar state, and keyboard resizing.
- `node test/browser-runner.mjs test/browser/config-dialog-resizer.test.ts` passed.
- `bun test test/settings-primitives.test.ts test/config-panel-sizing.test.ts test/general-panel-notification-single-source.test.ts` passed 58 tests.
- `bun run typecheck` passed in `packages/overlay`; targeted `git diff --check` passed.

New differences found for a later batch:

- Settings navigation labels/group headings and the persistent titlebar menu text remain visibly smaller than reference image 2.
- OpenCorvus has six truthful permission categories rather than the reference's three broader toggles; they must remain because collapsing or hiding capabilities would change semantics.

Focused Round 5 independent adjudication result: ACCEPTED. The adjudicator confirmed the standard row geometry, first-class group description, segmented/switch scale, truthful six-permission model, and Expert Squads density exclusion against the current screenshot and source.

## Round 6 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- Reference images 1–5 use a consistently larger persistent chrome scale: top-level File/Edit/View/Help labels, settings Back-to-app/search/navigation, and settings group labels are all more legible and vertically relaxed than the current screenshots.
- This batch changes only shared chrome that both products own. It does not add Profile, billing, Log Out, or other Codex-only navigation/actions.

Call-point audit:

- Titlebar trigger ownership is `packages/overlay/src/styles/surfaces/titlebar.css` under `[data-ui="titlebar-menubar-trigger"]`; File panel geometry and trigger tests live in `titlebar-menu-order.test.ts`, `titlebar-menubar-primitive.test.ts`, and browser titlebar tests.
- Settings navigation ownership is `packages/overlay/src/styles/surfaces/settings.css` under `.config-back-button`, `.config-search`, `.config-nav-group-title`, `.config-sidebar .oc-tab`, and `.config-nav-icon`.
- The ordinary app sidebar already uses 18px Codex-scale static actions and is not part of this batch.

Acceptance for this batch:

- Settings back/search/nav labels and icons match the reference's readable scale without overflowing the 444px rail.
- Titlebar menu labels and navigation buttons match the reference's scale while preserving the single File/Edit/View/Help source and window-control geometry.
- Existing keyboard/menu semantics remain intact; real 1902x1314 settings, File-menu, and home screenshots are regenerated and inspected.

## Round 6 Evidence

Status: implementation and primary-agent visual review complete; independent adjudication pending.

Closed batch:

- Settings Back to app is now 42px/18px, search is 44px with 16px input text and 17px icon, group labels are 16px, and navigation tabs are 42px/17px with 20px icons.
- Titlebar navigation and File/Edit/View/Help triggers now use 30px targets; menu trigger text is 19px. Menu rows are 44px with 16px command text and 14px shortcuts.
- File menu remains exactly New Window, New Chat, Quick Chat, Open Folder, Close, Settings, and Exit. No unsupported account or Log Out action was introduced.
- Responsive browser assertions now compare token geometry through the computed `--ui-scale` rather than incorrectly requiring base-scale pixels at a 1024px stress viewport.
- The sandbox popup denial emitted by Chromium is captured as an expected security diagnostic and asserted exactly once; all other console errors remain failures.

Authoritative evidence:

- `packages/overlay/.scratch/config-dialog-resizer.png` and `packages/overlay/.scratch/titlebar-file-menu-on-conversation.png` were regenerated at 1902x1314 and visually inspected against references 2 and 3.
- `node test/browser-runner.mjs test/browser/config-dialog-resizer.test.ts test/browser/titlebar-menu-order.test.ts` passed after the scale-aware assertion correction.
- `node test/browser-runner.mjs test/browser/chat-bubble-disclosure-button-browser.test.ts` passed and regenerated the full-window File menu artifact.
- `bun test test/config-panel-sizing.test.ts test/titlebar-menubar-primitive.test.ts test/settings-primitives.test.ts test/message-embed.test.ts` passed 68 tests.
- `bun run typecheck` and `git diff --check` passed.

New differences found for a later batch:

- The settings rail still has tighter inter-group spacing than reference image 2, but its twelve truthful OpenCorvus entries now nearly fill the viewport; spacing must be evaluated with scroll behavior rather than increased blindly.
- Command palette reference image 4 still has a deeper chat list and stronger group rhythm than the latest OpenCorvus artifact.

Focused Round 6 first independent adjudication result: NOT ACCEPTED.

- P1: File-menu item height and panel gap compounded into a menu taller than the reference even though OpenCorvus has one fewer item.
- P2: 16px command text, 14px shortcuts, and 16–17px settings search/group/tab labels remained visibly undersized.
- P3: browser tests only enforced lower bounds and did not constrain total menu height, shortcut size, or reference-like typography ranges.

Corrections after the rejection:

- File-menu panel gap is now zero, normal items are 40px, separators own 12px vertical breathing room, command text is 17px, and shortcut text is 15px. The regenerated seven-command menu is about 360px tall rather than about 422px.
- Settings Back is 19px, search is 18px with a 19px icon, group labels are 18px, and tabs are 19px while retaining the already accepted 42px row height.
- Browser tests now measure total File-menu height, upper and lower item-height bounds, shortcut font size, and bounded settings typography ranges. Responsive titlebar checks continue to use computed `--ui-scale`.
- The 1902x1314 settings and File-menu screenshots were regenerated again and visually reviewed; all truthful entries remain visible and untruncated.

Focused Round 6 second independent adjudication result: ACCEPTED. The adjudicator confirmed the corrected settings typography, titlebar trigger scale, File-menu height/rhythm, bounded browser coverage, seven truthful commands, and continued exclusion of Log Out.

## Round 7 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- Reference image 4 shows nine recent chats before later groups. The current full-data browser fixture has nine truthful ledger rows, but `CommandPalette` truncates them to eight after already requesting twelve.
- Command-palette input, group labels, chat titles, project hints, and shortcut chips remain one typography tier smaller than the reference.
- The group label is currently a prefix inside the first selectable option. When the first option is highlighted, the row background also paints behind the `Chats` heading; the reference keeps group headings visually independent from row selection.
- Unread grouping remains out of scope because the work-ledger contract has no unread field. It must not be fabricated as UI-only state.

Call-point audit:

- Data ordering and the `slice(0, 8)` cap are owned by `packages/overlay/src/components/CommandPalette.tsx`; no second palette data source exists.
- Group-start markup is emitted through the shared `ComboboxControl` prefix slot and styled only by `packages/overlay/src/styles/surfaces/cmdk.css`.
- Full-list browser evidence and fixtures live in `packages/overlay/test/browser/command-palette.test.ts`; component structure guards live in `command-palette-primitive.test.ts`.

Acceptance for this batch:

- Up to nine truthful chat/task ledger rows display before Suggested; no unread or fake row is added.
- Input, group label, row label/hint, and shortcut typography match reference image 4 without increasing row height or overflowing the 780px panel.
- Highlighting the first item paints only the selectable row lane, not its group heading.
- Browser tests cover nine rows, panel bounds, typography, shortcut geometry, group-label background, keyboard selection, and regenerated screenshot review.

## Round 7 Evidence

Status: implementation and primary-agent visual review complete; independent adjudication pending.

Closed batch:

- Work-ledger projection now displays up to nine truthful chat/task rows after requesting twelve, instead of discarding the ninth row through an arbitrary eight-item cap. Shortcut assignment naturally reaches `Ctrl+9`.
- Command input is 18px, chat labels 17px, group labels and project hints 15px, and shortcut chips 14px; row height remains 46px and panel width remains capped at 780 token pixels.
- A group-start option keeps its own background transparent when highlighted. A 46px bottom pseudo-element paints only the selectable row lane, while group, label, and hint content remain above that paint through one CSS owner.
- The browser test's retired `body.dataset.theme` read was replaced with the actual single theme owner, `document.documentElement.dataset.theme`.

Authoritative evidence:

- `packages/overlay/.scratch/command-palette-first-highlight.png` shows nine recent records, `Ctrl+1` through `Ctrl+9`, a transparent `Chats` heading, and row-only first-item highlight.
- `packages/overlay/.scratch/command-palette-dialog-primitive.png` shows the same list after keyboard navigation, with Suggested and New chat below it.
- `node test/browser-runner.mjs test/browser/command-palette.test.ts` passed the delayed-ledger, nine-row, typography, row-paint, keyboard navigation, Escape, and focus-restoration flow.
- `bun test test/command-palette-primitive.test.ts test/menu-group-typography.test.ts` passed 14 tests.
- `bun run typecheck`, `git diff --check`, and the 20 historical-doc link tests passed.

Remaining truthful variance:

- The reference includes an Unread chats group. OpenCorvus work-ledger rows expose no unread field, so the group is intentionally absent rather than synthesized. The panel is consequently shorter than the reference by that group and row.

Focused Round 7 first independent adjudication result: NOT ACCEPTED.

- P1: `Ctrl+1` through `Ctrl+9` were displayed but had no keyboard behavior.
- P1: the earlier call-point audit was incomplete. `boardStore.tasks` was a second Chats source and could append a tenth row after the nine-row ledger slice.
- P1: the fixed-height absolute pseudo-element still painted behind part of the `Chats` heading instead of owning a separate geometric row.
- P2: 18/15/17/15/14px input/group/label/hint/shortcut typography remained visibly below reference image 4.
- P3: the browser test counted only `ledger:` rows and did not exercise a digit shortcut or compare group-title and highlighted-row bounds.

Corrections after the rejection:

- The command palette now projects Chats exclusively from the work ledger. The `boardStore.tasks` import and append loop were deleted; empty-query projection allows only `ledger:` rows plus the truthful `task:new` Suggested action.
- `Ctrl+1` through `Ctrl+9` are registered through the shared `useHotkey` owner and execute the corresponding ledger command. The browser fixture now proves `Ctrl+1` reaches the real `/coding/session/ses_visual_qa` selection route.
- Group title and selectable row now occupy separate CSS Grid tracks. The highlight pseudo-element is a second-track grid child rather than an absolutely positioned fixed-bottom paint, and the browser test asserts the highlighted label starts at or below the group title's lower bound.
- Input/group/label/hint/shortcut typography is now 20/17/19/17/16px. The selected row lane is 50px, while the panel remains within its 780px token-width and 64% shell-height bounds.
- The browser test asserts exactly nine Chats options, every one `ledger:`-owned, and validates the real digit shortcut path. Static tests prohibit the retired board-store source.

Updated authoritative evidence:

- `packages/overlay/.scratch/command-palette-first-highlight.png` and `packages/overlay/.scratch/command-palette-dialog-primitive.png` were regenerated at 1902x1314 and visually compared directly with reference image 4. The group heading is now visibly outside the first-row highlight.
- `node test/browser-runner.mjs test/browser/command-palette.test.ts` passed the full Chromium flow, including the actual `Ctrl+1` request.
- `bun test test/command-palette-primitive.test.ts test/menu-group-typography.test.ts` passed 15 tests; `bun run typecheck` and scoped `git diff --check` passed.

Focused Round 7 second independent adjudication result: ACCEPTED. The adjudicator confirmed the exclusive work-ledger source, real `Ctrl+1..9` execution, separate group/highlight Grid tracks, reference-scale typography, and direct browser coverage.

## Round 8 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- Reference image 5 uses approximately 20px conversation prose with a relaxed 33–35px line box. OpenCorvus conversation agent text currently resolves to the 15px title token, while user text falls through to the 14px body token.
- Inline code in the reference remains close to surrounding prose size. OpenCorvus conversation code resolves to the global 13px code token and therefore looks detached and too dense.
- The accepted transparent message shell, hover-only toolbar, collapsed work details, and typed sandboxed embed are correct and must remain unchanged.

Call-point audit:

- Base `.msg-text` and shared Markdown structure are owned by `messages.css` and `markdown.css`, but those selectors also serve cards, settings Markdown, reminders, and inspector surfaces. Raising their global tokens would regress already reviewed UI.
- Conversation-only role projection and body ownership are centralized in `packages/overlay/src/styles/surfaces/chat-bubble.css`; no other conversation selector sets message body size except the existing agent-only 15px rule there.
- Browser evidence and the real Markdown/embed fixture are centralized in `packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`; static ownership checks live in `chat-bubble-role-distinction.test.ts`.

Acceptance for this batch:

- Agent and user conversation prose resolve to 20px at base scale with at least a 33px paragraph/list line box.
- Conversation inline code resolves to 18px and fenced code to 16px without changing Markdown typography outside chat bubbles.
- A real rendered Markdown list and inline-code fixture proves rich text at the target scale beside the existing sandboxed iframe extension.
- Transparent rest/hover surfaces, hidden-at-rest metadata, collapsed reasoning/tools, iframe sandboxing, and composer geometry remain unchanged in browser assertions and regenerated screenshots.

## Round 8 Evidence

Status: implementation and primary-agent visual review complete; independent adjudication pending.

Closed batch:

- Conversation agent and user `.msg-text` now resolve to a 20px base-scale body with 1.7 line height. The rule is scoped to chat bubbles, so global body, sidebar, settings, reminder, and inspector typography are unchanged.
- Conversation paragraphs and ordered/unordered lists retain the 1.7 line box. Inline code resolves to 18px and fenced code to 16px while continuing to use the shared safe Markdown renderer.
- The real browser fixture now contains a rendered paragraph, bold span, unordered list, and inline code beside the existing typed iframe embed. No raw Markdown HTML path was added.
- The existing browser assertions still prove a transparent, borderless, shadowless message surface at rest and hover; metadata/actions are hidden at rest, reasoning/tools default collapsed, and the iframe cannot read the parent document or open a popup.

Authoritative evidence:

- `packages/overlay/.scratch/overlay-codex-conversation-default.png` and `packages/overlay/.scratch/overlay-codex-conversation-hover.png` were regenerated at 1902x1314 and directly compared with reference image 5. Content starts on the same message lane and now has comparable prose/code scale and line rhythm.
- `node test/browser-runner.mjs test/browser/chat-bubble-disclosure-button-browser.test.ts` passed after changing the typography checks to compare against the actual computed `--ui-scale`; at the 1.04 test scale it measured 20.8px prose, 35.36px line boxes, and 18.72px inline code.
- `bun test test/chat-bubble-role-distinction.test.ts test/chat-bubble.test.ts test/message-embed.test.ts` passed 10 tests. `bun run typecheck` and scoped `git diff --check` passed.

Focused Round 8 independent adjudication result: ACCEPTED. The adjudicator confirmed reference-scale body and code typography, real inline Markdown rendering, transparent rest/hover/focus surfaces, collapsed work details, restrictive iframe behavior, and chat-only CSS scoping.

## Round 9 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- In references 3 and 5, the conversation content header occupies approximately 77–79px below the global titlebar. The regenerated OpenCorvus conversation header occupies only about 41px.
- The reference `Open in` control is approximately 44px high with a larger label/icon, while the current control and adjacent view buttons remain compact panel controls.
- This batch is limited to the shared conversation header's vertical rhythm and control scale. It must not change the accepted global titlebar, message body, or composer.

Call-point audit:

- The shared `oc-surface-header` primitive is globally tokenized at 40px and serves sidebar, notification, task-scope, and settings headers. It must remain unchanged globally.
- The conversation specialization is the existing `.chat-header.oc-surface-header` hook in `header.css`; it can override header custom properties without introducing a second structure.
- Header placement and the `Open in` split launcher/right-toolbar toggle are owned by `App.tsx`, `WorkspaceEditorLaunchers.tsx`, `ChatHeaderRightToolbarToggle.tsx`, and their existing `conversation.css` selectors. No new action or duplicate control is needed.
- Real header behavior, geometry, right-toolbar state, and screenshots are already covered by `titlebar-toolbar-toggle-browser.test.ts`.

Acceptance for this batch:

- Conversation header resolves to 74px base height, 24px horizontal padding, 14px internal gap, and a 20px semibold title while all other shared surface headers retain their current token geometry.
- `Open in` resolves to a 44px control with 18px label, 20px editor icon, and 16px caret; the truthful right-toolbar toggle resolves to 42px with a 22px icon.
- Existing ordering, disabled state, editor launch behavior, right-toolbar toggle behavior, titlebar ownership, and responsive containment continue to pass.
- Regenerated full conversation and focused header screenshots are visually compared with references 3 and 5 before independent adjudication.

## Round 9 Evidence

Status: implementation and primary-agent visual review complete; independent adjudication pending.

Closed batch:

- Only the conversation header specialization now overrides shared header tokens: 74px base height, 24px horizontal padding, 14px gap, and a 20px semibold title. Sidebar, settings, notification, and other shared headers remain on the canonical 40px token.
- The existing editor launcher is 44px with an 18px label, 20px editor icon, 16px caret, and a 40px menu segment. The existing right-toolbar toggle is 42px with a 22px icon. No reference-only action was added.
- Header behavior still keeps task status beside the title, usage before editor actions, and the editor launcher before the explicit right-toolbar toggle. The right toolbar remains closed until clicked.
- The browser fixture was corrected to follow the real user path: discovery exposes the owning project, work ledger exposes the task row, and the test clicks that row before observing the header. It no longer calls `selectTask` before discovery or waits for a header that the empty-home contract intentionally hides.
- Two stale test assumptions were removed: status is not centered in the header, and right-toolbar button height is not coupled to the taller conversation header. The new assertions require status containment and no overlap with usage/actions.

Authoritative evidence:

- `packages/overlay/.scratch/overlay-codex-conversation-default.png` was regenerated at 1902x1314 and compared directly with references 3 and 5. The content header now occupies approximately the same vertical band, and its title/editor control start points closely align with the reference.
- `packages/overlay/.scratch/codex-message-header-toolbar-closed.png` and `codex-message-header-toolbar-open.png` prove the focused header and explicit right-toolbar transition at 1280x760.
- `node test/browser-runner.mjs test/browser/titlebar-toolbar-toggle-browser.test.ts` and `node test/browser-runner.mjs test/browser/chat-bubble-disclosure-button-browser.test.ts` passed.
- `bun test test/surface-header-primitive.test.ts test/composer-file-loader-right-toolbar.test.ts test/workspace-editor.test.ts` passed 19 tests; `bun run typecheck`, scoped `git diff --check`, and 20 historical-doc tests passed.
- i18n follow-up: the panel-root refactor changed the canonical revision, so both locale `_meta.panel_revision` values were synchronized to `75d1db26184bae91`. The checker then identified obsolete `expert_squad.selector_label` and `expert_squad.selector_title` keys from the retired separate selector; both were deleted from `en-US` and `zh-CN`, and the stale expert-squad assertion was updated to the actual `squad.display_label` projection.
- `bun run check:i18n` passed. The panel script, runtime contract, identical locale-key set, no-string-fallback policy, asset-base loading, and expert-squad locale tests passed in isolated processes: 19 tests total.

Focused Round 9 independent adjudication result: ACCEPTED. The adjudicator confirmed the conversation-only token override, truthful control inventory, reference-scale header and launcher geometry, non-overlapping ordering, explicit right-toolbar behavior, and real ledger selection path.

## Round 10 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- A second direct screenshot comparison confirmed the existing composer shell height already falls within the reference range after scale and padding; increasing it would be a false correction.
- The real remaining difference is the bottom control row: OpenCorvus intent/model values resolve to 12px and 26px-tall triggers, while reference image 5 uses approximately 17–18px text with larger menu controls. The attachment plus and send arrow are also one icon tier smaller.
- This batch is limited to the normal conversation composer's control typography and affordance scale. It must preserve the accepted width, height, bottom offset, Chat/expert-squad single selector, resize behavior, and all localized labels.

Call-point audit:

- `ChatComposer.tsx` owns the combined intent `SelectControl`, attachment trigger, and send action. `ExecutorSelector.tsx` owns the model trigger. They remain the only component sources.
- `composer.css` is the single geometry/typography owner for intent/model values, attachment action, caret, and send icon. Existing container queries preserve the one-row layout.
- `workspace-composer-density.test.ts`, `chat-composer-button-primitives.test.ts`, `expert-squad-selector-browser.test.ts`, and the full conversation browser fixture cover the shared controls, mutual exclusion behavior, both locales, and visual geometry.

Acceptance for this batch:

- Intent and model values resolve to 17px base with 32px triggers; the intent/model caret is 16px, attachment button is 32px with a 22px plus, and send is 42px with an 18px arrow.
- The model trigger visibly communicates its popup behavior through the existing caret icon primitive.
- Chat and expert squads remain mutually exclusive in one selector; plain Chat still submits without `promptProfile`, and both locale option lists remain readable without overflow.
- `check:i18n`, locale/runtime tests, focused composer tests, and regenerated full-page/control screenshots pass before independent adjudication.

## Round 10 Evidence

Status: implementation and primary-agent visual review complete; independent adjudication pending.

Closed batch:

- Combined intent and model values now resolve to 17px at base scale, with 32px triggers. The intent icon is 18px and caret 16px; the model trigger now includes the same familiar caret affordance rather than relying on text alone.
- The attachment action is 32px with a 22px plus. Send/stop actions are 42px with 18px icons. Existing one-row layout, responsive truncation, disabled state, and Button/Select/Popover primitives remain intact.
- No second Mission selector or separate expert-squad control was introduced. The browser flow still proves Chat and expert squad are mutually exclusive and that Plain Chat submits without a `promptProfile`.
- No visible product string was added. Existing `t(...)` labels and both locale option descriptions remain the only copy sources.

Authoritative evidence:

- `packages/overlay/.scratch/overlay-codex-conversation-default.png` was regenerated at 1902x1314 and compared with reference image 5. The bottom control row now has comparable visual weight while composer width, depth, and bottom offset remain stable.
- `packages/overlay/.scratch/chat-composer-button-primitives.png` proves the exact action/control geometry and focus state in an isolated rendered surface.
- `node test/browser-runner.mjs test/browser/chat-composer-button-primitives.test.ts`, `expert-squad-selector-browser.test.ts`, and `chat-bubble-disclosure-button-browser.test.ts` passed 5 real browser tests, including `en-US`, `zh-CN`, and the plain-Chat payload path.
- `bun test test/workspace-composer-density.test.ts test/composer-file-loader-right-toolbar.test.ts test/executor-settings.test.ts` passed 32 tests; `bun run typecheck`, `bun run check:i18n`, and scoped `git diff --check` passed.

Focused Round 10 independent adjudication result: ACCEPTED. The adjudicator confirmed the unchanged reference-range shell depth, one mutually exclusive intent selector, scaled intent/model/attachment/send controls, plain-Chat payload isolation, bilingual popup containment, and successful i18n checker.

## Round 11 Plan

Status: queued; the full parity goal remains active and unaccepted.

Selected difference batch:

- In references 1, 3, 4, and 5, the left rail's New chat, search, group headings, project label, and conversation titles use a stronger 19–21px reading scale. The regenerated OpenCorvus rail still renders several of these at 14–18px.
- This batch will audit and adjust only left-rail typography, row height, icon alignment, and truncation. It must preserve the accepted 445px rail width, truthful OpenCorvus sections/actions, work-ledger single source, selection behavior, and both locale contracts.
- `bun run check:i18n` plus locale/runtime tests remain mandatory before visual adjudication even if the batch adds no strings.

Call-point audit:

- `WorkLedger.tsx` is the only left-rail navigation/search/section/project-row composition source and continues to use existing `t(...)` keys and `LedgerList` data.
- `sidebar.css` owns static navigation and `ProjectLedgerGroup` typography. `work-ledger.css` owns search specialization, section labels, work-row typography, timestamps, and kind marks. The shared `field.css` search primitive remains unchanged for non-ledger surfaces.
- `command-palette.test.ts` already owns the 1902x1314 empty-home rail screenshot and computed rail metrics. `project-ledger-group-browser.test.ts` and `ledger-scrollbar-browser.test.ts` cover group interactions and overflow behavior.

Acceptance for this batch:

- Static navigation resolves to 20px/44px with 20px icons; ledger search resolves to 17px/36px with a 17px icon; section labels resolve to 20px.
- Project headings resolve to 18px/34px, conversation rows to 19px/42px, kind marks to 17px, and timestamps to 15px while long names still ellipsize.
- Hover/focus action rails, selected states, project collapse/new-chat actions, visible scrollbar, keyboard focus restoration, and the 445px rail width remain intact.
- No visible strings change; formal i18n checker and runtime/locale contract tests still pass before independent adjudication.

Round 11 implementation and verification evidence:

- `sidebar.css` now owns the Codex-scale static navigation and project typography: 20px/44px navigation rows with 20px icons, plus 18px/34px project rows. `work-ledger.css` owns the corresponding 17px/36px search, 20px section labels, 19px/42px conversation rows, 17px kind icons, and 15px timestamps. The accepted 445px rail width and shared field primitive were not changed.
- `work-ledger-consolidation.test.ts` records those ownership and metric contracts. The focused static suite passed 6 tests with 162 assertions, and `bun run typecheck` passed.
- `node test/browser-runner.mjs test/browser/command-palette.test.ts test/browser/project-ledger-group-browser.test.ts test/browser/ledger-scrollbar-browser.test.ts` passed all 3 real-browser scenarios. It verified computed scale-aware metrics, Ctrl+1 navigation and focus restoration, project grouping/actions, ellipsis, selected rows, and the visible scrollbar.
- `packages/overlay/.scratch/overlay-empty-home-composer-light.png`, `project-ledger-group-work-ledger.png`, and `work-ledger-scrollbar-visible.png` were regenerated and visually compared with references 1, 4, and 5. The larger rail hierarchy no longer reads undersized and does not overlap at desktop or narrow rail widths.
- `bun run check:i18n` passed with panel revision `75d1db26184bae91`. Separate locale checks passed: asset loading 3 tests, runtime/panel/fallback/discipline 11 tests, and expert-squad locale/settings 5 tests. The first attempted runtime command named retired test files and executed zero tests; it was rejected as evidence, the actual files were enumerated from disk, and the corrected 11-test command passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed 20 documentation-health tests. No visible product copy or locale key was added or changed in this batch.

Round 11 independent adjudication correction:

- The first independent adjudication returned `REJECTED`, correctly identifying a visible post-`Ctrl+1` error notification in `overlay-empty-home-composer-light.png`. The browser test had proved only that `/coding/session/ses_visual_qa` was requested, not that conversation hydration completed successfully.
- Root cause: the fixture returned `history.limit: 0`, while the production `parseHistoryState` contract requires a positive integer. The fixture now returns the real 160-item history limit, waits for the selected conversation title and completed loading state, and asserts there are no warning/error notifications before capturing the screenshot. This is a fixture contract repair and success-path assertion, not notification suppression.
- The corrected focused browser test passed, the regenerated screenshot contains no notification, and the second independent adjudication returned `ACCEPTED`. The adjudicator confirmed the active ledger row, settled progress signal, retained 445px rail, accepted typography metrics, ellipsis, selected states, action space, and scrollbar behavior.

## Round 12 Plan

Status: queued; the full parity goal remains active and unaccepted.

Selected difference batch:

- Reference 1 presents workspace/project context as a quiet secondary strip directly attached beneath the empty-home composer. OpenCorvus currently presents `Project context ready` as a separate rounded, shadowed notice card, giving secondary information the same visual weight as the composer.
- Adapt the existing truthful OpenCorvus project-context content into a subdued composer-width support strip while preserving its translation keys and semantic label. Suggestions remain below it and the established title -> composer -> context -> suggestions order remains unchanged.
- Correct the browser evidence timing: the empty-home screenshot must be captured while `data-empty-chat-home=true`, before command-palette selection. A separate post-`Ctrl+1` assertion continues to prove successful navigation without errors; it must not overwrite the empty-home artifact.

Call-point audit:

- `Conversation.tsx` is the only owner of `.chat-home-notice` content and existing i18n keys. `conversation.css` is the only owner of its visual treatment and empty-home absolute composition.
- `command-palette.test.ts` already measures the true empty-home title, composer, notice, and suggestions before opening the palette, but currently writes the named empty-home screenshot after session selection. The artifact timing and visual assertions must be aligned to the same state.
- No locale values or keys are expected to change. `check:i18n`, runtime locale contracts, the focused Node browser test, visual inspection, and independent adjudication remain mandatory.

Round 12 implementation and verification evidence:

- `.chat-home-notice` is now a quiet support strip: no outer border, no shadow, only a soft top divider, inset background, and lower-corner radius. Existing project-context copy, icon, semantic label, and i18n keys are unchanged.
- `.chat-home-after` now uses the full message-lane width minus the real scrollbar slot instead of 76%. The first browser run measured composer 1107px versus support strip 1089px and failed the new <=8px alignment contract; changing the lane reduction from 32px to 14px made the focused real-browser test pass without widening the assertion.
- `command-palette.test.ts` now proves `data-empty-chat-home=true`, support-strip border/shadow geometry, composer-width alignment, and captures `overlay-empty-home-composer-light.png` only after Work Ledger rows are fully loaded and the command palette is closed. It reopens the palette for the separate `Ctrl+1` success path and saves that state to `overlay-conversation-after-shortcut.png`.
- The source PNG is fully opaque and pixel samples confirm the light canvas. The local original-resolution image viewer intermittently displayed black tiles for this large PNG; standard rendering and direct pixel inspection showed this was a viewer artifact, so no product background change was made.
- The focused Node browser test passed. `bun run typecheck`, scoped `git diff --check`, `bun run check:i18n` revision `75d1db26184bae91`, i18n asset tests 3/3, and runtime/panel/fallback/discipline tests 11/11 passed.
- The original adjudicator became unresponsive across two six-minute waits and a two-minute interrupted-verdict wait; no conclusion was inferred from those timeouts. A replacement independent read-only adjudicator completed and returned `ACCEPTED`, confirming the true empty-home capture, stable loaded ledger, subordinate support strip, approximately 4px width alignment, and separate shortcut evidence. It noted one remaining visual difference: the strip sits slightly farther below the composer and reads denser than the reference.

## Round 13 Plan

Status: queued; the full parity goal remains active and unaccepted.

Selected difference batch:

- Tighten only the empty-home composer-to-support-strip vertical relationship and support-strip information density identified by the Round 12 adjudicator. Preserve the accepted width alignment, semantics, existing translation keys, composer geometry, and suggestions below.
- Measure and assert the inter-surface gap and support-strip height/type scale against reference 1 rather than relying on visual impression. Capture the stable empty-home state again and repeat formal i18n/runtime checks before independent adjudication.

Round 13 implementation and verification evidence:

- `.chat-home-after` moved upward by 12 design pixels, reducing the measured composer-to-strip gap from 20px to the 4–12px contract. `.chat-home-notice` now uses a 56px base height and its existing title/body keys render on one baseline; the body owns ellipsis for constrained widths.
- The browser contract now measures support-strip height against `uiScale`, verifies flex single-line layout, <=3px baseline offset, ellipsis ownership, and the tighter gap while preserving the Round 12 width/chrome contracts.
- The first browser attempt read stale `dist-vite` evidence (`display:grid`, 64px height, 20px gap) and failed. The explicit project build regenerated Vite successfully and passed `check:i18n`, SDK generation, server build, and Tauri compilation, but its final binary-copy step failed with `EACCES` because the running Overlay owns `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe`. The running process was not stopped or restarted. The regenerated `dist-vite` was then used by the original Node browser test, which passed.
- `overlay-empty-home-composer-light.png` was regenerated from the stable loaded-ledger empty state. Visual review shows an approximately 8px composer-to-strip gap, one-line context content, no overlap, and retained composer/support/suggestion alignment.
- `bun run typecheck`, scoped `git diff --check`, `bun run check:i18n` revision `75d1db26184bae91`, i18n asset tests 3/3, and runtime/panel/fallback/discipline tests 11/11 passed. The first historical-doc health run had one fixed 5-second scratch scan timeout during build load; an unchanged rerun passed all 20 tests with that scan completing in 640ms.
- Independent Round 13 adjudication returned `ACCEPTED`, confirming the approximately 8px gap, one scaled 56px baseline, body-owned ellipsis, retained width/chrome/suggestion contracts, and accurate build-lock disclosure.

## Round 14 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- Reference 2 and OpenCorvus both expose a General -> Permissions surface, but the current OpenCorvus permission rows are approximately 86px tall with small green tri-state controls, while the reference uses roughly 112–125px rows and a consistent blue selected-control emphasis.
- Preserve the real OpenCorvus `allow | ask | deny` model rather than replacing it with a false binary switch. Scope the style change only to the permissions group: 112px base rows, 19px titles, 17px descriptions, 36px segmented buttons, and accent-colored selected state.

Call-point audit:

- `PermissionsPanel.tsx` is the only owner of the six tool-permission rows and immediate PATCH behavior. It receives a semantic `permissions-settings-group` class; no permission key, translation key, action value, or request path changes.
- `settings.css` owns both shared `.s-*` primitives and dialog density overrides. Round 14 adds higher-specificity permissions-only overrides so notification/database/provider rows are unaffected.
- `config-dialog-resizer.test.ts` owns the 1902x1314 settings screenshot and already measures all six permission rows, typography, and segmented geometry. It will assert the new scale and selected accent colors while existing accessibility tests continue to verify per-row names.
- `check:i18n`, locale runtime tests, focused Node browser screenshots, and independent adjudication remain mandatory.

Round 14 implementation and verification evidence:

- `PermissionsSettingsGroup` now provides the semantic `permissions-settings-group` scope. Six permission keys, `allow | ask | deny` options, immediate PATCH behavior, and all visible translation keys remain unchanged.
- Permissions-only dialog CSS resolves to 112px base rows, 19px titles, 17px descriptions, 36px segmented buttons, and accent/white selected controls. Other settings groups keep their existing density and semantic control colors.
- The first real-browser run proved the accent selected state but rejected stale 86px/31px geometry because the general-panel selector had higher specificity. The permissions selector was corrected to include the same panel scope; no assertion was relaxed. The second run passed geometry and failed only because computed RGB was compared with the raw hex token. The test now resolves both tokens through browser computed styles, and the unchanged color-equality assertions pass.
- `config-dialog-resizer.png` and `config-dialog-resizer-round14.jpg` were regenerated at 1902x1314. Visual review confirms reference-like permission row breathing room, stronger typography, blue selected emphasis, no overlap, and retained sidebar/content geometry.
- Focused browser tests passed 2/2, including per-row accessible names. Static settings/expert-squad tests passed 45/45; `bun run typecheck`, Vite build, scoped `git diff --check`, `check:i18n` revision `75d1db26184bae91`, i18n asset 3/3, runtime/panel/fallback/discipline 11/11, and documentation health 20/20 passed.
- Independent Round 14 adjudication returned `ACCEPTED`, confirming preserved tri-state semantics, permission-only 112/19/17/36 geometry, exact accent selected colors, scoped overrides, and reference-like composition without overlap.

## Round 15 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- The user explicitly requires collapsed tool calls and reasoning to leave only body content visible. Current chat bubbles hide the work-detail body but keep the `Work details` disclosure label permanently visible at rest, adding non-body chrome absent from reference 5.
- Keep work details collapsed and make only the collapsed disclosure trigger hover/focus-revealed. Expanded work details must keep the trigger visible so users can collapse it again. The transparent message surface, body typography, iframe extension, and tool/reasoning renderer remain unchanged.

Call-point audit:

- `CardParts.tsx` remains the single owner of work-detail classification and disclosure state. No second renderer or visibility data source is added.
- `messages.css` owns the disclosure trigger chrome. Chat-bubble-scoped selectors hide only collapsed triggers at rest and reveal them through the existing bubble hover/focus-within interaction; non-chat uses of `CardParts` remain unchanged.
- `chat-bubble-disclosure-button-browser.test.ts` owns the real body/tool/reasoning fixture and default/hover/expanded screenshots. It will assert hidden-at-rest, visible-on-hover, keyboard-compatible discovery, and successful expansion. `message-embed.test.ts` records the static CSS contract.
- No copy or locale key changes. Formal i18n and runtime locale checks remain mandatory before independent adjudication.

Round 15 implementation and verification evidence:

- Chat-bubble-scoped CSS now renders a collapsed `work-details-toggle` at zero opacity and with pointer events disabled. Bubble hover or focus-within restores full opacity and pointer interaction; `data-expanded=true` remains outside the hiding selector and therefore keeps the collapse affordance visible.
- An initial implementation also used `visibility:hidden`; self-review rejected it because hidden elements leave the keyboard focus order. The final contract keeps the zero-opacity button focusable. The real browser test focuses it directly, verifies focus-within disclosure, blurs it, and verifies it returns to the hidden-at-rest state.
- The first browser run correctly timed out because Playwright `waitForSelector` defaults to `visible`; the fixture now waits for `state:"attached"` and lets explicit visibility assertions own behavior. No product rule or acceptance threshold was relaxed.
- Regenerated default, hover, and expanded screenshots prove the three states: `overlay-codex-message-expanded-default.png` contains body/rich embed only; `overlay-codex-message-hover-toolbar.png` reveals the collapsed `Work details` affordance; `overlay-codex-tool-reasoning-expanded.png` keeps the trigger and renders reasoning/tool details.
- Full focused browser coverage passed 1/1, including body typography, iframe sandbox, hover toolbar, copy, keyboard focus, menu/palette, and expanded tool/reasoning paths. Static message tests passed 9/9 with 83 assertions; TypeScript and Vite build passed.
- `check:i18n` revision `75d1db26184bae91`, i18n asset 3/3, runtime/panel/fallback/discipline 11/11, documentation health 20/20, and scoped `git diff --check` passed. No visible copy or locale file changed.
- Independent Round 15 adjudication returned `ACCEPTED`, confirming body/embed-only rest state, hover and keyboard-focus disclosure, blur hiding, expanded reasoning/tool rendering, single `CardParts` renderer ownership, and retained iframe restrictions.

## Round 16 Plan

Status: in progress; the full parity goal remains active and unaccepted.

Selected difference batch:

- The Round 15 adjudicator identified expanded reasoning/tool output as more framed and technically dense than Codex's quiet transcript treatment. Flatten only the already-expanded work-detail internals while preserving the collapsed/rest/hover behavior accepted in Round 15.
- Reasoning becomes borderless transparent inline content. The nested tool card loses outer border/background/radius and header separator. Tool output keeps monospace content and a subtle left divider as the only structural marker.

Call-point audit:

- `CardParts.tsx`, `ReasoningPart`, and `Card` remain the existing renderer/state owners; no component or data-flow fork is added.
- `messages.css` receives selectors scoped to `.chat-bubble .msg-work-details__body`, so tool cards outside expanded chat work details retain their normal card contract.
- The existing full message browser fixture already expands both reasoning and tool output. It will measure reasoning, tool shell, header, and output chrome before regenerating expanded screenshots. `message-embed.test.ts` records the scoped static CSS contract.
- No visible copy or locale key changes; i18n/runtime checks remain mandatory before independent adjudication.

## Round 17 — Desktop typography and density normalization

### Recall

| Item | Detail |
| --- | --- |
| User request | “UI现在字体大的离谱，缩放太严重了，正常UI长什么样你不知道吗” |
| Acceptance criteria | The standard desktop shell reads at a normal application scale: body/control text stays on the shared 14px baseline; titles and headings use the existing 15px/17px hierarchy; chat, sidebar, titlebar menus, command palette, and standard settings surfaces no longer introduce 17–20px body/control overrides; row and control geometry is reduced with the typography so the result is not merely smaller text inside oversized lanes; a real 1902x1314 browser screenshot is regenerated and visually reviewed. |
| Hard constraints | Preserve the shared typography single source and existing component semantics; no global zoom, CSS transform, fallback, compatibility alias, or parallel component tree; do not modify or restart the user’s running OpenCorvus/overlay; use an isolated fixture and Node Playwright for visual verification; preserve unrelated dirty worktree changes; update focused tests with the behavior change. |
| Sources read | `AGENTS.md`; this remediation record through Round 16; `specs/records/2026-07/2026-07-08-overlay-codex-font-size-alignment.md`; `specs/records/2026-07/2026-07-09-composer-height-font-adjustment.md`; `packages/overlay/src/styles/tokens/design-language.css`; `chat-bubble.css`; `sidebar.css`; `work-ledger.css`; `cmdk.css`; `titlebar.css`; `settings.css`; the current 1902x1314 `overlay-codex-conversation-default.png` screenshot. |
| Whole-repository grep evidence | `rg -n -S "font-size|line-height|min-height|height:" packages/overlay/src/styles/surfaces/{chat-bubble,sidebar,work-ledger,cmdk,titlebar,settings,composer}.css`; `rg -n -S "20px|19px|18px|17px|16px|15px|14px|fontSize|font-size"` across the focused static and browser tests. The oversized rules and their regression owners are enumerated below. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent visual review and a final diff/test review remain required. |

### Root cause and call-site disposition

The shared scale is not the problem: `--ui-font-body`, `--ui-font-control`, and `--ui-font-meta` are already 14px at `--ui-scale: 1`. The regression comes from later surface-specific overrides that bypass that scale and then multiply 17–20px literals by `--ui-scale`. Those overrides also raised row/control geometry, making the whole desktop shell read as zoomed.

| Owner | Current oversized contract | Disposition |
| --- | --- | --- |
| `chat-bubble.css` | 20px message prose, 18px inline code, 16px fenced code, 1.7 line height | Replace with shared body/code tokens and normal reading line height. |
| `sidebar.css` | 20px/44px static navigation and 18px/34px project rows | Replace with control/title tokens and compact desktop row geometry. |
| `work-ledger.css` | 17px search, 20px section labels, 19px/42px work rows, 15px stamps | Replace with control/small/meta tokens and compact row geometry. |
| `titlebar.css` | 19px triggers, 17px menu titles, 15px shortcuts, 40px menu rows | Replace with control/small tokens and standard menu-row geometry. |
| `cmdk.css` | 20px input, 19px rows, 17px group/hints, 16px shortcuts, 50px lanes | Replace with title/control/small/meta tokens and compact command rows. |
| `settings.css` | 18–19px rail controls; 16–19px standard setting copy; 76–112px standard rows | Keep the Expert Squads operational exception, but normalize the common settings rail and non-expert settings rows to the shared desktop scale. |
| Focused tests | Static regexes and browser bounds explicitly require the oversized values | Update to assert the shared token contract plus bounded compact row geometry; do not weaken assertions to lower bounds only. |

### Verification plan

1. Run focused static tests for typography ownership and surface geometry.
2. Run the conversation, command-palette, titlebar, work-ledger, and settings browser fixtures through the Node browser runner.
3. Run overlay typecheck, i18n check, Vite build, historical-doc links, and scoped `git diff --check`.
4. Inspect regenerated 1902x1314 screenshots at original resolution. If the page still reads enlarged or any label clips, continue adjusting and rerun.

### Round 17 result

- Root cause removed: the shared 14px typography scale remains the only body/control source, while the later 17–20px chat, navigation, menu, command-palette, and standard-settings overrides were replaced with the appropriate body/control/title/small/code tokens.
- Geometry was normalized with the type: titlebar 54→42px; desktop rail maximum 445→360px; static navigation 44→36px; Work Ledger rows 42→34px; command rows 50→40px; settings navigation 42→36px; standard permission rows 112→76px.
- The 1.04 browser-test scale now measures 14.56px body/control text, 15.6px titles, 12.48px secondary labels, and 13.52px code. Focused browser assertions contain both lower and upper bounds so later changes cannot pass by making the interface progressively larger.
- Visual review at the original 1902x1314 resolution passed for the conversation shell, empty home, command palette, and settings dialog. The left rail now occupies a normal desktop share, menu/sidebar copy no longer dominates the canvas, conversation prose is readable without presentation-scale line boxes, and no clipping or overlap was observed.
- Passed: 68 focused static tests; Node browser fixtures for chat disclosure, command palette, config dialog resizing, and grouped Work Ledger; Overlay TypeScript; panel i18n; Vite production build; historical documentation health (20/20); full-worktree `git diff --check`.
- The isolated Vite process used for inspection was stopped after verification. The user’s running OpenCorvus/overlay process was not restarted, refreshed, or otherwise modified.

## Round 18 — Compact typography and two-row OpenCorvus header

### Recall

| Item | Detail |
| --- | --- |
| User request | “缩放还是太大了，还要缩小字体，而且OpenCorvus的商标要这样布局，header也要相应调整” with a reference crop showing navigation and File/Edit/View/Help on the first row, then a separate rounded `ChatGPT Codex` brand/context pill on the second row. |
| Acceptance criteria | Body/control/meta text moves from the 14px baseline to a compact 13px desktop baseline with ordered 20/16/14/13/11/10/12px display/heading/title/body-small-tiny-code tiers; the titlebar becomes two explicit rows; back/forward plus File/Edit/View/Help and window controls stay on the first row; the second row contains one OpenCorvus brand/context pill using the existing accessible Kobalte Popover trigger; `OpenCorvus` is the primary wordmark and the existing localized workspace label is the accent context; screenshots show no clipping, overlap, accidental third row, or oversized typography. |
| Hard constraints | No global CSS zoom/transform; no duplicate titlebar or second brand implementation; keep Kobalte Menubar/Popover and existing navigation semantics; reuse existing localized `brand.workspace_label`; do not add a fake search control; desktop-only scope; do not refresh/restart the user’s running Overlay; preserve unrelated dirty worktree changes. |
| Sources read | `AGENTS.md`; this record through Round 17; user reference image `codex-clipboard-f1b78ea9-37e8-4914-83d8-f30a5426f27a.png`; `App.tsx`; `TitlebarBrandGuide.tsx`; `TitlebarNavigation.tsx`; `TitlebarMenubar.tsx`; `titlebar.css`; `design-language.css`; titlebar brand/menu static and browser tests; Round 17 desktop screenshots. |
| Whole-repository grep evidence | `rg -n -S "brand-logo|brand-guide|titlebar-navigation|titlebar-menubar|TitlebarMenubar|OpenCorvus|logo" packages/overlay/src packages/overlay/test`; `rg -n -S "ui-font-(body|control|meta|small|tiny|title|heading)|14px|13px|12px|11px"` across tokens and focused browser tests. `App.tsx` is the only shell layout owner; `TitlebarBrandGuide.tsx` is the only brand trigger/content owner; `titlebar.css` is the only header geometry owner; focused tests pin the old removed-wordmark/single-row contract and must be replaced, not bypassed. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent screenshot review and final diff/test review remain required. |

### Design and call-site disposition

1. `App.tsx` gains a structural `.titlebar-top-row` wrapper for existing navigation/menu/window controls and a `.titlebar-context-row` containing the existing `TitlebarBrandGuide`; no component duplication.
2. `TitlebarBrandGuide.tsx` keeps one accessible Kobalte Popover trigger and its current content. Its existing wordmark and localized workspace label become visible inside a rounded context pill; the full logo asset remains in the accessible component but the pill uses the reference’s text-first treatment.
3. `titlebar.css` changes the header from one 42px grid row to a compact 36px top row plus 40px context row. Menus use the new 13px control tier; the brand pill uses a 16px wordmark and 14px accent context, matching the reference hierarchy without copying its brand.
4. `design-language.css` changes the shared typography tiers once: display 20, heading 16, title 14, body/control/meta 13, small 11, tiny 10, code 12. Surface CSS continues consuming tokens.
5. Static titlebar/typography tests replace the retired “brand wordmark is gone” contract. Real browser tests measure row count/geometry, brand copy, pill chrome, menu placement, popover position below the complete header, and the compact computed typography.

### Round 18 result

- `App.tsx` now has exactly two titlebar rows. `.titlebar-top-row` owns back/forward navigation, File/Edit/View/Help, the drag lane, and window controls. `.titlebar-context-row` owns the single existing `TitlebarBrandGuide` component and a drag lane; the brand is no longer squeezed beside File.
- The existing Kobalte Popover trigger now renders a text-first rounded pill: `OpenCorvus` in the strong wordmark tier, the existing localized Workspace label in the accent tier, and the shared `chevron-down` icon. The logo asset and quick-guide content remain in the same component; no second brand source was added.
- Shared typography moved to a 13px desktop baseline: 20px display, 16px heading, 14px title, 13px body/control/meta, 11px small, 10px tiny, and 12px code. The empty-home title and suggestion rows stopped bypassing the scale with 34px/18px literals.
- At the 1280px browser fixture’s computed `--ui-scale=0.878`, the two rows measure approximately 32px and 35px, the pill 30px, the wordmark 14.05px, and the context label 12.29px. At the 1902px acceptance viewport, body/control text resolves to 13.52px, titles to 14.56px, secondary text to 11.44px, and code to 12.48px.
- Original-resolution visual review passed for the closed empty-home header, open brand guide, conversation, command palette, and settings dialog. The reference hierarchy is present, the brand/menu separation is clear, the application canvas gains visible space, and there is no clipping, overlap, accidental third row, fake search action, or error notification in the regenerated evidence.
- Focused static suites passed 63/63 and the broader typography/titlebar set passed 54/54. Node browser fixtures passed for brand Popover/two-row geometry, File/Edit/View/Help order and menu geometry, command palette, chat message typography, and config dialog. The command-palette fixture was also repaired to wait for the real post-settings Work Ledger refresh before teardown instead of aborting an in-flight request.

## Round 19 — Coherent shell type and restored left-sidebar collapse

### Recall

| Item | Detail |
| --- | --- |
| User request | “你这个字体不协调啊，有的小有的大，而且我的收缩左侧面板的按钮呢？” The supplied 2048px desktop screenshot shows the two-row header but an oversized composer mode/model label and no sidebar-collapse affordance. |
| Acceptance criteria | The visible shell follows one compact hierarchy: brand 14/13px, menus/sidebar/composer controls 13px, secondary labels 11px, and no 17px composer-control override; a mature icon button appears before back/forward in the first titlebar row; it reads and writes the persisted `settingsStore.sidebarCollapsed` source, fully removes the left rail from layout when collapsed, expands the workspace, updates accessible expanded state/title, and restores the rail on the second click. |
| Hard constraints | No CSS zoom/transform, fallback, duplicate collapse state, parallel sidebar implementation, or fake button; reuse the existing Button/Icon primitives, pane service, settings persistence, and i18n catalogs; desktop-only scope; do not restart or refresh the user's running OpenCorvus process; preserve unrelated dirty-worktree changes. |
| Sources read | `AGENTS.md`; this record through Round 18; user screenshot `codex-clipboard-f84ab1ce-e8eb-44ca-9c88-9fce2e50a324.png`; `App.tsx`; `main.tsx`; `settings.ts`; `pane.ts`; `activity.css`; `sidebar.css`; `composer.css`; `titlebar.css`; `design-language.css`; titlebar, pane, composer, and density tests. |
| Whole-repository grep evidence | `rg -n -S "sidebarCollapsed|data-collapsed|left.*pane|collapse.*sidebar" packages/overlay/src packages/overlay/test specs`; `rg -n -S "font-size:"` over the visible shell surfaces; `rg -n -S "composer-model-selector-value|brand-guide-wordmark|ui-font-small" packages/overlay/test`. The settings model and storage already own `sidebarCollapsed`, but both `paneCallbacks.getState()` and the shell effect hardcode it to `false`; the titlebar has no toggle mount; composer mode/model values alone bypass the compact tokens with 17px. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent screenshot inspection, interactive collapse verification, and final diff/test review remain mandatory. |

### Root cause and call-site disposition

1. `composer.css` replaces the isolated 17px mode/model literal with `--ui-font-control`; the 10/12px executor metadata stays secondary rather than competing with the primary controls.
2. `titlebar.css` moves the visible brand copy from heading/title to title/control, matching the 14/13px application hierarchy, and styles the new leading toggle in the same 26px control family as back/forward.
3. `main.tsx` restores the existing `settingsStore.sidebarCollapsed` as the pane callback and render source. The toggle changes that single store field and persists through `persistMainSettings`; no component-local collapse signal is introduced.
4. `App.tsx` receives one leading action slot before `TitlebarNavigation`. `activity.css` collapses the owning left shell to zero because this architecture has no remaining left activity toolbar to preserve.
5. English and Chinese catalogs receive explicit show/hide labels. Static tests own component placement, token use, single-state-source behavior, and collapsed layout; a Node browser test owns the real click/geometry/accessibility cycle.

## Round 20 — Separate workspace brand bar below the titlebar

### Recall

| Item | Detail |
| --- | --- |
| User correction | “logo是在标题栏下方的，不是跟header挤在一起的”. The Round 18/19 implementation incorrectly made the OpenCorvus workspace pill a second row inside `<header>`. |
| Acceptance criteria | `<header>` owns only the 36px native/application titlebar row: sidebar toggle, back/forward, File/Edit/View/Help, drag lane, and window controls. The OpenCorvus workspace pill lives in a separate 40px workspace context bar immediately after the header and before `<main>`. The context bar owns the shell boundary divider; Popover content clears the complete header-plus-context stack. |
| Hard constraints | Keep the single existing `TitlebarBrandGuide` Popover and its compact 14/13px type; no duplicate logo, fake second header, fallback markup, or visual-only absolute positioning; keep the restored sidebar toggle first in the actual titlebar. |
| Sources and call points | User reference/correction; `App.tsx` shell owner; `titlebar.css` chrome owner; `design-language.css` height tokens; `titlebar-brand-strip.test.ts`, `titlebar-brand-guide-primitive.test.ts`, `design-density-tokens.test.ts`, and `titlebar-brand-guide-popover.test.ts`. Whole-repository grep: `rg -n -S "titlebar-context-row|ui-titlebar-height|solidTitlebarBrandGuide" packages/overlay/src packages/overlay/test`. |

Disposition: replace `.titlebar-context-row` with a sibling `.workspace-contextbar`; change `--ui-titlebar-height` from the combined 76px stack to the real 36px header and add one explicit 40px context-bar token; move the bottom divider to the context bar; update static and real-browser contracts to assert sibling order and Popover clearance below the context bar.

### Round 19–20 result

- The visible type mismatch was traced to a remaining 17px composer mode/model override. `Chat` and `Choose model` now consume the shared 13px control token; the OpenCorvus wordmark/context pair now consumes 14/13px title/control tokens. Sidebar and menu controls remain on the same 13px baseline, with only intentionally secondary labels using 11px.
- The sidebar toggle is restored as the first control in the real titlebar. It reads/writes only persisted `settingsStore.sidebarCollapsed`, updates localized show/hide labels and `aria-expanded`, collapses the owning left shell to zero width, disables/hides the pane separator immediately, and restores both the rail and resizer on expansion. Browser coverage verified persisted initial collapse plus collapse → expand → collapse geometry.
- Pane resizer semantics were corrected at the source: collapse no longer attempts a geometry read after the rail is zero-width, and expansion unhides the separator before measuring its width. This removes the transient/stuck 1px separator without a second state source.
- Following the user's correction, `<header>` now contains only the 36px native/application titlebar. `OpenCorvus Workspace` lives in a separate 40px `.workspace-contextbar` sibling between header and main; its bottom divider owns the shell boundary. Settings uses the combined `--ui-shell-chrome-height`, so the fullscreen settings surface starts below both bars rather than overlapping the workspace brand bar.
- Empty-home prompt positioning now maintains a measured gap above the composer at both 1440×900 and 1902×1314 instead of allowing the title to be clipped by the composer.
- Visual review passed on expanded and collapsed 1440×900 shell screenshots, 1280px open brand-guide evidence, 1902×1314 empty-home evidence, and the fullscreen settings screenshot. The logo/context bar is visibly below the titlebar, the sidebar toggle remains in the titlebar, and no overlap or empty collapsed rail remains.
- Passed: 44 focused static titlebar/density/settings/pane tests; Node browser tests for brand Popover, sidebar collapse, command palette/empty home, composer controls, and settings resizing; Overlay TypeScript; Vite production build; panel i18n; historical documentation health 20/20; scoped `git diff --check`.
- The user's running OpenCorvus process was not restarted, refreshed, closed, or otherwise modified. No commit was created because the same files are part of a much larger pre-existing dirty worktree and their ownership cannot be safely isolated without risking unrelated changes.

## Round 21 — Two-region shell and diffuse workspace edge

### Recall

| Item | Detail |
| --- | --- |
| User request | “仔细研究，整体页面布局分为坐上右下两大块区域，而且组件边缘带有漫反射效果” with a full Codex reference screenshot. The visible intent is a titlebar above a two-region application body: one continuous left navigation plane and one elevated right workspace plane. |
| Reference evidence | Below the native titlebar, the brand sits at the top of the left rail rather than in a full-width horizontal bar. The right workspace begins at the same vertical origin as the brand row, has a pronounced rounded top-left corner, and casts a soft ambient/diffuse shadow back over the left plane. The composer and small floating controls repeat the soft edge treatment; the rail itself remains flat. |
| Acceptance criteria | Remove the full-width workspace context bar; place the single existing `TitlebarBrandGuide` at the top of `#leftActivityShell`; make that shell a column containing brand row + sidebar; make `#workspaceMain` the single elevated right-region surface with a tokenized top-left radius and diffuse left/down shadow; preserve pane resizing, persisted collapse, brand Popover accessibility, and 14/13px typography; expanded and collapsed screenshots must show no gap, overlap, orphan brand row, or divider residue. |
| Hard constraints | No duplicated brand component, fake header, absolute-positioned visual patch, global zoom, fallback, second pane state, or mobile scope; reuse existing shadow/radius/theme tokens and Button/Popover primitives; do not restart or refresh the user's running Overlay; preserve unrelated dirty changes. |
| Sources read | `AGENTS.md`; this record through Round 20; user reference `codex-clipboard-c062cb0c-9322-4546-9154-63add3374679.png`; `App.tsx`; `activity.css`; `workspace.css`; `titlebar.css`; `sidebar.css`; `composer.css`; `design-language.css`; light/dark/VS Code theme cascades; pane/titlebar/settings static and browser tests. |
| Whole-repository grep evidence | `rg -n -S "workspace-contextbar|left-activity-shell|workspace-main|panel-body|solidTitlebarBrandGuide" packages/overlay/src packages/overlay/test`; `rg -n -S -- "--shadow|ui-shadow-tone|box-shadow|border-radius" packages/overlay/src/styles`. `App.tsx` is the only shell/brand placement owner; `activity.css` owns the left shell; `workspace.css` owns the right surface; existing `--ui-shadow-tone`, highlight, radius, and scale tokens are the shared visual sources. |

### Call-site disposition

1. `App.tsx`: move the existing `.workspace-contextbar` unchanged into `#leftActivityShell` before `<aside>`; no second brand instance.
2. `activity.css`: change the left shell from a row to a column and make the sidebar consume the remaining height/width. Collapse still zeros the entire owner, so the brand disappears with the rail.
3. `titlebar.css`: the context bar becomes the rail's brand row—same rail background, fixed 40px height, no full-width boundary divider.
4. `workspace.css`: `#workspaceMain` becomes the raised right-region surface with the shared surface background, XL top-left radius, and a new semantic diffuse-edge shadow token; the transparent pane resizer remains the real resize hit target.
5. `design-language.css` / `settings.css`: `--ui-shell-chrome-height` is retired because the brand row is no longer global chrome. Fullscreen settings starts below the true titlebar again.
6. Static and Node browser tests replace Round 20's sibling-bar contract with containment, aligned top edges, radius/shadow computation, persisted collapse, settings geometry, and screenshot evidence.

### Round 21 clarification

The user further clarified: “标题栏和左侧栏视觉是一体”. Therefore the titlebar and left navigation must use the exact same `--rail-surface` plane and must not be separated by a horizontal border. The titlebar is structural window chrome but not a visually elevated surface. The right workspace alone owns elevation, radius, and ambient shadow. The titlebar canonical test is updated to require `border-bottom: 0`; this is a deliberate replacement of the superseded full-width divider contract, not an accepted variance.

### Round 21 result

- The full-width brand strip was removed. The single existing `TitlebarBrandGuide` now sits at the top of `#leftActivityShell`, immediately above the existing sidebar. The shell is one column and its persisted collapse state removes both brand and navigation together.
- Titlebar, left-brand row, sidebar, and the panel backing plane now resolve to the same rail material in light, dark, and VS Code dark themes. The titlebar bottom divider was deliberately removed, so there is no horizontal seam between window chrome and the left navigation plane.
- `#workspaceMain` is the only raised application region: it begins at the same Y coordinate as the left brand row, clips to an XL top-left radius, and uses shared scale geometry plus theme-owned shadow tones for a soft left/down ambient edge. The existing composer shadow remains the repeated component-level diffuse treatment.
- The brand guide content now uses Kobalte `Popover.Portal`, fixing real clipping/negative placement after the brand moved inside the overflow-hidden rail. Its focused dialog surface suppresses the browser's default black outline and retains the shared subtle border/shadow.
- The first browser run exposed three real integration regressions and none were waived: the empty-home support strip overlapped the moved composer by 14px, a persisted-collapsed sidebar was incorrectly awaited as visible, and the non-portaled brand guide was positioned above the viewport. The support strip anchor, attached-node wait, and Popover ownership were corrected and retested.
- Collapsed brand padding initially left a measurable 29px child box inside the zero-width rail. The collapsed context bar now zeros its inline padding and width in the same persisted state, eliminating the orphan geometry; collapse → expand → collapse passed with no residual rail or divider.
- Visual review passed at 1440×900 (expanded/collapsed two-region shell), 1280×720 (open brand guide), and 1902×1314 (loaded ledger/empty home). The titlebar and rail read as one uninterrupted gray plane; the white right workspace is visibly raised by its round corner and diffuse edge; typography and composer spacing remain compact.
- Passed: 144 focused static/theme/architecture tests, Overlay TypeScript, panel i18n, Vite production build, Node browser coverage for brand Popover, persisted collapse, command-palette/empty-home geometry, settings resizing, and keyboard/pointer left-pane resizing. The user's running Overlay process was not restarted or refreshed.

## Round 22 — Unified empty-home composition

### Recall

| Item | Detail |
| --- | --- |
| User request | “这个首页主面板你自己看的下去吗”. The accepted shell screenshot exposes an unacceptable home composition: title, composer, context strip, and shortcut rows are separated by large height-dependent voids and use visibly different widths. |
| Root cause | `.chat-home-prompt`, `#solidChatComposer`, and `.chat-home-after` are three unrelated absolute-positioning systems. The title uses `50% - 150px`, the composer uses a bottom clamp, and support content uses `50% + 202px`; these formulas only align at one acceptance viewport. At 1440×900 the composer is about 852px wide while the support strip is about 1077px wide with a roughly 139px vertical gap. |
| Acceptance criteria | Home title, real composer, context notice, and three functional suggestion buttons form one centered vertical composition; all surfaces share the same 76%-capped width; title→composer, composer→notice, and notice→suggestions gaps are bounded and continuous at both 1440×900 and 1902×1314; no overlap, viewport-specific absolute anchor, or static replacement component; normal task/session composer layout remains unchanged. |
| Hard constraints | Keep the existing `ChatComposer`, suggestion actions, translations, API/state sources, and Button/Icon primitives; no duplicate composer, fake home card, ResizeObserver/imperative layout patch, global zoom, fallback, or mobile scope; use Solid Portal only to place existing home content into App-owned semantic mounts; do not restart the running Overlay. |
| Sources read | `AGENTS.md`; this record through Round 21; current expanded 1440×900 and 1902×1314 home screenshots; `App.tsx`; `Conversation.tsx`; `conversation.css`; `composer.css`; `command-palette.test.ts`; empty-state ownership and architecture tests. |
| Whole-repository grep evidence | `rg -n -S "solidChatComposer|chat-home-prompt|chat-home-after|empty-chat-home|chat-composer-stack" packages/overlay/src packages/overlay/test`; `rg -n -S "noticeTop|composerBottom|titleTop|overlay-empty-home-composer-light" packages/overlay/test`. `Conversation.tsx` remains the only owner of home content/actions; `App.tsx` owns the only composer mount; `conversation.css` owns empty-home layout. |

### Design and call-site disposition

1. `App.tsx` wraps the existing composer with one `#chatHomeComposition` owner and adds empty prompt/after mount points. Default display is `contents`, so non-home layouts are unchanged.
2. `Conversation.tsx` portals its existing title and existing notice/suggestion content into those mounts when the same no-items/no-task condition is true. No content or action is cloned.
3. `conversation.css` replaces all three absolute formulas with one centered three-row grid. Prompt, composer stack, and support content share `min(1100px, 76%)`; the support strip and suggestion rows remain a single continuous block.
4. `command-palette.test.ts` replaces viewport-specific top-coordinate ranges with relationship assertions at both acceptance sizes: common width, bounded gaps, centered composition, and no overflow. Static tests assert one composer/content owner and Portal mounts.

### Round 22 result

- The empty home is now one semantic composition instead of three independent coordinate systems. The existing title, the only real `ChatComposer`, project-context notice, and the three existing functional suggestion actions occupy a centered three-row grid.
- Title, composer, notice, and suggestion rows share the same `min(1100px, 76%)` width source. The title-to-composer and composer-to-support gaps are both 16px, while the notice and actions remain a continuous support block rather than a detached lower panel.
- `App.tsx` owns only the composition mounts and the single composer instance; `Conversation.tsx` remains the only owner of translated home content and actions and uses Solid Portal to place those existing nodes. No duplicate/fake home component or alternate state source was introduced.
- Real Node/Playwright rendering passed at both 1902×1314 and 1440×900. Geometry assertions verified common widths within 1px, bounded 12–24px inter-row gaps, symmetric vertical centering within 2px, and no overflow. Both screenshots were personally reviewed: the main panel is compact, continuous, and centered at both viewport sizes.
- Regression coverage passed for the ordinary selected-task composer remaining editable/focusable, persisted sidebar collapse/restore geometry, panel header workbench layout, 16 focused static ownership/density tests, Overlay TypeScript, and Vite production build. The initial Vite failure occurred while concurrent transport work was moving `getHostTransport` to `host-transport-runtime.ts`; after that single-source move completed, the unchanged home implementation built successfully without modifying the transport work.
- The user's running OpenCorvus process was not restarted, refreshed, closed, or otherwise modified.

## Round 23 — Restore the conversation agent history rail

### Recall

| Item | Detail |
| --- | --- |
| User request | “把删掉的agent rail加回来，而且位置和样式都要一样” with a reference crop showing the compact execution-history ticks immediately left of a conversation card. |
| Acceptance criteria | A selected task/session with real execution-ledger records renders the existing agent rail immediately left of the centered message lane; the rail keeps the established 46px owner and 16/22/27/32px width steps, uses a compact 9px row plus 3px gap, renders every line at an exact unscaled 2px thickness, keeps muted inactive ticks and a text-strong active tick, and still locates the canonical rendered card; an empty execution ledger renders no fake rail. |
| Hard constraints | Restore the existing `ConversationAgentRail` and `conversationAgentStore` path only; no synthetic record, card-tree scan, second rail component, fallback, tooltip surface, bottom-strip compatibility mode, or viewport-edge absolute positioning; preserve current compact typography and centered message axis; do not refresh or restart the user's running Overlay. |
| Sources read | `AGENTS.md`; this record through Round 22; user reference `codex-clipboard-1bfeb63a-8cfc-4b99-a0e7-268fdd9ba963.png`; `2026-07-08-conversation-agent-history-left-rail.md`; June visibility/live/execution-ledger/button records; `App.tsx`; `ConversationAgentRail.tsx`; `conversation-agents.ts`; `conversation.css`; focused static and Node browser rail tests. |
| Whole-repository grep evidence | `rg -n -S "ConversationAgentRail|conversation-agent-rail|solidConversationAgentRailMount|agent rail" packages/overlay/src packages/overlay/test specs`; Git history for `ConversationAgentRail.tsx` and the rail CSS. The component, single store source, direct App mount before `.conversation-scroll-shell`, and exact geometry tokens still exist. A fresh real-browser fixture proves the rail renders and locates cards. The remaining reference mismatch is that status color currently overrides the hovered/focused active tick, producing a stage-colored line instead of the reference's black/text-strong active line. |

### Disposition

1. Keep the direct `App.tsx` mount inside `#conversationBody`; do not restore the retired bottom-strip Portal architecture.
2. Keep `conversationAgentRecordsForSource(boardStore.selectedSource)` as the only record source and `<Show when={hasRecords()}>` as the truthful empty behavior.
3. Preserve all established rail geometry. Make proximity-zero and keyboard-focus activation resolve to `--text-strong` after status styling so the active line matches the reference while running/error colors remain visible when inactive.
4. Extend static and Node browser assertions to pin active color as well as width/placement, then regenerate and inspect the task-pane and isolated-rail screenshots.

### User visual correction

The first restoration pass retained the old 14px row plus 5px gap and scaled the nominal 2px line through `--ui-scale`. The user correctly identified two visible mismatches: the accumulated stack/row spacing was much looser than the supplied crop, and fractional scaled line heights produced anti-aliased thickness variation. The corrected contract uses a 9px scaled row, 3px scaled gap, and an exact 2px line guarded by `--px-exact`; the width animation remains scaled.

### Round 23 result

- The existing single-source `ConversationAgentRail` remains mounted immediately before `.conversation-scroll-shell` inside `#conversationBody`; it is visible only for real execution-ledger records and retains canonical click-to-card navigation.
- Reference geometry is restored without reintroducing the retired bottom strip: 46px rail owner, 16/22/27/32px width ladder, compact 9px rows, 3px gaps, and exact 2px lines. The active/focused line resolves to `--text-strong` after status styling, while inactive lines remain muted.
- Browser geometry now asserts every sampled line is 2px within 0.1px, consecutive centers remain within the compact 8–16px range, the rail precedes the centered message column, same-agent stacks share one horizontal lane, and locate behavior still materializes and highlights the canonical card.
- Personally reviewed regenerated `chat-pane-after-locate.png` and `left-rail.png`: line thickness is visually uniform, spacing is materially tighter, and the long black active line plus graduated neighboring lines matches the supplied reference rhythm.

## Round 24 — Static ambient workspace light

### Recall

| Item | Detail |
| --- | --- |
| User request | After asking why Codex can show a gradient effect with negligible ongoing cost, the user requested: “给我也来一个漂亮的”. |
| Acceptance criteria | The raised right workspace gains a restrained theme-aware ambient gradient: faint accent light near the upper-left, a softer complementary wash toward the lower-right, and the existing diffuse edge shadow; content remains readable and the left titlebar/rail plane stays flat; the effect is visible in light and dark themes without animation or continuous repaint work. |
| Hard constraints | Static CSS backgrounds and existing theme tokens only; no JavaScript, timer, canvas, image asset, animation, `filter`, `backdrop-filter`, blend mode, duplicate overlay layer, raw surface color in canonical CSS, or mobile scope; preserve the single `.workspace-main` surface owner and do not restart the user's running Overlay. |
| Sources read | `AGENTS.md`; this record through Round 23; `workspace.css`; `conversation.css`; light/dark/VS Code theme cascades; workspace shell/architecture/theme tests; current 1440×900 and 1902×1314 screenshots. |
| Whole-repository grep evidence | `rg -n -S "workspace-main|chat-canvas|radial-gradient|linear-gradient|diffuse|shadow-tone|backdrop-filter|filter:" packages/overlay/src/styles packages/overlay/test`. `.workspace-main` is the only raised right-region owner, but opaque `.center-workbench`, `.chat-content-frame`, `.chat`, `.conversation-body`, and `.chat-scroll` backgrounds currently cover it. Theme cascades already own palette-specific fill tokens. |

### Disposition

1. Add one `--workspace-ambient-fill` token to each supported theme cascade, using only static radial/linear gradients composed from the existing surface and accent palette.
2. Make `.workspace-main` consume that token while retaining its current radius and diffuse edge shadow.
3. Make only the nested chat canvas chain transparent so the single parent gradient remains continuous; file editor, inspector, cards, dialogs, and controls keep their existing opaque surface ownership.
4. Extend static tests to require the token in every theme, a single workspace background owner, transparent chat chain, and absence of animation/filter/backdrop-filter on the workspace surface. Regenerate light/dark screenshots and inspect contrast and seams.

### Round 24 result

- Added one theme-owned `--workspace-ambient-fill` for light, dark, and VS Code dark. Each uses two low-opacity radial accent washes over a static linear surface transition; `.workspace-main` remains the only painting owner and retains its existing rounded top-left edge and diffuse shadow.
- The nested `.center-workbench`, `.chat-content-frame`, `.chat`, `.conversation-body`, and `.chat-scroll` canvas chain is transparent, so the gradient is continuous across the page instead of restarting inside each child surface. Cards, composer, headers, editor, inspector, dialogs, and controls retain their own opaque surfaces.
- The workspace uses no animation, `filter`, `backdrop-filter`, blend mode, image asset, JavaScript timer, or additional overlay layer. Browser-computed assertions require both radial and linear gradients while `filter`, `backdrop-filter`, and `animation-name` remain `none`.
- The shallow theme backing plane was corrected to the already-recorded neutral `rgb(244, 244, 244)` contract, restoring the visual separation between the flat titlebar/left rail and the raised right workspace.
- Personally reviewed 1440×900 and 1902×1314 light empty-home screenshots plus light and dark populated conversation screenshots. The result is a restrained cool ambient wash rather than a saturated decorative gradient; text contrast, card boundaries, composer chrome, agent rail, top-left radius, and edge shadow remain clear with no visible gradient seams.

## Round 25 — Reactive project context and empty-chat continuity

### Recall

| Item | Detail |
| --- | --- |
| User report | “我点击不同的项目的时候为什么输入框上面的项目目录没有变化，而且创建chat后窗口变化的很难看？” The screenshot shows a selected Chat row under another project while the launcher still says `futures`; the regular Chat header is visible but the home prompt/composer/support block is displaced to the bottom, leaving a large dead canvas. |
| Acceptance criteria | Clicking a Work Ledger project group makes that directory the single active project context and updates the pinned project label, launcher title, notice, suggestion prompts, API directory, and subsequent new-chat target; an empty newly-created/selected Chat preserves the complete centered launcher composition with the header hidden; after the first real conversation item appears, the same Chat transitions to the regular header/transcript/bottom-composer layout; no stale directory or mixed layout may be visible. |
| Hard constraints | Use `applyDirectory` as the only directory-switch lifecycle, `boardStore.selectedSource`/coding session ledger as the only selected Chat source, and the existing single composer/home composition; no component-local directory shadow state, synthetic Chat, delayed timeout, forced reload, duplicated composer, fallback directory, or query override; project switch errors remain visible; do not refresh the user's running Overlay. |
| Sources read | `AGENTS.md`; this record through Round 24; user screenshot `codex-clipboard-ab08daf2-ba6f-400e-aa6f-b2befc9cff58.png`; project-directory new-chat and project-ledger records; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; `main.tsx`; `Conversation.tsx`; `coding-assistant.ts`; project-directory/workspace/board/settings stores; focused static and Node browser tests. |
| Whole-repository grep evidence | `rg -n -S "homeProjectName|data-empty-chat-home|activeSessionID|createWorkLedgerProjectChat|ProjectLedgerGroup|applyDirectory|settingsStore.directory|selectedSessionID" packages/overlay/src packages/overlay/test specs/records/2026-07`. Project headers currently call only collapse state; `homeProjectName` reads only `settingsStore.directory`; `Conversation` renders home content for empty sessions, while `main.tsx` explicitly disables home CSS whenever `activeSessionID()` is non-empty. |

### Root-cause disposition

1. Add `onSelectProject(directory)` through `ProjectLedgerGroup` and `WorkLedger`; project-heading activation invokes that real lifecycle as well as preserving its existing expand/collapse behavior. The active directory is exposed with `data-active`/`aria-current` and shared row chrome.
2. `main.tsx` handles project activation through `applyDirectory(directory, { save: true, restoreWorkspace: false })`, resets the center to Chat, and focuses the existing composer after the authoritative project-scope reload.
3. `Conversation.homeProjectName()` reads the selected session's hydrated/ledger directory before the global active directory, so an empty selected Chat cannot display a previous project's name.
4. `data-empty-chat-home` becomes a content-state contract: Chat panel + no task + zero rendered conversation items. An empty session therefore retains the complete home composition; `cardTreeStore.visibleVersion/order.length` makes the layout react immediately when its first real item arrives.
5. Extend the existing real project-directory/new-chat browser fixture to assert directory switching, correct launcher copy, stable centered geometry after Chat creation, hidden header for an empty Chat, and transition to regular layout only after real content.

### Round 25 result

- Work Ledger project headings now activate their directory through the existing `applyDirectory` lifecycle. The active group is exposed with `data-active` and `aria-current`; switching `workspace → market-sim → workspace` updates the global directory/API context, pinned project, launcher title, notice copy, and subsequent Chat target from one authoritative source.
- Empty selected Chat sessions now remain in the complete launcher composition. `data-empty-chat-home` is based on actual content (`Chat` panel, no task, zero rendered conversation items), not on the absence of a session id. The regular Chat header stays hidden and the composer remains centered until the first real item exists.
- Launcher project copy resolves the selected Chat's hydrated/ledger directory before the global directory. This removes the observed stale `futures` label even during the session-selection hydrate boundary.
- The existing real project-directory fixture now contains two directories and verifies both project switching and Chat creation. After creation it asserts `workspace` in title and notice, a hidden Chat header, composition edges aligned to the workspace, and the composer bounded away from both top and bottom; `project-directory-new-chat-empty-session.png` was regenerated and personally reviewed.
- Regression browser tests passed for unified project grouping, command-palette/home behavior, and the ordinary selected-task composer. Expected cancellation of the previous directory's Work Ledger SSE during a project switch is explicitly allowed; all HTTP errors, console errors, other request failures, and the new directory connection remain failure conditions.

## Round 26 — Truthful project deletion and compact message header

### Recall

| Item | Detail |
| --- | --- |
| User request | “这他妈抄对了吗？而且为什么项目只能添加不能删除？消息面板上的chat和open in整那么大字号协调吗？” The supplied side-by-side crops show that the OpenCorvus rail still has heavier project typography/actions than the reference rhythm, and that `Chat` / `Open in` use a separate oversized header scale. |
| Acceptance criteria | Every real Work Ledger project group exposes both new-Chat and delete actions in the same hover/focus action lane; delete opens an explicit destructive confirmation, calls the existing directory-scoped `DELETE /project/current` business endpoint, never deletes workspace source files, waits for the backend cancellation/deletion result, closes project scope only when the deleted directory is active, and refreshes the ledger. The message header uses the shared compact 14px title / 13px control hierarchy with a roughly 48px header and 32px editor control, while project names return to the 13px control tier. |
| Hard constraints | No visual-only row removal, filesystem deletion from the client, optimistic disappearance, second project registry, fallback, native `confirm`, fake navigation item, global zoom, or user-process restart/refresh. Reuse the existing backend project-delete lifecycle, directory-qualified API transport, `showAppDialog`, Button/Icon primitives, shared font tokens, and Work Ledger refresh token. Preserve unrelated dirty-worktree changes. |
| Sources read | `AGENTS.md`; this record through Round 25; user reference crops `codex-clipboard-df244fa2-290c-4b4e-a1d5-e3a85cb04ef8.png` and `codex-clipboard-c881cae2-0f5f-4236-97e8-abe6b35cc2ec.png`; Browser skill; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; `main.tsx`; `workspace.ts`; `project/delete.ts`; project route/tests; header/sidebar CSS; editor launcher; focused static and Node browser tests. |
| Whole-repository grep evidence | `rg -n -S "deleteProject|removeProject|closeProject|delete.*project|global/projects|ProjectLedgerGroup|Open in|chat-title|workspace-editor-primary" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test`; focused searches for `project/current`, API directory injection, Work Ledger refresh ownership, `showAppDialog`, header literals, and project action tests. The backend already owns a safe `DELETE /project/current` path which cancels task/session work, deletes only OpenCorvus state plus DB rows, disposes the project instance, and explicitly preserves source files. The Overlay deliberately retired its client delete action, leaving only new Chat. `header.css` and `conversation.css` still override the compact token system with 74/44/42px geometry and 20/18px type. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent browser fixture inspection and final diff/test review remain mandatory. |

### Root-cause disposition

1. Add one typed `deleteProjectState(directory)` client to `workspace.ts`; it sends an explicit directory-qualified DELETE to the existing endpoint and returns its validated business result. It does not mutate UI state.
2. Thread `onDeleteProject(directory)` through `WorkLedger` and `ProjectLedgerGroup`. The group owns only the action button; `main.tsx` owns confirmation, backend invocation, active-project close, notification, and ledger refresh.
3. Replace the retired static-test contract that prohibited deletion with contracts for the real route, confirmation, propagation stop, active-directory close, and translated destructive copy. A Node browser fixture must verify cancel leaves the row intact and confirm issues DELETE before the row disappears.
4. Replace the isolated message-header literals with the established tokens and compact geometry: title 14px, editor label 13px, header 48px, editor controls 32px, toolbar toggle 30px, and proportionate icons. Project headings use the 13px control tier rather than the title tier.
5. Regenerate sidebar/message-header screenshots at one desktop viewport and inspect the action density, typography hierarchy, alignment, and confirmation state before acceptance.

### Round 26 result

- The retired “projects can only be added” contract was removed. Every real Work Ledger project group now exposes compact new-Chat and delete icon actions in the same hover/focus lane. Delete uses the existing app Dialog, names the exact directory, states that source files are preserved, and does not issue any request when cancelled.
- Confirmed deletion calls the existing directory-qualified `DELETE /project/current` endpoint. The client validates `ProjectDeleteResult`, closes the UI project scope only when the deleted directory is active, refreshes the Work Ledger, and shows a success notification. It never removes a row optimistically and never touches the filesystem itself.
- The message header no longer bypasses the compact type system. `Chat` resolves to the shared 14px title tier, `Open in` to the 13px control tier, with 48px header, 32px editor launcher, and 30px toolbar toggle geometry. Project group names also use the 13px control tier.
- Real Node browser coverage passed at 1440×900: cancel kept the project, confirm issued the scoped DELETE before the group disappeared, and the generated confirmation/sidebar screenshots were personally reviewed. The separate message-header browser fixture passed its computed 48/14/32/13/30 geometry and screenshot review.
- Passed: 23 focused Overlay static/service tests, two focused Node browser fixtures, Overlay TypeScript, Vite production build, panel i18n, 20/20 historical documentation health checks, the normal backend project-delete source-preservation test, and scoped `git diff --check`.
- Not fully accepted: two existing backend queue-wake deletion cases still expose a TaskQueue/Instance lease race (`DELETE /project/current waits for non-task project queue wake...` and the terminal-task variant). Several attempted local queue-settlement changes were reverted after they caused broader TaskQueue ownership regressions. The UI deletion path and ordinary backend deletion are complete, but deletion while one of those queue wakes is actively unwinding remains explicitly unverified/failed rather than being presented as complete.

## Round 27 — Modern icon system and strict settings-surface parity

### Recall

| Item | Detail |
| --- | --- |
| User request | “我不喜欢现在的全套icon，难看又过时，UI上抄一套全新现代简约icon”，随后明确扩展为“不仅如此，设置页面，整体风格都严格抄这个现代化的风格”，并提供 Codex 设置页的 General / Personalization 桌面参考图。 |
| Reference evidence | 设置页继承标题栏与左轨同一浅灰平面；左侧约 480px 视觉宽度，包含 Back to app、圆角搜索框、浅灰分组标题、36–40px 紧凑导航行和柔和胶囊选中态。右侧是圆角左上角的白色工作区，内容列宽约 1230px，顶部留白约 90px；页面标题克制，设置分组用单层圆角描边容器，内部行以 1px 分隔，行标题/说明/右侧控件形成稳定三层节奏。图标为统一的现代线性家族，细描边、圆端点、无混合实心旧符号。 |
| Acceptance criteria | 所有非品牌业务图标统一由已安装的 `lucide-solid` 单一来源渲染，默认描边收敛到 1.75；手写 SVG 只保留必须维持身份的编辑器与 GitHub 品牌标识。设置页在 1808×1257 和 1440×900 的真实桌面渲染中复现参考的信息架构、区域比例、圆角/描边、导航密度、页面留白、设置行层级与控件尺度；General、Appearance、About 及至少一个复杂管理页保持真实功能、滚动和键盘可达。 |
| Hard constraints | 不复制 ChatGPT/Codex 品牌、专有 SVG、文案或不可用功能；不新增第二套 icon library、自绘业务图标、inline SVG、字符图标、全局 zoom、静态假设置项、fallback、双源样式或移动端范围。保留 OpenCorvus 现有设置 IA、Kobalte Tabs/Dialog、设置 primitives、可调侧栏、真实状态与 API；不重启/刷新用户正在运行的 OpenCorvus。 |
| Sources read | `AGENTS.md`; this record through Round 26; Browser skill; both supplied settings screenshots at original resolution; `Icon.tsx`; local `lucide-solid` type/export catalog; `ConfigDialogHost.tsx`; `settings/primitives.tsx`; `GeneralPanel.tsx`; `settings.css`; settings sizing/architecture/icon coverage and Node browser fixtures. |
| Whole-repository grep evidence | `rg -n -o 'name="[^"]+"' packages/overlay/src/components packages/overlay/src/main.tsx`; `rg -n -S "ConfigDialogHost|config-sidebar|config-content|config-page-title|config-search|config-nav-group-title|config-resizer|s-group-body|s-row" packages/overlay/src packages/overlay/test`; `rg -n -S "export type IconName|const CUSTOM_ICON_PATHS|const LUCIDE_ICON_MAP" packages/overlay/src/components/Icon.tsx`; local Lucide exports under `packages/overlay/node_modules/lucide-solid/dist/types/icons`. `Icon.tsx` is the only icon renderer, `ConfigDialogHost.tsx` is the settings shell owner, and `.s-*` primitives plus `settings.css` are the settings surface source. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent source review, browser screenshot review, and final diff review are mandatory. |

### Root-cause disposition

1. `Icon.tsx`: expand the existing Lucide registry to cover project/message actions, agent roles, workflow sections, mission/channel and About icons; lower the family default to a consistent 1.75 stroke; delete the superseded custom business glyphs so there is no mixed visual family. Editor brand marks remain the only custom identity SVGs.
2. `ConfigDialogHost.tsx`: keep the existing OpenCorvus tabs and panels, but make the reference structure explicit through the existing back/search/group/tab/content owners. Do not add reference-only pages or fake settings.
3. `settings.css`: replace the current oversized/resizable-at-max presentation with the reference rhythm—stable rail width range, quiet rail plane, 38px search and nav rows, subtle selected pill, hidden-at-rest resizer hairline, rounded elevated right surface, 64–88px content inset, 1040–1120px content column, 24px page title, 16px section headings, 64px rows, and single bordered groups. Existing complex panels may use their established workspace exception but must inherit the same typography, controls, and icon family.
4. Static tests pin the icon-source boundary and settings geometry. Node browser fixtures verify resize, General controls, navigation/search, Appearance/About, a complex panel, light/dark computed styles, keyboard behavior, and desktop screenshots at both acceptance sizes.

### Round 27 result

- The visible icon system now uses one modern line family. Project/chat actions, all agent-role glyphs, workflow/section icons, mission/channel icons, status/config/navigation affordances and ordinary controls resolve through the installed `lucide-solid` registry with a shared 1.75 default stroke. The superseded hand-written business glyphs were deleted; custom SVG is restricted to editor and GitHub identity marks that Lucide intentionally does not provide.
- The settings shell now follows the supplied desktop references: titlebar and left settings rail form one quiet gray plane; Back to app, search, section labels and 38px navigation rows use compact hierarchy; the selected row is a subtle pill. The right settings workspace is a single white raised region with a 24px top-left corner, static diffuse edge, 80px header band/divider and a wide left-aligned content column.
- General/Appearance settings use 24px page titles, 16px section heads, 68px standard rows, 76px permission rows, single 1px internal separators and one rounded outline per group. About information and shortcut blocks were moved into the same rounded outlined vocabulary. Expert Squads no longer bypasses the global content inset/heading system; its real catalog/detail UI remains functional inside the same settings column.
- At the supplied 1808×1257 reference size, the real General panel begins at x≈510 and ends at x≈1749, closely matching the reference's x≈516…1748 content span. The same page at 1440×900 has no horizontal overflow. Personally reviewed `config-dialog-resizer.png`, `config-dialog-appearance-modern.png`, `config-dialog-expert-squad-modern.png`, `config-dialog-general-1440.png`, `runtime-icon-about-panel.png`, and the runtime empty-state/card icon evidence.
- Passed: 198 focused settings/icon/architecture tests, 20 historical-document health tests, Overlay TypeScript, Vite production build, Node browser settings resize/navigation/segmented-control coverage, 1808×1257 + 1440×900 screenshot/geometry checks, runtime single-source icon rendering, icon contrast, and scoped `git diff --check`. The user's running OpenCorvus process was not restarted, refreshed, closed, or modified.

## Round 28 — Compact Work Ledger primary navigation and hierarchy

### Recall

| Item | Detail |
| --- | --- |
| User request | “把搜索做成一个icon放到new chat右侧，把专家团配置和channel放到new chat下面。减半项目-mission-task的缩减”. The last phrase is implemented as the evident project → Mission → Task hierarchy indentation being halved: the current code has 12px project-body indentation and 28px Mission-child indentation. |
| Acceptance criteria | `New chat` and a compact search icon share one primary row; no full-width search field is visible at rest. Activating the icon reveals and focuses the real Work Ledger filter, and Ctrl+G opens the same control. `Expert Squads` and `Channel` are the next two real settings links directly below that row. Project→Mission indentation changes 12→6px and Mission→Task indentation changes 28→14px without flattening semantic nesting, hit targets, statuses, hover actions, or selected-row behavior. |
| Hard constraints | Reuse the existing Work Ledger query, `openConfigDialog`, Button/Icon primitives, real settings sections and project/Mission/task DOM. No fake nav item, duplicate search state, second filtering path, static replacement list, hidden active filter, fallback focus path, mobile scope, or running-process restart/refresh. Preserve unrelated dirty changes. |
| Sources read | `AGENTS.md`; this record through Round 27; Browser skill; `WorkLedger.tsx`; `ProjectLedgerGroup.tsx`; `TitlebarMenubar.tsx`; `work-ledger.css`; `sidebar.css`; Work Ledger consolidation/search/command-palette/project-group browser and static tests. |
| Whole-repository grep evidence | `rg -n -S "work-ledger-search|sidebar-codex-static-nav|sidebar-codex-action|openConfigDialog|ProjectLedgerGroup|work-row-child-list|project-group-body" packages/overlay/src packages/overlay/test`; focused reads show `WorkLedger.tsx` owns the only search signal/query and static shortcuts, `TitlebarMenubar.tsx` owns Ctrl+G focus, `.project-group-body` owns the 12px first-level inset, and `.work-row-child-list` owns the 28px Mission-child inset. |
| Independent agent feedback | Not requested; no sub-agent was spawned. Main-agent browser screenshot and final diff review remain mandatory. |

### Disposition

1. `WorkLedger.tsx`: introduce presentation-only search disclosure around the existing `search` signal/input; place its trigger beside New chat; replace the unrelated Plugins shortcut with real Expert Squads and Channel settings buttons.
2. `TitlebarMenubar.tsx`: Ctrl+G activates the same disclosure trigger before focusing the canonical input when it is closed.
3. `sidebar.css` / `work-ledger.css`: define the two-column primary row, icon-button geometry, closeable disclosed field, and halve only the two hierarchy inset sources.
4. Update static and Node browser tests to require the collapsed-at-rest search, direct settings destinations, Ctrl+G focus, 6/14px nesting, action accessibility and screenshots at desktop width.

### Round 28 result

- The persistent full-width Work Ledger search field is gone. `New chat` now owns the left side of the primary row and a 36px Lucide search icon owns the right side. At rest only the icon is visible; activating it reveals and focuses the existing real filter field, changes the trigger to Close, and closing it clears the active query so no hidden filter remains.
- Ctrl+G and the titlebar Edit → Search action now activate that same disclosure trigger and focus the canonical `data-ui="work-ledger-search"` input. No second query signal or filtering path was added.
- `Expert Squads` and `Channel` are the two real settings actions immediately below the primary row. They call `openConfigDialog("expert-squad")` and `openConfigDialog("channel")`; the previous mismatched Plugins→Skill Market shortcut was removed from this position.
- Project → Mission indentation was halved from 12px to 6px, and Mission → Task indentation from 28px to 14px. Semantic `<section>` / nested `<ul>` ownership, real child rows, selection, status marks and hover/keyboard action rails remain unchanged. Project labels also remain on the compact 13px control tier.
- Personally reviewed the regenerated 1440×900 collapsed-search home, the expanded-search 1902×1314 home, and compact grouped Work Ledger screenshots. The primary row alignment, direct settings links, disclosed search field and tighter project hierarchy are visually coherent with the modern rail.
- Passed: 30 focused Work Ledger/search/Mission tests, 20 historical-document health tests, Overlay TypeScript, Node browser command-palette/Ctrl+G focus flow, real project grouping, desktop screenshots and scoped `git diff --check`. Browser fixtures rebuilt the current Overlay bundle. The user's running OpenCorvus process was not restarted, refreshed, closed, or modified.
## 2026-07-11 Full-surface redo continuation

### Recall

| Item | Detail |
| --- | --- |
| User correction | “完全重做，Run tab不要删除”. `Run` is an intentional OpenCorvus adaptation and remains between View and Help. Complete redo does not authorize deleting functional product surfaces. |
| Visual evidence | Fresh 5187 browser screenshots at desktop size exposed repeated visible implicit-project folders, UUID leakage across independent display sources, mixed English commands in the Chinese File/settings navigation, and an Expert Squad dashboard-card composition. |
| Root causes | Implicit task-project recognition lived privately in `WorkLedger` while `Conversation` used basename; dated UUID carriers were rendered as ordinary project groups; Chinese resources copied English strings; Expert Squad inherited the generic framed `s-group-body` and rendered its overview as nested cards. |
| Current corrections | `isImplicitTaskProjectDirectory` and `projectDirectoryLabel` are shared; home/pinned rail consume the same human label; implicit carrier groups render their real Mission/Task/Chat rows directly; Chinese menu/settings navigation is localized; Expert Squad uses a flat two-column key-value overview with no outer group window. |
| Preserved behavior | Normal projects retain project groups and actions; implicit rows retain real row selection/actions and directory ownership; expert-squad catalog, activation, import/export and session override sources are unchanged; `Run` remains present; message reasoning/tool/subtask/patch details remain truthful and default-collapsed behind the existing hover/focus disclosure. |
| Verification | 39 focused titlebar/config/project/ledger tests, 23 Expert Squad/config tests, 11 ledger/project tests, Overlay TypeScript, panel i18n, diff checks, production Vite build, and fresh visual screenshots. |
| Not yet accepted | Full-page parity is still open. Providers, Agent Models, Channels, Skills, Market, MCP, task context, Network, workbench views, menus/dialogs and populated conversation states still require individual screenshot review. Independent adjudication has been re-requested and must not pass while these surfaces remain unreviewed. |

## 2026-07-11 Expert-squad launcher layout regression

### Recall

| Item | Detail |
| --- | --- |
| User report | Selecting an expert squad makes the launcher visually collapse to the bottom of the page; supplied dark-theme screenshot shows a visible `New Mission` header, a low title/composer, and clipped notice/suggestion rows. |
| Root cause | `handleComposerModeChange("mission")` correctly changes the real submission surface to Mission, but `body[data-empty-chat-home]` is set only when `primaryCenterPanel() === "chat"`. The same `chatHomeComposition` therefore changes from an absolute centered grid to `display: contents` when the expert squad is selected. Its prompt, composer and support rows then enter the ordinary flex flow after the full-height conversation frame and overflow the viewport. |
| Acceptance | Chat and expert-squad launchers share one centered, fully visible home composition at desktop sizes; switching either direction does not move or resize the shell unexpectedly; the regular header remains hidden for both empty launchers; title, composer, notice and suggestions remain within the workspace; real Chat versus Mission submission semantics remain unchanged. |
| Hard constraints | Keep one composer and one intent selector; no Mission option, duplicate launcher tree, viewport offset, delayed measurement, query override, fallback, or running-process restart. Preserve `Run`. Add static and real Node browser coverage plus dark/light screenshots and i18n verification. |
| Sources read | This record through the full-surface continuation; supplied screenshot `codex-clipboard-3f320ba6-2959-4b0a-b698-06e7c8d41828.png`; `main.tsx`; `App.tsx`; `Conversation.tsx`; `conversation.css`; `composer.css`; Mission launcher and empty-home browser tests. |
| Whole-repository grep | `rg -n "New Mission|home_prompt|chatHomeComposition|data-empty-chat-home|mission.*launcher|expert.*squad.*composer|chat-home" packages/overlay/src packages/overlay/test`; `rg -n "missionSubmitActive|handleComposerModeChange|composerMode" packages/overlay/src/main.tsx`. The single failing ownership boundary is the body content-state predicate in `main.tsx`; the shared composition and submission paths already exist. |

### Result

- `launcherHomeActive()` now derives the home layout from the real center panel, active task and rendered card tree. Empty Chat sessions and expert-squad Mission launchers therefore share the same `chatHomeComposition`; selecting an expert squad no longer drops the launcher into the ordinary conversation flow.
- `Conversation` receives the current launcher mode and renders dedicated expert-squad context copy without changing the real Chat/Mission submission paths. The empty composer hint remains visible while the focused textarea is empty, so mode selection does not create a visually blank input.
- Focused source/i18n/density suites passed 62/62, Overlay TypeScript passed, and the existing Node command-palette fixture now performs Chat -> Builtin/General -> Chat switching against the real bundle. It asserts the hidden ordinary header, preserved Run menu, focused Mission hint, expert-squad notice, equal region widths and viewport containment, and writes a dedicated screenshot.
- Personal browser review passed in both light and dark themes at 1707x960. In dark mode the composition spans y=48..960; prompt y=321..359, composer y=371..519, and support content y=531..687. Run remains present and no launcher content is clipped or pushed below the viewport.
- The command-palette fixture's old gradient and 13px/34px rail assertions were updated to the current no-decoration and 14px/40px shell contract before the new switch path could execute; the resulting full browser test passes.
- Independent `gpt-5.5` adjudication initially rejected the round because the visible placeholder still exposed Mission, the header selector was nonexistent, workspace containment was incomplete, and dark evidence was not executable. After replacing the visible copy with `expert_squad.launcher.placeholder`, asserting the real `.chat-header`, pinning composition to `#conversationWorkspace`, and adding the real View-menu dark transition plus `.scratch/overlay-expert-squad-home-dark.png`, the same adjudicator re-reviewed the code and screenshots and closed every blocking/severe finding with no new in-scope issue.
- This regression is accepted. The parent full-surface Goal remains active: the pages listed as unreviewed in the continuation section still require individual visual and functional closure, and the independent `gpt-5.5` adjudicator must report before global completion.

## 2026-07-11 Full-surface settings, workbench, and transcript closure

### Recall

| Item | Detail |
| --- | --- |
| Goal scope | Continue the active full-surface redo until every Settings tab, populated workbench view, and transcript detail state has executable browser evidence. Preserve Run, the single Chat/expert-squad launcher selector, real API ownership, and all i18n contracts. |
| Acceptance criteria | Capture all 12 Settings tabs in light and dark at 1808x1257; keep Expert Squads low-density with runtime diagnostics default-collapsed; remove 24px container radii from the Settings domain; show Requirements, Goals, and Architect with populated real fixtures; keep answer text visible while reasoning, tool, patch, subtask, and delegated context are collapsed by default and accessible after disclosure. |
| Hard constraints | No fallback, duplicate fixture surface, hidden message fork, synthetic UI-only state, mobile scope, or user-process restart. Reuse the real Settings panel owners, existing workbench fixture, `CardParts` work-detail classifier, and chronological transcript fixture. Run remains between View and Help. |
| Sources read | This record through the launcher regression; all Settings panel owners and `settings.css`; `ExpertSquadPanel.tsx`; `CardParts.tsx`; `ChatBubble.tsx`; Requirements/Architect/Goal panels; config/workbench/transcript browser fixtures; current light/dark screenshots. |
| Whole-repository grep | Focused searches enumerated all Settings tabs and `--oc-radius-xl` consumers, requirement status/type labels, Architect category truncation, notification/file-explorer literals, work-detail part classifications, delegated-context ownership, and existing browser screenshots. |
| Independent feedback | A Settings adjudicator rejected the first pass because real Settings containers still consumed the 24px `--oc-radius-xl` token. A separate workbench/transcript adjudicator passed after verifying Run, i18n, populated panels, and all default-collapsed non-body message classes. |

### Result

- All 12 Settings tabs now have current 1808x1257 screenshots in light and dark. The matrix clicks the real Kobalte tabs, verifies selection/theme/background/bounds/overflow, and records General, Appearance, Expert Squads, Channel, Skills, Skill Market, MCP Servers, Task Context, Network, Providers, Agent Models, and About.
- Expert Squads keeps selection, project/session activation, import/export, and member identity visible. Projection hashes, active projection, README, selector guidance, scheduler capability, and per-agent capability are grouped under one default-closed `Technical details` disclosure with English and Chinese labels.
- The Settings stylesheet no longer consumes `--oc-radius-xl`; the content corner, group bodies, About blocks, Expert Squad list/detail, provider blocks, and Agent Model table use the shared 8px `--oc-radius-large` token. A static test rejects any future `--oc-radius-xl` use in this domain.
- The shared expert-squad browser fixture was corrected at its contract boundary: capability presence counts array resource refs only, not scheduler identity strings, and active-agent identity is validated only when a projection is supplied. The regression test covers an active non-general squad with no projected resources.
- The existing real controls fixture now records populated Requirements, Goals, and Architect panels. Requirement type/status/priority labels and Goal advisory/worktree labels use i18n, Architect renders every category, File Explorer uses the localized directory-required error, and Notification Center uses status icons instead of English initials.
- Agent answer text and inline Markdown/embed content remain visible on the transparent message canvas. Reasoning, tool calls, patch summaries, subtasks, and delegated scheduler context are absent from the default body and appear only after the existing Work details or Delegated context disclosure is opened. Browser tests cover both English and Chinese delegated-context labels.
- Passed in this round: 29 focused Settings/expert-squad fixture tests, Overlay TypeScript, production Vite build, the 12-tab dual-theme Settings matrix, populated controls fixture, message work-detail fixture, agent summary fixture, and chronological delegated-context fixture. Current screenshots were personally reviewed.
- Independent workbench/transcript adjudication returned PASS. Settings adjudication was re-requested after the 8px correction and refreshed matrix; the parent Goal remains active until that final response and the broader scoped regression/build/document checks complete.

## 2026-07-11 Final regression and adjudication closure

### Evidence

- The uninterrupted Overlay unit runner completed with exit code 0 after fixture contracts were aligned with the strict persisted-message origin schema. Production `tree-writer` validation was not weakened: test messages and part-first events now explicitly provide `role`, `author`, `channel`, `resolvedRole`, and `originSource`.
- `project-directory-request-loop` now validates the real mode-specific Skill and MCP effects instead of requiring retired generic source-code shapes. Skill, MCP, Tool, and Skill Market continue to use one directory-scoped extension source.
- Tree-writer performance tests execute their real timed paths: 1,000 reasoning deltas completed in 4.2ms, 10,000 in 14.9ms, 5,000 executor deltas across 1,500 cards in 5.7ms, and 500 new sessions in 137.9ms on the verification host.
- Overlay `typecheck`, panel `check:i18n`, and production Vite `build` all completed with exit code 0. Three locale keys left unused by the Settings refactor were removed from both `en-US` and `zh-CN`; no compatibility keys remain.
- The focused Node browser matrix passed 19/19 after correcting three stale fixtures: the composer assertion now follows the 14px control token, the expert-squad submit fixture carries persisted origin metadata, and the responsive titlebar contract explicitly preserves `File / Edit / View / Run / Help`. The rerun of the previously failing group passed 9/9.
- Personal screenshot review covered the Expert Squads page and default-collapsed state, the unified Chat/expert-squad selector, the transparent transcript with visible body and collapsed delegated context, all Settings light/dark captures, and populated Requirements/Goals/Architect surfaces. No incoherent overlap, clipping, or newly exposed outer message window was found.

### Independent adjudication

- The launcher/expert-squad adjudicator closed the visible Mission placeholder, hidden-header, composition containment, dark-theme, and Run findings and reported no remaining blocking or severe issue.
- The workbench/transcript adjudicator returned `PASS` for visible body content, collapsed reasoning/tool/patch/subtask/delegated context, Run retention, i18n labels, and populated workbench surfaces.
- The Settings adjudicator returned `PASS` after confirming the 8px Settings radius boundary, all 24 dual-theme captures, default-collapsed Technical details, and no new dark-theme overflow or contrast issue.
- A new final `gpt-5.5` adjudicator launch failed before review because the external model usage quota was exhausted. This is recorded as an unavailable extra review, not as a pass; the three completed independent adjudications above remain the authoritative scoped decisions.

### Final disposition

- Run remains an intentional OpenCorvus adaptation.
- Chat and expert squads share one mutually exclusive composer dropdown. Chat submits without an expert-squad profile; selecting a squad implies the Mission execution path without exposing Mission as a standalone selector option.
- Expert Squad configuration remains at the upper-left of the Settings workspace and uses the same modern low-density Settings language.
- Message body content stays visible. Tool calls, reasoning, patches, subtasks, and delegated context remain truthful but default-collapsed; the message canvas remains transparent and borderless, including hover.
- The full desktop-only Goal is accepted by current executable, screenshot, build, i18n, and independent-adjudication evidence. No mobile/tablet scope was introduced and the user's running Overlay process was not restarted or refreshed.
