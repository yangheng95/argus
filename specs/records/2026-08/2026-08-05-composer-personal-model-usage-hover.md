# Composer Personal Model Usage Hover

## Recall

### User request

- Show the personal model token/usage balance when the pointer hovers the Composer model selector.
- Use Multica as a reference.
- Follow-up visual correction: remove account plan, rate-limit duration, reset time, spent amount, and credits from the Tooltip; every supported personal model must present one consistent `remaining / total` balance row.

### Acceptance criteria

- A connected OpenAI model authenticated through ChatGPT OAuth owns a hover surface on the Composer model selector.
- The surface reports the authoritative Codex short-window and long-window remaining percentages, their reset times, the account plan, and credits when the upstream supplies them.
- The existing Hexin monetary budget remains available through the same Provider account-usage presentation contract.
- Loading, terminal upstream failure, and successful data are visibly distinct without exposing either provider credential to the Overlay.
- The visible success state contains only the balance label and normalized `remaining / total` value: OpenAI rate limits use `remaining% / 100%`, while monetary providers use `currency remaining / limit`.
- The implementation is verified through positive non-UI contract tests plus a real running page, pointer hover, screenshot, and manual visual review.
- The delivered branch is committed with the `dsw-33987` prefix and pushed to `myhexin`.

### Hard constraints

- The server owns authentication, token refresh, upstream requests, validation, and normalization. The Overlay consumes one typed account-usage response and does not know credentials.
- There is one account-usage route and one Provider-owned strategy registry; the existing Hexin-only route and Overlay service are replaced, not retained as compatibility paths.
- OpenAI percentages are upstream **used** percentages and must be normalized into clamped **remaining** percentages before crossing the server boundary.
- OAuth refresh reuses the existing OpenAI Codex refresh owner. It must not duplicate refresh-token exchange or persistence logic.
- No UI automated test may be added, modified, or run. Existing UI behavior is accepted only through real interaction and personally inspected screenshots.
- Non-UI tests assert complete positive success or typed error contracts. No absence/negative behavior tests are retained in the touched Provider usage test surface.
- No new worktree, fallback, route gate, state machine, hidden message, synthetic message, or dual source is permitted.
- Concurrent unrelated working-tree changes are preserved and excluded from this task's commits.

### Evidence read

- `specs/records/2026-07/2026-07-15-composer-budget-hover-and-home-cards-authority.md`
- `specs/records/2026-07/2026-07-16-overlay-menu-shortcut-icon-budget-convergence.md`
- `specs/records/2026-07/2026-07-31-hexin-endpoint-resolution.md`
- `packages/overlay/src/components/ComposerModelSelector.tsx`
- `packages/overlay/src/services/config.ts`
- `packages/opencorvus/src/server/routes/provider.ts`
- `packages/opencorvus/src/plugin/openai/codex.ts`
- `packages/opencorvus/src/auth/index.ts`
- `packages/opencorvus/src/provider/provider.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- Multica current source at commit `31cd51ae2fa294ec0808840a40d84b4a6dc9c5cd`, especially `packages/core/billing/queries.ts` and `packages/views/billing/billing-test-page.tsx`.
- OpenAI Codex current source at commit `5c44f110649f8811546745bb1635ba0b44a1639e`, especially `codex-rs/backend-client/src/client/rate_limit_resets.rs`, `client.rs`, and `types.rs`.
- OpenAI Codex app-server protocol documentation for `account/rateLimits/read`.

### Whole-repository searches

- `rg "hexin/budget|HexinBudget|composer-model-budget|model-selector-budget"` found one project route, one Overlay request helper, one Composer tooltip owner, its styles, project-route context declarations, and a directly owned server test.
- `rg "refreshAccessToken|ChatGPT-Account-Id|Auth.set"` found the existing OpenAI OAuth refresh/persistence flow in `plugin/openai/codex.ts`; there is no existing Codex usage-query owner in OpenCorvus.
- `rg "global/providers|Provider.Info|connectedModelOptions"` showed that both project and global Composer paths use the same catalog shape, while project-scoped runtime routes require a directory.
- Current runtime evidence from `GET /global/providers` showed both `hexin` and `openai` connected; the selected personal OpenAI model could not own the existing tooltip because eligibility was hard-coded to `hexin`.
- No independent agent was requested or used.

## Root cause

`ComposerModelSelector` creates and mounts `createHexinBudgetState` only when the selected Provider ID equals `hexin`. The personal model is an `openai` model backed by ChatGPT OAuth, so the trigger-level Tooltip is explicitly disabled for it. This is not a timing or CSS defect: the required upstream usage protocol and normalized transport contract do not exist in OpenCorvus.

## Reference decision

Multica's relevant mature pattern is a typed authoritative server query consumed through a short-lived client cache with explicit loading/error/success rendering. Multica does not currently contain the exact model-selector hover requested here, so copying its presentation would invent evidence. OpenAI Codex is the protocol authority: ChatGPT OAuth usage is read from `/backend-api/wham/usage` with Bearer authentication and `ChatGPT-Account-Id`, and the response reports used percentages for primary and secondary windows.

## Design

1. Introduce a Provider-owned account-usage module with a discriminated response contract and exact OpenAI/Hexin strategies.
2. Extract the existing OpenAI Codex OAuth access-token refresh/persistence operation into a reusable function used by both model requests and account-usage requests.
3. Replace `GET /provider/hexin/budget` with `GET /provider/:providerID/account-usage`. The server returns a normalized monetary-balance or rate-limit payload and a typed error payload.
4. Publish account-usage capability metadata in both project and global Provider catalogs so the Overlay never duplicates supported Provider IDs.
5. Replace the Hexin-only Overlay resource with one capability-driven account-usage resource and render both payload variants in the shared Tooltip primitive.
6. Replace the touched Hexin route test with positive account-usage schema/route contracts, update route-context and generated route documentation, then run targeted non-UI validation.
7. Start the real app, hover the selected OpenAI model control, save a task-bound screenshot, inspect it manually, correct visual defects, and repeat until accepted.

## Verification commands

- `bun test packages/opencorvus/test/server/provider-account-usage.test.ts`
- `bun test packages/opencorvus/test/server/project-route-context.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- the repository's focused document-health and route-generation/check commands discovered from package scripts
- focused package typechecks/builds needed by the changed server and Overlay surfaces
- real Browser pointer hover and manually reviewed screenshot; no UI test runner

## Visual acceptance

- A headed Node/Playwright browser opened the current Overlay from the task-scoped server and configured `openai/gpt-5.6-terra` through the product's Provider UI.
- The live account-usage request returned the authenticated Pro account's seven-day window with 55% remaining and its reset time.
- Pointer hover rendered the shared Tooltip above the model selector without covering the selector, send control, or Composer mode controls.
- The initial detailed screenshot established the runtime path but was superseded when the user rejected its information density.

## Compact balance correction

- The first visual review proved that the detailed account card was functionally correct but denser than the user's requested balance glance.
- The corrected presentation has one semantic row and one visual hierarchy for every account-usage capability: `Balance` on the left and `remaining / total` on the right.
- OpenAI's selected primary limit window is projected as a percentage balance with a fixed 100% total; monetary providers retain their authoritative currency, remaining amount, and limit.
- Plan type, window duration, reset timestamp, spent amount, secondary-window detail, and credits remain available in the server response but are intentionally not projected into this compact Composer surface.
- A headed Node/Playwright browser then reselected `openai/gpt-5.6-terra`, waited for the live account response, preserved the real pointer hover, and captured the final compact surface.
- The final screenshot was inspected at original resolution: the selected model remained visible, the Tooltip contained only `Balance 54% / 100%`, and neither the model selector nor send control was obscured. Evidence: [compact OpenAI account-usage hover](../../artifacts/2026-08-05-composer-openai-account-usage-hover.png).
