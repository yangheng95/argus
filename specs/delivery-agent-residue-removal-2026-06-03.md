# Delivery Agent Residue Removal - 2026-06-03

## Evidence Scan

- Retired delivery tool factory, retired delivery verifier, retired delivery runtime capture path, and disabled delivery publication tool entries were scanned across `packages/opencorvus/src`, `packages/opencorvus/test`, `docs/product`, and `specs/new-arch`.
- Production callers for the old delivery tool/service surface were absent; remaining callers were tests proving retirement behavior.
- Runtime screenshot capture was still transitively owned by `delivery/runtime-capture`; that was a naming and ownership bug because the build agent owns implementation verification evidence.

## Decisions

- Build owns the `screenshot` tool through `build/screenshot-tool.ts`.
- Runtime browser capture primitives live under `runtime/page-capture.ts`, `runtime/visual-page.ts`, and `runtime/browser-noise.ts`.
- Generic multimodal tool output lives under `tool/multimodal-result.ts`; no delivery namespace owns attachment formatting.
- Retired delivery tool/service/index files are deleted instead of kept as disabled shells.
- Orchestrator no longer exposes disabled `deliver` or `publish_delivery` tools. Integrity is the terminal acceptance path.

## Callpoint Actions

| Surface                                     | Action                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `build/agent.ts`                            | Register build-owned `screenshot` alongside `report_build_result`.                                       |
| `build/screenshot-tool.ts`                  | Capture a running URL, keep original evidence, attach a proportional image no larger than 1440x900.      |
| `runtime/page-capture.ts`                   | Own runtime capture defaults and viewport normalization.                                                 |
| `runtime/visual-page.ts`                    | Own browser render and visual diff primitives.                                                           |
| `tool/multimodal-result.ts`                 | Own attachment-backed multimodal tool results.                                                           |
| `orchestrator/tools.ts`                     | Remove disabled delivery lifecycle tools.                                                                |
| Retired delivery tool/verifier/index shells | Delete retired delivery agent shells.                                                                    |
| Product docs and `specs/new-arch`           | Replace current-architecture references to delivery agent/tool ownership with build/integrity ownership. |

## Verification

- Unit tests must cover resized build screenshot attachments, attachment-backed multimodal results, runtime page capture, runtime browser-noise filtering, orchestrator absence of retired delivery tools, and integrity acceptance tool boundaries.
- Static scans must find no current references to retired delivery tool/service names in source, tests, product docs, or current architecture specs.
