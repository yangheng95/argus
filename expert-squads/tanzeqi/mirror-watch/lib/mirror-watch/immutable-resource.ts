// SHA-256 means Secure Hash Algorithm 256-bit.

import { createHash } from "node:crypto"
import {
  readExactArtifactsSettled,
  selectExactArtifactSources,
  type ArtifactReadLocator,
  type EngineArtifactHost,
  type TaskArtifactRef,
  type ToolContext,
} from "@opencorvus-ai/plugin"

export async function readMirrorWatchSourceLocators(
  host: Pick<EngineArtifactHost, "read">,
  locators: readonly ArtifactReadLocator[],
) {
  const results = await readExactArtifactsSettled(host, locators)
  return {
    reads: results.reads,
    violations: results.diagnostics.map(
      (diagnostic) =>
        `source_artifact_locators[${diagnostic.index}]: ${
          diagnostic.error instanceof Error ? diagnostic.error.message : String(diagnostic.error)
        }`,
    ),
  }
}

export { selectExactArtifactSources }

export async function readMirrorWatchResource(
  context: ToolContext,
  ref: TaskArtifactRef,
  expectedMediaType: string,
  label: string,
) {
  if (ref.media_type !== expectedMediaType) {
    throw new Error(`${label} media_type must be ${expectedMediaType}`)
  }
  const bytes = await context.host.taskArtifacts.read(ref)
  if (bytes.byteLength !== ref.bytes) {
    throw new Error(`${label} byte count does not match its immutable resource ref`)
  }
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== ref.sha256) {
    throw new Error(`${label} SHA-256 does not match its immutable resource ref`)
  }
  return new TextDecoder().decode(bytes)
}

export function mirrorWatchResourceSetViolations(
  refs: readonly TaskArtifactRef[],
  expectedCount: number,
): string[] {
  const violations: string[] = []
  if (refs.length !== expectedCount) {
    violations.push(`resource count must be ${expectedCount}; received ${refs.length}`)
  }
  if (new Set(refs.map((ref) => JSON.stringify(ref.snapshot))).size > 1) {
    violations.push("all resources must come from one immutable snapshot")
  }
  if (new Set(refs.map((ref) => `${ref.tree}\u0000${ref.path}`)).size !== refs.length) {
    violations.push("immutable resource refs must be distinct")
  }
  return violations
}

export function settledMirrorWatchResourceViolations(
  results: readonly PromiseSettledResult<string>[],
  labels: readonly string[],
): string[] {
  return results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${labels[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : [],
  )
}
