import { expect, test } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"

test("default plugins do not install the deprecated Anthropic auth package", async () => {
  const source = await Filesystem.readText(path.join(import.meta.dir, "../../src/plugin/index.ts"))

  expect(source).not.toContain("opencode-anthropic-auth")
  expect(source).not.toContain("BUILTIN")
})
