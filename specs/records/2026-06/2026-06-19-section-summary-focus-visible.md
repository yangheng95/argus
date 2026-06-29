# Section Summary Focus Visible

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

The shared `Section` primitive renders each collapsible right-rail group as a
native `<details>/<summary>` pair. The right-panel surface gave
`.oc-section__head` a hover wash, but it did not give the same reachable
visual state to keyboard focus.

That made the workflow, requirements, architect, goal, and acceptance section
headers visibly interactive for pointer users only. On light surfaces the
focused summary could be hard to locate, especially because the section shell
uses `overflow: hidden`.

## Recall

| Source                                             | Relevant constraint                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                        | UI changes require real visual validation; no callsite-only patches for shared UI problems.                                                                                           |
| `2026-06-19-retire-section-icon-button-residue.md` | Live section contract is `.oc-section__head`, `.oc-section__icon`, `.oc-section__title`, `.oc-section__badge`, and `.oc-section__body`; retired header action residue must stay gone. |
| `Section.tsx`                                      | The head is a native `<summary class="oc-section__head">`; no custom button wrapper owns the keyboard state.                                                                          |
| `inspector.css`                                    | Surface-level section chrome owns hover/background/badge/caret styling on top of `primitives/section.css`.                                                                            |

## Evidence Sweep

| Command                             | Result                                                                                                                                                  | Decision                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `rg -n 'oc-section\_\_head.\*focus  | Section.\*focus                                                                                                                                         | section.\*focus                                                                                                      | oc-section\_\_head:hover                                               | oc-section\_\_head:focus' packages/overlay/src packages/overlay/test specs` | Only `.oc-section__head:hover` existed; no `focus-visible` owner was present. | Add the keyboard state to the same surface owner as hover. |
| `rg -n '<Section\\b                 | Section\\(' packages/overlay/src/components packages/overlay/test -g '_.tsx' -g '_.ts'`                                                                 | Production callers are `AcceptancePanel` and `SectionFrame` in `Board.tsx`, both going through the shared primitive. | Do not patch call sites.                                               |
| `rg -n -C 20 '\\.oc-section\_\_head | \\.oc-section\\[open\\] > \\.oc-section\_\_head' packages/overlay/src/styles/primitives/section.css packages/overlay/src/styles/surfaces/inspector.css` | Primitive CSS owns structure; `inspector.css` owns hover wash, active-state background, and shell overflow.          | Put focus background/ring in `inspector.css`; keep colors tokenized.   |
| `rg -n 'workflow-section-stack      | SectionFrame\\(' packages/overlay/src/components/Board.tsx`                                                                                             | Workflow sections and acceptance sections share the same summary class.                                              | Browser validation should use the real right inspector workflow stack. |

## Fix

- Share the section head hover wash with `:focus-visible`.
- Add a tokenized inset focus ring to `.oc-section > .oc-section__head:focus-visible`.
- Keep the rule after active-state section styling so `data-phase-state="active"`
  cannot erase the ring with `box-shadow: none`.
- Do not add `outline: none`; native focus behavior remains available while the
  inset ring stays visible inside the clipped section shell.

## Acceptance

- Static tests require a Section summary `focus-visible` rule and reject hidden
  focus outlines.
- Architecture guards pin the surface owner for section summary keyboard focus.
- Browser validation opens the real overlay, tabs to a right-panel section
  summary, verifies `:focus-visible` and a non-empty tokenized `box-shadow`, and
  saves a screenshot.
- No raw color literal or local token family is introduced.
