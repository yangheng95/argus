import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FileTime } from "../../src/file/time"

const ctx = {
  sessionID: "test-edit-session",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.edit", () => {
  describe("creating new files", () => {
    test("creates new file when oldString is empty", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "newfile.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: filepath,
              oldString: "",
              newString: "new content",
            },
            ctx,
          )

          expect(result.metadata.diff).toContain("new content")

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("new content")
        },
      })
    })

    test("rejects empty oldString create when target already exists before asking permission", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "original content", "utf-8")
      const permissionCalls: unknown[] = []
      const permissionCtx = {
        ...ctx,
        ask: async (input: unknown) => {
          permissionCalls.push(input)
        },
      }

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "",
                newString: "replacement content",
              },
              permissionCtx,
            ),
          ).rejects.toThrow("apply_patch verification failed: Add File target already exists")

          expect(permissionCalls).toHaveLength(0)
          expect(await fs.readFile(filepath, "utf-8")).toBe("original content")
        },
      })
    })

    test("rejects empty oldString create when target appears during permission", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "race.txt")
      const permissionCalls: unknown[] = []
      const permissionCtx = {
        ...ctx,
        ask: async (input: unknown) => {
          permissionCalls.push(input)
          await fs.writeFile(filepath, "interloper content", "utf-8")
        },
      }

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "",
                newString: "tool content",
              },
              permissionCtx,
            ),
          ).rejects.toThrow("EEXIST")

          expect(permissionCalls).toHaveLength(1)
          expect(await fs.readFile(filepath, "utf-8")).toBe("interloper content")
        },
      })
    })

    test("creates new file with nested directories", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "nested", "dir", "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "",
              newString: "nested file",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("nested file")
        },
      })
    })

    test("emits add event for new files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "new.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Bus } = await import("../../src/bus")
          const { File } = await import("../../src/file")
          const { FileWatcher } = await import("../../src/file/watcher")

          const events: string[] = []
          const watcherEvents: string[] = []
          const unsubEdited = Bus.subscribe(File.Event.Edited, () => events.push("edited"))
          const unsubUpdated = Bus.subscribe(FileWatcher.Event.Updated, (event) => {
            events.push("updated")
            watcherEvents.push(event.properties.event)
          })

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "",
              newString: "content",
            },
            ctx,
          )

          expect(events).toContain("edited")
          expect(events).toContain("updated")
          expect(watcherEvents).toEqual(["add"])
          unsubEdited()
          unsubUpdated()
        },
      })
    })

    test("create-file branch uses the shared Add File verifier and exclusive create write", async () => {
      const source = await fs.readFile(path.join(import.meta.dir, "../../src/tool/edit.ts"), "utf8")
      expect(source).toContain("Patch.assertAddFileTargetDoesNotExist(filePath)")
      expect(source).toContain('flag: "wx"')
      expect(source).not.toContain('event: existed ? "change" : "add"')
    })
  })

  describe("editing existing files", () => {
    test("replaces text in existing file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "old content here", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: filepath,
              oldString: "old content",
              newString: "new content",
            },
            ctx,
          )

          expect(result.output).toContain("Edit applied successfully")

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("new content here")
        },
      })
    })

    test("throws error when file does not exist", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "nonexistent.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "old",
                newString: "new",
              },
              ctx,
            ),
          ).rejects.toThrow("not found")
        },
      })
    })

    test("throws error when oldString equals newString", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "same",
                newString: "same",
              },
              ctx,
            ),
          ).rejects.toThrow("identical")
        },
      })
    })

    test("throws error when oldString not found in file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "actual content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "not in file",
                newString: "replacement",
              },
              ctx,
            ),
          ).rejects.toThrow()
        },
      })
    })

    test("throws error when file was not read first (FileTime)", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "content",
                newString: "modified",
              },
              ctx,
            ),
          ).rejects.toThrow("You must read file")
        },
      })
    })

    test("throws error when file has been modified since read", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Read first
          FileTime.read(ctx.sessionID, filepath)

          // Wait a bit to ensure different timestamps
          await new Promise((resolve) => setTimeout(resolve, 100))

          // Simulate external modification
          await fs.writeFile(filepath, "modified externally", "utf-8")

          // Try to edit with the new content
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "modified externally",
                newString: "edited",
              },
              ctx,
            ),
          ).rejects.toThrow("modified since it was last read")
        },
      })
    })

    test("replaces all occurrences with replaceAll option", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "foo bar foo baz foo", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "foo",
              newString: "qux",
              replaceAll: true,
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("qux bar qux baz qux")
        },
      })
    })

    test("emits change event for existing files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const { Bus } = await import("../../src/bus")
          const { File } = await import("../../src/file")
          const { FileWatcher } = await import("../../src/file/watcher")

          const events: string[] = []
          const unsubEdited = Bus.subscribe(File.Event.Edited, () => events.push("edited"))
          const unsubUpdated = Bus.subscribe(FileWatcher.Event.Updated, () => events.push("updated"))

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "original",
              newString: "modified",
            },
            ctx,
          )

          expect(events).toContain("edited")
          expect(events).toContain("updated")
          unsubEdited()
          unsubUpdated()
        },
      })
    })
  })

  describe("edge cases", () => {
    test("preserves a leading Byte Order Mark when editing existing text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "marked.txt")
      await fs.writeFile(filepath, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("alpha\nbeta")]))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "alpha",
              newString: "omega",
            },
            ctx,
          )

          const buf = await fs.readFile(filepath)
          expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
          expect(buf.toString("utf-8")).toBe("\ufeffomega\nbeta")
        },
      })
    })

    test("handles multiline replacements", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "line2",
              newString: "new line 2\nextra line",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("line1\nnew line 2\nextra line\nline3")
        },
      })
    })

    test("handles CRLF line endings", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\r\nold\r\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "old",
              newString: "new",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("line1\r\nnew\r\nline3")
        },
      })
    })

    test("preserves CRLF when multiline edit input uses LF", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\r\nalpha\r\nbeta\r\nline4", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "alpha\nbeta",
              newString: "one\ntwo",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("line1\r\none\r\ntwo\r\nline4")
        },
      })
    })

    test("throws error when oldString equals newString", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "",
                newString: "",
              },
              ctx,
            ),
          ).rejects.toThrow("identical")
        },
      })
    })

    test("throws error when path is directory", async () => {
      await using tmp = await tmpdir()
      const dirpath = path.join(tmp.path, "adir")
      await fs.mkdir(dirpath)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, dirpath)

          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: dirpath,
                oldString: "old",
                newString: "new",
              },
              ctx,
            ),
          ).rejects.toThrow("directory")
        },
      })
    })

    test("tracks file diff statistics", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: filepath,
              oldString: "line2",
              newString: "new line a\nnew line b",
            },
            ctx,
          )

          expect(result.metadata.filediff).toBeDefined()
          expect(result.metadata.filediff.file).toBe(filepath)
          expect(result.metadata.filediff.additions).toBeGreaterThan(0)
        },
      })
    })
  })

  describe("concurrent editing", () => {
    test("serializes concurrent edits to same file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "0", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()

          // Two concurrent edits
          const promise1 = edit.execute(
            {
              filePath: filepath,
              oldString: "0",
              newString: "1",
            },
            ctx,
          )

          // Need to read again since FileTime tracks per-session
          FileTime.read(ctx.sessionID, filepath)

          const promise2 = edit.execute(
            {
              filePath: filepath,
              oldString: "0",
              newString: "2",
            },
            ctx,
          )

          // Both should complete without error (though one might fail due to content mismatch)
          const results = await Promise.allSettled([promise1, promise2])
          expect(results.some((r) => r.status === "fulfilled")).toBe(true)
        },
      })
    })
  })
})
