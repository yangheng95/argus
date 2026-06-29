import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Auth } from "../../src/auth"
import { Filesystem } from "../../src/util/filesystem"

describe("Auth file loading", () => {
  afterEach(() => {
    mock.restore()
  })

  test("missing auth.json means no saved auth", async () => {
    const readJson = spyOn(Filesystem, "readJson").mockImplementation(async () => {
      const error = new Error("missing") as Error & { code: string }
      error.code = "ENOENT"
      throw error
    })
    try {
      expect(await Auth.all()).toEqual({})
    } finally {
      readJson.mockRestore()
    }
  })

  test("unreadable auth.json fails instead of becoming empty auth", async () => {
    const readJson = spyOn(Filesystem, "readJson").mockImplementation(async () => {
      const error = new Error("permission denied") as Error & { code: string }
      error.code = "EACCES"
      throw error
    })
    try {
      await expect(Auth.all()).rejects.toThrow("Failed to read auth file")
    } finally {
      readJson.mockRestore()
    }
  })

  test("invalid auth entries fail with the provider key", async () => {
    const readJson = spyOn(Filesystem, "readJson").mockResolvedValue({
      openai: { type: "api" },
    } as never)
    try {
      await expect(Auth.all()).rejects.toThrow('Invalid auth entry "openai"')
    } finally {
      readJson.mockRestore()
    }
  })
})
