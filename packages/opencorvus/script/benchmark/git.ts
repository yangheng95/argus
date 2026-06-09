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

export async function ensureStandaloneGitRepo(dir: string): Promise<void> {
  const top = await gitTopLevel(dir)
  if (top === path.resolve(dir)) return

  const init = Bun.spawn(["git", "init"], {
    cwd: dir,
    env: standaloneGitEnvForProject(dir),
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await init.exited
  if (code !== 0) {
    const stderr = await new Response(init.stderr).text()
    throw new Error(`git init failed in ${dir}: ${stderr.trim()}`)
  }

  const initializedTop = await gitTopLevel(dir)
  if (initializedTop !== path.resolve(dir)) {
    throw new Error(`git init did not create an isolated benchmark repository in ${dir}`)
  }
}

async function gitTopLevel(dir: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd: dir,
    env: standaloneGitEnvForProject(dir),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  if (code !== 0) return undefined
  return path.resolve(stdout.trim())
}
