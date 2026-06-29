# Workflow Generating Status Live Regions

## Recall

- `2026-06-19-loading-spinner-motion-token-source.md` kept `.card__spinner` as the shared live spinner shape for Browser Preview, Architect, Frontend Research, and Requirements loading states.
- `2026-06-19-browser-preview-loading-status-live.md` added `role="status"` and `aria-live="polite"` to Browser Preview loading surfaces that own translated loading text.
- `AgentModelsPanel.tsx` already marks its loading state as `role="status"` with `aria-live="polite"`.

## Evidence

| Search                                                                                                    | Finding                                                                                                            | Decision                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `rg -n 'card__spinner' packages/overlay/src/components packages/overlay/src/styles packages/overlay/test` | `BrowserPreviewPanel`, `ArchitectPanel`, `FrontendResearchPanel`, and `RequirementsPanel` render `.card__spinner`. | Browser Preview is already fixed; this iteration covers the three workflow panels.                      |
| `rg -n 'role="status"                                                                                     | aria-live                                                                                                          | aria-busy' packages/overlay/src/components packages/overlay/test specs`                        | Loading status/live contracts exist for Browser Preview, Agent Models, Trace, connection and provider surfaces, but not for Architect/FrontendResearch/Requirements generating indicators. | Use the established `role="status" aria-live="polite" aria-busy="true"` contract. |
| `rg -n 'req-streaming                                                                                     | arch-generating' packages/overlay/src/components packages/overlay/test`                                            | Requirements and Frontend Research share `.req-streaming-indicator`; Architect owns `.arch-generating`. | Add status attributes to the visible generating label containers, not to streaming message lists.                                                                                          |

## Design

- Requirements generating indicator: keep the existing DOM and spinner class, add `role="status"`, `aria-live="polite"`, and `aria-busy="true"` to `.req-streaming-indicator`.
- Frontend Research generating indicator: same `.req-streaming-indicator` contract.
- Architect generating indicator: add the same contract to `.arch-generating`.
- Keep `.card__spinner` decorative through CSS and accessible text through existing i18n labels.
- Do not add a wrapper, second message source, timeout, or fallback state.

## Verification

- Static source guard asserts all three components expose the generating status contract.
- Real browser test renders the three panels in generating state, verifies status/live/busy attributes, verifies the visible labels, and captures a screenshot for visual review.
