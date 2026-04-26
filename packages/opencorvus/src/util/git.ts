import { Process } from "./process"

export interface GitResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

/**
 * Run a git command.
 *
 * Uses Process helpers with stdin ignored to avoid protocol pipe inheritance
 * issues in embedded/client environments.
 *
 * `timeoutMs` (default 90s) is an absolute wall-clock deadline. A merged
 * delivery worktree may carry node_modules / dist artefacts, where
 * `git add -A` walks every entry to decide tracked vs ignored — on Windows
 * with hot file caches that can run >60s. Without a deadline a hung git
 * call would block the orchestrator's post-rejection wake (the
 * commitDeliveryRound site that motivated this bound). Caller can override
 * via opts.timeoutMs for known-fast commands (e.g. rev-parse) or known-slow
 * ones (e.g. clone over slow network).
 */
export async function git(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<GitResult> {
  const timeoutMs = opts.timeoutMs ?? 90_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await Process.run(["git", ...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdin: "ignore",
      nothrow: true,
      abort: controller.signal,
    })
      .then((result) => ({
        exitCode: result.code,
        text: () => result.stdout.toString(),
        stdout: result.stdout,
        stderr: result.stderr,
      }))
      .catch((error) => ({
        exitCode: 1,
        text: () => "",
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(
          controller.signal.aborted
            ? `git ${args.join(" ")} timed out after ${timeoutMs}ms`
            : error instanceof Error ? error.message : String(error),
        ),
      }))
  } finally {
    clearTimeout(timer)
  }
}
