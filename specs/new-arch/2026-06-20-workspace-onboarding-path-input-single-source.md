# Workspace Onboarding Path Input Single Source

Date: 2026-06-20

CSS means Cascading Style Sheets. DOM means Document Object Model. CWD means
Current Working Directory.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | UI work must use mature primitives, avoid double sources, and include visual verification. |
| `2026-06-19-retire-field-input-action-residue.md` | Plain controls use `.field-input`; grouped controls use `.field-input-group`; search controls use `.search-field*`. |
| `2026-06-20-task-dirbar-recent-path-input-single-source.md` | Manual path inputs must not recreate input chrome through local `input` / `input:focus` selectors. |
| `2026-06-19-workspace-onboarding-directory-row-button-primitive.md` | Workspace onboarding directory rows already use `Button`; keep this fix scoped to the manual path input. |
| `2026-06-11-cwd-project-discovery-and-edit.md` | Workspace onboarding reuses the discovery service and the existing `setDirectory` switch path. |
| `2026-06-12-editable-cwd-default-launch-directory.md` | Onboarding manual path entry is the existing browser-host path capability, not a second directory-switch flow. |
| `packages/overlay/src/styles/surfaces/field.css` | `.field-input` owns plain input chrome, `appearance: none`, tokenized background/border/text, and the focus ring. |

## Problem

Independent GUI review found that `WorkspaceOnboardingDialog` still renders the
browser manual path entry as a bare `<input>` with only
`data-testid="workspace-onboarding-browser-path-input"`. The stylesheet
`workspace-onboarding.css` then reimplements normal input border, radius,
background, color, font, padding, and focus through
`.workspace-onboarding-browser-path-label input` and
`.workspace-onboarding-browser-path-label input:focus`.

This is the same root cause as the recent CWD path input: a manual absolute-path
text input bypasses `.field-input`, so shared input fixes such as user-agent
chrome removal and tokenized focus rings do not apply.

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "workspace-onboarding-browser-path-input|workspace-onboarding-browser-path-label input|field-input" packages/overlay/src packages/overlay/test specs/new-arch -S` | The browser path input has one production owner and one private CSS chrome owner. | Migrate only this input and CSS selector family. |
| `WorkspaceOnboardingDialog.tsx` review | The path entry is a plain text input with stable test id, i18n placeholder, disabled state, and `setDirectory` submit path. | Add `class="field-input"` without changing behavior. |
| `workspace-onboarding.css` review | Local selectors duplicate input border/background/color/focus and omit the shared `appearance: none` protection. | Delete private chrome/focus and retain only local layout sizing on `.workspace-onboarding-browser-path-label .field-input`. |
| `workspace-onboarding-browser.test.ts` review | Existing Node browser coverage opens onboarding, submits the manual path, and already has screenshot helpers. | Extend that flow to verify `.field-input` and capture focused input evidence. |
| Independent explorer audit | Confirmed high confidence and found no historical reason to keep private input chrome. | Proceed with a narrow single-source fix. |

## Fix Plan

1. Add `class="field-input"` to the onboarding browser path input.
2. Replace `.workspace-onboarding-browser-path-label input` with
   `.workspace-onboarding-browser-path-label .field-input` for width, min-width,
   height, and compact padding only.
3. Delete `.workspace-onboarding-browser-path-label input:focus`.
4. Extend static coverage to require `.field-input` and reject the retired
   private selectors.
5. Extend the real browser onboarding test to focus the path input, assert
   shared field ownership, and save screenshot evidence.

## Acceptance

- The onboarding manual path input uses `.field-input`.
- `workspace-onboarding.css` no longer owns input border, background, text color,
  font, or focus state for the manual path field.
- Directory row Button primitive behavior remains unchanged.
- Manual path submission still switches via `setDirectory`.
- Static tests and Node/Playwright browser tests cover the contract.
- Visual evidence shows focused input and submit button do not overlap.
