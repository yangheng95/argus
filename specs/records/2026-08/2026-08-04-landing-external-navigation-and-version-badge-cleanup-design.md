# Landing navigation, version badge, and monochrome visual design

## Recall

### User request

- The user first requested removing all landing-page source/document navigation, deleting corresponding Markdown files and unused packaged output, and simplifying the theme.
- After inspecting that the current website contains 102 Markdown/MDX documents and about 105 generated routes, the user explicitly selected the narrower option: keep the documentation site and remove only source/document navigation from the promotional landing page.
- The user clarified that the existing interaction structure is acceptable, but corrected the visual scope: the landing page must still adopt the previously proposed black, white, and gray minimalist treatment. The download card must also lose its upper-right version badge.

### Acceptance criteria

- The English and Simplified Chinese landing pages expose no link or button that navigates to product documentation or source control.
- Documentation source files, Starlight routes, generated documentation pages, and architecture explorer pages remain intact.
- Internal landing navigation, language switching, demo media, image enlargement, and the direct Windows x64 installer download remain unchanged.
- The Windows download card no longer renders its upper-right version badge.
- The promotional landing page uses only black, white, and neutral gray interface colors; green accents, gradients, glow effects, and decorative shadows are removed.
- Primary actions are black on light surfaces and white on dark surfaces; content cards are white with fine neutral borders, while section separation uses white, light gray, and solid black surfaces.
- Existing product screenshots and the demo video remain unchanged as product evidence rather than being recolored.
- Content-model fields and CSS selectors that exist only for removed landing controls are deleted rather than retained as dead compatibility code.
- The real English and Simplified Chinese pages are opened in a visible browser, screenshotted, and personally reviewed without creating or running UI automation tests.

### Hard constraints

- Do not delete or alter the documentation Markdown/MDX corpus.
- Do not remove Starlight or documentation build dependencies.
- Do not change the landing information architecture, content order, media evidence, or interaction semantics while applying the monochrome visual system.
- Do not add fallback navigation, hidden links, alternate buttons, or a second content source.
- Do not add, update, or run UI automation tests. UI acceptance is real-page interaction plus screenshots and manual review.
- Preserve the static Windows artifact copy and direct download contract introduced by the current landing distribution work.
- Stage only task-owned files and use the required `dsw-33987` commit prefix before pushing to the `myhexin` remote.

### Sources read

- `AGENTS.md`
- `packages/web/src/components/Lander.astro`
- `packages/web/src/content/landing.ts`
- `packages/web/src/content/docs/index.mdx`
- `packages/web/src/content/docs/zh-cn/index.mdx`
- `packages/web/src/components/Hero.astro`
- `packages/web/src/components/Head.astro`
- `packages/web/src/styles/custom.css`
- `packages/web/src/content.config.ts`
- `packages/web/astro.config.mjs`
- `packages/web/package.json`
- `specs/records/2026-08/2026-08-04-static-landing-native-downloads-design.md`
- `specs/records/2026-08/2026-08-04-static-landing-windows-download-implementation-plan.md`

### Repository search evidence

- `packages/web/src/content/docs` contains 102 Markdown/MDX documents, so deleting the documentation site would be a materially different product change.
- `Lander.astro` owns every promotional-page documentation/source navigation surface: header documentation and source actions, hero quickstart action, scenario detail links, operating-surface links, final call-to-action links, and footer documentation/source links.
- `landing.ts` owns the bilingual labels and destinations for those controls. Removing both renderer and content fields keeps one forward contract without dead values.
- `Lander.astro` is the only renderer of the download card version badge. `landing-download.ts` must retain the actual version because it owns the installer filename and copy contract.
- The current documentation renderer and routes are Starlight-owned and are not part of this narrowed change.

### Independent agent feedback

- No sub-agent was used because this side conversation explicitly prohibits sub-agent interaction.

## Decision

Keep the complete documentation website and current landing interaction structure. Remove promotional-page controls whose destination is product documentation or the source repository, remove the visible download-card version badge, and replace the landing page's green/gradient decorative treatment with one monochrome visual system.

This is a direct deletion, not a hiding rule: the associated Astro markup, bilingual content-model fields, imports, and section-local CSS are removed together. No replacement external navigation is introduced.

## Landing navigation contract

The landing page keeps only these navigational actions:

- Internal section anchors in the header and hero.
- English/Simplified Chinese language switching.
- Demo media access and image enlargement.
- The direct Windows x64 installer download.

The following landing surfaces are removed in both locales:

- Header documentation button.
- Header source-repository button.
- Hero quickstart/documentation button.
- Scenario-card documentation links.
- Runtime-surface cards that navigate to documentation; their cards become non-interactive information cards.
- Final documentation call-to-action buttons; the section keeps its explanatory content without an external action row.
- Footer documentation and source-repository links.

The underlying documentation routes and source files remain available for direct consumers and are still built into `dist`.

## Download card contract

The Windows card continues to show platform, system, architecture, package type, and its direct download action. The upper-right `version` badge is removed. The catalog version remains internal distribution metadata and continues to determine the installer filename.

## Visual treatment

The landing page uses one restrained monochrome palette:

- Primary ink: near-black `#0a0a0a` for text, dark sections, and primary actions.
- Base surface: white `#ffffff` for the page and content cards.
- Alternate surface: light gray `#f5f5f5` for section separation.
- Structural line: neutral gray `#d4d4d4` for fine borders and dividers.
- Secondary copy: medium gray `#737373` for supporting text and metadata.

All green accent tokens and green-tinted surfaces are replaced by this palette. Decorative gradients, radial glows, luminous shadows, colored badges, ornamental grid overlays, and non-essential flourishes are removed. Solid black, white, or light-gray surfaces establish hierarchy instead.

Primary buttons are solid black with white text on light sections and solid white with black text on dark sections. Cards use white surfaces, thin neutral borders, and no glow shadow. Repeated metadata uses typography and rules rather than colored pills. Corner radii and spacing remain consistent and restrained instead of introducing a second component style.

The section order, content density, typography scale, responsive behavior, screenshots, video, and functional interactions remain unchanged. Product screenshots and video may retain their native product-interface colors because they are evidence content, not landing-page chrome. Empty action containers and obsolete selector blocks are deleted so removed controls cannot leave unexplained gaps.

## Verification

- Run `bun run --cwd packages/web check`.
- Run the focused non-UI Windows distribution contract test.
- Run `bun run build:landing-dist` and confirm documentation routes plus the Windows artifact inventory still build successfully.
- Inspect the task diff and generated distribution inventory.
- Open `/docs/` and `/docs/zh-cn/` in the visible browser, inspect the header, hero, scenario cards, runtime surfaces, final call-to-action, footer, and download card, then capture and personally review desktop screenshots for monochrome consistency, readable contrast, spacing, and absence of obsolete control gaps.
- Do not create or run DOM, source-string, snapshot, screenshot-baseline, Playwright-test, or other UI automation assertions.

## Design self-review

- Placeholder scan: no placeholder or unresolved decision remains.
- Consistency: documentation preservation, landing-only navigation deletion, monochrome landing chrome, preserved product media, and retained installer metadata agree throughout the design.
- Scope: one bilingual Astro component and its bilingual content/CSS contract own the visible change; build and distribution behavior remain in scope only for regression verification.
- Ambiguity: “documentation/source buttons” means every landing control whose destination is product documentation or the source repository, regardless of its visible label.
