# Composer Inline At-sign Normal-input Dismissal

Date: 2026-08-03

Status: implemented and visually verified

## Recall

| Item                       | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User requirement           | When ordinary text is entered after `@`, the reference popup must disappear instead of remaining as an empty “no matching references” panel. The supplied screenshot shows `初始化对话框中输入@时` with the popup still open.                                                                                                                                                                                                                                                                                                                                                                          |
| Acceptance criteria        | An at-sign embedded after a Unicode letter or number is ordinary text and never owns the reference popup; a token-boundary `@` still opens the complete reference catalog; direct ASCII identifier search such as `@gri` still filters the catalog; ordinary Chinese continuation such as `@时` ends the untyped cross-catalog query; an explicitly typed category such as `@skill 时` may still query Unicode entity labels; the real Overlay page is interacted with and fresh desktop screenshots are manually inspected; no User Interface (UI) automated test is added, changed, updated, or run. |
| Hard constraints           | Preserve the native textarea and `composer-mention.ts` as the single text/query source. Do not add a component-only close flag, fallback, keyword gate, second parser, hidden message, or state machine. Preserve concurrent work. Use Node.js, not Bun, for browser interaction. Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process. Commit subjects use the `dsw-33987` prefix and the completed branch is pushed to `myhexin`.                                                                                                               |
| Existing architecture read | `specs/records/2026-07/2026-07-30-composer-mention-pill-atomic-editing.md`; `specs/records/2026-07/2026-07-30-composer-reference-selector-and-model-search.md`; `specs/records/2026-08/2026-08-02-composer-expert-squad-keyboard-and-live-authoring.md`; `packages/overlay/src/components/ChatComposer.tsx`; `packages/overlay/src/components/ComposerMentionMenu.tsx`; `packages/overlay/src/services/composer-mention.ts`.                                                                                                                                                                           |
| Whole-repository grep      | `findComposerMentionQuery` and `composerMentionOptions` each have one implementation in `composer-mention.ts` and one production caller in `ChatComposer.tsx`. `mentionMenuOpen` has one owner in `ChatComposer.tsx`. `ComposerMentionMenu` is rendered only by that owner. The active non-UI test inventory currently has no focused Composer mention contract. The touched production surface contains no directly named Composer mention UI test or fixture.                                                                                                                                        |
| Independent agent feedback | Claude Code 2.1.147 was invoked read-only with `Read,Grep,Glob`, but local authentication failed with `Not logged in`; its result had `is_error: true` and is not accepted as review evidence. A bounded read-only child Session then reached terminal success without changing the workspace; its result exposed no textual finding to incorporate. The parent therefore retained responsibility for the source review and all verification.                                                                                                                                                          |

## Causal chain

1. `ChatComposer` correctly derives popup visibility from the one active mention query.
2. `findComposerMentionQuery` decides whether that query exists.
3. `mentionBoundaryAllows` excludes only ASCII letters, digits, and underscore, so an at-sign immediately following Chinese text is incorrectly treated as a token-boundary mention trigger.
4. The direct cross-catalog fragment accepts every Unicode letter and number, so ordinary continuation such as `@时` remains a valid query even though the direct mention syntax and canonical entity identifiers use ASCII syntax.
5. The ranker finds no option and `ComposerMentionMenu` faithfully renders its empty panel. The empty panel is therefore an observable consequence, not the root owner.

## Design

Keep `findComposerMentionQuery` as the only query parser. Make its boundary
Unicode-aware so a preceding letter, number, or underscore makes `@` ordinary
inline text. Keep the direct cross-catalog search contract for ASCII identifier
characters (`A-Z`, `a-z`, digits, dot, underscore, and hyphen), including
`@gri`. Preserve Unicode entity search only after the user has explicitly
selected a category with syntax such as `@skill `, where intent is no longer
ambiguous.

This changes query recognition rather than adding popup-local dismissal state,
so keyboard handling, accessibility projection, option ranking, and rendering
continue to consume one source.

## Implementation inventory

| Surface                                                   | Decision                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/services/composer-mention.ts`       | Make the mention boundary Unicode-aware and limit untyped direct query fragments to ASCII identifier characters while preserving explicit-category Unicode entity queries.                                                                                   |
| `packages/overlay/test/composer-mention.test.ts`          | Add only positive pure-service coverage proving the preserved valid direct ASCII search and explicit-category Unicode search contracts. Ordinary-text dismissal remains UI acceptance and is not encoded as a prohibited negative or UI automated assertion. |
| `packages/overlay/src/components/ChatComposer.tsx`        | Keep unchanged; it already derives popup visibility from the parser result.                                                                                                                                                                                  |
| `packages/overlay/src/components/ComposerMentionMenu.tsx` | Keep unchanged; the empty state remains valid for explicit searches that happen to have no catalog match.                                                                                                                                                    |
| UI tests and fixtures                                     | Do not add, modify, update, or run any UI automated test. Delete only directly encountered prohibited UI assets in the exact touched search surface, if any appear during implementation.                                                                    |

## Verification plan

1. Run Overlay TypeScript typecheck, internationalization integrity, production Vite build, documentation health, and `git diff --check`.
2. Start an isolated real Overlay page without touching the user's running OpenCorvus/Overlay process.
3. Use Node-launched browser tooling to verify by direct interaction that `初始化对话框中输入@时` has no popup, token-boundary `@` opens it, and `@gri` retains direct filtering.
4. Capture and manually inspect fresh desktop screenshots of the ordinary-text result and retained valid mention search.
5. Perform a second source/diff review, commit task-owned paths, fetch and integrate the current git-cc branch if needed, push to `myhexin`, and verify remote convergence.

## Progress

- [x] Inspect the supplied screenshot and establish the observable symptom.
- [x] Complete whole-repository owner/caller and touched-test search.
- [x] Record the Recall, causal chain, implementation inventory, and verification plan.
- [x] Attempt the required independent Claude Code review and record the external authentication blocker; complete a bounded read-only child review session.
- [x] Implement the single-parser repair and positive preserved-contract coverage.
- [x] Complete static and real-page visual verification.
- [ ] Complete second review, commit, push, and remote convergence.

## Verification evidence

- The focused positive mention-service contract passed 2/2. It proves direct
  ASCII identifier search at a token boundary and Unicode entity search after
  an explicit category remain available.
- Overlay TypeScript typecheck, internationalization integrity, production Vite
  build, historical-document links, and `git diff --check` passed. The build
  retained only existing third-party `"use client"` and large-chunk notices.
- No UI automated test was added, modified, updated, or run. The new focused
  test imports only the pure `composer-mention.ts` service.
- A headed Chrome instance launched by Node interacted with the real Overlay
  served by an isolated OpenCorvus backend and temporary `OPENCORVUS_HOME`.
  Neither the user's running OpenCorvus/Overlay process nor its data was
  restarted, refreshed, or modified.
- After isolated startup settled, keyboard text insertion produced the exact
  immediate and two-second delayed value `初始化对话框中输入@时`; the live page
  reported zero Composer mention menus. The manually inspected screenshot is
  `specs/artifacts/2026-08-03-composer-inline-at-normal-input-dismissal.png`.
- A token-boundary `@` reported one mention menu. Continuing to `@gri` kept the
  menu open and visibly filtered the real catalog to `grill-me` plus the Base
  Expert Squad description match. The manually inspected screenshot is
  `specs/artifacts/2026-08-03-composer-direct-mention-search.png`.
- The isolated backend, headed browser, and temporary data root were closed and
  removed by their owning Node process. Port 41738 had no listening process
  afterward.
