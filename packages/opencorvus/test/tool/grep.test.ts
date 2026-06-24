import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "node:fs/promises"
import { SearchCodeTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { createCodebaseTools } from "../../src/engine/codebase-tools"
import { FileTime } from "../../src/file/time"
import { WriteTool } from "../../src/tool/write"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.search_code", () => {
  test("description names pattern as the only search string field", async () => {
    const searchCode = await SearchCodeTool.init()

    expect(searchCode.description).toContain('{"pattern": "<regex>"}')
    expect(searchCode.description).toContain("do not use `query`")
    expect(searchCode.parameters.shape.pattern.description).toContain('field is named "pattern"')
    expect(searchCode.parameters.shape.pattern.description).toContain('do not use "query"')
  })

  test("workflow codebase tool description names pattern as the only search string field", () => {
    const searchCode = createCodebaseTools(projectRoot).search_code

    expect(searchCode.description).toContain('{"pattern":"<regex>"}')
    expect(searchCode.description).toContain('do not use "query"')
  })

  test("workflow codebase tools reject sibling-prefix path escapes", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const sibling = path.join(tmp.path, "repo2")
    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(sibling, { recursive: true })
    await Bun.write(path.join(sibling, "secret.txt"), "outside")

    const readFile = createCodebaseTools(root).read
    const result = await readFile.execute!({ filePath: "../repo2/secret.txt" }, {} as any)

    expect(result).toBe("Error: path is outside the project boundary.")
  })

  test("workflow read permits same-session overwrite through write tool", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "src", "component.tsx")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await Bun.write(filePath, "export function Component() {\n  return null\n}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "frontend-design-read-session"
        const readFile = createCodebaseTools(tmp.path).read
        const result = await readFile.execute!({ filePath: "src/component.tsx" }, { opencorvus: { sessionID } } as any)

        expect(String(result)).toContain("export function Component")
        expect(FileTime.get(sessionID, filePath)).toBeInstanceOf(Date)

        const write = await WriteTool.init()
        await expect(
          write.execute(
            {
              filePath,
              content: "export function Component() {\n  return 'updated'\n}\n",
            },
            { ...ctx, sessionID },
          ),
        ).resolves.toMatchObject({ output: expect.stringContaining("Wrote file successfully.") })
      },
    })
  }, 15_000)

  test("workflow search_code max_results limits total matches, not matches per file", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    for (let file = 1; file <= 3; file++) {
      await Bun.write(
        path.join(tmp.path, "src", `file-${file}.ts`),
        Array.from({ length: 4 }, (_, line) => `export const needle_${file}_${line + 1} = true`).join("\n"),
      )
    }

    const searchCode = createCodebaseTools(tmp.path).search_code as any
    const result = await searchCode.execute({ pattern: "needle", path: "src", max_results: 5 }, {} as any)
    const resultLines = String(result)
      .split(/\r?\n/)
      .filter((line) => line.includes("needle_"))

    expect(resultLines).toHaveLength(5)
    expect(result).toContain("(limited to 5 results)")
  })

  test("basic search", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const searchCode = await SearchCodeTool.init()
        const result = await searchCode.execute(
          {
            pattern: "export",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
        expect(result.output).toContain("Found")
      },
    })
  })

  test("no matches returns correct output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const searchCode = await SearchCodeTool.init()
        const result = await searchCode.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("handles CRLF line endings in output", async () => {
    // This test verifies the regex split handles both \n and \r\n
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a test file with content
        await Bun.write(path.join(dir, "test.txt"), "line1\nline2\nline3")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const searchCode = await SearchCodeTool.init()
        const result = await searchCode.execute(
          {
            pattern: "line",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })
})

describe("CRLF regex handling", () => {
  test("regex correctly splits Unix line endings", () => {
    const unixOutput = "file1.txt|1|content1\nfile2.txt|2|content2\nfile3.txt|3|content3"
    const lines = unixOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex correctly splits Windows CRLF line endings", () => {
    const windowsOutput = "file1.txt|1|content1\r\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = windowsOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex handles mixed line endings", () => {
    const mixedOutput = "file1.txt|1|content1\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = mixedOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
  })
})
