# Composer Mention Pill and Atomic Editing

## Recall

### User requirement

- Render `@skill`, `@mission`, `@squad`, and the complete selected exact reference as one visible pill in the Composer.
- Backspace/Delete must remove the complete reference entity rather than individual characters.
- Selecting a reference must append one space after the exact directive.

### Acceptance criteria

- Every parsed exact visible directive such as `@skill("grill-me")` is presented as one continuous pill while the canonical submitted text stays unchanged.
- The native textarea remains the only editable value, caret, selection, Input Method Editor (IME), draft, and submission source.
- Backspace/Delete at or inside an exact directive uses the existing atomic edit owner and removes the full directive.
- The automatically inserted trailing space belongs to the reference edit boundary, so one immediate Backspace removes the pill and that space together.
- Reference selection produces `@kind("exact-id") ` at the end of the draft, or reuses an already-present whitespace boundary before following text.
- A real isolated page shows the complete pill, preserves ordinary surrounding text, and demonstrates whole-entity deletion and post-selection spacing.
- No User Interface (UI) automated test is added, changed, updated, or run.

### Hard constraints

- Preserve all concurrent work and stage only task-owned paths.
- Do not restart, refresh, close, or otherwise interact with the user's running OpenCorvus/Overlay process.
- Reuse the existing textarea, shared exact directive parser, and atomic edit functions; do not add a second editable source, parser, hidden message, fallback, compatibility path, route gate, or state machine.
- Visual acceptance uses a real page and inspected screenshots; Playwright is started by Node.js, never Bun.
- Commit subjects begin with `dsw-33987` and the completed current branch is pushed to `legacy-remote`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-27-chat-explicit-skill-mention.md`
- `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md`
- `specs/records/2026-07/2026-07-29-composer-mention-keyboard-scroll.md`
- `packages/transport-protocol/src/index.ts`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ComposerMentionMenu.tsx`
- `packages/overlay/src/components/ui/AutoGrowTextarea.tsx`
- `packages/overlay/src/components/ui/TextField.tsx`
- `packages/overlay/src/services/composer-mention.ts`
- `packages/overlay/src/styles/primitives/text-field.css`
- `packages/overlay/src/styles/surfaces/composer.css`

### Whole-repository search result

Searches covered `applyComposerMentionOption`, `composerMentionDirectiveRanges`,
`composerMentionAtomicCaret`, `composerMentionAtomicNavigation`,
`composerMentionAtomicSelection`, `composerMentionAtomicEdit`,
`AutoGrowTextarea`, `chat-textarea-wrap`, and every production
`HTMLTextAreaElement` caller.

| Owner / call site | Finding | Disposition |
| --- | --- | --- |
| `transport-protocol/src/index.ts` | `visibleMentionDirectiveRanges` is the shared exact parser and returns canonical directive offsets. | Keep as the only parser and derive presentation segments from its ranges. |
| `overlay/src/services/composer-mention.ts` | One service owns insertion, exact ranges, caret snapping, navigation, selection expansion, and atomic deletion. End-of-draft insertion currently omits the requested trailing space. | Preserve all atomic owners; change insertion to add one space whenever the following text does not already begin with whitespace. |
| `overlay/src/components/ChatComposer.tsx` | The native textarea is the sole text/draft/IME/submission source and every focus helper targets it. | Keep it authoritative and add an `aria-hidden` read-only presentation layer driven by the same text signal. |
| `overlay/src/components/ui/AutoGrowTextarea.tsx` and `TextField.tsx` | The shared primitive owns textarea value synchronization, auto-growth, and canonical geometry. | Reuse unchanged. The presentation layer mirrors the composer surface's existing padding, font, line height, wrapping, and scroll offset. |
| `overlay/src/styles/surfaces/composer.css` | The textarea wrap already provides the required positioned containing block. | Add only local presentation and pill recipes; retain all existing shell and input primitives. |
| `main.tsx`, `workspace.ts`, `Conversation.tsx`, `dom-utils.ts` | External callers focus, size, or inspect the real textarea. | Preserve unchanged because the textarea remains the native interaction surface. |
| Existing UI automated tests | Current policy prohibits adding, modifying, updating, or running UI assertions. | Leave them untouched and use isolated real-page interaction plus screenshots. |
| `overlay/test/composer-mention.test.ts` | This is a pure service contract, not a rendered UI assertion. Its existing expected end-of-draft insertion has no trailing space. | Update only the positive data-contract expectations and run this focused non-UI test. |

### Independent-agent feedback

- No sub-agent was requested or used.

### Git baseline

- Branch: `v0.0.25beta`.
- Starting commit: `18d3ba34dec798ce1ffd2a895671877e72400c75`.
- `HEAD` matched `legacy-remote/v0.0.25beta` before implementation.
- Existing unrelated edits to the spec indexes and Task-title record are preserved and excluded from this task's commit.

## Root cause

The visible symptom and the deletion behavior have different owners. The exact
directive parser and atomic edit service already treat a reference as one entity,
but a native textarea can only paint one undifferentiated text style, so the same
entity is still presented as ordinary characters. The insertion helper also adds
whitespace only when non-whitespace text follows the query; when selection occurs
at the end of the draft, it appends nothing.

The repair keeps one data source: the textarea continues to own editing while a
read-only layer paints the parser's exact ranges. Because both derive from the same
string and offsets, visual entity boundaries, submission text, caret snapping, and
atomic deletion cannot diverge.

## Implementation plan

1. Derive ordered plain-text and mention presentation segments from the shared exact ranges.
2. Render those segments behind the canonical textarea, mirror its scrolling, and style every complete directive as one pill.
3. Correct exact-reference insertion so it always leaves a whitespace boundary after the selected entity.
4. Run the focused pure service contract, typecheck/build, internationalization, document health, and `git diff --check`.
5. Use a real isolated page to select a mention, inspect the pill and appended space, delete the entity, and review screenshots.
6. Perform a second exact-diff review, commit only task-owned paths, push to `legacy-remote`, and verify remote convergence.

## Progress

- [x] Complete root-cause and whole-repository call-point investigation.
- [x] Record the implementation and acceptance plan before code changes.
- [x] Implement the single-source presentation and spacing repair.
- [x] Complete static and real-page visual verification.
- [x] Complete second exact-diff review.
- [x] Commit, push, and verify remote convergence.

## Verification evidence

- Focused pure mention-service contract: 16 passed, 0 failed.
- Overlay TypeScript typecheck passed.
- Overlay production Vite build passed.
- Overlay internationalization check passed.
- Historical document health: 22 passed, 0 failed.
- `git diff --check` passed.
- No UI automated test was added, changed, updated, or run.
- A real isolated Vite page connected to the existing OpenCorvus backend without
  restarting or refreshing the user's running Overlay. Selecting `grill-me`
  produced the exact textarea value `Try @skill("grill-me") `, placed the caret
  after the appended space, and rendered one `999px`-radius pill containing the
  complete directive.
- One immediate Backspace from that post-selection caret changed the value to
  `Try `, moved the caret to offset `4`, and left zero mention pills.
- The final inspected screenshot showed complete, separately bounded
  `@skill("grill-me")`, `@mission("mirror-prism-cluster")`, and
  `@squad("general")` pills on the canonical Composer line.
- Implementation commit `e945335a16` passed the complete pre-push hook and was
  pushed to `legacy-remote/v0.0.25beta`; the immediate remote convergence check
  matched that commit.

## Follow-up: letter filtering after `@`

### Recall

- The user requires letters typed directly after `@` to fuzzy-filter the full
  reference catalog, for example `@gri` finding `grill-me`.
- Exact `@skill`, `@mission`, and `@squad` type entry must remain available.
- Reuse the current ID, label, syntax, and description ranker; do not add a
  second search source or a host-side keyword route.
- Preserve the complete-pill presentation, atomic deletion, and trailing-space
  behavior delivered above.
- No UI automated test may be added, changed, updated, or run. Acceptance uses
  an isolated real page and inspected screenshot.

### Whole-repository search

The follow-up inventory covered every `findComposerMentionQuery` and
`composerMentionOptions` caller. `ChatComposer` is the only production caller;
the focused service contract is the only non-UI test caller. The repository
already uses `fuzzysort` in backend catalogs, but the Composer already owns a
small catalog ranker that covers exact, prefix, substring, and description
matches. Adding another dependency or ranking source would create unnecessary
dual ownership.

### Root cause

`rankedOptionScore` already ranks arbitrary entity letters across ID, label,
type syntax, and description. The query never reaches it because
`findComposerMentionQuery` returns `null` whenever the fragment is not a prefix
of `skill`, `mission`, or `squad`. The parser therefore closes the menu for
valid entity searches such as `@gri`.

### Follow-up plan

1. Treat a letter/number/dot/underscore/hyphen fragment after `@` as a
   cross-catalog query when it is not an exact type syntax.
2. Preserve exact type syntax and the existing `@type query` path.
3. Add positive pure-service coverage for direct entity-letter filtering and
   exact directive insertion.
4. Run the focused contract, typecheck/build, internationalization, document
   health, real-page interaction, screenshot review, and a second exact-diff
   review before commit and push.

### Follow-up verification

- Focused pure mention-service contract: 17 passed, 0 failed.
- Overlay TypeScript typecheck, production Vite build, and internationalization
  check passed.
- Historical document health: 22 passed, 0 failed.
- `git diff --check` passed.
- No UI automated test was added, changed, updated, or run.
- In a real isolated Vite page, typing `@gri` kept the reference menu open and
  reduced the real catalog to one selected `grill-me` Skill row.
- Pressing Enter produced the canonical value `@skill("grill-me") `, placed the
  caret at offset `19`, and rendered one complete `@skill("grill-me")` pill.
- The inspected screenshot confirmed the filtered one-row menu remained
  aligned, legible, and visually attached to the canonical Composer.

## Follow-up: native caret and visible text metric convergence

### Recall

- User requirement: the caret shown in the supplied Composer screenshot must
  stop landing inside the visible text after `@squad("opentest")`.
- Acceptance: the transparent native textarea and the read-only mention
  presentation must use identical inline font metrics, so the native caret at
  the canonical text offset is visually aligned with the same visible offset
  before, inside, and after a mention pill.
- Hard constraints: keep the textarea as the only editable value, caret,
  selection, Input Method Editor (IME), draft, and submission source; keep the
  existing shared mention parser and presentation layer; do not introduce a
  second editable surface, manual caret, layout gate, fallback, or
  compatibility path.
- User Interface (UI) acceptance must use a real page, direct interaction, an
  inspected screenshot, and computed geometry. No UI automated test may be
  added, modified, updated, or run.
- The current branch had no unique commits and was fast-forwarded to the latest
  `legacy-remote/v0.0.26beta` before this plan was written.

### Sources and whole-repository search

- Read `AGENTS.md`, `specs/current/architecture/07-panel.md`, this existing
  mention-pill record, `ChatComposer.tsx`, `AutoGrowTextarea.tsx`,
  `text-field.css`, and `composer.css`.
- Whole-repository searches covered `chat-mention-presentation`,
  `chat-mention-pill`, `composerMentionPresentationSegments`,
  `data-has-mention`, `chat-textarea`, and every current source/test reference
  to the Composer textarea.
- `ChatComposer.tsx` is the sole production owner of the transparent textarea
  plus visible mention-presentation pair.
- `composer-mention.ts` is the sole segment/parser owner and is unchanged
  because its text offsets are correct.
- `text-field.css` gives the native Composer textarea the body font weight.
- `composer.css` gives the presentation layer the same body font weight, then
  overrides only mention segments to medium weight. That override changes the
  inline advance width before all following visible text while the native
  textarea continues to calculate selection and caret geometry with body
  weight.
- `packages/overlay/test/chat-textarea-single-source.test.ts` directly asserts
  rendered CSS properties and is therefore a prohibited UI automated test
  discovered in the exact changed surface. Delete it without running it; it has
  no dedicated fixture, baseline, script, or configuration.
- `packages/overlay/test/composer-mention.test.ts` validates only the pure text
  parser/editing contract. It remains unchanged and need not run for this
  presentation-only correction.
- No independent Agent was requested or used.

### Root cause

The native textarea and the read-only presentation start with identical
padding, font size, body font weight, line height, and text. The presentation
then assigns medium font weight to each mention pill. Because the textarea is
transparent but still owns the browser's caret, its caret x-coordinate is
computed from body-weight glyph advances while following visible text is
painted after wider medium-weight mention glyphs. The displacement grows from
the first styled mention boundary; the screenshot captures the resulting
caret/text overlap. This is a metric divergence, not an incorrect canonical
caret offset or parser range.

### Plan

1. Remove the mention-only font-weight override so the native and visible
   layers retain one inline metric contract while pill color, background,
   boundary, radius, and atomic behavior remain unchanged.
2. Delete the directly discovered CSS-source UI automated test without running
   it.
3. Run Overlay typecheck, production build, internationalization check,
   document health, and `git diff --check`; do not run UI tests.
4. Start an isolated real Overlay page with Node-launched browser tooling,
   enter the supplied `@squad("opentest") 21423` shape, inspect computed
   typography and caret/text geometry, review the screenshot, and iterate if
   any displacement remains.
5. Perform a second exact-diff review, commit with the required `dsw-33987`
   prefix, merge the completed work into the current delivery branch, push
   `legacy-remote`, and verify remote convergence.

### Progress

- [x] Reproduce the causal geometry from the supplied screenshot and current
  source.
- [x] Complete whole-repository call-point and test-surface discovery.
- [x] Record Recall, root cause, and acceptance plan before implementation.
- [x] Converge visible and native inline metrics.
- [x] Complete static and real-page visual verification.
- [x] Complete second review, commit, merge, push, and remote verification.

### Verification evidence

- Removed only the mention-specific medium font weight. Pill color, background,
  inset boundary, radius, parser ranges, canonical textarea value, and atomic
  editing owners remain unchanged.
- Deleted the directly discovered
  `packages/overlay/test/chat-textarea-single-source.test.ts` UI source
  assertion without running it. No fixture, baseline, script, or configuration
  was dedicated to that file.
- Overlay TypeScript typecheck passed.
- Overlay production Vite build passed. The existing third-party
  `"use client"` and chunk-size notices remained non-failing build notices.
- Overlay internationalization check passed.
- Historical documentation link contract: 2 passed, 0 failed.
- No UI automated test was added, modified, updated, or run.
- Node-launched Vite rendered an isolated real Overlay page against the
  existing local backend. Entering `@squad("opentest") 21423` produced one
  complete pill, canonical value length `24`, and native collapsed selection
  `24..24`.
- Computed geometry on that real page showed the textarea, presentation, and
  pill all using `"Geist Variable", "Noto Sans SC Variable"`, `14px`,
  weight `400`, normal letter spacing, and `18.76px` line height. The textarea
  and presentation also shared the same `6px` left padding and exact
  `721.1697px × 56px` bounding box.
- The inspected current-goal Composer screenshot visibly places the caret
  immediately after the final `3`, retains the complete blue
  `@squad("opentest")` pill, and shows no text/caret overlap. The real page
  reported no console errors.
- Exact-diff review found only the single metric correction, the required
  retirement of the directly related UI source test, and this task record.
- Implementation commit `a4451ecce8` was integrated with the concurrent remote
  delivery update through `95b8f9f77a`, pushed first to
  `legacy-remote/work-v0.0.26beta-yr-0730`, fast-forwarded into the local
  `v0.0.26beta` delivery branch, and pushed to `legacy-remote/v0.0.26beta`.
- Both pushes passed the repository pre-push hook: complete workspace
  typecheck, API route inventory, generated API documentation check, Overlay
  internationalization check, and secret scan.
