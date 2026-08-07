# Overlay Markdown Deliverable Link Navigation Repair

Date: 2026-07-27
Status: Implemented and verified

UI means User Interface. URL means Uniform Resource Locator. PDF means
Portable Document Format. IDE means Integrated Development Environment.

## Problem

Clicking a Markdown link to a generated project deliverable such as
`Tesla_财务模型_2026Q2.xlsx` navigates the Overlay WebView itself. The mounted
conversation is unloaded and the application returns to its initial panel.

## Recall

| Item                       | Evidence or constraint                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Fix the initial-panel reset when a rendered Markdown deliverable link is clicked.                                                                                                                                                                                                                                                                                                                                      |
| Acceptance                 | The click stays inside the current Overlay task, resolves the link against the active project directory, and opens the file with the operating system's default application. HTTP links, `mailto:` links, code-path links, and structured file-part downloads retain their existing behavior.                                                                                                                          |
| Hard constraints           | Preserve unrelated untracked work. Do not restart or refresh the user's running Overlay. Use the existing shared Markdown renderer, document click delegation, workspace path resolver, host native-open transport, and real Node-launched browser fixture.                                                                                                                                                            |
| Sources read               | Root `AGENTS.md`; Browser skill; supplied screenshot; `specs/records/2026-06/2026-06-10-overlay-markdown-url-boundary-fix.md`; `specs/records/2026-06/2026-06-20-markdown-link-focus-visible.md`; shared Markdown renderer; global click delegates; workspace/native-open services; file-part renderer; message-file-link browser fixture and tests.                                                                   |
| Whole-repository grep      | `renderMarkdown` has one link renderer. `main.tsx` has one file-path delegate and one HTTP delegate. `editorTargetPath` is the only active-project relative-path resolver. `nativeOpen` is the only host-neutral default-application bridge. `FilePart` separately owns structured attachment downloads. `message-file-link-browser.test.ts` is the real Overlay fixture for Markdown link activation and screenshots. |
| Independent agent feedback | None. The user did not request delegation or parallel agents.                                                                                                                                                                                                                                                                                                                                                          |

## Causal chain

Observable symptom: clicking the `.xlsx` Markdown link returns the user to the
initial panel.

Direct trigger: the rendered anchor retains a relative `href`, while the two
document click delegates only intercept `data-file-path` code spans and
HTTP/HTTPS links. WebView therefore performs a same-window navigation.

Deep cause: the shared renderer classifies file-shaped code spans but does not
classify explicit Markdown destinations as project deliverables. Its file
extension set also excludes Office/PDF deliverables and its code-token
validation excludes Unicode filenames. The missing semantic marker prevents
the existing project path resolver and native host bridge from participating.

Why earlier paths did not root-fix this: URL preview work covers only HTTP and
HTTPS links; `FilePart` covers structured file message parts. Neither owns a
plain Markdown link to a generated workspace file.

## Complete call-point inventory

| Call point                                                        | Current role                                                                | Decision                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/utils/markdown.ts::renderer.link`           | Emits every explicit Markdown anchor.                                       | Recognize local deliverable destinations here and emit one project-file marker instead of a navigable relative URL. |
| `packages/overlay/src/utils/markdown.ts::extractFilePath`         | Recognizes code-path code spans.                                            | Preserve IDE-oriented behavior; share only the canonical file-extension source needed by both classifiers.          |
| `packages/overlay/src/main.tsx` document click delegates          | Own image preview, code-path IDE opening, and HTTP preview/native opening.  | Add project-deliverable activation beside the existing file delegate and always prevent WebView navigation.         |
| `packages/overlay/src/services/workspace.ts::editorTargetPath`    | Resolves relative paths against `activeDirectory`.                          | Reuse as the only path resolver; add a default-application opener that delegates to `nativeOpen`.                   |
| `packages/overlay/src/utils/native.ts::nativeOpen`                | Routes URLs and filesystem paths through host capabilities.                 | Reuse unchanged.                                                                                                    |
| `packages/overlay/src/components/FilePart.tsx`                    | Owns structured attachment preview/download.                                | Preserve unchanged; this is not a second Markdown-link implementation.                                              |
| `packages/overlay/test/markdown-safety.test.ts`                   | Tests rendered-link safety and attributes.                                  | Add Unicode Office/PDF project-link positive cases and URL/anchor negative cases.                                   |
| `packages/overlay/test/workspace-editor.test.ts`                  | Tests active-directory path resolution and host calls.                      | Cover default-application project-file opening.                                                                     |
| `packages/overlay/test/browser/message-file-link-browser.test.ts` | Real production Overlay link fixture, keyboard activation, and screenshots. | Add the reported Unicode `.xlsx` Markdown link; prove no document navigation and one resolved native open call.     |

## Implementation plan

1. Introduce one renderer-owned project-deliverable classifier with a shared
   extension source; reject schemes, fragments, queries, server attachment
   routes, and malformed control characters.
2. Emit a non-navigating anchor with the canonical project-file marker for
   recognized Markdown deliverables.
3. Add one workspace service that resolves through `editorTargetPath` and opens
   the absolute target through `nativeOpen`.
4. Extend focused unit tests and the existing Node/Vite browser fixture,
   including keyboard activation and screenshot inspection.
5. Run Overlay checks, documentation health, diff review, commit with the
   required `dsw-33987` prefix, and push the primary branch to legacy remote.

## Progress

- [x] Failure evidence, historical decisions, and complete call-point inventory recorded.
- [x] Shared renderer and click-path repair implemented.
- [x] Focused and real-browser regressions pass.
- [x] Visual screenshot review and second code review complete.
- [x] Commit and legacy remote synchronization complete.

## Verification

- `bun test packages/overlay/test/markdown-safety.test.ts packages/overlay/test/workspace-editor.test.ts`:
  24 passed, 0 failed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-file-link-browser.test.ts`:
  1 passed, 0 failed. The real rendered link produced exactly one
  `overlay_open_path` call for
  `D:/file-link/workspace/Tesla_财务模型_2026Q2.xlsx`, and the page URL did not
  change.
- `bun run build:vite` in `packages/overlay`: passed.
- Screenshot
  `.scratch/message-markdown-deliverable-link.png`: inspected at original
  resolution; the assistant card, heading, Unicode link, structured attachment,
  and tool row remain visible without overlap or clipping.
- `git diff --check`: passed.

Repository-wide TypeScript and document-health checks were also attempted.
They currently report unrelated concurrent worktree failures in virtual-list
component props, an untracked browser-preview service, two untracked July
records, quoted Chinese documentation paths, and an oversized scratch log.
None of those files or diagnostics intersects this repair's renderer,
workspace-opening service, click delegate, focused tests, or browser fixture.

## Codex second review

The second review found no alternate opener or navigation path. The browser
fixture was brought to the current runtime contract by providing the real
session-agent identity and required mailbox/catalog/file routes, placing
assistant Markdown in the production transcript shape, and asserting the
shared Button focus shadow. The review also confirmed that structured
attachments remain owned by `FilePart`, code paths remain owned by the selected
IDE path, and HTTP links remain owned by browser preview/native opening. The
new project-file marker therefore replaces the accidental WebView navigation
without creating a fallback or a second source.
