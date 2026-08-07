# Provider TLS Routing and Visible Error Repair

## Recall

### User request

- Diagnose and repair the empty red block shown after configuring a provider.
- Diagnose and repair a Chat that accepts a message but appears not to respond.
- Apply the user-supplied direct host mappings for the affected private services.

### Acceptance criteria

1. `aimemodeldev.myhexin.com` resolves to the supplied real address `172.20.210.183`, and a verified TLS request reaches the service without disabling certificate verification. An unauthenticated HTTP 401 response is acceptable connectivity evidence.
2. The Provider page alert preserves and renders the actual error string when the Add form is closed; it must not render an empty red alert from a boolean condition value.
3. The existing streamed Chat failure remains a real persisted error message rather than a synthetic response or hidden UI-only message.
4. A focused regression test covers the Provider alert value contract, and an isolated real browser render verifies the error text and layout.
5. The already-running OpenCorvus process is not restarted, refreshed, stopped, or otherwise modified for verification.

### Hard constraints

- Keep TLS verification enabled; do not introduce a certificate bypass, proxy fallback, compatibility path, or host-side routing gate.
- Preserve the existing natural message/error-part flow and the single Provider error signal.
- Do not touch the pre-existing untracked `packages/overlay/dist-artifacts/darwin-arm64/` directory.
- Any frontend acceptance uses an isolated service/fixture and a task-scoped screenshot.
- Commit subjects use the `dsw-33987` prefix and delivery is pushed to the `myhexin` remote.

### Evidence read

- User screenshot and Chat debug information for session `ses_094c1ec17ffe3vMKYqHtvsI0nJ`.
- `/Users/yangheng/.local/share/opencorvus/log/2026-07-16T140333-10142-1.log`.
- `packages/overlay/src/components/settings/ProvidersPanel.tsx` and its Provider layout tests.
- `packages/opencorvus/src/session/processor.ts`, session message tests, and Overlay session-error rendering tests.
- `specs/README.md`, `specs/records/2026-07/README.md`, and the current provider-catalog repair record.

### Whole-repository search evidence

| Surface | Result and disposition |
| --- | --- |
| `formError` writers/readers | All writers store translated strings or `describeFailure` output in the one `string | null` signal. The closed-form reader at line 842 combines the string with `&& !showAdd()`, producing boolean `true`; replace that reader. The in-form reader uses `when={formError()}` and remains unchanged. |
| `.provider-form-error` | The shared class is the intended visible alert surface. Keep it and restore its text value; no second error surface is added. |
| streamed session failures | `session/processor.ts` persists the caught stream failure as a real error part, and Overlay tests already cover session-error projection. Preserve this path. |
| provider/model route | Log evidence identifies provider `hexin`, model `gpt-5.5`, and URL `https://aimemodeldev.myhexin.com/litellm/v1/chat/completions`. No alternate endpoint is introduced. |
| host routing | Normal DNS returned proxy Fake-IP `198.18.0.16`; `curl --resolve ...:172.20.210.183` completed certificate verification and reached the API with HTTP 401. Apply the supplied host record as the direct routing source. |

### Independent agent feedback

No new independent-agent delegation was requested for this focused repair. The final implementation receives a separate local diff/test/visual review before delivery.

## Causal chain

1. The message submit route returned HTTP 202 and persisted the user message, so the Composer did send successfully.
2. Every streaming attempt then connected through the proxy Fake-IP and failed with `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` before any model response could arrive.
3. Resolving the same hostname to the user-supplied real IP reaches the private API with valid certificate verification, proving routing—not the provider key or a missing CA bundle—is the direct trigger.
4. Independently, Solid's `<Show>` receives `formError() && !showAdd()`. When both conditions are satisfied, that expression yields boolean `true`; the render callback therefore receives `true` instead of the original error string, producing an outlined alert with no text.

## Implementation

1. Add the six user-provided direct mappings to `/etc/hosts` after one operating-system administrator authorization, then flush name-service caches and verify the actual Bun HTTPS path reaches the service with TLS verification enabled.
2. Change the closed-form Provider alert condition to return the error string or `null`, maintaining the existing signal and alert component as the single UI source.
3. Add a source-level regression assertion for the exact value-preserving conditional and the removal of the boolean-producing expression.
4. Render an isolated Provider error state in the real Overlay and inspect a task-scoped screenshot.

## Verification commands

```bash
bun test packages/overlay/test/provider-settings-layout.test.ts
bun test packages/overlay/test/tree-writer-hierarchy.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

## Verification results

- `/etc/hosts` contains each of the six supplied mappings exactly once; `dscacheutil` resolves `aimemodeldev.myhexin.com` to `172.20.210.183`.
- Bun HTTPS fetch with certificate verification enabled reaches `/litellm/v1/models` and receives HTTP 401 Unauthorized, proving that TLS and routing now succeed without a provider credential in the probe.
- Provider layout regression: 15 passed.
- Provider real browser suite: 7 passed, including the visible refresh-error assertion and screenshot `.scratch/provider-settings-visible-refresh-error.png`.
- Session error projection: 52 passed, including preservation of the original stream error on the session card.
- Product documentation single-source tests: 4 passed. Overlay TypeScript check passed.
- The first document-health run identified this new record plus an unrelated concurrent macOS picker record as indexed but not yet tracked. The provider record is included in this delivery; the unrelated concurrent record remains outside this task's commit boundary.
