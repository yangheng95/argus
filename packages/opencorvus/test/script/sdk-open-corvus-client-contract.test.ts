import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")

function readRepoFile(...parts: string[]) {
  return readFileSync(path.join(ROOT, ...parts), "utf8")
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (full.includes(`${path.sep}node_modules${path.sep}`) || full.includes(`${path.sep}dist${path.sep}`)) continue
    if (full.includes(`${path.sep}test${path.sep}`)) continue
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full)
  }
  return out
}

describe("SDK OpenCorvus client contract", () => {
  test("generator emits OpenCorvusClient as the canonical client class", () => {
    const build = readRepoFile("packages", "sdk", "js", "script", "build.ts")
    const generated = readRepoFile("packages", "sdk", "js", "src", "gen", "sdk.gen.ts")

    expect(build).toContain('containerName: "OpenCorvusClient"')
    expect(build).toContain("export class OpenCorvusClient")
    expect(build).not.toContain("OpencodeClient")
    expect(generated).toContain("export class OpenCorvusClient")
    expect(generated).not.toContain("OpencodeClient")
  })

  test("public SDK exports do not retain opencode compatibility aliases", () => {
    const client = readRepoFile("packages", "sdk", "js", "src", "client.ts")
    const server = readRepoFile("packages", "sdk", "js", "src", "server.ts")
    const index = readRepoFile("packages", "sdk", "js", "src", "index.ts")
    const source = `${client}\n${server}\n${index}`

    expect(source).toContain("createOpenCorvusClient")
    expect(source).toContain("createOpenCorvusServer")
    expect(source).toContain("createOpenCorvus")
    expect(source).toContain("OpenCorvusClient")
    expect(source).not.toContain("OpencodeClient")
    expect(source).not.toContain("createOpencode")
  })

  test(
    "production code no longer imports deprecated SDK symbols",
    () => {
      const files = [...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "script"))]
      const deprecated =
        /\b(OpencodeClient|OpencodeClientConfig|createOpencodeClient|createOpencodeServer|createOpencode)\b/
      const offenders = files
        .filter((file) => !file.endsWith(path.join("script", "check-sdk-imports.ts")))
        .filter((file) => deprecated.test(readFileSync(file, "utf8")))
        .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))

      expect(offenders).toEqual([])
    },
    { timeout: 20_000 },
  )

  test("sdk import guard checks deprecated symbols directly", () => {
    const guard = readRepoFile("script", "check-sdk-imports.ts")
    expect(guard).toContain('"OpencodeClient"')
    expect(guard).toContain("symbolPattern")
    expect(guard).toContain("packages/*/src/**/*")
    expect(guard).toContain("packages/*/script/**/*")
    expect(guard).not.toContain("packages/**/*")
    expect(guard).not.toContain('const bad = "@opencorvus-ai/sdk"')
    expect(guard).not.toContain('const good = "@opencorvus-ai/sdk"')
  })

  test("browser preview SDK requires persisted target IDs for select and capture", () => {
    const sdk = readRepoFile("packages", "sdk", "js", "src", "gen", "sdk.gen.ts")
    const types = readRepoFile("packages", "sdk", "js", "src", "gen", "types.gen.ts")
    const openapi = JSON.parse(readRepoFile("packages", "sdk", "openapi.json")) as {
      paths: Record<
        string,
        Record<
          string,
          { requestBody?: { required?: boolean; content?: { "application/json"?: { schema?: { required?: string[] } } } } }
        >
      >
    }
    const captureSchema =
      openapi.paths["/task/{taskID}/browser-preview/capture"]?.post?.requestBody?.content?.["application/json"]
        ?.schema

    expect(
      openapi.paths["/task/{taskID}/browser-preview/target"]?.put?.requestBody?.required,
    ).toBe(true)
    expect(
      openapi.paths["/task/{taskID}/browser-preview/capture"]?.post?.requestBody?.required,
    ).toBe(true)
    expect(captureSchema?.required).toContain("targetID")
    expect(captureSchema?.required).toContain("viewportIDs")
    expect(sdk).not.toContain("targetID?: string")
    expect(sdk).not.toContain('viewportID?: "desktop" | "tablet" | "mobile"')
    expect(sdk).not.toContain('viewportID: "desktop" | "tablet" | "mobile"')
    expect(sdk).toContain("targetID: string")
    expect(sdk).toContain('viewportIDs: Array<"desktop" | "tablet" | "mobile">')
    expect(types).toContain("export type BrowserPreviewSelectTaskTargetData = {\n  body: {")
    expect(types).toContain("export type BrowserPreviewCaptureTaskTargetData = {\n  body: {")
    expect(types).toContain('viewportIDs: Array<"desktop" | "tablet" | "mobile">')
  })
})
