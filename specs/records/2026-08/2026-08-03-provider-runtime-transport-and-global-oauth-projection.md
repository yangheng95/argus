# Provider runtime transport and global OAuth projection repair

## Recall

### User request

- Fix both diagnosed defects: Hexin live-model refresh never completes, and a
  successful OpenAI OAuth authentication still leaves every GPT model absent
  from the Composer model selector.

### Acceptance criteria

1. The production Bun runtime reaches the pinned Hexin private address while
   preserving the canonical HTTPS hostname, HTTP Host, Transport Layer Security
   (TLS) Server Name Indication (SNI), and certificate verification.
2. Authenticated `/models` and `/model/info` reads complete through the exact
   production transport, the explicit model-refresh route reaches its durable
   catalog writer, and an upstream stall remains abortable.
3. Empty-workspace OpenAI OAuth uses the existing built-in global Provider hook
   projection, materializes OpenAI as connected, and exposes its canonical GPT
   model set without creating a Project `Instance`.
4. Project Provider hooks remain project-owned; installed project plugins do
   not leak into the global projection.
5. Focused positive non-User Interface (UI) contracts, typecheck, route/docs
   health, real runtime probes, and a second diff review pass.

### Hard constraints

- Preserve one Hexin endpoint declaration and one transport; remove the
  incompatible Undici path rather than retaining a runtime fallback.
- Preserve one built-in global Provider-hook catalog, one `Auth` credential
  store, and one Provider state builder; do not synthesize a Project, add a
  second OAuth state, introduce a gate/state machine, or infer scope.
- Keep all Language Model (LLM) responses streaming. Do not weaken TLS, rewrite
  the public provider URL to an Internet Protocol (IP) address, or change the
  operating-system hosts file.
- Do not add, modify, or run UI automation tests. Preserve unrelated untracked
  workspace files. Commit subjects start with `dsw-33987` and push the current
  branch to the git-cc remote.

### Sources read

- `AGENTS.md` supplied in the current task.
- `specs/current/architecture/06-provider.md`.
- `specs/records/2026-07/2026-07-20-empty-workspace-provider-auth-context.md`.
- `specs/records/2026-07/2026-07-29-provider-loading-failure-isolation.md`.
- `specs/records/2026-07/2026-07-31-hexin-endpoint-resolution.md`.
- Provider endpoint/discovery/catalog/state/auth/plugin/global-route and Overlay
  model-selection sources and their existing non-UI tests.
- Bun's official Fetch documentation for native timeouts, TLS validation, and
  response streaming behavior.

### Whole-repository search results

- `fetchHexinEndpoint()` is the single transport used by Hexin discovery,
  budget, and the Provider Software Development Kit (SDK) fetch override.
- The July 31 endpoint repair imports Node Undici directly into the Bun-compiled
  server. A real authenticated Node probe completed `/models` in 118 ms and
  `/model/info` in 263 ms, while the same source function under Bun did not
  return within 44 seconds and ignored its 15-second abort.
- A real authenticated Bun `node:https` probe using the same endpoint lookup
  completed `/models` in 118 ms and `/model/info` in 189 ms.
- The saved OpenAI OAuth record contains access, refresh, expiry, and account
  identity. The canonical catalog contains 37 OpenAI models, but the live
  global Provider response excludes `openai` from `connected`.
- `connectedModelOptions()` correctly consumes only connected Provider state.
  `Provider.globalStateFor()` is the direct loss point: it disables all
  extension hooks, even though `Plugin.listGlobalAuth()` already constructs the
  canonical project-independent built-in hooks used to complete global OAuth.
- Existing touched tests are non-UI positive/error-contract tests. No touched
  path requires deletion of a UI automation or negative test.

### Independent agent feedback

- None. The user did not request sub-agents or parallel independent review.

## Causal chain

### Hexin refresh

- Observable: repeated `POST /provider/models/refresh` requests log `started`
  but never `completed`; the durable `models.json` timestamp does not change.
- Direct trigger: Bun waits forever inside the Node Undici `fetch` call before
  discovery reaches the catalog transaction.
- Deep cause: a Node-specific Undici dispatcher was made the sole transport of
  a Bun-compiled executable without executing the real Bun production path in
  acceptance. The mocked endpoint test bypasses that dispatcher entirely.
- Prior gap: the July 31 verification proved Node Undici and an authenticated
  LLM stream, but did not execute `fetchHexinEndpoint()` under the shipped Bun
  runtime.

### OpenAI OAuth projection

- Observable: OAuth callback returns HTTP 200 and persists valid credentials,
  while the global catalog exposes OpenAI models but not an OpenAI connected
  identity; the Composer therefore filters every GPT model.
- Direct trigger: `globalStateFor()` calls `buildState()` with instance
  extensions disabled, so both the OpenAI model projection and OAuth auth
  loader are skipped.
- Deep cause: the empty-workspace auth repair built a project-independent
  built-in hook projection for authentication, but Provider state continued to
  treat all hooks as project-only. The global auth control plane and global
  connected-model projection therefore consume different capability closures.
- Prior gap: tests asserted global auth methods and OAuth persistence, not the
  resulting complete connected Provider projection.

## Design

1. Replace the Hexin Undici dispatcher with one `node:https` request adapter.
   Keep the canonical hostname as the request URL and SNI authority, override
   only socket lookup, leave certificate validation enabled, propagate aborts,
   and convert the incoming response stream to a Fetch `Response` without
   buffering the LLM response.
2. Rename the existing global auth-only hook owner to the global built-in
   Provider-hook owner. Reuse that exact hook array in both `ProviderAuth` and
   global `Provider.buildState()`.
3. Let `buildState()` accept an explicit hook collection. Project callers use
   `Plugin.list()`; global callers use the built-in global hooks. No caller
   scans plugins independently.
4. Add positive contracts proving the global route returns OpenAI in
   `connected` with its projected GPT model closure after OAuth, and that the
   Hexin adapter preserves request authority/body and returns a streamed
   response through its socket lookup owner.
5. Update current Provider architecture and run focused tests, typecheck,
   route/docs health, real Bun transport and route probes, followed by exact
   diff review.

## Verification ledger

- `bun run typecheck`: passed all 8 package typecheck tasks, including the SDK
  import and AI runtime checks.
- Focused Provider contracts: 44 passed after the two bootstrap process tests
  were rerun alone with a 15-second process budget. Their first concurrent run
  passed 42 contracts but crossed the pre-existing 5-second child-process test
  timeout; the isolated run completed those routes in 3.8 and 4.3 seconds.
- Documentation contracts: 70 passed across historical links, document health,
  and product documentation single-source checks.
- `bun run docs:check`: passed with 311 operations in 24 groups.
- `bun run api:routes-check`: passed all 6 rules across 33 route files.
- `bun run build --single --binary-only`: built the Windows x64 Bun executable
  and its runtime payload successfully.
- Exact authenticated production-source Bun probe: `/models` returned HTTP 200
  with 3,060 bytes in 111 ms; `/model/info` returned HTTP 200 with 322,160 bytes
  in 105 ms. The probe used `fetchHexinEndpoint()` and did not mutate the
  durable model catalog.
- The isolated real `/global/providers` route contract returned HTTP 200,
  included `openai` in `connected`, projected `gpt-5.5`, `gpt-5.6-sol`, and
  `gpt-5.6-terra`, and reported an empty issue collection from saved OAuth.
