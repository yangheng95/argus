// ABI means Application Binary Interface.

import path from "node:path"
import {
  EngineArtifactLocatorSchema,
  TaskArtifactResourceSetLocatorSchema,
  selectExactArtifactSources,
  tool,
} from "@opencorvus-ai/plugin"
import {
  assertMirrorWatchPersonaVoteMatchesAuthority,
  readMirrorWatchEngineArtifact,
  MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE,
  MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION,
  MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE,
  MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION,
  parseMirrorWatchResearchDeliveryPayload,
  parseMirrorWatchPersonaVote,
  type MirrorWatchPersonaCohortPayload,
} from "../lib/mirror-watch/delivery"
import {
  MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE,
  MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION,
  parseMirrorWatchPersonaAuthorityPayload,
} from "../lib/mirror-watch/persona-authority"
import {
  mirrorWatchResourceSetViolations,
  readMirrorWatchResource,
  settledMirrorWatchResourceViolations,
} from "../lib/mirror-watch/immutable-resource"

export default tool({
  description:
    "Validate and publish one immutable Mirror Watch persona cohort against the exact authority and research delivery. This is the sole typed mirror-watch/persona-survey-cohort publisher.",
  args: {
    persona_authority_locator: EngineArtifactLocatorSchema,
    research_delivery_locator: EngineArtifactLocatorSchema,
    vote_resource_set: TaskArtifactResourceSetLocatorSchema,
  },
  async execute(args, context) {
    const predecessorReads = await Promise.allSettled([
      readMirrorWatchEngineArtifact({
        host: context.host.engineArtifacts,
        locator: args.persona_authority_locator,
        artifactType: MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE,
        schemaVersion: MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION,
        producerOwnerKind: "projected-scheduler",
        producerAgentID: "orchestrator",
      }),
      readMirrorWatchEngineArtifact({
        host: context.host.engineArtifacts,
        locator: args.research_delivery_locator,
        artifactType: MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE,
        schemaVersion: MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION,
        producerOwnerKind: "projected-worker",
        producerAgentID: "mirror-watch-research-lead",
      }),
    ])
    const violations = predecessorReads.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `${index === 0 ? "persona authority" : "research delivery"}: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`,
          ]
        : [],
    )
    let authority: ReturnType<typeof parseMirrorWatchPersonaAuthorityPayload> | undefined
    if (predecessorReads[0]?.status === "fulfilled") {
      try {
        authority = parseMirrorWatchPersonaAuthorityPayload(predecessorReads[0].value.envelope.payload)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
    let research: ReturnType<typeof parseMirrorWatchResearchDeliveryPayload> | undefined
    if (predecessorReads[1]?.status === "fulfilled") {
      try {
        research = parseMirrorWatchResearchDeliveryPayload(predecessorReads[1].value.envelope.payload)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
    const authorityByName = new Map(authority?.personas.map((persona) => [persona.name, persona]) ?? [])
    const voteResources = await context.host.taskArtifacts.resources(args.vote_resource_set)
    violations.push(...mirrorWatchResourceSetViolations(voteResources, voteResources.length))
    const reads = await Promise.allSettled(
      voteResources.map((ref, index) =>
        readMirrorWatchResource(context, ref, "application/json", `vote resource[${index}]`),
      ),
    )
    violations.push(
      ...settledMirrorWatchResourceViolations(
        reads,
        voteResources.map((_, index) => `vote resource[${index}]`),
      ),
    )
    const votes: ReturnType<typeof parseMirrorWatchPersonaVote>[] = []
    const resourceRoles: Array<{ name: string; resource_index: number }> = []
    for (const [index, result] of reads.entries()) {
      if (result.status !== "fulfilled") continue
      try {
        const vote = parseMirrorWatchPersonaVote(result.value, `vote resource[${index}]`)
        if (authority) {
          const persona = authorityByName.get(vote.name)
          if (!persona) {
            violations.push(`vote resource[${index}] references out-of-authority persona ${vote.name}`)
            continue
          }
          assertMirrorWatchPersonaVoteMatchesAuthority(vote, persona, `vote resource[${index}]`)
        }
        if (path.posix.basename(voteResources[index]!.path) !== `${vote.name}.json`) {
          violations.push(`vote resource[${index}] filename must be ${vote.name}.json`)
        }
        votes.push(vote)
        resourceRoles.push({ name: vote.name, resource_index: index })
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
    const duplicateNames = votes.map((vote) => vote.name).filter((name, index, names) => names.indexOf(name) !== index)
    if (duplicateNames.length > 0) {
      violations.push(`persona vote names contain duplicate ${[...new Set(duplicateNames)].sort().join(",")}`)
    }
    const duplicateUIDs = votes.map((vote) => vote.uid).filter((uid, index, uids) => uids.indexOf(uid) !== index)
    if (duplicateUIDs.length > 0) {
      violations.push(`persona vote UIDs contain duplicate ${[...new Set(duplicateUIDs)].sort().join(",")}`)
    }
    if (violations.length > 0 || !authority || !research || votes.length !== voteResources.length) {
      throw new Error(
        `Mirror Watch persona cohort rejected with ${violations.length} violation(s): ${violations.join("; ")}`,
      )
    }
    const ordered = votes
      .map((vote, index) => ({ vote, role: resourceRoles[index]! }))
      .sort((left, right) => left.vote.name.localeCompare(right.vote.name))
    const payload: MirrorWatchPersonaCohortPayload = {
      persona_count: ordered.length,
      identities: ordered.map(({ vote }) => ({ name: vote.name, uid: vote.uid })),
      votes: ordered.map(({ vote }) => vote),
      resource_roles: ordered.map(({ role }) => role),
    }
    const exactPredecessors = predecessorReads.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.exact] : [],
    )
    if (exactPredecessors.length !== 2) {
      throw new Error("Mirror Watch persona cohort exact predecessor reads were lost after validation")
    }
    await selectExactArtifactSources(
      context.host.engineArtifacts,
      exactPredecessors,
      "Exact persona authority and research delivery consumed by the typed Mirror Watch cohort publisher",
    )
    const publication = await context.host.engineArtifacts.publish({
      artifact_type: MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE,
      schema_version: MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION,
      label: "Mirror Watch persona survey cohort",
      payload,
      resources: voteResources,
      source_artifact_locators: [args.persona_authority_locator, args.research_delivery_locator],
    })
    return JSON.stringify({
      artifact_type: MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE,
      schema_version: MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION,
      persona_count: ordered.length,
      locator: publication.locator,
      artifact_sha256: publication.sha256,
    })
  },
})
