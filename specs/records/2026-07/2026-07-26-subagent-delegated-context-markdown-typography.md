# Subagent Delegated Context Markdown and Typography

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | The child-Agent message box must render delegated context through the exact same collapsed `Delegated context` component used by scheduler cards, and expanded text must use the normal body font size. The user's follow-up screenshot clarified that a directly expanded Markdown preview is not the requested hierarchy. |
| Supplied evidence | The supplied screenshot was inspected at original size. It shows `## Delegated instruction` flattened into the opening sentence and the input preview rendered smaller than normal message body text. |
| Acceptance criteria | Scheduler and child-Agent cards import the same delegated-context disclosure component. Child cards default to the same collapsed outline row with branch icon, label, chevron, and ARIA state; clicking expands the canonical Markdown body; its paragraphs compute to the application body font size; real collapsed and expanded Vite screenshots are inspected. |
| Hard constraints | Preserve the conversation-agent `inputPreview` as the sole source. Do not add a second parser, prompt field, local signal, synthetic message, iframe, query override, or backend display projection. Preserve exact child-session routing and do not restart or refresh the user's running OpenCorvus/Overlay process. Preserve all unrelated worktree changes. |
| Sources read | Root `AGENTS.md`; Browser skill; supplied screenshot; memory notes for `SubagentProgressGrid` and Node/Vite `networkidle0`; `conversation/view.ts`; delegated-worker and local-delegate prompt builders; `conversation-agents.ts`; `SubagentProgressGrid.tsx`; shared Markdown renderer and styles; card-system architecture; current Subagent browser fixture and tests. |
| Whole-repository grep | `conversation/view.ts::userMessageInputPreview` preserves text-part Markdown and joins parts with blank lines. Both delegated prompt builders emit `## Delegated instruction` with real newlines. `CardParts.tsx::DelegatedContextParts` is the scheduler's only production disclosure renderer and owns a private Kobalte-state-compatible Button/Icon/body tree; `messages.css::.msg-delegated-context*` is its only style source. `SubagentProgressGrid.tsx` is the only progress-card consumer of `record.inputPreview`. `StaticTextPart` is the canonical non-streaming message Markdown path and already inherits `--ui-font-body`. The Subagent progress Dock fixture is the real Vite owner for card geometry, exact-session routing, and screenshot evidence. |
| Independent Agent feedback | None. The user did not request delegation or parallel agents. |

## Causal chain

Observable symptom: delegated prompt structure appears as literal `##` text
inside one small paragraph.

Direct trigger: `SubagentProgressGrid` renders the complete `inputPreview.text`
outside the scheduler's delegated-context disclosure owner. The first repair
parsed Markdown directly, but it still exposed a different always-open visual
hierarchy instead of the requested shared collapsed row.

Deep cause: `CardParts` keeps the canonical delegated-context interaction as a
private function coupled to its `PartCollection`, preventing another truthful
consumer from reusing the Button, disclosure state, label, icons, and body.

Why the data layer is not the cause: both delegated prompt builders emit real
newlines, and the canonical conversation view copies text parts without
flattening them. Changing the prompt or adding another display field would
create a second source while leaving the renderer defect intact.

## Implementation plan

1. Extract the scheduler's existing disclosure DOM and local disclosure state
   unchanged into `DelegatedContextDisclosure`.
2. Keep `CardParts` as the message-part adapter and pass its original
   `PartCollection`; make `SubagentProgressGrid` pass `StaticTextPart` to the
   same shared component.
3. Delete the progress-card-only preview/clamp styles rather than retaining a
   second visual recipe.
4. Add source regressions and make the real Subagent fixture carry the exact
   delegated-prompt Markdown shape.
5. Assert the default collapsed row, click expansion, rendered
   heading/emphasis, absence of raw markers, and computed paragraph/body font
   equality in the Node/Vite browser test.
6. Run focused tests, Overlay type/build checks, screenshot review,
   documentation health, and second diff review before committing only owned
   files and synchronizing legacy remote.

## Progress

- [x] Failure evidence, causal chain, and complete call-site inventory recorded.
- [x] Shared scheduler/Subagent disclosure implemented with regressions.
- [x] Focused and visual verification complete.
- [x] Second review complete.
- [ ] Commit and legacy remote synchronization complete.

## Verification

- Focused shared-disclosure, Subagent projection, exact-session service, and
  interactive-artifact tests pass: 13 tests with 188 expectations.
- The complete Overlay TypeScript check passes.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/subagent-progress-dock-browser.test.ts
  packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts`
  completes the production Vite build. The Subagent browser test passes; the
  chronology fixture reaches rendering but its existing error collector rejects
  two unrelated empty-path `/file?...&path=` 404 responses.
- The Subagent browser asserts the default collapsed row has the shared branch
  icon, `Delegated context` label, right chevron, and collapsed ARIA state. It
  then expands the row and asserts a rendered `h2` named
  `Delegated instruction`, strong emphasis for `current diff`, no raw `##`
  marker, and a 14-pixel paragraph equal to the application body font.
- Personal visual review of
  `.scratch/subagent-delegated-context-collapsed.png` confirms the requested
  scheduler-card hierarchy is reproduced by the shared component. Review of
  `.scratch/subagent-delegated-context-expanded.png` confirms the canonical
  Markdown body, normal typography, accent rail, activity, and TODO regions are
  readable without overlap.
- `git diff --check` passes. Second review confirms the canonical
  `inputPreview`, `StaticTextPart`, and `DelegatedContextDisclosure` remain the
  only data, Markdown, and interaction sources; no fallback/plain-text branch
  or duplicate disclosure DOM was added.
