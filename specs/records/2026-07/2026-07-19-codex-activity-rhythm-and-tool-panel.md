# Codex Activity Rhythm and Tool Detail Panel

Status: complete

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Compare the current transcript with the supplied advanced Codex design, unify Tool and Reasoning line rhythm, and correct the expanded Tool format. |
| Acceptance criteria | Collapsed Reasoning and Tools disclosures share one font, line-height, row geometry, icon baseline, and surrounding vertical rhythm; narrative text remains the primary prose tier. Expanding an execution run preserves chronology, and expanding an individual Tool reveals one canonical bordered inset panel with a quiet header followed by input and output. A completed Shell command renders as `$ command` before its output. Light/dark desktop screenshots, keyboard disclosure, timing details, focused source/browser tests, typecheck/build/i18n, document health, commit, and `myhexin/v0.0.9beta` push pass. |
| Hard constraints | Preserve `CardParts` as the only chronological execution owner, `ReasoningPart` as the only reasoning renderer, and `Card`/`CardHeader`/`InlineToolPart` as the only Tool renderer. Use existing Button/Card primitives and theme tokens; no duplicate renderer, hand-built pseudo terminal, fallback, compatibility path, gate, state machine, mobile/tablet scope, worktree, or interference with the running Overlay. Playwright remains Node-launched. Preserve untracked `C:/`. |
| Supplied evidence | Current screenshot `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-fce1d18a-bbb8-4dbe-97ae-bb331e0e0b39.png` shows generic Reasoning/Tools rows with drifting spacing and no Tool detail container. Codex reference `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-f6d8a9b1-984f-4731-b52b-8e747f3fcd48.png` shows a consistent compact activity rhythm and an expanded `Shell` panel containing `$ bun run build` followed by output. Both were inspected at original resolution. |
| Sources read | `AGENTS.md`; Browser skill already active for this task; current architecture/spec indexes; the 2026-07-16/17 Tool disclosure, density, plain-stream, and inline-flow records; `CardParts.tsx`; `ReasoningPart.tsx`; `Card.tsx`; `CardHeader.tsx`; `InlineToolPart.tsx`; `tool-card-node.ts`; `tool.ts`; `messages.css`; `chat-bubble.css`; `card.css`; focused source and browser tests; current blame and the superseding `3e923cf35` diff. |
| Whole-repository search evidence | `rg` enumerated every `msg-work-details*`, `reasoning-toggle`, nested Tool Card override, Tool output, activity summary, Tool timing, and message-run spacing owner. Production ownership is singular. Direct test consumers are `message-embed.test.ts`, `reasoning-part.test.ts`, `chat-bubble.test.ts`, `message-part-chronology-browser.test.ts`, `chat-bubble-disclosure-button-browser.test.ts`, `reasoning-toggle-button-browser.test.ts`, Tool display/body tests, and architecture guards. |
| Independent agent feedback | None. The user did not request sub-agents, and unrequested delegation is disabled. |
| Git baseline | Local and `myhexin/v0.0.9beta` both point to `1b74895f4`; only the unrelated untracked `C:/` directory exists. |

## Evidence and causal chain

1. **Observable:** activity labels occupy a smaller 13px tier while Reasoning prose inherits the 15px narrative tier; each message run additionally contributes 12px separation. The result is not one stable activity baseline.
2. **Direct trigger:** `messages.css` independently assigns `line-height: 1.6` to Reasoning toggle, aggregate toggle, nested Tool header, and Tool output while their font sizes come from different ancestors. Unitless values therefore resolve to different pixel heights; `card-message-run` spacing compounds the difference.
3. **Expanded-format trigger:** the current transcript override forces nested Tool Card, header, body, and `.msg-tool-output` to transparent, zero-border, zero-radius, zero-padding presentation. `InlineToolPart` also suppresses completed command input in body mode, leaving output without the Codex `Shell → $ command → output` hierarchy.
4. **Deep cause:** the July inline-flow pass correctly removed coloured hover blocks, but over-generalized “continuous text flow” into the expanded Tool detail itself. Collapsed activity rows and expanded evidence panels are different semantic surfaces and need different primitive projections.
5. **Root repair:** define one activity-row typography contract for Reasoning and Tools, keep their collapsed/rest/hover rows transparent, and restore the existing Card as the single expanded Tool detail panel. Extend `InlineToolPart` body mode to show the canonical completed Shell input before output; do not add another terminal renderer.

## Call-site disposition

| Call site | Decision |
| --- | --- |
| `CardParts.tsx` | Preserve run partitioning, summaries, chronology, and disclosure persistence. Add no state or renderer. |
| `ReasoningPart.tsx` | Preserve disclosure and streaming Markdown. Consume the shared activity-row geometry only through CSS. |
| `Card.tsx` / `CardHeader.tsx` | Preserve Tool card interaction and timing. Expanded Tool panel header remains the existing Card header rather than a new shell header component. |
| `InlineToolPart.tsx` | For completed shell-family Tools in body mode, render the already parsed canonical command as a `$`-prefixed input row before output. Other structured Tool bodies stay unchanged. |
| `messages.css` activity rows | Introduce one token-backed row font/line-height/min-height contract shared by Reasoning toggle, aggregate toggle, and nested collapsed Tool header. Keep row backgrounds transparent and text-only hover. |
| `messages.css` expanded Tool | Retire the transparent/zero-chrome overrides for the Tool Card as a whole. Project one inset surface, border, radius, header divider, body padding, and bounded output through existing theme/Card tokens. |
| `chat-bubble.css` / `card.css` | Replace the special 12px run gap only where adjacent activity/narrative runs need the shared transcript rhythm; preserve actual message-boundary timestamps and chronological ownership. |
| Tests | Assert equal computed Tool/Reasoning row line-height and height; expanded Tool panel provenance and geometry; `$ command` before output; chronology, keyboard, timing tooltip, light/dark screenshots, and no duplicate renderer. Repair the currently opaque full-conversation fixture failure at its real source if it reproduces after the implementation. |

## Verification plan

1. Add failing source/browser contracts for shared activity geometry and the canonical expanded Tool panel.
2. Implement the presentation and completed Shell-input projection at existing owners.
3. Run focused source tests and Node browser fixtures; inspect collapsed and expanded screenshots at original resolution and iterate.
4. Run Overlay typecheck, i18n, Vite build, document-health suites, `git diff --check`, and a second exact diff/call-site review.
5. Fetch and merge current git-cc state if needed, commit with `dsw-33987`, push through hooks, and verify local/remote convergence.

## Progress

- [x] Reference/current screenshots, production owners, historical decisions, blame, and direct tests audited.
- [x] Failing regressions and implementation complete.
- [x] Real-browser visual acceptance complete.
- [x] Final verification and second diff/call-site review complete.
- [x] Commit and git-cc push complete.

## Result

- Reasoning, aggregate Tools/Reasoning, and collapsed Tool headers now consume the same 14px font, 20px line-height, and 24px row-height contract. The obsolete direct-child body-gap selector was corrected for the current `card-message-run` ownership, removing the unintended additional 10px between chronological runs.
- Collapsed Tool rows remain transparent. Expanding a Tool restores the existing Card primitive as one theme-token-backed inset panel with a bordered header, padded body, and text-only output content. Completed shell-family Tools project their parsed command as `$ command` before output; no second terminal or Tool renderer was introduced.
- The full production fixture exposed two independent test-harness defects that had hidden the real UI assertion: settings injection ran inside sandboxed child frames, and multi-failure cleanup discarded nested failure messages. Injection is now top-level-only, aggregate failures retain ordered messages and locations, and the screenshot/click flow re-establishes hover after screenshot capture.
- Visual evidence was personally inspected at original resolution: `.scratch/tool-detail-panel-expanded.png`, `.scratch/tool-detail-panel-expanded-dark.png`, `packages/overlay/.scratch/overlay-codex-tool-reasoning-expanded.png`, and `packages/overlay/.scratch/overlay-transcript-dark-expanded.png`. The light and dark Tool surfaces resolve to their active `--surface-inset` token after transition settlement; no transition-frame grey or cross-theme frozen value remains.
- The in-app Browser loaded the isolated production build at `127.0.0.1:5194`, confirmed the generated bundle contains the activity-row, expanded-panel, and command-row contracts, then closed the tab and preview server without touching the running Overlay.

## Verification

- `bun test ./test/message-embed.test.ts ./test/inline-tool-output-summary.test.ts ./test/browser-settings-fixture.test.ts ./test/http-fixture-close.test.ts` — 19 passed.
- `node test/browser-runner.mjs test/browser/message-part-chronology-browser.test.ts test/browser/chat-bubble-disclosure-button-browser.test.ts` — 2 passed in visible Chromium.
- `bun run typecheck`, `bun run check:i18n`, and `bun run build` in `packages/overlay` — passed; Vite emitted only the existing chunk-size advisory.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 21 passed.
- `bun run docs:check` and `git diff --check` — passed.
