import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Worktree primary branch", () => {
  test("creates and merges goal worktrees against the primary worktree branch, not main/master", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M dev`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `dev-primary-${Date.now().toString(36)}` }),
    })

    expect(await $`git branch --show-current`.cwd(info.directory).quiet().text()).toBe(`opencorvus/${info.name}\n`)

    const file = path.join(info.directory, "feature.txt")
    await fs.writeFile(file, "from goal branch\n")
    await $`git add feature.txt`.cwd(info.directory).quiet()
    await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m "add feature"`
      .cwd(info.directory)
      .quiet()

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeWithMerge({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(result.primaryBranch).toBe("dev")
    expect(await $`git branch --show-current`.cwd(tmp.path).quiet().text()).toBe("dev\n")
    expect((await Filesystem.readText(path.join(tmp.path, "feature.txt"))).replace(/\r\n/g, "\n")).toBe(
      "from goal branch\n",
    )
    expect((await $`git show-ref --verify --quiet refs/heads/main`.cwd(tmp.path).quiet().nothrow()).exitCode).not.toBe(
      0,
    )
    expect(
      (await $`git show-ref --verify --quiet refs/heads/master`.cwd(tmp.path).quiet().nothrow()).exitCode,
    ).not.toBe(0)
  })
})
