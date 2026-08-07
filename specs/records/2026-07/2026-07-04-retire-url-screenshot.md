# 2026-07-04 Retire frontend-design url_screenshot

## Recall

User request:

- `退休 url_screenshot`

Acceptance criteria:

- `url_screenshot` is no longer a visible frontend-design tool.
- The retired tool implementation file is removed instead of left as dead code.
- Live webpage visual evidence uses the existing task-runtime webpage evidence and `web-clone-source/reference.png` path, not a second one-shot URL screenshot artifact.
- The design resource manifest no longer emits or accepts `origin: "url_screenshot"` / `source: "url-screenshot"`.
- `screenshotUrl` in webpage extraction and overlay evidence remains untouched; it is a data field, not the retired tool.
- Tests assert the retired tool is absent and that live URL evidence no longer calls URL screenshot materialization.

Hard constraints:

- No fallback or compatibility source for `url_screenshot`.
- No prompt/tool gate to hide the problem; remove the retired surface from the tool contract.
- Do not touch existing unrelated dirty work. Initial `git status --short` showed unrelated changes in prompt-profile, config, overlay, SDK, and `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`.
- Do not restart or interfere with running OpenCorvus / overlay processes.
- Do not alter `screenshotUrl` fields in `browser/webpage` or overlay browser evidence.

Sources read:

- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/records/2026-06/2026-06-09-task-scoped-browser-evidence-runner-consensus.md`
- `specs/records/2026-06/2026-06-18-frontend-design-authenticated-browser-proxy.md`
- `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts`
- `packages/opencorvus/src/frontend-design/static-tools.ts`
- `packages/opencorvus/src/frontend-design/agent.ts`
- `packages/opencorvus/src/frontend-design/design-resource-manifest.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/webpage-evidence.ts`
- `packages/opencorvus/src/browser/webpage/extracted-page.ts`
- `packages/opencorvus/test/agent/agent.test.ts`
- `packages/opencorvus/test/frontend-design/reference-capture.test.ts`
- `packages/opencorvus/test/frontend-design/webpage-default-viewport.test.ts`
- `packages/opencorvus/test/frontend-design/design-resource-manifest.test.ts`
- `packages/opencorvus/test/frontend-design/prompt.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/script/document-health.test.ts`
- `packages/overlay/test/screenshot-browser-panel.test.ts`
- `packages/opencorvus/test/session/message.test.ts`

Whole-repository search evidence:

- `rg -n "url_screenshot|url-screenshot|urlScreenshot|screenshotUrl|webpage_extract|webpage_analyze|webpage evidence|visual_reference|webpage_capture" packages specs -S`
- `rg -n 'createDesignResourceManifest|designResourceManifestFileRefs|source: "url-screenshot"|url-screenshot|url_screenshot|createUrlScreenshotTool|FRONTEND_DESIGN_STATIC_TOOL_IDS|FRONTEND_DESIGN_SESSION_TOOL_IDS' packages/opencorvus/src packages/opencorvus/test packages/overlay/test -S`
- `rg -n 'captureReferenceManifest|reference-capture|CaptureReferenceError|url screenshot|URL screenshot|url-screenshot|url_screenshot' packages/opencorvus/src packages/opencorvus/test specs -S`
- `rg -n 'liveUrls|ensureLiveWebpageEvidence|figmaUrls|materialPaths|frontend_design' packages/opencorvus/src/orchestrator/tools.ts -S`

Independent agent feedback:

- None spawned. The available multi-agent tool explicitly requires user authorization for subagents; the user asked for the retirement but did not request delegation. This record therefore uses direct code inspection, whole-repository grep, and tests as review evidence.

## Decision

Retire `url_screenshot` completely as an agent-callable tool and as a design-resource provenance value.

Live non-Figma URLs in `frontend_design.urls` already run through `ensureLiveWebpageEvidence()`, which materializes `fd/webpage-evidence/reference.png` and the visible `fd/web-clone-source/reference.png` package. The old one-shot screenshot loop in `orchestrator/tools.ts` is a duplicate visual source. Removing it makes webpage evidence the single source for live URL pixels.

Keep `captureReferenceManifest()` itself. It is a lower-level capture contract still used by reference-capture tests and content fingerprinting. Retiring `url_screenshot` does not imply deleting this primitive in the same change.

## Implementation Plan

1. Remove `url_screenshot` from `FRONTEND_DESIGN_STATIC_TOOL_IDS` and `FRONTEND_DESIGN_SESSION_TOOL_IDS`.
2. Remove `createUrlScreenshotTool()` import, construction, and spread from `frontend-design/agent.ts`.
3. Delete `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts`.
4. Remove `source: "url-screenshot"` handling from `design-resource-manifest.ts`; live webpage pixels are represented by webpage evidence artifact paths, not by a manifest entry.
5. Remove the generic URL screenshot materialization loop from `orchestrator/tools.ts`; keep Figma and local material materialization.
6. Update prompt/comment text so frontend-design is told to use task-runtime webpage evidence, not stored URL screenshot artifacts.
7. Update tests to assert absence of `url_screenshot`, absence of the retired file, no `url-screenshot` manifest source, and no orchestrator one-shot URL capture.

## Verification Plan

- `bun test packages/opencorvus/test/agent/agent.test.ts -t "frontend-design"`
- `bun test packages/opencorvus/test/frontend-design/prompt.test.ts packages/opencorvus/test/frontend-design/design-resource-manifest.test.ts packages/opencorvus/test/frontend-design/reference-capture.test.ts packages/opencorvus/test/frontend-design/webpage-default-viewport.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend_design"`
- `bun test packages/opencorvus/test/session/message.test.ts -t "resizes oversized tool result data URL images before image-data replay"`
- `bun test packages/overlay/test/screenshot-browser-panel.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run typecheck`
