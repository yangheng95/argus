# Card Header Metadata And Conversation Scale

## Recall

| Item | Detail |
| --- | --- |
| User requests | Move elapsed time to the end of the conversation header; replace the three always-visible model/context/usage values with one icon whose hover surface shows those three values; raise the metadata typography to the left-menu scale; enlarge conversation text and icons to the corresponding application scale. |
| Acceptance criteria | Model, context tokens, and turn usage have one focusable shared icon and one hover/focus tooltip; the tooltip contains exactly those three semantic rows when all data is present; elapsed time is the final visible header item after the action toolbar; conversation identity/body typography and avatar/action glyphs no longer resolve below the left-menu visual tier; mouse, keyboard, accessible names, existing actions, copy/rewind/cancel behavior, and compact child-agent timing remain intact; focused tests, typecheck, i18n, Node-started browser checks, and manually reviewed desktop screenshots pass. |
| Hard constraints | Reuse Kobalte Tooltip plus the existing `Button` and Lucide-backed `Icon` primitives; keep `CardHeaderChrome`, `CardDurationChip`, `ChatBubble`, and shared typography/icon tokens as the single owners; no fallback renderer, duplicate metadata source, handwritten icon, mobile/tablet scope, new worktree, or interference with the user's running OpenCorvus process; Playwright/browser work is Node-started and targets an isolated fixture. |
| Supplied evidence | The first crop shows elapsed time before a wide metadata/action rail; the second crop isolates the three visible values `hexin/gpt-5.5`, `~22k tok`, and `105k tok`. The user reports that both this metadata and the conversation typography/icons are undersized relative to the left menu. |
| Sources read | `AGENTS.md`; `specs/README.md`; July records for Agent-card time/action chrome, message transcript visual language, user-message hover metadata, and Agent message action icons; `CardHeader.tsx`; `CardHeaderChrome.tsx`; `ChatBubble.tsx`; `Avatar.tsx`; `card.css`; `chat-bubble.css`; `sidebar.css`; `work-ledger.css`; focused static and browser tests. |
| Whole-repository search | `rg` enumerated every `CardDurationChip`, `CardMetaHint`, `card-{model,token,usage}-hint`, `card__meta-actions`, `chat-bubble__identity-meta`, `chat-avatar__icon`, and metadata browser assertion. Production owners are `CardHeaderChrome.tsx` for metadata/action behavior, `CardHeader.tsx` and `ChatBubble.tsx` for header ordering, `card.css` for shared card chrome/tooltip, and `chat-bubble.css` for conversation scale. Regression call points are `card-header-chrome.test.ts`, `card-duration-single-source.test.ts`, `chat-bubble.test.ts`, `card-header-metadata-tooltip-browser.test.ts`, `agent-card-separation-browser.test.ts`, and `rewind-visual-stress.test.ts`. Historical records remain unchanged. |
| Independent agent feedback | None. The user did not request sub-agents, and this is one tightly coupled header/typography surface. |
| Git baseline | `HEAD` `84cc83693` equals `origin/work-v0.0.6beta-yr-0716`. Existing dirty Expert Squad, small-window typography, tool-grouping, generated payload, and adjacent test changes are preserved and excluded from this task's staged delivery. |

## Root cause

The header renders model, context, and usage as three separate focusable text chips at a literal `10px * --ui-scale`, while the left static navigation and Work Ledger rows resolve at `13px * --ui-scale` with 14px glyphs. Their combined width dominates the action rail and their small, faint text creates the reported scale discontinuity. `CardDurationChip` is mounted inside the title/identity owner before `CardHeaderChrome`, so flex layout can only place it before metadata and controls. In the conversation surface, narrative text already uses the shared body tier, but the identity title remains body-sized and the 20px avatar contains an 11px glyph; that icon is materially smaller than the left-menu glyph tier.

## Implementation plan

1. Replace the three `CardMetaHint` triggers with one Kobalte Tooltip trigger backed by the shared icon `Button`; render model, context, and usage as three structured rows inside its tooltip and keep one localized accessible summary.
2. Move the shared duration chip after the action projection in both generic card headers and top-level Agent conversation headers; preserve compact child-agent timing inside its existing identity row.
3. Route metadata tooltip text through the application control/body typography tiers, route conversation identity/body emphasis through the next existing shared tier, and size avatar/action glyphs from the canonical icon token.
4. Replace every focused source/browser expectation that names the retired three-chip topology; assert one trigger, three rows, keyboard focus, tooltip typography, final time order, and icon/text scale relative to the left-menu contract.
5. Run focused tests, Overlay typecheck/i18n/build and documentation health; then run the production-shaped isolated desktop fixture through the Node browser path, hover/focus the metadata icon, capture screenshots, inspect them at original resolution, and correct any visual mismatch.
6. Review the exact diff twice, stage only task-owned files/hunks, commit with the `dsw-33987` prefix, and push the current git-cc branch.

## Verification

```powershell
bun test packages/overlay/test/card-header-chrome.test.ts packages/overlay/test/card-duration-single-source.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/chat-bubble-role-distinction.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/card-header-metadata-tooltip-browser.test.ts packages/overlay/test/browser/agent-card-separation-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implemented result

- `CardHeaderChrome` now owns one focusable `info-circle` metadata trigger and one Kobalte tooltip. The tooltip projects the existing model, context-token, and usage values into three labeled rows; the three retired text triggers and their 10px chip styling are removed.
- Generic card headers and top-level Agent turns render the shared duration chip after the action projection. Compact child-agent turns keep their inline duration through the same component.
- Metadata/duration copy uses the control typography token. Conversation identity and narrative copy use the title tier, the avatar grows to 24px, and avatar/action glyphs use the canonical icon-size token.
- The focused source and browser contracts now assert the single-trigger topology, keyboard-visible three-row tooltip, final duration ordering, and typography/icon sizes against the left-menu tier.

## Validation and second review

| Check | Result |
| --- | --- |
| Focused component tests | 29 passed, 0 failed, 322 expectations. |
| Overlay TypeScript typecheck | Passed. |
| Overlay internationalization checker | Passed after deleting the proven-dead `files.changes` entries that were the checker's only reported unused keys. |
| Overlay production build | Passed; Vite transformed 2,456 modules and emitted the production bundle. The existing large-chunk advisory remains informational. |
| Node-started browser checks | 2 passed: the Agent conversation surface and focusable metadata-tooltip scenario both rendered in the isolated desktop fixture. |
| Visual review | Original-resolution inspection of light, dark, and focused-tooltip captures confirmed one metadata icon, three readable tooltip rows, elapsed time after the toolbar, and conversation text/icons aligned with the left-menu scale. The browser assertion also measures tooltip text and glyphs against the rendered sidebar menu. |
| Documentation health | Historical links and all other document-health assertions passed. The first run correctly rejected the new monthly link while its target remained untracked; the final run is performed after exact staging so the tracked-file invariant can evaluate the delivered state. |
| Whitespace review | `git diff --check` passed. |
| Exact-diff review | Reviewed production ownership, localization, source tests, browser assertions, and screenshots twice. The adjusted Agent browser expectations replace stale pre-existing boxed-card/transparent-toolbar assumptions with the current quiet-turn and toolbar contracts before asserting this task's scale/order requirements. |
