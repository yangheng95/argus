import { describe, test, expect, spyOn } from "bun:test"
import path from "path"
import nodeFs from "fs"
import fs from "fs/promises"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { createDirectoryAlias, tmpdir } from "../fixture/fixture"

describe("file/index Filesystem patterns", () => {
  describe("File.read() - text content", () => {
    test("reads text file via Filesystem.readText()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await fs.writeFile(filepath, "Hello World", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("Hello World")
        },
      })
    })

    test("rejects missing text files", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.read("nonexistent.txt")).rejects.toMatchObject({ name: "FileNotFoundError" })
        },
      })
    })

    test("preserves leading and trailing whitespace from text content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await fs.writeFile(filepath, "  content with spaces  \n\n", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.txt")
          expect(result.content).toBe("  content with spaces  \n\n")
        },
      })
    })

    test("handles empty text file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "empty.txt")
      await fs.writeFile(filepath, "", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("empty.txt")
          expect(result.type).toBe("text")
          expect(result.content).toBe("")
        },
      })
    })

    test("handles multi-line text files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "multiline.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("multiline.txt")
          expect(result.content).toBe("line1\nline2\nline3")
        },
      })
    })
  })

  describe("File.read() - binary content", () => {
    test("reads binary file via Filesystem.readArrayBuffer()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "image.png")
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await fs.writeFile(filepath, binaryContent)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("image.png")
          expect(result.type).toBe("text") // Images return as text with base64 encoding
          expect(result.encoding).toBe("base64")
          expect(result.mimeType).toBe("image/png")
          expect(result.content).toBe(binaryContent.toString("base64"))
        },
      })
    })

    test("returns empty for binary non-image files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "binary.so")
      await fs.writeFile(filepath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "binary")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("binary.so")
          expect(result.type).toBe("binary")
          expect(result.content).toBe("")
        },
      })
    })

    test("propagates read access failures for binary non-image files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "binary.so")
      await fs.writeFile(filepath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "binary")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const access = spyOn(nodeFs.promises, "access").mockImplementation(async (target) => {
            if (String(target).endsWith("binary.so")) {
              throw Object.assign(new Error("binary read denied"), { code: "EACCES" })
            }
          })
          try {
            await expect(File.read("binary.so")).rejects.toThrow("binary read denied")
          } finally {
            access.mockRestore()
          }
        },
      })
    })
  })

  describe("File.writeText()", () => {
    test("writes existing editable text files and returns the updated content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "notes.md")
      await fs.writeFile(filepath, "before", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.writeText("notes.md", "  after\nline\n")
          expect(result.type).toBe("text")
          expect(result.content).toBe("  after\nline\n")
          expect(await fs.readFile(filepath, "utf-8")).toBe("  after\nline\n")
        },
      })
    })

    test("rejects path traversal writes outside the project", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.writeText("../outside.txt", "nope")).rejects.toThrow("Access denied")
        },
      })
    })

    test("rejects binary extension writes from the project file editor route", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "binary.so"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.writeText("binary.so", "nope")).rejects.toThrow("Cannot edit binary file")
        },
      })
    })
  })

  describe("File.create(), File.move(), File.copy(), and File.remove()", () => {
    test("creates one file and one directory under existing parents", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "docs"), { recursive: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const file = await File.create({
            path: path.join("docs", "notes.md"),
            type: "file",
            content: "hello\n",
          })
          const directory = await File.create({
            path: path.join("docs", "drafts"),
            type: "directory",
          })

          expect(file).toMatchObject({
            name: "notes.md",
            path: path.join("docs", "notes.md"),
            type: "file",
          })
          expect(directory).toMatchObject({
            name: "drafts",
            path: path.join("docs", "drafts"),
            type: "directory",
          })
          expect(await fs.readFile(path.join(tmp.path, "docs", "notes.md"), "utf-8")).toBe("hello\n")
          expect((await fs.stat(path.join(tmp.path, "docs", "drafts"))).isDirectory()).toBe(true)
        },
      })
    })

    test("rejects missing parents without creating intermediate directories", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.create({
              path: path.join("missing", "notes.md"),
              type: "file",
            }),
          ).rejects.toThrow("FileInvalidPathError")
          await expect(fs.stat(path.join(tmp.path, "missing"))).rejects.toThrow()
        },
      })
    })

    test("rejects create and move conflicts without overwriting destinations", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "existing.md"), "existing", "utf-8")
      await fs.writeFile(path.join(tmp.path, "source.md"), "source", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.create({
              path: "existing.md",
              type: "file",
              content: "new",
            }),
          ).rejects.toThrow("FileConflictError")
          await expect(File.move({ path: "source.md", newPath: "existing.md" })).rejects.toThrow("FileConflictError")
          expect(await fs.readFile(path.join(tmp.path, "existing.md"), "utf-8")).toBe("existing")
          expect(await fs.readFile(path.join(tmp.path, "source.md"), "utf-8")).toBe("source")
        },
      })
    })

    test("moves and renames files without overwriting", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "docs"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "old.md"), "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.move({
            path: "old.md",
            newPath: path.join("docs", "new.md"),
          })

          expect(result).toMatchObject({
            previousPath: "old.md",
            path: path.join("docs", "new.md"),
            node: {
              name: "new.md",
              path: path.join("docs", "new.md"),
              type: "file",
            },
          })
          await expect(fs.stat(path.join(tmp.path, "old.md"))).rejects.toThrow()
          expect(await fs.readFile(path.join(tmp.path, "docs", "new.md"), "utf-8")).toBe("content")
        },
      })
    })

    test("copies files and directories recursively without removing sources", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "docs", "nested"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "source.md"), "file content", "utf-8")
      await fs.writeFile(path.join(tmp.path, "docs", "nested", "draft.md"), "directory content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const fileCopy = await File.copy({
            path: "source.md",
            newPath: path.join("docs", "source-copy.md"),
          })
          const directoryCopy = await File.copy({
            path: "docs",
            newPath: "docs-copy",
          })

          expect(fileCopy).toMatchObject({
            sourcePath: "source.md",
            path: path.join("docs", "source-copy.md"),
            node: {
              name: "source-copy.md",
              path: path.join("docs", "source-copy.md"),
              type: "file",
            },
          })
          expect(directoryCopy).toMatchObject({
            sourcePath: "docs",
            path: "docs-copy",
            node: {
              name: "docs-copy",
              path: "docs-copy",
              type: "directory",
            },
          })
          expect(await fs.readFile(path.join(tmp.path, "source.md"), "utf-8")).toBe("file content")
          expect(await fs.readFile(path.join(tmp.path, "docs", "source-copy.md"), "utf-8")).toBe("file content")
          expect(await fs.readFile(path.join(tmp.path, "docs", "nested", "draft.md"), "utf-8")).toBe(
            "directory content",
          )
          expect(await fs.readFile(path.join(tmp.path, "docs-copy", "nested", "draft.md"), "utf-8")).toBe(
            "directory content",
          )
        },
      })
    })

    test("rejects copy conflicts and missing parents without overwriting or creating parents", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "source.md"), "source", "utf-8")
      await fs.writeFile(path.join(tmp.path, "existing.md"), "existing", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.copy({ path: "source.md", newPath: "existing.md" })).rejects.toThrow(
            "FileConflictError",
          )
          await expect(File.copy({ path: "source.md", newPath: path.join("missing", "copy.md") })).rejects.toThrow(
            "FileInvalidPathError",
          )
          expect(await fs.readFile(path.join(tmp.path, "source.md"), "utf-8")).toBe("source")
          expect(await fs.readFile(path.join(tmp.path, "existing.md"), "utf-8")).toBe("existing")
          await expect(fs.stat(path.join(tmp.path, "missing"))).rejects.toThrow()
        },
      })
    })

    test("resolves non-existing mutation targets under a selected directory alias", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, ".nova-vibecoding-template"), { recursive: true })
      await fs.mkdir(path.join(tmp.path, ".agents"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, ".agents", "config.md"), "agent config", "utf-8")
      const alias = await createDirectoryAlias(tmp.path)

      try {
        await Instance.provide({
          directory: alias,
          fn: async () => {
            const moved = await File.move({
              path: ".agents",
              newPath: path.join(".nova-vibecoding-template", ".agents"),
            })
            expect(moved).toMatchObject({
              previousPath: ".agents",
              path: path.join(".nova-vibecoding-template", ".agents"),
              node: {
                name: ".agents",
                type: "directory",
              },
            })
            expect(
              await fs.readFile(path.join(tmp.path, ".nova-vibecoding-template", ".agents", "config.md"), "utf-8"),
            ).toBe("agent config")

            const copied = await File.copy({
              path: path.join(".nova-vibecoding-template", ".agents"),
              newPath: path.join(".nova-vibecoding-template", ".agents-copy"),
            })
            expect(copied).toMatchObject({
              sourcePath: path.join(".nova-vibecoding-template", ".agents"),
              path: path.join(".nova-vibecoding-template", ".agents-copy"),
              node: {
                name: ".agents-copy",
                type: "directory",
              },
            })
            expect(
              await fs.readFile(path.join(tmp.path, ".nova-vibecoding-template", ".agents-copy", "config.md"), "utf-8"),
            ).toBe("agent config")

            const created = await File.create({
              path: path.join(".nova-vibecoding-template", "created.md"),
              type: "file",
              content: "created",
            })
            expect(created.path).toBe(path.join(".nova-vibecoding-template", "created.md"))

            const uploaded = await File.upload({
              targetDir: ".nova-vibecoding-template",
              files: [
                {
                  name: "dropped.txt",
                  contentBase64: Buffer.from("dropped", "utf-8").toString("base64"),
                },
              ],
            })
            expect(uploaded).toEqual([
              {
                name: "dropped.txt",
                path: path.join(".nova-vibecoding-template", "dropped.txt"),
                bytes: 7,
              },
            ])
          },
        })
      } finally {
        await Instance.tryProvideActive({
          directory: alias,
          fn: () => Instance.dispose(),
        })
        await fs.rm(alias, { recursive: true, force: true })
      }
    })

    test("rejects mutation targets through a symlinked parent outside the selected directory", async () => {
      await using tmp = await tmpdir()
      await using outside = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "source.md"), "source", "utf-8")
      await fs.mkdir(path.join(tmp.path, "docs"), { recursive: true })
      const escapeLink = path.join(tmp.path, "escape-link")
      const nestedEscapeLink = path.join(tmp.path, "docs", "escape-link")
      await fs.rm(escapeLink, { recursive: true, force: true })
      await fs.rm(nestedEscapeLink, { recursive: true, force: true })
      await fs.symlink(outside.path, escapeLink, process.platform === "win32" ? "junction" : "dir")
      await fs.symlink(outside.path, nestedEscapeLink, process.platform === "win32" ? "junction" : "dir")

      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            await expect(
              File.create({
                path: path.join("escape-link", "created.md"),
                type: "file",
                content: "created",
              }),
            ).rejects.toThrow("FileInvalidPathError")
            await expect(
              File.move({
                path: "source.md",
                newPath: path.join("escape-link", "source.md"),
              }),
            ).rejects.toThrow("FileInvalidPathError")
            await expect(
              File.copy({
                path: "source.md",
                newPath: path.join("escape-link", "source.md"),
              }),
            ).rejects.toThrow("FileInvalidPathError")
            await expect(
              File.copy({
                path: "escape-link",
                newPath: "copied-link",
              }),
            ).rejects.toThrow("FileInvalidPathError")
            await expect(
              File.copy({
                path: "docs",
                newPath: "docs-copy",
              }),
            ).rejects.toThrow("FileInvalidPathError")
            expect(await fs.readFile(path.join(tmp.path, "source.md"), "utf-8")).toBe("source")
            await expect(fs.stat(path.join(outside.path, "created.md"))).rejects.toThrow()
            await expect(fs.stat(path.join(outside.path, "source.md"))).rejects.toThrow()
            await expect(fs.stat(path.join(tmp.path, "copied-link"))).rejects.toThrow()
            await expect(fs.stat(path.join(tmp.path, "docs-copy"))).rejects.toThrow()
          },
        })
      } finally {
        await Instance.tryProvideActive({
          directory: tmp.path,
          fn: () => Instance.dispose(),
        })
        await fs.rm(escapeLink, { recursive: true, force: true })
        await fs.rm(nestedEscapeLink, { recursive: true, force: true })
      }
    })

    test("rejects root copy, traversal copy, and copying a directory into itself", async () => {
      await using tmp = await tmpdir()
      const outside = path.join(tmp.path, "..", "outside-file-browser-copy.txt")
      await fs.rm(outside, { force: true })
      await fs.mkdir(path.join(tmp.path, "docs", "nested"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "docs", "notes.md"), "notes", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.copy({ path: "", newPath: "root-copy" })).rejects.toThrow("FileInvalidPathError")
          await expect(
            File.copy({
              path: "docs",
              newPath: path.join("docs", "nested", "docs-copy"),
            }),
          ).rejects.toThrow("FileInvalidPathError")
          await expect(File.copy({ path: "docs", newPath: "../outside-file-browser-copy.txt" })).rejects.toThrow(
            "FileInvalidPathError",
          )
          await expect(fs.stat(path.join(tmp.path, "root-copy"))).rejects.toThrow()
          await expect(fs.stat(path.join(tmp.path, "docs", "nested", "docs-copy"))).rejects.toThrow()
          await expect(fs.stat(outside)).rejects.toThrow()
        },
      })
    })

    test("deletes files and directories recursively", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "docs", "nested"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "scratch.txt"), "delete me", "utf-8")
      await fs.writeFile(path.join(tmp.path, "docs", "nested", "draft.md"), "delete me too", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.remove({ path: "scratch.txt" })).resolves.toEqual({ path: "scratch.txt" })
          await expect(File.remove({ path: "docs" })).resolves.toEqual({ path: "docs" })
          await expect(fs.stat(path.join(tmp.path, "scratch.txt"))).rejects.toThrow()
          await expect(fs.stat(path.join(tmp.path, "docs"))).rejects.toThrow()
        },
      })
    })

    test("rejects root delete and traversal mutations", async () => {
      await using tmp = await tmpdir()
      const outside = path.join(tmp.path, "..", "outside-file-browser.txt")
      await fs.rm(outside, { force: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.remove({ path: "" })).rejects.toThrow("FileInvalidPathError")
          await expect(
            File.create({
              path: "../outside-file-browser.txt",
              type: "file",
              content: "nope",
            }),
          ).rejects.toThrow("FileInvalidPathError")
          await expect(File.copy({ path: "missing.md", newPath: "../outside-file-browser.txt" })).rejects.toThrow(
            "FileInvalidPathError",
          )
          await expect(File.move({ path: "missing.md", newPath: "../outside-file-browser.txt" })).rejects.toThrow(
            "FileInvalidPathError",
          )
          await expect(File.remove({ path: "../outside-file-browser.txt" })).rejects.toThrow("FileInvalidPathError")
          await expect(fs.stat(outside)).rejects.toThrow()
        },
      })
    })
  })

  describe("File.upload()", () => {
    function contentBase64(value: string | Buffer): string {
      return Buffer.from(value).toString("base64")
    }

    test("writes dropped files into an existing project directory without overwriting", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "docs"), { recursive: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.upload({
            targetDir: "docs",
            files: [
              { name: "notes.md", contentBase64: contentBase64("hello\n") },
              { name: "image.bin", contentBase64: contentBase64(Buffer.from([1, 2, 3])) },
            ],
          })

          expect(result).toEqual([
            { name: "notes.md", path: path.join("docs", "notes.md"), bytes: 6 },
            { name: "image.bin", path: path.join("docs", "image.bin"), bytes: 3 },
          ])
          expect(await fs.readFile(path.join(tmp.path, "docs", "notes.md"), "utf-8")).toBe("hello\n")
          expect(await fs.readFile(path.join(tmp.path, "docs", "image.bin"))).toEqual(Buffer.from([1, 2, 3]))
        },
      })
    })

    test("rejects uploaded names that are paths", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.upload({
              targetDir: "",
              files: [{ name: "../escape.txt", contentBase64: contentBase64("nope") }],
            }),
          ).rejects.toThrow("FileUploadInvalidNameError")
          await expect(fs.readFile(path.join(tmp.path, "escape.txt"), "utf-8")).rejects.toThrow()
        },
      })
    })

    test.if(process.platform === "win32")("rejects Windows reserved uploaded names before writing", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.upload({
              targetDir: "",
              files: [{ name: "CON.txt", contentBase64: contentBase64("nope") }],
            }),
          ).rejects.toThrow("FileUploadInvalidNameError")
        },
      })
    })

    test("rejects duplicate dropped names before writing any file", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.upload({
              targetDir: "",
              files: [
                { name: "same.txt", contentBase64: contentBase64("first") },
                { name: "same.txt", contentBase64: contentBase64("second") },
              ],
            }),
          ).rejects.toThrow("FileUploadConflictError")
          await expect(fs.readFile(path.join(tmp.path, "same.txt"), "utf-8")).rejects.toThrow()
        },
      })
    })

    test("rejects existing destination files", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "README.md"), "existing", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.upload({
              targetDir: "",
              files: [{ name: "README.md", contentBase64: contentBase64("new") }],
            }),
          ).rejects.toThrow("FileUploadConflictError")
          expect(await fs.readFile(path.join(tmp.path, "README.md"), "utf-8")).toBe("existing")
        },
      })
    })

    test("rejects missing upload target directories", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.upload({
              targetDir: "missing",
              files: [{ name: "notes.md", contentBase64: contentBase64("new") }],
            }),
          ).rejects.toThrow("FileUploadInvalidTargetError")
        },
      })
    })

    test("rejects non-standard base64 content", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            File.upload({
              targetDir: "",
              files: [{ name: "bad.txt", contentBase64: "--__" }],
            }),
          ).rejects.toThrow("FileUploadInvalidContentError")
          await expect(fs.readFile(path.join(tmp.path, "bad.txt"), "utf-8")).rejects.toThrow()
        },
      })
    })
  })

  describe("File.read() - Filesystem.mimeType()", () => {
    test("detects MIME type via Filesystem.mimeType()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.json")
      await fs.writeFile(filepath, '{"key": "value"}', "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(Filesystem.mimeType(filepath)).toContain("application/json")

          const result = await File.read("test.json")
          expect(result.type).toBe("text")
        },
      })
    })

    test("handles various image MIME types", async () => {
      await using tmp = await tmpdir()
      const testCases = [
        { ext: "jpg", mime: "image/jpeg" },
        { ext: "png", mime: "image/png" },
        { ext: "gif", mime: "image/gif" },
        { ext: "webp", mime: "image/webp" },
      ]

      for (const { ext, mime } of testCases) {
        const filepath = path.join(tmp.path, `test.${ext}`)
        await fs.writeFile(filepath, Buffer.from([0x00, 0x00, 0x00, 0x00]), "binary")

        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(Filesystem.mimeType(filepath)).toContain(mime)
          },
        })
      }
    })
  })

  describe("File.list() - Filesystem.exists() and readText()", () => {
    test("reads .gitignore via Filesystem.exists() and readText()", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const gitignorePath = path.join(tmp.path, ".gitignore")
          await fs.writeFile(gitignorePath, "node_modules\ndist\n", "utf-8")

          // This is used internally in File.list()
          expect(await Filesystem.exists(gitignorePath)).toBe(true)

          const content = await Filesystem.readText(gitignorePath)
          expect(content).toContain("node_modules")
        },
      })
    })

    test("reads .ignore file similarly", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ignorePath = path.join(tmp.path, ".ignore")
          await fs.writeFile(ignorePath, "*.log\n.env\n", "utf-8")

          expect(await Filesystem.exists(ignorePath)).toBe(true)
          expect(await Filesystem.readText(ignorePath)).toContain("*.log")
        },
      })
    })

    test("handles missing .gitignore gracefully", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const gitignorePath = path.join(tmp.path, ".gitignore")
          await fs.rm(gitignorePath, { force: true })
          expect(await Filesystem.exists(gitignorePath)).toBe(false)

          // File.list() should still work
          const nodes = await File.list()
          expect(Array.isArray(nodes)).toBe(true)
        },
      })
    })

    test("does not report unreadable or missing directories as empty", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.list("missing-directory")).rejects.toThrow()
        },
      })
    })
  })

  describe("File.changed() - Filesystem.readText() for untracked files", () => {
    test("reads untracked files via Filesystem.readText()", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const untrackedPath = path.join(tmp.path, "untracked.txt")
          await fs.writeFile(untrackedPath, "new content\nwith multiple lines", "utf-8")

          // This is how File.changed() reads untracked files
          const content = await Filesystem.readText(untrackedPath)
          const lines = content.split("\n").length
          expect(lines).toBe(2)
        },
      })
    })
  })

  describe("Error handling", () => {
    test("propagates Filesystem.readText() errors", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "readonly.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nonExistentPath = path.join(tmp.path, "does-not-exist.txt")
          // Filesystem.readText() on non-existent file throws
          await expect(Filesystem.readText(nonExistentPath)).rejects.toThrow()

          const readText = spyOn(Filesystem, "readText").mockRejectedValue(new Error("read denied"))
          await expect(File.read("readonly.txt")).rejects.toThrow("read denied")
          readText.mockRestore()
        },
      })
    })

    test("handles errors in Filesystem.readArrayBuffer()", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nonExistentPath = path.join(tmp.path, "does-not-exist.bin")
          const buffer = await Filesystem.readArrayBuffer(nonExistentPath).catch(() => new ArrayBuffer(0))
          expect(buffer.byteLength).toBe(0)
        },
      })
    })

    test("rejects missing images", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.read("broken.png")).rejects.toMatchObject({ name: "FileNotFoundError" })
        },
      })
    })
  })

  describe("shouldEncode() logic", () => {
    test("treats .ts files as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.ts")
      await fs.writeFile(filepath, "export const value = 1", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.ts")
          expect(result.type).toBe("text")
          expect(result.content).toBe("export const value = 1")
        },
      })
    })

    test("treats .mts files as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.mts")
      await fs.writeFile(filepath, "export const value = 1", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.mts")
          expect(result.type).toBe("text")
          expect(result.content).toBe("export const value = 1")
        },
      })
    })

    test("treats .sh files as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.sh")
      await fs.writeFile(filepath, "#!/usr/bin/env bash\necho hello", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.sh")
          expect(result.type).toBe("text")
          expect(result.content).toBe("#!/usr/bin/env bash\necho hello")
        },
      })
    })

    test("treats Dockerfile as text", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "Dockerfile")
      await fs.writeFile(filepath, "FROM alpine:3.20", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("Dockerfile")
          expect(result.type).toBe("text")
          expect(result.content).toBe("FROM alpine:3.20")
        },
      })
    })

    test("returns encoding info for text files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await fs.writeFile(filepath, "simple text", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.txt")
          expect(result.encoding).toBeUndefined()
          expect(result.type).toBe("text")
        },
      })
    })

    test("returns base64 encoding for images", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.jpg")
      await fs.writeFile(filepath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "binary")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await File.read("test.jpg")
          expect(result.encoding).toBe("base64")
          expect(result.mimeType).toBe("image/jpeg")
        },
      })
    })
  })

  describe("Path security", () => {
    test("throws for paths outside project directory", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.read("../outside.txt")).rejects.toThrow("Access denied")
        },
      })
    })

    test("throws for paths outside project directory", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(File.read("../outside.txt")).rejects.toThrow("Access denied")
        },
      })
    })
  })
})
