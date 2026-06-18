import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"

// Guard against a nested git repository inside packages/opencorvus.
//
// WHY: this package is tracked by the monorepo repo at the workspace ROOT
// (for example C:/Users/example/opecorvus/.git). If a `.git` is ever created
// at the package directory (e.g. a stray `git init`, a tool run with
// --cd packages/opencorvus, an extracted tarball), every git command issued
// from within packages/opencorvus resolves to the INNER repo instead of the
// parent. The inner repo sees the whole tree as untracked, so commits/pushes
// silently go nowhere (or to a throwaway baseline) while parent-repo
// deletions are dropped — work appears committed but is lost. This actually
// happened and cost a debugging cycle; this test makes regression loud.
//
// FIX when this fails: remove the nested repo, e.g.
//   rm -rf packages/opencorvus/.git
// then run all git commands from the workspace root (or `git -C <root>`).
describe("repo hygiene: no nested .git in packages/opencorvus", () => {
  const packageRoot = path.resolve(import.meta.dir, "..", "..")

  test("package directory is NOT its own git repository", () => {
    const nested = path.join(packageRoot, ".git")
    expect(
      existsSync(nested),
      `Nested git repo found at ${nested}. packages/opencorvus must be tracked by the ` +
        `workspace-root repo only. A .git here shadows the parent for every git command ` +
        `run from this directory and silently drops parent-repo commits/deletions. ` +
        `Remove it: rm -rf packages/opencorvus/.git`,
    ).toBe(false)
  })

  // Primary hazard is a .git AT the package root (shadows the parent for
  // every git command). A .git directly under src/test/script would do the
  // same for tooling scoped there, so guard those direct children too. Not
  // recursive: a deeper embedded repo is implausible and `git status` itself
  // surfaces it as an embedded repo.
  test("no .git directly under src/, test/, or script/", () => {
    for (const sub of ["src", "test", "script"]) {
      const strayGit = path.join(packageRoot, sub, ".git")
      expect(existsSync(strayGit), `Unexpected nested .git at ${strayGit}`).toBe(false)
    }
  })
})
