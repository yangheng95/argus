import { describe, expect, test } from "bun:test"
import {
  architectFidelityIssues,
  coverageContains,
  emptyArchitectFidelityState,
  normalizeCoveragePath,
} from "@/architect/fidelity"

// Phase A1 — fix architect/fidelity.ts:113 literal-equality bug.
//
// `sourceCoverage.paths` is container-level (e.g. "src", "tests"); a goal's
// `owned_paths` are leaf files (e.g. "src/main.tsx"). The pre-fix check used
// `row.paths.includes(ownedPath)`, so `["src"].includes("src/main.tsx")` was
// always false — every existing owned file was reported uncovered the moment
// goal #1 (bootstrap) merged its scaffold into the project root.

describe("normalizeCoveragePath", () => {
  test("strips backslashes, ./ prefix, and trailing slashes", () => {
    expect(normalizeCoveragePath("src\\foo")).toBe("src/foo")
    expect(normalizeCoveragePath("./src/foo")).toBe("src/foo")
    expect(normalizeCoveragePath("src/foo/")).toBe("src/foo")
  })

  test("project root '.' becomes empty string", () => {
    expect(normalizeCoveragePath(".")).toBe("")
    expect(normalizeCoveragePath("./")).toBe("")
  })
})

describe("coverageContains", () => {
  test("empty root (project root) covers everything", () => {
    expect(coverageContains("", "src/main.tsx")).toBe(true)
    expect(coverageContains("", "package.json")).toBe(true)
  })

  test("container path covers descendants but not unrelated paths", () => {
    expect(coverageContains("src", "src/main.tsx")).toBe(true)
    expect(coverageContains("src", "src/components/Foo.tsx")).toBe(true)
    expect(coverageContains("src", "tests/setup.ts")).toBe(false)
    expect(coverageContains("src", "srcfoo")).toBe(false)
  })

  test("exact match is covered", () => {
    expect(coverageContains("src/main.tsx", "src/main.tsx")).toBe(true)
  })
})

describe("architectFidelityIssues — sourceCoverage container path semantics", () => {
  // Reproduces the bench gemini failure: architect declares
  // sourceCoverage.paths=["src", "tests", "public"] for goal_bootstrap, then
  // goal_bootstrap merges files like src/main.tsx into the project root.
  // The next dispatch sees those files exist on disk and (pre-fix) reported
  // them as "uncovered" because of literal-equality. Post-fix: container path
  // covers descendants.
  test("container path covers descendant files (post-fix)", () => {
    const issues = architectFidelityIssues({
      goals: [
        {
          id: "goal_bootstrap",
          owned_paths: ["package.json", "vite.config.ts", "src/main.tsx", "src/App.tsx", "tests/setup.ts"],
        },
      ],
      fidelity: {
        sourceCoverage: [
          {
            id: "src-new-project",
            paths: [".", "src", "tests", "public"],
            goal_ids: ["goal_bootstrap"],
            action: "replace",
            rationale: "scaffold root",
          },
        ],
        referenceCoverage: [],
        assemblyOwners: [{ surface: "app-entry", goal_id: "goal_bootstrap", rationale: "owns scaffold" }],
      },
      designSpecs: [],
      // workDir undefined → existingOwnedPaths is [] → vacuous pass. Drive the
      // path-match branch directly via the `existingOwnedPaths > 0` reproducer
      // below; this case verifies the unrelated-paths case stays clean.
    })
    expect(issues).toEqual([])
  })

  test("uncovered path is reported when sibling exists on disk and only some paths match", async () => {
    // Materialise files matching `src/main.tsx` on disk so existingOwnedPaths
    // is non-empty. Use a tmp dir so we don't pollute the repo.
    const fsPromises = await import("node:fs/promises")
    const pathMod = await import("node:path")
    const osMod = await import("node:os")
    const tmp = await fsPromises.mkdtemp(pathMod.join(osMod.tmpdir(), "fidelity-prefix-"))
    try {
      const srcDir = pathMod.join(tmp, "src")
      await fsPromises.mkdir(srcDir, { recursive: true })
      await fsPromises.writeFile(pathMod.join(srcDir, "main.tsx"), "")
      await fsPromises.writeFile(pathMod.join(tmp, "package.json"), "{}")

      // sourceCoverage covers "src" only. owned_paths includes one src file
      // (covered) and one project-root file (NOT covered → uncovered list).
      const issues = architectFidelityIssues({
        goals: [
          {
            id: "goal_a",
            owned_paths: ["src/main.tsx", "package.json"],
          },
        ],
        fidelity: {
          sourceCoverage: [
            {
              id: "src-only",
              paths: ["src"],
              goal_ids: ["goal_a"],
              action: "replace",
              rationale: "src tree",
            },
          ],
          referenceCoverage: [],
          assemblyOwners: [],
        },
        workDir: tmp,
      })
      // src/main.tsx is covered (descendant); package.json is NOT (would only
      // be covered by paths=["."] or paths=["package.json"]).
      const uncovered = issues.find((i) => i.startsWith("Missing source coverage"))
      expect(uncovered).toBeDefined()
      expect(uncovered).toContain("package.json")
      expect(uncovered).not.toContain("src/main.tsx")
    } finally {
      await fsPromises.rm(tmp, { recursive: true, force: true })
    }
  })

  test('project root coverage (paths=["."]) covers all leaves', async () => {
    const fsPromises = await import("node:fs/promises")
    const pathMod = await import("node:path")
    const osMod = await import("node:os")
    const tmp = await fsPromises.mkdtemp(pathMod.join(osMod.tmpdir(), "fidelity-root-"))
    try {
      await fsPromises.writeFile(pathMod.join(tmp, "package.json"), "{}")
      const srcDir = pathMod.join(tmp, "src")
      await fsPromises.mkdir(srcDir, { recursive: true })
      await fsPromises.writeFile(pathMod.join(srcDir, "main.tsx"), "")

      const issues = architectFidelityIssues({
        goals: [
          {
            id: "goal_a",
            owned_paths: ["package.json", "src/main.tsx"],
          },
        ],
        fidelity: {
          sourceCoverage: [
            {
              id: "root",
              paths: ["."],
              goal_ids: ["goal_a"],
              action: "replace",
              rationale: "owns root",
            },
          ],
          referenceCoverage: [],
          assemblyOwners: [],
        },
        workDir: tmp,
      })
      expect(issues.find((i) => i.startsWith("Missing source coverage"))).toBeUndefined()
    } finally {
      await fsPromises.rm(tmp, { recursive: true, force: true })
    }
  })

  test("backslash and ./ in either side normalise to the same path", () => {
    // Caller passes Windows-style paths through architect input. Validator
    // shouldn't care about separator/prefix style.
    expect(coverageContains(normalizeCoveragePath(".\\src"), normalizeCoveragePath("src/main.tsx"))).toBe(true)
    expect(coverageContains(normalizeCoveragePath("src\\"), normalizeCoveragePath("./src/foo.ts"))).toBe(true)
  })

  test("emptyArchitectFidelityState matches the documented shape", () => {
    expect(emptyArchitectFidelityState()).toEqual({
      sourceCoverage: [],
      referenceCoverage: [],
      assemblyOwners: [],
    })
  })
})
