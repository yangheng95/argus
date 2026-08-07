# Pinned Project Label Convergence

## Recall

- User requirement: the supplied desktop screenshot shows that a pinned Project row renders only the pin and remove icons; restore the missing Project name.
- Acceptance criteria: a pinned Project with an empty stored title renders the same non-empty directory-derived name as its Projects-section row; a non-empty custom Project title remains authoritative; the label stays ellipsized inside the existing row and the visible remove action remains unchanged; a real desktop browser fixture is inspected by screenshot.
- Hard constraints: preserve Project pin state as the existing backend projection; do not add local state, a second label source, compatibility behavior, a workflow gate, a handwritten user-interface primitive, mobile or tablet scope, or a new worktree; do not refresh or restart the user's running OpenCorvus or Overlay; Playwright must be launched through Node.js; commit subjects begin with `dsw-33987` and pushes target `myhexin`.
- Sources read: `AGENTS.md`; the supplied `codex-clipboard-143b6f07-34e7-4b57-9754-ceea5a6caecd.png`; `2026-07-13-project-pin-unpin-and-icon-repair.md`; `2026-07-16-project-pin-optical-size-repair.md`; `2026-07-14-agent-rail-center-and-pinned-project-affordance.md`; current `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `project-directory.ts`, `work-ledger.css`, `sidebar.css`, Work Ledger browser fixture, and focused consolidation/directory tests.
- Whole-repository search evidence: `projectDisplayName` has exactly two render consumers in `WorkLedger.tsx`, the Projects group and Pinned row; `ProjectLedgerGroup` has one production caller and already derives a directory name when its optional custom name is empty; `projectDirectoryLabel` is the existing cross-platform directory-label owner used by Work Ledger, Project headings, and Conversation; the pinned row bypasses that owner by directly rendering `group.project?.title`; `.sidebar-codex-action-label` already owns the correct grid column, minimum width, overflow, ellipsis, and no-wrap behavior; the only browser coverage of `work-ledger-pinned-project` verifies icons and unpin visibility but does not assert label text.
- Independent agent feedback: none. The user did not request sub-agents and the active policy forbids spawning them otherwise.

## Root cause and replacement design

The backend deliberately projects an empty string when a Project has no stored custom name. The normal Projects row resolves that empty value through `projectDirectoryLabel`, so it shows the final directory segment. The Pinned row renders the raw optional title instead, which creates an empty label element. The supplied screenshot is therefore a data-to-label inconsistency, not a color, clipping, or grid-width problem.

Add one shared Project display-name resolver beside `projectDirectoryLabel`. It trims and uses the stored custom name when present; otherwise it returns the existing cross-platform directory label. Both the Projects group and Pinned row consume that resolver, so there is one label decision and the existing Button, Icon, grid, ellipsis, and pin mutation surfaces remain unchanged.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `project-directory.ts` | Add the only stored-name versus directory-name resolver and unit coverage for custom, Windows-path, Portable Operating System Interface path, and unknown-directory inputs. |
| `WorkLedger.tsx` | Make the existing group display helper delegate to the shared resolver; both of its current render consumers remain unchanged. |
| `ProjectLedgerGroup.tsx` | Replace its local stored-name selection with the shared resolver so the generic heading cannot drift from Pinned. |
| `work-ledger-consolidation.test.ts` | Assert both Work Ledger and Project group import and consume the same resolver. |
| `project-delete-button.test.ts` | Replace its retired local-name-selection source assertion with the shared resolver contract. |
| `ledger-scrollbar-browser.test.ts` | Serve an empty Project title, prove Pinned and Projects render the same visible `app` label, preserve unpin and repin behavior, and capture a task-scoped desktop screenshot. |
| `work-ledger.css` and `sidebar.css` | Retain unchanged; current grid and ellipsis rules are already correct. |

## Verification plan

- Focused directory and Work Ledger tests pass.
- Overlay TypeScript checking and production Vite build pass.
- The Node.js browser runner executes the real Overlay fixture, validates empty-title label equality and pin interactions, and writes a task-scoped screenshot for visual review.
- Historical document links, document health, formatting diff, and final changed-file review pass.
- A second implementation and screenshot review confirms there is no duplicate label owner, layout regression, or hidden remove action before commit and push.

## Progress

- [x] Recall, existing-decision review, and whole-repository call-site inventory.
- [x] Root-cause design and verification plan landed.
- [x] Shared display-name implementation and regression tests.
- [x] Real desktop browser screenshot review.
- [x] Second implementation and screenshot review.
- [x] Final commit and `myhexin` push.

## Verification result

- PASS: 31 focused directory, Work Ledger, Project group, navigation, tooltip, and ownership tests with 773 assertions. The new unit matrix covers trimmed custom names, empty-name Windows paths, whitespace-only Portable Operating System Interface paths, and an unknown directory.
- PASS: Overlay TypeScript checking and the production Vite build. The existing informational bundle-size warning remains unchanged.
- PASS: the Node.js browser runner executed `ledger-scrollbar-browser.test.ts` against the production Overlay. It observed a visible non-zero-width `app` label for an empty Project title, the same `app` label after unpinning in Projects, the `[false, true]` unpin and repin request sequence, and the unchanged visible remove action. The first run exposed an unsupported element-handle query in the new assertion; the test was corrected to use its existing page query owner and the full browser flow then passed.
- Visual review PASS: `packages/overlay/.scratch/pinned-project-label/01-empty-title-visible.png` shows the pin, `app` label, and remove icon in one clean row; `packages/overlay/.scratch/work-ledger-scrollbar-hidden.png` shows the same `app` name under both Pinned and Projects with aligned left content and an unobstructed remove action.
- PASS: 80 historical-link and document-health tests with 1,308 assertions.

## Second review

- The Project row's stored title and directory remain the only inputs. `projectDisplayName` is the single selection owner; neither renderer keeps a local custom-name decision.
- Pinned and Projects still use the existing Button, Icon, project-directory label, grid, ellipsis, and pin mutation owners. No style override, local state, duplicate message, hidden label, or backend contract was added.
- The screenshot confirms the source diagnosis: once the empty title is resolved through the shared directory label, the existing layout displays the name without any Cascading Style Sheets change.
- All production and test call sites found by the repository search are covered. No dead or obsolete code remains in the touched scope.

## Delivery result

- Implementation commit `ec9feb1dc` (`dsw-33987 restore pinned project labels`) was pushed to `myhexin/work-v0.0.9beta-yr-0718`.
- The mandatory pre-push hook passed repository-wide type checking, route inventory, generated documentation, Overlay localization, and secret scanning without bypasses.
