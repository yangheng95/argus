import { describe, expect, test } from "bun:test"
import { Worktree } from "../../src/worktree"

describe("Worktree merge failure detail", () => {
  test("surfaces NamedError data instead of the type tag", () => {
    const err = new Worktree.MergeFailedError({
      message: "mergeWithRebase(opencorvus/build-page): Primary worktree is detached",
      branch: "opencorvus/build-page",
      stderr: "fatal: invalid upstream 'main'",
    })

    expect(err.message).toBe("WorktreeMergeFailedError")
    expect(Worktree.mergeFailureDetail(err)).toEqual({
      reason: "mergeWithRebase(opencorvus/build-page): Primary worktree is detached",
      branch: "opencorvus/build-page",
      stderr: "fatal: invalid upstream 'main'",
    })
  })

  test("does not classify unrelated errors as merge infrastructure failures", () => {
    expect(Worktree.mergeFailureDetail(new Error("plain failure"))).toBeUndefined()
  })
})
