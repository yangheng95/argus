import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("Instance.provide rejects legacy runtime directories instead of migrating or reading them", async () => {
  await using tmp = await tmpdir({ git: true })
  const legacyRuntime = path.join(tmp.path, ".opencorvus", "runtime")
  await fs.mkdir(legacyRuntime, { recursive: true })
  await fs.writeFile(path.join(legacyRuntime, "legacy.txt"), "old runtime")

  await expect(
    Instance.provide({
      directory: tmp.path,
      fn: () => "started",
    }),
  ).rejects.toThrow("Legacy OpenCorvus runtime paths exist")

  await expect(fs.readFile(path.join(legacyRuntime, "legacy.txt"), "utf8")).resolves.toBe("old runtime")
})
