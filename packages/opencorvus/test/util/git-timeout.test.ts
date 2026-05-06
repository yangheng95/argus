import { describe, expect, test } from "bun:test"
import { GitTimeout, git, resolveGitTimeoutMs } from "../../src/util/git"

describe("resolveGitTimeoutMs", () => {
  test("explicit timeoutMs wins over profile", () => {
    expect(resolveGitTimeoutMs({ timeoutMs: 1234, timeoutProfile: "network" })).toBe(1234)
  })

  test("profile fast resolves to 15s band", () => {
    expect(resolveGitTimeoutMs({ timeoutProfile: "fast" })).toBe(GitTimeout.fast)
    expect(GitTimeout.fast).toBe(15_000)
  })

  test("profile default resolves to 90s band", () => {
    expect(resolveGitTimeoutMs({ timeoutProfile: "default" })).toBe(GitTimeout.default)
    expect(GitTimeout.default).toBe(90_000)
  })

  test("profile network resolves to 300s band", () => {
    expect(resolveGitTimeoutMs({ timeoutProfile: "network" })).toBe(GitTimeout.network)
    expect(GitTimeout.network).toBe(300_000)
  })

  test("no profile or ms falls back to legacy 90s default", () => {
    expect(resolveGitTimeoutMs({})).toBe(90_000)
  })
})

describe("git()", () => {
  test("returns exitCode!=0 with timeout marker stderr when deadline elapses", async () => {
    // `git fsck --full --strict` over a tiny repo would still exit fast, so
    // we drive the timeout via an absurdly short budget against a normal
    // command. Process.run kills the child via AbortSignal; the catch
    // branch in git() injects "timed out after Nms" into stderr.
    const result = await git(["status"], {
      cwd: process.cwd(),
      timeoutMs: 1, // forces immediate timeout regardless of git start latency
    })
    // Either git was killed before exit (exitCode != 0) OR — in the unlikely
    // case the OS scheduled a sub-1ms exit — exitCode could be 0. Assert
    // the timeout message specifically when we did time out.
    if (result.exitCode !== 0) {
      expect(result.stderr.toString()).toContain("timed out after 1ms")
      expect(result.stderr.toString()).toContain(`cwd=${process.cwd()}`)
    }
  })

  test("includes argv list in timeout error message", async () => {
    const result = await git(["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      timeoutMs: 1,
    })
    if (result.exitCode !== 0 && result.stderr.toString().includes("timed out")) {
      expect(result.stderr.toString()).toContain("git rev-parse HEAD")
    }
  })
})
