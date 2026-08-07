// ABI means Application Binary Interface.

import path from "node:path"
import {
  ArtifactReadLocatorSchema,
  TaskArtifactResourceSetLocatorSchema,
  artifactReadLocatorKey,
  tool,
} from "@opencorvus-ai/plugin"
import {
  MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE,
  MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION,
  parseMirrorWatchSurveyFeatures,
  type MirrorWatchResearchDeliveryPayload,
} from "../lib/mirror-watch/delivery"
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

export default tool({
  description:
    "Validate and publish the four immutable Mirror Watch F01-F10 research resources. This is the sole typed mirror-watch/research-delivery publisher.",
  args: {
    source_artifact_locators: sourceLocators,
    resource_set: TaskArtifactResourceSetLocatorSchema,
  },
  async execute(args, context) {
    const sourceReads = await readMirrorWatchSourceLocators(context.host.engineArtifacts, args.source_artifact_locators)
    const violations = [...sourceReads.violations]
    const resolvedRefs = await context.host.taskArtifacts.resources(args.resource_set)
    const labels = ["recommendations", "Gantt", "agent survey", "human survey"]
    violations.push(...mirrorWatchResourceSetViolations(resolvedRefs, 4))
    const expectedNames = [
      "ainvest-h2-feature-recommendations.md",
      "ainvest-h2-gantt-chart.html",
      "ainvest-h2-feature-survey-agent.md",
      "ainvest-h2-feature-survey.html",
    ]
    const refs = expectedNames.map((expectedName) =>
      resolvedRefs.find((ref) => path.posix.basename(ref.path) === expectedName),
    )
    const mediaTypes = ["text/markdown", "text/html", "text/markdown", "text/html"]
    const reads = await Promise.allSettled(
      labels.map((label, index) =>
        Promise.resolve().then(() => {
          const ref = refs[index]
          if (!ref) throw new Error(`${label} resource is missing from the immutable resource set`)
          return readMirrorWatchResource(context, ref, mediaTypes[index]!, label)
        }),
      ),
    )
    violations.push(...settledMirrorWatchResourceViolations(reads, labels))
    for (const [index, expectedName] of expectedNames.entries()) {
      if (path.posix.basename(refs[index]?.path ?? "") !== expectedName) {
        violations.push(`${labels[index]} filename must be ${expectedNames[index]}`)
      }
    }
    let features: ReturnType<typeof parseMirrorWatchSurveyFeatures> | undefined
    if (reads[2]?.status === "fulfilled") {
      try {
        features = parseMirrorWatchSurveyFeatures(reads[2].value)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (violations.length > 0 || !features) {
      throw new Error(
        `Mirror Watch research delivery rejected with ${violations.length} violation(s): ${violations.join("; ")}`,
      )
    }
    await selectExactArtifactSources(
      context.host.engineArtifacts,
      sourceReads.reads,
      "Exact durable source consumed by the typed Mirror Watch research publisher",
    )
    const payload: MirrorWatchResearchDeliveryPayload = {
      survey_path: refs[2]!.path,
      features,
      resource_roles: {
        recommendations: 0,
        gantt: 1,
        agent_survey: 2,
        human_survey: 3,
      },
    }
    const publication = await context.host.engineArtifacts.publish({
      artifact_type: MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE,
      schema_version: MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION,
      label: "Mirror Watch research delivery",
      payload,
      resources: refs.map((ref) => ref!),
      source_artifact_locators: args.source_artifact_locators,
    })
    return JSON.stringify({
      artifact_type: MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE,
      schema_version: MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION,
      feature_count: features.length,
      locator: publication.locator,
      artifact_sha256: publication.sha256,
    })
  },
})
