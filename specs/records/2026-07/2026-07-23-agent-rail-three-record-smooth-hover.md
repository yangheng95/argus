# Agent Rail Three-Record Visibility and Codex Hover Motion

## Recall

### User requirement

- The left-edge conversation navigation marks must not appear on an empty/new conversation.
- Render the Agent Rail only when at least three real projected conversation activity records exist.
- When several marks are present, moving the pointer between them must feel as smooth as the Codex implementation.

### Acceptance criteria

- Zero, one, and two records leave `#solidConversationAgentRailMount` empty; three or more records render the existing canonical rail.
- The rail continues to read only `conversationAgentRecordsForSource(boardStore.selectedSource)` and keeps its existing Kobalte Tooltip, shared Button, status colors, adjacent-agent grouping, keyboard focus, and click-to-card locate behavior.
- Pointer movement between neighboring rows never clears the active proximity profile between row transitions; the profile resets only after the pointer leaves the whole rail.
- Marker animation uses the Codex pattern: one fixed marker width animated with `scaleX`, a 160-millisecond spring-like linear easing, and symmetric `0.7 / 0.4 / 0.2` progress across three neighboring records.
- Reduced-motion users receive no marker transition.
- Real Node-launched browser verification covers fewer-than-three hidden, three visible, multi-record pointer traversal, the full proximity envelope, reset, tooltip, focus, locate, and task-scoped screenshots.

### Hard constraints

- Desktop-only; no tablet/mobile/responsive scope.
- Do not add a second rail, alternate record source, compatibility selector, hidden message, placeholder record, fallback, feature flag, iframe, or hand-built UI primitive.
- Preserve the sole `App.tsx` mount and workspace-edge overlay geometry.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay; use the existing isolated Node browser fixture.
- Playwright must run through Node, never Bun.
- Preserve all unrelated shared-worktree changes and selectively stage only this task.
- Commit subjects use the `dsw-33987` prefix and push through the normal legacy remote hook to `legacy-remote`.

### Sources read before implementation

- Root `AGENTS.md`
- Browser control skill
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-17-agent-rail-first-activity-visibility.md`
- `specs/records/2026-07/2026-07-19-codex-agent-rail-gutter-density.md`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/test/conversation-agent-rail.test.ts`
- `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts`
- Git history and blame for the rail component, styles, and tests
- The installed Codex `26.715.8383.0` production assets
  `thread-user-message-navigation-rail-BR4lwTSb.js` and
  `thread-user-message-navigation-rail-CZzXjFhl.css`

### Whole-repository grep

- `App.tsx` owns the only `<ConversationAgentRail />` mount.
- `ConversationAgentRail.tsx` is the only record-to-mark renderer and reads the
  canonical selected-source projection. It currently renders for
  `records().length > 0`, stores one active session, maps only distances
  `0 / 1 / 2`, and clears that session from each row's `pointerleave`.
- `conversation.css` is the only marker-motion owner. It changes physical
  `width` through the `8 / 12 / 16 / 20px` ladder and has no reduced-motion
  override for this transition.
- `conversation-agent-rail.test.ts` is the direct source/CSS contract and
  explicitly requires first-record visibility and row-level deactivation.
- `conversation-agent-rail-scroll-browser.test.ts` is the full real-browser
  geometry, large-history, tooltip, locate, and screenshot owner; its initial
  fixture explicitly requires one-record visibility and its hover check covers
  only two neighbors.
- `conversation-agent-rail-hover-context-browser.test.ts` independently checks
  tooltip bounds, status-independent widths, pointer focus, and proximity data.
- Other rail occurrences consume mount presence, projection identity,
  streaming, i18n, accessibility, tooltip ownership, or global-pressure
  behavior and do not own the minimum count or marker-motion algorithm.
- No sub-agent feedback exists because the user did not request delegation and
  the active collaboration policy forbids unrequested sub-agents.

### Baseline evidence

- The focused rail source contract passes before modification.
- The broader focused baseline currently has three unrelated shared-worktree
  failures: missing in-progress i18n keys, pre-existing duplicate selectors in
  `composer.css`, and an in-progress connection-badge selector ownership
  mismatch. They do not touch the rail component, its marker CSS, or its
  browser fixture and must not be hidden or folded into this repair.
- A pre-change push was attempted through the normal legacy remote hook. The hook
  correctly blocked on an unrelated generated OpenAPI difference from existing
  Mission/panel changes; no hook was bypassed.

## Causal chain

1. **Observable:** one short mark appears on the empty/new-conversation surface,
   and a populated stack changes widths with a perceptible hiccup while the
   pointer crosses rows.
2. **Direct triggers:** the renderer treats the first record as visible; each
   row clears `activeSessionID` on `pointerleave` before the next row activates;
   each marker animates layout-affecting `width`.
3. **Deep cause:** the July 17 first-record contract intentionally removed the
   old threshold, while the interaction retained discrete row ownership and a
   two-neighbor width ladder. That is now superseded by the user's explicit
   three-record presentation rule and Codex-motion requirement.
4. **Codex evidence:** the installed Codex rail itself hides below four items,
   but that product threshold does not override the user's requested three. Its
   motion uses a fixed-width marker with `scaleX`, a 160-millisecond spring-like
   easing, three neighbor progress levels (`0.7 / 0.4 / 0.2`), and zero-duration
   reduced/scrubbing motion.
5. **Root repair:** express the requested minimum as the renderer's one named
   count contract, keep active pointer ownership until the whole rail is left,
   and project one transform-based Codex motion profile from the existing flat
   record order.

## Call-site disposition

| Call site | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Keep unchanged as the sole mount owner. |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Add the named three-record minimum, retain the pointer target across adjacent row transitions, separate pointer/focus inputs, and extend flat-record proximity to distance three. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Replace width animation with the fixed-width `scaleX` Codex motion profile, preserve centered geometry/status colors, and add reduced-motion handling. |
| `packages/overlay/test/conversation-agent-rail.test.ts` | Replace the superseded first-record and two-neighbor/source assertions with exact three-record and Codex-transform contracts. |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Prove sub-threshold hidden and three-record visible states, pointer traversal continuity, the seven-record transform envelope, reset, and screenshots while retaining all existing large-history/locate checks. |
| `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` | Extend the independent proximity check to the third neighbor if the fixture exposes it; otherwise preserve its tooltip/status/focus contract. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Index this single task record without altering concurrent entries. |
| Other Agent Rail consumers | Keep unchanged; they do not own visibility count or marker motion. |

## Implementation plan

1. Update direct source/CSS/browser expectations so the current first-record
   visibility and physical-width motion fail the requested contract.
2. Implement the named three-record minimum and rail-owned pointer/focus
   interaction without changing record, mount, tooltip, grouping, or locate
   ownership.
3. Port the Codex fixed-width transform, progress envelope, easing, and
   reduced-motion contract into the canonical marker CSS.
4. Run focused source tests, Overlay typecheck/i18n/build, the real Node browser
   rail fixtures, document health, and `git diff --check`.
5. Inspect fresh task-scoped rest, hover, and pointer-traversal screenshots at
   original resolution; iterate until the motion and layout pass visual review.
6. Re-read the scoped diff and browser evidence, selectively stage only this
   task's hunks/files, commit with `dsw-33987`, push through the normal legacy remote
   hook, and report any unrelated hook blocker honestly.

## Validation targets

```sh
bun test packages/overlay/test/conversation-agent-rail.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Implementation result

- `ConversationAgentRail` now renders only when its canonical selected-source
  projection contains at least three records. No placeholder records, alternate
  count, or second mount were introduced.
- Pointer and keyboard focus remain independent inputs. Pointer ownership is
  cleared by the whole rail rather than by each row, so crossing a real gap
  between adjacent identity stacks retains the previous proximity envelope
  until the next row activates.
- The marker keeps one 20-pixel layout width and animates only `scaleX`. The
  active record and three neighbors on either side use the Codex-derived
  `1 / .7 / .4 / .2` progress profile, 160-millisecond production easing, and
  an explicit zero-duration reduced-motion override.
- The existing selected-source record projection, adjacent identity stacks,
  Kobalte tooltip, shared Button primitive, focus path, status colors, and
  click-to-card locate path remain the single owners of their respective
  behavior.

## Verification evidence

### Passing checks

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
  - Passed alone through Node after a parallel browser-runner attempt exposed a
    Windows sidecar-close race between two independent fixtures.
  - Proved two records hidden, three records visible, the computed seven-marker
    `10.4 / 12.8 / 16.4 / 20 / 16.4 / 12.8 / 10.4` envelope, inter-stack gap
    continuity, reset, tooltip, keyboard focus, locate, and large-history
    behavior.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts`
  - Passed the bounded input/output preview, focus, tooltip placement, and
    status-independent marker contract.
- `git diff --check`

### Shared-worktree blockers kept visible

- The focused rail source suite has 48 passing tests and one failure on the
  concurrently added `oc-section-heading` class in the tooltip header. Every
  new threshold, transform, proximity, and pointer-ownership assertion passes;
  the failing exact-string assertion and class change belong to the independent
  typography task and are not folded into this repair.
- `check:i18n` is blocked by three unused mention/composer keys from another
  in-progress Overlay task.
- The pre-commit document-health run was blocked because this record and a
  second concurrent record were linked from the July index while still
  untracked. This task commit tracks its own record; the concurrent record/link
  remains outside this repair. The remaining document-health and
  historical-link tests pass.
- The pre-change legacy remote push hook is blocked by generated OpenAPI drift from
  concurrent Mission/panel changes. No hook or checker was bypassed.

## Visual review and second review

- `sub-threshold-hidden-rail.png`: the two-record fixture leaves the left
  workspace edge empty.
- `three-activity-left-rail.png`: exactly three centered short marks appear
  without shifting the conversation layout.
- `cursor-following-expanded-lines.png`: the active mark expands with a
  symmetric three-neighbor wave while the tooltip stays beside the mark.
- `pointer-gap-continuity.png`: the same wave remains expanded in a real
  inter-stack pointer gap, proving the previous row no longer clears the
  interaction prematurely.
- `left-rail.png`: the long-history crop keeps the established compact gutter
  density.
- `bounded-input-output-preview.png`: the independent tooltip fixture remains
  bounded, readable, and aligned with the active mark.
- Scoped diff review found one visibility source, one marker-motion owner, no
  fallback, no host-side flow gate, no state machine, and no change to locate or
  activity-projection semantics. The root cause is addressed at renderer and
  interaction ownership rather than hidden by timing delays.
