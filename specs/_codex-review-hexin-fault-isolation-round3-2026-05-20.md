# Codex Review Round 3 — Hexin Provider Fault Isolation

**Branch**: `fix/hexin-discovery-fault-isolation`
**Latest commit**: `ce1ce0efc`
**Round 2 verdict**: iterate (1 finding — Provider.refreshHexin env bypass)
**Round 2 review file**:
`specs/_codex-review-hexin-fault-isolation-round2-2026-05-20.lastmsg.md`

## What changed since round 2

### Round-2 finding (Provider.refreshHexin env bypass) — FIXED via option (b)

Removed the `process.env.HEXIN_API_KEY` fallback from
`discoverHexinModels` force path entirely. `opts.apiKey` is now the only
credential source; force path throws `HEXIN_API_KEY unset` when it is
empty. Both module entry points (startup helper and user-initiated
discoverHexinModels / refreshHexinCache) are now uniform: no
`process.env` reads inside `hexin-discovery.ts`.

- `hexin-discovery.ts:173` — force path tightened to `opts.apiKey?.trim()`
  with an explanatory comment about why we refuse to consult process.env.
- Module header — rewritten to state the new no-env policy and the
  explicit-key requirement for direct callers.

Existing direct-caller tests that depended on the implicit env fallback
were updated to pass `"test-hexin-key"` explicitly:

- "explicit refresh fetches live models and writes the cache" — passes
  apiKey arg now.
- "explicit refresh surfaces live fetch failure instead of using stale
  cache" — passes apiKey arg now.
- "target reasoning models are exposed with provider-safe capabilities"
  — passes apiKey arg now.

Old test "explicit refresh requires a live key even when stale cache
exists" rewritten and tightened into "explicit refresh requires an
explicit apiKey — never falls back to process.env": even with
`process.env.HEXIN_API_KEY` set by beforeEach, the no-arg call must
throw `HEXIN_API_KEY unset` and the global fetch mock must never fire.

Added the codex-requested provider-layer regression test:

```
test("Provider.refreshHexin throws HEXIN_API_KEY unset when Env-scoped
       key is masked — does NOT fall through to process.env", ...)
```

Sets `process.env.HEXIN_API_KEY` globally, runs `Env.remove("HEXIN_API_KEY")`
inside `Instance.provide`, asserts `Provider.refreshHexin()` rejects
with `HEXIN_API_KEY unset` and no fetch is fired.

## Diff (round-3 only)

`git diff cf9728241..ce1ce0efc`

Files:
- packages/opencorvus/src/provider/hexin-discovery.ts (+13 / -7)
- packages/opencorvus/test/provider/hexin-discovery.test.ts (+50 / -7)

## Test status

`bun test test/provider/hexin-discovery.test.ts` — 18/18 pass.
`bun run typecheck` — clean.

Pre-push hooks all green.

## Deliverables

1. Is the Env-isolation bypass fully closed across ALL callers now? I
   read the module again — `process.env` no longer appears in
   `hexin-discovery.ts` source at all. Confirm or point out any
   remaining surface.
2. ship / iterate / block.
3. Any rule violations or missed edges I'm still blind to.

If verdict = ship, this branch goes into
`feat/architect-contract-audit-coverage` next.
