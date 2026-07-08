import path from "path"
import { describe, test } from "bun:test"
import { runIsolatedBunTest } from "../harness/isolated-bun-runner"

describe("tmpdir git fixture lifecycle", () => {
  test("isolated fixture run does not leave Bun dangling process cleanup", { timeout: 0 }, async () => {
    await runIsolatedBunTest({
      suiteName: "tmpdir git fixture lifecycle",
      isolatedFile: path.join(import.meta.dir, "isolated/tmpdir-git-lifecycle.isolated.ts"),
      expectedPassCount: 2,
      inactivityTimeoutMilliseconds: 15_000,
      temporaryPrefix: "opencorvus-tmpdir-git-lifecycle-",
      forbiddenOutput: ["killed "],
    })
  })
})
