---
name: frontend-innovate-expert-squad
description: Orchestrator skill for enterprise and product-grade frontend design synthesis. Use when a task asks for innovative webpage design, product UI redesign, design screenshots, HTML design references, Figma designs, multiple design directions, anti-slop critique, convergence into an implementation-ready frontend plan, or implementation of a polished product webpage from design resources.
agents:
  - orchestrator
mounted_agents:
  - orchestrator
required_tools:
  - select_expert_squad
priority: 92
---

# Frontend Innovate Expert Squad

Use this skill when the task is product-grade or enterprise-grade frontend design work: design screenshot interpretation, HTML/Figma resource synthesis, product UI redesign, multiple design directions, anti-slop critique, or implementation of a polished webpage from design evidence.

## First Action

Call `select_expert_squad` with `profile_id: "frontend-innovate"` unless the current task root session is already using that profile.

The reason must cite concrete evidence, such as design screenshots, HTML or CSS design material, a Figma URL, source page UI evidence, explicit product-grade design requirements, or a request for multiple design directions and adversarial review.

## Dispatch Discipline

- Use `frontend_research` for source-page investigation when a live page needs functional, content, interaction, or information-architecture evidence.
- Use `frontend_design` as the task-scope design handoff owner. It must inspect the design-resource manifest, produce multiple named design directions, critique shallow drafts, and submit one implementation-ready frontend template.
- When the operator asks for multiple Build brainstorm drafts, start independent Build child tasks only for bounded named directions. Each draft is evidence for one direction, not a competing source of final truth; Frontend Design must still record the selected direction before implementation proceeds.
- Use Requirements and Architect to turn the selected direction into observable product, component, data, styling, interaction, and verification contracts.
- Use Build to implement the selected handoff. Build must not invent a separate product structure when Frontend Design already selected a resource-backed direction.
- Use Visual QA and Integrity after implementation to review the rendered product, not the design prose alone.

## Design Resource Discipline

- Design resources must be indexed through the design-resource manifest before specialists treat them as Frontend Innovate context.
- Figma material must come from the connected Figma MCP materializer. If the required MCP evidence is unavailable, expose that failure instead of replacing it with unrelated screenshot or URL evidence.
- HTML, CSS, screenshots, design tokens, and Figma material are source resources. Browser preview evidence is implementation verification; do not merge those roles.
- Unknown design files are not usable design resources until a materializer records their type, digest, and canonical reference.

## Anti-Slop Review

Frontend Design must record at least two competing named directions before selecting one. The selected direction must include:

- product audience and enterprise-quality rationale;
- information architecture, layout density, typography, color, state, and interaction choices;
- component/library reuse decisions backed by inspected project or package evidence;
- rejected shallow or generic draft traits and why they failed;
- implementation boundaries that Build can own;
- rendered verification expectations for Visual QA and Integrity.

If the available resources are insufficient for product-grade convergence, report the missing resources or open questions instead of submitting a polished-looking but ungrounded handoff.
