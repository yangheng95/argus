# Long Tool Title Timing Contraction Repair

Date: 2026-08-04
Status: Delivered

CSS means Cascading Style Sheets. UI means User Interface.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Repair the Tool row shown in the supplied screenshots: when hover or keyboard focus reveals the persisted start time and duration, a long package Tool name must contract with an ellipsis instead of painting through the timing projection. |
| Acceptance criteria | Short and long Tool names remain on one line; start time and duration remain complete; available-width reduction makes the Tool title/detail ellipsize without overlap in collapsed and expanded execution disclosures; the real current-source desktop page is operated, captured, and personally reviewed. |
| Hard constraints | Preserve the shared `CardHeader`/`CardHeaderChrome` timing projection and canonical Tool name. Change the single shared CSS owner; do not add a package-Tool selector, hard-coded name/character limit, fallback, alternate renderer, hidden timing, wrapping, gate, or UI automated test. Do not run UI automated tests. Preserve the unrelated dirty `packages/opencorvus/src/skill/builtin-payload.ts`. |
| Supplied evidence | `codex-clipboard-7243e4a9-c04e-4829-aa04-fb68bc3d5ea4.png` shows `pkg_tool__prism_shared_publish_competitor_research` painting through the trailing time. `codex-clipboard-ea74c4f4-0818-4626-ae8a-ed69ddc58c26.png` shows the intended behavior: a short `bash` title stays visible while its long detail contracts before `11:18:43 AM 0s`. |
| Sources read | Root `AGENTS.md`; Browser control and OpenCorvus debug-evidence skills; current card architecture; August 4 Conversation Tool-disclosure repair; July 15 Tool-call single-line authority record; current `CardHeader.tsx`, `CardHeaderChrome.tsx`, `tool-card-node.ts`, `card.css`, and `messages.css`; introducing commit and line history; MDN flex-shrink documentation. |
| Whole-repository grep | `toolToCardNode` maps the canonical Tool name to `CardNode.title`. `CardHeader` places title and subtitle inside the shrinkable header button; `CardDurationChip` appends start and duration as non-shrinking siblings. The Tool title alone declares `flex: 0 0 auto` and `max-width: none`, while the subtitle is shrinkable. The execution-summary Tool name already has a bounded maximum and is not the overlapping row. |
| Independent feedback | None. The user did not request sub-agents, so the primary Agent owns implementation and second review. |
| Git baseline | After fetching and fast-forwarding, local `v0.0.30beta` and `myhexin/v0.0.30beta` resolve to `83b7ca2e78`. The only pre-existing dirty path is `packages/opencorvus/src/skill/builtin-payload.ts`, which remains outside this task. |

## Causal Chain

1. The Tool name is canonical data and correctly becomes `CardNode.title`.
2. The shared header is a flex row whose main Button can contract when hover or
   focus reveals the non-shrinking start time and duration.
3. Inside that Button, Tool subtitles declare `flex-shrink: 1`, but Tool titles
   declare `flex: 0 0 auto` and no maximum width.
4. A short name such as `bash` fits, so only its long subtitle contracts. A long
   package Tool name consumes its intrinsic width and cannot yield space.
5. The timing projection remains correct; the obsolete short-name layout
   assumption makes the canonical title paint into it.

## Implementation And Verification Plan

1. Commit and push this Recall before changing product code.
2. Change the shared Tool-title flex contract from non-shrinking to shrinkable,
   retaining `nowrap`, hidden overflow, and ellipsis; document that Tool title
   and detail yield to the canonical timing projection.
3. Run Overlay typecheck, localization validation, production Vite build,
   documentation health checks, and `git diff --check`; do not run UI tests.
4. Open the current-source real desktop page through Browser, exercise hover
   and keyboard focus on short and long Tool headers in collapsed and expanded
   disclosures, capture the affected region, and personally review it.
5. Re-read the exact diff and visual evidence, update this record, commit only
   task-owned paths with the `dsw-33987` prefix, reconcile the remote, and push
   `v0.0.30beta` to `myhexin`.

## Progress

- [x] Reconstruct the two screenshot layouts and identify the single owning CSS rule.
- [x] Commit and push the pre-change Recall.
- [x] Implement and statically verify the shared contraction repair.
- [x] Complete real-page visual acceptance and second review.
- [x] Commit and push the final delivery.

## Visual Verification

The current-source Vite Overlay was started through Node and connected through
the real Network settings surface to the already-running healthy backend at
`http://127.0.0.1:7878`. The existing `AInvest Creator Spaces 竞品自治子系统`
Task and its complete `mirror-watch-competitor-researcher` transcript supplied
the exact persisted package Tool shown in the user's screenshot. No Task,
Session, message, or backend process was created, stopped, restarted, or
mutated.

The first real-page pass found that making only the title shrinkable was
insufficient: the package Tool's very large parameter detail retained an
intrinsic `auto` flex basis and squeezed the 538px title to approximately 1px.
The shared contract was therefore completed by giving detail a zero basis so
it consumes only remaining width while the title keeps content priority and
still yields to timing.

The corrected page was operated through the real disclosure and Tool-header
buttons and personally inspected in both collapsed and expanded states. A
scoped Browser screenshot showed the exact long Tool row ending in an ellipsis,
followed by the complete `11:10:14 AM` start time and `10s` duration with no
overlap. The screenshot was reviewed interactively and was not retained as a
baseline or UI test artifact.

Browser geometry from that same rendered row confirmed:

- collapsed: title content width 538px, rendered width 367px, title right edge
  1526px, timing start edge 1548px, and no overlap;
- expanded: title rendered width 352px, title right edge 1521px, timing start
  edge 1537px, complete start/duration values, and no overlap;
- short `bash`: the 34px title remains complete, its detail consumes the
  remaining 343px, and timing begins after the detail with no overlap.

The temporary current-source Vite process and Browser tab were closed after
acceptance. The user's existing OpenCorvus backend remained running.

## Non-UI Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay localization validation | Passed. |
| Overlay production Vite build | Passed after transforming 7,062 modules; existing third-party directive and chunk-size notices remained informational. |
| Documentation health | Passed: 70 tests and 1,188 expectations across historical links, document health, and product documentation single source. |
| Static integrity | `git diff --check` passed. |
| UI automated tests | None added, modified, updated, or run. |

## Second Review

The final source and rendered geometry were re-read after the visual pass. The
repair changes only the shared Tool title/detail allocation: title uses
`flex: 0 1 auto` with a `100%` maximum and detail uses `flex: 1 1 0`. The
canonical Tool name, complete persisted timing, single-line header, ellipsis,
shared renderer, disclosure ownership, and timing ownership remain unchanged.
There is no package-name branch, fixed character or pixel cap, fallback,
wrapping path, hidden timing, duplicate renderer, or new state. The unrelated
dirty `packages/opencorvus/src/skill/builtin-payload.ts` remains untouched and
unstaged.

## Delivery

Implementation commit `782f6a52d4` was merged with the concurrently advanced
`myhexin/v0.0.30beta` history without conflict and pushed through the repository
pre-push checks. The converged remote head after that delivery was
`b7732a0cd5`.
