// ABI means Application Binary Interface.

import { TaskArtifactResourceSetLocatorSchema, tool } from "@opencorvus-ai/plugin"
import {
  PrismSourceObservationPayloadSchema,
  PRISM_SOURCE_OBSERVATION_TYPE,
  PRISM_SOURCE_OBSERVATION_SCHEMA_VERSION,
  prismSourceObservationViolations,
  readPrismResourceViolations,
} from "../lib/prism/source-observation"

export default tool({
  description:
    "Validate the complete Prism source-observation matrix and immutable resources, then publish the sole prism/source-observation Artifact.",
  args: {
    research: PrismSourceObservationPayloadSchema,
    resource_set: TaskArtifactResourceSetLocatorSchema.nullable(),
  },
  async execute(args, context) {
    const resources = args.resource_set ? await context.host.taskArtifacts.resources(args.resource_set) : []
    const violations = [
      ...prismSourceObservationViolations({
        research: args.research,
        resourceCount: resources.length,
      }),
    ]
    violations.push(...(await readPrismResourceViolations(context, resources)))
    if (violations.length > 0) {
      throw new Error(
        `Prism source observation rejected with ${violations.length} violation(s): ${violations.join("; ")}`,
      )
    }
    const publication = await context.host.engineArtifacts.publish({
      artifact_type: PRISM_SOURCE_OBSERVATION_TYPE,
      schema_version: PRISM_SOURCE_OBSERVATION_SCHEMA_VERSION,
      label: "Prism source observation",
      payload: args.research,
      resources,
      source_artifact_locators: [],
    })
    return JSON.stringify({
      artifact_type: PRISM_SOURCE_OBSERVATION_TYPE,
      schema_version: PRISM_SOURCE_OBSERVATION_SCHEMA_VERSION,
      locator: publication.locator,
      artifact_sha256: publication.sha256,
    })
  },
})
