# Local Module Visible Locator Binding

Date: 2026-06-17

## Problem

`local source-binding helper` captures the implementation module before creating a source/local binding puzzle. The local module sidecar only checked `locator.count()`, then used `getBoundingClientRect()` and coerced zero dimensions with `Math.max(1, ...)`. Hidden or collapsed modules can therefore produce passed binding evidence before `region comparison tool` has a chance to reject the locator.

## Recall

- `specs/records/2026-06/2026-06-16-local-module-source-binding.md` introduced local module binding as the source-bbox discovery step before region comparison.
- `specs/records/2026-06/2026-06-17-browser-preview-visible-region-locator.md` already requires the comparison runner to use Playwright locators, `isVisible()`, and non-zero `boundingBox()`.
- The same visible/non-zero rule must apply to local module capture because it owns the earlier evidence-producing binding step.

## Callsite Inventory

`rg "local source-binding helper|bindLocalModuleToSourceRegion|LOCAL_MODULE_CAPTURE_SCRIPT|locator.count\\(|getBoundingClientRect|Math.max\\(1|LocalSourceBindingHelper|ToolRegistry" packages/opencorvus/src packages/opencorvus/test -S`

| Area                                                       | Finding                                                                                                        | Decision                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/browser-preview/local-module-source-binding.ts`       | Sidecar capture treats hidden/zero-size DOM nodes as capturable implementation modules.                        | Require `isVisible()` and positive `boundingBox()` before evaluating anchors; stop coercing dimensions to 1. |
| `src/tool/local-source-binding-helper.ts`            | Tool exists and delegates to `bindLocalModuleToSourceRegion`.                                                  | Keep the tool as the public product entry.                                                                   |
| `src/tool/registry.ts`                                     | Tool is not registered, making the documented workflow unavailable and hiding the capture bug from tool tests. | Register `LocalSourceBindingHelper` next to other browser preview tools.                            |
| `test/browser-preview/local-module-source-binding.test.ts` | Covers scoring and artifact materialization only.                                                              | Add real browser capture coverage for hidden and zero-size implementation locators.                          |
| `test/tool/browser-preview.test.ts`                        | Registry currently asserts only `browser_preview` and `region comparison tool`.                       | Add registry coverage for `local source-binding helper`.                                               |

## Acceptance

- Hidden and zero-size implementation locators fail before binding artifacts or passed evidence are written.
- `local source-binding helper` is registered in `ToolRegistry`.
- Comparison visible-locator tests remain green.
- No fallback, gate, or DOM-only parallel locator path is introduced.
