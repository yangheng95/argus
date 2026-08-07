# Hexin Endpoint Resolution

## Recall

- User requirement: make `aimemodeldev.myhexin.com` work without editing the
  operating-system hosts file. The user explicitly accepted a source-owned
  Hexin address binding and requested a TODO for later refactoring.
- Acceptance criteria:
  - Hexin model refresh, budget lookup, and streamed chat connect to
    `172.20.210.183`;
  - the request URL, HTTP Host, and Transport Layer Security (TLS) Server Name
    Indication (SNI) remain `aimemodeldev.myhexin.com`;
  - certificate verification remains enabled;
  - no operating-system hosts edit or process restart is required;
  - a real authenticated Hexin stream succeeds through the production request
    path.
- Hard constraints: preserve all unrelated worktree changes; do not disable TLS,
  rewrite the HTTPS URL to an Internet Protocol (IP) address, create a fallback
  path, add a state machine, or leave a parallel request implementation.
  Configuration-like facts must have one provider-owned declaration instead of
  being repeated at call sites. Non-User Interface (UI) behavior requires
  positive contract tests. Commit subjects start with `dsw-33987`, and delivery
  pushes the current branch to `myhexin`.
- Sources read:
  - `specs/current/architecture/06-provider.md`;
  - `specs/records/2026-07/2026-07-16-provider-tls-routing-and-visible-error.md`;
  - `packages/opencorvus/src/provider/models.ts`;
  - `packages/opencorvus/src/provider/provider.ts`;
  - `packages/opencorvus/src/provider/hexin-discovery.ts`;
  - `packages/opencorvus/src/server/routes/provider.ts`;
  - `packages/opencorvus/src/util/network-proxy.ts`;
  - `packages/opencorvus/src/util/network-proxy-transport.ts`;
  - Undici `Agent.connect.lookup` declarations from the pinned `undici@6.21.3`
    dependency.
- Whole-repository search evidence:
  - `ModelsDev.HEXIN_GATEWAY_URL` owns the canonical gateway URL and is consumed
    by local catalog construction, explicit Hexin model refresh, and the budget
    route;
  - outbound Hexin traffic has three owners: the generic Provider SDK fetch
    wrapper in `provider/provider.ts`, `fetchGatewayJSON()` in
    `provider/hexin-discovery.ts`, and the budget fetch in
    `server/routes/provider.ts`;
  - provider streaming enters through `Provider.getLanguage()` and the
    `@ai-sdk/openai-compatible` SDK, while `session/llm.ts` remains the sole
    `streamText()` caller;
  - `network-proxy.ts` and `network-proxy-transport.ts` already own explicit
    proxy routing but do not provide direct endpoint address selection;
  - Bun `fetch` exposes proxy and TLS options but no per-request Domain Name
    System (DNS) lookup override; the installed Undici transport supports a
    `connect.lookup` callback while preserving the original HTTPS origin.
- Independent agent feedback: none; the user did not request multi-agent work,
  so the main agent performed the complete call-site and transport audit.

## Evidence

The unchanged running machine currently contains:

```text
172.20.210.183 aimemodeldev.myhexin.com
```

With that binding, a certificate-verifying request reaches the gateway at
`172.20.210.183` and returns HTTP 401 without credentials. An Undici
`Agent.connect.lookup` probe that returns the same address for the original
gateway hostname also reaches HTTP 401 while keeping the HTTPS URL unchanged.
This proves endpoint selection can move into the Provider transport without
weakening TLS.

## Design

1. Add one Hexin endpoint declaration containing the canonical HTTPS URL and
   pinned connection address.
2. Add one mature Undici-backed fetch owner that:
   - accepts only the declared Hexin hostname;
   - resolves that hostname to the declared address through `connect.lookup`;
   - sends the original hostname to HTTP and TLS;
   - returns a standard Fetch `Response`;
   - owns one process-lifetime pooled dispatcher.
3. Route all three Hexin network consumers through that owner:
   - Provider SDK streaming when no explicit user proxy or custom fetch owns the
     transport;
   - explicit `/models` and `/model/info` refresh;
   - `/key/budget`.
4. Preserve the existing explicit LLM proxy as the higher-precedence transport.
   A configured proxy remains the single request owner because its CONNECT
   endpoint performs remote resolution.
5. Add positive tests for the declared lookup result, original HTTPS origin,
   Provider streaming fetch selection, model refresh, and budget request.

## Call-Site Disposition

| Call site | Disposition |
| --- | --- |
| `ModelsDev.HEXIN_GATEWAY_URL` | Move into the endpoint declaration and re-export as the catalog URL owner. |
| `Provider.getSDK()` fetch wrapper | Select the Hexin endpoint fetch only when no custom fetch or explicit LLM proxy is active. |
| `hexin-discovery.ts::fetchGatewayJSON()` | Replace global fetch with the Hexin endpoint owner. |
| `ProviderRoutes /hexin/budget` | Replace global fetch with the same endpoint owner. |
| `network-proxy.ts` | Preserve; explicit proxy configuration remains authoritative when enabled. |
| `session/llm.ts` | Preserve; it continues to call the AI SDK stream without provider-specific branching. |

## Verification

1. Focused endpoint transport, Provider request, Hexin discovery, and budget
   route tests.
2. `packages/opencorvus` typecheck.
3. Required historical-document, document-health, and product-doc single-source
   checks.
4. A real authenticated Hexin production-path stream without relying on the
   operating-system hosts binding.
5. Scoped diff review followed by a second review of the final commit.

## Result

- `fetchHexinEndpoint()` sent an authenticated `stream=true` request through
  the pinned Undici lookup and received HTTP 200,
  `text/event-stream; charset=utf-8`, and a real `data:` frame.
- The complete production path
  `Provider.getModel()` → `Provider.getLanguage()` →
  `@ai-sdk/openai-compatible` → `streamText()` returned text `OK` through the
  same transport.
- Focused endpoint, discovery, request-transform, and budget contracts pass:
  30 tests, 87 expectations, zero failures.
- `packages/opencorvus` TypeScript compilation and the native executable build
  pass.
- Historical-link, document-health, and product-document single-source checks
  pass: 72 tests, 1,281 expectations, zero failures.
- The touched historical Provider test files contained obsolete negative
  assertions. They were removed or rewritten to verify current positive output
  and explicit error-response contracts before the focused suite was rerun.
