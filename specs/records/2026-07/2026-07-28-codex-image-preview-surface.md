# Codex-style Image Preview Surface

## Recall

| Item | Record |
| --- | --- |
| User requirement | Restore visible rounded corners on the screenshot/image popup and redesign the image-preview dialog using the Codex app as the interaction and visual reference. |
| Acceptance criteria | The one shared image-preview dialog has an unmistakable token-owned outer radius; the viewer reads as an immersive image canvas rather than a dense application window; the filename, viewing controls, copy feedback, and close action remain accessible without competing for one narrow title row; zoom, fit-width, fit-image, 1:1, copy, pointer pan, modified-wheel zoom, Escape/backdrop close, and authenticated image loading keep their current behavior; a real desktop fixture is opened, interacted with, screenshot, and visually reviewed. |
| Hard constraints | Reuse `ImagePreviewHost`, the Kobalte-backed `Dialog`, `Button`, `Icon`, existing preview state/service, localization, and scale utilities. Do not create a second lightbox, handwritten modal primitive, fallback, parallel image source, temporary iframe, query override, mobile scope, or global zoom. Do not restart or refresh the user's running OpenCorvus/Overlay. Playwright runs through Node against an isolated fixture. Preserve unrelated dirty worktree changes and stage only task-owned hunks. |
| Sources read | `AGENTS.md`; Browser control skill; the user screenshot; `ImagePreview.tsx`; `ui/Dialog.tsx`; `services/image-preview.ts`; `utils/image-preview-{scale,trigger,label}.ts`; `styles/surfaces/{dialog,messages}.css`; `styles/tokens/design-language.css`; `message-image-preview.test.ts`; `browser/{image-preview-copy,conversation-image-attachments,image-preview-accessible-name,image-preview-ownership-browser,screenshot-browser-panel-browser}.test.ts`; `specs/current/architecture/07-panel.md`; relevant July records. |
| Whole-repository grep | `ImagePreviewHost` is mounted once by `App`; `PreviewableImage` is the shared trigger used by Markdown, messages, composer attachments, browser evidence, and Screenshot Browser. `services/image-preview.ts` is the only open/close state owner. `ImagePreview.tsx` is the only toolbar/pan/scale/copy implementation. `messages.css` is the only image-viewer geometry owner and currently overrides the shared `--oc-radius-xl` Dialog frame with `--oc-radius-soft`, then packs the title and every control into a 40px header. Existing unit and browser tests cover every trigger, localization, copy ownership/failure, scale math, pan/wheel behavior, accessibility, protected resources, Screenshot Browser opening, and desktop screenshots. The general `.dialog-form` already uses `--oc-radius-xl`; fullscreen is the only intentional zero-radius Dialog mode. |
| External reference check | Current official OpenAI product material confirms image and screenshot context as first-class Codex app content, but does not publish a stable implementation-level viewer specification. The implementation therefore uses the observable Codex desktop composition named by the user—quiet immersive canvas, detached compact chrome, clear dismissal—and keeps OpenCorvus primitives and tokens as the source of truth. |

## Causal analysis

| Layer | Evidence |
| --- | --- |
| Observable symptom | The supplied screenshot shows a nearly square outer frame and a dense full-width titlebar whose filename, zoom, fit, copy, and close affordances visually merge. |
| Direct trigger | `.dialog .image-preview-dialog__form` replaces the shared modal radius with `var(--oc-radius-soft)`. Its header is a fixed-height horizontal strip, while `.image-preview-dialog__toolbar` allows wrapping and carries all controls plus asynchronous copy feedback. |
| Deeper cause | The image viewer is modeled visually as a conventional utility window even though its primary job is focused media inspection. Presentation chrome owns too much visual weight and the picture receives only the remaining rectangular body. |
| Why earlier behavior did not solve it | Functional work added width/fit/1:1, copy, authenticated loading, and robust zoom scheduling without revisiting the composition. Those behaviors are correct, but accumulating them in the original header amplified the visual defect. |

## Call-site disposition

| Owner | Disposition |
| --- | --- |
| `ImagePreviewHost` / `PreviewableImage` | Keep as the single component and trigger contract. Restructure only its visible chrome into a detached filename label, grouped viewing toolbar, independent close action, and canvas body. |
| `Dialog` / Kobalte root | Keep unchanged as the focus, modal, portal, Escape, and backdrop owner. The image viewer continues to specialize it through `formClass`. |
| `services/image-preview.ts` and scale/trigger helpers | Keep unchanged as the state, request ownership, scale, and accessible-trigger sources. |
| `messages.css` image-preview rules | Replace the window-like strip with one tokenized rounded viewer frame, clipped immersive canvas, and floating chrome. Remove the local soft-radius downgrade and toolbar wrapping. |
| Existing image-preview consumers | Keep unchanged; they continue to open the same host. |
| Focused tests | Extend source assertions for the radius/chrome contract and real browser geometry. Reuse the existing Node browser fixture to capture and inspect the actual open viewer. |

## Implementation and verification

1. Restructure `ImagePreviewHost` without changing its behavior owners.
2. Replace only the image-preview surface rules in `messages.css`; preserve the shared Dialog primitive and global radius tokens.
3. Update focused unit and browser assertions for the restored outer radius, detached chrome geometry, no toolbar wrap, viewport containment, focusability, and existing image operations.
4. Build the Overlay, run the isolated Node browser fixture, inspect fresh screenshots, correct visual defects, and repeat until accepted.
5. Run focused tests, Overlay typecheck, documentation health/link checks, inspect the scoped diff, commit with the required `dsw-33987` prefix, and push the current branch to `myhexin`.

## Verification evidence

| Check | Result |
| --- | --- |
| Focused unit coverage | `bun test packages/overlay/test/message-image-preview.test.ts packages/overlay/test/dialog-primitive.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts` passed 29 tests with 0 failures. |
| Production render build | `bun run --cwd packages/overlay build:vite` completed successfully. |
| Real browser interaction | `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/image-preview-copy.test.ts` passed the isolated desktop fixture. It exercised the canonical Work Ledger-to-conversation path, opened generic and authenticated images, verified copy success/failure ownership, zoom/fit controls, wheel zoom, pan, Escape/backdrop/close behavior, focus return, and viewer geometry. |
| Visual review | The fresh dark-theme screenshot at `.scratch/image-preview-codex-surface-dark.png` shows a 24-pixel token-owned outer radius, clipped immersive canvas, rounded image surface, detached filename and viewing toolbar, and an independent circular close action. The viewer no longer reads as a dense full-width utility window. |
