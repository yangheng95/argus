# Overlay Radius And Input Weight Convergence

Date: 2026-07-27
Status: In progress
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.

## Recall

### User requirements

- Make the page's rounded-corner primitives consistent and visibly rounder.
- Remove bold or heavy typography from text entered in input fields.

### Acceptance criteria

- Ordinary page-level rounded surfaces share the same canonical large-radius
  token, including agent cards, reusable popovers, form fields, buttons, and
  the Composer shell shown in the supplied desktop screenshot.
- The shared soft and large radius scale increases from 6/10 pixels to 8/12
  pixels at scale one. Extra-large remains reserved for macro workspace and
  modal-dialog framing rather than the ordinary Composer shell.
- Every visible canonical TextField input and textarea renders entered text at
  the regular body weight. Composer does not maintain a second feature-local
  font-weight declaration.
- Focused source tests, Overlay typecheck/build, a Node-launched real browser
  test, computed-style assertions, a task-scoped screenshot, and a second
  visual review pass.

### Hard constraints

- Preserve every unrelated staged, unstaged, and untracked change in the
  shared main worktree. Do not reset, restore, stash, create a worktree, or
  broadly stage files.
- Do not restart, close, refresh, or interfere with the operator's running
  OpenCorvus or Overlay process. Visual verification uses an isolated Vite
  target.
- Reuse the existing five-token radius scale and canonical TextField primitive.
  Do not add a feature-local radius, fallback, compatibility alias, gate, or
  second text-entry recipe.
- Desktop is the only visual acceptance target.
- Playwright runs under Node, never Bun.
- Commit subjects use `dsw-33987`; delivery goes to the `myhexin` remote.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control skill.
- Supplied screenshot
  `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-1efb861e-1bb9-4aeb-9ca1-de4201317c9f.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/records/2026-07/2026-07-17-overlay-primitive-system-convergence.md`.
- `specs/records/2026-07/2026-07-26-environment-menu-subagents-and-radius-refinement.md`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/primitives/text-field.css`.
- `packages/overlay/src/styles/primitives/{button,popover,panel}.css`.
- `packages/overlay/src/styles/surfaces/{card,chat-bubble,composer,conversation,dialog,workspace}.css`.
- Radius, TextField, Composer, and browser regression tests.

### Whole-repository search evidence

Searches enumerated every radius token declaration and consumer, every
`border-radius` declaration in Overlay CSS, all `chat-input` owners, every
TextField input/textarea typography rule, the exact-value density assertions,
and the existing browser fixtures that render Composer, agent cards, and
Environment popovers.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `design-language.css` | Sole owner of the five-token radius scale; soft/large are 6/10 pixels. | Raise only soft/large to 8/12 pixels. Keep none, extra-large, and pill semantics. |
| Primitive CSS | Buttons, fields, popovers, menus, action tiles, and navigation rows already consume semantic tokens. | Inherit the refined scale; no per-feature overrides. |
| `chat-bubble.css` | Agent message surface already consumes `--oc-radius-large`. | Keep; it becomes the page-level reference radius. |
| `composer.css` | Composer shell alone consumes `--oc-radius-xl`; `.chat-textarea` separately repeats body weight. | Move the shell to `--oc-radius-large` and remove the feature-local typography duplicate. |
| `text-field.css` | Owns input/textarea chrome but uses `font: inherit`, allowing parent weight to leak into entered text. | Explicitly own `--ui-font-weight-body` for every canonical text-entry slot. |
| `dialog.css` and `workspace.css` | The remaining production `--oc-radius-xl` consumers are modal and macro workspace frames. | Preserve their separate macro-scale semantics. |
| Source/browser tests | Exact radius values and Composer's former extra-large tier are pinned. | Update the canonical contracts and add real computed-style plus screenshot coverage. |

No component API, backend route, state model, responsive behavior, or native
window chrome changes.

### Independent agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested subagents.

## Root cause

The radius system is centralized, but the visible page in the supplied
screenshot mixes two semantic tiers at the same hierarchy: message cards,
fields, and Environment use the ordinary large token while Composer uses the
24-pixel extra-large token. Raising the previous 4/8 scale to 6/10 improved the
small surfaces but did not remove that tier mismatch. The correct fix is to
keep one ordinary page-surface token, refine it modestly, and reserve
extra-large for macro workspace/modal framing.

TextField currently declares `font: inherit` without resetting font weight.
That lets a strong-weight parent make entered text appear bold. Composer adds a
local body-weight correction, but other TextField consumers do not. The
primitive must own regular entered-text weight once for all inputs and
textareas; Composer's duplicate declaration must be removed.

## Implementation plan

1. Update source tests first to require the 8/12 radius scale, the ordinary
   large-radius Composer shell, and primitive-owned regular input weight.
2. Change the shared tokens, Composer radius, and TextField typography; remove
   the Composer-local weight declaration.
3. Update the current architecture and add a focused real-browser fixture that
   measures same-level surface radii and input weight in both light and dark
   themes while saving a task-scoped screenshot.
4. Run focused tests, Overlay typecheck/build, documentation health, and the
   Node browser path. Inspect the screenshot at original resolution and correct
   any visual defect.
5. Perform a second source/diff/screenshot review, commit only task-owned
   changes, reconcile the remote branch, and push to `myhexin`.

## Status

- [x] Baseline diagnosis, architecture review, and whole-repository call-point search.
- [ ] Source contracts and implementation.
- [ ] Vite geometry and screenshot review.
- [ ] Validation, second review, commit, and push.
