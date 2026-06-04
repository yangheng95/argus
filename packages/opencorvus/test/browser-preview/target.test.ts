import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { resolveBrowserPreviewTarget } from "../../src/browser-preview/target"

async function writePackageJson(root: string, value: unknown) {
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(value, null, 2))
}

describe("browser preview target resolver", () => {
  test("uses explicit HTTP URL without reading project package metadata", async () => {
    await using tmp = await tmpdir()
    const target = await resolveBrowserPreviewTarget({
      projectRoot: tmp.path,
      explicitUrl: "http://127.0.0.1:5173/dashboard",
    })

    expect(target.status).toBe("ready")
    expect(target.kind).toBe("explicit-url")
    expect(target.url).toBe("http://127.0.0.1:5173/dashboard")
    expect(target.source).toBe("query")
    expect(target.viewports.map((viewport) => viewport.id)).toEqual(["desktop", "tablet", "mobile"])
  })

  test("rejects non-browser explicit URLs instead of falling back", async () => {
    await using tmp = await tmpdir()
    const target = await resolveBrowserPreviewTarget({
      projectRoot: tmp.path,
      explicitUrl: "file:///tmp/index.html",
    })

    expect(target.status).toBe("failed")
    expect(target.kind).toBe("failed")
    expect(target.diagnostics.join("\n")).toContain("Invalid preview URL")
  })

  test("uses package.json opencorvus.browserPreview.url as the manifest source", async () => {
    await using tmp = await tmpdir()
    await writePackageJson(tmp.path, {
      packageManager: "npm@10.9.0",
      scripts: { dev: "vite --host 127.0.0.1" },
      opencorvus: {
        browserPreview: {
          url: "http://localhost:4173/",
          command: "npm run dev",
        },
      },
    })

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path })

    expect(target.status).toBe("ready")
    expect(target.kind).toBe("manifest-url")
    expect(target.url).toBe("http://localhost:4173/")
    expect(target.command).toBe("npm run dev")
    expect(target.source).toBe("package-json")
  })

  test("fails explicitly when package.json cannot be parsed", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "package.json"), "{")

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path })

    expect(target.status).toBe("failed")
    expect(target.kind).toBe("failed")
    expect(target.source).toBe("package-json")
    expect(target.diagnostics.join("\n")).toContain("Failed to read package.json")
  })

  test("surfaces a configured command when URL is missing", async () => {
    await using tmp = await tmpdir()
    await writePackageJson(tmp.path, {
      packageManager: "pnpm@9.0.0",
      scripts: { dev: "vite --host 127.0.0.1" },
      opencorvus: {
        browserPreview: {
          command: "pnpm run dev",
        },
      },
    })

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path })

    expect(target.status).toBe("configured")
    expect(target.kind).toBe("manifest-command")
    expect(target.command).toBe("pnpm run dev")
    expect(target.url).toBeUndefined()
    expect(target.diagnostics.join("\n")).toContain("no opencorvus.browserPreview.url")
  })

  test("does not derive preview commands from package manager scripts", async () => {
    await using tmp = await tmpdir()
    await writePackageJson(tmp.path, {
      packageManager: "yarn@4.7.0",
      scripts: {
        start: "vite --host 127.0.0.1 --port 4173",
        preview: "vite preview --host 127.0.0.1",
        dev: "vite --host 127.0.0.1",
      },
    })

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path })

    expect(target.status).toBe("missing")
    expect(target.kind).toBe("missing")
    expect(target.command).toBeUndefined()
    expect(target.diagnostics.join("\n")).toContain("opencorvus.browserPreview.command")
  })

  test("does not infer package manager or command for runtime scripts", async () => {
    await using tmp = await tmpdir()
    await writePackageJson(tmp.path, {
      scripts: { dev: "vite --host 127.0.0.1" },
    })

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path })

    expect(target.status).toBe("missing")
    expect(target.kind).toBe("missing")
    expect(target.command).toBeUndefined()
    expect(target.diagnostics.join("\n")).toContain("opencorvus.browserPreview")
  })
})
