# Terminal Reference Visual Parity

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User requirement                 | Adjust the current project terminal so opening it has the supplied Codex terminal effect.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Acceptance criteria              | The existing Right Dock terminal keeps the canonical project-bound shell lifecycle while its visible session strip, active path tab, add action, terminal canvas spacing, font scale, light/dark surfaces, hover/focus states, and desktop density converge on the supplied reference; a real Node-launched desktop browser fixture opens Terminal, renders shell output, proves geometry and interaction, and produces a screenshot that is personally reviewed.                                      |
| Hard constraints                 | Preserve the Right Dock placement established by the 2026-07-15 terminal decision; keep `/pty`, `HostTransport`, and official xterm as the single process, stream, and renderer sources; do not add an iframe, local terminal simulation in production, alternate shell runner, compatibility path, gate, or mobile scope; do not restart or interfere with the running OpenCorvus/Overlay; launch Playwright only through Node; preserve unrelated dirty work.                                        |
| Sources read                     | `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-15-right-dock-embedded-terminal.md`; `TerminalPanel.tsx`; terminal service and CSS; `RightDock.tsx`; `main.tsx`; terminal profile and PTY owners; terminal, Right Dock, and browser-fixture tests.                                                                                                                                                                   |
| Whole-repository search evidence | `TerminalPanel.tsx` is the only xterm owner and embedded-terminal DOM source; `terminal.css` is the only terminal-specific visual source; `services/terminal.ts` is the only Overlay `/pty` adapter; `main.tsx` is the only Terminal mount and active-panel owner; `RightDock.tsx` is the only Terminal catalog/tab owner; `Pty` and `PtyHost` remain the only backend session/process owners; the existing terminal tests are source-contract-only and no browser test opens or screenshots Terminal. |
| Independent agent feedback       | None. The user did not request sub-agents, and the active collaboration constraint forbids unsolicited delegation.                                                                                                                                                                                                                                                                                                                                                                                     |

## Root Cause

The terminal runtime was integrated correctly, but the prior delivery explicitly
failed its real browser screenshot checkpoint. Its present CSS expresses a
generic compact utility panel: a 38-pixel toolbar, 28-pixel session chips,
13-pixel xterm text, weak active-state contrast, and limited canvas breathing
room. No browser acceptance covers the visible terminal, so this divergence
could persist while source assertions and type checks stayed green.

The supplied reference establishes one clear hierarchy: a calm top strip, one
prominent softly rounded active session tab with terminal icon and clipped path
title, an adjacent standalone add action, and a spacious terminal canvas whose
monospace content is the primary surface. The repair belongs in the existing
terminal component and stylesheet, with a real browser fixture closing the
missing visual feedback loop.

## Call-Site Disposition

| Surface                      | Disposition                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TerminalPanel.tsx`          | Keep xterm/session lifecycle; expose stable visual hooks, retain the canonical terminal icon, and keep the server-owned session title as the tab label.                                                                                                |
| `terminal.css`               | Replace compact generic panel geometry with the reference hierarchy; define toolbar/tab/add/canvas/focus/close states for both application themes.                                                                                                     |
| `services/terminal.ts`       | Preserve unchanged as the sole Overlay terminal adapter.                                                                                                                                                                                               |
| `RightDock.tsx` / `main.tsx` | Preserve Dock placement, outer tool ownership, and active lifecycle; no second terminal surface.                                                                                                                                                       |
| `terminal-panel.test.ts`     | Extend the focused contract to pin the mature renderer, opaque theme source, session hook, and reference geometry ownership.                                                                                                                           |
| Browser acceptance           | Add one Node-launched desktop fixture that serves real built Overlay assets, canonical terminal profile/session contracts, and a task-scoped PTY output stream; open Terminal through visible UI, assert geometry/focus/output, and save a screenshot. |
| Spec indexes                 | Add this record to the July and root spec indexes without overwriting concurrent documentation work.                                                                                                                                                   |

## Implementation And Verification Plan

1. Commit and push this Recall before implementation.
2. Refine the terminal component and single terminal stylesheet.
3. Add focused unit and browser coverage for profile icon selection, session-tab
   geometry, add-action separation, visible output, and keyboard focus.
4. Run focused tests, Overlay typecheck, i18n check, production Vite build,
   documentation health, and diff checks.
5. Run the browser fixture through Node, inspect the task-scoped screenshot,
   correct visible mismatches, and rerun until accepted.
6. Perform a second diff/code review, update this record and indexes, commit only
   task-owned changes, and push the branch to git-cc.

## Progress

- [x] Existing architecture, implementation, history, and all call sites inspected.
- [x] Missing visual-acceptance root cause identified.
- [x] Recall committed and pushed (`9f670edb9`).
- [x] Terminal visual hierarchy implemented.
- [x] Focused unit/browser coverage passing.
- [x] Real screenshot inspected and accepted.
- [x] Second review, implementation/index commits, and git-cc push complete (`cbaa2de21`, `5b751b019`).

## Visual Review

The first real screenshot exposed a black xterm Canvas with dark light-theme
text. The production component had enabled transparent rendering and supplied
`#00000000`; the active Canvas renderer resolved that background to black while
the foreground still came from the light theme. The repair removes transparent
Canvas rendering and assigns xterm the computed terminal surface background,
so light and dark modes follow the same application token source.

The same browser run measured a 69-pixel gap between the session tab and add
action. The session's percentage maximum width was self-referential inside its
shrink-to-fit container. Replacing it with a fixed token-scaled maximum and a
bounded sessions container produced the intended 8-pixel separation.

The accepted screenshot is
`.scratch/terminal-reference-visual-parity.png`. It shows the softly rounded
`C:\Windows\System32` session tab, adjacent add action, readable PowerShell
banner, project prompt, and focused cursor on an opaque light-theme canvas.

## Verification

| Command                                                                                                                 | Result                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test packages/overlay/test/terminal-panel.test.ts`                                                                 | Passed: 3 tests, 38 assertions.                                                                                                                                                                 |
| `bun run --cwd packages/overlay typecheck`                                                                              | Passed.                                                                                                                                                                                         |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/terminal-reference-visual-browser.test.ts` | Passed through the required Node runner; real built Overlay opened Terminal, rendered PTY output, verified geometry, and wrote keyboard input.                                                  |
| `bun run --cwd packages/overlay build:vite`                                                                             | Passed as part of the browser fixture; 2,456 modules transformed. The existing large-chunk warning remains informational.                                                                       |
| `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`                                                | Passed: 20 tests.                                                                                                                                                                               |
| git-cc pre-push hook                                                                                                    | Passed after the concurrent Work Ledger locale owner finished its in-worktree repair: repository typecheck, API route inventory, generated docs check, Overlay i18n, and secret scan all green. |

The broader `document-health.test.ts` run reached 73 passing tests but its
tracked-monthly-index check observed a separate concurrent Settings record
before that owner committed it. That record was subsequently committed in
`71b5a4a6f`; the terminal record itself was already tracked from `9f670edb9`
and did not appear in the offender list.
