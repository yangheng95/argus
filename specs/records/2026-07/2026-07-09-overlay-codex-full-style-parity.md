# Overlay Codex Full Style Parity

## Recall

User request:

- Set a long-running goal to make the current Overlay UI (User Interface, 用户界面) match Codex desktop style completely.
- Do not mechanically copy pixels; preserve OpenCorvus semantics while matching Codex information architecture, density, control shape, spacing rhythm, and interaction semantics.
- Synchronize code changes caused by the UI change.
- Message panel: tool calls and thinking/reasoning must use the same collapsed Codex-style treatment; default transcript shows body messages, not raw tool output or reasoning walls.
- Use an independent agent as adjudicator so small controls and details are not missed.

Referenced images:

- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-1.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-2.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-3.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-4.png`
- `C:\Users\chuan\.codex\attachments\218d1b9f-d93c-43a0-99a1-d089113446c7\image-5.png`

Hard constraints:

- No fallback, compatibility branch, second source, keyword gate, or raw color fork.
- Do not hide root causes behind cosmetic patches. UI behavior changes must be represented in the existing message/card ownership model.
- Preserve requirements after compression.
- Frontend delivery must start a real page, screenshot, inspect, repair drift, and retest.
- Browser verification must use the Node.js Playwright path on Windows; do not use Bun to start Playwright on Windows.
- Do not restart, close, refresh, or kill the user's running OpenCorvus or Overlay process; use isolated tests.
- Test timeout must be inactivity-based.
- Code changes require tests; benchmark passing must be followed by second review.
- Commit subject must start with `dsw-33987`; push to `legacy-remote`.

Persisted records read before implementation:

- `specs/current/architecture/99-principles.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-09-codex-reference-light-theme.md`
- `specs/records/2026-07/2026-07-08-overlay-codex-milk-tea-light-theme.md`
- `specs/records/2026-07/2026-07-08-codex-message-panel-titlebar-toolbar.md`
- `specs/records/2026-07/2026-07-08-overlay-codex-font-size-alignment.md`
- `specs/records/2026-07/2026-07-08-message-pane-agent-rail-geometry-toolbar-alignment.md`
- `specs/records/2026-07/2026-07-08-message-pane-rail-header-scrollbar-repair.md`
- `specs/records/2026-07/2026-07-09-message-composer-scrollbar-alignment.md`
- `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`
- `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`
- `specs/records/2026-07/README.md`

Whole-repository searches performed:

- `rg -n 'ChatBubble|InlineToolPart|ReasoningPart|ToolPart|tool call|tool-call|reasoning|thinking|collapsed|defaultExpandedForNode|ConversationAgentRail|chat-scroll|chat-input|chat-header|conversation-body|displayToolIcon|StepPayloadBody|CardHeader|Card\(' packages/overlay/src packages/overlay/test -S`
- `rg -n 'reasoningPartHidden|touchReasoningPart|reasoningRevision|ReasoningPart|data-ui="reasoning-toggle"|msg-reasoning|msg-tool|InlineToolPart|mode="block"|mode="body"|part\?\.type === "tool"|toolToCardNode|defaultExpandedForNode|collectLatestActivityText' packages/overlay/src packages/overlay/test -S`
- `rg -n 'body\[data-theme="light"\]|--bg|--surface|--rail-surface|--chat-canvas|--menu-panel-bg|--dialog-bg|--border|--shadow|--oc-radius-xl|--ui-font-body|--ui-chat-message-content-width|--ui-chat-message-scroll-width|--ui-rail-width|--oc-header-height' packages/overlay/src/styles packages/overlay/test -S`
- `rg -n 'solidLeftPanelActions|sidebar|leftPanel|Projects|work_ledger\.title|command palette|CommandPalette|cmdk|settings|Settings|solidChatComposer|chat-composer-stack|chat-input|chat-header|titlebar|Open in|solidChatHeader' packages/overlay/src packages/overlay/test -S`

Independent adjudicator feedback:

- The transcript must not retain old card-heavy visual noise.
- Assistant body must remain visible by default.
- Tool and thinking rows must be compact, expandable, and default collapsed with ARIA and keyboard coverage.
- Screenshots must cover empty home/composer, normal conversation, collapsed/expanded tool-thinking, settings, command palette, and menu.
- Final compare must use the provided reference images.

## Current Code Surface

- `ReasoningPart.tsx` owns the reasoning disclosure and Markdown rendering.
- `utils/card-tree.ts` owns default expansion and collapsed latest-activity previews.
- `store/card-tree-stats.ts` owns cached preview parity for store-backed cards.
- `ChatBubble.tsx`, `Card.tsx`, and `CardHeader.tsx` remain the single transcript/card render owners.
- `settings.css`, `titlebar.css`, `chat-bubble.css`, `messages.css`, and `card.css` own the visual surfaces through existing tokens.

## Implementation Contract

- User messages stay expanded.
- Assistant/message body cards stay expanded by default so the transcript shows body messages.
- Reasoning defaults collapsed and expands through the existing `ReasoningPart` disclosure to render real Markdown.
- Non-Todo tools default collapsed; expanding the existing card reveals real input/output/diff/evidence.
- Todo tools stay expanded because they are the task-plan surface.
- Collapsed previews exclude reasoning and use only body text plus useful non-Todo tool summaries.
- Visual shell uses central tokens and existing primitives; no raw color fork or second message tree is introduced.
- Accessibility must include `aria-expanded`, keyboardable real buttons, and focus-visible states.

## Verification Plan

```powershell
git diff --check -- <changed files>
rg -n -- 'fallback|兜底|compat|legacy|double source|visibility|audience|synthetic|ignored|#[0-9a-fA-F]{3,8}|--shadow-xs' <changed files>
$env:OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS='120000'
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/reasoning-toggle-button-browser.test.ts packages/overlay/test/browser/reasoning-markdown-browser.test.ts packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts packages/overlay/test/browser/chat-composer-button-primitives.test.ts packages/overlay/test/browser/command-palette.test.ts packages/overlay/test/browser/titlebar-menu-order.test.ts packages/overlay/test/browser/config-dialog-resizer.test.ts
bun test packages/overlay/test/reasoning-part.test.ts packages/overlay/test/card-collapsed-preview.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts
```

Visual review must inspect:

- `.scratch/config-dialog-resizer.png`
- `.scratch/titlebar-settings-menu-open.png`
- `.scratch/overlay-empty-home-composer-light.png`
- `.scratch/command-palette-dialog-primitive.png`
- `.scratch/overlay-codex-message-expanded-default.png`
- `.scratch/overlay-codex-tool-reasoning-expanded.png`
- `.scratch/chat-bubble-disclosure-preview-click.png`

Independent adjudicator must review the regenerated screenshots and code behavior before final delivery.
