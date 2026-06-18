# Retire Session Dialog Diff Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

`SessionDialogHost` renders through the shared `Dialog` primitive, but still
passes `formClass="diff-dialog-form"` and wraps the primitive title in
`diff-dialog-head > h3.dialog-title`. That leaves retired diff-dialog selectors
in production DOM after the CSS cleanup already taught tests that those
selectors were gone.

The nested `.dialog-title` is also a primitive ownership violation: the
`Dialog` primitive already renders `KobalteDialogTitle` with the canonical
`.dialog-title` class.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-19-retire-dialog-section-actions-residue.md` | Session dialog body and `.session-msg*` remain live, but retired dialog-only selector families should not survive without production owners. |
| `dialog-primitive.test.ts` | Feature components must import and render the shared Dialog primitive rather than local dialog shells. |
| `dialog-service-single-source.test.ts` | Session dialog service is store-backed and no longer writes `sessionDialogTitle` or `sessionDialogBody` through raw DOM. |
| `Dialog.tsx` | `KobalteDialogTitle` renders canonical `.dialog-title`; feature hosts should pass title content, not a nested title element. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n "diff-dialog-head|diff-dialog-form|dialog-title|SessionDialogHost|sessionDialogTitle|titleID|titleId|KobalteDialogTitle|<Dialog" packages/overlay/src packages/overlay/test specs/new-arch -g "*.ts" -g "*.tsx" -g "*.css" -g "*.md"` | `diff-dialog-head` and `diff-dialog-form` production hits are only `SessionDialogHost`; browser fixture still hardcodes them. `sessionDialogTitle` has no service owner. | Remove the retired diff selectors from `SessionDialogHost`; do not add a compatibility title id prop. |
| `SessionDialogHost.tsx` inspection | Host passes `formClass="diff-dialog-form"`, `titleAs="div"`, and nested `h3.dialog-title`. | Pass the title text directly to `Dialog` and let the primitive own header/title DOM. |
| `Dialog.tsx` inspection | Primitive owns `.dialog-form`, `.dialog-header`, `.dialog-title`, and `dialog-header-actions`. | Keep Session dialog on canonical classes only. |
| `dead-dialog-cleanup.test.ts` inspection | It rejects diff selector CSS but not production component DOM. | Extend it to reject retired diff selectors in production source too. |
| `session-dialog-residue-browser.test.ts` inspection | Browser fixture still renders the retired diff selectors it should be proving absent. | Rewrite fixture to canonical dialog markup and assert retired selector count is zero. |

## Fix Plan

- Remove `formClass="diff-dialog-form"` from `SessionDialogHost`.
- Pass `title={dialogStore.session.title || t("log.title")}` directly and drop
  `titleAs="div"` plus the nested `diff-dialog-head`/`h3.dialog-title`.
- Extend static dialog cleanup and single-source tests so production code cannot
  reintroduce `diff-dialog-form`, `diff-dialog-head`, or nested dialog titles.
- Update the browser residue fixture to canonical `.dialog-form >
  .dialog-header > .dialog-title` markup and assert retired diff/section
  selectors are absent before taking the screenshot.

## Acceptance

- Production source has no `diff-dialog-form` or `diff-dialog-head`.
- `SessionDialogHost` uses one primitive-owned `.dialog-title`.
- Existing session body, close button, and store-backed service behavior remain
  intact.
- Static dialog tests pass.
- Browser screenshot of the full session dialog is regenerated and reviewed
  without retired diff or section dialog selectors.
