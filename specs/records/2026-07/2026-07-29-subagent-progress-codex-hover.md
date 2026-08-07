# Sub-agent Progress Codex Hover

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | The supplied compact `universal-build` Sub-agent screenshot shows an oversized, heavily framed TODO footer. Make its size and border match Codex and reveal the complete current TODO on hover, with careful styling. |
| Acceptance | The compact Sub-agent footer has no nested panel border or count capsule, keeps a restrained single-line summary and thin progress track, preserves the stable 188-pixel card boundary, and exposes the exact untruncated current TODO through the canonical hover/focus Tooltip. A real desktop page and goal-bound screenshots must be interacted with and visually reviewed. |
| Hard constraints | Preserve `TodoStore`/`AgentActivityRecord.todos` as the data authority, `TodoProgress` as the only progress primitive, Kobalte Progress accessibility, exact child-Session navigation, the fixed card thumbnail, and the existing shared Tooltip primitive. Do not add a native `title`, second popup, fallback renderer, state machine, mobile/tablet scope, temporary iframe, local signal override, or UI automation test. Do not add, modify, update, or run UI tests; UI acceptance is real-page interaction plus manually inspected screenshots. Playwright, if needed for page control, must run through Node rather than Bun. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-25-subagent-todo-progress-footer.md`; `2026-07-28-subagent-thumbnail-height-boundary.md`; `2026-07-29-ui-automated-test-prohibition.md`; `SubagentProgressGrid.tsx`; `TodoProgress.tsx`; shared `Tooltip.tsx` and `tooltip.css`; sub-agent and shared progress rules in `conversation.css` and `card.css`; the supplied original-resolution screenshot. |
| Whole-repository grep | `SubagentProgressGrid.tsx` is the only `variant="subagent"` caller and the only `.subagent-progress-card__footer` renderer. `CardTodoSummary.tsx` owns the `card` caller; `TodoListPart.tsx` owns the summary-free `detail` caller. `TodoProgress.tsx` is the only markup owner for `.todo-progress__current`, count, and track. `conversation.css` is the only sub-agent footer/variant geometry owner; `card.css` owns the shared progress base. `Tooltip.tsx` plus `tooltip.css` are the one Kobalte tooltip primitive and chrome source. Existing UI test files mention these selectors but are prohibited from modification or execution by the current project rule. |
| Independent Agent feedback | None. The user did not request sub-agents, delegation, or parallel review, so this task remains single-Agent. |

## Causal chain

1. Observable symptom: the footer reads as a second inset card, consumes a
   disproportionate part of the fixed thumbnail, and truncates the active TODO
   with no complete-text interaction.
2. Direct trigger: `.subagent-progress-card__footer` adds padding, border,
   radius, and tinted background; `.todo-progress__count` adds a second tinted
   pill; the track is six logical pixels high.
3. Structural cause: the sub-agent variant styles the same progress fact as
   nested containers instead of a low-hierarchy compact status row, while
   `TodoProgress.tsx` emits the current text as a plain clipped `span`.
4. Why the previous path did not root-correct it: the original TODO footer
   work prioritized fixed-bottom placement and canonical live data. The later
   thumbnail repair bounded the card and scroll owner but intentionally
   preserved the footer chrome, leaving its visual density and missing
   full-text interaction unchanged.

## Single-source implementation

| Owner / call site | Disposition |
| --- | --- |
| `packages/overlay/src/components/TodoProgress.tsx` | Keep one Kobalte Progress root. For only the `subagent` variant with a current TODO, wrap the existing current-text span in the canonical Kobalte Tooltip trigger and render the exact full string in shared Tooltip content. Preserve `card` and `detail` behavior. |
| `packages/overlay/src/components/SubagentProgressGrid.tsx` | Keep the existing footer mount, canonical summary, terminal semantics, and exact Session activation unchanged. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Remove the nested footer panel chrome and count capsule; use compact spacing, neutral count typography, and a thinner token-scaled track while retaining the stage accent only for the fill. Add only internal layout styling needed by the tooltip trigger. |
| `packages/overlay/src/styles/surfaces/card.css` | Keep shared card/detail progress geometry unchanged. |
| `packages/overlay/src/components/ui/Tooltip.tsx` and `styles/primitives/tooltip.css` | Reuse unchanged as the single accessible hover/focus interaction and popup chrome source. |
| Existing Overlay UI tests and browser fixtures | Do not modify or run. They are historical UI automation and are outside the permitted acceptance path. |
| Architecture and indexes | Clarify that the fixed TODO footer uses the shared Tooltip for complete current-TODO disclosure and index this record. |

## Verification plan

1. Run formatting/diff checks, Overlay TypeScript checking, and the permitted
   document-link/health checks; do not run any UI automation test.
2. Start or connect to the real Overlay page without altering its data source.
3. Interact with a Sub-agent card containing a genuinely long current TODO,
   inspect the resting footer, hover/focus the clipped label, and capture
   goal-bound screenshots of both states.
4. Review the screenshots at original resolution for card-height stability,
   removal of the nested border/capsule, text/count alignment, track weight,
   tooltip wrapping and placement, and absence of clipping or transcript
   occlusion. Iterate until visually correct.
5. Re-read the complete diff and verification evidence, fetch the tracked
   git-cc branch, then commit and push through the normal hooks with the
   required `dsw-33987` subject prefix.

## Result

Implemented:

- only the compact `subagent` variant wraps the canonical current TODO in the
  shared Kobalte Tooltip; pointer hover and keyboard focus both expose the
  exact full string while `card` and `detail` variants remain unchanged;
- the footer no longer paints a second bordered/tinted panel or count capsule;
  it uses one compact summary row, neutral count typography, five logical
  pixels of vertical rhythm, and a three-logical-pixel progress track;
- the fixed 188-pixel card boundary, stage-colored fill, persisted TODO
  authority, progressbar value label, terminal semantics, and exact Session
  navigation remain unchanged.

Verified:

- `bun run --cwd packages/overlay typecheck` passed;
- `bun run --cwd packages/overlay build:vite` produced the current production
  bundle;
- formatting and task-file diff checks passed before the native launch;
- no UI test source was added, modified, updated, or executed.

Visual acceptance is not complete. The current source Overlay was launched as
a real maximized Tauri window and captured at `2880 × 1620`, but the formal
database rejects Work Ledger hydrate with
`DatabaseSchemaResetRequiredError: unexpected table automation`. The native
window therefore exposes only `No work yet` and cannot reach a genuine
Sub-agent TODO card. The in-app browser also rejected navigation from the Vite
origin to the real backend `/ui` origin under its local URL security policy.
Project rules require database reset rather than migration, but resetting the
user's database is destructive and was not authorized by this UI request. No
fixture, iframe, query override, local signal, direct database edit, or
handwritten interaction was used to manufacture a passing screenshot.
