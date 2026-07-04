# Frontend Innovate Expert Squad

Use this skill when the task is frontend design-resource synthesis: design screenshot interpretation, HTML/CSS or Figma resource synthesis, product UI redesign, multiple design directions, selected-direction convergence, or implementation of a webpage from design evidence with rendered verification.

Use it for an existing URL redesign when the operator asks to improve the page from aesthetic, professional, convenient, trust, usability, or similar design perspectives. Those words are not acceptance criteria by themselves; downstream specialists must translate them into observable user-task, hierarchy, design-system, accessibility, content, state, performance, and rendered-evidence obligations.

## First Action

Call `select_expert_squad` with `profile_id: "frontend-innovate"` unless the current task root session is already using that profile.

The reason must cite concrete evidence, such as design screenshots, HTML or CSS design material, a Figma URL, source page UI evidence, explicit design-resource synthesis requirements, or a request for multiple design directions and adversarial review.

## Design Philosophy Contract

Frontend Innovate applies a task-first design philosophy:

- Name the user, the page job, primary path, secondary paths, and failure states before judging appearance.
- Treat aesthetics as visual hierarchy, subject-grounded identity, typography, spacing, color semantics, content tone, and one justified signature element tied to the product domain.
- Treat professional delivery as design-system consistency, mature component/library reuse, real data/state behavior, precise copy, coherent component families, and no fake controls or static screenshots presented as interaction.
- Treat convenience as reduced decision effort, visible system status, user control, recognition over recall, useful defaults, clear errors, and complete loading/empty/permission/success states.
- Apply Web Content Accessibility Guidelines (WCAG) 2.2, Web Accessibility Initiative - Accessible Rich Internet Applications (WAI-ARIA) authoring patterns, keyboard/focus behavior, contrast, target sizing, reduced motion, and assistive-technology semantics as design inputs.
- Use established design-system evidence when relevant: Material, Apple Human Interface Guidelines, IBM Carbon, Microsoft Fluent, GOV.UK service patterns, Figma component/variable conventions, Baymard user-research evidence, and web.dev Web Vitals.
- Borrow the useful part of popular Claude Code design skills and plugins: subject-specific identity, compact token planning, self-critique, design-pattern intelligence, accessibility review, and copy as design material. Do not copy their looser structures into a second OpenCorvus workflow.

## Dispatch Discipline

- Use `frontend_research` for source-page investigation when a live page needs functional, content, interaction, or information-architecture evidence.
- Use `frontend_design` as the task-scope design handoff owner. It must inspect the design-resource manifest, produce multiple named design directions, identify rejected generic draft traits, and submit one implementation-ready frontend template.
- When the operator asks for multiple Build brainstorm drafts, start independent Build child tasks only for bounded named directions. Each draft is evidence for one direction, not a competing source of final truth; Frontend Design must still record the selected direction before implementation proceeds.
- Use Requirements and Architect to turn the selected direction into observable product, component, data, styling, interaction, and verification contracts.
- Use Build to implement the selected handoff. Build must not invent a separate product structure when Frontend Design already selected a resource-backed direction.
- Use Visual QA and Integrity after implementation to review the rendered product, not the design prose alone.

## Existing URL Redesign Flow

For a request like "redesign this existing website from aesthetic, professional, and convenient perspectives":

1. Use `frontend_research` for the source URL so source information architecture, content priority, interaction states, visible friction, and evidence gaps are durable.
2. Use `frontend_design` with the design-resource manifest and source-page evidence to produce at least two named redesign directions.
3. Require each direction to compare user task fit, information architecture, visual hierarchy, subject-grounded visual signature, component reuse, data/state needs, accessibility, copy, and primary-path convenience.
4. Select one direction and record why discarded directions or generic traits fail the actual page job.
5. Requirements and Architect must convert the selected direction into observable UI (User Interface), UX (User Experience), accessibility, state, data, performance, and screenshot evidence contracts.
6. Build implements the selected direction and verifies the real page with screenshots, key interactions, keyboard/focus behavior, loading/empty/error states, and the original checks.
7. Visual QA reviews the rendered implementation against the selected direction and source URL redesign goals; Integrity rejects completion if direction rationale, implementation proof, Visual QA evidence, accessibility behavior, or user-task convenience is missing.

## Design Resource Discipline

- Design resources must be indexed through the design-resource manifest before specialists treat them as Frontend Innovate context.
- Figma material must come from the connected Figma MCP materializer. If the required MCP evidence is unavailable, expose that failure instead of replacing it with unrelated screenshot or URL evidence.
- HTML, CSS, screenshots, design tokens, and Figma material are source resources. Browser preview evidence is implementation verification; do not merge those roles.
- Unknown design files are not usable design resources until a materializer records their type, digest, and canonical reference.

## Direction Selection Review

Frontend Design must record at least two competing named directions before selecting one. The selected direction must include:

- target audience, page job, primary user path, and selected-direction rationale;
- information architecture, layout density, typography, color, state, and interaction choices;
- component/library reuse decisions backed by inspected project or package evidence;
- rejected shallow or generic draft traits and why they failed;
- implementation boundaries that Build can own;
- rendered screenshot, interaction, accessibility, and state-verification expectations for Visual QA and Integrity.

If the available resources are insufficient to select an implementation direction, report the missing resources or open questions instead of submitting an ungrounded handoff.
