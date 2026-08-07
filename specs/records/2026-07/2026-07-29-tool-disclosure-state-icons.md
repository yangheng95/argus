# Tool Disclosure State Icons

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Tool-call rows must show explicit expand and collapse icons at the clickable disclosure, using the supplied Codex screenshot as the visual reference. |
| Acceptance criteria | Every collapsed execution disclosure shows a right-pointing chevron; every expanded disclosure shows a downward chevron; Tool rows retain their semantic Tool icon, name, detail, active wave, one-line rhythm, and existing click/keyboard behavior; the main Conversation and exact child-Session surfaces inherit the same repair; a real desktop page is opened, clicked, screenshot, and personally reviewed in both states. |
| Hard constraints | Keep `CardParts` as the only execution-disclosure renderer, `conversation-ui.ts` as the only expansion-state owner, and the shared `Icon`/`Button` primitives as the only control and glyph sources. Do not add a second renderer, state source, fallback, compatibility branch, gate, handwritten icon, mobile/tablet scope, or UI automated test. Do not modify or run existing UI automated tests. Preserve unrelated dirty-worktree changes. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-4fe0e35d-2dbd-430f-9030-7187fc3e1e14.png` was inspected at original resolution. It shows Codex's restrained one-line Tool-call hierarchy and is the density/tone reference; the requested repair adds explicit disclosure-state affordance without replacing the existing Tool identity glyph. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/current/architecture/12-overlay-card-system.md`; the 2026-07-16 Codex Tool disclosure repair, 2026-07-28 Tool disclosure size parity, and 2026-07-29 Tool-call tone/rhythm records; `CardParts.tsx`; `messages.css`; the shared `Icon` registry; relevant screenshots in `.scratch`. |
| Whole-repository grep | Searches covered `ExecutionDisclosureRun`, `work-details-toggle`, `msg-transcript-disclosure__marker`, `msg-work-details`, `CardParts`, `collapseWorkDetails`, `executionDisclosureKey`, `conversationDisclosureExpanded`, `setConversationDisclosureExpanded`, and every chevron call site. `ExecutionDisclosureRun` is the sole production Tool-disclosure control. `ChatBubble` has three production `CardParts` projections and recursive `Card` has one; all four request the same collapsed-work-details path. `conversation-ui.ts` is the sole reactive expansion owner. `messages.css` already owns the shared marker geometry and Tool-row rhythm. |
| Independent review | Claude Code 2.1.147 was invoked in the repository with only `Read,Grep,Glob`, no session persistence, and no Agent/worktree tools. It returned `Not logged in · Please run /login`, so no independent conclusion was available. The primary review therefore relies on the repository history, current ownership graph, and visual evidence and records this external limitation explicitly. |
| Workspace preservation | The task began on `work-v0.0.24beta-yr-0729` at `baa2d9a703`, aligned with `legacy-remote/work-v0.0.24beta-yr-0729`. Existing modified Overlay, test, architecture, locale, and July-record files belong to concurrent work and must not be overwritten, reverted, or staged except for exact task-owned hunks in shared index files. |

## Evidence and root cause

The disclosure control already has the correct accessible `aria-expanded` value,
the canonical right/down chevron expression, and one persistent expansion state.
However, commit `144347fb5f` wrapped the marker in
`<Show when={!currentTool()}>` while adding the active Tool wave. Every real Tool
summary therefore replaces the disclosure affordance with only its semantic Tool
icon. Patch-only or otherwise unsummarized execution runs still show the
chevron, proving that icon primitives, CSS geometry, and state reactivity are
healthy.

The root repair is to render the existing disclosure marker unconditionally,
before the optional Tool identity icon. This restores state visibility at the
one clickable control while retaining the wrench, terminal, file, or other Tool
glyph as identity rather than overloading it as a disclosure indicator. No CSS,
data, grouping, route, persistence, or active-wave change is required.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `CardParts.tsx::ExecutionDisclosureRun` | Remove only the `!currentTool()` condition around the existing marker. Keep the current right/down icon expression, Button, `aria-expanded`, summary, click handler, Tool icon, Tool text, and body unchanged. |
| `ChatBubble.tsx` three `CardParts` projections | Keep unchanged. Agent narrative, fallback message runs, and ordinary message-body projection all inherit the single repaired disclosure. |
| `Card.tsx` recursive `CardParts` projection | Keep unchanged. Nested/exact Session conversation paths inherit the repair through the same renderer. |
| `conversation-ui.ts` and `message-part.ts` | Keep unchanged. Expansion state and stable execution disclosure identity already have one canonical owner. |
| `messages.css` | Keep unchanged. The marker and Tool icon already share the transcript-local standard icon size, while row tone and `1.5` rhythm are current canonical presentation. |
| Shared `Icon` and `Button` primitives | Reuse unchanged. `chevron` and `chevron-down` already map to the mature Lucide primitive set. |
| Existing UI tests/browser fixtures | Do not add, modify, update, or run them. Validate through a real isolated page, manual pointer interaction, screenshots, and personal visual inspection only. |

## Implementation and verification plan

1. Make the canonical marker unconditional in `ExecutionDisclosureRun`.
2. Run Overlay TypeScript typecheck, production build, internationalisation,
   document-health checks, and `git diff --check`; none of these assert rendered
   UI behavior.
3. Start an isolated real Overlay page with Node-managed tooling, open it in the
   in-app Browser, inspect a real Tool disclosure, click between collapsed and
   expanded states, and capture goal-scoped desktop screenshots without creating
   a test fixture, assertion script, or screenshot baseline.
4. Correct any visual alignment or density defect found in the screenshots,
   repeat both-state review, perform a second source/diff review, stage only
   task-owned paths/hunks, commit with the `dsw-33987` prefix, push `legacy-remote`,
   and verify local/remote convergence.

## Implementation result

- `ExecutionDisclosureRun` now renders the canonical
  `msg-transcript-disclosure__marker` for every execution summary instead of
  suppressing it when `describeCurrentToolPart()` returns a Tool identity.
- The existing `expanded()` projection still selects `chevron` while collapsed
  and `chevron-down` while expanded. The semantic Tool icon remains the next
  child, so disclosure state and Tool identity are both visible without sharing
  meaning.
- No stylesheet, theme token, grouping algorithm, Tool description, state
  owner, route, persistence record, compatibility selector, fallback, or
  automated UI test changed.

## Acceptance evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with digest
  `6aa073ad759b98c7`.
- `bun run --cwd packages/overlay build` passed after Vite transformed 7,055
  modules. Existing third-party `"use client"` and large-chunk advisories
  remained informational.
- An isolated real server was started at `http://127.0.0.1:7881` from a copied
  historical database snapshot; a separate Node-started Vite page at
  `http://127.0.0.1:5187` loaded the current source without restarting,
  refreshing, or stopping the user's existing desktop Overlay or port-5173
  development server.
- The real `静安寺商务晚餐决策页` Work conversation loaded its persisted
  `delegate_agent`, `websearch`, `webfetch`, `apply_patch`, `bash`,
  `browser_preview`, `memory`, and `publish_interactive_artifact` calls. No
  fabricated message, DOM injection, query override, local signal, iframe, or
  UI fixture was used.
- The same `websearch` disclosure was clicked open and closed. The collapsed
  Button reported `aria-expanded="false"` and rendered
  `lucide-chevron-right` followed by `lucide-wrench`; the expanded Button
  reported `aria-expanded="true"` and rendered `lucide-chevron-down` followed
  by the same wrench. Both states retained the canonical 21px row height.
- Read-only inspection of all eleven real Tool disclosures found exactly one
  marker and one Tool identity glyph per row. The single expanded row used the
  down chevron; all ten collapsed rows used the right chevron.
- `.scratch/tool-disclosure-state-icons-collapsed.png` and
  `.scratch/tool-disclosure-state-icons-expanded.png` were personally
  inspected. Both show a compact aligned two-glyph hierarchy, intact
  ellipsis, unchanged Tool tone, and no crowding or layout regression.
- The isolated port-5187 Vite process and port-7881 server were stopped after
  review; port 5173 remained owned by the pre-existing user process.
- No UI automated test was added, modified, updated, or run.
- The historical link and product/document-health suites completed their
  unrelated checks, but the monthly tracked-target check still lists four
  concurrent July records that the shared working-tree README links while
  those files remain untracked:
  `2026-07-29-composer-shadow-parity.md`,
  `2026-07-29-conversation-dock-surface-convergence.md`,
  `2026-07-29-composer-model-selection-and-multica-import.md`, and
  `2026-07-29-composer-conversation-context-flags.md`. This task does not stage
  or commit those foreign records.
- The focused historical-link rerun passed 21 of 22 checks. Its remaining
  `legacy spec paths are not referenced as live repository paths` check hit
  the suite's existing 5-second timeout at 5.688 seconds; it did not report a
  broken-link assertion.

## Second review

- A second whole-repository search confirms `ExecutionDisclosureRun` remains
  the only production `work-details-toggle` owner; `ChatBubble` and recursive
  `Card` remain consumers rather than alternate disclosure implementations.
- The final product diff removes only the erroneous conditional wrapper. The
  marker's shared CSS already aligns its standard icon size with the Tool glyph,
  so adding another presentation rule would create a second source without
  solving a defect.
- The restored marker uses the same reactive `expanded()` value already
  projected into `aria-expanded` and the body `Show`, preventing icon,
  accessibility, and content visibility from drifting.
