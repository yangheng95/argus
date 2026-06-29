import { expect, test } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"

test("default plugins do not expose retired upstream package names", async () => {
  const source = await Filesystem.readText(path.join(import.meta.dir, "../../src/plugin/index.ts"))

  expect(source).not.toContain("opencode-anthropic-auth")
  expect(source).not.toContain("@gitlab/opencode-gitlab-auth")
  expect(source).not.toContain("@opencode-ai/plugin")
  expect(source).not.toContain("BUILTIN")
})
