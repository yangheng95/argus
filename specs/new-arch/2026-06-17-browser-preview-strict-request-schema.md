# Browser Preview Strict Request Schema - 2026-06-17

## Acronyms

- API: Application Programming Interface, the backend route contract used by overlay and SDK clients.
- GUI: Graphical User Interface, the visible browser preview panel.
- SDK: Software Development Kit, the generated JavaScript client contract.
- URL: Uniform Resource Locator, the persisted preview target address.

## Problem

Browser preview request schemas require `targetID`, but most `z.object(...)`
contracts still use Zod's default strip behavior. A request can send a valid
`targetID` plus stale direct fields such as `url` or `outDir`; the route accepts
the body and silently discards those fields. That hides a second evidence source
instead of failing at the API boundary.

## Evidence Sweep

Command:

```powershell
rg -n "z\.object|capture|compare|live/snapshot|live/input|targetID|viewportID|outDir|url" packages/opencorvus/src/server/routes/browser-preview.ts packages/opencorvus/src/browser-preview/region-comparison.ts packages/opencorvus/src/tool/browser-preview-compare-regions.ts packages/opencorvus/test/server packages/opencorvus/test/browser-preview packages/opencorvus/test/tool -g "*.ts"
```

| Surface                    | Evidence                                                                       | Decision                                                                                |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Target selection           | Already uses `.strict()`.                                                      | Keep as the reference behavior.                                                         |
| Capture route              | Inline request schema accepts extra keys.                                      | Extract and make strict.                                                                |
| Live snapshot/input routes | Shared request schema and nested input variants accept extra keys.             | Make top-level and input variants strict.                                               |
| Region comparison route    | `BrowserPreviewRegionComparisonRequest` and nested bindings accept extra keys. | Make request, binding, locator, source, implementation, output, and box schemas strict. |
| Tool params                | `BrowserPreviewCompareRegionsToolParameters` accepts extra keys.               | Make strict and add schema regression coverage.                                         |
| OpenAPI/SDK                | Generated request bodies reflect schema strictness.                            | Regenerate/update generated API artifacts after source changes.                         |

## Fix

1. Add strict browser preview request schema constants for capture and live
   routes.
2. Make region-comparison request and nested input objects reject unknown keys.
3. Make the `browser_preview_compare_regions` tool parameter schema reject
   unknown keys.
4. Add route and tool/schema tests proving valid target requests with `url` or
   `outDir` fail instead of being stripped.
5. Regenerate API artifacts so request bodies advertise
   `additionalProperties: false`.

## Acceptance

- Capture, compare, live snapshot, and live input requests reject extra direct
  evidence fields.
- Nested compare bindings reject direct URL/output-directory fields.
- Tool parameters reject extra fields.
- Targeted route/tool/browser-preview tests pass.
- `api:routes-check`, SDK import check, typecheck, and docs check pass.
