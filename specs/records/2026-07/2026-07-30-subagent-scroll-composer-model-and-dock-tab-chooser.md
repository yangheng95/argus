# Sub-agent Scroll, Composer Model, and Dock Tab Chooser Repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| Original user request | 1. The selected `Squad agents` transcript must automatically follow new content to the bottom instead of repeatedly moving upward. 2. The Composer's pill controls must remain visibly smaller than the send/stop action. 3. Every model choice must show its provider-prefixed full model code on one line instead of duplicating a short name and full ID on two lines. 4. Double-clicking genuine blank space in the Right Dock tab strip must open the selectable-tab chooser instead of opening a Browser tab. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-8d72264b-7c04-4a19-b9cc-2a123bf14dab.png`, `codex-clipboard-0617dd4d-addc-42ca-ac0d-b248db407652.png`, `codex-clipboard-cbdd2c23-b69a-4eca-91ff-61daf2831db9.png`, and `codex-clipboard-205af283-44a6-4ecc-8e94-56fb35d62a57.png` were inspected in the request. They identify the exact desktop `Squad agents`, Composer toolbar, model picker, and Right Dock tab-strip delivery regions. |
| Acceptance criteria | A running selected child transcript stays bottom-pinned across canonical transcript revisions while deliberate manual upward scrolling still releases follow mode. Composer mode/context/model pills consume the existing chip-height token and the send/stop action consumes the larger icon-button token. Model options contain one visible full ID such as `deepseek/deepseek-chat`. A blank-strip double-click opens the same Kobalte add menu owned by the `+` trigger and creates no tab until the operator chooses an entry. |
| Hard constraints | Preserve the canonical exact-session route, conversation-Agent projection, selected model value, Right Dock tab collection, Kobalte primitives, native Browser tab identity, and shared density tokens. Do not add a second scroll owner, model label source, tab chooser, compatibility path, fallback, gate, state machine, iframe, query override, worktree, or hard-coded replacement density. Do not add, modify, update, or run UI automated tests. Validate the UI only by interacting with a real desktop page and personally inspecting goal-bound screenshots. Playwright, if needed for manual browser control, runs through Node rather than Bun. Preserve and exclude unrelated concurrent worktree changes. |
| Existing records read | `specs/current/architecture/06-provider.md`; `specs/current/architecture/07-panel.md`; `2026-07-25-subagent-progress-grid-and-conversation-dock.md`; `2026-07-28-subagent-conversation-refresh-storm-repair.md`; `2026-07-28-conversation-scrollport-composer-boundary-repair.md`; `2026-07-29-composer-conversation-context-flags.md`; `2026-07-29-composer-model-trigger-neutral-parity.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `2026-07-30-right-dock-new-tab-active-selection.md`. |
| Whole-repository grep | `setupAutoScroll` has exactly two production callers: `Conversation.tsx` and `SubagentConversationPanel.tsx`; the utility is the single follow-lock implementation and both callers own only their local tracking signal. `ComposerModelSelector.tsx` alone groups `connectedModelOptions()` and renders Composer model rows; `services/llm.ts` already supplies the canonical fully-qualified `value`. `ChatComposer.tsx` alone mounts the Code/Work control, conversation context badges, Composer model trigger, and send/stop action; `composer.css` alone overrides their surface geometry. `RightDock.tsx` alone binds blank-strip `onDblClick`, the shared add dropdown, its catalog, and Browser creation; `main.tsx` alone owns the add-menu signal and the ordered tab collection. Existing UI-test files were identified only as historical consumers and will not be changed or run. |
| Independent review | Claude Code 2.1.147 was invoked in the repository with `Read,Grep,Glob` only and no session persistence, but returned `Not logged in · Please run /login` before reading files. It produced no review or modification. The primary Agent therefore owns the required second review and records this missing external feedback rather than inventing a result. |
| Baseline and concurrency | `git fetch myhexin` completed. During investigation another owner advanced and pushed `work-v0.0.24beta-yr-0729` from `fd2d368bbd` to `cbbac9efa1`; local and remote then matched. Existing uncommitted ChatBubble, ProgressiveList, primitive-style, inspector-style, and spec edits are unrelated concurrent work and must remain untouched and outside this task's staged paths. |

## Causal chains

### 1. Selected sub-agent transcript moves upward

1. `SubagentConversationPanel` correctly keys its resource to the selected
   canonical Agent transcript revision and notifies the shared scroll controller
   through `contentChanged()`.
2. Replacing a long rendered transcript can clamp or re-anchor the scroll
   element before the browser dispatches its resulting `scroll` event.
3. `setupAutoScroll` compares that new `scrollTop` with the landing position
   remembered before the DOM replacement. Any unmatched negative delta is
   classified as operator intent, so it calls `onUserScrollUp()` even though no
   operator input occurred.
4. Tracking becomes false before the scheduled bottom correction executes.
   Every later transcript revision therefore preserves or compounds the upward
   position instead of following the newest content.
5. The repair belongs in the single shared controller: an explicit
   `contentChanged()` notification must rebase its expected landing position to
   the browser's current post-layout `scrollTop` before scheduling the existing
   bounded bottom pin. A genuine later user scroll still has no content-change
   rebase and continues to release follow mode.

### 2. Composer pills match the primary action

1. The design-language source already defines a smaller
   `--oc-density-chip-height` and a larger `--oc-density-icon-button`.
2. The Code/Work segmented primitive already uses chip height, but conversation
   context badges and the model trigger override their minimum/trigger height
   to `32px`, which equals the icon-button/send token.
3. The repair is to route all Composer pill surfaces through the existing chip
   token while leaving the send/stop action on the icon-button token. No new
   component size or numeric density source is needed.

### 3. Model rows duplicate identity

1. `connectedModelOptions()` already provides the canonical fully-qualified
   model `value`.
2. `ProviderModelGroup` splits that ID into a short label, then renders both the
   short label and the unchanged full ID in a two-row copy container.
3. The split is presentation-only duplication. Render the canonical ID once,
   keep it as the Listbox value/search text, and retire the second visible line
   and its CSS.

### 4. Blank Dock double-click opens Browser

1. `RightDock` already limits the double-click handler to exact strip
   background through `event.target === event.currentTarget`.
2. That handler closes both menus and calls `onNewBrowserTab`, so the observed
   Browser creation is the explicit current contract rather than event
   bubbling.
3. The same component already owns one controlled Kobalte add dropdown used by
   the `+` trigger. Blank-strip double-click must close only overflow and set
   this existing add-menu signal to true. The menu remains the sole choice
   surface and its existing item handlers remain the sole tab-creation path.

## Production call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/utils/dom-utils.ts` | Rebase `expectedTop` and clear a stale programmatic target at the start of a tracked explicit content-change notification, then retain the existing two-frame bottom correction and manual-scroll release semantics. |
| `packages/overlay/src/components/Conversation.tsx` | Keep every existing `contentChanged()`, measured-content, history, virtualizer, bottom-button, and tracking call unchanged; it benefits from the corrected single controller without gaining a second behavior. |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` | Keep the exact selected-session resource, transcript revision, local tracking signal, and explicit content notification unchanged. |
| `packages/overlay/src/styles/surfaces/conversation.css` and `inspector.css` | Keep the canonical scroll owners and `data-follow-lock` overflow-anchor rules unchanged. |
| `packages/overlay/src/components/ChatComposer.tsx` | Keep one mounting path for mode/context/model/action controls; no component fork. |
| `packages/overlay/src/styles/surfaces/composer.css` | Replace context-badge and model-trigger `32px` geometry with `--oc-density-chip-height`; keep send/stop on `--chat-composer-action-size`, which resolves to `--oc-density-icon-button`. Recompose model options as one-line rows and retire the second-line rule. |
| `packages/overlay/src/components/ComposerModelSelector.tsx` | Keep provider grouping and canonical option IDs; remove the presentation-only split label/provider-name fields and render `option.id` once. |
| `packages/overlay/src/services/llm.ts`, `store/app.ts`, and request services | Keep unchanged; they already own the fully-qualified model value and selection transport. |
| `packages/overlay/src/components/RightDock.tsx` | Point exact-background double-click to the existing controlled add menu. Keep `RIGHT_DOCK_CATALOG`, `nextBlankBrowserTab`, plus-trigger behavior, empty chooser, overflow menu, and item creation handlers unchanged. |
| `packages/overlay/src/main.tsx` | Keep the sole add-menu signal and ordered tab/browser-instance state owner unchanged. |
| Current architecture and indexes | Update the normative panel contract and both required spec indexes; retain older records only as historical evidence. |
| Existing UI tests | Do not modify or run them under the 2026-07-29 UI automation prohibition. |

## Implementation and verification plan

1. Commit and push this Recall/plan without staging concurrent files.
2. Apply the single-controller scroll rebase, token-based Composer sizing,
   one-line canonical model identity, and existing-menu Dock double-click
   changes.
3. Run formatting, Overlay TypeScript typecheck, production build, i18n, and
   documentation-health checks. These checks may validate compilation and
   non-UI document contracts only; they do not replace visual acceptance.
4. Launch the real Overlay page, interact with the four task-owned desktop
   regions, capture current-goal screenshots, personally inspect them, and
   iterate until the requested behavior and hierarchy are visible.
5. Inspect the complete diff and repeat relevant static checks as the primary
   Agent's second review. Commit only task-owned paths and push the final
   `dsw-33987` commit to `myhexin/work-v0.0.24beta-yr-0729`.

## Status

- [x] Recall, evidence, causal chains, and production call-site audit recorded.
- [x] Plan commit `73d80618a8` and git-cc push completed.
- [x] Product implementation completed.
- [x] Static and documentation verification completed.
- [ ] Real-page interaction and screenshot review completed only for the
  Composer density and Dock chooser delivery surfaces; the exact live
  sub-agent-follow and connected-model-row surfaces remain blocked by the
  current local runtime state documented below.
- [x] Primary-Agent second review completed against the full task-owned diff.
- [x] Final implementation commit `80e3909818` and git-cc push completed.

## Verification evidence

| Surface | Result |
| --- | --- |
| Shared follow controller | The final diff confirms that every tracked `contentChanged()` notification rebases `expectedTop` and clears the prior programmatic target even when a correction frame is already queued. The existing bounded bottom pin and genuine upward-scroll release remain the only follow behavior. |
| Composer density | In the real Overlay at `http://127.0.0.1:5173/`, computed layout measured Code and Work at `24px`, the model trigger at `24px`, and the send action at `32px`. The screenshot at `.scratch/2026-07-30-subagent-scroll-composer-model-dock/composer-pill-density.png` was personally inspected and shows the requested smaller-pill hierarchy. |
| Model row identity | TypeScript and production build verification confirm that the canonical provider-prefixed `option.id` is now the only rendered and searchable row text. The real model chooser reported no connected providers, so no authenticated model row was available for honest live visual inspection. |
| Dock blank-strip double-click | On the real empty Right Dock tab strip, a Node-driven Playwright double-click opened the existing Kobalte menu with Browser, Review, Files, Screenshots, Requirements, and Goals. The observed open-tab count remained zero. The screenshot at `.scratch/2026-07-30-subagent-scroll-composer-model-dock/dock-double-click-tab-chooser.png` was personally inspected. |
| Static verification | `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay build`, `bun run --cwd packages/overlay check:i18n`, and `git diff --check` passed. No UI automated test was added, changed, updated, or run. |
| Documentation verification | The first default-timeout run reached 92 passing checks and one full-repository scan timeout without an assertion failure. Re-running the same three non-UI suites with a bounded 30-second per-test timeout passed all 93 checks and 1,448 assertions. |

## Unresolved interactive acceptance

The exact selected-child transcript could not be exercised against a live
streaming Agent during this run. The persisted database contains the expected
canonical child sessions for the inspected Phase 01 and Phase 02 Tasks, but
those Tasks are already terminal. The real Overlay's backend health endpoint
returned HTTP 200 while its event source repeatedly remained `Connecting` and
reported `event-source open timeout`; after reload, the Task conversation stayed
in `Loading task` and the `Squad agents` transcript surface was unavailable.
Creating a fake stream, editing the database, or substituting fixture DOM would
violate the real-page evidence boundary, so no such evidence was manufactured.
Consequently, the scroll root cause is repaired and statically verified, but
the live streaming sub-agent acceptance requirement is not fully demonstrated
in this environment. Likewise, the one-line model row is implemented and
compiled but lacks live authenticated-provider visual evidence because the
current runtime exposes no connected providers.
