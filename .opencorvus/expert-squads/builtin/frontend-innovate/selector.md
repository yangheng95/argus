# Frontend Innovate Expert Squad

Use this skill when the task is frontend design-resource synthesis or competitor-informed frontend redesign: design screenshot interpretation, HyperText Markup Language or Cascading Style Sheets resource synthesis, Figma resource synthesis, product UI redesign, multiple design directions, selected-direction convergence, HTML design draft generation, or implementation of a webpage from design evidence with rendered verification.

Use it for an existing URL redesign when the operator asks to improve the page from aesthetic, professional, convenient, trust, usability, or similar design perspectives. Those words are not acceptance criteria by themselves; downstream specialists must translate them into observable user-task, hierarchy, design-system, accessibility, content, state, performance, and rendered-evidence obligations.

Vocabulary: CSS means Cascading Style Sheets; HTML means HyperText Markup Language; QA means Quality Assurance; UI means User Interface; URL means Uniform Resource Locator; UX means User Experience.

## First Action

Call `select_expert_squad` with `profile_id: "frontend-innovate"` unless the current task root session is already using that profile.

The reason must cite concrete evidence, such as design screenshots, HTML or CSS design material, a Figma URL, source page UI evidence, explicit design-resource synthesis requirements, or a request for multiple design directions and adversarial review.

## Expert Contract

An expert frontend innovation result must include a design-convergence model, not just a visually appealing draft:

1. Resource boundary: list the screenshots, HyperText Markup Language material, Cascading Style Sheets material, Figma material, source URL evidence, product constraints, and target project components that are allowed to inform the design.
2. User-task model: name the audience, page job, primary path, secondary paths, failure states, and convenience problem before judging appearance.
3. Direction discipline: produce competing named directions when the task asks for redesign or innovation, compare each against the same evidence, and record why rejected directions or generic traits fail the page job.
4. Selected handoff: convert the selected direction into component families, data/state needs, copy tone, interaction semantics, accessibility behavior, design-system/library reuse, and implementation boundaries.
5. Evidence separation: keep source/design resources separate from rendered implementation proof; do not replace missing Figma or source evidence with unrelated screenshots.
6. HTML design draft proof: Frontend Design must register competitor/reference webpage screenshot rows with `update_frontend_competitor_reference`, then produce a source-editable `visual-html-skeleton` HTML/Cascading Style Sheets design draft for the selected direction and register real rendered screenshot evidence for it.
7. Rendered implementation proof: verify the implemented direction through screenshots, primary task path, keyboard/focus behavior, loading/empty/error states, and named accessibility or performance checks.
8. Acceptance proof: final evidence must tie selected-direction rationale, HTML design draft evidence, implementation changes, Visual quality assurance review, and Integrity review to the same resource set.

Do not accept a frontend innovation result when it produces a pretty but ungrounded layout, skips direction comparison, uses novelty without product evidence, implements a discarded draft, omits accessibility or state behavior, or accepts design prose without rendered proof.

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

- Use `dispatch_agent` with `target: "frontend_research"` for source-page investigation when a live page needs functional, content, interaction, or information-architecture evidence.
- Use `dispatch_agent` with `target: "deep_research"` or explicit task materials for competitor/industry/design-reference webpages when the redesign depends on external competitor comparison.
- Use `dispatch_agent` with `target: "frontend_design"` for the task-scope design handoff owner. It must inspect the design-resource manifest, source-page evidence, and evidence-backed competitor/reference webpages; register each competitor/reference URL and screenshot in `competitor_reference_evidence`; produce multiple named design directions; identify rejected generic draft traits; and submit one source-editable HTML design draft under `visual-html-skeleton`.
- When the operator asks for multiple Build brainstorm drafts, start independent Build child tasks only for bounded named directions. Each draft is evidence for one direction, not a competing source of final truth; Frontend Design must still record the selected direction before implementation proceeds.
- Use `dispatch_agent` with `target: "requirements"` and `target: "architect"` to turn the selected direction into observable product, component, data, styling, interaction, and verification contracts.
- Use `dispatch_agent` with `target: "build"` to implement the selected HTML design draft. Build must not invent a separate product structure when Frontend Design already selected and rendered a resource-backed direction.
- Use `dispatch_agent` with `target: "visual_qa"` and `target: "integrity"` after implementation to review the rendered product against the HTML design draft screenshot evidence and selected-direction contract, not the original source page pixels or design prose alone.

## Existing URL Redesign Flow

For a request like "redesign this existing website from aesthetic, professional, and convenient perspectives":

1. Use `dispatch_agent` with `target: "frontend_research"` for the source URL so source information architecture, content priority, interaction states, visible friction, and evidence gaps are durable.
2. Use evidence-backed competitor/design references from user input, `dispatch_agent target="frontend_research"`, or `dispatch_agent target="deep_research"`. If the task requires competitor comparison and no competitor evidence exists, expose the blocker instead of asking frontend_design to guess URLs.
3. Use `dispatch_agent` with `target: "frontend_design"` and the design-resource manifest, source-page evidence, and competitor/reference evidence to produce at least two named redesign directions. Every selected-direction competitor claim must have a `competitor_reference_evidence` row containing the webpage URL, screenshot artifact, viewport, SHA-256 digest, inspected elements, and influence on the selected direction.
4. Require each direction to compare user task fit, information architecture, visual hierarchy, subject-grounded visual signature, component reuse, data/state needs, accessibility, copy, and primary-path convenience.
5. Select one direction, record why discarded directions or generic traits fail the actual page job, and materialize the selected direction as `visual-html-skeleton`.
6. Render the HTML design draft through real browser/static-file evidence and register structured `visual_validation_evidence`; the rendered HTML design draft becomes the downstream visual ground truth.
7. Requirements and Architect must convert the selected HTML design draft into observable UI (User Interface), UX (User Experience), accessibility, state, data, performance, and screenshot evidence contracts.
8. Build implements the selected HTML design draft and verifies the real page with screenshots, key interactions, keyboard/focus behavior, loading/empty/error states, and the selected-direction checks.
9. Visual QA reviews the rendered implementation against the HTML design draft screenshot evidence and source URL redesign goals; Integrity rejects completion if direction rationale, HTML design draft proof, implementation proof, Visual QA evidence, accessibility behavior, or user-task convenience is missing.

## Design Resource Discipline

- Design resources must be indexed through the design-resource manifest before specialists treat them as Frontend Innovate context.
- Figma material must come from the connected Figma MCP materializer. If the required MCP evidence is unavailable, expose that failure instead of replacing it with unrelated screenshot or URL evidence.
- HyperText Markup Language, Cascading Style Sheets, screenshots, design tokens, and Figma material are source resources. Browser preview evidence is implementation verification; do not merge those roles.
- Unknown design files are not usable design resources until a materializer records their type, digest, and canonical reference.
- Competitor webpages are usable only when they are user-provided, frontend_research-backed, deep_research-backed, or otherwise materialized as task evidence. Missing competitor evidence is a blocker for competitor-comparison claims, not permission to invent references. Prose-only competitor discussion is not enough; the handoff must include structured `competitor_reference_evidence`.

## Direction Selection Review

Frontend Design must record at least two competing named directions before selecting one. The selected direction must include:

- target audience, page job, primary user path, and selected-direction rationale;
- information architecture, layout density, typography, color, state, and interaction choices;
- component/library reuse decisions backed by inspected project or package evidence;
- rejected shallow or generic draft traits and why they failed;
- source-editable `visual-html-skeleton` files and rendered screenshot evidence that define the selected direction as downstream visual ground truth;
- implementation boundaries that Build can own;
- rendered screenshot, interaction, accessibility, and state-verification expectations for Visual QA and Integrity.

If the available resources are insufficient to select an implementation direction, report the missing resources or open questions instead of submitting an ungrounded handoff.
