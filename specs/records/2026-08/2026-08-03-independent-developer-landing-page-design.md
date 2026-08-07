# Independent developer landing-page redesign

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Take inspiration from `https://crewform.tech/`, inspect OpenCorvus features (especially Expert Squads), and optimize the promotional landing page. |
| Target audience | Independent developers. |
| Success criteria | Promote real product capabilities through concrete use cases. Each use case has a real screenshot or short video when available; missing dedicated media is an explicitly labelled temporary product-media placeholder that can be replaced later. |
| Visual scope | Desktop-only landing page. Validate in a real browser at a desktop viewport with manually inspected screenshots; do not add, alter, or run UI automated tests. |
| Reference evidence | CrewForm leads with a concise audience/value proposition, two immediate calls to action, and a scan-friendly feature inventory. Its page claims visual agent management, marketplace, pipeline/orchestrator modes, protocols, knowledge base, providers, deployment and pricing. These concepts do not transfer as product claims to OpenCorvus. |
| Existing landing evidence | `packages/web/src/components/Lander.astro` owns the page structure and its existing product images/video. `packages/web/src/content/landing.ts` owns English and Simplified Chinese page copy. `packages/web/src/assets/lander/{client-agent-workspace,client-environment-evidence,client-task-evidence}.png` and `/docs/media/opencorvus-client-demo.webm` are reusable real product evidence. |
| Expert Squad evidence | `packages/opencorvus/src/expert-squad/builtin/{base,advanced,research-studio}/{README.md,expert-squad.jsonc}` and `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` establish that an active package projects a self-contained scheduler/worker capability closure, agents, skills, tools, scoped MCP (Model Context Protocol) surfaces, and binding workflows. Base is the default compact delivery team, Advanced is the full delivery team, and Research Studio is the built-in research team. `packages/overlay/src/components/settings/ExpertSquadPanel.tsx` exposes the effective catalog and projected Agent access in the client. |
| Relevant historical decisions | `specs/records/2026-07/2026-07-21-opencorvus-promotional-landing-page.md` establishes the existing real-product-only, Astro/Starlight, desktop-first landing surface. |
| Whole-repository grep results | `rg` finds one landing composition owner (`Lander.astro`), one content owner (`landing.ts`), its `Hero.astro` consumer, the media imports above, server Expert Squad routes/resolver/tools, and the Overlay `ExpertSquadPanel`. It also finds `packages/opencorvus/test/script/web-landing-page.test.ts`, an existing UI automated test: it must be deleted during implementation and must not be run. |
| Working-tree safety | The repository already contains unrelated tracked and untracked changes. This redesign must confine edits to the landing composition/content/styles, relevant specs indexes, and removal of the discovered landing UI test. |

## Decision

Reframe the landing page around the independent developer's outcomes: investigate now, ship a complete change, then delegate durable work. Expert Squads become the differentiating mechanism that equips an appropriate specialist team, instead of being a generic multi-agent claim.

CrewForm is inspiration for information hierarchy only. No CrewForm wording, brand treatment, capability claim, pricing, marketplace, provider count, or protocol claim will be copied.

## Information architecture

1. **Hero — turn an idea into a reviewable delivery.** Keep the current real workspace screenshot, documentation and source actions. Replace the abstract Chat/Work/Mission headline with independent-developer value language and concise proof points: streaming work, retained project context, and durable evidence.
2. **Three developer scenarios.** Use existing evidence rather than illustrations:
   - Investigate and unblock with Chat and the existing workspace screenshot.
   - Produce a complete change with Work and the existing environment/evidence screenshot.
   - Hand off durable repository work with Mission and the existing 01:36 client video plus task-evidence screenshot.
3. **Expert Squads — select expertise, not merely more agents.** Introduce the real package model: a selected Expert Squad projects a self-contained group of agents, skills, tools, MCP access and a task-appropriate workflow contract. The module uses a product-media frame marked `Expert Squads — product capture coming soon`; it must use no fabricated screen or invented task state. Because the public documentation route is not verified in this scope, this first version is explanatory content only and exposes no unverified documentation link.
4. **Always-reachable runtime.** Retain and tighten the current desktop continuity, headless runtime, channels, and scheduled repository automation grid as the reason long-running work can outlast an open window.
5. **Final action.** Keep Quickstart, architecture, and source actions with a compact independent-developer call to action.

## Component and content ownership

| Owner | Change |
| --- | --- |
| `packages/web/src/content/landing.ts` | Extend the localized content schema and both locales with scenario-first copy, Expert Squads copy, media labels, and truthful actions. |
| `packages/web/src/components/Lander.astro` | Reorder page regions and render the Expert Squads evidence/placeholder section using the existing Astro component surface. Keep real links, keyboard focus, image preview behavior, and the existing video source. |
| Component-local styles in `Lander.astro` | Adjust visual hierarchy and desktop layout for the new section rhythm. No parallel CSS system or new interaction framework. |
| `packages/opencorvus/test/script/web-landing-page.test.ts` | Delete; it is an existing UI automated test discovered in this delivery scope and must not be run or updated. |

## Interaction and media contract

- Existing screenshots remain interactive full-size previews and the existing video remains a native controlled video element.
- The Expert Squads placeholder is a non-interactive, clearly labelled media frame; it makes no claim that it is a live client capture.
- All actions remain actual documentation or source links; no fake download, pricing, signup, or marketplace control is introduced.
- Existing focus-visible styling remains, and the revised page must preserve visible keyboard navigation for all links, media controls, and image-preview controls.

## Verification

- Run the web build/check appropriate to `packages/web/package.json`; these are static/project checks, not UI automation.
- Do not run or create any UI automated test. Remove the discovered landing UI test and any test-only support that becomes unreferenced by its deletion.
- Start the real Astro page through the Node-backed project path, inspect `/docs/` and `/docs/zh-cn/` at a desktop viewport, interact with at least one image preview and the video controls, capture screenshots, and inspect them manually.
- Perform a second source review after visual review: verify every capability claim against current code/docs, all links resolve to existing routes, and the placeholder is explicit.

## Non-goals

- No responsive/mobile delivery, pricing, marketplace, deployment promise, protocol claim, or external product comparison.
- No new product recording is required in this change. A later task can replace the Expert Squads placeholder with a real capture without changing the page architecture.
