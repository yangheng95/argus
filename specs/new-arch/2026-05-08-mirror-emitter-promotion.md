# Mirror Emitter Promotion

Date: 2026-05-08

## Problem

The mirror analyze tools already build a deterministic `ProjectScaffold` and emit
`design-tokens.ts` plus `App.tsx`, but the generated source is written under
`mirror/` and then treated as reference material. That creates two independent
implementation paths:

- mirror algorithms produce React/TSX contracts and generated source;
- build skills still ask agents to hand-write a separate static page or copy
  mirror files manually into `src/`.

The current `FileContract.filePath` values are not safe to promote directly.
URL analysis hard-codes `packages/app/src`, while image and Figma analysis hard-code
slightly different token paths. Treating those paths as project truth would make
OpenCorvus a single-layout app generator instead of a general tool.

## Decision

Promote the emitter through a single materialisation layer.

1. Keep mirror analysis deterministic, but replace the upstream mirror
   `packages/app/src` path assumption with OpenCorvus' source layout contract.
2. Add an explicit React source layout abstraction for generated project source.
3. Before any analyze tool writes generated source, project the scaffold onto that
   layout and write every generated source file in one operation:
   - token file;
   - root `App.tsx`;
   - section files;
   - sub-component and shared component files.
4. Keep `mirror/` for factual and evaluation artifacts only:
   - extracted inputs;
   - compact IR;
   - `scaffold.json`;
   - `shared-context.md`;
   - reference/render/evaluation artifacts;
   - extracted images.
5. Do not remove runtime evidence guards. Update their wording so they reject
   incomplete generated skeletons, not a specific `mirror/App.tsx` filename.

## Non-Goals

- No vanilla-HTML compatibility path.
- No dual write of generated source to both `mirror/` and `src/`.
- No package-specific source path such as `packages/app/src`.
- No runtime fallback that copies old `mirror/App.tsx` into source after the fact.

## Acceptance

- `webpage_analyze`, `webpage_image_analyze`, and `figma_analyze` write
  `scaffold.json` and `shared-context.md` under `mirror/`.
- The same tools write generated React source under the configured source layout.
- `App.tsx` imports section files that exist in the same write pass.
- `scaffold.json` records the same source paths the tools wrote.
- Skill and prompt text describe generated source as the implementation starting
  point, not reference material and not a manual copy task.
- Skill and prompt text must read generated source paths from `scaffold.json`
  or analyze `sourcePaths`; they must not duplicate the default source layout
  strings such as `src/App.tsx` or `src/design-tokens.ts`.
- Acceptance still rejects non-rendered or DOM-thin generated skeletons.
- Focused tests cover path projection, source emission, and prompt/guard wording.
