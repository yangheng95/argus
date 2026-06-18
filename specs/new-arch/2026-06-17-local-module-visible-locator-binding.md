# Local Module Visible Locator Binding

Date: 2026-06-17

## Problem

`browser_preview_bind_local_module` captures the implementation module before creating a source/local binding puzzle. The local module sidecar only checked `locator.count()`, then used `getBoundingClientRect()` and coerced zero dimensions with `Math.max(1, ...)`. Hidden or collapsed modules can therefore produce passed binding evidence before `browser_preview_compare_regions` has a chance to reject the locator.

## Recall

- `specs/new-arch/2026-06-16-local-module-source-binding.md` introduced local module binding as the source-bbox discovery step before region comparison.
- `specs/new-arch/2026-06-17-browser-preview-visible-region-locator.md` already requires the comparison runner to use Playwright locators, `isVisible()`, and non-zero `boundingBox()`.
- The same visible/non-zero rule must apply to local module capture because it owns the earlier evidence-producing binding step.

## Callsite Inventory

`rg "browser_preview_bind_local_module|bindLocalModuleToSourceRegion|LOCAL_MODULE_CAPTURE_SCRIPT|locator.count\\(|getBoundingClientRect|Math.max\\(1|BrowserPreviewBindLocalModuleTool|ToolRegistry" packages/opencorvus/src packages/opencorvus/test -S`

| Area                                                       | Finding                                                                                                        | Decision                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/browser-preview/local-module-source-binding.ts`       | Sidecar capture treats hidden/zero-size DOM nodes as capturable implementation modules.                        | Require `isVisible()` and positive `boundingBox()` before evaluating anchors; stop coercing dimensions to 1. |
| `src/tool/browser-preview-bind-local-module.ts`            | Tool exists and delegates to `bindLocalModuleToSourceRegion`.                                                  | Keep the tool as the public product entry.                                                                   |
| `src/tool/registry.ts`                                     | Tool is not registered, making the documented workflow unavailable and hiding the capture bug from tool tests. | Register `BrowserPreviewBindLocalModuleTool` next to other browser preview tools.                            |
| `test/browser-preview/local-module-source-binding.test.ts` | Covers scoring and artifact materialization only.                                                              | Add real browser capture coverage for hidden and zero-size implementation locators.                          |
| `test/tool/browser-preview.test.ts`                        | Registry currently asserts only `browser_preview` and `browser_preview_compare_regions`.                       | Add registry coverage for `browser_preview_bind_local_module`.                                               |

## Acceptance

- Hidden and zero-size implementation locators fail before binding artifacts or passed evidence are written.
- `browser_preview_bind_local_module` is registered in `ToolRegistry`.
- Comparison visible-locator tests remain green.
- No fallback, gate, or DOM-only parallel locator path is introduced.
