# 2026-06-22 overlay proxy delete button

## Request

After a proxy is configured, the Overlay network settings must expose a direct delete button. Deleting must remove `network.proxy` from config instead of requiring the operator to clear the URL field and save.

## Existing Plan Recall

- `2026-06-12-proxy-auth-scope-settings.md` defines `network.proxy` as the single config source for proxy URL, credentials, and `llmProvider` / `webResearch` scopes.
- `2026-06-17-overlay-proxy-test-button.md` says `NetworkPanel` owns the proxy settings UI and writes through `patchConfig({ network: { proxy: ... } })`.
- `2026-06-22-retire-default-network-proxy.md` removes the software-internal default proxy. No proxy should be active without explicit config.

## Grep Findings

| Area | Evidence | Decision |
| --- | --- | --- |
| Overlay owner | `packages/overlay/src/components/settings/NetworkPanel.tsx` owns draft fields, validation, save, and test. | Add a delete handler in this component. |
| Config write API | `packages/overlay/src/services/config.ts` exposes `patchConfig(diff)` and server-side merge patch treats `null` as delete. | Reuse `patchConfig({ network: { proxy: null } })`; no new route or service source. |
| Static tests | `packages/overlay/test/dialog-service-single-source.test.ts` guards NetworkPanel's single-source write path. | Extend it to assert the delete button and null patch. |
| i18n | `packages/overlay/src/i18n/en-US.json` and `zh-CN.json` own visible strings. | Add delete status/title strings in both locales. |
| Visual acceptance | Network settings are a frontend surface. | Start a real Overlay page, open Settings > Network, screenshot the proxy controls, and verify the delete button is visible and non-overlapping. |

## Acceptance

- Network settings includes a visible delete button for saved proxy config.
- The delete button calls `patchConfig({ network: { proxy: null } })`.
- On success, local proxy fields clear and a saved/deleted status is shown.
- The button is disabled while save/test/delete is already running or when no proxy config exists.
- Static tests, i18n check, typecheck, and browser visual check pass.
