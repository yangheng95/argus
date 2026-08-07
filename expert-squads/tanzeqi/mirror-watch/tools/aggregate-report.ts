// HTML means HyperText Markup Language. JSON means JavaScript Object Notation.
// SHA-256 means Secure Hash Algorithm 256-bit.

import { writeFile } from "node:fs/promises"
import path from "node:path"
import {
  ArtifactReadLocatorSchema,
  artifactReadLocatorKey,
  inspectEngineArtifactEnvelope,
  readExactArtifactsSettled,
  selectExactArtifactSources,
  tool,
} from "@opencorvus-ai/plugin"
import {
  aggregateMirrorWatchArtifactsForPublication,
  materializeMirrorWatchReport,
} from "../lib/mirror-watch/aggregate-report"
import {
  MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE,
  MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION,
  parseMirrorWatchExpertSurveyPayload,
} from "../lib/mirror-watch/expert-survey"
import {
  MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE,
  MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION,
  parseMirrorWatchPersonaAuthorityPayload,
} from "../lib/mirror-watch/persona-authority"
import {
  MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE,
  MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION,
  MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE,
  MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION,
  parseMirrorWatchPersonaCohortPayload,
  parseMirrorWatchResearchDeliveryPayload,
} from "../lib/mirror-watch/delivery"
import { isCanonicalProjectRelativePath, PROJECT_RELATIVE_PATH_CONTRACT } from "../lib/mirror-watch/project-path"

const AGGREGATE_REPORT_ARTIFACT_TYPE = "mirror-watch/aggregate-report"
const AGGREGATE_REPORT_SCHEMA_VERSION = 1
const AGGREGATE_REPORT_LABEL = "Mirror Watch aggregate report"
const REPORT_TREE = "mirror-watch-report"
const REPORT_RESOURCE_PATH = "ainvest-h2-report.html"

function projectPath(description: string) {
  return tool.schema
    .string()
    .refine(isCanonicalProjectRelativePath, PROJECT_RELATIVE_PATH_CONTRACT)
    .describe(description)
}

export default tool({
  description:
    "Consume one exact immutable Mirror Watch input snapshot, validate all typed predecessors, deterministically render or verify the canonical report, and idempotently publish exactly one aggregate Artifact.",
  args: {
    source_artifact_locators: tool.schema
      .array(ArtifactReadLocatorSchema)
      .min(1)
      .refine(
        (locators) => new Set(locators.map(artifactReadLocatorKey)).size === locators.length,
        "source_artifact_locators must contain unique exact Artifact identities",
      ),
    report_path: projectPath("New portable canonical project-relative HTML report path."),
  },
  async execute(args, context) {
    const violations: string[] = []
    const sourceReads = await readExactArtifactsSettled(
      context.host.engineArtifacts,
      args.source_artifact_locators,
    )
    for (const diagnostic of sourceReads.diagnostics) {
      violations.push(
        `source_artifact_locators[${diagnostic.index}]: ${
          diagnostic.error instanceof Error ? diagnostic.error.message : String(diagnostic.error)
        }`,
      )
    }
    const sources = sourceReads.reads.flatMap((exact) => {
      const index = args.source_artifact_locators.findIndex(
        (locator) => artifactReadLocatorKey(locator) === artifactReadLocatorKey(exact.locator),
      )
      if (exact.locator.source !== "engine_artifact") {
        violations.push(`source_artifact_locators[${index}] must be an exact Engine Artifact locator`)
        return []
      }
      try {
        return [{ locator: exact.locator, envelope: inspectEngineArtifactEnvelope(exact, {}) }]
      } catch (error) {
        violations.push(
          `source_artifact_locators[${index}] has an invalid Engine Artifact envelope: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return []
      }
    })
    const byType = (artifactType: string) =>
      sources.filter(({ envelope }) => envelope.artifact_type === artifactType)
    const authorityEnvelopes = byType(MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE)
    const researchEnvelopes = byType(MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE)
    const expertEnvelopes = byType(MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE)
    const cohortEnvelopes = byType(MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE)
    for (const [type, rows, expected] of [
      [MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE, authorityEnvelopes, 1],
      [MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE, researchEnvelopes, 1],
      [MIRROR_WATCH_EXPERT_SURVEY_ARTIFACT_TYPE, expertEnvelopes, 2],
      [MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE, cohortEnvelopes, 1],
    ] as const) {
      if (rows.length !== expected) {
        violations.push(`source snapshot must contain ${expected} ${type} Artifact(s); received ${rows.length}`)
      }
    }

    let personaAuthority: ReturnType<typeof parseMirrorWatchPersonaAuthorityPayload> | undefined
    const authoritySource = authorityEnvelopes[0]
    const authority = authoritySource?.envelope
    if (authority) {
      if (authority.schema_version !== MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION) {
        violations.push(
          `${MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE} schema_version must be ${MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION}`,
        )
      }
      if (
        authority.producer.owner_kind !== "projected-scheduler" ||
        authority.producer.expert_squad_id !== "mirror-watch" ||
        authority.producer.agent_id !== "orchestrator"
      ) {
        violations.push("persona authority producer must be the mirror-watch orchestrator projected scheduler")
      }
      try {
        personaAuthority = parseMirrorWatchPersonaAuthorityPayload(authority.payload)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }

    let research: ReturnType<typeof parseMirrorWatchResearchDeliveryPayload> | undefined
    const researchSource = researchEnvelopes[0]
    const researchEnvelope = researchSource?.envelope
    if (researchEnvelope) {
      if (researchEnvelope.schema_version !== MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION) {
        violations.push(
          `${MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE} schema_version must be ${MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION}`,
        )
      }
      if (
        researchEnvelope.producer.owner_kind !== "projected-worker" ||
        researchEnvelope.producer.expert_squad_id !== "mirror-watch" ||
        researchEnvelope.producer.agent_id !== "mirror-watch-research-lead"
      ) {
        violations.push("research delivery producer must be the mirror-watch-research-lead projected worker")
      }
      if (researchEnvelope.resources.length !== 4) {
        violations.push("research delivery must contain exactly four immutable resources")
      }
      try {
        research = parseMirrorWatchResearchDeliveryPayload(researchEnvelope.payload)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }

    const expertVotes: ReturnType<typeof parseMirrorWatchExpertSurveyPayload>["vote"][] = []
    for (const [index, source] of expertEnvelopes.entries()) {
      const envelope = source.envelope
      if (envelope.schema_version !== MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION) {
        violations.push(
          `expert survey Artifact ${index + 1} schema_version must be ${MIRROR_WATCH_EXPERT_SURVEY_SCHEMA_VERSION}`,
        )
      }
      if (
        envelope.producer.owner_kind !== "projected-worker" ||
        envelope.producer.expert_squad_id !== "mirror-watch" ||
        envelope.producer.agent_id !== "mirror-watch-expert-surveyor"
      ) {
        violations.push(`expert survey Artifact ${index + 1} has an invalid producer`)
      }
      if (envelope.resources.length !== 3) {
        violations.push(`expert survey Artifact ${index + 1} must contain exactly three immutable resources`)
      }
      if (
        researchSource &&
        !envelope.source_artifact_locators.some(
          (locator) => artifactReadLocatorKey(locator) === artifactReadLocatorKey(researchSource.locator),
        )
      ) {
        violations.push(`expert survey Artifact ${index + 1} must consume the selected research delivery`)
      }
      try {
        expertVotes.push(parseMirrorWatchExpertSurveyPayload(envelope.payload, `expert survey Artifact ${index + 1}`).vote)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }

    let cohort: ReturnType<typeof parseMirrorWatchPersonaCohortPayload> | undefined
    const cohortSource = cohortEnvelopes[0]
    const cohortEnvelope = cohortSource?.envelope
    if (cohortEnvelope) {
      if (cohortEnvelope.schema_version !== MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION) {
        violations.push(
          `${MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE} schema_version must be ${MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION}`,
        )
      }
      if (
        cohortEnvelope.producer.owner_kind !== "projected-worker" ||
        cohortEnvelope.producer.expert_squad_id !== "mirror-watch" ||
        cohortEnvelope.producer.agent_id !== "mirror-watch-persona-surveyor"
      ) {
        violations.push("persona cohort producer must be the mirror-watch-persona-surveyor projected worker")
      }
      if (authoritySource && researchSource) {
        const expectedCohortSources = [authoritySource.locator, researchSource.locator]
          .map(artifactReadLocatorKey)
          .sort()
        const actualCohortSources = cohortEnvelope.source_artifact_locators
          .map(artifactReadLocatorKey)
          .sort()
        if (JSON.stringify(actualCohortSources) !== JSON.stringify(expectedCohortSources)) {
          violations.push("persona cohort must consume exactly the selected persona authority and research delivery")
        }
      }
      try {
        cohort = parseMirrorWatchPersonaCohortPayload(cohortEnvelope.payload)
        if (cohortEnvelope.resources.length !== cohort.persona_count) {
          violations.push(
            `persona cohort resource count ${cohortEnvelope.resources.length} does not equal persona_count ${cohort.persona_count}`,
          )
        }
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (violations.length > 0 || !personaAuthority || !research || !cohort || expertVotes.length !== 2) {
      throw new Error(
        `Mirror Watch aggregate report rejected with ${violations.length} violation(s): ${violations.join("; ")}`,
      )
    }
    await selectExactArtifactSources(
      context.host.engineArtifacts,
      sourceReads.reads,
      "Exact durable source consumed by the deterministic Mirror Watch aggregate report",
    )

    const aggregation = await aggregateMirrorWatchArtifactsForPublication({
      personaAuthority,
      features: research.features,
      personaVotes: cohort.votes,
      expertVotes,
      reportPath: args.report_path,
    })
    await materializeMirrorWatchReport({
      projectDirectory: context.directory,
      reportPath: args.report_path,
      reportHTML: aggregation.reportHTML,
      reportSHA256: aggregation.artifact.report_sha256,
    })

    const stage = await context.host.taskArtifacts.stage({ trees: [REPORT_TREE] })
    await writeFile(path.join(stage.treeDirectories[REPORT_TREE]!, REPORT_RESOURCE_PATH), aggregation.reportHTML, {
      encoding: "utf8",
      flag: "wx",
    })
    const reportPublication = await context.host.taskArtifacts.publish(stage, {
      snapshot_kind: "catalog",
      files: [{ tree: REPORT_TREE, path: REPORT_RESOURCE_PATH, media_type: "text/html" }],
    })
    const publication = await context.host.engineArtifacts.publish({
      artifact_type: AGGREGATE_REPORT_ARTIFACT_TYPE,
      schema_version: AGGREGATE_REPORT_SCHEMA_VERSION,
      label: AGGREGATE_REPORT_LABEL,
      payload: aggregation.artifact,
      resources: [reportPublication.artifacts[0]!],
      source_artifact_locators: args.source_artifact_locators,
    })
    return JSON.stringify({
      artifact_type: AGGREGATE_REPORT_ARTIFACT_TYPE,
      schema_version: AGGREGATE_REPORT_SCHEMA_VERSION,
      persona_vote_count: aggregation.artifact.persona_vote_count,
      report_path: aggregation.artifact.report_path,
      report_sha256: aggregation.artifact.report_sha256,
      locator: publication.locator,
      artifact_sha256: publication.sha256,
    })
  },
})
