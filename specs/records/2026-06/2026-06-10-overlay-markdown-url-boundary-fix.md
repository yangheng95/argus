# Overlay Markdown URL Boundary Fix

Date: 2026-06-10
Status: Implementation plan

## Acronyms

- URL: Uniform Resource Locator, the address rendered as a clickable browser target.
- UI: User Interface, the visible overlay message and tool output surface.
- GFM: GitHub Flavored Markdown, the Markdown dialect used by `marked`.

## Problem

Tool output JSON such as `{"url":"http://localhost:3006/world-economy/","title":"World Economy"}` is rendered through the shared Markdown renderer. `marked` GFM bare URL detection can consume JSON punctuation and following fields as part of the URL, so the visible link can extend past the real URL. This causes incorrect click targets in conversation and tool output bodies.

## Call Point Inventory

| Area                        | Call points                                                                                          | Action                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Markdown renderer    | `packages/overlay/src/utils/markdown.ts`                                                             | Replace default GFM bare URL detection with a `linkify-it` backed inline token. Keep explicit Markdown links, images, code blocks, and file-link codespans unchanged. |
| Text messages               | `packages/overlay/src/components/TextPart.tsx`                                                       | Preserve use of `renderMarkdown`; no separate link logic.                                                                                                             |
| Tool output bodies          | `packages/overlay/src/components/InlineToolPart.tsx`                                                 | Preserve `StaticTextPart`; no tool-specific URL extraction.                                                                                                           |
| Click-to-preview delegation | `packages/overlay/src/main.tsx`                                                                      | Preserve `data-browser-preview-url` as the only click source.                                                                                                         |
| Package dependency          | `packages/overlay/package.json`, `bun.lock`                                                          | Declare `linkify-it` directly because overlay imports it.                                                                                                             |
| Tests                       | `packages/overlay/test/markdown-safety.test.ts`, `packages/overlay/test/message-url-preview.test.ts` | Add JSON-boundary assertions and keep shared renderer guard.                                                                                                          |

## Design

Use `linkify-it` as the single plain-text URL recognizer inside the existing renderer. Disable `marked`'s default `tokenizer.url` path so there is no second bare-URL implementation. Explicit Markdown links continue through the existing `renderer.link`, which owns URL safety and `data-browser-preview-url` attributes.

This is not a backend preview target change. Backend task-scoped preview target extraction remains in `packages/opencorvus/src/browser-preview/extract.ts` and is not part of the screenshot bug.

## Acceptance

- JSON tool output links only the value of the `url` field.
- Adjacent JSON fields remain plain text.
- Existing explicit links, `www.` bare links, mailto safety, file codespans, and code-block rendering remain covered by tests.
