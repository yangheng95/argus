# Landing Mission Flow Live Autoplay

**Goal:** Replace the landing hero's static workflow bitmap with the supplied live flow, remove its manual controls, autoplay it on load, and restart after every complete cycle.

## Recall

### User request

- Port `ceo-agent-operating-model-spacious.html` into the promotional homepage.
- Replace the existing right-side hero workflow.
- Remove the “演示流程” and “单步” controls.
- Start automatically and continuously restart after the last stage.
- Remove CEO-specific wording from the lower step descriptions.

### Acceptance criteria

- The hero renders one native live workflow component, not the old PNG or an iframe.
- Ten stages autoplay without interaction and loop after stage ten.
- No play, pause, or step control is present.
- Lower descriptions change with the highlighted stage and contain no CEO wording in either locale.
- English and Simplified Chinese nodes stay inside their cards, with visible spacing and connectors routed only to card edges.
- Later screenshots, image preview, demo video, download route, and public base-path behavior remain unchanged.

### Hard constraints

- CSS (Cascading Style Sheets) owns the declarative timeline; no host timer or workflow state machine is introduced.
- The component is the single hero workflow source. The replaced PNG and its hero preview trigger are deleted.
- No UI (User Interface) automated test, source-string assertion, screenshot baseline, fixture, or pixel-difference test is added, modified, or run.
- UI acceptance uses the real desktop page, fresh screenshots tied to this delivery surface, and personal visual review.
- Unrelated working-tree changes are preserved and excluded from staging.
- No worktree or sub-agent is used.

### Sources read

- User-provided `ceo-agent-operating-model-spacious.html`.
- `packages/web/src/components/Lander.astro`.
- `packages/web/src/content/landing.ts`.
- `specs/records/2026-08/2026-08-04-landing-hero-mission-flow-design.md`.
- `specs/records/2026-08/2026-08-04-landing-hero-mission-flow-implementation-plan.md`.
- `mirror-project` startup skill and Browser visual-inspection skill.

### Repository and baseline evidence

- `MissionWorkflowHero` was imported and rendered only by the hero; later story media use separate screenshots.
- The existing image-preview dialog remains live for later story screenshots.
- `diagramWindowLabel` and `diagramAlt` remain the localized window and accessible-description contract.
- The pre-change branch and `myhexin/work-lcx-v0.0.30beta` were aligned at `de7d38d664985da037022a47b3d1f5e00bf4ead4`. During implementation, an already-running upstream convergence advanced both to `06a346e55e80ec47356cdb654e74a64f02020af8`; this change is reconciled on that commit.
- Separate expert-squad landing work remains unstaged and is outside this task.

### Independent agent feedback

- None. The user did not request delegated or parallel agent work.

## Design decision

`LandingMissionFlow.astro` owns the localized node copy, precomputed connector geometry, ten status messages, and shared 15-second animation. Every stage receives a 1.5-second highlight window; the CSS timeline repeats infinitely. `Lander.astro` only mounts the component inside its existing product-window frame.

The visual system stays flat and monochrome. Shortened executive-level node labels allow wider cards without text overflow. All connectors terminate at explicit card anchors, while the feedback route stays below the two work streams.

## Implemented changes

- [x] Added the localized inline workflow with ten-stage declarative autoplay.
- [x] Replaced the hero bitmap preview with the live component.
- [x] Removed the obsolete workflow PNG.
- [x] Removed all playback controls and CEO wording from the lower descriptions.
- [x] Preserved the localized chrome/accessibility contract and later image-preview behavior.
- [x] Ran Astro validation and the production landing build without UI tests.
- [x] Inspected both real locale routes and captured fresh desktop evidence.

## Verification record

- `bun run --cwd packages/web check`: 0 errors and 0 warnings; one existing unused-variable hint remains in `qa/dedupe-lead.cjs`.
- `bun run build:landing-dist`: 105 static pages built; 102 documentation pages indexed; three existing Windows x64 artifacts copied unchanged.
- Documentation health: 70 passes and 0 failures across `historical-docs-links.test.ts`, `document-health.test.ts`, and `product-docs-single-source.test.ts`.
- Real English page: `http://127.0.0.1:9999/docs/`; screenshot `specs/artifacts/2026-08-04-landing-mission-flow-autoplay-en.png`.
- Real Simplified Chinese page: `http://127.0.0.1:9999/docs/zh-cn/`; screenshot `specs/artifacts/2026-08-04-landing-mission-flow-autoplay-zh-cn.png`.
- A first screenshot exposed English card overflow. Node copy was shortened, cards widened, connector anchors recalculated, and both locales were visually rechecked.
- After 15.5 seconds of continuous real-page execution, the active description advanced from stage 3 to stage 4 in the next cycle, confirming the timeline continued after one full 15-second round.
- Final screenshots show no controls, no lower CEO wording, no text outside cards, and no connector crossing a card interior.
- No UI automation test or repeatable visual assertion artifact was created or run.
