# Retire mirror Algorithms

Date: 2026-06-03

## Problem

`mirror` was a legacy algorithm package. Renaming it to `webpage-evidence` keeps
the same architectural smell: a standalone package owning URL extraction,
Figma REST, image-to-code, XML IR, deterministic pattern detection, scaffold
generation, visual scoring, and frontend-design tool wrappers. The current
product no longer needs most of that kernel. The useful parts should live where
they are actually used.

## Inventory

| Area                                                                     | Current dependency                                                                                                                                                  | Decision                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend-design agent tool surface                                       | `webpage_extract`, `webpage_compile`, `webpage_analyze`, `webpage_runtime_state`, `webpage_render`, `webpage_evaluate`, `webpage_text_diff`, `webpage_vision_judge` | Keep tool IDs, move implementation under `src/frontend-design/`.                                                                                                                                            |
| URL DOM extraction                                                       | `src/webpage-evidence/url/extract.ts`                                                                                                                               | Keep as browser webpage capture evidence under `src/browser/webpage/`; browser execution must use the packaged Node sidecar, not Bun-side Playwright launch.                                                |
| Runtime state capture                                                    | `src/webpage-evidence/url/runtime-state.ts`                                                                                                                         | Keep under `src/browser/webpage/`; it already uses the browser Node sidecar.                                                                                                                                |
| Screenshot render                                                        | `src/webpage-evidence/visual/render.ts`                                                                                                                             | Keep under `src/browser/webpage/`; it is browser rendering evidence, not mirror.                                                                                                                            |
| Numeric visual evaluation                                                | `src/webpage-evidence/visual/evaluate.ts`                                                                                                                           | Keep under `src/verification/visual/`; visual verification is a cross-stage verification primitive.                                                                                                         |
| HTML archive to `page.ir.json` + assets                                  | `web-clone/archive-html.ts`, `web-clone/ir.ts`, `web-clone/layout.ts`, `web-clone/source-skeleton.ts` plus wrapper code in `webpage_compile` / `webpage_analyze`    | Keep in `src/web-clone/`. `webpage_compile` should only call these canonical APIs; remove legacy XML compatibility generation.                                                                              |
| `ProjectScaffold`, URL pattern detection, source materialization helpers | `src/webpage-evidence/ir/scaffold.ts`, `url/pattern/*`, `shared/scaffold-helpers.ts`                                                                                | Delete. Current frontend-design prompt consumes `web-clone-source/source-ir/*`, `visual-surface-candidates.json`, source skeleton, and reference image. The ProjectScaffold branch is duplicate provenance. |
| Figma REST algorithms                                                    | `src/webpage-evidence/figma/*`, `CompressedDesign`                                                                                                                  | Delete. Product Figma evidence comes from Figma MCP through frontend-design, not REST mirror algorithms.                                                                                                    |
| Image-to-code algorithms and tools                                       | `src/webpage-evidence/image/*`, `ImageAnalysis`, `webpage_image_*`, `image-generate.md`                                                                             | Delete. Screenshot references are handled by frontend-design multimodal context and source-region workflow, not a parallel image2code toolchain.                                                            |
| XML IR compatibility                                                     | `src/webpage-evidence/url/compile.ts`, `ir/xml-ir.ts`, `page-ir.xml`, `buildClonePrompt`                                                                            | Delete. Canonical structure is `web-clone/page.ir.json` and source handoff files.                                                                                                                           |
| Task runtime artifact directory                                          | `.opencorvus/runtime/tasks/<task>/frontend-design/webpage-evidence/`                                                                                                | Keep artifact name. It is a runtime evidence directory, not a package/module. Do not accept or promote `frontend-design/mirror/` as compatibility input.                                                    |

## Implementation Rules

- No `src/mirror` and no `src/webpage-evidence` package may remain.
- No `test/mirror` or `test/webpage-evidence` package-level test suite may
  remain. Tests move with the surviving module owners.
- `webpage_image_*` is removed from registry, frontend-design static tools, and
  skill metadata.
- `page-ir.xml`, `shared-context.md`, and `visual-surface-scaffold.json` are no
  longer required primary artifacts. `visual-surface-candidates.json` remains
  only if generated from `web-clone` segments/source IR.
- The artifact path string `webpage-evidence/` is allowed in prompts and runtime
  paths. The legacy artifact path string `mirror/` must not be accepted as an
  alias, promoted, or materialized.
- URL extraction, runtime state capture, and screenshot rendering all run
  browser automation through the packaged Node sidecar. This removes the
  Windows Bun+Playwright launch path that caused frontend_design Chrome startup
  hangs and timeout-shaped failures.

## Verification

- Production scan for `@/webpage-evidence`, `src/webpage-evidence`,
  `webpage_image_`, `ProjectScaffold`, `CompressedDesign`, `ImageAnalysis`,
  `page-ir.xml`, and `buildClonePrompt` must return no implementation
  references. Tests may contain negative assertions proving the retired strings
  are absent.
- Typecheck must pass.
- Focused tests must cover frontend-design tool registry, live webpage evidence
  pipeline, web-clone source package generation, browser render/runtime state,
  browser webpage extraction, visual evaluation, and overlay frontend-research
  cards.
