import { afterEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Capture the original `git` helper so the mock can transparently pass
// through when `forceTimeout` is false. Without that fallback the mock
// would corrupt every other test sharing this module graph (Bun's
// `mock.module` is process-wide once registered).
const gitModule = await import("../../src/util/git")
const originalGit = gitModule.git

let forceTimeout = false

mock.module("../../src/util/git", () => ({
  ...gitModule,
  git: async (args: string[], opts: Parameters<typeof originalGit>[1]) => {
    if (!forceTimeout) return originalGit(args, opts)
    return {
      exitCode: 1,
      text: () => "",
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(`git ${args.join(" ")} timed out after 1ms (cwd=${opts.cwd})`),
    }
  },
}))

const { Vcs } = await import("../../src/project/vcs")

describe("Vcs.info under git timeout/failure", () => {
  afterEach(async () => {
    forceTimeout = false
    await resetDatabase()
  })

  test("returns initialized:true with commit/branch:undefined when git fails (no hang)", async () => {
    await using tmp = await tmpdir({ git: true })

    forceTimeout = true
    const started = Date.now()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await Vcs.info()
        // The disk probe (Project.isGitRepo) still sees `.git`, so initialized
        // is true. But every git invocation we forced to fail, so commit /
        // branch must degrade to undefined and the porcelain parser sees an
        // empty string.
        expect(info.initialized).toBe(true)
        expect(info.commit).toBeUndefined()
        expect(info.branch).toBeUndefined()
        expect(info.staged).toBe(0)
        expect(info.modified).toBe(0)
        expect(info.untracked).toBe(0)
      },
    })
    // Total wall time well under a second — proves Vcs.info doesn't await
    // an unbounded child process. Pre-Phase-1 a hung git would pin this
    // call indefinitely.
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
