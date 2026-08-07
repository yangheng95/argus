# Handoff Context Label

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Replace the visible English `Delegated context` disclosure label with `Handoff context`. |
| Acceptance | The canonical English locale renders `Handoff context`; the existing Chinese label and disclosure behavior remain unchanged; a focused automated assertion and a real desktop screenshot verify the result. |
| Hard constraints | Preserve the single `transcript.delegated_context` localization source and the existing `DelegatedContextDisclosure` primitive; do not add fallback text, a second label path, or a new interaction; do not restart or refresh the user's running OpenCorvus/overlay process. |
| Read records | `specs/records/2026-07/2026-07-20-delegated-context-disclosure-alignment.md`, `specs/records/2026-07/2026-07-26-subagent-delegated-context-markdown-typography.md`, and `specs/records/2026-07/2026-07-28-subagent-thumbnail-height-boundary.md` establish the shared disclosure and existing browser fixture. |
| Whole-repository grep | The product label is defined once at `packages/overlay/src/i18n/en-US.json`; `packages/overlay/src/components/DelegatedContextDisclosure.tsx` consumes the key for both visible text and the accessible label. The corresponding Chinese key remains in `zh-CN.json`. Historical records retain the old wording as historical evidence. `subagent-progress-dock-browser.test.ts` supplies the English label to its isolated fixture, while `message-card-chronological-turns-browser.test.ts` renders the production locale and captures the disclosure. |
| Independent agent feedback | Not requested; no sub-agent was started. |

## Call-Site Decision

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/i18n/en-US.json` | Replace the canonical English value with `Handoff context`. |
| `packages/overlay/src/i18n/zh-CN.json` | Preserve `调度上下文`; the request changes only the English label. |
| `packages/overlay/src/components/DelegatedContextDisclosure.tsx` | Preserve; its two calls to the one localization key already keep visible and accessible names synchronized. |
| `packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts` | Add a focused assertion for the production English label and reuse its isolated Vite/Playwright screenshot evidence. |
| Historical specs and prose-only test data | Preserve; they describe prior terminology or unrelated payload content rather than the current localization source. |

## Verification

- Run the focused browser test with Node, as required for Playwright on Windows.
- Run Overlay internationalization validation and type checking.
- Inspect the generated desktop screenshot and confirm the disclosure reads `Handoff context` without clipping or geometry regressions.
- Run historical-document link and document-health checks after indexing this record.

## Result

- `bun test packages/overlay/test/delegated-context-disclosure-alignment.test.ts`: 2 passed, including the exact canonical English-label assertion.
- `bun run --cwd packages/overlay typecheck`: passed.
- The isolated real Vite page rendered through the in-app browser at the desktop viewport. All three `.msg-delegated-context__label` nodes read `Handoff context`, and all three reported `scrollWidth <= clientWidth`; `.scratch/handoff-context-label-browser.png` records the reviewed result.
- The full Node/Playwright Sub-agent fixture reached and passed the new label assertion, but its final browser-error audit failed on an unrelated transient `simulateSelectedRecordOmission is not defined` page error from concurrent uncommitted fixture work.
- `check:i18n` is blocked by unrelated concurrent locale deletions/additions in the dirty worktree, while the direct UTF-8 JSON check confirmed the canonical English value and the preserved Chinese key.
- Historical-document links passed. The combined document-health run had 81 passing checks and four failures: three machine-load timeouts and one monthly-index check covering other concurrently untracked July records; this tracked record was not an offender.
