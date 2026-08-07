# 2026-06-26 Model Image Input Blank Crop

## Goal

Before an image attachment is serialized into a model-bound multimodal part,
run one deterministic blank-margin crop pass. This removes empty screenshot
canvas such as horizontal blank overflow before the model receives the bytes.

This is not a visual acceptance gate and not a layout-overflow repair. The
original attachment remains unchanged in the attachment store and session
history. The model-bound transient bytes may be cropped, and the prompt/replay
path records the original and cropped dimensions when a crop occurs.

## Required Semantics

1. Keep original screenshot attachments as the durable evidence source.
2. Crop only at the model-input boundary where bytes become data URLs or
   AI-SDK image-data parts.
3. Apply the existing 8000px max-dimension check after cropping.
4. If cropped bytes still exceed the model limit, fail with the typed
   `ModelImageInputTooLargeError`; do not resize, slice, or silently drop.
5. Reuse one shared implementation for user file parts and tool-result media.
6. Do not change browser screenshot capture, browser-preview evidence, or
   reference-comparison crop geometry.

## Callpoint Inventory

| Area                                 | File                                                                                                                | Current behavior                                                                         | Repair                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Session model image guard            | `packages/opencorvus/src/session/model-image-input.ts`                                                              | Reads dimensions and throws before any blank crop.                                       | Add `prepareModelImageInput()` that trims blank margins once, then enforces the limit.               |
| Session replay / tool-result media   | `packages/opencorvus/src/session/message.ts`                                                                        | `modelBoundFileUrl()` and `attachmentToBase64()` send raw attachment bytes to the model. | Route both through `prepareModelImageInput()` and append crop notes to adjacent text.                |
| Provider transform direct local refs | `packages/opencorvus/src/provider/transform.ts`                                                                     | Direct `ProviderTransform.message()` local file refs inline raw attachment bytes.        | Route direct image refs through the same preparation function.                                       |
| Tests                                | `packages/opencorvus/test/session/model-image-input.test.ts`, `packages/opencorvus/test/provider/transform.test.ts` | Only checks raw header limit and raw local-ref inlining.                                 | Add blank-crop and post-crop limit coverage; keep existing inlining behavior for non-cropped images. |

## Non-Goals

- No screenshot-tool fallback.
- No downscaling.
- No scroll slicing.
- No acceptance status rewrite.
- No modification of persisted original attachments.
