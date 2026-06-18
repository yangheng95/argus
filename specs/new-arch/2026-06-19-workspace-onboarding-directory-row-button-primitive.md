# Workspace Onboarding Directory Row Button Primitive

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. CWD means current working directory, the project
directory selected by the user.

## Problem

Independent GUI review found the Workspace onboarding detected-project and
recent-directory rows render as raw `<button>` elements with the private
`.workspace-onboarding-recent-item` button shell. The CSS owns appearance,
border, background, cursor, transition, hover, disabled, and `outline: none`.
That creates a second button system beside `components/ui/Button.tsx` and
prevents these first-run directory choices from inheriting shared focus-visible
and density fixes.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-11-cwd-project-discovery-and-edit.md` | Workspace onboarding must reuse the discovery service and the existing `setDirectory` switch path; no second directory switch implementation. |
| `2026-06-18-connection-banner-button-primitive.md` | Diagnostic and setup actions route through `Button` rather than local raw button chrome. |
| `2026-06-18-chat-composer-button-primitive-owner.md` | Operation buttons use shared `Button` semantics; surface CSS may tune layout through stable `data-ui` selectors. |
| `packages/overlay/src/components/ui/Button.tsx` | `Button` owns `.oc-button` plus `variant`, `size`, and `tone` attributes. |
| `packages/overlay/src/styles/primitives/button.css` | `.oc-button:focus-visible` owns the shared accent outline. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -e "WorkspaceOnboarding" -e "workspace-onboarding-recent-item" -e "workspace-onboarding-recent-list" packages/overlay/src packages/overlay/test specs specs/new-arch` | Production raw rows only live in `WorkspaceOnboardingDialog.tsx`; CSS shell only lives in `workspace-onboarding.css`. Tests currently check ordering and discovery error, not primitive ownership. | Replace both detected and recent rows in one change. |
| `WorkspaceOnboardingDialog.tsx` inspection | The component already imports `Button` for open-folder and manual-path submit actions. | Reuse the existing import; do not add a new primitive or wrapper. |
| `workspace-onboarding.css` inspection | `.workspace-onboarding-recent-item:focus-visible` suppresses outlines with `outline: none`. | Retire the private selector and move row geometry to `.oc-button[data-ui="workspace-onboarding-directory-row"]`. |
| `workspace-onboarding-browser.test.ts` inspection | Browser coverage exercises manual path and discovery error only. | Add a focused detected/recent row browser test with screenshot evidence. |

## Fix Plan

1. Replace detected-project and recent-directory raw `<button>` rows with
   `Button variant="ghost" size="md" tone="neutral"
   data-ui="workspace-onboarding-directory-row"`.
2. Preserve `data-testid`, `data-busy`, `disabled`, `aria-busy`, and the
   existing `setDirectory` actions.
3. Remove `.workspace-onboarding-recent-item` as a private button shell.
4. Add scoped `.workspace-onboarding-recent-list
   .oc-button[data-ui="workspace-onboarding-directory-row"]` layout variables
   and grid geometry while leaving focus-visible to the Button primitive.
5. Extend static coverage to reject the retired class and assert Button
   ownership.
6. Add Node/Playwright browser coverage for detected and recent row focus,
   runtime `.oc-button` attributes, click behavior, and screenshot evidence.

## Acceptance

- `WorkspaceOnboardingDialog.tsx` contains no
  `class="workspace-onboarding-recent-item"` raw row button.
- Both detected and recent rows render through the shared `Button` primitive.
- `workspace-onboarding.css` no longer defines `.workspace-onboarding-recent-item`
  or suppresses row focus outlines.
- Runtime rows are `.oc-button[data-ui="workspace-onboarding-directory-row"]`.
- Keyboard focus uses `.oc-button:focus-visible`; screenshot evidence shows a
  visible focus ring and no text overlap.
- Clicking detected and recent rows still switches through `setDirectory`.
