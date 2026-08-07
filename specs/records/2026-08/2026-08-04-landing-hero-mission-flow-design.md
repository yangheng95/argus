# Landing Hero Mission Flow PNG Design

**Goal:** Replace the landing hero's local-client screenshot with a polished PNG representation of the supplied complete Mission workflow, while removing the floating local-client walkthrough chip and preserving the later product-demo section.

## Recall

### User request

- Restyle the supplied Mission workflow diagram to match the MOSA landing page.
- Place it on the right side of the landing hero in place of the local-client screenshot.
- Preserve every node shown in the source diagram.
- Use PNG rather than a code-native or SVG diagram.
- Remove the lower-right local-client walkthrough entry from the hero.

### Acceptance criteria

- The hero's right panel displays the new workflow PNG, not `client-agent-workspace.png`.
- The diagram retains Mission, both schedulers, both investigators, both planners, all shown Developer nodes and the ellipsis, Code Reviewer, Visual Reviewer, both Handoff nodes, the two Mission branches, and the return-feedback arrow.
- Exact node text remains readable at the desktop hero size and in the existing click-to-enlarge dialog.
- The diagram uses the landing system: black/charcoal field, warm-white and neutral-gray cards, fine borders, flat surfaces, and white/gray connectors. No blue, gradient, glow, 3D treatment, or ornamental grid is introduced.
- The hero walkthrough chip is deleted without removing the later video demo section or its navigation anchor.
- English and Simplified Chinese landing pages use the same approved PNG; the mixed Chinese/English role labels from the supplied source remain intentional.

### Hard constraints

- The PNG is generated as a new project asset; the supplied temporary clipboard file remains untouched.
- `landing.ts` owns the new bilingual diagram alternative text and preview labels; `Lander.astro` owns rendering and chip deletion.
- The existing image-preview dialog is reused so the complete diagram remains inspectable.
- No UI automation test, DOM/source-string UI assertion, snapshot baseline, or pixel-difference test may be created or run. Acceptance uses the real visible desktop page, screenshots, and personal review.
- Native Windows artifacts are copied, not rebuilt. The static `dist` build must retain the existing installer path.
- No worktree or sub-agent is used.

### Sources read

- User-provided `codex-clipboard-4c747651-79fe-43c7-82dc-ea6c86f6c159.png`
- `packages/web/src/components/Lander.astro`
- `packages/web/src/content/landing.ts`
- `packages/web/src/assets/lander/client-agent-workspace.png`
- `specs/records/2026-08/2026-08-04-landing-monochrome-navigation-cleanup-implementation-plan.md`

### Repository and visual evidence

- The current hero image is the first `ClientAgentWorkspace` use inside `.hero-product`; later story media independently reuse the same asset and remain unchanged.
- The lower-right walkthrough entry is `.demo-chip`; it only links to `#demo`, while the header retains a separate Product demo navigation link.
- `.product-window` and the shared image-preview dialog already provide the correct frame, zoom interaction, and responsive containment for a replacement bitmap.
- The supplied image is 1819 × 956 pixels and contains the complete two-lane workflow on black, but its cyan-filled cards, oversized empty gaps, inconsistent corner radii, and very long return arrow do not match the current restrained landing system.

### Independent agent feedback

- None. This side conversation prohibits sub-agent use.

## Approved visual design

The final asset is a wide desktop infographic PNG with a compact two-lane composition. Mission stays on the left as the common origin. The upper and lower lanes branch immediately, then move through Scheduler, Investigator, Planner, the complete Developer group, review, and Handoff. A thin central return line runs from the handoff side back toward Mission. The Developer group keeps the three explicit upper cards and the two explicit lower cards with the ellipsis shown in the source.

The field is `#080808`. Ordinary role cards are warm white or `#f5f5f2` with fine gray borders and near-black text. Mission and both Scheduler cards use graphite-black fill, crisp white text, and a fine warm-white border. Directional connectors use precise white/gray orthogonal lines, with the return-feedback arrow quieter than the forward paths. Typography is bold, geometric, and flat, with no color accent, glow, shadow bloom, gradients, textures, fake window controls, or decorative grid.

The user approved the second generated preview at `C:/Users/lichenxing/.codex/generated_images/019fcb72-515f-73a1-9e8b-48e2654b1409/exec-ec14cff9-7878-4d0b-8b0f-e542e746b0db.png`. This image is the authoritative visual asset for implementation; the generated original remains in place and a copy receives the project-owned stable filename.

## Page integration

- Add the selected generated PNG under `packages/web/src/assets/lander/` with a descriptive stable filename.
- Replace only the hero's `ClientAgentWorkspace` image source and preview data with the new asset.
- Add localized diagram alt/preview text to the existing hero content contract.
- Remove `.demo-chip` markup and its now-dead CSS. Preserve the header `#demo` link and the complete later video section.
- Keep later story screenshots and the preview dialog implementation unchanged.

## Verification design

- Inspect the generated PNG at original resolution before integration; reject unreadable labels, missing nodes, invented nodes, distorted arrows, gradients, glow, or accidental text.
- Run Astro checks, the existing non-UI Windows distribution contract, and `build:landing-dist`.
- Open both real desktop routes at `/docs/` and `/docs/zh-cn/`, inspect the full hero and enlarged diagram, and capture fresh evidence screenshots.
- Run the required documentation health suites after updating this record and its indexes.

## Self-review

- Placeholder scan: every source, target, label inventory, palette, ownership boundary, verification command class, and retained/deleted interaction is explicit.
- Consistency: PNG output is intentional, while the existing HTML dialog remains the sole preview mechanism.
- Scope: only the hero media and chip change; later product evidence and native packaging remain out of scope.
- Ambiguity: “preserve complete” refers to every node and ellipsis visibly present in the supplied image, not an unbounded hidden number of Developer agents.
