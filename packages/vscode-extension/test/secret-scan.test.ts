import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SECRET_PATTERNS, parseGitIndexPaths, scan } from "../../../script/secret-scan"

/**
 * Regression for the historical leak that triggered this guard:
 * commit 9d56d9aec removed the embedded `sk-eq7WQu0ylelH6uyedbf6PA` // secret-scan: ignore
 * Hexin key from source. The key was burned (revocable at provider
 * only — git history is public). This scanner exists so a re-leak of
 * the same SHAPE is caught at pre-push time, not after.
 *
 * Tests fixture each pattern in an isolated tmp repo to avoid relying
 * on `git ls-files` from the live repo (which would couple the test
 * to whatever happens to be on disk).
 */

describe("scan", () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-"))
  })
  afterEach(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {}
  })

  function write(rel: string, body: string) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }

  test("zero hits on a clean tree", () => {
    write("src/index.ts", "export const ok = true\nconsole.log('hello world')")
    write("README.md", "# OpenCorvus\n\nA project.")
    const hits = scan({ repoRoot: root, files: ["src/index.ts", "README.md"] })
    expect(hits).toHaveLength(0)
  })

  test("flags the historical Hexin-shape key", () => {
    write("src/leak.ts", `const k = "sk-eq7WQu0ylelH6uyedbf6PA"`) // secret-scan: ignore
    const hits = scan({ repoRoot: root, files: ["src/leak.ts"] })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]!.patternId).toBe("openai-style")
    expect(hits[0]!.lineNumber).toBe(1)
    expect(hits[0]!.match).toContain("sk-eq7WQu0ylel")
  })

  test("scans env example files with compound suffixes", () => {
    write(".env.example", "OPENAI_API_KEY=sk-BBBBBBBBBBBBBBBBBBBBBB") // secret-scan: ignore
    write("config/app.env.example", "OPENAI_API_KEY=sk-AAAAAAAAAAAAAAAAAAAAAA") // secret-scan: ignore
    write("config/notes.example", "OPENAI_API_KEY=sk-CCCCCCCCCCCCCCCCCCCCCC") // secret-scan: ignore
    const hits = scan({ repoRoot: root, files: [".env.example", "config/app.env.example", "config/notes.example"] })
    expect(hits.map((hit) => [hit.file, hit.patternId])).toEqual([
      [".env.example", "openai-style"],
      ["config/app.env.example", "openai-style"],
    ])
  })

  test("flags GitHub PAT, AWS AKID, Google AIza, Slack token, JWT", () => {
    // Realistic-shape but invalid fixtures. Every line carries the
    // ignore directive so this test file itself can pass through the
    // production scan without flagging.
    write(
      "src/keys.ts",
      [
        `const gh = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`, // secret-scan: ignore
        `const aws = "AKIAIOSFODNN7EXAMPLE"`, // secret-scan: ignore
        `const goog = "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"`, // secret-scan: ignore
        `const slack = "xoxb-1234567890-AAAAAAAAAAAAAAAAAAAA"`, // secret-scan: ignore
        `const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"`, // secret-scan: ignore
      ].join("\n"),
    )
    // Use a no-ignore copy so the scanner actually fires:
    write(
      "src/keys-real.ts",
      [
        `const gh = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`, // secret-scan: ignore
        `const aws = "AKIAIOSFODNN7EXAMPLE"`, // secret-scan: ignore
        `const goog = "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"`, // secret-scan: ignore
        `const slack = "xoxb-1234567890-AAAAAAAAAAAAAAAAAAAA"`, // secret-scan: ignore
        `const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"`, // secret-scan: ignore
      ].join("\n"),
    )
    const hits = scan({ repoRoot: root, files: ["src/keys-real.ts"] })
    const ids = new Set(hits.map((h) => h.patternId))
    expect(ids).toContain("github-pat")
    expect(ids).toContain("aws-akid")
    expect(ids).toContain("google-api")
    expect(ids).toContain("slack-token")
    expect(ids).toContain("jwt")
  })

  test("`secret-scan: ignore` directive suppresses the line", () => {
    write("src/test-fixture.ts", `const fakeKey = "sk-AAAAAAAAAAAAAAAAAAAAAA" // secret-scan: ignore`)
    const hits = scan({ repoRoot: root, files: ["src/test-fixture.ts"] })
    expect(hits).toHaveLength(0)
  })

  test("only scans text-like extensions", () => {
    // Binary file with a fake key inside should NOT be flagged
    // (the scanner skips unknown extensions). This avoids tripping
    // on PNG/JPEG containing accidental key-shaped byte sequences.
    write("media/icon.png", "sk-AAAAAAAAAAAAAAAAAAAAAA fake bytes") // secret-scan: ignore
    const hits = scan({ repoRoot: root, files: ["media/icon.png"] })
    expect(hits).toHaveLength(0)
  })

  test("skips files larger than 1 MiB", () => {
    const big = "x".repeat(1024 * 1024 + 10)
    write("src/big.ts", `const k = "sk-AAAAAAAAAAAAAAAAAAAAAA"\n${big}`) // secret-scan: ignore
    const hits = scan({ repoRoot: root, files: ["src/big.ts"] })
    expect(hits).toHaveLength(0)
  })

  test("SECRET_PATTERNS is the canonical, ordered set", () => {
    // Lock the registered patterns so a future PR that drops a
    // detector is caught at review.
    expect(SECRET_PATTERNS.map((p) => p.id)).toEqual([
      "openai-style",
      "github-pat",
      "aws-akid",
      "google-api",
      "slack-token",
      "jwt",
    ])
  })
})

describe("parseGitIndexPaths", () => {
  function indexBuffer(paths: string[]) {
    const header = Buffer.alloc(12)
    header.write("DIRC", 0, "ascii")
    header.writeUInt32BE(2, 4)
    header.writeUInt32BE(paths.length, 8)
    const entries = paths.map((rel) => {
      const encoded = Buffer.from(rel, "utf8")
      const fixed = Buffer.alloc(62)
      fixed.writeUInt16BE(encoded.length, 60)
      const rawLength = fixed.length + encoded.length + 1
      const padding = (8 - (rawLength % 8)) % 8
      return Buffer.concat([fixed, encoded, Buffer.alloc(1 + padding)])
    })
    return Buffer.concat([header, ...entries, Buffer.alloc(20)])
  }

  test("reads tracked paths from a v2 git index without spawning git", () => {
    expect(parseGitIndexPaths(indexBuffer(["src/index.ts", "docs/readme.md"]))).toEqual([
      "src/index.ts",
      "docs/readme.md",
    ])
  })

  test("rejects unsupported git index versions loudly", () => {
    const data = indexBuffer(["src/index.ts"])
    data.writeUInt32BE(4, 4)
    expect(() => parseGitIndexPaths(data)).toThrow("unsupported git index version 4")
  })
})
