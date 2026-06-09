import { Process } from "./process"

export interface GitResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

/**
 * Timeout profile bands. Use `timeoutProfile` to express intent rather than
 * hard-coding ms; the band rationalises Phase-1 of the systemic timeout
 * sweep (specs/git-timeout-systemic-fix-2026-05-06.md):
 *  - `fast`    — local read-only metadata: rev-parse, show-ref, log -1, status --short
 *  - `default` — local heavy: status, diff, add, commit, worktree remove
 *  - `network` — fetch / clone / push / submodule update
 *
 * Caller still wins via explicit `timeoutMs` (takes precedence over profile).
 */
export const GitTimeout = {
  fast: 15_000,
  default: 90_000,
  network: 300_000,
} as const

export type GitTimeoutProfile = keyof typeof GitTimeout

export interface GitOptions {
  cwd: string
  env?: Record<string, string>
  /** Explicit ms; wins over `timeoutProfile`. */
  timeoutMs?: number
  /** Named band; ignored when `timeoutMs` is supplied. */
  timeoutProfile?: GitTimeoutProfile
}

/**
 * Pure resolver: which deadline applies given the caller's options? Exposed
 * separately so tests can pin profile dispatch without launching a process.
 */
export function resolveGitTimeoutMs(opts: Pick<GitOptions, "timeoutMs" | "timeoutProfile">): number {
  if (opts.timeoutMs !== undefined) return opts.timeoutMs
  if (opts.timeoutProfile) return GitTimeout[opts.timeoutProfile]
  return 90_000
}

/**
 * Run a git command.
 *
 * Uses Process helpers with stdin ignored to avoid protocol pipe inheritance
 * issues in embedded/client environments.
 *
 * Timeout resolution order: `opts.timeoutMs` > `opts.timeoutProfile` >
 * legacy default (90s). A merged acceptance worktree may carry node_modules /
 * dist artefacts, where `git add -A` walks every entry to decide tracked vs
 * ignored — on Windows with hot file caches that can run >60s. Without a
 * deadline a hung git call would block the orchestrator's post-rejection
 * wake (the commitAcceptanceRound site that motivated this bound). Phase-1
 * sweep migrates risk-path callers to explicit profiles to make intent
 * legible; Phase-2 will lint-forbid the legacy default.
 */
export async function git(args: string[], opts: GitOptions): Promise<GitResult> {
  const timeoutMs = resolveGitTimeoutMs(opts)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const timeoutMessage = `git ${args.join(" ")} timed out after ${timeoutMs}ms (cwd=${opts.cwd})`
  try {
    const settled = await Process.run(["git", ...args], {
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
      .catch(
        (error): GitResult => ({
          exitCode: 1,
          text: () => "",
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
        }),
      )
    if (controller.signal.aborted) {
      // Timeout/abort path: Process.run typically resolves (signal-killed
      // child still flushes a code) rather than rejects, so the timeout
      // marker has to be injected here, not in .catch. Without this branch
      // callers see an empty stderr and cannot distinguish "git failed
      // legitimately" from "we killed it".
      return {
        exitCode: settled.exitCode === 0 ? 1 : settled.exitCode,
        text: () => "",
        stdout: settled.stdout,
        stderr: Buffer.from(timeoutMessage),
      }
    }
    return settled
  } finally {
    clearTimeout(timer)
  }
}
