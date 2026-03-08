import { test, expect } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

test("create tiny note file", async () => {
  await using tmp = await tmpdir()
  const notePath = path.join(tmp.path, "note.txt")
  const content = "tiny note"

  await Filesystem.write(notePath, content)

  const exists = await Filesystem.exists(notePath)
  expect(exists).toBe(true)

  const readContent = await Filesystem.readText(notePath)
  expect(readContent).toBe(content)
})
