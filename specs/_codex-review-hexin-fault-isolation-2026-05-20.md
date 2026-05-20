# Codex Review — Hexin Provider Fault Isolation

**Branch under review**: `fix/hexin-discovery-fault-isolation`
**Base**: `feat/architect-contract-audit-coverage` (current feature branch tip)
**Commit**: `5b294f81b fix(provider): isolate hexin /models failure from global state init`

## Context

Production failure (2026-05-20, task `tsk_e43c7c6d3001L8MC4eHaBOp67N`):

```
hexin /models HTTP 400: {"error":{"message":"Budget has been exceeded!
Current cost: 1000.9526553339998, Max budget: 1000.0",
"type":"budget_exceeded", ...}}
```

That 400 was thrown out of `Provider.state()` lazy init. Downstream the
`/config/providers` route 500-ed and the overlay Settings panel (agent
selector + model picker) lost **every** provider — operator had no way
to switch keys or disable hexin.

Root cause located in two places:

1. `packages/opencorvus/src/provider/hexin-discovery.ts` — top-of-file
   doc claimed "force-fetch failure with cache present returns cached
   IDs with a warning" but the implementation (`discoverHexinModels`
   force branch) just `await fetchModelIDs(apiKey)` and rethrows.
2. `packages/opencorvus/src/provider/provider.ts:369-380` — startup
   `await discoverHexinModels({ force: true, apiKey: key })` is a bare
   `await` with no try/catch, so a single hexin upstream outage rejects
   the whole `state()` promise.

## Fix approach (what to audit)

Rule alignment:
- **rule 7 (no fallback)** — NOT applicable. The split here is fault
  isolation across two distinct providers, not double-source business
  fallback. Audit: confirm I haven't smuggled in a same-provider
  fallback (e.g. stale cache silently masking a real failure that the
  user must see).
- **rule 8 (single source)** — confirm `discoverHexinModels` and
  `discoverHexinModelsForStartup` are not double-sources for the same
  responsibility. Intended split: refresh = user-initiated, hard-fail.
  startup = system-init, soft-fail.
- **rule 11 (intercept misuse)** — fault isolation lives at the
  state() boundary, not inside individual providers. Audit: any other
  provider whose startup discovery could similarly poison state()?
  (env loop, alibaba-cn embedded key, Auth.all loop, plugin loop,
  CUSTOM_LOADERS loop). Are any of these still bare `await`?
- **rule 13 (no state machine)** — confirm `source: "live" | "cache"
  | "empty"` is descriptive metadata, not a state machine driving
  behavior elsewhere.
- **rule 17 (no dead code / no stale comments)** — confirm the
  rewritten top-of-file doc accurately reflects the new contract;
  confirm the OLD `discoverHexinModels({ force })` path is still
  reachable from `refreshHexinCache` and is not dead.
- **rule 28/36 (every change tested)** — verify the 6 new tests
  collectively cover: live success, live-fail-cache-fallback, live-
  fail-no-cache, no-key-no-cache, no-key-cache, refresh hard-fail
  regression. Anything missing?

Specific points to challenge:

a. **Database-side registration vs connected-list visibility.** State()
   has a pre-existing zero-models filter at line ~627 that deletes a
   provider from `providers` when `Object.keys(provider.models).length
   === 0`. After the fix, hexin with no live + no cache lands here and
   gets filtered from `/config/providers` (Provider.list). It DOES stay
   in `Provider.database()` so `/provider` (catalog) still shows it.
   Audit: is that the right UX? Should the Settings UI's
   `config/providers` payload also expose hexin with `error`/`status`
   metadata so the user sees *why* it's gone, not just notice it
   silently missing? Or is the catalog route enough for refresh-button
   reachability?

b. **Error propagation surface.** `StartupDiscoveryOutcome.error` is
   currently only logged via `log.warn`. The overlay has no API path
   to fetch this — UI just sees "0 models" with no cause. Should we
   add the error to `Provider.Info` so it bubbles to /config/providers?
   That would be a contract / Zod schema change — out of scope or
   in scope?

c. **Other providers with similar liveness checks.** Grep for `await`
   patterns in state() that hit network during init. Anything else
   prone to the same poison-the-well effect?

d. **Test cleanup.** The afterEach removes the cache file and resets
   `process.env.HEXIN_API_KEY`. The new tests set `delete
   process.env.HEXIN_API_KEY` mid-test. Is the beforeEach/afterEach
   pair tight enough that tests don't pollute each other? (The full
   provider suite previously had 87 baseline failures — 34 of those
   were cascade-fails from this very bug, now passing — but 53 remain
   that I treated as pre-existing/out-of-scope. Spot-check: are any of
   those 53 actually caused by this PR?)

e. **CLI / refresh route paths.** `routes/provider.ts:55` calls
   `Provider.list()`. `routes/provider.ts:152` calls
   `Provider.refreshHexin()`. `cli/cmd/models.ts:37` calls
   `Provider.list()`. None of these were modified. Confirm none
   needed to change semantics-wise (e.g. they don't assume
   `Provider.list()` throws on hexin failure).

## Diff

`git diff feat/architect-contract-audit-coverage..fix/hexin-discovery-fault-isolation -- packages/opencorvus/`

Files:
- packages/opencorvus/src/provider/hexin-discovery.ts (+98 / -8)
- packages/opencorvus/src/provider/provider.ts (+18 / -3)
- packages/opencorvus/test/provider/hexin-discovery.test.ts (+138 / -10)

## Deliverables I want from this review

1. Verdict: **ship / block / iterate**.
2. If iterate: list of concrete must-fix items with file:line + rule#.
3. Any missed call-site (rule 35).
4. Any rule violation I'm blind to.

Please be ruthlessly direct. The current branch is already pushed and
will be PR'd into the feature branch (then to dev) only after your
verdict.
