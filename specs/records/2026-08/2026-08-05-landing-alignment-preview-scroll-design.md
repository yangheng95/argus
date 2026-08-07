# Landing alignment and preview scroll design

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Open the Web application entry in a new tab; make oversized image previews scroll inside the modal without scrolling the page behind it; align the two Expert Squad columns; left-align the closing title and description while letting the title fill its row before wrapping; slightly increase line height for every bold landing title. |
| Visual evidence | `codex-clipboard-9b47a156-eee2-4323-a01d-5c28993455ab.png` shows the requested Expert Squad top alignment. `codex-clipboard-457fc9a7-1f67-4c75-8251-a1910e4fb99f.png` shows the closing title wrapping too early, the paragraph beginning on a different horizontal line, and large title lines sitting too tightly. Both were opened at original detail. |
| Existing implementation | `packages/web/src/components/Lander.astro` owns the Web application anchor, native preview dialog, Expert Squad grid, closing grid, and every affected heading style. Bilingual copy remains in `packages/web/src/content/landing.ts` and does not require changes. |
| Recent history | Commit `ddfb8ad173` introduced the current landing recomposition. Before this task, `v0.0.30beta` was fast-forwarded to git-cc commit `982c99a36c`; the eight intervening commits do not touch the landing renderer. |
| Whole-scope grep | The Web entry anchor, preview listeners, dialog styles, Expert Squad column styles, CTA styles, and landing title styles all resolve to `Lander.astro`. No landing-specific User Interface automated test exists. |
| Hard constraints | Desktop-only visual delivery; no User Interface automated tests or source-string assertions; use the existing Astro/Starlight renderer and native dialog; do not add a second lightbox or global state owner; perform real visible-page interactions and screenshots; commit subjects begin with `dsw-33987`; push to `myhexin/v0.0.30beta`. |
| Independent agent feedback | None. The user did not request sub-Agent work, so delegation is not authorized. |

## Root-cause chain

### Preview scrolling

Observable symptom: a preview image can exceed the visible height, but wheel input moves the landing page behind the modal instead of the preview.

Direct trigger: `.image-preview-dialog` declares `overflow: visible`, its surface has a fixed `height: 100%`, and the image is capped to `max-height: 100%`. The dialog therefore owns no scroll range; wheel input can chain to the document.

Deeper cause: the previous repair established decode ownership and centering but did not establish scroll ownership. Centering and overflow were treated as the same constraint, so large content had no dedicated scroll container.

### Expert Squad alignment

Observable symptom: the first visible title glyph and the first capability-card border do not share an optical top line.

Direct trigger: the grid columns start on the same layout row, but the heading font's line box has top leading while the card border begins at its box edge.

Deeper cause: structural alignment exists, but the design lacks an explicit optical alignment adjustment between type and a bordered surface.

### Closing alignment and title rhythm

Observable symptom: the closing paragraph is centered within its own measure, the title wraps before consuming the available column, and large title lines appear crowded.

Direct trigger: the shared description selector applies automatic inline margins; the closing title retains `max-width: 14ch` and balanced wrapping; headline selectors use line heights between `0.95` and `1.04`.

Deeper cause: section-local closing requirements were still inheriting centering and compressed display-type rules intended for other landing sections.

## Approaches considered

### Recommended: local ownership in the existing renderer

Give the Web anchor standard new-tab semantics, make the native dialog the scroll container, optically align the Expert Squad proof column, and override CTA alignment/wrapping locally. Raise the existing title line heights in place. This keeps one markup source and one interaction owner.

### Global body scroll lock

Toggling a body class while the dialog is open would prevent background movement, but it would not create a usable modal scroll range and would add a second interaction state. It treats the symptom rather than the missing dialog overflow owner.

### Replacement lightbox component

A third-party gallery could solve scrolling, but replacing a functioning native dialog for one overflow defect adds dependency and migration cost without improving the requested page.

## Approved design

The user's explicit five-point correction request is the approved direction.

- The Web application anchor uses `target="_blank"` plus `rel="noopener noreferrer"`; binary downloads retain their current semantics.
- The native dialog keeps fixed viewport geometry but changes to `overflow: auto`, `overscroll-behavior: contain`, and stable scrollbars. The inner surface uses `min-height: 100%`, automatic height, and internal padding. Images keep full width containment but no viewport-height cap, so tall content produces dialog-owned vertical overflow while smaller images remain centered.
- The Expert Squad grid explicitly aligns both columns to the start; the proof column receives a small optical top inset matching the heading's visible glyph top.
- The closing copy has no artificial max width, its title uses the full available column with normal wrapping, and title/description margins are explicitly left aligned.
- Display-title line heights increase slightly and consistently: primary page/section headings move toward `1.08–1.12`; smaller bold card titles receive normal readable line heights without changing their size or weight.

## Verification contract

- Do not add, modify, or run User Interface automated tests, snapshots, Document Object Model assertions, or visual baselines.
- Run `bun run --cwd packages/web check` and `bun run build:landing-dist`.
- Run the required historical-document and document-health checks after indexing these records.
- Launch an isolated visible desktop preview with Node-launched browser tooling. Confirm the Web application opens a distinct tab; open a tall preview, wheel inside it, and confirm the dialog content scrolls while the landing document remains at its prior position; exercise close button and Escape.
- Capture and personally inspect fresh Chinese desktop screenshots of Expert Squads, the closing section, and the scrolled preview. Inspect the English route for headline wrapping regressions.

## Self-review

- Placeholder scan: all selectors, target behavior, overflow ownership, alignment direction, verification commands, and evidence regions are explicit.
- Consistency: the native dialog remains the only lightbox and owns decode, centering, and scrolling; no body-lock state or alternate gallery is introduced.
- Scope: only the five requested desktop landing corrections; no responsive redesign or unrelated content change.
- Ambiguity: “左右要对齐” is implemented as optical top alignment of the left heading and right capability-card region; “尽量撑满行” removes both the CTA character cap and balanced wrapping.
