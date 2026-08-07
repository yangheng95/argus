// HTML means HyperText Markup Language. JSON means JavaScript Object Notation.
// SHA-256 means Secure Hash Algorithm 256-bit.

import path from "node:path"
import {
  ArtifactReadLocatorSchema,
  TaskArtifactResourceSetLocatorSchema,
  artifactReadLocatorKey,
  tool,
} from "@opencorvus-ai/plugin"
import {
  MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE,
  MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION,
  parseMirrorWatchExpertVoteMarkdown,
  type MirrorWatchExpertSurveyPayload,
} from "../lib/mirror-watch/expert-survey"
import {
  readMirrorWatchSourceLocators,
  mirrorWatchResourceSetViolations,
  readMirrorWatchResource,
  settledMirrorWatchResourceViolations,
  selectExactArtifactSources,
} from "../lib/mirror-watch/immutable-resource"

const sourceLocators = tool.schema
  .array(ArtifactReadLocatorSchema)
  .min(1)
  .refine(
    (locators) => new Set(locators.map(artifactReadLocatorKey)).size === locators.length,
    "source_artifact_locators must contain unique exact Artifact identities",
  )
  .describe("Exact selected upstream Artifact locators consumed by this expert survey.")

export default tool({
  description:
    "Validate and publish one Mirror Watch expert survey from three exact immutable Task Artifact resources. This is the sole typed mirror-watch/expert-survey publisher; it rejects invalid owned output before any Engine Artifact exists and never aggregates or renders the final report.",
  args: {
    source_artifact_locators: sourceLocators,
    resource_set: TaskArtifactResourceSetLocatorSchema.describe(
      "Exact immutable Markdown, HyperText Markup Language, and JavaScript resource set.",
    ),
  },
  async execute(args, context) {
    const violations: string[] = []
    const sourceReads = await readMirrorWatchSourceLocators(context.host.engineArtifacts, args.source_artifact_locators)
    violations.push(...sourceReads.violations)

    const resolvedResourceRefs = await context.host.taskArtifacts.resources(args.resource_set)
    violations.push(...mirrorWatchResourceSetViolations(resolvedResourceRefs, 3))
    const markdownResource = resolvedResourceRefs.find((ref) => ref.media_type === "text/markdown")
    const htmlResource = resolvedResourceRefs.find((ref) => ref.media_type === "text/html")
    const dataModuleResource = resolvedResourceRefs.find((ref) => ref.media_type === "text/javascript")
    const resourceReads = await Promise.allSettled(
      [
        { ref: markdownResource, mediaType: "text/markdown", label: "expert Markdown" },
        { ref: htmlResource, mediaType: "text/html", label: "expert HyperText Markup Language" },
        { ref: dataModuleResource, mediaType: "text/javascript", label: "expert data module" },
      ].map(({ ref, mediaType, label }) =>
        Promise.resolve().then(() => {
          if (!ref) throw new Error(`${label} is missing from the immutable resource set`)
          return readMirrorWatchResource(context, ref, mediaType, `${label}_path=${ref.path}`)
        }),
      ),
    )
    const resourceLabels = ["Markdown", "HTML", "data module"]
    violations.push(...settledMirrorWatchResourceViolations(resourceReads, resourceLabels))
    const markdown = resourceReads[0]?.status === "fulfilled" ? resourceReads[0].value : undefined
    const html = resourceReads[1]?.status === "fulfilled" ? resourceReads[1].value : undefined
    const dataModule = resourceReads[2]?.status === "fulfilled" ? resourceReads[2].value : undefined
    let vote: ReturnType<typeof parseMirrorWatchExpertVoteMarkdown> | undefined
    if (markdown !== undefined) {
      try {
        vote = parseMirrorWatchExpertVoteMarkdown(markdown, `expert_markdown_path=${markdownResource?.path}`)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
    const expectedByPersona: Record<string, { markdown: string; html: string; dataModule: string; global: string }> = {
      "denis-globa-perspective": {
        markdown: "agent-denis-globa.md",
        html: "agent-denis-globa-survey.html",
        dataModule: "agent-denis-globa-survey.data.js",
        global: "window.denisGlobaSurveyData",
      },
      "oleg-mukhanov-perspective": {
        markdown: "agent-oleg-mukhanov.md",
        html: "agent-oleg-mukhanov-survey.html",
        dataModule: "agent-oleg-mukhanov-survey.data.js",
        global: "window.olegMukhanovSurveyData",
      },
    }
    const expected = expectedByPersona[vote?.persona_source ?? ""]
    if (vote && !expected)
      violations.push("persona_source must be denis-globa-perspective or oleg-mukhanov-perspective")
    const filenames = {
      markdown: path.posix.basename(markdownResource?.path ?? ""),
      html: path.posix.basename(htmlResource?.path ?? ""),
      dataModule: path.posix.basename(dataModuleResource?.path ?? ""),
    }
    if (expected) {
      if (filenames.markdown !== expected.markdown) {
        violations.push(`Markdown filename must be ${expected.markdown}`)
      }
      if (filenames.html !== expected.html) violations.push(`HTML filename must be ${expected.html}`)
      if (filenames.dataModule !== expected.dataModule) {
        violations.push(`data module filename must be ${expected.dataModule}`)
      }
      if (html !== undefined && !html.includes(expected.dataModule)) {
        violations.push(`HTML must load ${expected.dataModule}`)
      }
      if (dataModule !== undefined && !dataModule.includes(expected.global)) {
        violations.push(`data module must assign ${expected.global}`)
      }
    }
    if (violations.length > 0 || !vote) {
      throw new Error(
        `Mirror Watch expert survey rejected with ${violations.length} violation(s): ${violations.join("; ")}`,
      )
    }
    await selectExactArtifactSources(
      context.host.engineArtifacts,
      sourceReads.reads,
      "Exact durable source consumed by the typed Mirror Watch expert survey publisher",
    )

    const resources = [markdownResource!, htmlResource!, dataModuleResource!]
    const payload: MirrorWatchExpertSurveyPayload = {
      vote,
      resource_roles: {
        markdown: 0,
        html: 1,
        data_module: 2,
      },
    }
    const publication = await context.host.engineArtifacts.publish({
      artifact_type: MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE,
      schema_version: MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION,
      label: `Mirror Watch expert survey · ${vote.persona_source}`,
      payload,
      resources,
      source_artifact_locators: args.source_artifact_locators,
    })
    return JSON.stringify({
      artifact_type: MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE,
      schema_version: MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION,
      expert_name: vote.name,
      persona_source: vote.persona_source,
      locator: publication.locator,
      artifact_sha256: publication.sha256,
    })
  },
})
