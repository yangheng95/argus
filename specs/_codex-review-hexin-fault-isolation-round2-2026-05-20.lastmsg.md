**Verdict: iterate.**

Finding:

1. [provider.ts](/C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/provider.ts:653) still lets the UI/Provider refresh path bypass per-instance `Env` isolation. `Provider.refreshHexin()` resolves the canonical key via `hexinApiKey(cfg)`, but then passes it to [refreshHexinCache](/C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:194), which reaches [discoverHexinModels](/C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:173). If `hexinApiKey(cfg)` returns `""` because `Env.remove("HEXIN_API_KEY")` masked the instance env and no config/auth key exists, `discoverHexinModels()` falls through to raw `process.env.HEXIN_API_KEY`. That contradicts the round-2 claim that the env fallback is only for direct unit/CLI callers outside Instance scope. Add the same regression shape for `Provider.refreshHexin()` and make the provider-layer refresh fail with `HEXIN_API_KEY unset` before calling the direct helper, or split the direct helper API so provider callers cannot trigger raw env fallback by passing an empty key.

Round-1 items:

- Item 1 startup helper: resolved for `discoverHexinModelsForStartup`; it no longer reads `process.env`, and the new startup tests cover the requested leak shape.
- Item 2 doc overclaim: resolved; the comments now correctly say this is log metadata, not a `Provider.Info` UI contract.
- Item 3 deferred: acceptable as a documented follow-up. The follow-up captures `plugin.auth.loader`, `CUSTOM_LOADERS`, the Cloudflare concrete throw, and acceptance criteria.

I did not rerun the Bun suite in this read-only review environment. I did run static diff inspection and `git diff --check` for the touched files; no whitespace/check issues surfaced.

Ship status: **iterate**, not ready to merge until the refresh-path credential bypass is closed or explicitly accepted as in-scope behavior.