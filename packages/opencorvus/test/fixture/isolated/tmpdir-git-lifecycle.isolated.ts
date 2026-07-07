import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { tmpdir } from "../fixture"

describe("tmpdir git fixture lifecycle", () => {
  test("initializes repeated git projects without dangling child processes", { timeout: 0 }, async () => {
    for (let index = 0; index < 12; index++) {
      await using _project = await tmpdir({ git: true })
    }
  })

  test("removes fixture directories after async dispose", async () => {
    const project = await tmpdir()
    const fixturePath = project.path

    await project[Symbol.asyncDispose]()

    expect(existsSync(fixturePath)).toBe(false)
  })
})
