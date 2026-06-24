import path from "node:path"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

const SOURCE_REFERENCE_FILES = new Set(["reference.png"])

export function resolveSourceReferencePath(input: {
  projectRoot: string
  taskID: string
  referenceArtifactID: string
}): string {
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectRoot, input.taskID)
  const normalized = input.referenceArtifactID.replaceAll("\\", "/").replace(/^\.?\//, "")
  const relative =
    normalized === "reference.png"
      ? normalized
      : normalized.startsWith("web-clone-source/")
        ? normalized.slice("web-clone-source/".length)
        : ""
  if (!SOURCE_REFERENCE_FILES.has(relative)) {
    throw new Error(`Source reference must resolve to web-clone-source/reference.png: ${input.referenceArtifactID}`)
  }
  const resolved = path.resolve(paths.sourcePackageAbsolute, relative)
  const sourceRoot = path.resolve(paths.sourcePackageAbsolute)
  if (!resolved.startsWith(sourceRoot + path.sep)) {
    throw new Error(`Source reference escapes web-clone-source: ${input.referenceArtifactID}`)
  }
  return resolved
}
