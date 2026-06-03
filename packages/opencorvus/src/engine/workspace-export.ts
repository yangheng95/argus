import { ProjectRuntimePaths } from "@/project/runtime-paths"

export function readBaselineCommitFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return
  const git = (metadata as Record<string, unknown>).git
  if (!git || typeof git !== "object" || Array.isArray(git)) return
  const baseline = (git as Record<string, unknown>).baseline
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return
  const commit = (baseline as Record<string, unknown>).commit
  return typeof commit === "string" && commit ? commit : undefined
}

export async function collectMainWorktreeDiff(
  cwd: string,
  baseRef: string | undefined,
): Promise<{ changedFiles: string[]; patch: string }> {
  const { $ } = await import("bun")
  if (!baseRef) {
    throw new Error("workspace_export requires task.metadata.git.baseline.commit")
  }
  const range = `${baseRef}..HEAD`
  const namesResult = await $`git -c core.quotepath=false diff --no-ext-diff --name-only ${range}`
    .cwd(cwd)
    .quiet()
    .nothrow()
  const changedFiles = namesResult.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !ProjectRuntimePaths.isEvidenceInputRelativePath(file))
  const patchResult = await $`git -c core.quotepath=false diff --no-ext-diff ${range} -- . ":(exclude)frontend-design-skeleton" ":(exclude)frontend-design-skeleton/**" ":(exclude)web-clone-source" ":(exclude)web-clone-source/**" ":(exclude)webpage-evidence" ":(exclude)webpage-evidence/**"`
    .cwd(cwd)
    .quiet()
    .nothrow()
  return { changedFiles, patch: patchResult.stdout.toString() }
}
