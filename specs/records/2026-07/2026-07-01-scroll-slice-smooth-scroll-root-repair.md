# Scroll Slice Smooth Scroll Root Repair

## Recall

User request: explain why `browser_preview_compare_scroll_slices` showed an image only for the first call, while expanded later calls and the right-toolbar screenshot browser were empty.

Acceptance criteria:

- Identify whether screenshots were generated, persisted, and indexed for the later calls.
- Use the attached task debug info for the live task `tsk_f1c509906001gSUp1zTzui0s3t`.
- Preserve the scroll-slice contract: no fallback, no clamping, no proportional scroll mapping, and failed exact-scroll evidence must still fail loudly.
- Repair the root cause if the tool is incorrectly failing valid exact-scroll captures.

Hard constraints:

- Screenshot browser remains transcript/card-tree sourced; do not add a second screenshot store.
- `browser_preview_compare_scroll_slices` remains supporting `visual_diff` evidence, not reference-comparison proof.
- Keep exact `window.scrollY === requested scrollY` verification.

Sources read:

- `specs/records/2026-06/2026-06-20-visual-qa-scroll-slice-comparison.md`
- `specs/records/2026-06/2026-06-24-tool-result-image-attachments.md`
- `specs/records/2026-06/2026-06-25-tool-result-browser-image-single-owner.md`
- `specs/records/2026-06/2026-06-14-right-toolbar-screenshot-browser.md`
- `specs/records/2026-06/2026-06-22-screenshot-browser-card-tree-cache.md`
- `specs/records/2026-06/2026-06-22-screenshot-browser-top-level-index.md`
- `specs/records/2026-06/2026-06-23-screenshot-top-level-incremental-index.md`
- Attached task debug info: runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`, worktree `C:\Users\chuan\myhexin-local\demos\economy\forex`.

Whole-repository and runtime evidence:

- `rg -n "browser_preview_compare_scroll_slices|buildMultimodalToolResult|state\\.attachments|screenshotItems" packages specs -S`
- DB query of `part.data` for `browser_preview_compare_scroll_slices` showed successful first-viewport calls have `state.attachments[0].url`, while nonzero scroll calls are `status=error` with no attachments.
- Latest failure messages include `Implementation did not reach requested scrollY: requested=900 actual=775`, `requested=1800 actual=1312`, and `requested=3600 actual=1466`.
- The target page includes global `html { @apply scroll-smooth; }`, so `window.scrollTo(0, scrollY)` starts a smooth scroll animation instead of making an immediate exact jump.

Independent agent feedback:

- Not requested for this narrow root-cause repair.

## Root Cause

The screenshot browser and inline tool renderer were not dropping successful images. The later tool calls failed before attachments were produced. The failure was caused by page-level smooth scrolling: the sidecar used `window.scrollTo(0, input.scrollY)` and then checked `window.scrollY` after a short settle delay. On pages with `scroll-behavior: smooth`, nonzero scrolls can still be mid-animation when the exact-scroll assertion runs, so the tool reports an error and returns no image attachment.

## Fix Plan

Make the sidecar perform an exact instant window scroll independent of page CSS:

1. Temporarily set `document.documentElement.style.scrollBehavior` and `document.body.style.scrollBehavior` to `auto`.
2. Call `window.scrollTo({ left: 0, top: requestedScrollY, behavior: "instant" })`.
3. Wait for animation frames so layout observes the scroll position.
4. Restore the previous inline styles.
5. Keep the existing exact `actualScrollY === requestedScrollY` assertion.

## Verification

- Add a regression test whose implementation page declares `scroll-behavior: smooth` and request a nonzero scroll slice.
- Run the focused browser-preview scroll-slice test file.
- Run the docs link health test for the new spec record.

## Push Status

Local commit and pre-push checks completed, but `git push myhexin coding-assistant` is blocked by the remote pre-receive hook requiring a real `dsw-*` task id. The attached OpenCorvus task debug info contains `tsk_f1c509906001gSUp1zTzui0s3t`, not a `dsw-*` id. Existing records explicitly say not to invent a `dsw-*` id to bypass this hook.

The current local `coding-assistant` branch is also 334 commits ahead of `myhexin/coding-assistant`, so a current-branch push would submit historical unpushed commits with messages that predate the remote hook requirement. This repair remains committed locally and verified; git-cc push needs a real `dsw-*` id and branch-history convergence decision.
