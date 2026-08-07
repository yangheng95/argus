# Presentation Artifact Display Repair

## Recall

### User request

- Stop treating Interactive Artifact support as a promise or a renderer-name count.
- Repair the visibly poor Presentation / PowerPoint display completely.
- Compare the interactive rendering with mature industry behavior and close the real gaps.
- Finish implementation, testing, real-page interaction, screenshot review, commit, and git-cc push without drip-feeding partial claims.

### Acceptance

- Semantic `presentation@1` slides use a restrained Reveal.js theme instead of the hand-authored stripe and radial decoration.
- Ordinary title plus three-bullet slides fit in compact Conversation display without an internal slide scrollbar.
- Declared `16:9`, `4:3`, and `1:1` ratios produce visibly distinct, exact stages.
- Embedded keyboard navigation activates only after the deck receives focus.
- Reveal relayout runs after its container changes size and after compact/fullscreen transitions.
- Fullscreen keeps the same mounted deck, preserves navigation, and uses the available viewport.
- Dark theme remains readable through OpenCorvus semantic tokens.
- Render-backed PowerPoint slides display the real OfficeCLI image with `object-fit: contain`; the Overlay does not place a second semantic title over the rendered slide.
- Every canonical AttachmentStore reference owned only by an Interactive Artifact remains live across startup sweep.
- The lazy Presentation chunk uses an official Reveal theme without a remote font request or the roughly 575 KB embedded Source Sans payload.
- Allowed non-UI typecheck, build, i18n, attachment-store contract, and documentation checks pass.
- Real isolated OpenCorvus page interaction and manually inspected screenshots cover compact semantic decks, three ratios, navigation, fullscreen, dark theme, and a render-backed deck. No UI automated test, fixture, baseline, or visual assertion file is created or run.

### Hard constraints

- Reveal.js remains the single presentation engine; do not build a second slide runtime.
- No fallback renderer, compatibility branch, title/extension inference, or host-side interaction gate.
- No UI automated tests. Browser use is interactive acceptance only.
- Attachment retention is a data-integrity contract and receives a positive non-UI regression.
- Preserve all concurrent work; do not stash, reset, restore, create a worktree, or broadly stage.
- Commit subject begins with `dsw-33987`; push the current main delivery branch to `myhexin`.

### Materials read

- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-29-conversation-backed-work-office-capability.md`
- `packages/overlay/src/components/interactive-artifact/PresentationArtifact.tsx`
- `packages/overlay/src/components/interactive-artifact/ArtifactFrame.tsx`
- `packages/overlay/src/styles/surfaces/messages.css`
- `packages/opencorvus/src/interactive-artifact/persist.ts`
- `packages/opencorvus/src/storage/attachment-store.ts`
- `packages/opencorvus/src/tool/work-office-presentation.ts`
- Reveal.js official initialization, presentation-size, theme, and fullscreen behavior documentation.

### Full-repository call-site inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Protocol schema | `packages/opencorvus/src/interactive-artifact/schema.ts` and Overlay payload type | Keep the strict `presentation@1` payload and three declared ratios. |
| Publication | `interactive-artifact/persist.ts`, `publish-interactive-artifact.ts`, Work Office delivery | Keep one publisher and canonical attachment validation. |
| Rendering dispatch | `InteractiveArtifactPart.tsx` | Keep one lazy `PresentationArtifact` branch. |
| Slide runtime | `PresentationArtifact.tsx` | Use Reveal embedded mode, focused keyboard ownership, resize-driven `layout()`, and one lifecycle. |
| Work surface/fullscreen | `ArtifactFrame.tsx` | Keep the same mounted renderer; rely on the Fullscreen API and observer-driven relayout. |
| Presentation styling | `messages.css` | Replace the bespoke decoration and oversized layout with official Reveal theme rules mapped to product tokens. |
| Attachment media | `FilePart.tsx`, `services/api.ts` | Keep canonical authenticated blob loading and render images through the shared media path. |
| Attachment publication validation | `interactive-artifact/persist.ts` | Keep exact digest, MIME, size, and project ownership validation. |
| Attachment garbage collection | `attachment-store.ts`, project bootstrap | Add `interactive_artifact.payload` to the existing single live-reference union; the current omission deletes real Office render evidence after the age boundary. |
| Attachment sweep regressions | `test/storage/attachment-store-sweep.test.ts` | Add one positive contract: Interactive Artifact-owned bytes are present in the retain set and remain readable after sweep. |
| Architecture docs | `specs/current/architecture/07-panel.md` | Record Presentation lifecycle/theme and Interactive Artifact attachment ownership. |

### Independent agent feedback

No independent agent was requested. The current task is executed in the primary agent, and the repository rule prohibiting unsolicited delegation applies.

## Root cause

The poor display is not one missing CSS property:

1. Presentation imports Reveal core only, then replaces the mature theme with a bespoke stripe, accent wash, centered grid, oversized type, and wide content constraints.
2. Reveal is initialized without `keyboardCondition: "focused"`, so an embedded deck can compete with Conversation keyboard ownership.
3. Reveal calculates scale at initialization, but no container `ResizeObserver` calls `layout()` when the Conversation pane or fullscreen surface changes size.
4. Compact height and content sizes are not designed together, so a normal three-bullet slide becomes an internally scrolling document rather than a slide.
5. The AttachmentStore live-set union includes message parts, Engine task facts, and Engine Artifacts, but omits `interactive_artifact.payload`. Work Office render images can therefore validate and publish successfully, then be deleted by startup sweep while their durable artifact row still references them.
6. Reveal's default white theme embeds approximately 575 KB of Source Sans font data. Importing it directly would repair theme completeness but create an avoidable lazy-chunk cost. The official `serif` theme supplies the same Reveal theme contract without a remote or embedded font; OpenCorvus can map its variables to product typography.

## Implementation

1. Import Reveal core and its official `serif` theme, then override only public `--r-*` variables with OpenCorvus semantic tokens.
2. Configure the embedded deck with `keyboardCondition: "focused"` and exact design dimensions for each declared ratio.
3. Observe the actual Reveal host. After initialization and every observed container change, schedule `deck.layout()` in the next animation frame. Disconnect the observer and cancel the pending frame before destroy.
4. Give compact stages exact ratio geometry with bounded viewport height, left-aligned slide rhythm, smaller canonical type, and no decorative backgrounds. Retain overflow only as a safety path for genuinely oversized author content.
5. Let render-backed slides fill the stage and contain the shared image renderer without semantic overlays.
6. Extend the existing AttachmentStore reference harvest with `InteractiveArtifactTable.payload`, scoped through message and session project ownership.
7. Add a positive non-UI regression that publishes a real render-backed Interactive Artifact, ages the stored bytes, runs sweep, and proves the canonical bytes still round-trip.
8. Update the architecture record and indexes.

## Interactive industry-gap review

| Mature embedded-deck behavior | Previous OpenCorvus state | Target |
| --- | --- | --- |
| Complete library theme contract | Reveal core plus bespoke partial CSS | Official Reveal theme contract plus product tokens |
| Host-scoped keyboard ownership | Global deck keyboard listener | Focused embedded deck |
| Container-aware scale | Initial/window calculation only | `ResizeObserver` plus `layout()` |
| Slide, not scrollable document | Typical content scrolls internally | Normal title and three bullets fit |
| Stable declared geometry | Fixed height obscures ratio semantics | Exact 16:9, 4:3, and 1:1 stages |
| Same-instance fullscreen | Fullscreen exists but layout is stale | Same mounted deck plus relayout |
| Render evidence durability | Artifact row outlives swept bytes | Interactive Artifact payload is a GC retain surface |
| Offline, bounded lazy asset | Direct white theme costs embedded fonts | Small official system-font theme |

## Validation

### Non-UI

- `bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

### Real-page manual acceptance

Run an isolated OpenCorvus service with a portable home and a disposable Git project. Seed through production database and publisher APIs:

- a two-slide `16:9` semantic deck with a normal three-bullet slide,
- one `4:3` semantic deck,
- one `1:1` semantic deck,
- one Office-render-backed deck whose image uses AttachmentStore.

Open the real `/ui/` surface, connect through the product UI, and manually inspect screenshots after:

1. compact semantic display,
2. focused keyboard next/previous navigation,
3. fullscreen entry and exit,
4. 4:3 and 1:1 compact display,
5. dark-theme display,
6. render-backed image display,
7. a service restart/sweep with aged render bytes.

The screenshots are transient acceptance evidence outside committed source; they are not baselines or repeatable UI tests.

## Delivered result

The real isolated `/ui/` accepted all requested Presentation surfaces:

- the normal title plus three-bullet 16:9 slide fits as a slide, navigates from
  1/2 to 2/2 with the focused right-arrow key, and uses the same mounted Reveal
  deck in native fullscreen;
- 4:3 and 1:1 payloads produce visibly distinct exact stages;
- dark product tokens keep semantic slides readable;
- the actual Office-render image is contained without a duplicate semantic
  heading on top of the slide;
- the aged Office-render attachment remains readable after startup sweep.

The production build keeps the Reveal renderer lazy and the official serif
theme supplies the complete Reveal theme contract without the embedded
Source Sans font payload.
