import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  SECRET_PATTERNS,
  parseGitIndexEntries,
  parseGitIndexPaths,
  parseGitTreeEntries,
  parsePrePushLocalRefs,
  scan,
} from "../../../script/secret-scan"

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

  function runGit(args: string[]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
    }
  }

  function gitOutput(args: string[]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
    }
    return result.stdout.trim()
  }

  function initGitRepo() {
    runGit(["init"])
    runGit(["config", "user.email", "secret-scan@example.test"])
    runGit(["config", "user.name", "Secret Scan Test"])
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

  test("default scan reads committed index content instead of unstaged worktree cleanup", () => {
    initGitRepo()
    write("src/secret.ts", `export const key = "sk-DDDDDDDDDDDDDDDDDDDDDD"`) // secret-scan: ignore
    runGit(["add", "src/secret.ts"])
    runGit(["commit", "-m", "commit secret fixture"])
    write("src/secret.ts", "export const key = undefined\n")

    const hits = scan({ repoRoot: root })

    expect(hits.map((hit) => [hit.file, hit.patternId])).toEqual([["src/secret.ts", "openai-style"]])
  })

  test("default scan reads staged index content instead of unstaged worktree cleanup", () => {
    initGitRepo()
    write("src/secret.ts", "export const key = undefined\n")
    runGit(["add", "src/secret.ts"])
    runGit(["commit", "-m", "commit clean fixture"])
    write("src/secret.ts", `export const key = "sk-EEEEEEEEEEEEEEEEEEEEEE"`) // secret-scan: ignore
    runGit(["add", "src/secret.ts"])
    write("src/secret.ts", "export const key = undefined\n")

    const hits = scan({ repoRoot: root })

    expect(hits.map((hit) => [hit.file, hit.patternId])).toEqual([["src/secret.ts", "openai-style"]])
  })

  test("default scan uses real blob sizes for cacheinfo-staged blobs", () => {
    initGitRepo()
    const body = "x".repeat(900 * 1024)
    for (let i = 0; i < 12; i++) {
      const hashed = spawnSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: root,
        input: body,
        encoding: "utf8",
      })
      if (hashed.error) throw hashed.error
      if (hashed.status !== 0) throw new Error(`git hash-object failed: ${hashed.stderr}`)
      runGit(["update-index", "--add", "--cacheinfo", "100644", hashed.stdout.trim(), `src/cache-${i}.ts`])
    }

    const hits = scan({ repoRoot: root })

    expect(hits).toHaveLength(0)
  })

  test("default scan reads HEAD content when index cleanup hides a committed secret", () => {
    initGitRepo()
    write("src/secret.ts", `export const key = "sk-FFFFFFFFFFFFFFFFFFFFFF"`) // secret-scan: ignore
    runGit(["add", "src/secret.ts"])
    runGit(["commit", "-m", "commit secret fixture"])
    write("src/secret.ts", "export const key = undefined\n")
    runGit(["add", "src/secret.ts"])

    const hits = scan({ repoRoot: root })

    expect(hits.map((hit) => [hit.file, hit.patternId])).toEqual([["src/secret.ts", "openai-style"]])
  })

  test("pre-push local ref scan reads the pushed commit when worktree and index are clean", () => {
    initGitRepo()
    write("src/secret.ts", `export const key = "sk-GGGGGGGGGGGGGGGGGGGGGG"`) // secret-scan: ignore
    runGit(["add", "src/secret.ts"])
    runGit(["commit", "-m", "commit secret fixture"])
    const secretCommit = gitOutput(["rev-parse", "HEAD"])
    write("src/secret.ts", "export const key = undefined\n")
    runGit(["add", "src/secret.ts"])
    runGit(["commit", "-m", "commit clean fixture"])

    const refs = parsePrePushLocalRefs(
      `refs/heads/main ${secretCommit} refs/heads/main 0000000000000000000000000000000000000000\n`,
    )
    const hits = scan({ repoRoot: root, refs })

    expect(hits.map((hit) => [hit.file, hit.patternId])).toEqual([["src/secret.ts", "openai-style"]])
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
  function indexBuffer(
    entries: Array<
      | string
      | {
          path: string
          objectId?: string
          size?: number
          mode?: number
          stage?: number
        }
    >,
  ) {
    const header = Buffer.alloc(12)
    header.write("DIRC", 0, "ascii")
    header.writeUInt32BE(2, 4)
    header.writeUInt32BE(entries.length, 8)
    const encodedEntries = entries.map((entry) => {
      const rel = typeof entry === "string" ? entry : entry.path
      const encoded = Buffer.from(rel, "utf8")
      const fixed = Buffer.alloc(62)
      const objectId =
        typeof entry === "string"
          ? "0000000000000000000000000000000000000000"
          : (entry.objectId ?? "0000000000000000000000000000000000000000")
      fixed.writeUInt32BE(typeof entry === "string" ? 0o100644 : (entry.mode ?? 0o100644), 24)
      fixed.writeUInt32BE(typeof entry === "string" ? encoded.length : (entry.size ?? encoded.length), 36)
      Buffer.from(objectId, "hex").copy(fixed, 40)
      const stage = typeof entry === "string" ? 0 : (entry.stage ?? 0)
      fixed.writeUInt16BE((stage << 12) | Math.min(encoded.length, 0xfff), 60)
      const rawLength = fixed.length + encoded.length + 1
      const padding = (8 - (rawLength % 8)) % 8
      return Buffer.concat([fixed, encoded, Buffer.alloc(1 + padding)])
    })
    return Buffer.concat([header, ...encodedEntries, Buffer.alloc(20)])
  }

  test("reads tracked paths from a v2 git index without spawning git", () => {
    expect(parseGitIndexPaths(indexBuffer(["src/index.ts", "docs/readme.md"]))).toEqual([
      "src/index.ts",
      "docs/readme.md",
    ])
  })

  test("reads blob metadata from v2 git index entries", () => {
    const objectId = "1234567890abcdef1234567890abcdef12345678"
    expect(
      parseGitIndexEntries(indexBuffer([{ path: "src/index.ts", objectId, size: 42, mode: 0o100755, stage: 0 }])),
    ).toEqual([{ file: "src/index.ts", objectId, size: 42, mode: 0o100755, stage: 0 }])
  })

  test("rejects unsupported git index versions loudly", () => {
    const data = indexBuffer(["src/index.ts"])
    data.writeUInt32BE(4, 4)
    expect(() => parseGitIndexPaths(data)).toThrow("unsupported git index version 4")
  })
})

describe("parseGitTreeEntries", () => {
  test("reads blob metadata from nul-delimited ls-tree output", () => {
    const data = Buffer.from(
      [
        "100644 blob 1234567890abcdef1234567890abcdef12345678      42\tsrc/index.ts",
        "040000 tree 2222222222222222222222222222222222222222       -\tsrc",
        "",
      ].join("\0"),
      "utf8",
    )

    expect(parseGitTreeEntries(data)).toEqual([
      {
        file: "src/index.ts",
        objectId: "1234567890abcdef1234567890abcdef12345678",
        size: 42,
        mode: 0o100644,
        stage: 0,
      },
    ])
  })
})

describe("parsePrePushLocalRefs", () => {
  test("deduplicates pushed local object ids and skips deleted refs", () => {
    expect(
      parsePrePushLocalRefs(
        [
          "refs/heads/main 1234567890abcdef1234567890abcdef12345678 refs/heads/main 0000000000000000000000000000000000000000",
          "refs/heads/again 1234567890abcdef1234567890abcdef12345678 refs/heads/again 1111111111111111111111111111111111111111",
          "refs/heads/deleted 0000000000000000000000000000000000000000 refs/heads/deleted 2222222222222222222222222222222222222222",
          "",
        ].join("\n"),
      ),
    ).toEqual(["1234567890abcdef1234567890abcdef12345678"])
  })

  test("rejects malformed pre-push ref lines loudly", () => {
    expect(() => parsePrePushLocalRefs("refs/heads/main\n")).toThrow("invalid pre-push ref line")
  })
})
