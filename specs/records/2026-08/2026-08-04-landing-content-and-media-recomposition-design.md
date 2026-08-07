# Landing content and media recomposition design

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Add a Linux download card and a Web application entry; remove the hero download/proof controls and hero eyebrow; move the existing 01:36 video into the hero and remove its former long-video section; move the Mission-flow graphic into Expert Squads; remove the Expert Squad package list and differentiation eyebrow; replace the four runtime-card icons with generated full-bleed scene images; remove the footer and retain only the expanded closing mark/title/description; center image previews and prevent the previously selected image from flashing. |
| Acceptance target | Desktop landing page at the real English and Simplified Chinese routes, with the six requested structural changes, four coherent generated scene images, working static Linux/Web entry cards, and a manually verified lightbox that opens centered with only the newly selected image. |
| Existing implementation | `packages/web/src/components/Lander.astro` owns the complete landing structure, video, Mission-flow render, four runtime cards, footer, and native image-preview dialog. `packages/web/src/content/landing.ts` owns bilingual copy. `packages/web/src/lib/landing-download.ts` and `script/build-landing-dist.ts` own static release inventory/copying. |
| Artifact evidence | The Linux package is the non-empty file `packages/overlay/dist-artifacts/linux-x64/OpenCorvus-v0.0.30beta-linux-x64` (208,814,536 bytes). The existing hero video is `packages/web/public/media/opencorvus-client-demo.webm` and its copy describes a duration of 01:36. |
| Existing records read | `2026-08-03-independent-developer-landing-page-design.md`, `2026-08-04-independent-developer-landing-page-implementation-plan.md`, `2026-08-04-landing-platform-download-dialog-design.md`, `2026-08-04-landing-platform-download-dialog-implementation-plan.md`, and the current landing source/catalog/build script. |
| Whole-scope grep | Landing promotional copy resolves to `packages/web/src/content/landing.ts`; the corresponding renderer is `packages/web/src/components/Lander.astro`. `landingDesktopDownloads` is consumed only by the landing renderer, distribution builder, and positive non-UI distribution contract. No landing-specific User Interface automated test exists under `packages/web`. |
| Root-cause evidence for preview bug | The click handler writes the next `img.src` onto the already visible dialog image and calls `showModal()` synchronously. The element therefore retains the decoded bitmap from the previous source until the new source loads. The dialog also lacks explicit `inset`/`margin` viewport geometry, leaving centering vulnerable to document/theme dialog styles. |
| Hard constraints | Desktop-only delivery; no User Interface automated tests; use the existing Astro/Starlight stack and native dialog; keep one static package catalog and one real video/Mission-flow renderer; generated images must be workspace assets; real-page screenshot inspection is mandatory; commits start with `dsw-33987` and push to `myhexin/v0.0.30beta`. |
| Independent agent feedback | None. The user did not request sub-Agent or parallel-agent work, so no delegation is authorized. |

## Approaches considered

### Recommended: direct data-driven recomposition

Keep the existing single landing renderer and static release catalog, replace section ownership in place, and introduce only the four raster assets. This preserves one source for every visible module, uses the already shipped video and Mission-flow component, and keeps the distribution path explicit.

### Split every section into new components

This would reduce the size of `Lander.astro`, but the changed sections are tightly coupled by one page-local style system and do not yet have independent consumers. The additional files would add indirection without improving this delivery.

### Patch the current markup with visibility classes

This would be fastest initially, but it would retain the removed hero controls, package list, demo section, and footer as dead alternate structures. That conflicts with the repository's single-source and no-compatibility requirements.

## Approved design

The user's explicit six-point request is the approved direction. The implementation uses the recommended direct recomposition.

### Hero and section flow

The hero becomes a two-column title/description plus existing 01:36 video composition. The eyebrow, download button, and three proof pills are removed from both the content contract and markup. The former full-width demo section is deleted; its video is rendered exactly once in the hero.

The Expert Squads section retains its title, description, four capability cards, and four existing screenshots. The differentiation eyebrow and Base/Advanced/Research Studio package list are deleted. The existing `LandingMissionFlow` renderer moves into this section as a dedicated proof panel, so the graphic has one renderer and no duplicated HTML.

### Download and Web entry

The static package catalog adds `linux-x64` with source directory `packages/overlay/dist-artifacts/linux-x64`, exact installer filename `OpenCorvus-v0.0.30beta-linux-x64`, and public path `downloads/linux-x64/OpenCorvus-v0.0.30beta-linux-x64`. The existing distribution copier handles it through the same directory inventory contract as Windows and macOS.

The Web application is a separate immutable catalog entry because it has no local artifact to copy. It renders as the fourth card and links to `https://mirror.myhexin.com/opencorvus/ui/` in the same page. Bilingual labels distinguish the native package cards from the Web entry without inventing an installer type.

### Runtime scene imagery

Generate four dark, monochrome-blue landscape illustrations with the same visual language: restrained cinematic 3D/editorial scenes, no text, no logos, no watermarks, and strong edge-to-edge crops. Each image maps to one existing runtime capability:

1. Desktop continuity: a workstation with persistent connected work surfaces.
2. Headless runtime: a quiet rack/server process continuing without a screen.
3. Channel reach: multiple communication endpoints converging into one protected work stream.
4. Scheduled repository automation: repository branches and a timing mechanism triggering a delivery pipeline.

Each card becomes an image-led tile: the image fills the upper visual field edge to edge, while the existing number, title, and description remain readable in the lower field. The old icon type and icon renderer are removed.

### Closing section

Delete the footer completely. Expand the existing light closing section to use the large product mark, title, and description only. Remove its eyebrow so the retained content exactly matches the requested title and paragraph. The section receives more vertical space and a wider title/description measure.

### Image-preview root repair

The preview dialog remains the one native lightbox. On trigger:

1. capture the requested source and alternative text;
2. clear the visible image source/alternative text and remove its ready state;
3. create a detached `Image`, assign the new source, and wait for `decode()`/load completion;
4. ignore completion if a newer trigger request superseded it;
5. copy the decoded source and alternative text to the dialog image, mark it ready, and then open the dialog.

The dialog receives explicit fixed viewport geometry (`inset: 0; margin: auto`) and its surface is a bounded flex/grid centering owner. Closing clears the displayed source so the previous bitmap cannot be reused on the next open. This changes the data-flow owner instead of masking the old image with a timed animation.

## Verification contract

- Positive non-UI distribution contract covers Windows, macOS, and Linux artifact copy results plus the exact Web application URL.
- Run Astro type checking and production build.
- Run the required historical-document, document-health, and product-document single-source checks after indexing this record.
- Do not add, modify, or run User Interface automated tests, snapshot tests, source-string assertions, or visual baselines.
- Launch an isolated real landing preview with Node-compatible tooling, open both locale routes, capture desktop screenshots for the hero, download grid, Expert Squads/Mission flow, runtime image cards, and closing section, and personally inspect them.
- Interactively open at least two different landing images in sequence and inspect the transition and centered geometry. This is a one-off manual visual acceptance path, not a repeatable test artifact.

## Self-review

- Placeholder scan: no deferred copy, URL, artifact path, asset role, or interaction state remains.
- Consistency: the video and Mission flow each have one renderer; package files and the Web application have distinct catalogs matching their delivery semantics.
- Scope: desktop landing presentation and its static distribution contract only; no mobile redesign or unrelated documentation redesign.
- Ambiguity: “铺满的图片” means an edge-to-edge image field within each capability card, while the title and description remain in a separate readable lower field.
