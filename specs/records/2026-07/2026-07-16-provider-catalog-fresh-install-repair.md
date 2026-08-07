# Provider catalog fresh-install repair

## Recall

### User request

- Investigate why OpenCorvus on this machine cannot load providers, then fix the root cause.
- Preserve the repository rules: no fallback, no double source, no process restart without authorization, tests for every behavior change, second review, and push the finished change to the legacy remote.

### Acceptance criteria

1. A fresh default OpenCorvus home loads a nonempty provider catalog without network access or prior user configuration.
2. The default canonical catalog survives versioned cache cleanup.
3. `OPENCORVUS_MODELS_PATH` remains an explicit single-file override: missing or invalid override files fail loudly and never consult the bundled bootstrap.
4. Existing default catalog bytes are never replaced by bootstrap provisioning; explicit refresh remains the only network update path.
5. Catalog replacement and first-install creation are atomic.
6. Project and global provider routes return discoverable providers even when `connected` is empty.
7. The compiled native artifact proves the same fresh-install behavior, and the Overlay Providers surface is visually inspected from a real isolated backend.

### Hard constraints

- Do not add a runtime read fallback, implicit registry fetch, compatibility alias, gate, state machine, or installer-specific catalog copy path.
- Keep one runtime catalog file. A bundled bootstrap asset may only provision a missing default canonical file; runtime reads and refreshes continue through that canonical file.
- Do not restart, close, refresh, or otherwise interfere with an existing OpenCorvus/overlay process. Use an isolated service for runtime verification.
- Do not modify or commit the pre-existing untracked `packages/overlay/dist-artifacts/darwin-arm64/` tree.
- Commit subjects must start with `dsw-33987`; pushes go to `legacy-remote/v0.0.7beta` without bypassing hooks.

### Sources read

- `packages/opencorvus/src/provider/models.ts`
- `packages/opencorvus/src/provider/provider.ts`
- `packages/opencorvus/src/provider/hexin-discovery.ts`
- `packages/opencorvus/src/global/index.ts`
- `packages/opencorvus/src/util/filesystem.ts`
- `packages/opencorvus/src/server/routes/{provider,global}.ts`
- `packages/overlay/src/services/config-load.ts`
- `packages/overlay/src/components/settings/ProvidersPanel.tsx`
- `packages/opencorvus/script/{build,build.local}.ts`
- `script/package-{native,linux}-binary.ts`
- `packages/opencorvus/script/postinstall.mjs`
- `packages/vscode-extension/script/package-vsix.ts`
- `packages/overlay/src-tauri/{build.rs,src/main.rs}`
- `packages/opencorvus/test/preload.ts`
- provider, filesystem, packaging, benchmark, document-health, and route tests named by the repository searches below
- `specs/current/architecture/06-provider.md` and the English/Chinese model documentation
- Local evidence: `~/.local/share/opencorvus/log/dev.log`, `~/.cache/opencorvus/version`, the missing `~/.cache/opencorvus/models.json`, installed embedded-sidecar contents, and current process/listener state.

### Whole-repository search evidence

The following searches were run before implementation:

```bash
rg -n --hidden -S "models-api\\.json|ModelsDev\\.get\\(|ModelsDev\\.refresh\\(|ModelsDev\\.catalogPath\\(|refreshHexinProvider\\(|OPENCORVUS_MODELS_PATH|models\\.json" packages/opencorvus packages/overlay packages/vscode-extension script install specs docs
rg -n --hidden -S "requiredNativeBundleFiles|writeOverlayPayloadStamp|embedded sidecar|postinstall|package-vsix" packages script
rg -n "writeAtomic|flag: ['\"]wx|O_EXCL|exclusive" packages/opencorvus/src packages/opencorvus/test
```

Direct catalog consumers are `Provider.buildState`, CLI auth/GitHub/model commands, Hexin discovery, project/global provider routes, provider/config routes, and benchmark setup. The complete tracked catalog asset has only four test consumers: global test preload, read/truncation tool tests, and document health. Packaging consumers include native/Linux bundles, Tauri, npm postinstall, and VSIX; because npm and VSIX copy only the executable, a sibling-resource design would create multiple installer implementations and remain incomplete.

### Independent agent feedback

- Packaging audit: every formal delivery surface omitted `models.json`; embedding the bootstrap in the compiled executable is the only design that covers CLI, Linux, Tauri, npm, and VSIX without installer-specific path logic.
- Runtime audit: the default catalog was under versioned cache cleanup, every provider state build depends on it, and test preload always supplied a fixture outside that lifecycle. Move the canonical file to durable data storage, compile one production bootstrap asset, provision only a missing default file, keep invalid/missing explicit overrides fail-fast, and make writes genuinely atomic.
- Both audits rejected swallowing `ENOENT`, returning an empty catalog, implicit network refresh, or reading a bundled snapshot as a second runtime source.

### Codex review feedback

The post-implementation reviewer found that the first draft captured `Global.Path.data` at module import time, while the project contract resolves `OPENCORVUS_HOME` lazily. It also found that source probes and a manual compiled-artifact run did not make executable embedding a permanent regression check, and that invalid-directory/invalid-override cases were not fully enumerated. The implementation was revised to resolve the default catalog path inside `catalogPath()`, add an import-before-home-selection test, extend the existing packaged overlay-server health test to verify the embedded bootstrap and durable file, sanitize inherited catalog/config overrides in that child process, and cover default directories plus malformed, schema-invalid, and incomplete explicit files.

## Root cause

`ModelsDev` treated `$GLOBAL_CACHE/models.json` as a required canonical file while `Global` deletes every cache entry on cache-version change. Normal startup intentionally performs no registry refresh. The formal packages did not provision the file, and tests pre-created an override fixture, so a fresh installation reached `Provider.buildState()` with no catalog and failed before either provider route could respond.

## Design

1. Move the existing complete models.dev fixture to a production-owned bootstrap JSON asset; do not retain a test copy.
2. Compile that asset as text into every executable.
3. Move the default canonical path from versioned cache to durable `Global.Path.data/models.json`.
4. Before the first default read only, validate the embedded remote catalog, add the three required local providers through `withLocalProviders`, validate the final catalog, and atomically create the canonical file if absent. If another process wins creation, read its file. Never overwrite an existing file.
5. Keep explicit `OPENCORVUS_MODELS_PATH` outside provisioning. Missing, unreadable, malformed, schema-invalid, or incomplete explicit files continue to fail.
6. Use atomic replacement for explicit registry and Hexin refresh writes.
7. Remove benchmark/test setup that manufactures a separate catalog when it is testing ordinary default startup.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `ModelsDev.get`, `catalogPath`, `refresh`, `refreshHexinProvider` | Replace default path and add single bootstrap provisioning/atomic writes. |
| `Provider.buildState`, CLI auth/GitHub/models, Hexin discovery | Preserve; they continue consuming `ModelsDev` only. |
| `/provider`, `/global/providers`, config/provider routes | Preserve; add real fresh-home route regression without Provider mocks. |
| `Global` cache cleanup | Preserve; the canonical file moves outside its ownership. |
| Test preload and tool/document-health fixture reads | Replace the test-only fixture path with the production bootstrap asset. |
| Mission benchmark | Remove manual cache catalog creation and exercise ordinary bootstrap provisioning. |
| Native/Linux/Tauri/npm/VSIX packagers | Preserve single executable flow; validate compiled-artifact behavior rather than adding resource-copy branches. |
| Public/current architecture docs | Replace cache/missing-file language with durable canonical and offline first-install provisioning semantics. |

## Verification plan

- Focused filesystem and provider bootstrap tests, including concurrent create, existing/invalid preservation, override failures, network prohibition, and cache cleanup.
- Real global/project provider route tests with a fresh isolated home and no auth.
- Provider refresh/Hexin atomic replacement tests.
- Typecheck, API route check, docs checks, historical/spec health checks, and affected packaging tests.
- Build a host-native overlay-server artifact, launch it against an isolated home and port, request real provider endpoints, then use Playwright through Node against the isolated UI and inspect the screenshot.
- Independent diff review before commit; fetch/merge latest legacy remote immediately before the final push.

## Status

Implementation and verification complete.

- Focused provider/filesystem/route/benchmark/tool regression: 157 tests passed.
- Packaging/build regression: 74 tests passed.
- Compiled packaged overlay-server bootstrap/health/UI regression: 1 test with 53 assertions passed.
- Historical links, document health, and product documentation single-source checks: 79 tests passed.
- `api:routes-check`, `docs:check`, and the OpenCorvus TypeScript check passed.
- A host-native `opencorvus-overlay-server-darwin-arm64` artifact was built and launched with an isolated fresh `OPENCORVUS_HOME`. It created `data/models.json` with mode `0600`; real global and project routes each returned 87 providers including `anthropic`, `openai`, `hexin`, `opencorvus`, and `kilo`.
- The isolated Overlay was opened through the real embedded UI, bound to a real isolated project task, and visually inspected. The Providers panel rendered `87 Catalog`, `87 / 87 shown`, provider rows, search, refresh, and add controls without layout defects. Evidence: `.scratch/provider-catalog-acceptance/providers-page.png`.
