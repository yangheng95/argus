import { tool } from "ai"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { decodePNG, type DecodedPNG } from "@/util/pixel-stats"
import { auditWebCloneSourceSkeletonConsumption } from "@/web-clone/source-skeleton-consumption-audit"
import {
  generateWebCloneSourceProject,
  renderSourceProjectVisualIterationMatrix,
  type GenerateWebCloneSourceProjectOutput,
} from "@/web-clone/source-project-generator"
import type { createFrontendTemplateOutputTools, FrontendTemplateFinal } from "./output-tools"

const FRONTEND_SKELETON_ENTRYPOINTS = [
  "README.md",
  "package.json",
  "tsconfig.json",
  "index.html",
  "src/App.tsx",
  "src/main.tsx",
  "src/components/SourceClonePage.tsx",
  "src/components/SourceDomPage.tsx",
  "src/components/AssetPath.tsx",
  "src/components/ContentTable.tsx",
  "src/components/SourceAssetPathGroup.tsx",
  "src/components/SourceFaqList.tsx",
  "src/components/source-dom/*Region.tsx",
  "src/data/sourceData.ts",
  "src/data/sourceDomRegions.ts",
  "src/data/sourceDomReplacementPlan.ts",
  "src/data/sourceDomIterationState.ts",
  "src/data/sourceSvgAssetGroups.ts",
  "src/data/sourceFaqGroups.ts",
  "src/data/svgPaths.ts",
  "src/data/sourceProjectManifest.json",
  "src/styles.css",
  "src/styles/source-critical.css",
  "src/styles/source-full.css",
  "reference.png",
]

const FRONTEND_SKELETON_DEEP_REFERENCE_FILES = [
  "src/components/ContentTable.tsx",
  "src/components/SourceAssetPathGroup.tsx",
  "src/components/SourceFaqList.tsx",
  "src/data/sourceDomRegions.ts",
  "src/data/sourceDomReplacementPlan.ts",
  "src/data/sourceDomIterationState.ts",
  "src/data/sourceSvgAssetGroups.ts",
  "src/data/sourceFaqGroups.ts",
]

const MAX_HOST_BASELINE_REPLACEMENT_PLAN_ITEMS = 18

export interface SourceReplacementPlanForSummary {
  regionComponentName?: string
  regionFilePath?: string
  priority?: string
  replacementKind?: string
  problem?: string
  dataSources?: string[]
  assetSources?: string[]
  firstReplacementStep?: string
  parityGuard?: string
}

export interface HostPreparedFrontendProject {
  status: "created" | "blocked"
  projectRoot: string
  sourcePackage: string
  projectRootRef: string
  sourcePackageRef: string
  entrypoints: string[]
  generationTool: string
  warnings: string[]
  error?: string
  compactEvidence: string
  visualIterationMatrix?: string
  sourceReplacementPlan: SourceReplacementPlanForSummary[]
  sourceAuditEvidence?: string
}

export interface TextOnlyFrontendTemplateBrief {
  title: string
  request: string
}

const FlexibleStringListSchema = z.preprocess((value) => {
  if (value == null || value === "") return []
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return [String(value)]
  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
}, z.array(z.string().min(1)).default([]))

const HostPreparedSubmitSchema = z.object({
  summary: z.string().default(""),
  frontend_template: z.string().default(""),
  component_inventory: z.string().default(""),
  implementation_risks: FlexibleStringListSchema,
  agent_handoff_notes: FlexibleStringListSchema,
  data_contract: z.string().default(""),
  visual_contract: z.string().default(""),
  open_questions: FlexibleStringListSchema,
})

const TextOnlySubmitSchema = z.object({
  summary: z.string().default(""),
  final_delivery_mode: z.enum(["visual_baseline_allowed", "maintainable_replacement_required"]).default("visual_baseline_allowed"),
  implementation_risks: FlexibleStringListSchema,
  agent_handoff_notes: FlexibleStringListSchema,
  visual_contract: z.string().default(""),
  data_contract: z.string().default(""),
  open_questions: FlexibleStringListSchema,
})

export function selectFrontendTemplateSubmitTool(
  outputToolKit: ReturnType<typeof createFrontendTemplateOutputTools>,
  hostPreparedFrontendProject?: HostPreparedFrontendProject,
  options: { textOnlyBrief?: TextOnlyFrontendTemplateBrief } = {},
) {
  if (hostPreparedFrontendProject) {
    return {
      submit_frontend_template: tool({
        description:
          "Submit the host-prepared frontend_design public report. In host-prepared mode the high-fidelity source project and named evidence already define the detailed project contract; provide only concise problems/handoff notes or leave fields empty, and the normal frontend_design terminal report will carry the downstream handoff.",
        inputSchema: HostPreparedSubmitSchema,
        execute: async (input, options) => {
          const submit = outputToolKit.tools.submit_frontend_template
          return submit.execute!(
            hostPreparedFrontendTemplatePayload(hostPreparedFrontendProject, HostPreparedSubmitSchema.parse(input)),
            options,
          )
        },
      }),
    }
  }
  if (options.textOnlyBrief) {
    return {
      submit_frontend_template: tool({
        description:
          "Submit the text-only frontend_design public report. No visual source is available in this turn; provide concise risks/handoff notes or leave fields empty, and the normal frontend_design terminal report will carry the downstream handoff.",
        inputSchema: TextOnlySubmitSchema,
        execute: async (input, submitOptions) => {
          const submit = outputToolKit.tools.submit_frontend_template
          return submit.execute!(
            textOnlyFrontendTemplatePayload(options.textOnlyBrief!, TextOnlySubmitSchema.parse(input)),
            submitOptions,
          )
        },
      }),
    }
  }
  return {
    submit_frontend_template: outputToolKit.tools.submit_frontend_template,
  }
}

function nonEmptyOrDefault(value: string | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback
}

function joinSourceRef(root: string, relative = ""): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "")
  const normalizedRelative = relative.replaceAll("\\", "/").replace(/^\/+/, "")
  return normalizedRelative ? `${normalizedRoot}/${normalizedRelative}` : normalizedRoot
}

function sourcePackageRef(project: HostPreparedFrontendProject, relative = ""): string {
  return joinSourceRef(project.sourcePackageRef, relative)
}

function skeletonProjectRef(project: HostPreparedFrontendProject, relative = ""): string {
  return joinSourceRef(project.projectRootRef, relative)
}

function splitTrailingPathPunctuation(relative: string): { pathPart: string; suffix: string } {
  const match = /([.)\]]+)$/.exec(relative)
  if (!match) return { pathPart: relative, suffix: "" }
  return {
    pathPart: relative.slice(0, -match[1].length),
    suffix: match[1],
  }
}

function rewriteHostPreparedRefs(project: HostPreparedFrontendProject, value: string): string {
  return value
    .replace(/\bweb-clone-source\/([A-Za-z0-9._/*-][A-Za-z0-9._/*/-]*)/g, (_match, relative) => {
      const parts = splitTrailingPathPunctuation(relative)
      return `${sourcePackageRef(project, parts.pathPart)}${parts.suffix}`
    })
    .replace(/\bfrontend-design-skeleton\/([A-Za-z0-9._/*-][A-Za-z0-9._/*/-]*)/g, (_match, relative) => {
      const parts = splitTrailingPathPunctuation(relative)
      return `${skeletonProjectRef(project, parts.pathPart)}${parts.suffix}`
    })
}

function rewriteHostPreparedPayload<T>(project: HostPreparedFrontendProject, value: T): T {
  if (typeof value === "string") return rewriteHostPreparedRefs(project, value) as T
  if (Array.isArray(value)) return value.map((item) => rewriteHostPreparedPayload(project, item)) as T
  if (!value || typeof value !== "object") return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) output[key] = rewriteHostPreparedPayload(project, item)
  return output as T
}

function hostPreparedFrontendTemplatePayload(
  project: HostPreparedFrontendProject,
  input: z.infer<typeof HostPreparedSubmitSchema>,
) {
  const finalDeliveryMode = "maintainable_replacement_required" as const
  const sourceRefs = [
    "web-clone-source/README.md",
    "web-clone-source/implementation-blueprint.md",
    "web-clone-source/web-clone-implementation-contract.json",
    "web-clone-source/source-ir/component-tree.json",
    "web-clone-source/source-ir/content-model.json",
    "web-clone-source/source-ir/style-tokens.json",
    "web-clone-source/source-ir/interaction-hints.json",
    "web-clone-source/source-skeleton/critical.css",
    "web-clone-source/reference.png",
    ...project.entrypoints.map((entry) => `frontend-design-skeleton/${entry}`),
  ]
  const deepSourceRefs = FRONTEND_SKELETON_DEEP_REFERENCE_FILES.map((entry) => `frontend-design-skeleton/${entry}`)
  const sourceAuditOutcome = summarizeSourceAuditOutcomeForReport(project.sourceAuditEvidence)
  const visualIterationMatrix = hostPreparedVisualIterationMatrix(project)
  const summary = nonEmptyOrDefault(
    input.summary,
    "Refactor the captured rawproject/source project into a maintainable frontend by replacing named source regions with traceable semantic components, data modules, and scoped styles.",
  )
  return rewriteHostPreparedPayload(project, {
    design_system:
      "Reference-derived webpage system: preserve the captured page hierarchy, typography, spacing, colors, imagery, controls, repeated surfaces, responsive behavior, and interaction affordances from the source artifacts.",
    tech_stack: ["React", "Vite", "TypeScript"],
    final_delivery_mode: finalDeliveryMode,
    frontend_template: nonEmptyOrDefault(
      input.frontend_template,
      [
        summary,
        "The host-prepared frontend-design source project is captured rawproject evidence and a source seed, not a new design brief and not the final maintainable code by itself.",
        "Downstream implementation should copy/adapt only the traceable source entrypoints, source-dom region files, generated DOM component, CSS sidecars, SVG/FAQ/replacement-plan data modules, public assets, and source data modules needed to preserve provenance, then replace/refine named regions in place.",
        "Primary surfaces must be derived from the embedded source IR, content model, source skeleton, style tokens, and visible reference screenshot, not from a site-specific default inventory.",
        "Use src/data/sourceDomIterationState.ts as the source-region iteration state: it names semantic replacements already produced, remaining source-dom debt, and the next region to replace; use sourceDomReplacementPlan.ts for the matching region's data/asset/parity details.",
        "For each replacement, follow a vertical slice: extract source data, render a semantic component, add scoped CSS, clear conflicting generated boundary constraints, then compare against reference.png before deleting generated coverage.",
        "A deferred source-dom region is an explicitly unfinished replacement item, not evidence that the final maintainable delivery has passed.",
        "If a later PRD changes the cloned page, treat those as explicit delta surfaces: keep unchanged source/reference surfaces under the clone visual contract, and judge changed surfaces against the PRD plus local design consistency.",
      ].join("\n"),
    ),
    frontend_template_sections: [
      { title: "Captured rawproject seed", detail: "Use the frontend-design React source project as traceable evidence and source seed for region-by-region refinement.", source_refs: sourceRefs },
      { title: "Source-region refactor", detail: "Preserve extracted hierarchy/source ids while replacing named regions with semantic React components, data modules, and scoped CSS.", source_refs: ["web-clone-source/source-ir/component-tree.json", "frontend-design-skeleton/src/data/sourceDomIterationState.ts", "frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts"] },
    ],
    fillable_modules:
      "Root app entrypoints, semantic page/section components, source-dom region boundaries, source-derived data modules, replacement-plan sidecars, scoped CSS, retained CSS sidecars, asset references, interaction modules, and verification scripts are the fillable implementation modules.",
    fillable_module_items: [
      { title: "Root app adoption", detail: "Copy/adapt package metadata, index.html, high-fidelity src entrypoints, source-dom region files, generated DOM component, public assets, CSS sidecars, SVG/FAQ/replacement sidecar data, and TS config from frontend-design-skeleton into the delivery root.", source_refs: project.entrypoints.map((entry) => `frontend-design-skeleton/${entry}`) },
      {
        title: "Replacement plan",
        detail: "Use sourceDomIterationState.ts for the next source-region replacement and sourceDomReplacementPlan.ts/sourceDomRegions.ts for the region boundary, strategy, and parity guard.",
        source_refs: ["frontend-design-skeleton/src/data/sourceDomIterationState.ts", "frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts", "frontend-design-skeleton/src/data/sourceDomRegions.ts"],
      },
      { title: "Source data wiring", detail: "Move repeated visible tables, cards, lists, navigation items, labels, media references, FAQ content, and interaction hints into source-derived data modules or APIs only when the user request requires that implementation depth.", source_refs: ["web-clone-source/source-ir/content-model.json", "frontend-design-skeleton/src/data/sourceData.ts", "frontend-design-skeleton/src/data/sourceFaqGroups.ts"] },
    ],
    component_inventory: nonEmptyOrDefault(
      input.component_inventory,
      "Compatibility summary only: do not use this as a standalone component checklist. The public frontend_design report sections, component_reuse_plan, quality_project_contract, completeness_review, open_questions, and named source artifacts carry implementation decisions.",
    ),
    component_reuse_plan: [
      {
        family_id: "comp-source-region-replacements",
        name: "Source region replacement plan",
        observed_surface: "Named generated source-dom regions that should become semantic project-owned components/data modules when maintainable replacement is requested",
        source_refs: ["frontend-design-skeleton/src/data/sourceDomIterationState.ts", "frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts", "frontend-design-skeleton/src/data/sourceDomRegions.ts", "frontend-design-skeleton/src/components/source-dom/*Region.tsx"],
        implementation_strategy: "extracted_baseline_defer" as const,
        reuse_source: "frontend-design-skeleton/src/data/sourceDomIterationState.ts and sourceDomReplacementPlan.ts plus existing project components/libraries selected by Build after inspecting the target app",
        mature_library_candidates: ["@tanstack/react-table for dense tables when appropriate", "project chart/map library or mature map/chart package when already used by the app"],
        props_states: "next replacement region, region boundary, source data modules, source assets, visible text coverage, responsive layout, interactions, and parity guards from sourceDomIterationState/sourceDomReplacementPlan",
        replacement_boundary: "Only the named source-dom regions in sourceDomIterationState/sourceDomReplacementPlan; leave unrelated clone surfaces under the captured-source visual contract.",
        parity_guard: "For every region replacement, compare the root app against web-clone-source/reference.png and keep the source-dom baseline until measured visual evidence preserves parity.",
        custom_fallback_reason: "",
      },
      {
        family_id: "comp-source-page-baseline",
        name: "Source page baseline",
        observed_surface: "Full referenced webpage high-fidelity visual baseline",
        source_refs: ["frontend-design-skeleton/src/components/SourceClonePage.tsx", "frontend-design-skeleton/src/components/SourceDomPage.tsx", "frontend-design-skeleton/src/styles.css", "frontend-design-skeleton/src/styles/source-critical.css", "frontend-design-skeleton/src/styles/source-full.css"],
        implementation_strategy: "extracted_baseline_defer" as const,
        reuse_source: "frontend-design-skeleton/src/components/SourceClonePage.tsx",
        mature_library_candidates: [],
        props_states: "Initial high-fidelity root page wrapper, generated DOM component, CSS sidecars, SVG assets, and data modules; refine named sections only after root adoption.",
        replacement_boundary: "Full page shell and section regions",
        parity_guard: "Runtime screenshot comparison against web-clone-source/reference.png after each major replacement.",
        custom_fallback_reason: "",
      },
      {
        family_id: "comp-repeated-content",
        name: "Repeated source content",
        observed_surface: "Repeated tables, lists, cards, navigation items, or content groups detected in the source content model",
        source_refs: ["web-clone-source/source-ir/content-model.json", "frontend-design-skeleton/src/data/sourceData.ts"],
        implementation_strategy: "extracted_baseline_defer" as const,
        reuse_source: "frontend-design-skeleton/src/data/sourceData.ts and source-ir/content-model.json",
        mature_library_candidates: [],
        props_states: "source-derived items, ordering, visible labels, links, media references, selected/hover states where evidence supports them",
        replacement_boundary: "Repeated content regions named in source-ir/content-model.json",
        parity_guard: "Visual comparison plus visible text/data coverage check for every converted region.",
        custom_fallback_reason: "",
      },
      {
        family_id: "comp-source-assets",
        name: "Source visual assets",
        observed_surface: "Images, SVG paths, canvas replacements, icons, and other dense visual assets from the source package",
        source_refs: ["web-clone-source/assets/manifest.json", "frontend-design-skeleton/src/data/svgPaths.ts"],
        implementation_strategy: "extracted_baseline_defer" as const,
        reuse_source: "frontend-design-skeleton asset and SVG path sidecars",
        mature_library_candidates: [],
        props_states: "asset paths, dimensions, colors, responsive sizing, and documented hover/interactive affordances where evidence supports them",
        replacement_boundary: "Dense visual asset regions",
        parity_guard: "Preserve sidecar assets and compare rendered silhouettes, colors, and positioning to reference.",
        custom_fallback_reason: "",
      },
    ],
    baseline_replacement_plan: hostPreparedBaselineReplacementPlan(project),
    quality_project_contract: `Target delivery is a root-level, runnable, human-maintainable webpage implementation. frontend-design-skeleton is captured rawproject evidence and a source seed, not the final deliverable directory. Downstream implementation maps every new component, data module, scoped style, and boundary cleanup back to source nodes/regions/assets/reference screenshots, then replaces requested generated/source-dom regions while preserving visual parity. Visual iteration viewport matrix: ${visualIterationMatrix} In maintainable mode, run webpage_evaluate and web_clone_source_audit, then iterate until measured visual evidence preserves parity and the source audit has zero findings before claiming final maintainability. Any deferred source-dom region remains source debt and keeps final maintainability unproven until that region has a replacement decision, parity evidence, and audit evidence. Current source audit supervision: ${sourceAuditOutcome} If the next task provides a PRD, use the captured page as the evidence base and apply only named PRD deltas instead of weakening unchanged reference surfaces.`,
    quality_project_items: [
      { title: "Delivery root", detail: "Root package.json/index.html/src/public/data files are the implementation target; frontend-design-skeleton stays evidence input.", source_refs: ["frontend-design-skeleton/README.md"] },
      {
        title: "Source-region replacement work",
        detail: "sourceDomIterationState.ts is the source of truth for the current maintainability loop state; sourceDomReplacementPlan.ts provides each region's strategy, data/asset sources, and parity guard.",
        source_refs: ["frontend-design-skeleton/src/data/sourceDomIterationState.ts", "frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts", "frontend-design-skeleton/src/data/sourceProjectManifest.json"],
      },
      { title: "Verification", detail: `Run root build/dev checks, requested behavior checks, webpage_evaluate against web-clone-source/reference.png, visual iteration captures for ${visualIterationMatrix}, and web_clone_source_audit with zero findings before claiming final maintainability.`, source_refs: ["web-clone-source/reference.png"] },
      { title: "Current source audit supervision", detail: sourceAuditOutcome, source_refs: ["frontend-design-skeleton/src/data/sourceProjectManifest.json", "frontend-design-skeleton/src/data/sourceDomIterationState.ts", "frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts", "web-clone-source/reference.png"] },
    ],
    material_inventory:
      "Reference screenshot, source IR, content model, layout map, style tokens, interaction hints, source skeleton CSS, generated React skeleton, sidecar SVG paths/assets, visible text, repeated content, links, media, navigation, controls, and footer/support content.",
    material_inventory_items: [
      { title: "Visual evidence", detail: "web-clone-source/reference.png plus frontend-design generated DOM/CSS/assets are captured source evidence for parity checks.", source_refs: ["web-clone-source/reference.png", "frontend-design-skeleton/src/components/SourceDomPage.tsx", "frontend-design-skeleton/src/styles/source-critical.css", "frontend-design-skeleton/src/styles/source-full.css", "frontend-design-skeleton/src/data/svgPaths.ts", ...deepSourceRefs] },
      { title: "Content evidence", detail: "source-ir/content-model.json and sourceData.ts contain repeated visible content and source-derived data for implementation modules.", source_refs: ["web-clone-source/source-ir/content-model.json", "frontend-design-skeleton/src/data/sourceData.ts"] },
    ],
    frontend_project: {
      status: project.status,
      role: project.status === "blocked" ? "blocked" as const : "source_baseline_input" as const,
      project_root: project.projectRoot,
      source_package: project.sourcePackage,
      entrypoints: project.entrypoints,
      generation_tool: project.generationTool,
      notes: [
        ...project.warnings,
        ...(project.error ? [project.error] : []),
        "Downstream implementation should copy/adapt traceable source project pieces into the delivery root before source-region refinement.",
      ],
    },
    visual_consistency_contract: nonEmptyOrDefault(
      input.visual_contract,
      `Match the reference layout, hierarchy, typography, spacing, colors, imagery, repeated content density, controls, responsive behavior, and footer/support structure from web-clone-source/reference.png and source artifacts. Visual iteration viewport matrix: ${visualIterationMatrix} Verify from the root app with measured webpage_evaluate evidence plus qualitative screenshot review for unchanged clone surfaces; record missing responsive reference evidence instead of claiming parity for a viewport without evidence.`,
    ),
    visual_consistency_items: [
      { title: "Root visual parity", detail: "Rendered root app should remain visually aligned with the high-fidelity frontend-design source project/reference while regions become semantic components.", source_refs: ["web-clone-source/reference.png", "frontend-design-skeleton/src/styles.css", "frontend-design-skeleton/src/components/SourceDomPage.tsx"] },
    ],
    ui_data_contract: nonEmptyOrDefault(
      input.data_contract,
      "Repeated visible content should be represented in source-derived data modules or APIs when the requested implementation scope requires maintainable data flow. JSX may hold layout/config, but repeated user-visible content should not be duplicated by hand when it is available in source-ir/content-model.json or sourceData.ts.",
    ),
    ui_data_contract_items: [
      { title: "Source data", detail: "Seed or module data from source IR/content model and sourceData.ts; add typed API responses only when the user request includes backend/full-stack behavior.", source_refs: ["web-clone-source/source-ir/content-model.json", "frontend-design-skeleton/src/data/sourceData.ts"] },
    ],
    template_iteration_notes: [
      "Pass 1 checked page inventory and high-fidelity source baseline coverage from host-prepared evidence.",
      "Pass 2 checked downstream implementability: root adoption, semantic components, source data flow, CSS sidecar preservation, and visual verification.",
    ],
    completeness_review: [
      "Public report handoff: the frontend_design terminal report is the shared readable surface for Requirements, Architect, and Build. It records the source package, generated skeleton, source-dom replacement plan, delivery-root adoption rule, reuse constraints, data contracts, and visual verification surfaces.",
      "Delivery mode: maintainable_replacement_required means generated/source-dom regions named for replacement must become traceable semantic components/data/scoped styles. Deferred regions are unfinished source debt, not final acceptance.",
      `Current source audit supervision: ${sourceAuditOutcome}`,
      "Known issue discipline: if a visible surface appears missing, first compare reference.png, live/browser state, source IR, and source skeleton before deciding whether it was absent from capture, hidden by auth/cookies/viewport, or dropped during rewrite.",
      "Agent handoff: downstream agents must read the named source artifacts, sourceDomIterationState.ts, and sourceDomReplacementPlan.ts, inspect the existing project stack/components before coding, preserve source-region traceability, reuse project components or mature libraries for hard UI domains, verify measured visual evidence with webpage_evaluate, and clear all web_clone_source_audit findings before claiming final maintainability.",
      "PRD delta handoff: future PRD work should preserve unchanged clone surfaces and scope visual-diff expectations to retained reference areas while PRD-changed areas are judged against the new requirements.",
      ...hostPreparedKnownProblemNotes(project),
      ...input.implementation_risks.map((item) => `Implementation risk: ${item}`),
      ...input.agent_handoff_notes.map((item) => `Handoff note: ${item}`),
    ].join("\n"),
    reference_artifacts: sourceRefs,
    open_questions: input.open_questions,
  })
}

function summarizeSourceAuditOutcomeForReport(sourceAuditEvidence?: string): string {
  const lines = sourceAuditEvidence?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? []
  const modeLines = lines.filter((line) =>
    line.startsWith("- visual_baseline_allowed:") ||
    line.startsWith("- maintainable_replacement_required:"),
  )
  if (modeLines.length === 0) {
    return "Current source audit evidence is unavailable in this host-prepared turn; downstream agents must run web_clone_source_audit before claiming final maintainability."
  }
  return `${modeLines.join(" ")} Maintainable final acceptance requires maintainable_replacement_required passed=true plus measured visual parity.`
}

function hostPreparedVisualIterationMatrix(project: HostPreparedFrontendProject): string {
  return project.visualIterationMatrix?.trim() || renderSourceProjectVisualIterationMatrix()
}

function hostPreparedKnownProblemNotes(project: HostPreparedFrontendProject): string[] {
  return (project.sourceReplacementPlan ?? [])
    .slice()
    .sort(compareReplacementPriority)
    .slice(0, 6)
    .map((item) => {
      const name = item.regionComponentName ?? item.regionFilePath ?? "source-dom-region"
      const bits = [
        `Known source issue: ${name}`,
        `priority=${item.priority ?? "unknown"}`,
        `kind=${item.replacementKind ?? "unknown"}`,
      ]
      if (item.firstReplacementStep) bits.push(`firstReplacementStep=${item.firstReplacementStep}`)
      if (item.parityGuard) bits.push(`parityGuard=${item.parityGuard}`)
      return bits.join("; ")
    })
}

function textOnlyFrontendTemplatePayload(
  brief: TextOnlyFrontendTemplateBrief,
  input: z.infer<typeof TextOnlySubmitSchema>,
) {
  const summary = nonEmptyOrDefault(
    input.summary,
    `Create the frontend described by the text-only brief "${brief.title}".`,
  )
  const briefRefs = ["operator textual brief"]
  const openQuestions = [
    ...input.open_questions,
    "No visual screenshot, PDF, Figma frame, or live webpage URL was available to frontend_design; exact pixel-level fidelity cannot be asserted until Build or Integrity has visual evidence.",
  ]
  return {
    design_system:
      "Text-brief-derived frontend system. Treat explicit colors, typography, layout, content, and interaction details in the operator brief as binding; do not invent unprovided pixel-specific visual facts.",
    tech_stack: ["React", "TypeScript"],
    final_delivery_mode: input.final_delivery_mode,
    frontend_template: [
      summary,
      "",
      "Source brief:",
      brief.request.trim(),
      "",
      "Because no visual source is available, downstream implementation should preserve every explicit textual requirement and record any visual assumptions as implementation notes rather than claiming screenshot parity.",
    ].join("\n"),
    frontend_template_sections: [
      {
        title: "Textual source",
        detail: "Implement only the surfaces and visual constraints explicitly described in the operator brief.",
        source_refs: briefRefs,
      },
    ],
    fillable_modules:
      "Root app/page entrypoint, reusable page sections, content/data constants for repeated copy, style tokens derived from explicit brief values, and verification commands.",
    fillable_module_items: [
      {
        title: "Page implementation",
        detail: "Create or update the page route/components named by the downstream task while preserving existing project organization.",
        source_refs: briefRefs,
      },
    ],
    component_inventory:
      "Compatibility summary only: no visual component catalog was extracted. Build must inspect the target project and reuse existing components/design-system primitives before introducing page-specific code.",
    component_reuse_plan: [
      {
        family_id: "comp-text-brief-page",
        name: "Text brief page surfaces",
        observed_surface: "Page sections, controls, and content explicitly described in the textual brief",
        source_refs: briefRefs,
        implementation_strategy: "existing_project_component" as const,
        reuse_source: "Existing project components/design-system primitives selected by Build after inspecting the target app; if none fit, use the smallest page-specific glue and document the inspected paths.",
        mature_library_candidates: [],
        props_states: "Props, visible content, colors, typography, layout, CTA states, responsive behavior, and footer/content requirements explicitly named in the brief.",
        replacement_boundary: "Only the page or route surface requested by the task; no generated visual baseline exists in text-only mode.",
        parity_guard: "Verify implemented output against the textual brief and any later supplied visual/PRD evidence; do not claim pixel parity without a reference image.",
        custom_fallback_reason: "",
      },
    ],
    baseline_replacement_plan: [],
    quality_project_contract:
      "Build should implement the requested page in the existing project root, inspect existing components/styles before coding, reuse project primitives or mature libraries for complex UI, keep repeated content in data/constants, run the repository's normal verification commands, and report any assumptions caused by missing visual evidence.",
    quality_project_items: [
      {
        title: "Reuse first",
        detail: "Inspect package manifests and obvious component/style directories during Build, then reuse existing primitives before writing custom UI.",
        source_refs: briefRefs,
      },
      {
        title: "Missing visual evidence",
        detail: "No pixel reference exists in frontend_design; unresolved visual specifics must remain explicit assumptions or open questions.",
        source_refs: briefRefs,
      },
    ],
    material_inventory:
      "Only textual materials were available: operator brief, explicit colors/typography/layout/content/interaction requirements, and downstream project files to be inspected by Build.",
    material_inventory_items: [
      {
        title: "Operator brief",
        detail: "Primary material source for the requested page and constraints.",
        source_refs: briefRefs,
      },
    ],
    frontend_project: {
      status: "not_created" as const,
      role: "source_baseline_input" as const,
      project_root: "",
      source_package: "",
      entrypoints: [],
      generation_tool: "text-only:submit_frontend_template",
      notes: [
        "No frontend-design source project was created because no visual webpage/source package was available.",
      ],
    },
    visual_consistency_contract: nonEmptyOrDefault(
      input.visual_contract,
      "Match the explicit visual constraints in the text brief. Pixel-level comparison is unavailable until a visual reference is supplied.",
    ),
    visual_consistency_items: [
      {
        title: "Textual visual constraints",
        detail: "Use only explicit brief values for colors, typography, spacing, layout, and responsive behavior.",
        source_refs: briefRefs,
      },
    ],
    ui_data_contract: nonEmptyOrDefault(
      input.data_contract,
      "Keep repeated visible copy/content in local constants or source-derived data modules when repetition exists; no backend/API facts were provided by frontend_design.",
    ),
    ui_data_contract_items: [
      {
        title: "Textual content",
        detail: "Represent repeated content from the brief as data instead of duplicating JSX literals.",
        source_refs: briefRefs,
      },
    ],
    template_iteration_notes: [
      "Pass 1 converted the text-only brief into a frontend_design public report without claiming unavailable visual evidence.",
      "Pass 2 checked downstream implementability, reuse constraints, missing visual evidence, and PRD/open-question handoff.",
    ],
    completeness_review: [
      "Text-only public report handoff: the frontend_design terminal report is the shared readable surface for Build.",
      "Known evidence gap: no screenshot, PDF, Figma frame, or live webpage URL was available, so exact visual fidelity and 80% pixel-threshold claims are not established by this frontend_design pass.",
      "Agent handoff: Build must inspect the existing project stack/components before coding, reuse project primitives or mature libraries for complex UI, and document assumptions caused by missing visual evidence.",
      ...input.implementation_risks.map((item) => `Implementation risk: ${item}`),
      ...input.agent_handoff_notes.map((item) => `Handoff note: ${item}`),
    ].join("\n"),
    reference_artifacts: briefRefs,
    open_questions: openQuestions,
  }
}

function hostPreparedBaselineReplacementPlan(
  project: HostPreparedFrontendProject,
): FrontendTemplateFinal["baseline_replacement_plan"] {
  if ((project.sourceReplacementPlan ?? []).length === 0) {
    return [{
      boundary_id: "source-page-baseline",
      source_region: "Full source page baseline (frontend-design-skeleton/src/components/SourceClonePage.tsx)",
      action: "defer_baseline_until_parity" as const,
      component_family_id: "comp-source-page-baseline",
      replacement_strategy: "extracted_baseline_defer" as const,
      reuse_source: "Use frontend-design-skeleton as captured source evidence and a traceable root-app seed, then replace only proven regions after inspecting existing project components/libraries.",
      mature_library_candidates: [],
      deletion_rule: "Keep the adopted source page seed until root visual parity is proven; after semantic replacements pass parity, remove only the obsolete generated render paths for replaced regions.",
      source_refs: [
        "frontend-design-skeleton/src/components/SourceClonePage.tsx",
        "frontend-design-skeleton/src/components/SourceDomPage.tsx",
        "frontend-design-skeleton/src/styles.css",
        "frontend-design-skeleton/src/styles/source-critical.css",
        "frontend-design-skeleton/src/styles/source-full.css",
        "web-clone-source/reference.png",
      ],
      parity_guard: "Compare the root app against web-clone-source/reference.png before replacing or deleting generated source-page baseline code.",
      custom_fallback_reason: "",
    }]
  }

  return (project.sourceReplacementPlan ?? [])
    .slice()
    .sort(compareReplacementPriority)
    .slice(0, MAX_HOST_BASELINE_REPLACEMENT_PLAN_ITEMS)
    .map((item) => {
      const regionName = item.regionComponentName ?? item.regionFilePath ?? "source-dom-region"
      const regionPath = item.regionFilePath ?? `src/components/source-dom/${regionName}.tsx`
      const sourceRefs = Array.from(new Set([
        `frontend-design-skeleton/${regionPath}`,
        "frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts",
        "frontend-design-skeleton/src/data/sourceDomIterationState.ts",
        "frontend-design-skeleton/src/data/sourceDomRegions.ts",
        "web-clone-source/reference.png",
        ...(item.dataSources ?? []).map((source) => source.startsWith("src/") ? `frontend-design-skeleton/${source}` : source),
        ...(item.assetSources ?? []).map((source) => source.startsWith("src/") || source.startsWith("public/") ? `frontend-design-skeleton/${source}` : source),
      ]))
      return {
        boundary_id: `source-region-${toKebabIdentifier(regionName)}`,
        source_region: `${regionName} (${regionPath})`,
        action: item.replacementKind === "baseline_defer" ? "defer_baseline_until_parity" as const : "replace_generated_baseline" as const,
        component_family_id: "comp-source-region-replacements",
        replacement_strategy: "extracted_baseline_defer" as const,
        reuse_source: "Inspect existing project components/design-system primitives and mature libraries first; use frontend-design-skeleton/src/data/sourceDomIterationState.ts as the next-region source and sourceDomReplacementPlan.ts as the region boundary/parity source.",
        mature_library_candidates: hostPreparedMatureLibraryCandidates(item.replacementKind),
        deletion_rule: `Keep ${regionName} as captured source evidence until the replacement preserves parity; after parity passes, remove the generated region import/render path from the delivery root and keep source artifacts as input evidence only.`,
        source_refs: sourceRefs,
        parity_guard: item.parityGuard ?? "Compare the root app against web-clone-source/reference.png before replacing or deleting this source-dom region.",
        custom_fallback_reason: "",
      }
    })
}

function hostPreparedMatureLibraryCandidates(kind?: string): string[] {
  if (kind === "data_table_or_heatmap_component") return ["@tanstack/react-table when dense tabular behavior is needed"]
  if (kind === "map_or_chart_asset_component") return ["existing project chart/map package", "maintained chart/map library only when it preserves visual parity"]
  if (kind === "faq_disclosure_component") return ["existing project disclosure/accordion primitive"]
  if (kind === "navigation_or_footer_component") return ["existing project navigation/footer primitives"]
  if (kind === "event_or_news_list_component" || kind === "card_collection_component") return ["existing project list/card primitives"]
  return []
}

function toKebabIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "region"
}

export async function maybeCreateHostPreparedFrontendProject(taskID?: string): Promise<HostPreparedFrontendProject | undefined> {
  if (!taskID) return undefined
  const paths = ProjectRuntimePaths.frontendDesignPaths(Instance.directory, taskID)
  const sourcePackage = paths.sourcePackageAbsolute
  try {
    const stat = await fs.stat(sourcePackage)
    if (!stat.isDirectory()) return undefined
  } catch {
    return undefined
  }

  const projectRoot = paths.skeletonProjectAbsolute
  const projectRootRef = paths.skeletonProjectRelative
  const sourcePackageRef = paths.sourcePackageRelative
  try {
    const output = await generateWebCloneSourceProject({
      mirrorDir: sourcePackage,
      outputDir: projectRoot,
      overwrite: false,
    })
    const sourceReplacementPlan = await readHostPreparedSourceReplacementPlan(projectRoot)
    const sourceAuditEvidence = await summarizeHostPreparedSourceAudit({ sourcePackage, projectRoot })
    return {
      ...hostPreparedProjectFromOutput(output, { projectRootRef, sourcePackageRef }),
      sourceReplacementPlan,
      sourceAuditEvidence,
      compactEvidence: await readHostPreparedCompactEvidence({ sourcePackage, projectRoot, sourceAuditEvidence }),
    }
  } catch (err) {
    if (await hasExistingSkeletonProject(projectRoot)) {
      const sourceAuditEvidence = await summarizeHostPreparedSourceAudit({ sourcePackage, projectRoot })
      return {
        status: "created",
        projectRoot,
        sourcePackage,
        projectRootRef,
        sourcePackageRef,
        entrypoints: FRONTEND_SKELETON_ENTRYPOINTS,
        generationTool: "host-prepared:create_frontend_skeleton_project",
        warnings: ["Existing frontend-design-skeleton source project was reused."],
        visualIterationMatrix: renderSourceProjectVisualIterationMatrix(),
        sourceReplacementPlan: await readHostPreparedSourceReplacementPlan(projectRoot),
        sourceAuditEvidence,
        compactEvidence: await readHostPreparedCompactEvidence({ sourcePackage, projectRoot, sourceAuditEvidence }),
      }
    }
    return {
      status: "blocked",
      projectRoot,
      sourcePackage,
      projectRootRef,
      sourcePackageRef,
      entrypoints: [],
      generationTool: "host-prepared:create_frontend_skeleton_project",
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
      visualIterationMatrix: renderSourceProjectVisualIterationMatrix(),
      sourceReplacementPlan: await readHostPreparedSourceReplacementPlan(projectRoot),
      sourceAuditEvidence: "",
      compactEvidence: await readHostPreparedCompactEvidence({ sourcePackage, projectRoot }),
    }
  }
}

function hostPreparedProjectFromOutput(output: GenerateWebCloneSourceProjectOutput, refs: {
  projectRootRef: string
  sourcePackageRef: string
}): HostPreparedFrontendProject {
  return {
    status: "created",
    projectRoot: output.outputDir,
    sourcePackage: output.mirrorDir,
    projectRootRef: refs.projectRootRef,
    sourcePackageRef: refs.sourcePackageRef,
    entrypoints: FRONTEND_SKELETON_ENTRYPOINTS,
    generationTool: "host-prepared:create_frontend_skeleton_project",
    warnings: [],
    visualIterationMatrix: output.visualIterationMatrix,
    compactEvidence: "",
    sourceReplacementPlan: [],
  }
}

async function readHostPreparedSourceReplacementPlan(projectRoot: string): Promise<SourceReplacementPlanForSummary[]> {
  return readGeneratedConstArray<SourceReplacementPlanForSummary>(
    path.join(projectRoot, "src", "data", "sourceDomReplacementPlan.ts"),
    "sourceDomReplacementPlan",
  )
}

export async function readHostPreparedCompactEvidence(input: { sourcePackage: string; projectRoot: string; sourceAuditEvidence?: string }): Promise<string> {
  const referencePixelSummary = await summarizeReferencePixels(path.join(input.sourcePackage, "reference.png"))
  const sourceProjectSummary = await summarizeHostPreparedSourceProject(input.projectRoot)
  const sections: string[] = []
  if (referencePixelSummary.trim()) {
    sections.push(`## reference-pixel-summary.md\n${referencePixelSummary.trim()}`)
  }
  if (sourceProjectSummary.trim()) {
    sections.push(`## frontend-design-skeleton/source-project-handoff-summary.md\n${sourceProjectSummary.trim()}`)
  }
  if (input.sourceAuditEvidence?.trim()) {
    sections.push(`## source-audit-supervision.md\n${input.sourceAuditEvidence.trim()}`)
  }
  sections.push(renderHostPreparedEvidenceIndex())
  return sections.join("\n\n")
}

export async function summarizeHostPreparedSourceAudit(input: { sourcePackage: string; projectRoot: string }): Promise<string> {
  const lines = [
    "Host-prepared source audit supervision.",
    "This is current-state evidence for the captured source project, not a final acceptance decision.",
  ]
  for (const finalDeliveryMode of ["visual_baseline_allowed", "maintainable_replacement_required"] as const) {
    try {
      const audit = await auditWebCloneSourceSkeletonConsumption({
        projectDir: input.projectRoot,
        sourcePackageDir: input.sourcePackage,
        finalDeliveryMode,
      })
      lines.push(
        `- ${finalDeliveryMode}: passed=${audit.passed}; generatedBaseline=${audit.risk.generatedBaselineDetected}; ` +
        `finalBaselineOnly=${audit.risk.finalBaselineOnlyDetected}; sourceDomRegions=${audit.projectStats.sourceDomRegionFileCount}; ` +
        `largestSourceDomRegionBytes=${audit.projectStats.largestSourceDomRegionBytes}; oversizedGeneratedRegions=${audit.projectStats.oversizedSourceDomRegionCount}`,
      )
      for (const finding of audit.findings.slice(0, 4)) {
        lines.push(`  finding: ${finding}`)
      }
    } catch (err) {
      lines.push(`- ${finalDeliveryMode}: audit_error=${err instanceof Error ? err.message : String(err)}`)
    }
  }
  lines.push(
    "Supervision rule: a passing visual_baseline_allowed audit proves only traceable captured-source baseline adoption. " +
    "A maintainable final remains unproven until maintainable_replacement_required passes with measured visual parity evidence.",
  )
  return lines.join("\n")
}

function renderHostPreparedEvidenceIndex(): string {
  const refs = [
    ["web-clone-source/implementation-blueprint.md", "source-derived implementation strategy and page contract"],
    ["web-clone-source/web-clone-context.md", "compact mirror/source context for Build"],
    ["web-clone-source/web-clone-implementation-contract.json", "machine-readable implementation contract"],
    ["web-clone-source/source-ir/component-tree.json", "captured page hierarchy and region names"],
    ["web-clone-source/source-ir/content-model.json", "visible repeated content and data candidates"],
    ["web-clone-source/source-ir/layout-map.json", "layout regions and dimensions"],
    ["web-clone-source/source-ir/style-tokens.json", "colors, type, spacing, and source style tokens"],
    ["web-clone-source/source-ir/interaction-hints.json", "interactive affordances from the capture"],
    ["web-clone-source/source-ir/source-quality-audit.json", "known extraction/source quality issues"],
    ["web-clone-source/source-skeleton/critical.css", "source critical CSS evidence"],
    ["web-clone-source/source-skeleton/source-skeleton-audit.json", "source skeleton coverage audit"],
    ["web-clone-source/visual-surface-candidates.json", "visual surface inventory"],
    ["web-clone-source/reference.png", "visual reference for overlay comparison"],
    ["frontend-design-skeleton/README.md", "source project usage and verification notes"],
    ["frontend-design-skeleton/src/App.tsx", "source project root entrypoint"],
    ["frontend-design-skeleton/src/components/SourceClonePage.tsx", "high-fidelity source baseline page"],
    ["frontend-design-skeleton/src/components/SourceDomPage.tsx", "generated DOM baseline wrapper"],
    ["frontend-design-skeleton/src/components/source-dom/*Region.tsx", "named generated source-dom regions"],
    ["frontend-design-skeleton/src/data/sourceProjectManifest.json", "source project manifest and region counts"],
    ["frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts", "known-problem and region-replacement map"],
    ["frontend-design-skeleton/src/data/sourceDomIterationState.ts", "maintainable-refactor loop state and next source region"],
    ["frontend-design-skeleton/src/data/sourceDomRegions.ts", "region registry"],
    ["frontend-design-skeleton/src/data/sourceData.ts", "source-derived repeated content data"],
    ["frontend-design-skeleton/src/data/sourceSvgAssetGroups.ts", "SVG asset grouping"],
    ["frontend-design-skeleton/src/data/sourceFaqGroups.ts", "FAQ source groups"],
    ["frontend-design-skeleton/src/data/svgPaths.ts", "captured SVG path data"],
    ["frontend-design-skeleton/src/styles.css", "source project stylesheet entry"],
    ["frontend-design-skeleton/src/styles/source-critical.css", "captured critical CSS sidecar"],
    ["frontend-design-skeleton/src/styles/source-full.css", "captured full CSS sidecar"],
    ["frontend-design-skeleton/public/assets/", "copied source assets"],
  ]
  const lines = [
    "## host-prepared-evidence-index.md",
    "Large source files are not inlined in this terminal-only turn. Downstream agents must use the public task-runtime refs above; frontend_design should submit the concise public report and let Build inspect these files directly.",
    "",
  ]
  for (const [ref, purpose] of refs) lines.push(`- ${ref}: ${purpose}`)
  return lines.join("\n")
}

interface SourceProjectManifestForSummary {
  sourceDomRegions?: {
    count?: number
    largestBytes?: number
    highPriorityCount?: number
    replacementPlanCount?: number
    iterationStateModule?: string
    semanticReplacementCount?: number
    svgAssetGroupCount?: number
    faqGroupCount?: number
    metricsModule?: string
    replacementPlanModule?: string
    svgAssetGroupModule?: string
    faqGroupModule?: string
  }
  semanticReplacements?: {
    count?: number
    iterationStateModule?: string
    components?: string[]
  }
  visualIteration?: {
    referenceImage?: string
    comparisonTool?: string
    viewportMatrix?: Array<{
      name?: string
      width?: number
      height?: number
      evidenceRole?: string
      comparison?: string
    }>
    rule?: string
  }
}

interface SourceDomIterationStateForSummary {
  generatedRegionCount?: number
  semanticReplacementCount?: number
  remainingRegionCount?: number
  nextReplacement?: {
    regionComponentName?: string
    regionFilePath?: string
    priority?: string
    replacementKind?: string
    recommendedComponentName?: string
    firstReplacementStep?: string
    parityGuard?: string
  } | null
}

export async function summarizeHostPreparedSourceProject(projectRoot: string): Promise<string> {
  const manifest = await readJsonFile<SourceProjectManifestForSummary>(path.join(projectRoot, "src", "data", "sourceProjectManifest.json"))
  const replacementPlan = await readGeneratedConstArray<SourceReplacementPlanForSummary>(
    path.join(projectRoot, "src", "data", "sourceDomReplacementPlan.ts"),
    "sourceDomReplacementPlan",
  )
  const iterationState = await readGeneratedConstObject<SourceDomIterationStateForSummary>(
    path.join(projectRoot, "src", "data", "sourceDomIterationState.ts"),
    "sourceDomIterationState",
  )
  const sidecars = await existingProjectSidecars(projectRoot)
  if (!manifest && replacementPlan.length === 0 && !iterationState && sidecars.length === 0) return ""

  const lines: string[] = [
    "Host-prepared source project maintainability summary.",
    "Use this as the compact handoff map before reading large source-dom region files.",
  ]
  const visualIteration = manifest?.visualIteration
  if (visualIteration) {
    lines.push("")
    lines.push("Visual iteration matrix:")
    lines.push(`- referenceImage: ${visualIteration.referenceImage ?? "unknown"}`)
    lines.push(`- comparisonTool: ${visualIteration.comparisonTool ?? "unknown"}`)
    for (const viewport of visualIteration.viewportMatrix ?? []) {
      const size = typeof viewport.width === "number" && typeof viewport.height === "number"
        ? `${viewport.width}x${viewport.height}`
        : "unknown"
      lines.push(`- ${viewport.name ?? "viewport"}: ${size} (${viewport.evidenceRole ?? "unknown"})`)
      if (viewport.comparison) lines.push(`  comparison: ${viewport.comparison}`)
    }
    if (visualIteration.rule) lines.push(`- rule: ${visualIteration.rule}`)
  }
  const regions = manifest?.sourceDomRegions
  if (regions) {
    lines.push("")
    lines.push("Source-dom region stats:")
    lines.push(`- count: ${regions.count ?? "unknown"}`)
    lines.push(`- largestBytes: ${regions.largestBytes ?? "unknown"}`)
    lines.push(`- highPriorityCount: ${regions.highPriorityCount ?? "unknown"}`)
    lines.push(`- replacementPlanCount: ${regions.replacementPlanCount ?? "unknown"}`)
    lines.push(`- iterationStateModule: ${regions.iterationStateModule ?? manifest?.semanticReplacements?.iterationStateModule ?? "unknown"}`)
    lines.push(`- semanticReplacementCount: ${regions.semanticReplacementCount ?? manifest?.semanticReplacements?.count ?? "unknown"}`)
    lines.push(`- svgAssetGroupCount: ${regions.svgAssetGroupCount ?? "unknown"}`)
    lines.push(`- faqGroupCount: ${regions.faqGroupCount ?? "unknown"}`)
  }

  if (iterationState) {
    lines.push("")
    lines.push("Maintainable iteration state:")
    lines.push(`- generatedRegionCount: ${iterationState.generatedRegionCount ?? "unknown"}`)
    lines.push(`- semanticReplacementCount: ${iterationState.semanticReplacementCount ?? "unknown"}`)
    lines.push(`- remainingRegionCount: ${iterationState.remainingRegionCount ?? "unknown"}`)
    const nextReplacement = iterationState.nextReplacement
    if (nextReplacement) {
      lines.push(`- nextReplacement: ${nextReplacement.regionComponentName ?? nextReplacement.regionFilePath ?? "unknown region"} -> ${nextReplacement.recommendedComponentName ?? "unknown component"}`)
      lines.push(`  priority: ${nextReplacement.priority ?? "unknown"}, kind: ${nextReplacement.replacementKind ?? "unknown"}`)
      if (nextReplacement.firstReplacementStep) lines.push(`  firstReplacementStep: ${nextReplacement.firstReplacementStep}`)
      if (nextReplacement.parityGuard) lines.push(`  parityGuard: ${nextReplacement.parityGuard}`)
    } else {
      lines.push("- nextReplacement: none; rerun the maintainable audit and visual comparison before claiming final acceptance.")
    }
  }

  if (sidecars.length > 0) {
    lines.push("")
    lines.push("Source sidecars to preserve with the root app:")
    for (const sidecar of sidecars) lines.push(`- ${sidecar}`)
  }

  if (replacementPlan.length > 0) {
    lines.push("")
    lines.push("Highest-priority replacement work:")
    for (const item of replacementPlan
      .slice()
      .sort(compareReplacementPriority)
      .slice(0, 8)) {
      const name = item.regionComponentName ?? item.regionFilePath ?? "unknown region"
      const priority = item.priority ?? "unknown"
      const kind = item.replacementKind ?? "unknown"
      lines.push(`- ${name}: priority=${priority}, kind=${kind}`)
      if (item.firstReplacementStep) lines.push(`  firstReplacementStep: ${item.firstReplacementStep}`)
      const dataSources = item.dataSources?.filter(Boolean)
      if (dataSources?.length) lines.push(`  dataSources: ${dataSources.join(", ")}`)
      const assetSources = item.assetSources?.filter(Boolean)
      if (assetSources?.length) lines.push(`  assetSources: ${assetSources.join(", ")}`)
      if (item.parityGuard) lines.push(`  parityGuard: ${item.parityGuard}`)
    }
  }

  lines.push("")
  lines.push("Handoff rule: downstream agents should start from sourceDomIterationState.ts, then sourceDomReplacementPlan.ts, inspect existing project components/libraries before coding, and replace source-dom regions only when parity can be preserved.")
  return lines.join("\n")
}

async function existingProjectSidecars(projectRoot: string): Promise<string[]> {
  const candidates = [
    "src/components/source-dom/*Region.tsx",
    "src/data/sourceDomRegions.ts",
    "src/data/sourceDomReplacementPlan.ts",
    "src/data/sourceDomIterationState.ts",
    "src/data/sourceSvgAssetGroups.ts",
    "src/data/sourceFaqGroups.ts",
    "src/data/sourceData.ts",
    "src/data/svgPaths.ts",
    "src/styles/source-critical.css",
    "src/styles/source-full.css",
    "public/assets/",
  ]
  const existing: string[] = []
  for (const candidate of candidates) {
    if (candidate.includes("*")) {
      const directory = path.join(projectRoot, candidate.slice(0, candidate.indexOf("*")))
      if (await pathExists(directory)) existing.push(candidate)
      continue
    }
    const candidatePath = path.join(projectRoot, candidate)
    if (await pathExists(candidatePath)) existing.push(candidate)
  }
  return existing
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

async function readGeneratedConstArray<T>(file: string, constName: string): Promise<T[]> {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`export const ${escapedName} = (\\[[\\s\\S]*?\\]) as const`).exec(text)
  if (!match?.[1]) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

async function readGeneratedConstObject<T>(file: string, constName: string): Promise<T | undefined> {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`export const ${escapedName} = (\\{[\\s\\S]*\\}) as const`).exec(text)
  if (!match?.[1]) return undefined
  try {
    const parsed = JSON.parse(match[1])
    return parsed && typeof parsed === "object" ? parsed as T : undefined
  } catch {
    return undefined
  }
}

function compareReplacementPriority(a: SourceReplacementPlanForSummary, b: SourceReplacementPlanForSummary): number {
  const rank = (value?: string) => value === "high" ? 0 : value === "medium" ? 1 : value === "low" ? 2 : 3
  return rank(a.priority) - rank(b.priority)
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

interface PixelRegionSummary {
  label: string
  yRange: string
  sampleCount: number
  avgRgb: [number, number, number]
  avgLuminance: number
  nearWhiteRatio: number
  lightRatio: number
  darkRatio: number
  topColors: string[]
  tone: "light" | "dark" | "mixed"
}

export async function summarizeReferencePixels(referencePath: string): Promise<string> {
  let img: DecodedPNG
  try {
    img = await decodePNG(referencePath)
  } catch {
    return ""
  }

  const viewportHeight = Math.min(img.height, 900)
  const regions = [
    summarizePixelRegion(img, "top navigation band", 0, Math.min(img.height, 96)),
    summarizePixelRegion(img, "first viewport", 0, viewportHeight),
    summarizePixelRegion(img, "main fold below navigation", Math.min(img.height, 96), viewportHeight),
    summarizePixelRegion(img, "page middle band", Math.floor(img.height * 0.42), Math.floor(img.height * 0.58)),
    summarizePixelRegion(img, "bottom band", Math.max(0, img.height - Math.min(900, Math.ceil(img.height * 0.18))), img.height),
  ].filter((region): region is PixelRegionSummary => !!region)

  const firstViewport = regions.find((region) => region.label === "first viewport")
  const mainFold = regions.find((region) => region.label === "main fold below navigation")
  const darkBands = findDarkHorizontalBands(img)
  const lines: string[] = [
    `Source: ${path.basename(referencePath)} (${img.width}x${img.height})`,
    "Deterministic pixel summary from the reference screenshot. This is visual evidence, not an acceptance decision.",
    "",
    "Region tones:",
  ]

  for (const region of regions) {
    lines.push(
      `- ${region.label} (${region.yRange}): ${region.tone}; ` +
      `avg rgb(${region.avgRgb.join(", ")}), luminance ${formatRatio(region.avgLuminance / 255)}, ` +
      `near-white ${formatPercent(region.nearWhiteRatio)}, light ${formatPercent(region.lightRatio)}, ` +
      `dark ${formatPercent(region.darkRatio)}, top colors ${region.topColors.join(", ")}`,
    )
  }

  if (darkBands.length > 0) {
    lines.push("")
    lines.push("Detected localized dark horizontal bands:")
    for (const band of darkBands.slice(0, 5)) {
      lines.push(`- y=${band.start}-${band.end}, approx ${band.height}px tall`)
    }
  }

  const mainIsLight = [firstViewport, mainFold]
    .filter((region): region is PixelRegionSummary => !!region)
    .some((region) => region.tone === "light" && region.darkRatio < 0.18)
  if (mainIsLight) {
    lines.push("")
    lines.push(
      "Theme evidence: the visible first viewport/main fold is light. Dark CSS/token frequency maps to localized text, footer, chart, icon, or asset color unless a specific region above is dark.",
    )
  }

  return lines.join("\n")
}

function summarizePixelRegion(img: DecodedPNG, label: string, y0: number, y1: number): PixelRegionSummary | undefined {
  const top = clampInt(y0, 0, img.height)
  const bottom = clampInt(y1, 0, img.height)
  if (bottom <= top) return undefined
  const width = img.width
  const height = bottom - top
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 24_000)))
  const colorBuckets = new Map<string, number>()
  let samples = 0
  let rSum = 0
  let gSum = 0
  let bSum = 0
  let luminanceSum = 0
  let nearWhite = 0
  let light = 0
  let dark = 0

  for (let y = top; y < bottom; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * img.width + x) * 4
      const a = img.data[idx + 3]
      if (a < 16) continue
      const r = img.data[idx]
      const g = img.data[idx + 1]
      const b = img.data[idx + 2]
      const lum = luminance(r, g, b)
      samples++
      rSum += r
      gSum += g
      bSum += b
      luminanceSum += lum
      if (lum >= 245 && r >= 240 && g >= 240 && b >= 240) nearWhite++
      if (lum >= 218) light++
      if (lum <= 72) dark++
      const color = bucketHex(r, g, b)
      colorBuckets.set(color, (colorBuckets.get(color) ?? 0) + 1)
    }
  }

  if (samples === 0) return undefined
  const nearWhiteRatio = nearWhite / samples
  const lightRatio = light / samples
  const darkRatio = dark / samples
  const avgLuminance = luminanceSum / samples
  const tone: PixelRegionSummary["tone"] =
    lightRatio >= 0.58 && darkRatio <= 0.22 ? "light"
      : darkRatio >= 0.45 && lightRatio <= 0.32 ? "dark"
        : "mixed"

  return {
    label,
    yRange: `${top}-${bottom}`,
    sampleCount: samples,
    avgRgb: [
      Math.round(rSum / samples),
      Math.round(gSum / samples),
      Math.round(bSum / samples),
    ],
    avgLuminance: Math.round(avgLuminance),
    nearWhiteRatio,
    lightRatio,
    darkRatio,
    topColors: Array.from(colorBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([color]) => color),
    tone,
  }
}

function findDarkHorizontalBands(img: DecodedPNG): Array<{ start: number; end: number; height: number }> {
  const rowStep = Math.max(1, Math.ceil(img.height / 900))
  const xStep = Math.max(1, Math.ceil(img.width / 240))
  const darkRows: number[] = []
  for (let y = 0; y < img.height; y += rowStep) {
    let samples = 0
    let dark = 0
    let lumSum = 0
    for (let x = 0; x < img.width; x += xStep) {
      const idx = (y * img.width + x) * 4
      if (img.data[idx + 3] < 16) continue
      const lum = luminance(img.data[idx], img.data[idx + 1], img.data[idx + 2])
      samples++
      lumSum += lum
      if (lum <= 80) dark++
    }
    if (samples === 0) continue
    const darkRatio = dark / samples
    const avgLum = lumSum / samples
    if (darkRatio >= 0.35 && avgLum <= 150) darkRows.push(y)
  }

  const bands: Array<{ start: number; end: number; height: number }> = []
  let start: number | undefined
  let prev: number | undefined
  for (const y of darkRows) {
    if (start === undefined || prev === undefined || y - prev > rowStep * 2) {
      if (start !== undefined && prev !== undefined) pushBand(bands, start, prev + rowStep)
      start = y
    }
    prev = y
  }
  if (start !== undefined && prev !== undefined) pushBand(bands, start, prev + rowStep)
  return bands
    .filter((band) => band.height >= 32)
    .sort((a, b) => b.height - a.height)
}

function pushBand(bands: Array<{ start: number; end: number; height: number }>, start: number, end: number) {
  const boundedStart = Math.max(0, start)
  const boundedEnd = Math.max(boundedStart, end)
  bands.push({ start: boundedStart, end: boundedEnd, height: boundedEnd - boundedStart })
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function bucketHex(r: number, g: number, b: number): string {
  const bucket = (value: number) => Math.max(0, Math.min(255, Math.floor(value / 16) * 16 + 8))
  const hex = (value: number) => value.toString(16).padStart(2, "0")
  return `#${hex(bucket(r))}${hex(bucket(g))}${hex(bucket(b))}`
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatRatio(value: number): string {
  return value.toFixed(2)
}

async function hasExistingSkeletonProject(projectRoot: string): Promise<boolean> {
  const required = [
    "index.html",
    path.join("src", "App.tsx"),
    path.join("src", "main.tsx"),
    path.join("src", "components", "SourceClonePage.tsx"),
    path.join("src", "components", "SourceDomPage.tsx"),
    path.join("src", "data", "sourceData.ts"),
    path.join("src", "styles.css"),
  ]
  for (const relative of required) {
    try {
      const stat = await fs.stat(path.join(projectRoot, relative))
      if (!stat.isFile() || stat.size === 0) return false
    } catch {
      return false
    }
  }
  return true
}

export function renderHostPreparedFrontendProjectSection(project: HostPreparedFrontendProject): string {
  const visualIterationMatrix = hostPreparedVisualIterationMatrix(project)
  const lines = [
    "# Host-Prepared Frontend Project",
    "",
    "The host already prepared the frontend-design high-fidelity editable source project before this model turn. Do not call `create_frontend_skeleton_project` again unless status is blocked and you can name a different output path.",
    "This is a terminal-only host-prepared turn: `read_file`, `list_files`, shell, browser, and mirror acquisition tools are intentionally unavailable. Use the embedded compact summaries plus referenced task-runtime paths; attempting discovery tools is an error.",
    "Register this source project in `submit_frontend_template.frontend_project` with role=source_baseline_input. Downstream implementation starts by copying/adapting only traceable React DOM/CSS/data/assets entrypoints, source-dom region files, sourceDomIterationState.ts, sourceDomReplacementPlan.ts, sourceDomRegions.ts, sourceSvgAssetGroups.ts, and sourceFaqGroups.ts into the delivery root, preserving CSS sidecars as source evidence, and refining named regions in place.",
    "Use the maintainable rawproject refactor algorithm: source map, region map, one replacement decision per region, then vertical-slice replacement with source data extraction, semantic component boundary, scoped style ownership, generated fixed-layout cleanup, asset ownership, interaction wiring, screenshot comparison, and audit evidence.",
    `Visual iteration viewport matrix: ${visualIterationMatrix}`,
    "For webpage clones, describe the downstream workflow as source-region traceable refactoring: every new component, data module, scoped style, and boundary cleanup must map back to rawproject source nodes/regions/assets/reference screenshots. A region replacement is complete only after source data extraction, semantic component rendering, scoped CSS, generated boundary cleanup, screenshot comparison for that region, measured webpage_evaluate evidence for the visual iteration viewport matrix, and zero-finding web_clone_source_audit evidence before any final maintainability claim. If a region is deferred, frontend_design must label it as unfinished source debt.",
    "Do not alter evaluators, other agent prompts, communication paths, generated outputs, or runtime source packages to satisfy the report.",
    "Mirror/source evidence stays in task runtime paths. Do not instruct downstream agents to move or clean `web-clone-source/`, `frontend-design-skeleton/`, raw `mirror/`, `references/`, or `reference.png` into the delivery root as app-owned deliverables.",
    "Do not output a standalone component checklist. Use the optional `implementation_risks` and `agent_handoff_notes` submit fields, or the standard completeness/open-question fields, to populate the public frontend_design report with what downstream agents must focus on.",
    "Principle for downstream work: inspect the target app structure first; reuse existing repository components/design-system primitives; use mature maintained libraries for hard UI domains; custom-code only simple glue and micro-adjustments needed for parity. Use the embedded source-project-handoff summary and the referenced sourceDomIterationState.ts/sourceDomReplacementPlan.ts as the loop state and known-problem map.",
    "",
    `- status: ${project.status}`,
    "- role: source_baseline_input",
    `- project_root: ${project.projectRoot}`,
    `- source_package: ${project.sourcePackage}`,
    `- public_project_root_ref: ${project.projectRootRef}`,
    `- public_source_package_ref: ${project.sourcePackageRef}`,
    `- generation_tool: ${project.generationTool}`,
    `- entrypoints: ${project.entrypoints.join(", ") || "(none)"}`,
    `- deep_reference_files: ${FRONTEND_SKELETON_DEEP_REFERENCE_FILES.join(", ")}`,
  ]
  if (project.warnings.length > 0) {
    lines.push("- warnings:")
    for (const warning of project.warnings) lines.push(`  - ${warning}`)
  }
  if (project.error) lines.push(`- error: ${project.error}`)
  if (project.compactEvidence.trim()) {
    lines.push("")
    lines.push("# Host-Prepared Source Evidence")
    lines.push(project.compactEvidence.trim())
  }
  lines.push("")
  lines.push("# Finalization")
  lines.push("Only `submit_frontend_template` is available in this host-prepared turn. Its schema is intentionally lightweight here: provide concise report notes, or submit an empty object if the embedded evidence is sufficient. The normal frontend_design terminal report will carry the downstream handoff.")
  lines.push("The report will preserve the source project as `source_baseline_input` and describe root-app adoption from traceable React DOM/CSS/data/assets entrypoints, source-dom regions, source-region replacement work, and source sidecars before refinement. Host-prepared webpage rawproject refinement stays in `final_delivery_mode=maintainable_replacement_required`; deferred regions must be reported as unfinished source debt. Use optional fields only to sharpen the report; do not attempt more discovery.")
  return lines.join("\n")
}
