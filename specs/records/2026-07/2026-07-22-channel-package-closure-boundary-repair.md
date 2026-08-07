# Channel package closure boundary repair

## Recall

### User request

- Preserve the requested broader channel support.
- Correct the architecture that copied the complete OpenClaw runtime and recursive dependency tree into every OpenCorvus GUI installer.
- Rebuild the native GUI installer after the correction.

### Acceptance

- The 27-entry `ChannelCatalog` remains the only channel identity, field, documentation, and implementation-provenance source.
- All 14 package-backed channel entries remain loadable through one OpenCorvus `ChannelAdapter` boundary.
- The packaged Browser MCP (Model Context Protocol) Node runtime contains one statically bundled channel sidecar and does not contain a copied `node_modules/openclaw` tree or copied `@openclaw/*` package directories.
- Development and packaged execution use the same statically closed sidecar bundle; there is no source-only dynamic package path, packaged fallback, runtime package discovery, or second channel catalog.
- The native package contract rejects a copied OpenClaw runtime and requires the bundled sidecar.
- The original channel runtime tests, package tests, typecheck, documentation health checks, and native GUI installer matrix pass.
- The final macOS ARM64 DMG (Disk Image) is checksum-valid, signed, and materially smaller than the pre-repair 274 MB artifact.

### Hard constraints

- Do not remove the newly exposed channels merely to reduce size.
- Do not reimplement fourteen provider protocols when mature official channel packages already exist.
- Do not keep a development/production dual source or load packages dynamically from the installed filesystem.
- Do not add a gate, fallback, compatibility alias, hidden package installer, or another active channel field.
- Do not restart or otherwise interfere with a running OpenCorvus/Overlay process.
- Preserve unrelated untracked `.DS_Store` files and all parallel work.

### Baseline and observed evidence

- Branch/remote baseline: `v0.0.14beta` and `legacy-remote/v0.0.14beta` both resolve to `ee60b90c76114198d11dd8dd369bb4a4165101c9`.
- The pre-repair macOS ARM64 GUI matrix passes, producing a 274 MB DMG and a 295 MB App whose only material file is the 295 MB executable.
- `build.rs` embeds `embedded_sidecar.tar.gz` byte-for-byte into the Tauri executable.
- The current sidecar source tree is 1.1 GB; `browser-mcp-node` is 915 MB. The resulting embedded gzip archive is 263 MB.
- The last pre-OpenClaw embedded archive is 137 MB. Commit `0b45837f3` added root `openclaw`, every catalog-selected `@openclaw/*` package, a pinned Node runtime, and recursive package materialization.
- Static Bun probes show the channel package implementation closures are bounded: the twelve separately published package entries each bundle to about 0.6 MB; the root-distributed iMessage entry is about 0.6 MB; Reef is about 49 MB. The 915 MB filesystem tree is therefore not required to execute those closures.

### Architecture records read

- `specs/current/architecture/03-control.md`: OpenCorvus owns the channel ingress, binding, control, and task-session message lifecycle.
- `specs/current/architecture/04-extensions.md`: extension provenance does not transfer core runtime ownership to the extension supplier.
- `specs/current/architecture/99-principles.md`: single source, no fallback, and no superficial rollback.
- `specs/records/2026-07/2026-07-21-openclaw-channel-parity.md`: the original requirement was to reuse mature official provider implementations, not to independently rewrite protocols. Its packaging decision to materialize the complete official module graph is superseded by this record.

### Whole-repository grep results

The audit covered every case-insensitive `openclaw` reference outside generated SDK/payload files and the lockfile.

| Surface                            | Call sites                                                                                                                                                              | Disposition                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog identity/provenance        | `packages/channel-config/src/index.ts`                                                                                                                                  | Preserve the 27-entry catalog and package provenance; replace the exported runtime-package materialization list with the package-backed channel identity projection used by closure tests.                                             |
| Package declarations               | `packages/channel-runtime/package.json`, root lockfile                                                                                                                  | Keep exact build-time provider packages and root plugin SDK dependency; remove the pinned standalone Node package only if no other packaged Node consumer requires it. The installed artifact must not copy these package directories. |
| Runtime host                       | `packages/channel-runtime/src/openclaw-adapter.ts`, `openclaw-sidecar.ts`, `registry.ts`, `index.ts`                                                                    | Preserve one generic adapter and OpenCorvus message ownership. Replace filesystem/dynamic entry discovery with one exhaustive static loader map whose key equality is tested against the catalog.                                      |
| Bundle construction                | `packages/channel-runtime/src/openclaw-build.ts`                                                                                                                        | Bundle provider closures into the sidecar; remove externalization of the root/package set and reject any remaining non-built-in package import in the emitted sidecar.                                                                 |
| Native artifact construction       | `packages/opencorvus/script/build.ts`, `build.local.ts`, `build-artifact.ts`, `script/package-native-binary.ts`                                                         | Delete OpenClaw package-tree copying. Keep the existing shared Node sidecar executable only because Browser MCP already owns it independently of channels.                                                                             |
| Package contracts/tests            | `packages/opencorvus/test/script/build-artifact.test.ts`, `package-native-binary.test.ts`, `packages/channel-runtime/test/openclaw-adapter.test.ts`, `registry.test.ts` | Replace assertions requiring copied OpenClaw packages with assertions forbidding them; test static loader/catalog equality and real Node import of every bundled entry.                                                                |
| Configuration/UI/docs              | `.env.example`, channel runtime env, Overlay Channels panel/tests, English/Chinese channel docs                                                                         | Preserve channel configuration and honest implementation credit. Remove wording that claims a separately materialized OpenClaw runtime when encountered; no UI layout change is planned.                                               |
| Unrelated OpenClaw-shaped metadata | Multica import, Skill tests/routes, historical specs                                                                                                                    | Preserve. These references describe external Multica backends, ignored Skill metadata, or immutable history and do not participate in channel packaging.                                                                               |

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unsolicited delegation.
- The primary agent will perform a separate full-diff and artifact-content review after implementation.

## Implementation plan

1. Add an exhaustive static entry-loader module for the 14 package-backed channels. It is an executable factory projection, not an identity catalog; a test requires its keys to equal the catalog's package-backed IDs.
2. Make the source and packaged sidecar use the same Bun bundle with provider dependencies included. Preserve only Node built-ins as runtime imports and fail the build when a non-built-in external import remains.
3. Delete recursive OpenClaw package copying from native artifact builders and delete the associated package-list API/tests.
4. Update channel/runtime and native-package tests to prove all entries load from the closed bundle and copied package trees are absent.
5. Run targeted tests, full typecheck and documentation health, then the original GUI installer matrix. Inspect archive contents, hashes, architecture, signature, DMG validity, and measured size.
6. Perform a second source/artifact review, update this record with results, commit with the required `dsw-33987` prefix, and push `v0.0.14beta` to `legacy-remote` without bypassing hooks.

## Delivery evidence

- The runtime bridge now statically binds all 14 catalog-selected provider entry contracts and embeds only their official package metadata. Node execution loads every entry and returns matching provider IDs.
- The sidecar `init` command now performs real provider/runtime initialization, and its command loop processes input sequentially instead of allowing `stop` to race ahead of `init`.
- `build.ts` and `build.local.ts` no longer copy `openclaw` or any `@openclaw/*` package tree. The native artifact contract requires only `openclaw-channel.mjs` for channel execution.
- The emitted static channel bundle is 32,858,872 bytes. The packaged Browser MCP runtime contains neither `node_modules/openclaw` nor `node_modules/@openclaw`.
- The current embedded sidecar archive is 156,749,735 bytes, down from the 276,073,552-byte pre-repair archive. The resulting DMG is 166,012,337 bytes (`du`: 158 MB), down from the reported 274 MB artifact.
- `codesign --verify --deep --strict` accepts the bundled App. `hdiutil verify` reports a valid DMG checksum. SHA-256 for the DMG is `be48bc06662a12d16ca302d7903438e32eb60a2e140bf70f1f8ad701b422b454`.
- The GUI installer matrix packages `darwin-arm64`; Linux x64/ARM64, macOS x64, and Windows x64 are explicitly skipped because this host is not their native runner.
- Verification passed: 6 channel-host tests, 49 build-artifact tests, 7 native-package tests, repository typecheck, 21 historical-document tests, 61 document-health tests, and `docs:check`.

## Runtime completion correction (2026-07-22)

### Recall

#### User requirement

- Continue and finish the Channel Runtime refactor; preserving provider protocols is not permission to embed the OpenClaw application runtime under another filename.
- Do not build an installer in this continuation.
- Preserve every parallel worktree change.

#### Corrected acceptance

- OpenCorvus owns the provider runtime object, configuration mutation, state persistence, ingress-to-`IncomingMessage` projection, and sidecar lifecycle.
- No Channel Runtime source imports `openclaw/dist/**`, scans hashed OpenClaw output filenames, parses provider source with regular expressions, or calls the private `createPluginRuntime` factory.
- Published provider implementations may use the documented `openclaw/plugin-sdk/*` contract, but the OpenClaw application runtime is not copied or bundled.
- Provider entry binding is an explicit exhaustive projection checked against the `ChannelCatalog`; it is not inferred from compiled source text.
- A channel without a stable distributable provider entry is not represented as production-ready through a private root-runtime path.
- Tests cover the OpenCorvus-owned runtime surface, durable keyed state, provider initialization, gateway lifecycle, ingress, outbound text/media, and bundle imports. Installer packaging is intentionally excluded by the user's instruction.

#### Hard constraints

- One runtime and one ingress path only; no compatibility runtime, dynamic filesystem discovery, fallback, gate, or second catalog.
- Keep mature provider protocol implementations instead of copying their protocol code into OpenCorvus.
- Do not restart or otherwise interfere with an active OpenCorvus/Overlay process.
- Do not stage, rewrite, or commit the concurrent Expert Squad, SDK, orchestration, or evidence-contract changes visible in the worktree.

#### Records and evidence read

- Re-read this record and `specs/current/architecture/03-control.md`, `04-extensions.md`, and `99-principles.md`.
- Inspected `openclaw-build.ts`, `openclaw-adapter.ts`, `openclaw-sidecar.ts`, registry/catalog projections, package manifests, all provider entry contracts, and the public plugin SDK declaration surfaces.
- The previous 32,858,872-byte sidecar was not evidence of a completed boundary: it still imported private `openclaw/dist/plugins/runtime/index.js`, located a mangled `plugin-state-store-*.js` export, and rewrote other hashed internal modules.

#### Whole-repository and provider-closure grep

| Surface | Complete observed use | Disposition |
| --- | --- | --- |
| Provider binding | 12 published `@openclaw/*` runtime-extension packages; root-internal `imessage` and `reef` entries | Bind published entries explicitly; remove private root-runtime binding from the ready runtime projection. |
| Root runtime | `version`, `config.current/mutate/replace`, `state.openKeyedStore/openSyncKeyedStore`, optional QQBot TTS | Implement version/config/state in OpenCorvus; keep optional capabilities explicit rather than importing the OpenClaw application host. |
| Channel text | markdown/text chunking, table conversion/mode | Use documented plugin SDK primitives. |
| Channel routing | agent route and session-key projection | Use documented routing primitives with OpenCorvus-supplied config. |
| Channel ingress/reply | build/finalize envelopes, run/dispatch, buffered dispatch | Keep provider normalization helpers where required; terminate dispatch at the single OpenCorvus `IncomingMessage` emitter instead of running an OpenClaw agent. |
| Channel session/activity/pairing | store path/timestamps/recording, activity, allow-list/pairing | Use documented SDK primitives only where they are provider-facing data helpers; persist provider-owned keyed state beneath the project Channel Runtime directory. |
| Runtime contexts | QQBot registration | Implement the documented registry contract in the OpenCorvus runtime. |
| Build | virtual bridge, hashed catalog/session rewrites, private state-store scan | Replace with an explicit entry projection and ordinary bundle build; reject private `openclaw/dist` inputs and non-Node external imports. |

#### Independent-agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unsolicited delegation.
- The primary agent will perform a separate post-implementation source and diff review.

### Corrected implementation plan

1. Replace the generated private runtime bridge with an explicit provider-entry projection and a typed OpenCorvus runtime factory.
2. Implement project-scoped keyed provider state and runtime-context registration in OpenCorvus.
3. Route provider inbound contexts directly into the existing `ChannelAdapter` message handler and keep official SDK helpers only for provider-facing normalization.
4. Remove root-private provider entries from the ready projection unless they become stable packages; synchronize catalog/registry/tests so readiness has one honest meaning.
5. Add regression tests and run targeted tests, typecheck, source-boundary grep, documentation health, and a second diff review; do not package.

## Thin-wrapper scope decision (2026-07-22)

The user further constrained the repair: only a thin wrapper is acceptable; integrations that require a large runtime reconstruction must be discarded.

Runtime probes proved that the published provider objects are not standalone protocol adapters. During ordinary plugin initialization they require OpenClaw's global channel catalog; QQBot additionally imports agent, text-to-speech, session, and tool runtime surfaces. A correct emulation would therefore be a second OpenClaw application runtime, not a thin OpenCorvus wrapper.

The implementation plan above is superseded as follows:

1. Delete the OpenClaw sidecar, bundle builder, generated bridge, provider-runtime emulation, and their package dependencies.
2. Remove the sidecar from native artifact construction and contracts.
3. Mark all fourteen application-runtime-dependent identities `planned`; preserve their configuration/provenance metadata for discovery, but never register them as ready adapters.
4. Keep the thirteen existing native adapters as the only ready runtime projection.
5. A planned identity may become ready only after its provider exposes a thin standalone lifecycle, ingress, and outbound contract. No application-runtime embedding or compatibility emulation is permitted.

### Thin-wrapper delivery evidence

- Deleted the OpenClaw adapter host, sidecar, bundle builder, virtual bridge declaration, and provider-host tests: 1,416 net lines of runtime/bundle compatibility code were removed in this repair.
- Removed all direct `openclaw` and `@openclaw/*` dependencies from `@opencorvus-ai/channel-runtime` and removed `openclaw-channel.mjs` from build and package contracts.
- `READY_CHANNELS` now contains only the 13 native adapters. The 14 provider candidates are the exhaustive `PLANNED_CHANNELS` projection.
- Channel registration and supervisor launch both skip planned providers. The control-plane registry exposes them as `runtime_status: unavailable` with the catalog reason, even when credentials are configured.
- Packaging sources and tests assert that no OpenClaw sidecar or application-runtime dependency can return. No installer was built, per the user's instruction.
- Verification passed: repository typecheck; 116 Channel Runtime tests; 75 targeted registry/supervisor/build/package tests; 82 historical/document-health tests; and `docs:check` (287 operations, 23 groups).
- A generated sidecar cache from the superseded test path was moved to macOS Trash at `/Users/yangheng/.Trash/opencorvus-openclaw-channel-cache-20260722`; it is recoverable and is no longer part of repository scans.
