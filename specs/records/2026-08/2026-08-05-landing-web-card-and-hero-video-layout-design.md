# Landing Web card and hero video layout design

## Recall

### User request

1. Give the Web application download card a pale green theme so it is visibly distinct from the native installers.
2. Let the landing hero video own a full row at a larger size, with the hero title and description above it.
3. Remove the four runtime-surface card images from presentation and compress those cards into a compact text-only row while retaining their numbers, titles, and descriptions.
4. After reviewing two generated rounds, adopt the approved balanced software-Agent illustrations: each image has one central module plus four supporting modules, a restrained black/white interface palette, and small blue/cyan state accents.

The user supplied current Chinese desktop screenshots for both regions. This request supersedes the interrupted distribution-only build investigation; after the visual changes, the current landing site must still compile and render from the canonical page.

### Acceptance criteria

- Only the Web application card receives the pale green theme; Windows, macOS, and Linux cards retain their current white treatment.
- The Web card keeps the existing new-tab URL behavior and receives a coordinated deep-green action button.
- The hero has one text row followed by one full-width video row. The video remains the existing 1 minute 36 second source, keeps native controls, caption, poster, and accessible label, and is materially wider than the previous split-column presentation.
- The hero title and description use the complete content row and wrap only when their text naturally exceeds it; font size and line height remain unchanged.
- Chinese and English desktop routes preserve readable title wrapping and the existing 78rem content alignment.
- The four runtime-surface cards use only the user-approved generated assets, retain their ordered number/title/description contract, and stay materially shorter than the former 28rem full-background cards by separating a 3:2 image region from compact copy.
- All four illustrations share the same moderate information density and deep-charcoal canvas, with dark software modules, restrained gray edges, and small blue/cyan accents that merge with the section instead of producing a white rectangular break.
- No new component, content source, layout state, breakpoint, dependency, or duplicate video path is introduced.

### Hard constraints

- Desktop-only scope; do not add mobile or responsive acceptance.
- Do not add, modify, update, or run User Interface automated tests, DOM assertions, source-string assertions, snapshots, screenshot baselines, or pixel comparisons.
- Use the existing `Lander.astro` renderer, existing download catalog, and existing video source as the only runtime owners.
- Complete real-page interaction and screenshot review before delivery.
- Commit subjects begin with `dsw-33987` and push `v0.0.30beta` to `myhexin` without bypassing hooks.

### Sources reviewed

- `packages/web/src/components/Lander.astro`
- `packages/web/src/content/landing.ts`
- `specs/records/2026-08/2026-08-05-landing-alignment-preview-scroll-design.md`
- `specs/records/2026-08/2026-08-05-landing-alignment-preview-scroll-implementation-plan.md`
- Commits `e00f09b72c`, `caed01208a`, and `ddfb8ad173`
- User screenshots `codex-clipboard-668a2e24-f595-4b97-a65e-e6e397270a94.png` and `codex-clipboard-3da76ea6-6418-4335-a214-182ec087fafa.png`
- User refinement screenshots `codex-clipboard-67a8b3bc-e9c3-48ac-8c6a-446f041a4cfe.png` and `codex-clipboard-23451cb1-8c9a-44f2-888f-e757750407ba.png`

### Repository search result

The Web application card is the final article in `.download-card-grid` and already has a distinct markup branch for its external anchor. The hero already renders `.hero-copy` before `.hero-product`; the two-column presentation comes only from `.hero-section` CSS. The surface text remains owned by `landing.ts`; the approved generated bitmaps can be projected through one ordered `runtimeImages` array and one `.surface-media` branch without changing that content schema. No component split or second runtime owner is required.

### Independent agent feedback

No sub-Agent was dispatched because the user did not authorize delegation and the active multi-Agent policy forbids unsolicited spawning.

## Design alternatives

### Recommended: modifier class plus single-column grid

Add one `download-card-web` modifier to the existing Web article. Use a low-saturation mint surface, green border, and deep-green action button while inheriting the shared card structure. Convert `.hero-section` to one grid column, constrain the copy independently, and allow `.hero-product` to occupy the complete content width.

This is the smallest single-source change and exactly matches the screenshots and stated hierarchy.

### Rejected: text overlaid on video

Overlaying copy would add contrast and control-placement risks, and it conflicts with the explicit request that copy sit above the video.

### Rejected: dedicated Hero and DownloadCard components

The existing page has one renderer and no duplicated runtime behavior. Splitting components for two scoped CSS changes would increase indirection without improving ownership.

## Approved design

### Web application card

The Web article gains `download-card-web`. Its surface uses a pale mint fill and a restrained green border. The shared facts and typography remain unchanged, while the action button uses a deep forest green with a slightly lighter hover state. The external URL, `target="_blank"`, and `rel="noopener noreferrer"` stay intact.

### Hero hierarchy

`.hero-section` becomes a single-column grid. `.hero-copy` remains first and uses the complete 78rem row. The title and description remove their former `42rem`, `56rem`, and `35rem` measures and use normal wrapping, so each line fills the available width before continuing. Their current font sizes, weights, and line heights remain unchanged. `.hero-product` spans the same single content column, so the existing 16:9 video expands from the former right column to the full section width. Copy-to-video spacing remains generous enough to preserve the landing page's loose rhythm.

### Approved runtime-surface cards

The four accepted images are copied from Codex's generated-image store into versioned project assets rather than overwriting the retired bitmap set. One ordered `runtimeImages` projection binds them to the existing surface content. Each card uses a deep-charcoal 3:2 media area followed by compact light-on-dark copy; the number remains overlaid in the upper-right corner. After real-page review exposed an abrupt white block, only the generated canvases and card surface colors were changed to merge with the surrounding black section while preserving the approved modules and density.

### Error and interaction behavior

No new JavaScript is introduced. Video controls, poster loading, source fallback link, caption, and accessible label continue through the existing element. Card navigation remains a standard anchor.

## Verification design

- Run `bun run --cwd packages/web check`.
- Run the canonical landing build after required release assets are present; if a pre-existing artifact input is absent, report that boundary explicitly rather than bypassing validation.
- Start an isolated real preview and inspect both Chinese and English desktop routes in a visible browser.
- Capture task-scoped Chinese hero, download, compact-surface, and approved-image screenshots, plus an English hero screenshot, then review them manually for width, hierarchy, contrast, wrapping, balanced imagery, card compression, and preservation of the native cards.
- Run documentation health checks after indexing this record.

## Design self-review

- Placeholder scan: no unfinished choice, value, selector, or acceptance step remains.
- Consistency: both requested changes are owned by the current markup and CSS in `Lander.astro`.
- Scope: no responsive, content, media-source, or component-refactor work has been added.
- Ambiguity: “pale green” is defined as a mint surface plus green border and action, “video owns a row” is defined as the single-column hero's second row, and “fill the line” explicitly removes measure caps without forcing unbreakable text.
