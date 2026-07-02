import z from "zod"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"

export const DEFAULT_PROMPT_PROFILE_ID = "frontend-replica"
export const PROMPT_PROFILE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const PromptProfileIDSchema = z
  .string()
  .min(1, "prompt profile id cannot be empty.")
  .max(64, "prompt profile id must be at most 64 characters.")
  .regex(
    PROMPT_PROFILE_ID_PATTERN,
    "prompt profile id must use lowercase letters, digits, and single hyphens, and must start with a letter.",
  )
const USER_PROFILE_TARGETS = AgentRoleContract.promptProfileTargets("user")
const BUILT_IN_ONLY_PROFILE_TARGETS = AgentRoleContract.promptProfileTargets("builtin")
const ALL_PROFILE_TARGETS = AgentRoleContract.promptProfileTargets()

export type PromptProfileTargetID = AgentRoleID

export const PromptProfileDefinitionSchema = z
  .object({
    label: z.string().trim().min(1, "prompt profile label cannot be empty."),
    description: z.string().trim().min(1, "prompt profile description cannot be empty when provided.").optional(),
    agents: z
      .record(
        z.string(),
        z
          .string()
          .trim()
          .min(1, "prompt profile target overlay cannot be blank; omit the target when no overlay is needed."),
      )
      .default({}),
  })
  .strict()

export const PromptProfileConfigSchema = z
  .object({
    active: PromptProfileIDSchema.default(DEFAULT_PROMPT_PROFILE_ID),
    profiles: z.record(PromptProfileIDSchema, PromptProfileDefinitionSchema).optional(),
  })
  .strict()
  .default({ active: DEFAULT_PROMPT_PROFILE_ID })

export const PromptProfileOverlaySchema = z
  .object({
    active: PromptProfileIDSchema.nullable().optional(),
  })
  .strict()

export const PromptProfileImportSchema = z
  .object({
    prompt_profile: z
      .object({
        active: PromptProfileIDSchema.optional(),
        profiles: z
          .record(PromptProfileIDSchema, PromptProfileDefinitionSchema)
          .refine((profiles) => Object.keys(profiles).length > 0, {
            message: "prompt_profile.profiles must contain at least one custom profile.",
          }),
      })
      .strict(),
  })
  .strict()

export type PromptProfileDefinition = z.output<typeof PromptProfileDefinitionSchema>
export type PromptProfileConfig = z.output<typeof PromptProfileConfigSchema>
export type PromptProfileOverlay = z.output<typeof PromptProfileOverlaySchema>
export type PromptProfileImport = z.output<typeof PromptProfileImportSchema>

export const PromptProfileTargetCatalogEntrySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    editable: z.boolean(),
    built_in_only: z.boolean(),
  })
  .strict()

export const PromptProfileCatalogProfileSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    built_in: z.boolean(),
    editable: z.boolean(),
    agents: z.record(z.string(), z.string()),
  })
  .strict()

export const PromptProfileCatalogSchema = z
  .object({
    active: z.string(),
    project_active: z.string(),
    session_active: z.string().nullable(),
    default: z.string(),
    targets: z.array(PromptProfileTargetCatalogEntrySchema),
    profiles: z.array(PromptProfileCatalogProfileSchema),
  })
  .strict()

export type PromptProfileTargetCatalogEntry = z.output<typeof PromptProfileTargetCatalogEntrySchema>
export type PromptProfileCatalogProfile = z.output<typeof PromptProfileCatalogProfileSchema>
export type PromptProfileCatalog = z.output<typeof PromptProfileCatalogSchema>

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
}

const userTargetSet = new Set<string>(USER_PROFILE_TARGETS)
const builtInOnlyTargetSet = new Set<string>(BUILT_IN_ONLY_PROFILE_TARGETS)
const allTargetSet = new Set<string>(ALL_PROFILE_TARGETS)

const expertOverlay = (...lines: string[]) => lines.join("\n")

export namespace PromptProfile {
  export const builtIns: Record<string, PromptProfileDefinition> = {
    general: {
      label: "General",
      description: "No domain-specific expert overlay.",
      agents: {},
    },
    "frontend-replica": {
      label: "Frontend Replica",
      description: "Source URL/reference-screenshot replica, desktop region mapping, source evidence, and rendered proof expert squad.",
      agents: {
        coding: expertOverlay(
          "Prioritize desktop source information architecture, module order, density, states, and source screenshot/DOM/computed-style correspondence. Do not introduce tablet/mobile scope unless the operator asks for a separate multi-end migration task.",
          "Treat target project primitives, business components, and code as reuse options only when they preserve source region layout, typography/spacing/color tokens, content density, and interaction semantics.",
          "When the desktop contract names adaptive layout, verify multiple desktop-class viewport widths before claiming the replica is done; this remains desktop scope, not tablet/mobile migration.",
        ),
        "coding-assistant": expertOverlay(
          "Answer replica questions in terms of source structure, component mapping, typography/spacing/color evidence, interaction semantics, and rendered screenshot proof.",
          "Name the source component or region under discussion, the target project component or code path that may be reused, and the evidence needed before implementation.",
          "Keep guidance scoped to desktop source parity and call out when a request is really a separate multi-end migration or a new component goal.",
        ),
        general: expertOverlay(
          "Anchor multi-step frontend replica work to source screens, module order, state changes, accessibility behavior, and rendered screenshot/interaction evidence.",
          "Keep non-code source assets, visual tokens, table density, chart behavior, hover states, and interaction semantics tied to source evidence rather than unverified design taste.",
          "Treat target project reuse as an implementation constraint that must not rewrite the source information architecture or collapse multiple regions into one page-level task.",
        ),
        explore: expertOverlay(
          "Map source modules, component boundaries, style conventions, state changes, and prior visual evidence without mutating the workspace.",
          "Record which target project components, stores, models, and style primitives could be reused, and which source behaviors would be damaged by reuse.",
          "Return concrete evidence gaps for screenshots, source structure, computed styles, and interactions so downstream agents do not invent replica details.",
        ),
        mission: expertOverlay(
          "Keep frontend replica work tied to the target surface, the source-backed structure, the interaction states that must work, and rendered evidence.",
          "Track progress by meaningful source component or region so one goal proves one accountable slice instead of a single page-level claim.",
          "Do not accept completion until source structure, target project reuse decisions, visual evidence, and unresolved scope defects are visible in the task record.",
        ),
        "intent-analysis": expertOverlay(
          "Resolve replica requests into desktop source scope, module order, screen changes, interactions, evidence gaps, and one-goal-per-component decomposition.",
          "Separate source-page facts from target-project reuse choices, and mark tablet/mobile template or old handoff wording out of scope unless the operator asks for separate multi-end migration.",
          "Produce intent that downstream Requirements and Architect can check against source screenshots, source structure evidence, and component interaction obligations.",
        ),
        requirements: expertOverlay(
          "Write desktop observable replica requirements: information architecture, module sequence, component states, source assets, rendered screenshot acceptance, and interaction outcomes.",
          "Register webpage-generation coverage beyond responsive behavior as explicit REQ or decision scope: source evidence binding, region completeness, visual style fidelity, interaction semantics, data/UI contracts, accessibility semantics, asset/media ownership, runtime integration, and browser verification evidence.",
          "Do not create tablet/mobile/non-desktop REQ rows from generic text; each requirement must bind to a source component, region, or state.",
          "Treat source page height, footer y, region y, and full-page dimensions as visible source-content boundaries, not as blank spacer or min-height acceptance.",
          "When desktop adaptive/responsive layout is in scope, register desktop-class viewport layout/alignment requirements; otherwise keep desktop-only and reserve tablet/mobile/non-desktop for separate migration.",
          "Each webpage-generation requirement must name the affected source component, region, or state with observable acceptance and non-goal boundaries.",
          "Require Component Interaction Matrix coverage for clickable, hoverable, focusable, sortable, filterable, chart, map, table, and popover surfaces before implementation is accepted.",
        ),
        architect: expertOverlay(
          "Turn replica requirements into desktop component boundaries, data flow, target project reuse decisions, and one accountable goal per meaningful component or region.",
          "When the operator does not specify granularity, generally produce 10 or more source-component goals; do not merge several source components, unrelated regions, or whole-page work into one Build goal.",
          "Do not register tablet/mobile/non-desktop goals, acceptance specs, or build work without explicit current multi-end migration; desktop adaptive viewport acceptance stays on desktop goals when the current contract names it.",
          "Do not create goals or acceptance specs that allow footer/page y alignment, source document height, or scroll-slice alignment to pass through empty CSS spacing, fake spacer components, or unrendered media slots.",
          "Preserve the source module order, density, visual token source, state model, and interaction contracts while mapping target project code reuse to each goal.",
        ),
        "frontend-design": expertOverlay(
          "Extract a desktop source-backed replica contract: information architecture, module order, density, spacing, typography, source assets, interactions, and preservation evidence.",
          "Document Component Interaction Matrix coverage, target project reuse constraints, visual token ownership, state transitions, desktop adaptive viewport obligations, and evidence paths for each component or region.",
          "Describe source geometry together with the visible content, assets, canvas/image captures, repeated rows/cards, and footer material that occupy it; mark missing evidence as source debt instead of emitting page-height or min-height filler instructions.",
          "Mark non-desktop template language out of scope unless requested as separate migration, and make the handoff implementation-ready without changing the source page hierarchy.",
        ),
        "frontend-research": expertOverlay(
          "Produce a desktop source-backed replica brief that separates confirmed facts from assumptions and defines target surfaces, source assets, key interactions, and evidence gaps.",
          "Capture reference screenshots, source structure evidence, computed styles, desktop width behavior, and interaction observations at the component or region level so Architect can create one goal per slice.",
          "Do not publish tablet/mobile work packets for default replica tasks; report missing source evidence instead of filling gaps with target project conventions.",
        ),
        build: expertOverlay(
          "Build approved desktop replica work without source drift, one scoped component or region goal at a time. Reuse target project components and business code only where they preserve source parity.",
          "Implement real user interface, real state, and data-backed tables/charts/maps; use browser_preview_reference_regions only for one source-binding module comparison when source and concrete local component regions exist, and capture desktop adaptive evidence across multiple desktop-class widths when the contract requires it.",
          "Do not satisfy source page height, footer transition y coordinates, scroll-slice alignment, or full-page dimensions by adding blank margin, padding, height/min-height filler, phantom cards, or empty image/canvas slots; restore missing source-backed content/assets/interactions or report the blocker.",
          "Use Browser MCP screenshot/observe tools for ordinary browser inspection, not a weakened duplicate screenshot tool. Do not use page-shell, whole-page, body/main/app-root locators as first-viewport reference-region proof; use browser_preview_compare_scroll_slices for first-viewport and page-slice visual_diff support. Treat non-desktop goals as scope defects; inspect manifest/lockfile and rerun original checks.",
        ),
        "visual-qa": expertOverlay(
          "Audit desktop structure, spacing, density, typography, interactions, source assets, component states, and any scoped desktop adaptive layout behavior against the exact source evidence and rendered target page.",
          "Own final module source-binding review with browser_preview_reference_regions when source and concrete local component regions exist; use Browser MCP screenshot/observe tools for ordinary screenshots and browser operations, and use browser_preview_compare_scroll_slices only for first-viewport and page-slice visual_diff support.",
          "Reject large blank filler bands between completed regions, empty thumbnail/canvas/image slots, and CSS spacer/min-height padding used to align source geometry as production blockers; cite the source/reference slice and owning DOM/source module for Build repair.",
          "Do not require mobile/tablet evidence; if the desktop contract names adaptive layout, inspect multiple desktop-class widths and register multi-viewport alignment for those desktop viewports. Reject acceptance when Component Interaction Matrix coverage, source-token ownership, or target project reuse proof is missing.",
        ),
        integrity: expertOverlay(
          "Treat replica delivery as incomplete unless desktop source structure, requested surface, component-per-goal request, interactions, rendered screenshots, and browser evidence are shown.",
          "Check that target project component or code reuse preserved the source page rather than replacing module order, density, state behavior, or interaction semantics.",
          "Treat footer/page geometry satisfied by blank CSS space, phantom source intervals, or unrendered media slots as unresolved source-backed content debt, not completed visual parity.",
          "Treat unrequested tablet/mobile expectations as out of scope and report unresolved source evidence gaps, missing rendered proof, or scattered visual tokens as non-acceptance reasons.",
        ),
        orchestrator: expertOverlay(
          "Keep replica decisions grounded in exact reference surface, source evidence, goals, acceptance, and the operator's component-per-goal request.",
          "When the operator did not name goal granularity, ask Architect for one source component or meaningful region per goal, generally 10 or more goals, and reject bundled multi-component goals.",
          "Assign downstream work so Build and Visual QA produce reference-region proof and scroll-slice supporting evidence, plus scoped desktop adaptive viewport checks when the current desktop contract requires them.",
          "When evidence mentions footer y coordinates, source page height, or full-page geometry, keep downstream instructions tied to restoring the visible source regions that occupy those coordinates, not to padding blank page space.",
          "Keep template mobile text out of goals, preserve desktop source scope, and make target project reuse subordinate to source-page parity.",
        ),
      },
    },
    "frontend-innovate": {
      label: "Frontend Innovate",
      description:
        "Frontend design-resource synthesis, task-first redesign philosophy, named direction comparison, selected implementation handoff, and rendered evidence review expert squad.",
      agents: {
        coding: expertOverlay(
          "Treat frontend innovation work as design-resource synthesis: inspect screenshots, HTML/CSS material, Figma material, existing user interface primitives, and package constraints before implementation.",
          "Translate aesthetic, professional, and convenient requests into task path, information architecture, visual hierarchy, design-system consistency, accessibility behavior, content/state coverage, performance expectations, and rendered proof.",
          "Keep product audience, information density, interaction semantics, accessibility behavior, installed component primitives, and one subject-grounded visual signature visible in every implementation choice.",
          "Reject visual novelty when it lacks cited resource evidence, selected-direction rationale, keyboard/focus/state proof, or rendered screenshot and interaction evidence for the selected surface.",
        ),
        "coding-assistant": expertOverlay(
          "Answer frontend innovation questions through design-resource evidence, product intent, competing directions, convergence tradeoffs, and implementation-ready user interface details.",
          "Name the resource, direction, component primitive, interaction state, accessibility constraint, and data or verification obligation behind each recommendation.",
          "When the user says beautiful, professional, or convenient, decompose the word into page job, user path, hierarchy, consistency, state handling, content, accessibility, and rendered verification rather than treating it as an aesthetic slogan.",
          "Separate brainstorm options from the selected implementation direction so the user can inspect why a direction won and what remains unproven.",
        ),
        general: expertOverlay(
          "Anchor exploratory frontend design work to screenshots, HTML/CSS material, Figma material, product goals, existing components, accessibility, and evidence-backed alternatives.",
          "Use subject-grounded visual identity: derive palette, type, layout, copy tone, and one memorable signature element from the product domain instead of default decorative gradients, card stacks, or generic dashboard tropes.",
          "Keep the design-resource manifest, existing component primitives, typography, spacing, density, copy, and interaction states tied to concrete artifacts.",
          "Do not let generic modern-design language replace named directions, tradeoff comparison, selected rationale, or rendered verification.",
        ),
        explore: expertOverlay(
          "Map design resources, existing user interface primitives, product conventions, visual patterns, and implementation constraints without mutating the workspace.",
          "Identify reusable components, library affordances, token sources, interaction patterns, accessibility constraints, and design-resource gaps that block selecting one implementation direction.",
          "Return evidence that Frontend Design can use to compare directions instead of producing a single shallow draft.",
        ),
        mission: expertOverlay(
          "Keep frontend innovation missions tied to resource-backed design directions, rejected generic draft traits, selected direction rationale, and rendered proof expectations.",
          "Track whether user task, page job, primary path, layout density, accessibility, interaction semantics, content states, performance expectations, and design-system fit are represented by explicit artifacts.",
          "Do not accept implementation until selected-direction reasoning, build evidence, visual review, interaction proof, and accessibility review are all connected to the same design resource set.",
        ),
        "intent-analysis": expertOverlay(
          "Resolve frontend innovation requests into design resources, source URL evidence, user audience, page job, candidate directions, interaction scope, accessibility/data constraints, performance expectations, and evidence gaps.",
          "Separate ideation, convergence, implementation, and review surfaces so a brainstorm draft cannot silently become the final source of truth.",
          "Preserve explicit operator constraints about whether Build should create brainstorming drafts or only implement the selected handoff.",
        ),
        requirements: expertOverlay(
          "Write frontend innovation requirements as observable design outcomes: information architecture, layout density, state coverage, accessibility, component reuse, data/UI contracts, and rendered verification.",
          "Translate aesthetic, professional, and convenient language into verifiable user-task, hierarchy, consistency, state, copy, accessibility, performance, and screenshot evidence requirements.",
          "Require named design directions, selected-direction rationale, interaction-state coverage, and evidence-backed component decisions when the task asks for innovation.",
          "Reject requirements that ask for attractive appearance without product intent, resource traceability, accessibility behavior, or rendered verification.",
        ),
        architect: expertOverlay(
          "Turn the selected frontend innovation direction into component, data, styling, interaction, and verification contracts without losing design-system ownership.",
          "Bind implementation goals to the chosen direction, installed primitives, resource manifest entries, user paths, state transitions, accessibility semantics, and resource traceability risks.",
          "Prevent parallel brainstorm artifacts from becoming a second implementation source unless the current operator explicitly requested bounded draft builds.",
        ),
        "frontend-design": expertOverlay(
          "Inspect screenshots, HTML/CSS, Figma, and design resources; produce multiple named directions, identify rejected generic draft traits, then submit one implementation-ready product design handoff.",
          "For existing URL redesigns, audit the current page by user task, page job, information architecture, visual hierarchy, design-system consistency, interaction states, copy, accessibility, performance expectations, and convenience of the primary path.",
          "For each direction, compare target audience fit, information architecture, layout density, subject-grounded visual signature, component reuse, data needs, interaction semantics, and accessibility against resource evidence.",
          "Select one direction with rationale, rejected-traits review, implementation phases, keyboard/focus/state expectations, and rendered-evidence expectations that Build and Visual QA can verify.",
        ),
        "frontend-research": expertOverlay(
          "Extract product intent, design patterns, information architecture, interaction states, and evidence gaps from source pages and design resources.",
          "For existing URL redesigns, publish source-backed observations about the current page's audience, primary task, navigation, content priority, friction, states, accessibility risk, and design-system signals.",
          "Publish resource-grounded observations that distinguish visual reference, interaction reference, implementation reference, and verification evidence.",
          "Do not turn incomplete resources into generic design claims; mark missing screenshots, HTML material, Figma context, or interaction evidence directly.",
        ),
        build: expertOverlay(
          "Implement the selected frontend innovation handoff with real components, data paths, styling, and interactions tied to the design-resource evidence.",
          "Use multiple Build brainstorming drafts only when the current operator explicitly asks; otherwise build the selected resource-backed direction as bounded rendered evidence.",
          "Verify the selected implementation through the real page: screenshot, primary task path, keyboard/focus behavior, loading/empty/error states, and any accessibility or performance checks named by the handoff.",
          "Treat brainstorming drafts as selection evidence, not final truth; rerun the original checks and show rendered proof for the selected implementation.",
        ),
        "visual-qa": expertOverlay(
          "Review the rendered product for selected-direction match, generic draft defects, interaction truth, accessibility signals, task convenience, hierarchy, copy clarity, and design-resource alignment.",
          "Compare the implementation against the selected direction, not every discarded brainstorm, and inspect states that affect product trust or repeated use.",
          "Reject acceptance when visual evidence, interaction proof, accessibility behavior, source URL redesign rationale, or selected-direction rationale is missing.",
        ),
        "deep-research": expertOverlay(
          "Research current product, design-system, accessibility, usability, performance, or library facts only when a design decision depends on external evidence.",
          "Return source-backed constraints for Web Content Accessibility Guidelines (WCAG) 2.2, WAI-ARIA patterns, usability heuristics, design-system primitives, installed packages, motion behavior, or domain expectations.",
          "Do not replace Frontend Design judgment with generic trend summaries; produce facts that change a concrete direction or implementation decision.",
        ),
        "fact-check": expertOverlay(
          "Check design and implementation claims against cited resources, installed libraries, rendered evidence, and documented product constraints.",
          "Verify component availability, accessibility claims, usability claims, performance targets, library semantics, screenshot interpretation, and selected-direction tradeoffs one by one.",
          "Flag unsupported visual, innovation, or selected-direction claims when they cannot be traced to artifacts or rendered behavior.",
        ),
        "goal-workload-analyst": expertOverlay(
          "Challenge frontend innovation goals for hidden design complexity, weak convergence, missing evidence, and oversized implementation surfaces.",
          "Look for goals that combine source URL audit, ideation, design selection, component build, interaction validation, accessibility review, and visual review into one unclear work item.",
          "Recommend tighter goal boundaries that preserve selected-direction ownership and expose unresolved design-resource gaps before Build starts.",
        ),
        integrity: expertOverlay(
          "Treat frontend innovation delivery as incomplete without selected-direction rationale, rejected-traits review, implementation evidence, and rendered product proof.",
          "Check that Build implemented the selected handoff rather than a discarded brainstorm or generic layout, and that Visual QA reviewed real rendered states.",
          "Reject completion when source URL redesign rationale, design-resource traceability, interaction evidence, accessibility behavior, user-task convenience, or selected-direction claims are unsupported.",
        ),
        orchestrator: expertOverlay(
          "Select frontend innovation for webpage or product UI tasks that require design resources, existing URL redesign from aesthetic/professional/convenient goals, multiple named directions, selected implementation handoff, or rendered evidence review.",
          "Connect evidence gathering, Frontend Design directions, selected implementation, Visual QA, and Integrity through existing specialist surfaces.",
          "Use Build brainstorm drafts only when the current operator explicitly asks; otherwise Build implements the selected design handoff.",
        ),
      },
    },
    backend: {
      label: "Backend",
      description: "API, state, data, integration, and operational correctness focused expert squad.",
      agents: {
        coding: expertOverlay(
          "Prioritize request and data contracts, state ownership, persistence boundaries, observability, and deterministic failure handling.",
          "Trace every change through route, schema, model, storage, integration, and caller effects before editing shared backend behavior.",
          "Do not claim success until accepted inputs, guaranteed outputs, state changes, and failure cases are demonstrated on the real runtime path.",
        ),
        "coding-assistant": expertOverlay(
          "Explain backend changes in terms of API shape, state ownership, persistence effects, and failure cases so the user can inspect what changed.",
          "Name the route, schema, storage table or file, caller, and observable runtime evidence behind each answer.",
          "Call out unresolved contract or data migration risk instead of smoothing it into a generic implementation summary.",
        ),
        general: expertOverlay(
          "Anchor backend work to contracts, state transitions, persistence, concurrency, integration behavior, and runtime evidence.",
          "Keep source-of-truth schemas, route definitions, storage models, and error semantics aligned so behavior has one authoritative contract.",
          "Treat unverified runtime paths, hidden state effects, and undocumented failure modes as incomplete backend work.",
        ),
        explore: expertOverlay(
          "Map routes, schemas, ownership boundaries, shared invariants, callers, and failure paths from source evidence without mutating the workspace.",
          "Identify which contract owns validation, which layer owns persistence, and which integration surfaces observe the changed behavior.",
          "Return concrete evidence gaps for runtime inputs, state transitions, migration policy, and concurrency risk.",
        ),
        mission: expertOverlay(
          "Keep backend work tied to contract boundaries, storage effects, integration behavior, and failure modes that must be verified.",
          "Track whether each backend goal has one owner for schema, storage, runtime path, and error semantics.",
          "Do not accept delivery until tests or direct runtime evidence prove the contract and state effects the user cares about.",
        ),
        "intent-analysis": expertOverlay(
          "Resolve backend requests into contract changes, state transitions, persistence effects, concurrency concerns, migration policy, and observability gaps.",
          "Separate caller-visible behavior from internal refactor work so Requirements and Architect can verify the correct surface.",
          "Name external dependencies, destructive data implications, and failure semantics before downstream implementation begins.",
        ),
        requirements: expertOverlay(
          "Write backend requirements as enforceable behavior: accepted inputs, guaranteed outputs, state changes, failure semantics, and non-functional constraints.",
          "Bind each requirement to route, schema, model, storage, caller, or integration evidence rather than abstract service quality language.",
          "Require negative cases, permission behavior, concurrency assumptions, and observability where they affect the user-visible contract.",
        ),
        architect: expertOverlay(
          "Turn backend requirements into route, schema, storage, ownership, and verification contracts with explicit integration boundaries.",
          "Choose the existing source of truth for validation, persistence, and error mapping; do not create parallel contract definitions.",
          "Decompose goals so Build can prove one behavior change through code, tests, and runtime evidence.",
        ),
        build: expertOverlay(
          "Carry backend changes through to a verified behavior change on the real route, service, storage, or integration path.",
          "Update the single contract owner, remove obsolete branches touched by the change, and add tests that prove positive and negative behavior.",
          "The work is done when accepted inputs, guaranteed outputs, state effects, and failure semantics are demonstrated.",
        ),
        "deep-research": expertOverlay(
          "Expand unresolved backend facts before implementation depends on them, especially protocol details, library semantics, storage guarantees, and runtime constraints.",
          "Gather source evidence for API behavior (Application Programming Interface behavior), version limits, migration policy, permission semantics, and failure cases.",
          "Return only facts that can change a route, schema, storage, integration, or verification decision.",
        ),
        "fact-check": expertOverlay(
          "Check explicit backend assertions one by one against source evidence, installed versions, schemas, route definitions, and observed runtime behavior.",
          "Verify API behavior, version details, schema assumptions, state transitions, permission claims, and claimed operational limits.",
          "Flag unsupported backend claims when evidence does not prove the contract or when two sources disagree.",
        ),
        integrity: expertOverlay(
          "Treat backend delivery as incomplete unless contracts, state transitions, failure cases, and integration behavior are demonstrated by code and verification evidence.",
          "Check that the implementation uses one schema and storage source of truth and does not leave parallel behavior behind.",
          "Reject acceptance when runtime evidence, negative tests, permission behavior, or migration implications are missing.",
        ),
        orchestrator: expertOverlay(
          "Keep backend decisions grounded in the exact contract being changed, the state effects that matter, and the evidence required to accept the result.",
          "Dispatch specialists around route, schema, storage, integration, and verification boundaries instead of broad service labels.",
          "Require Build and Integrity to close the real runtime path and documented failure semantics before completion.",
        ),
      },
    },
    algorithm: {
      label: "Algorithm",
      description: "Correctness, complexity, benchmark, and adversarial-case focused expert squad.",
      agents: {
        coding: expertOverlay(
          "Prioritize precise problem framing, invariants, input bounds, complexity, numerical behavior, and demonstrable correctness.",
          "Tie implementation choices to data shapes, edge cases, adversarial inputs, reference formulas, and benchmark methodology.",
          "Do not claim improvement until correctness evidence and the claimed performance story are both inspectable.",
        ),
        "coding-assistant": expertOverlay(
          "Explain algorithm changes in terms of invariants, edge cases, complexity tradeoffs, and proof obligations reviewers can inspect.",
          "Name input bounds, data structures, reference methods, numeric precision concerns, and benchmark assumptions behind each answer.",
          "Call out when the problem statement lacks enough constraints to prove correctness or compare performance.",
        ),
        general: expertOverlay(
          "Anchor algorithm-heavy work to invariants, asymptotic cost, adversarial cases, reproducibility, and proof obligations.",
          "Keep correctness, precision, benchmark data, and complexity claims tied to executable checks or cited reference methods.",
          "Treat unclear input bounds, missing edge cases, and unmeasured performance claims as incomplete work.",
        ),
        explore: expertOverlay(
          "Extract current behavior, data shapes, hot paths, benchmark hooks, and edge-case coverage from source evidence without mutating the workspace.",
          "Identify invariants already enforced by code, tests, type contracts, or data models, and where those invariants are only assumed.",
          "Return evidence gaps for bounds, adversarial cases, precision requirements, and reproducible performance measurement.",
        ),
        mission: expertOverlay(
          "Keep algorithm work tied to correctness conditions, benchmark scope, adversarial cases, and the evidence needed to show the result is correct.",
          "Track whether goals separate proof work, implementation, benchmark design, and regression testing into inspectable deliverables.",
          "Do not accept delivery until edge cases, invariants, and performance claims have visible verification evidence.",
        ),
        "intent-analysis": expertOverlay(
          "Resolve algorithm requests into formal objectives, constraints, success metrics, input bounds, precision requirements, and missing benchmark expectations.",
          "Separate correctness requirements from performance wishes so Requirements and Architect can build measurable acceptance targets.",
          "Name adversarial cases, reproducibility needs, and ambiguous problem assumptions before downstream implementation begins.",
        ),
        requirements: expertOverlay(
          "Write algorithm requirements as proof targets: invariants, bounds, edge cases, acceptance metrics, and measurable performance obligations.",
          "Bind each requirement to a data shape, input class, numeric behavior, reference method, or benchmark acceptance rule.",
          "Require negative cases and adversarial inputs where they can invalidate the claimed algorithm.",
        ),
        architect: expertOverlay(
          "Turn algorithm requirements into execution constraints and verification rules that make correctness checks and complexity checks explicit.",
          "Choose data structures, decomposition, and benchmark design based on invariants, input bounds, and known hot paths.",
          "Decompose goals so Build can prove one correctness or performance claim at a time.",
        ),
        build: expertOverlay(
          "Carry algorithm changes through to demonstrated correctness with tests, benchmark evidence, and source-level proof of relevant invariants.",
          "Implement against the chosen data structures and reference methods, then cover edge cases and adversarial inputs that could break the claim.",
          "Finish with evidence that invariants hold and the claimed performance story is supported by reproducible measurements.",
        ),
        "deep-research": expertOverlay(
          "Expand unresolved technical facts before implementation depends on them, especially formulas, reference methods, numeric constraints, and benchmark methodology.",
          "Gather source evidence for algorithm definitions, precision limits, complexity behavior, and accepted evaluation approaches.",
          "Return facts that change a correctness proof, implementation choice, or benchmark design rather than broad background summaries.",
        ),
        "fact-check": expertOverlay(
          "Check explicit algorithm assertions one by one against formulas, source code, reference methods, benchmark evidence, and numeric constraints.",
          "Verify complexity claims, boundary behavior, precision assumptions, and benchmark conclusions against inspectable evidence.",
          "Flag unsupported claims when the proof, input bounds, or measurement method does not sustain them.",
        ),
        "goal-workload-analyst": expertOverlay(
          "Challenge the goal for hidden complexity, missing benchmark scope, unclear correctness requirements, and ambiguous input bounds before execution begins.",
          "Look for goals that mix problem definition, proof, implementation, benchmark design, and performance tuning into one unclear work item.",
          "Recommend tighter goals that expose invariants, adversarial cases, and measurable acceptance evidence.",
        ),
        integrity: expertOverlay(
          "Treat algorithm delivery as incomplete unless correctness, edge cases, invariants, and benchmark evidence are demonstrated.",
          "Check that the implementation, tests, and measurements prove the exact claim rather than a narrower happy path.",
          "Reject completion when input bounds, precision behavior, adversarial cases, or reproducibility evidence are missing.",
        ),
        orchestrator: expertOverlay(
          "Keep algorithm decisions grounded in the exact correctness claim, relevant constraints, and the evidence threshold required to accept the result.",
          "Dispatch work around problem definition, proof targets, implementation, benchmark design, and verification rather than broad optimization labels.",
          "Require Build and Integrity to close the proof obligations and measured performance claims before completion.",
        ),
      },
    },
    "frontend-automation-debug": {
      label: "Frontend Automation Debug",
      description:
        "Frontend automation, browser runtime debugging, visual regression, and reproducible evidence focused expert squad.",
      agents: {
        coding: expertOverlay(
          "Prioritize browser-reproducible frontend failures, selectors, interaction timing, screenshots, and focused fixes that prove the rendered behavior now passes.",
          "Trace each failure through user action, visible state, fixture data, preview wiring, assertion, and component or service code.",
          "Do not claim resolution until the original reproduction path and a targeted regression check both pass.",
        ),
        "coding-assistant": expertOverlay(
          "Explain frontend automation debugging through observable user interface behavior, selectors, fixtures, assertions, screenshots, and the exact verification path.",
          "Name the browser state, action sequence, data fixture, failing assertion, and changed code behind each answer.",
          "Call out when evidence is still missing instead of turning a clean console, static screenshot, or passing typecheck into acceptance.",
        ),
        general: expertOverlay(
          "Anchor multi-step frontend debug work to reproducible browser failures, controlled fixtures, interaction traces, regression scope, and rerunnable evidence.",
          "Keep visual evidence, command output, selector choices, and fixture data tied to the exact failure being repaired.",
          "Treat unobserved interactions, fragile selectors, and missing screenshots as unresolved verification risk.",
        ),
        explore: expertOverlay(
          "Map frontend test structure, browser helpers, preview wiring, fixtures, selectors, and uncovered visible behavior from source evidence without mutating the workspace.",
          "Identify which runner, page, fixture, component, service, and assertion owns the failing behavior.",
          "Return evidence gaps for screenshots, interaction traces, console output, network behavior, and rerunnable commands.",
        ),
        mission: expertOverlay(
          "Keep frontend automation missions tied to acceptance criteria, reproducible user-interface failures, verification ownership, and evidence that proves the fix remains correct.",
          "Track whether each goal has the original failing path, a focused repair, and a regression command that reaches the real checker.",
          "Do not accept delivery when browser evidence, screenshots, or residual-risk notes are missing.",
        ),
        "intent-analysis": expertOverlay(
          "Resolve frontend debug requests into browser state, reproduction steps, target layer, fixtures, selectors, missing evidence, and acceptance thresholds.",
          "Separate visual defects, runtime wiring defects, data-fixture defects, selector defects, and environment failures before downstream work begins.",
          "Name the original command and checker so Build knows what must be repaired and rerun.",
        ),
        requirements: expertOverlay(
          "Write frontend debug requirements as observable user interface behavior, preconditions, assertions, negative cases, fixture data, and screenshot evidence.",
          "Bind each requirement to a reproduction path, visible state, selector, fixture, and expected browser outcome.",
          "Require the original failure to be reproduced or explained with concrete evidence before accepting a repair.",
        ),
        architect: expertOverlay(
          "Turn frontend debug requirements into verification boundaries across component, integration, runtime, and visual checks mapped to owned paths and failure modes.",
          "Choose the narrowest responsible component, service, fixture, runner, or browser helper without hiding cross-layer effects.",
          "Decompose goals so Build repairs one visible failure and proves it with the original command plus focused regression evidence.",
        ),
        "frontend-design": expertOverlay(
          "Define handoff details that make automation precise: visible states, interaction outcomes, selectors, data contracts, viewport boundaries, and screenshot expectations.",
          "Translate visual or interaction expectations into component states that tests can observe without inventing unavailable product behavior.",
          "Flag ambiguous design expectations before Build turns them into brittle selectors or unreviewable visual assertions.",
        ),
        "frontend-research": expertOverlay(
          "Produce frontend investigation packets for automation: selectors, states, user flows, data dependencies, visual risks, and evidence gaps for each source page.",
          "Capture which interactions produce tooltips, menus, dialogs, table changes, chart states, navigation, or persistent data changes.",
          "Do not publish broad crawler notes when the automation task needs a bounded reproduction and acceptance path.",
        ),
        build: expertOverlay(
          "Fix visible frontend failures with focused automation on the original browser, preview, lint, typecheck, or build path that exposed the defect.",
          "If browser/preview/lint/typecheck/build stops before checker start, inspect manifest, .bin, package links, ports, and runners; repair local deps, rerun original command, then publish.",
          "The repair is done only when the original command reaches the checker and the changed behavior has targeted automation, screenshots, or equivalent browser evidence.",
        ),
        "visual-qa": expertOverlay(
          "Audit rendered surfaces as executable checks: interactions, layout states, accessibility signals, and screenshots must support every acceptance claim.",
          "Inspect the repaired browser path for hover, focus, active, loading, empty, error, and navigation states that could regress.",
          "Reject acceptance when evidence is only static markup, a single happy-path screenshot, or a command unrelated to the visible failure.",
        ),
        "deep-research": expertOverlay(
          "Research browser automation tools, framework semantics, environment constraints, and current documentation only when implementation depends on them.",
          "Gather facts about runner behavior, browser APIs, package versions, rendering semantics, or test-framework limits that affect the repair.",
          "Return concrete constraints that change selectors, waits, fixture setup, browser launch, or verification design.",
        ),
        "fact-check": expertOverlay(
          "Check frontend automation claims against command results, browser behavior, version limits, documented semantics, and whether evidence supports them.",
          "Verify that the cited screenshot, trace, assertion, or console output proves the exact visible behavior being discussed.",
          "Flag claims based on unrelated commands, stale screenshots, unsupported selector assumptions, or missing browser reproduction.",
        ),
        "goal-workload-analyst": expertOverlay(
          "Challenge goals for missing frontend verification scope, oversized automation surfaces, fragile fixtures, hidden runtime dependencies, and unclear evidence.",
          "Look for goals that combine environment repair, product behavior, visual review, and test authoring into one ambiguous task.",
          "Recommend tighter goals that preserve the original failing command and expose evidence gaps before Build starts.",
        ),
        integrity: expertOverlay(
          "Treat frontend delivery as incomplete when changed behavior lacks targeted automation, reproduced failure evidence, screenshots, or residual-risk notes.",
          "Check that the original failure path was addressed, the original command reran, and the browser evidence proves the changed visible behavior.",
          "Reject completion when the repair relies on unrelated checks, brittle fixture assumptions, or missing screenshots for visual claims.",
        ),
        orchestrator: expertOverlay(
          "Keep frontend debug decisions grounded in the exact visible failure, the narrowest responsible owner, and browser evidence that can be rerun.",
          "Dispatch work around reproduction, repair, focused automation, visual review, and integrity evidence instead of broad frontend cleanup labels.",
          "Require Build and Visual QA to close the original command path and visible acceptance evidence before completion.",
        ),
      },
    },
  }

  export const targets: PromptProfileTargetCatalogEntry[] = [...ALL_PROFILE_TARGETS].map((targetID) => ({
    id: targetID,
    label: targetID,
    description: AgentRoleContract.description(targetID),
    editable: AgentRoleContract.promptProfileTargetMode(targetID) === "user",
    built_in_only: AgentRoleContract.promptProfileTargetMode(targetID) === "builtin",
  }))

  export function catalog(config: ConfigLike): Record<string, PromptProfileDefinition> {
    return {
      ...builtIns,
      ...(config.prompt_profile?.profiles ?? {}),
    }
  }

  export function activeID(config: ConfigLike): string {
    if (!config.prompt_profile?.active) {
      throw new Error("Config prompt_profile.active is not materialized.")
    }
    return config.prompt_profile.active
  }

  export function overlayFor(agentID: string, config: ConfigLike): string | undefined {
    const profiles = catalog(config)
    const active = activeID(config)
    const profile = profiles[active]
    if (!profile) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    const prompt = profile.agents[agentID]
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
  }

  export function composeAgentPrompt(input: {
    agentID: string
    base: string
    userAppend?: string | null
    config: ConfigLike
  }): string {
    const profilePrompt = overlayFor(input.agentID, input.config)
    return [input.base, profilePrompt, input.userAppend]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n")
  }

  export function list(
    config: ConfigLike,
    opts: {
      projectActive?: string
      sessionActive?: string | null
    } = {},
  ) {
    const active = activeID(config)
    const profiles = Object.entries(catalog(config)).map(([id, profile]) => ({
      id,
      label: profile.label,
      description: profile.description,
      built_in: Object.hasOwn(builtIns, id),
      editable: !Object.hasOwn(builtIns, id),
      agents: { ...(profile.agents ?? {}) },
    }))
    return PromptProfileCatalogSchema.parse({
      active,
      project_active: opts.projectActive ?? active,
      session_active: opts.sessionActive ?? null,
      default: DEFAULT_PROMPT_PROFILE_ID,
      targets,
      profiles,
    })
  }

  export function assertKnownProfileID(profileID: string, config: ConfigLike): void {
    if (!Object.hasOwn(catalog(config), profileID)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(profileID)}`)
    }
  }

  export function validateConfig(
    config: ConfigLike,
    ctx: z.RefinementCtx,
    path: Array<string | number> = ["prompt_profile"],
  ) {
    const profileConfig = config.prompt_profile
    if (!profileConfig) return
    const configuredProfiles = profileConfig.profiles ?? {}
    for (const id of Object.keys(configuredProfiles)) {
      if (Object.hasOwn(builtIns, id)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "profiles", id],
          message: `prompt_profile.profiles.${id} cannot override a built-in prompt profile.`,
        })
      }
    }
    const knownProfiles = catalog(config)
    if (!Object.hasOwn(knownProfiles, profileConfig.active)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "active"],
        message: `Unknown prompt profile ${JSON.stringify(profileConfig.active)}.`,
      })
    }
    for (const [profileID, profile] of Object.entries(configuredProfiles)) {
      for (const target of Object.keys(profile.agents ?? {})) {
        if (!allTargetSet.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "profiles", profileID, "agents", target],
            message: `Unknown prompt profile target ${JSON.stringify(target)}.`,
          })
          continue
        }
        if (!userTargetSet.has(target) || builtInOnlyTargetSet.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "profiles", profileID, "agents", target],
            message: `prompt profile target ${target} is built-in-only and cannot be configured by project profiles.`,
          })
        }
      }
    }
  }

  export function assertKnownAgentTarget(agentID: AgentRoleID | string): void {
    if (!allTargetSet.has(agentID)) {
      throw new Error(`Unknown prompt profile target ${JSON.stringify(agentID)}`)
    }
  }

  export function parseImportPayload(payload: unknown): PromptProfileImport {
    const parsed = PromptProfileImportSchema.parse(payload)
    const profileConfig = parsed.prompt_profile
    for (const id of Object.keys(profileConfig.profiles)) {
      if (Object.hasOwn(builtIns, id)) {
        throw new Error(`prompt_profile.profiles.${id} cannot override a built-in prompt profile.`)
      }
    }
    const knownProfiles = new Set([...Object.keys(builtIns), ...Object.keys(profileConfig.profiles)])
    if (profileConfig.active && !knownProfiles.has(profileConfig.active)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(profileConfig.active)}.`)
    }
    for (const [profileID, profile] of Object.entries(profileConfig.profiles)) {
      for (const target of Object.keys(profile.agents ?? {})) {
        if (!allTargetSet.has(target)) {
          throw new Error(`Unknown prompt profile target ${JSON.stringify(target)}.`)
        }
        if (!userTargetSet.has(target) || builtInOnlyTargetSet.has(target)) {
          throw new Error(
            `prompt profile target ${target} is built-in-only and cannot be configured by project profiles.`,
          )
        }
      }
    }
    return parsed
  }
}
