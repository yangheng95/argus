import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Discovery } from "../../src/skill/discovery"
import { Filesystem } from "../../src/util/filesystem"
import { rm } from "fs/promises"
import path from "path"

let CLOUDFLARE_SKILLS_URL: string
let server: ReturnType<typeof Bun.serve>
let downloadCount = 0

const fixturePath = path.join(import.meta.dir, "../fixture/skills")

beforeAll(async () => {
  await rm(Discovery.dir(), { recursive: true, force: true })

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)

      // route /.well-known/skills/* to the fixture directory
      if (url.pathname.startsWith("/.well-known/skills/")) {
        const filePath = url.pathname.replace("/.well-known/skills/", "")
        const fullPath = path.join(fixturePath, filePath)

        if (await Filesystem.exists(fullPath)) {
          if (!fullPath.endsWith("index.json")) {
            downloadCount++
          }
          return new Response(Bun.file(fullPath))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  CLOUDFLARE_SKILLS_URL = `http://localhost:${server.port}/.well-known/skills/`
})

afterAll(async () => {
  server?.stop()
  await rm(Discovery.dir(), { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  test("downloads skills from cloudflare url", async () => {
    const dirs = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(dir).toStartWith(Discovery.dir())
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("url without trailing slash works", async () => {
    const dirs = await Discovery.pull(CLOUDFLARE_SKILLS_URL.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("returns empty array for invalid url", async () => {
    const dirs = await Discovery.pull(`http://localhost:${server.port}/invalid-url/`)
    expect(dirs).toEqual([])
  })

  test("returns empty array for non-json response", async () => {
    // any url not explicitly handled in server returns 404 text "Not Found"
    const dirs = await Discovery.pull(`http://localhost:${server.port}/some-other-path/`)
    expect(dirs).toEqual([])
  })

  test("downloads reference files alongside SKILL.md", async () => {
    const dirs = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    // find a skill dir that should have reference files (e.g. agents-sdk)
    const agentsSdk = dirs.find((d) => d.endsWith(path.sep + "agents-sdk"))
    expect(agentsSdk).toBeDefined()
    if (agentsSdk) {
      const refs = path.join(agentsSdk, "references")
      expect(await Filesystem.exists(path.join(agentsSdk, "SKILL.md"))).toBe(true)
      // agents-sdk has reference files per the index
      const refDir = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
      expect(refDir.length).toBeGreaterThan(0)
    }
  })

  test("rejects traversal entries without writing outside discovery cache", async () => {
    await rm(Discovery.dir(), { recursive: true, force: true })

    const escapedSkillDir = path.resolve(Discovery.dir(), "..", "escaped-skill")
    const escapedFile = path.resolve(Discovery.dir(), "..", "escape.txt")
    const safeSkillDir = path.join(Discovery.dir(), "safe")
    await rm(escapedSkillDir, { recursive: true, force: true })
    await rm(escapedFile, { force: true })
    await rm(safeSkillDir, { recursive: true, force: true })

    const malicious = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/skills/index.json") {
          return Response.json({
            skills: [
              { name: "../escaped-skill", description: "Escapes by name", files: ["SKILL.md"] },
              { name: "safe", description: "Escapes by file path", files: ["SKILL.md", "../escape.txt"] },
            ],
          })
        }
        if (url.pathname.endsWith("SKILL.md")) {
          return new Response("---\nname: escaped\ndescription: traversal\n---\n")
        }
        if (url.pathname.endsWith("escape.txt")) {
          return new Response("escaped\n")
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    try {
      await expect(Discovery.pull(`http://localhost:${malicious.port}/skills/`)).rejects.toThrow(
        "Unsafe skill discovery path",
      )
      expect(await Filesystem.exists(path.join(escapedSkillDir, "SKILL.md"))).toBe(false)
      expect(await Filesystem.exists(escapedFile)).toBe(false)
      expect(await Filesystem.exists(path.join(safeSkillDir, "SKILL.md"))).toBe(false)
    } finally {
      malicious.stop()
      await rm(escapedSkillDir, { recursive: true, force: true })
      await rm(escapedFile, { force: true })
      await rm(safeSkillDir, { recursive: true, force: true })
    }
  })

  test("rejects traversal file paths without writing partial skill files", async () => {
    await rm(Discovery.dir(), { recursive: true, force: true })

    const escapedFile = path.resolve(Discovery.dir(), "..", "file-escape.txt")
    const safeSkillDir = path.join(Discovery.dir(), "safe")
    await rm(escapedFile, { force: true })
    await rm(safeSkillDir, { recursive: true, force: true })

    const malicious = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/skills/index.json") {
          return Response.json({
            skills: [{ name: "safe", description: "Escapes by file path", files: ["SKILL.md", "../file-escape.txt"] }],
          })
        }
        if (url.pathname.endsWith("SKILL.md")) {
          return new Response("---\nname: safe\ndescription: safe\n---\n")
        }
        if (url.pathname.endsWith("file-escape.txt")) {
          return new Response("escaped\n")
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    try {
      await expect(Discovery.pull(`http://localhost:${malicious.port}/skills/`)).rejects.toThrow(
        "Unsafe skill discovery path",
      )
      expect(await Filesystem.exists(escapedFile)).toBe(false)
      expect(await Filesystem.exists(path.join(safeSkillDir, "SKILL.md"))).toBe(false)
    } finally {
      malicious.stop()
      await rm(escapedFile, { force: true })
      await rm(safeSkillDir, { recursive: true, force: true })
    }
  })

  test("rejects url-like file paths before requesting skill files", async () => {
    await rm(Discovery.dir(), { recursive: true, force: true })

    const safeSkillDir = path.join(Discovery.dir(), "safe")
    await rm(safeSkillDir, { recursive: true, force: true })
    const requests: string[] = []

    const malicious = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        requests.push(url.pathname)
        if (url.pathname === "/skills/index.json") {
          return Response.json({
            skills: [
              {
                name: "safe",
                description: "URL-like file path",
                files: ["SKILL.md", "https://attacker.invalid/SKILL.md"],
              },
            ],
          })
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    try {
      await expect(Discovery.pull(`http://localhost:${malicious.port}/skills/`)).rejects.toThrow(
        "Unsafe skill discovery path",
      )
      expect(requests).toEqual(["/skills/index.json"])
      expect(await Filesystem.exists(path.join(safeSkillDir, "SKILL.md"))).toBe(false)
    } finally {
      malicious.stop()
      await rm(safeSkillDir, { recursive: true, force: true })
    }
  })

  test("rejects backslash file paths before requesting skill files", async () => {
    await rm(Discovery.dir(), { recursive: true, force: true })

    const safeSkillDir = path.join(Discovery.dir(), "safe")
    const requests: string[] = []

    const malicious = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        requests.push(url.pathname)
        if (url.pathname === "/skills/index.json") {
          return Response.json({
            skills: [{ name: "safe", description: "Backslash file path", files: ["SKILL.md", "..\\escape.txt"] }],
          })
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    try {
      await expect(Discovery.pull(`http://localhost:${malicious.port}/skills/`)).rejects.toThrow(
        "Unsafe skill discovery path",
      )
      expect(requests).toEqual(["/skills/index.json"])
      expect(await Filesystem.exists(path.join(safeSkillDir, "SKILL.md"))).toBe(false)
    } finally {
      malicious.stop()
      await rm(safeSkillDir, { recursive: true, force: true })
    }
  })

  test("caches downloaded files on second pull", async () => {
    // clear dir and downloadCount
    await rm(Discovery.dir(), { recursive: true, force: true })
    downloadCount = 0

    // first pull to populate cache
    const first = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    expect(first.length).toBeGreaterThan(0)
    const firstCount = downloadCount
    expect(firstCount).toBeGreaterThan(0)

    // second pull should return same results from cache
    const second = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    expect(second.length).toBe(first.length)
    expect(second.sort()).toEqual(first.sort())

    // second pull should NOT increment download count
    expect(downloadCount).toBe(firstCount)
  })
})
