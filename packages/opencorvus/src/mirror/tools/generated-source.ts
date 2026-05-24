import fs from "node:fs/promises"
import path from "node:path"

import type { GeneratedFile } from "../ir/scaffold"

const GENERATED_SOURCE_SUBDIR = "generated-source"

export async function writeGeneratedSourceFiles(outputDir: string, files: GeneratedFile[]): Promise<string[]> {
  const root = path.resolve(outputDir, GENERATED_SOURCE_SUBDIR)
  const written: string[] = []

  for (const file of files) {
    const target = resolveArtifactRelative(root, file.file_path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.code, "utf8")
    written.push(target)
  }

  return written
}

function resolveArtifactRelative(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Generated source artifact path must be relative: ${filePath}`)
  }
  const target = path.resolve(root, filePath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated source artifact path escapes output directory: ${filePath}`)
  }
  return target
}
