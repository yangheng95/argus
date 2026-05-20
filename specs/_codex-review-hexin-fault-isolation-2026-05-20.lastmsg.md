**Verdict: iterate.**

Blocker:

1. [hexin-discovery.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:228) violates rule 8 / single source. `Provider.state()` already resolves the canonical Hexin key via [provider.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/provider.ts:133) and passes it at [provider.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/provider.ts:376), but `discoverHexinModelsForStartup()` then re-reads `process.env.HEXIN_API_KEY`. That bypasses `Env`’s per-instance isolation ([env/index.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/env/index.ts:5)) and creates a second credential source. Fix: startup helper should trust only `opts.apiKey`; keep raw env fallback only in the explicit/direct refresh helper if you need unit-call ergonomics. Add a regression where `process.env.HEXIN_API_KEY` is set, `Env.remove("HEXIN_API_KEY")` runs inside `Instance.provide`, no config/auth key exists, and startup discovery must not fetch live.

Must-fix cleanup:

2. [hexin-discovery.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:22), [hexin-discovery.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:187), and [hexin-discovery.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:218) overclaim that the UI can surface/nudge based on `source/error`. It cannot: `Provider.Info` has no such field, `/config/providers` only returns `Provider.Info`, and `Provider.state()` only logs. Either remove the UI claim from comments or actually add a schema/API contract. I would not add the contract in this PR unless UX explicitly requires it.

Missed call-site / residual risk:

- [provider.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/provider.ts:560) `plugin.auth.loader(...)` and [provider.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/provider.ts:573) `CUSTOM_LOADERS` are still bare awaits inside `state()`. Concrete current example: [vendor.ts](C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/vendor.ts:406) throws for partially configured `cloudflare-ai-gateway`, which can still poison global provider state. Not Hexin-specific, but it is the same boundary-class risk.

Non-blocking answers:

- The refresh path is still hard-fail: `refreshHexinCache()` reaches `discoverHexinModels({ force: true })`, so stale cache is not silently masking user-initiated refresh failures.
- `source: "live" | "cache" | "empty"` is metadata only; I found no behavior driven elsewhere.
- `/provider` catalog reachability is enough for the original outage fix. Adding Hexin error/status to `/config/providers` is a larger UI/API contract change.
- Test cleanup looks mostly tight for cache, `process.env`, `fetch`, and per-test Auth restoration, but it misses the per-instance `Env` bypass case above.
- CLI/routes do not need semantic changes for this PR: `/hexin/refresh` already catches hard refresh errors, and `Provider.list()` callers benefit from the state fix.

I did not run the suite in this session because the environment is read-only; this is a static review plus diff/call-site audit.