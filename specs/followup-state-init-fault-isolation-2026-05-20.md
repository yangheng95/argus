# Follow-up — Generalize fault isolation across Provider.state() loaders

**Status**: open, not scheduled
**Triggered by**: codex review of `fix/hexin-discovery-fault-isolation` (2026-05-20)
**Owner**: TBD

## Scope (one PR)

`Provider.state()` lazy init in `packages/opencorvus/src/provider/provider.ts`
currently has **three** classes of bare `await` against external sources that
can each individually reject the global provider state:

1. **Hexin live discovery** — `provider.ts:369-380`
   → Fixed in `fix/hexin-discovery-fault-isolation`
   (`discoverHexinModelsForStartup` returns soft-fail outcome instead of
   throwing).

2. **Plugin auth loaders** — `provider.ts:560`
   ```ts
   const options = await plugin.auth.loader(
     () => Auth.get(providerID) as any,
     database[plugin.auth.provider],
   )
   ```
   Any plugin whose `auth.loader` throws (bad credentials shape, transient
   I/O during options computation, etc.) rejects state().

3. **Built-in CUSTOM_LOADERS** — `provider.ts:573`
   ```ts
   const result = await fn(data)
   ```
   Concrete current failure: `vendor.ts:406` throws when the operator has
   partially configured `cloudflare-ai-gateway` (`CF_AIG_ACCOUNT_ID` /
   `CF_AIG_GATEWAY` set but token missing):
   ```ts
   throw new Error(
     "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. ...",
   )
   ```
   Reproduces the **exact same outage shape** as the hexin bug — global
   `/config/providers` 500 + Settings UI loses every other provider.
   Other custom loaders not yet audited but pattern-equal.

## Why not in the hexin PR

- PR scope is "hexin /models budget_exceeded must not blank the UI"; the
  failing task (`tsk_e43c7c6d3001L8MC4eHaBOp67N`) is hexin-specific.
- Generalization needs its own design: do we per-provider try/catch with
  a uniform `LoaderOutcome` (mirror of `StartupDiscoveryOutcome`), or a
  one-line `safeAwait(name, fn)` wrapper around every state-init segment?
  Either way the test matrix grows — every loader needs a fault-injection
  test.
- Mixing the two would invalidate the focused review and bloat the diff.

## Proposed shape (preview, not committed)

Single helper at the top of `state()`:

```ts
async function loadOrSkip<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ value: T } | { skipped: true; error: Error }> {
  try {
    return { value: await fn() }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    log.warn(`provider loader '${name}' failed — skipping`, { error: error.message })
    return { skipped: true, error }
  }
}
```

Wrap each of the three call-sites; on skip, leave the provider registered
in `database` (so the catalog stays reachable) without merging its
`source`/`options`/`key` patch.

## Acceptance

- Provider.list() resolves regardless of which single loader throws.
- `/config/providers` returns 200 even when cloudflare-ai-gateway /
  alibaba-cn / hexin / any one loader fails.
- A per-loader fault-injection test asserts: (i) Provider.list resolves,
  (ii) the failing provider is absent from connected, (iii) other
  providers register as usual.
- No new fallback within the same provider (rule 7) — soft-fail only at
  the cross-provider boundary.

## Out of scope

- Adding an `error` / `status` field to `Provider.Info` (would require a
  Zod schema change + SDK regeneration + overlay UI work). Decided
  during the hexin PR review to defer; the catalog route is the recovery
  path until UX explicitly asks for in-list error surfacing.
