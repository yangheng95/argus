import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { linkContracts } from "@/architect/linker"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function tempWorkDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-linker-"))
  tempDirs.push(dir)
  return dir
}

describe("architect contract linker", () => {
  test("emits unresolved_symbol when an imported symbol has no ContractIR", () => {
    const result = linkContracts({
      workDir: process.cwd(),
      sourceCoverage: [],
      contracts: [],
      goals: [
        { id: "goal_a", depends_on: [], exports: ["Stock"], imports: [] },
        { id: "goal_b", depends_on: ["goal_a"], exports: [], imports: ["Stock"] },
      ],
    })

    expect(result.issues).toContainEqual(expect.objectContaining({
      kind: "unresolved_symbol",
      goalID: "goal_b",
      symbol: "Stock",
    }))
  })

  test("extracts a reused TSX interface with a literal union field", async () => {
    const workDir = await tempWorkDir()
    await fs.mkdir(path.join(workDir, "src"), { recursive: true })
    await fs.writeFile(
      path.join(workDir, "src", "MyComponent.tsx"),
      [
        "export interface Props {",
        "  foo: 'a' | 'b'",
        "  count: number",
        "}",
        "",
      ].join("\n"),
    )

    const result = linkContracts({
      workDir,
      sourceCoverage: [{
        id: "reuse_component",
        paths: ["src/MyComponent.tsx"],
        goal_ids: ["goal_consumer"],
        action: "reuse",
        rationale: "Consumer reuses the existing component props.",
      }],
      contracts: [],
      goals: [
        { id: "goal_consumer", depends_on: [], exports: [], imports: ["Props from src/MyComponent.tsx"] },
      ],
    })

    expect(result.issues).toEqual([])
    const props = result.index.get("Props")
    expect(props?.kind).toBe("type")
    if (props?.kind !== "type") throw new Error("Props was not extracted as a type contract")
    expect(props.fields.find((field) => field.name === "foo")?.valueDomain).toEqual({
      kind: "literal_union",
      values: ["a", "b"],
    })
  })

  test("detects dependency cycles", () => {
    const result = linkContracts({
      workDir: process.cwd(),
      sourceCoverage: [],
      contracts: [],
      goals: [
        { id: "goal_a", depends_on: ["goal_b"], exports: [], imports: [] },
        { id: "goal_b", depends_on: ["goal_a"], exports: [], imports: [] },
      ],
    })

    expect(result.issues).toContainEqual(expect.objectContaining({
      kind: "dependency_cycle",
    }))
  })
})
