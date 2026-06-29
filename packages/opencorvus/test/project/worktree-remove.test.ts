import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

function slash(input: string) {
  return input.replace(/\\/g, "/")
}

describe("Worktree.remove", () => {
  test("removes a registered worktree without delegating physical deletion to git worktree remove", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-regression-${Date.now().toString(36)}`
    const branch = `opencorvus/${name}`
    const dir = path.join(root, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(dir).quiet()

    const real = (await $`which git`.quiet().text()).trim()
    expect(real).toBeTruthy()

    const bin = path.join(root, "bin")
    const shim = path.join(bin, "git")
    const forbidden = path.join(root, "git-worktree-remove-called.txt")
    await fs.mkdir(bin, { recursive: true })
    await Bun.write(
      shim,
      [
        "#!/bin/bash",
        `REAL_GIT=${JSON.stringify(real)}`,
        `FORBIDDEN=${JSON.stringify(forbidden)}`,
        'if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then',
        '  echo "$@" > "$FORBIDDEN"',
        '  echo "fatal: git worktree remove must not own physical teardown" >&2',
        "  exit 97",
        "fi",
        'exec "$REAL_GIT" "$@"',
      ].join("\n"),
    )
    await fs.chmod(shim, 0o755)

    const prev = process.env.PATH ?? ""
    process.env.PATH = `${bin}${path.delimiter}${prev}`

    const ok = await (async () => {
      try {
        return await Instance.provide({
          directory: root,
          fn: () => Worktree.remove({ directory: dir }),
        })
      } finally {
        process.env.PATH = prev
      }
    })()

    expect(ok).toBe(true)
    expect(await Filesystem.exists(dir)).toBe(false)
    expect(await Filesystem.exists(forbidden)).toBe(false)

    const list = await $`git worktree list --porcelain`.cwd(root).quiet().text()
    expect(list).not.toContain(`worktree ${dir}`)

    const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow()
    expect(ref.exitCode).not.toBe(0)
  })

  test("prunes a registered worktree whose .git linkage is already missing", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const name = `remove-zombie-${Date.now().toString(36)}`
    const branch = `opencorvus/${name}`
    const dir = path.join(root, "..", name)

    await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet()
    await $`git reset --hard`.cwd(dir).quiet()
    await fs.writeFile(path.join(dir, "leftover.txt"), "zombie residue\n")
    await fs.rm(path.join(dir, ".git"), { force: true })

    const before = await $`git worktree list --porcelain`.cwd(root).quiet().text()
    expect(slash(before)).toContain(`worktree ${slash(path.resolve(dir))}`)
    expect(await Filesystem.exists(dir)).toBe(true)

    const ok = await Instance.provide({
      directory: root,
      fn: () => Worktree.remove({ directory: dir }),
    })

    expect(ok).toBe(true)
    expect(await Filesystem.exists(dir)).toBe(false)
    const list = await $`git worktree list --porcelain`.cwd(root).quiet().text()
    expect(slash(list)).not.toContain(`worktree ${slash(path.resolve(dir))}`)
    const ref = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(root).quiet().nothrow()
    expect(ref.exitCode).not.toBe(0)
  })
})
