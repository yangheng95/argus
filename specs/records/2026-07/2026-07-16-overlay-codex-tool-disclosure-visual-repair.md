# Overlay Codex Tool Disclosure Visual Repair

## Recall

### User requirement

- The current tool-call presentation shown in the supplied OpenCorvus screenshot is visually poor.
- Reimplement the presentation by taking Codex's compact tool disclosure as the visual reference.

### Acceptance criteria

- Collapsed execution groups no longer paint the long stage-coloured horizontal rule that dominates the transcript.
- Tool/reasoning counts remain visible, compact, and keyboard accessible without changing persisted message order or disclosure ownership.
- The expanded surface reads as one quiet neutral disclosure with compact chronological rows; tool title, duration, summary, result, error, and timing tooltip remain fully inspectable.
- Resting, hover, focus-visible, expanded, light-theme, and dark-theme states use existing OpenCorvus primitives and tokens.
- Long tool summaries remain a single ellipsized line.
- A real isolated Overlay page is opened, screenshot, personally inspected, corrected if necessary, and rechecked. The user's running OpenCorvus/Overlay process is not restarted or refreshed.

### Hard constraints

- Follow `AGENTS.md`: no fallback renderer, second disclosure source, hidden message, gate, keyword classifier, state machine, compatibility selector, or hard-coded palette.
- Keep `CardParts` as the single message-part/disclosure owner, `Card`/`CardHeader` as the tool-row owner, and `messages.css` as the single transcript execution presentation source.
- Reuse the existing Solid `Button`, `Icon`, disclosure primitive, design tokens, timing tooltip, and browser fixtures.
- Do not redesign tablet/mobile surfaces; this is desktop-only visual acceptance.
- Do not overwrite or stage the unrelated concurrent dirty worktree changes in App, ChatBubble, docks, Work Ledger, shared file rows, styles, tests, or other July records.
- Playwright/browser fixtures run through Node on Windows. No Bun-started Playwright process is allowed.
- Commit subjects start with `dsw-33987` and delivery is pushed to the current git-cc tracking branch.

### Sources read before implementation

- `AGENTS.md`
- supplied screenshot `codex-clipboard-167dedfe-8536-4bcc-87f0-0ff75e508933.png`
- browser-control skill instructions
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-14-overlay-tool-call-timing-tooltip.md`
- `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `specs/records/2026-07/2026-07-15-tool-call-single-line-authority.md`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/InlineToolPart.tsx`
- `packages/overlay/src/styles/surfaces/messages.css`
- `packages/overlay/src/styles/surfaces/card.css`
- focused unit and Node browser tests for message embeds, execution chronology, agent summaries, card separation, timing, focus, and long tool headers

### Whole-repository search evidence

- `rg -n "msg-work-details|work-details-toggle|ExecutionDisclosureRun|ExecutionEventRun|workSummary\\(" .` found one production disclosure owner in `CardParts.tsx` and one production style owner in `messages.css`.
- `CardParts.tsx` emits the disclosure summary, marker, full-width rule, and chronological execution body. No route, store, service, or backend mutation participates in its visual state.
- `messages.css` owns every `.msg-work-details*` selector. The current dominant line is `.msg-work-details__rule`; the stage-coloured body guide is the `border-left` on `.msg-work-details__body`.
- `Card.tsx` renders nested tool bodies through `InlineToolPart`; `CardHeader` and `card.css` retain the one-line title/duration/summary and timing tooltip contract. They are consumers, not a second disclosure implementation.
- Production `CardParts` call sites are `ChatBubble.tsx` and `Card.tsx`. Their `collapseWorkDetails` use remains unchanged.
- Focused test consumers are `message-embed.test.ts`, `message-part-render-order.test.ts`, `chat-bubble-disclosure-button-browser.test.ts`, `agent-summary-card-browser.test.ts`, `agent-card-separation-browser.test.ts`, `message-part-chronology-browser.test.ts`, `message-file-link-browser.test.ts`, and `image-preview-copy.test.ts`.
- The current worktree has unrelated uncommitted changes, but `CardParts.tsx`, `messages.css`, `message-embed.test.ts`, and the chronology fixture/test are clean at task start. The pushed baseline is `aaa616377` on `work-v0.0.6beta-yr-0716`.

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The primary agent owns the implementation, screenshot review, and second diff review.

## Root cause

The current disclosure uses a chapter-heading metaphor: every execution run stretches a button across the entire transcript and fills the remaining width with a stage-coloured rule. Repeated groups therefore become a stack of long orange lines, while the expanded body adds another stage-coloured vertical guide. This is presentation amplification of secondary evidence, not a message-stream or grouping defect. The correct repair is to replace those two decorative rails in the existing disclosure with a compact neutral control and one quiet expanded container, preserving the single renderer and all chronological evidence.

## Implementation plan

1. Remove the decorative rule element from `ExecutionDisclosureRun`; keep the canonical Button, summary, chevron, disclosure state, and chronological body.
2. Restyle the existing disclosure in `messages.css` as a compact, content-width neutral control. Use a restrained hover/focus wash and a single expanded inset surface with no stage-coloured horizontal or vertical rails.
3. Keep nested tool headers flat and one-line, but give expanded events enough internal spacing and hover clarity to scan as Codex-style rows.
4. Replace source assertions that encode the retired full-width rule/rail with assertions for the compact neutral contract, then extend the real chronology browser test to verify geometry, background, focus, expansion direction, and absence of the retired rule.
5. Run focused tests, typecheck/build, i18n and document-health checks, inspect isolated light/dark desktop screenshots in the browser, correct visible defects, perform a second diff review, commit only task-owned files, and push the tracking branch.

## Verification plan

```powershell
bun test packages/overlay/test/message-embed.test.ts packages/overlay/test/message-part-render-order.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and acceptance evidence

- `ExecutionDisclosureRun` keeps the existing Solid disclosure, chronological part collection, accessible Button, and chevron, but removes the purely decorative `msg-work-details__rule` element.
- `messages.css` replaces the full-width stage-coloured chapter rule with a content-width neutral row. The expanded state uses one token-backed inset surface, no stage-coloured vertical rail, left-aligned summary text, compact event spacing, and a restrained tool-row hover wash.
- Tool content ownership did not change: `Card`/`CardHeader` still render tool name, persisted timing, one-line summary, output, error, patches, attachments, and timing tooltip. No backend, route, store, message order, or disclosure state source changed.
- Static regressions now reject the retired rule and body rail, require the content-width collapsed control, token-backed expanded surface, left-aligned summary, ellipsis, and shared hover surface.
- The Node chronology browser regression now proves three in-place disclosure groups, collapsed width smaller than the transcript, nonzero radius, zero retired rules, downward expansion, bounded expanded geometry, left alignment, nontransparent inset surface, zero body rail, exact chronological events, one-line long tool header, and timing tooltip behavior.
- Focused unit tests passed: 8 tests, 0 failures across `message-embed.test.ts` and `message-part-render-order.test.ts`.
- Overlay TypeScript typecheck and Vite production build passed. The existing large-chunk warning remains informational and is unrelated to this style-only change.
- `message-part-chronology-browser.test.ts` passed through the required Node runner. The initial baseline command exposed a stale isolated browser-sidecar process after producing screenshots; that task-owned process tree was precisely identified and terminated, then the original browser test passed cleanly with its activity timer.
- `chat-bubble-disclosure-button-browser.test.ts` passed through the Node runner, including collapsed, expanded, focus, light-theme, and dark-theme transcript coverage.
- Personally reviewed `.scratch/message-part-chronology-collapsed.png`: repeated tool groups are compact left-aligned text rows with no horizontal rules, and Mission narrative remains the primary content.
- Personally reviewed `.scratch/message-part-chronology-component.png`: expanded groups render as quiet inset rows; reasoning and tool order is legible, tool title/duration/summary remains one line, and no stage-coloured rails remain.
- Personally reviewed `.scratch/overlay-codex-tool-reasoning-expanded.png`, `.scratch/overlay-transcript-dark-expanded.png`, and `.scratch/overlay-transcript-dark-default.png`: the compact disclosure survives the real Chat surface and dark palette without becoming a nested card or losing focus visibility.
- In-app Browser inspection against an isolated Node-started Vite fixture confirmed one expanded group, two exact chronological events, zero rule elements, zero body left border, left-aligned summary, and correct `aria-expanded` state. The first visual pass caught and corrected inherited centered Button alignment before final screenshots.
- The user's running OpenCorvus/Overlay was not restarted, refreshed, killed, or reused for validation. Only the isolated fixture server and task-owned browser sidecars were stopped after testing.
- The first git-cc pre-push run passed the full workspace typecheck but correctly rejected a pre-existing OpenAPI drift introduced by baseline commit `aaa616377`: the session update route allowed `time.archived: null` while tracked `packages/sdk/openapi.json` still declared only `number`. Regenerating the tracked artifact with the repository generator changed that exact field to `number | null`; `bun run api:routes-check` then passed. No route behavior was changed.
- Historical-doc links and product-doc single-source checks passed. The combined document-health run reported four concurrent July records that other worktree changes already linked but had not yet tracked; this task did not stage or publish those unrelated records. An intermediate Overlay i18n run likewise observed five titlebar hint keys temporarily made unused by concurrent uncommitted Titlebar work. Those external edits stabilized before delivery, and the final mandatory pre-push hook passed Overlay i18n, full workspace typecheck, API route inventory, generated API docs, and secret scan.

## Second review

- Whole-task diff review confirms no new renderer, fallback, compatibility selector, hard-coded colour, state source, route, store, or message mutation.
- `CardParts`, `Card`, and `messages.css` retain their documented single-source responsibilities.
- The change is desktop-only and does not introduce responsive breakpoints or mobile acceptance scope.
- Unrelated concurrent worktree changes remain unstaged and are excluded from this task's delivery commits.
