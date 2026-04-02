import { describe, expect, test } from "bun:test"
import { parseDecomposeText, type DecomposeOutput, type ParsedGoalContract, type DecomposeDecision } from "../../src/decompose/parse"
import type { GoalContractFields } from "../../src/pipeline/types"

describe("DecomposeAgent", () => {
  describe("parseDecomposeText", () => {
    test("parses complete output with summary, decisions, and goals", () => {
      const text = `
Some preamble text...

<summary>Implement stock portfolio API with 3 goals</summary>

<decisions>
- key: runtime
  value: Bun
  reason: package.json uses bun scripts

- key: test_framework
  value: bun:test
  reason: existing tests use bun:test
</decisions>

<goals>
- id: goal_types
  title: Shared types
  objective: Define Stock and Portfolio types
  done_definition: Types compile and are importable
  owned_paths: src/types/stock.ts, src/types/index.ts
  depends_on:
  exports: type Stock = { id: string; name: string; price: number }
  imports:
  priority: blocking
  kind: bootstrap
  requirement_ids:

- id: goal_api
  title: Stock API
  objective: Implement GET /api/stocks endpoint
  done_definition: Returns JSON array of stocks, passes integration test
  owned_paths: src/routes/stocks.ts, test/stocks.test.ts
  depends_on: goal_types
  exports: GET /api/stocks → Stock[]
  imports: type Stock (from goal_types)
  priority: blocking
  kind: feature
  requirement_ids: REQ-1, REQ-2
</goals>
`
      const result = parseDecomposeText(text)

      // Summary
      expect(result.summary).toBe("Implement stock portfolio API with 3 goals")

      // Decisions
      expect(result.decisions).toHaveLength(2)
      expect(result.decisions[0]).toEqual({
        key: "runtime",
        value: "Bun",
        reason: "package.json uses bun scripts",
      })
      expect(result.decisions[1]).toEqual({
        key: "test_framework",
        value: "bun:test",
        reason: "existing tests use bun:test",
      })

      // Goals
      expect(result.goals).toHaveLength(2)

      const types = result.goals[0]
      expect(types.id).toBe("goal_types")
      expect(types.title).toBe("Shared types")
      expect(types.kind).toBe("bootstrap")
      expect(types.owned_paths).toEqual(["src/types/stock.ts", "src/types/index.ts"])
      expect(types.depends_on).toEqual([])
      expect(types.exports).toEqual(["type Stock = { id: string; name: string; price: number }"])
      expect(types.imports).toEqual([])
      expect(types.requirement_ids).toEqual([])
      expect(types.source).toBe("implicit")

      const api = result.goals[1]
      expect(api.id).toBe("goal_api")
      expect(api.title).toBe("Stock API")
      expect(api.depends_on).toEqual(["goal_types"])
      expect(api.exports).toEqual(["GET /api/stocks → Stock[]"])
      expect(api.imports).toEqual(["type Stock (from goal_types)"])
      expect(api.requirement_ids).toEqual(["REQ-1", "REQ-2"])
      expect(api.source).toBe("explicit")
      expect(api.priority).toBe("blocking")
    })

    test("handles empty output", () => {
      const result = parseDecomposeText("")
      expect(result.summary).toBe("")
      expect(result.decisions).toEqual([])
      expect(result.goals).toEqual([])
    })

    test("handles output with no decisions section", () => {
      const text = `
<summary>Simple fix</summary>
<goals>
- id: goal_fix
  title: Fix bug
  objective: Fix the null pointer in parser
  done_definition: Tests pass
  owned_paths: src/parser.ts
  depends_on:
  exports:
  imports:
  priority: blocking
  kind: feature
  requirement_ids: REQ-1
</goals>`
      const result = parseDecomposeText(text)
      expect(result.summary).toBe("Simple fix")
      expect(result.decisions).toEqual([])
      expect(result.goals).toHaveLength(1)
      expect(result.goals[0].id).toBe("goal_fix")
    })

    test("infers source from requirement_ids presence", () => {
      const text = `
<summary>Test</summary>
<goals>
- id: goal_explicit
  title: Feature
  objective: Do something
  done_definition: It works
  owned_paths: src/a.ts
  depends_on:
  exports:
  imports:
  priority: blocking
  kind: feature
  requirement_ids: REQ-1

- id: goal_implicit
  title: Bootstrap
  objective: Set up types
  done_definition: Types compile
  owned_paths: src/types.ts
  depends_on:
  exports:
  imports:
  priority: blocking
  kind: bootstrap
  requirement_ids:
</goals>`
      const result = parseDecomposeText(text)
      expect(result.goals[0].source).toBe("explicit")
      expect(result.goals[1].source).toBe("implicit")
    })

    test("handles depends_on_goal_ids alias", () => {
      const text = `
<summary>Test</summary>
<goals>
- id: goal_a
  title: A
  objective: Do A
  done_definition: A done
  owned_paths: src/a.ts
  depends_on_goal_ids: goal_b, goal_c
  exports:
  imports:
  priority: blocking
  kind: feature
  requirement_ids:
</goals>`
      const result = parseDecomposeText(text)
      expect(result.goals[0].depends_on).toEqual(["goal_b", "goal_c"])
    })
  })

  describe("GoalContractFields compatibility", () => {
    test("ParsedGoalContract maps to GoalContractFields", () => {
      const parsed: ParsedGoalContract = {
        id: "goal_1",
        title: "Test goal",
        objective: "Test objective",
        done_definition: "Tests pass",
        owned_paths: ["src/test.ts"],
        depends_on: [],
        exports: ["function doThing(): void"],
        imports: [],
        priority: "blocking",
        kind: "feature",
        requirement_ids: ["REQ-1"],
        source: "explicit",
      }

      // Should be assignable to GoalContractFields (compile-time check)
      const contract: GoalContractFields = {
        id: parsed.id,
        title: parsed.title,
        objective: parsed.objective,
        done_definition: parsed.done_definition,
        owned_paths: parsed.owned_paths,
        depends_on: parsed.depends_on,
        exports: parsed.exports,
        imports: parsed.imports,
        priority: parsed.priority,
        kind: parsed.kind,
        requirement_ids: parsed.requirement_ids,
      }
      expect(contract.id).toBe("goal_1")
      expect(contract.exports).toEqual(["function doThing(): void"])
    })

    test("GoalContractFields has all required fields", () => {
      // Type-level check: if GoalContractFields changes, this test will fail to compile
      const fields: GoalContractFields = {
        id: "test",
        title: "test",
        objective: "test",
        done_definition: "test",
        owned_paths: [],
        depends_on: [],
        exports: [],
        imports: [],
        priority: "blocking",
        kind: "feature",
        requirement_ids: [],
      }
      expect(Object.keys(fields)).toHaveLength(11)
    })
  })

  describe("DecomposeResult shape", () => {
    test("DecomposeResult exports match expected interface", async () => {
      const mod = await import("../../src/decompose/agent")
      expect(typeof mod.DecomposeAgent.decompose).toBe("function")
    })

    test("DecomposeService exports match expected interface", async () => {
      const mod = await import("../../src/decompose/service")
      expect(typeof mod.DecomposeService.decompose).toBe("function")
      expect(typeof mod.DecomposeService.redecompose).toBe("function")
      expect(mod.DecomposeFailureError).toBeDefined()
    })

    test("index re-exports all public API", async () => {
      const mod = await import("../../src/decompose/index")
      expect(mod.DecomposeAgent).toBeDefined()
      expect(mod.DecomposeService).toBeDefined()
      expect(mod.DecomposeFailureError).toBeDefined()
      expect(mod.parseDecomposeText).toBeDefined()
    })
  })
})
