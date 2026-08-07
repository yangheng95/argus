# Titlebar Brand Wordmark Scale

Date: 2026-07-25

Status: Implemented

## Recall

- User request: enlarge the OpenCorvus wordmark by 1.2x and preserve component alignment.
- Acceptance: the wordmark is exactly 1.2 times the previous 15px title token at every UI scale (18px base), while the adjacent Workspace label remains baseline-aligned.
- Constraints: preserve all concurrent worktree changes; do not restart or interfere with a running Overlay; use the titlebar's real Vite surface and visual screenshot review.
- Read sources: `packages/overlay/src/components/titlebar/TitlebarBrand.tsx`, `packages/overlay/src/styles/surfaces/titlebar.css`, `packages/overlay/src/styles/tokens/design-language.css`, and `packages/overlay/test/titlebar-brand.test.ts`.
- Whole-repository search: `rg -n -i "brand.workspace_label|brand|workspace_label" packages/overlay/src`, `rg -n "TitlebarBrand|titlebar-brand-identity|wordmark" packages/overlay/test packages/overlay/src --glob '*test*' --glob '*spec*'`, and `rg -n -- "--ui-font-title|--ui-font-control" packages/overlay/src/styles` identified one titlebar owner, its source/browser tests, and the shared typography token source.
- Independent agent feedback: not requested; the user did not request parallel agent work.

## Design

Add the scale-aware `--ui-font-brand` typography token at 18px base (the exact 1.2 multiplier of the 15px title token). The titlebar wordmark consumes that one token. Keep the existing inline-flex `align-items: baseline` copy layout so Workspace aligns optically and semantically with the enlarged wordmark.

## Verification

1. Focused source test passed: `bun test packages/overlay/test/titlebar-brand.test.ts` (4 tests / 30 assertions), including the brand token and baseline-alignment contract.
2. Vite/browser visual review passed at desktop resolution. The rendered wordmark is 18px, Workspace is 14px, and the baseline layout has a 1px optical bottom-edge delta; the screenshot was inspected and shows no collision or drift.
