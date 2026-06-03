import path from "node:path"

export function standaloneGitEnvForProject(dir: string): Record<string, string | undefined> {
  const parent = path.dirname(path.resolve(dir))
  return {
    ...process.env,
    // Force `git init` to stop discovery before the benchmark project parent.
    // Otherwise a project under repo-owned .scratch/ reuses the repo root and
    // never creates its own `.git`, so POST /task correctly rejects it.
    GIT_CEILING_DIRECTORIES: parent,
  }
}
