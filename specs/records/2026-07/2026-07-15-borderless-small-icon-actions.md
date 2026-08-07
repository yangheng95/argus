# Borderless Small Icon Actions

## Recall

- User request: the controls shown on a Project row should be borderless and unfilled; most small buttons should follow the same visual rule.
- Acceptance criteria:
  - shared small `icon-action` buttons have transparent borders, backgrounds, and shadows at rest, hover, and focus;
  - Project pin, new-chat, and delete controls do not add a local accent/danger fill or a filled action-rail patch;
  - hover still strengthens the glyph color, destructive actions remain semantically red, and keyboard focus remains visibly outlined;
  - focused tests, typecheck, a real rendered Project-row screenshot, and a second visual review pass succeed.
- Hard constraints: preserve the shared `Button` primitive; do not introduce a parallel button implementation, fallback, compatibility selector, or process restart; do not include concurrent unrelated worktree edits in this delivery.
- Sources read: `specs/current/architecture/99-principles.md` (project rules supplied in context), `packages/overlay/src/components/ui/Button.tsx`, `ProjectLedgerGroup.tsx`, `styles/primitives/button.css`, `styles/surfaces/sidebar.css`, `styles/surfaces/work-ledger.css`, `test/button-primitive-chrome.test.ts`, `test/project-delete-button.test.ts`, and the user-supplied screenshot.
- Whole-repository search evidence: `data-chrome="icon-action"` is produced by `App`, `AgentSessionReplyBox`, `ChatComposer`, `FileChangesView`, `FileEditorPane`, `FileExplorerPanel`, `ImagePreview`, `MemoryPanel`, `NotificationCenter`, `ProjectLedgerGroup`, `ProvidersPanel`, `TaskDirBar`, and `WorkLedger`; the shared interaction rule lives in `styles/primitives/button.css`, while Project-specific background overrides live only in `styles/surfaces/sidebar.css`. Task and Work Ledger rails already declare transparent resting chrome and therefore remain consumers of the corrected primitive.
- Independent agent feedback: none; the user did not request sub-agents, so this bounded repair is reviewed through focused tests and a separate post-implementation visual pass.

## Causal chain

The controls opt into the correct shared `icon-action` identity, but the broader ghost/danger hover rules still assign a background wash before the icon-action rule only changes color. Project actions then add their own accent/danger background and their absolutely positioned rail paints `--rail-surface`, which is the dark rectangular patch visible in the supplied image. The result contradicts the glyph-only intent even though the buttons have transparent borders.

## Implementation

1. Make `icon-action` explicitly own transparent background, border, and shadow in every interactive state while retaining color and the shared `:focus-visible` accessibility outline.
2. Remove Project-only hover fills and the filled action-rail background, then make the title and action rail real sibling grid columns so transparent actions cannot overlap text.
3. Update regression assertions to cover rest, hover/focus, danger, and the Project action container.
4. Run focused tests and typecheck; render the real Project row with the existing Node/Playwright browser harness, inspect its screenshot, and repeat after any visual correction.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| Shared `button.css` icon-action primitive | Replace wash inheritance with an explicit transparent interaction contract. |
| `ProjectLedgerGroup` pin/new-chat/delete | Keep markup and primitive identity; remove only local filled chrome in `sidebar.css`. |
| Task and Work Ledger row actions | Keep local geometry and semantic colors; consume the corrected shared background contract. |
| Composer, file, image, memory, notification, provider, and header icon actions | Keep markup; receive the same glyph-only small-button behavior from the single primitive. |
| Window controls and solid/outline buttons | Preserve dedicated chrome; outside this request. |

## Verification

```bash
bun test packages/overlay/test/button-primitive-chrome.test.ts packages/overlay/test/project-delete-button.test.ts packages/overlay/test/icon-action-primitive.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
cd packages/overlay && node test/browser-runner.mjs test/browser/project-ledger-group-browser.test.ts
```

## Verification result

- Focused unit regressions: 10 passed, 0 failed.
- Overlay typecheck: passed.
- Project Ledger real Node/Playwright browser test: passed with light and dark hover screenshots; computed action-rail and button backgrounds are transparent, borders are `0px`, and shadows are `none`.
- `document-health` and `product-docs-single-source`: 57 passed, 0 failed.
- `historical-docs-links`: 17 passed, 3 failed on pre-existing `packages/opencorvus/src/expert-squad/payload.ts` references to retired `docs/merge` / `docs/todos` paths and one unrelated 5-second governance-test timeout. The failing source is unchanged by this task.
