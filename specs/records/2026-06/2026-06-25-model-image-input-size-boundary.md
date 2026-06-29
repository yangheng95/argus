# Model Image Input Size Boundary - 2026-06-25

## Acronyms

- LLM: Large Language Model, the provider-hosted model process that receives text, tool results, and media inputs.
- MIME: Multipurpose Internet Mail Extensions, the content type string used to classify attachments.
- PNG: Portable Network Graphics, an image format used by browser and visual evidence screenshots.
- JPEG: Joint Photographic Experts Group, an image format commonly used for photos.
- WebP: Web Picture format, a browser image format used for compressed images.

## Problem

Task `tsk_efce8e955001gnbkZELiQMn0Nb` failed in `frontend_design` after the
agent called `url_screenshot`. The tool successfully returned a full-page PNG,
but the next LLM request failed before model execution because the attachment was
`1440x19773`, exceeding the provider's 8000-pixel single-dimension limit.

The failure happened after tool execution and before model reasoning, so the
agent could not observe the image and choose a different strategy.

## Recall

- `2026-06-24-tool-result-image-attachments.md` establishes tool result image
  attachments as the shared backend-to-UI transport.
- `2026-06-13-hexin-kimi-k26-image-capability.md` and
  `2026-06-13-hexin-kimi-k27-code-image-capability.md` establish that
  `agent/runner.ts` only gates whether a model supports image input at all.
- `2026-06-16-frontend-design-visual-region-binding-materializer.md` requires
  frontend-design to use real PNG crops/atlases for large visual references
  instead of prose-only references or fake SVG wrappers.

## Grep Inventory

Commands:

```powershell
rg -n "attachmentToBase64|toModelOutput|image-data|state\.attachments|dataUrlFromReference" packages/opencorvus/src/session packages/opencorvus/src/storage packages/opencorvus/test -S -g "*.ts"
rg -n "url_screenshot|webfetch|read image|buildMultimodalToolResult|attachments.*image" packages/opencorvus/src packages/opencorvus/test -S -g "*.ts" -g "*.txt"
rg -n "PNG|JPEG|WebP|image dimensions|8000|sharp|pngjs" packages/opencorvus/src packages/opencorvus/test specs/new-arch -S -g "*.ts" -g "*.md" -g "*.txt"
```

| Surface                                                          | Finding                                                         | Decision                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/opencorvus/src/session/message.ts::attachmentToBase64` | Converts tool-result attachments into AI SDK `image-data`.      | Add the hard image-size boundary here for tool output media.                   |
| `packages/opencorvus/src/session/message.ts::userFileUrl`        | Converts stored user file parts into provider-bound data URLs.  | Add the same hard image-size boundary here for user/task attachments.          |
| `packages/opencorvus/src/session/prompt/parts.ts`                | Persists incoming data/file attachments into `AttachmentStore`. | Do not reject at persistence time; persistence is storage, not model delivery. |
| `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts` | Returns live URL screenshot attachments.                        | Keep tool behavior; the model-delivery layer owns the provider limit.          |
| `packages/opencorvus/src/tool/multimodal-result.ts`              | Returns persisted image refs for visual comparison tools.       | Keep transport; all callers converge through `Message.toModelMessages`.        |
| `packages/opencorvus/src/agent/runner.ts`                        | Filters by model modality support only.                         | Do not add provider-dimension logic here; the byte-to-model boundary is lower. |

## Fix

1. Add a small session-level image input module that decodes dimensions from
   PNG, JPEG, and WebP bytes/data URLs without resizing or dropping bytes.
2. Define one hard limit for model-bound image input: max width or height is
   8000 pixels.
3. Throw a typed local error before `image-data` or provider-bound file data
   is emitted when an image exceeds the limit.
4. Include MIME, filename/URL label, dimensions, and limit in the error.
5. Do not auto-resize, strip, or replace images. Oversized images require an
   explicit caller/tool strategy such as viewport screenshots, scroll slices,
   region crops, or coordinate atlases.

## Acceptance

- Oversized stored image attachments fail locally before provider contact.
- Oversized data URL tool-result images fail locally before provider contact.
- Valid small image attachments continue to become model-bound file/image-data
  parts.
- The error is typed and machine-checkable, not a provider 400 string match.
- No frontend-design-only branch or model fallback path is added.
