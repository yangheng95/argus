# OpenClaw channel parity and plugin-runtime reuse

## Recall

### User request

- Investigate the current OpenClaw channel implementation.
- Report how many channels OpenClaw has added beyond OpenCorvus and whether the architecture changed.
- In a new worktree, integrate every OpenClaw repository channel that OpenCorvus does not support.
- Reuse OpenClaw's implementation as far as possible; do not independently reimplement each provider protocol.

### Acceptance

- The investigation is pinned to an exact OpenClaw source revision and distinguishes production channels from fixtures, UI-only surfaces, telephony tools, and externally hosted plugins.
- Every production channel manifest present in that revision has one OpenCorvus catalog identity and a runnable adapter implementation; the synthetic `qa-channel` is not exposed.
- The existing hand-written `qq` identity is replaced by OpenClaw's canonical `qqbot` identity and implementation. OpenCorvus-specific WeCom and DingTalk support remains.
- Configuration, runtime construction, status/catalog APIs, Overlay configuration, and documentation project from one shared channel catalog rather than acquiring another hand-maintained channel list.
- Official published OpenClaw packages are the implementation source. The root OpenClaw runtime package supplies its own bundled iMessage and Reef entries; OpenCorvus does not copy or rewrite either provider protocol.
- Invalid or incomplete channel configuration fails closed. No fallback transport, compatibility alias, or hidden message path is added.
- Unit tests cover catalog membership, official-plugin loading, runtime bridging, configuration failures, inbound projection, outbound delivery, and removal of the old `qq` automatic path.
- The real Channels settings page is rendered and inspected in an isolated process; screenshots must show the newly supported catalog and usable configuration forms.
- Documentation health, typecheck, route checks, targeted channel suites, and the original relevant acceptance commands pass before delivery.
- Changes are committed with the `dsw-33987` prefix, merged into the current delivery branch, and pushed to `legacy-remote` without bypassing hooks.

### Hard constraints

- The work happens in the user-authorized worktree `D:\yerui\code\opencorvus\opencorvus-openclaw-channels` on `codex/openclaw-channel-parity`; the original dirty worktree is not modified.
- OpenCorvus/Overlay processes already running for the user are not stopped, refreshed, or reused for testing.
- No host-side workflow gate, state machine, compatibility fallback, second catalog, or channel-specific synthetic conversation message is introduced.
- Playwright is launched with Node on Windows.
- Existing strict attachment, channel-link, session, and delivery-evidence contracts remain authoritative.
- Terms used below: API means Application Programming Interface; CLI means Command-Line Interface; DM means Direct Message; E2E means End-to-End; IRC means Internet Relay Chat; SMS means Short Message Service; SDK means Software Development Kit; UI means User Interface; URL means Uniform Resource Locator.

### Baselines and evidence read

- OpenCorvus worktree base: `e3b9eea657a50fe1333d917c8975e901c75d13a4` (`legacy-remote/v0.0.13beta`).
- OpenClaw investigation snapshot: `a230f742f2516e3d1799237bd345c9b325bbf0f3`, whose root package reports version `2026.7.2`.
- Stable packages observed during investigation report `2026.7.1` (the root stable tag resolves to `2026.7.1-2`); the exact root prerelease `openclaw@2026.7.2-beta.1` is used because it contains the pinned source revision's iMessage and Reef runtime entries.
- Read architecture sources:
  - OpenClaw `src/channels/plugins/{bundled-ids,bundled,catalog,registry,types.plugin}.ts` and `src/channels/registry.ts`.
  - OpenClaw `src/plugins/runtime/{types,types-channel}.ts`.
  - OpenClaw `docs/channels/index.md`, `docs/plugins/sdk-channel-{plugins,inbound,ingress,outbound}.md`, `docs/plugins/architecture.md`, and `docs/plugins/sdk-runtime.md`.
  - Every OpenClaw `extensions/**/openclaw.plugin.json` carrying a `channels` field, plus representative IRC, Raft, and SMS entry/runtime/gateway/inbound/outbound sources.
  - OpenCorvus `specs/current/architecture/03-control.md`.
  - OpenCorvus `specs/records/2026-06/2026-06-17-channel-runtime-fail-fast-config-and-uploads.md`.
  - OpenCorvus `specs/records/2026-07/2026-07-09-channel-link-root-repair.md`.
  - Root and package-local `AGENTS.md` files relevant to production and test changes.

### Whole-repository grep results

The pre-plan search covered `ChannelCatalog`, `ChannelId`, `ChannelName`, `ChannelSurface`, `channelRequiredFields`, `resolveChannel`, `channelEnv`, `channelState`, `buildChannelSchema`, every adapter constructor, and every channel route/document reference.

| Surface                     | Call sites and disposition                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared catalog and identity | `packages/channel-config/src/index.ts`: replace the fixed 14-ID enum/catalog with the complete catalog and upstream implementation metadata; remain the only catalog source.                                                                                                                                                                                                                               |
| Runtime adapter contract    | `packages/channel-runtime/src/adapter.ts`: preserve the existing OpenCorvus ingress/outbound contract; add a generic official-plugin bridge behind it.                                                                                                                                                                                                                                                     |
| Runtime registry            | `packages/channel-runtime/src/registry.ts`: delete the channel-ID switch and construct from catalog-owned adapter descriptors.                                                                                                                                                                                                                                                                             |
| Runtime bootstrap           | `packages/channel-runtime/src/main.ts`: delete the explicit 14-factory object and register native or OpenClaw factories through the catalog descriptor.                                                                                                                                                                                                                                                    |
| Existing adapters/tests     | `packages/channel-runtime/src/{slack,telegram,discord,feishu,whatsapp,googlechat,msteams,line,matrix,mattermost,signal,wecom,dingtalk,qq}/**` and matching tests: retain OpenCorvus-specific WeCom/DingTalk; replace the QQ path; keep existing overlapping adapters until the OpenClaw bridge proves equivalent runtime behavior, then remove superseded implementations rather than leaving two sources. |
| Core projection             | `packages/opencorvus/src/channel/{catalog,registry,supervisor,ingress}.ts`: consume the expanded shared catalog without a sibling list.                                                                                                                                                                                                                                                                    |
| Configuration               | `packages/opencorvus/src/config/config.ts`: replace 14 manually exported channel schemas with catalog-derived strict schemas.                                                                                                                                                                                                                                                                              |
| Control and routes          | `packages/opencorvus/src/control/{message,message-schema,timeline}.ts`, `panel/capability.ts`, `tool/panel.ts`, `server/routes/gateway.ts`: preserve generic `ChannelId` projection and extend tests where enumerations are asserted.                                                                                                                                                                      |
| Overlay                     | `packages/overlay/src/components/settings/ChannelsPanel.tsx`: remove its local OpenClaw documentation map and render catalog-provided documentation metadata and fields.                                                                                                                                                                                                                                   |
| Web documentation           | `packages/web/src/content/docs/channels/**` and overview: replace instructions that require editing an enum, switch, and factory; document the official plugin bridge and complete roster.                                                                                                                                                                                                                 |
| Tests                       | `packages/channel-runtime/test/{registry,mainstream-adapters,*adapter*}.test.ts`, `packages/opencorvus/test/channel/**`, route/config suites, Overlay channel settings fixtures, and documentation health suites: update exact rosters and add positive/negative bridge coverage.                                                                                                                          |

No same-purpose dynamic channel plugin host exists in OpenCorvus. The existing fixed catalog, constructor switch, explicit bootstrap factory, manual configuration exports, and Overlay documentation map are five projections of the same roster and must converge rather than receive another list.

### Independent-agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unsolicited delegation.
- The required second review will therefore be a separate evidence pass by the primary agent after implementation, covering the full diff, catalog equality, dependency provenance, tests, and rendered UI.

## Inventory and comparison

OpenClaw contains 26 channel manifests at the pinned revision:

`clickclack`, `discord`, `feishu`, `googlechat`, `imessage`, `irc`, `line`, `matrix`, `mattermost`, `msteams`, `nextcloud-talk`, `nostr`, `qa-channel`, `qqbot`, `raft`, `reef`, `signal`, `slack`, `sms`, `synology-chat`, `telegram`, `tlon`, `twitch`, `whatsapp`, `zalo`, and `zalouser`.

`qa-channel` is explicitly synthetic test infrastructure and is excluded, leaving 25 product channel implementations. OpenCorvus currently exposes 14 channel IDs; 11 match OpenClaw exactly. The 14 missing OpenClaw product identities are:

`clickclack`, `imessage`, `irc`, `nextcloud-talk`, `nostr`, `qqbot`, `raft`, `reef`, `sms`, `synology-chat`, `tlon`, `twitch`, `zalo`, and `zalouser`.

`qqbot` replaces OpenCorvus's hand-written `qq`, so this is 13 net-new platforms plus one implementation/identity replacement. After integration the OpenCorvus catalog has 27 entries: all 25 OpenClaw product manifests plus the OpenCorvus-specific `wecom` and `dingtalk` entries.

OpenClaw documentation also mentions WebChat, Voice Call, and external WeChat/Yuanbao/Zalo ClawBot plugins. WebChat is its first-party web UI rather than a channel manifest; Voice Call is a telephony tool/plugin rather than a manifest channel; the three external plugins have no reusable implementation in the OpenClaw repository. They are therefore not counted as repository channel implementations and are not represented as false local adapters.

## Architecture finding

The architecture has changed materially.

OpenCorvus currently has a closed compile-time roster and one locally designed adapter interface: a Zod ID enum, a fixed metadata array, a registry switch, an explicit factory object, and manually named configuration schemas. OpenClaw now treats a channel as a package-owned capability plugin. A plugin manifest and generated catalog declare identity, install origin, configuration state, and documentation; lazy entry/runtime modules register config, setup, pairing/security, directory, status, gateway lifecycle, inbound turn handling, outbound receipts, account-scoped restart, streaming/threading, and actions. Core provides the shared ingress, reply, session, media, deduplication, and delivery pipeline.

The correct reuse boundary is therefore an OpenClaw plugin host adapter, not 14 new provider-specific OpenCorvus adapters. OpenCorvus remains authoritative for conversations, channel links, and the LLM lifecycle; the bridge injects that existing authority into the OpenClaw channel runtime and translates OpenClaw delivery receipts to the existing `ChannelAdapter` result contract.

## Implementation

1. Expand the shared catalog with the 14 missing identities, strict field schemas, documentation paths, capabilities, platform constraints, and one implementation descriptor per entry (`native` or `openclaw`). Replace `qq` with `qqbot` and delete the old QQ implementation/tests/config path once bridge coverage passes.
2. Add the official channel packages at exact stable versions and the exact root `2026.7.2-beta.1` runtime that contains iMessage and Reef. Resolve every entry from those packages and record package, version, and entry provenance in the catalog.
3. Implement one generic `OpenClawChannelAdapter` that:
   - lazily loads the catalog-selected official plugin entry;
   - runs OpenClaw's plugin registry and runtime in a Node.js sidecar, mapping its final inbound dispatch to the existing OpenCorvus `onMessage` callback;
   - starts/stops the plugin's account gateway through a newline-delimited command protocol and the existing adapter lifecycle;
   - invokes the plugin's own outbound adapter and returns its real receipt/message identity;
   - passes provider configuration as strict OpenClaw channel configuration without aliasing or fallback;
   - reports unsupported media/thread capabilities from declared plugin metadata instead of emulating them.
     The packaged sidecar uses the exact `node-bin` 22.23.1 runtime because OpenClaw rejects the workspace's unsafe SQLite 3.50.4 build; package copying preserves the official module graph.
4. Replace the ID switch, explicit factory object, and manual configuration exports with catalog projections. Keep the shared catalog as the only roster/field/documentation source.
5. Update channel documentation and the Overlay settings page to consume catalog documentation metadata. Do not create new hand-written settings forms.
6. Add tests at the bridge, registry, config, route, and Overlay boundaries. Use official plugin fakes only at external network/CLI boundaries; do not call such tests real E2E.
7. Run the real settings page in a new isolated service, capture desktop screenshots with Node-launched Playwright, inspect them, and correct any catalog/form layout defects.
8. Perform a separate full-diff review, run targeted and repository-required checks, commit on the worktree branch, fetch the delivery branch, merge in the same worktree, rerun hooks/checks, and push the delivery branch to `legacy-remote`.

## Validation commands

- `bun test packages/channel-runtime/test`
- Targeted OpenCorvus config/channel/route tests discovered during implementation.
- Targeted Overlay settings tests and Node-launched Playwright screenshot capture.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Product documentation single-source and document-health suites selected from existing scripts.
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- The repository pre-push hook through a normal `git push legacy-remote ...`.

## Delivery record

### Implemented

- Expanded the single shared catalog from 14 to 27 identities. The catalog owns field projection, schema names, documentation links, and native/OpenClaw implementation provenance.
- Added one generic OpenClaw host and Node.js sidecar. It loads every official package entry, reuses OpenClaw's plugin registry, account configuration, gateway, inbound pipeline, outbound sender, persistent keyed stores, and ingress queue, then projects only the final message and delivery boundary into OpenCorvus.
- Removed the hand-written QQ provider protocol and its old identity; `qqbot` and its official package are the only QQ Bot implementation.
- Replaced the runtime ID switch, explicit OpenClaw factories, manual configuration schema roster, Overlay documentation map, and stale SDK schema with catalog projections.
- Packaged the exact official module graph, sidecar bundle, and Node 22.23.1 runtime into the existing shared Node payload. Native artifact verification now requires those files.
- Updated English and Chinese channel documentation and the root channel count.

### Second review

The separate full-diff review found and corrected four delivery defects before commit:

1. native artifact verification did not yet require `openclaw-channel.mjs` and the root OpenClaw package;
2. the large OpenClaw root-copy path had omitted its `execFile` import and initially relied on a system Node executable;
3. an unused `vendored` source branch contradicted the single official-package implementation source;
4. dynamic schema references initially renamed existing generated SDK types.

The final design requires the OpenClaw payload at packaging time, uses the same pinned Node runtime for package materialization and execution, has only package/runtime provenance modes, and keeps stable schema names in the shared catalog.

### Evidence

- `packages/channel-runtime`: 122 tests across 27 files passed, including real loading/configuration of all 14 missing official entries, the official SQLite-backed keyed store and ingress queue, Node sidecar protocol, inbound projection, outbound text/media, and identity mismatch rejection.
- OpenCorvus channel registry/supervisor/routes: 9 targeted tests passed.
- SDK/package/runtime tests: generated SDK snapshot, native bundle requirements, catalog-owned runtime list, pinned Node selection, and util runtime tests passed.
- Complete package materialization copied every catalog-selected official package plus the root iMessage/Reef runtime into an isolated payload and passed in 302.48 seconds. `bun install --frozen-lockfile` and the production dead-code check passed.
- `bun run typecheck`: 9 package typechecks passed.
- `bun run api:routes-check`: 6 rules across 31 files passed.
- `bun run docs:check`: 283 operations in 23 groups passed.
- Node-launched Playwright rendered the real Channels settings surface with 27 rows and the QQ Bot provider-owned form. Screenshots were inspected at `.scratch/openclaw-channel-catalog.png` and `.scratch/openclaw-qqbot-channel-dialog.png`; the catalog density, controls, dialog fields, focus, and documentation affordance were visually accepted.
- No live external channel credentials were available, so external-provider network delivery is not claimed as real E2E evidence. Official plugin loading/configuration and the local runtime/sidecar/package paths are verified; credentialed provider smoke tests remain an operational deployment check.

Final documentation health passed 87 tests with 1,409 assertions. The `dsw-33987` commit and delivery-branch integration are recorded by the Git history pushed to `legacy-remote`.
