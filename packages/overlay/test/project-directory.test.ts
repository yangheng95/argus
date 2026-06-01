import { describe, expect, test } from "bun:test"
import { projectDirectoryKey, projectDirectoryLabel } from "../src/utils/project-directory"

describe("project directory helpers", () => {
  test("builds a stable key for empty and populated directories", () => {
    expect(projectDirectoryKey("")).toBe("__opencorvus_unassigned_project__")
    expect(projectDirectoryKey("/repo/app")).toBe("/repo/app")
  })

  test("derives the same compact project label used by task and mission ledgers", () => {
    expect(projectDirectoryLabel("", "Unknown")).toEqual({ name: "Unknown", parent: "" })
    expect(projectDirectoryLabel("D:\\work\\opencorvus", "Unknown")).toEqual({
      name: "opencorvus",
      parent: "D:/work",
    })
    expect(projectDirectoryLabel("/Users/alice/projects/opencorvus", "Unknown")).toEqual({
      name: "opencorvus",
      parent: ".../alice/projects",
    })
  })
})
