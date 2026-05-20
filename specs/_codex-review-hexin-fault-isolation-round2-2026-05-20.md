# Codex Review Round 2 — Hexin Provider Fault Isolation

**Branch**: `fix/hexin-discovery-fault-isolation`
**Latest commit**: `cf9728241`
**Round 1 verdict**: iterate (3 items)
**Round 1 review file**:
`specs/_codex-review-hexin-fault-isolation-2026-05-20.lastmsg.md`

## What changed since round 1

Addressing each item from your round-1 review:

### Item 1 (Blocker — rule 8 single source) — FIXED

`discoverHexinModelsForStartup` no longer reads `process.env.HEXIN_API_KEY`.
It trusts `opts.apiKey` as the sole credential source. The
Provider.state() boundary owns credential resolution via
`hexinApiKey(config)` which routes through `Env.get` (per-instance
shim) → Config → `Auth.get` in that order.

The user-initiated `discoverHexinModels` / `refreshHexinCache` path
still falls back to `process.env` when `opts.apiKey` is empty —
intentional, since those are direct unit/CLI callers outside any
Instance scope where the per-instance isolation does not apply.
Documented in the rewritten module header.

Regression tests added:

a. `startup helper does NOT bypass per-Instance Env isolation by reading
   process.env` — sets `process.env.HEXIN_API_KEY` globally, calls
   `Env.remove` inside `Instance.provide`, asserts `Provider.list()`
   resolves without firing the global fetch mock. Exact shape you
   requested in round 1.

b. `startup helper ignores process.env when called directly with no
   apiKey — unit-call shape` — explicit unit-call check, sets process.env
   directly, calls `discoverHexinModelsForStartup({})`, expects
   `source:"empty"` and zero fetches.

### Item 2 (Must-fix cleanup — UI surfacing overclaim) — FIXED

Rewrote three doc-comment passages:

  * Module header `hexin-discovery.ts:22-23` — was "Returns
    { models, error?, source } so the caller can log and the UI can
    surface the cause"; now states the helper returns the outcome "so
    the caller can log the failure (no UI contract is added in this PR
    — Provider.Info has no error field today; the catalog route is the
    operator's path back to hexin)".
  * `StartupDiscoveryOutcome` doc `:198-216` — replaced "the UI can
    choose how to nudge the operator" with "log metadata only, not
    driver state" and an explicit note that the error is not
    propagated to Provider.Info.
  * Resolution-order step 3 `:231-232` — replaced "The UI can prompt
    the operator to paste a key / refresh" with "The operator can
    recover by pasting a key from the /provider catalog UI and hitting
    the refresh button".

I deliberately did NOT add the error field to `Provider.Info` —
matching your round-1 guidance that a contract/schema change should
wait for explicit UX requirements.

### Item 3 (Residual risk — plugin.auth.loader / CUSTOM_LOADERS) — DEFERRED

Captured in `specs/followup-state-init-fault-isolation-2026-05-20.md`
with:

  * The three concrete failure call-sites (hexin live discovery now
    fixed; plugin.auth.loader at `provider.ts:560`; CUSTOM_LOADERS at
    `:573`, concrete example `vendor.ts:406` cloudflare-ai-gateway
    partial-config throw).
  * Proposed `loadOrSkip(name, fn)` helper shape mirroring the
    `LoaderOutcome` pattern.
  * Acceptance criteria including per-loader fault-injection tests.
  * Out-of-scope: still no `error` field on `Provider.Info` until UX
    asks.

Reason for deferral: the hexin-focused PR scope is "/models budget
exceeded must not blank the UI" (one concrete user-facing outage).
Generalizing in this same PR would bloat the diff, expand the test
matrix to every loader, and invalidate your focused review. I treated
it as a known follow-up rather than skipping.

## Diff (round-2 only)

`git diff 5b294f81b..cf9728241 -- packages/opencorvus/ specs/`

Files:
- packages/opencorvus/src/provider/hexin-discovery.ts (+47 / -22)
- packages/opencorvus/test/provider/hexin-discovery.test.ts (+53 / 0)
- specs/followup-state-init-fault-isolation-2026-05-20.md (+94, new)

## Test status

`bun test test/provider/hexin-discovery.test.ts` — 17/17 pass.
`bun run typecheck` — clean.
`bun test test/provider/` full suite — 191 pass / 53 fail (same 53
pre-existing failures unrelated to hexin, unchanged from round 1).

Pre-push hooks (typecheck / api:routes-check / docs:check / overlay
i18n / secret-scan) all green on both commits.

## Deliverables I want from round 2

1. Verdict on items 1 and 2: **resolved / still blocking**.
2. Confirmation that the round-1 list of must-fix items is now closed
   modulo the explicitly-deferred item 3.
3. Anything else I missed — be ruthless.
4. ship / iterate / block.

If verdict = ship, this branch is ready to merge into
`feat/architect-contract-audit-coverage` (its base).
