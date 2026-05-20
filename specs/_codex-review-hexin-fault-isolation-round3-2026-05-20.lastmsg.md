No blocking findings.

The Env-isolation bypass is closed for executable code. `discoverHexinModels({ force: true })` now uses only `opts.apiKey?.trim()` and throws `HEXIN_API_KEY unset` when absent; `refreshHexinCache()` just forwards that explicit key. `Provider.refreshHexin()` still resolves through `hexinApiKey(cfg)`, which uses `Env.get("HEXIN_API_KEY")`, config, then auth, and no longer has a downstream raw-env escape hatch.

Literal note: `process.env` still appears in [hexin-discovery.ts](/C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/src/provider/hexin-discovery.ts:14) comments, not as an executable read. Production search found no `process.env.HEXIN_API_KEY` use in the Hexin provider path; only tests mutate it.

Verdict: **ship**.

One non-blocking cleanup: [hexin-discovery.test.ts](/C:/Users/chuan/myhexin-local/opecorvus/packages/opencorvus/test/provider/hexin-discovery.test.ts:346) still says “user-initiated `discoverHexinModels` still does” read `process.env`; that comment is stale after this fix. I would update it, but it is not a merge blocker.

I did not rerun Bun tests in this read-only review environment. Static diff inspection and `git diff --check cf9728241..ce1ce0efc` were clean.