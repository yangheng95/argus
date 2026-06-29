/**
 * Regression guard for the discriminated-union tool-call death loop.
 *
 * Root cause (spec session repair-hint loop record §6, task
 * tsk_e3f3a5e13001sIKjGs1nVHLkBD): architect `register_contract` rejected on
 * `ir.kind` / `ir.fields[].valueDomain.kind`; zod4's `invalid_union` issue
 * carries no legal values, the repair channel returned null, the SDK relayed
 * the opaque JSON verbatim, and the model looped byte-for-byte forever.
 *
 * These tests assert the OLD behaviour is gone (not merely that the new path
 * works): a discriminated-union rejection now yields the legal values pulled
 * live from the tool's own JSON Schema, and the schema/prompt stay in sync so
 * the fix cannot silently rot (rule 8 drift lock, rule 28/36).
 */
import { describe, expect, test } from "bun:test"
import { asSchema, InvalidToolInputError } from "ai"
import z from "zod"
import { readFileSync } from "fs"
import { join } from "path"
import { createArchitectOutputTools } from "@/architect/output-tools"
import { ArchitectContractRefSchema } from "@/architect/contract-graph"
import { ContractIRSchema, ValueDomainSchema } from "@/architect/contract-ir"
import { WalkthroughStepsSchema } from "@/acceptance/checks/walkthrough/dsl"
import { createToolCallRepair, discriminatorRepairHint, zodIssuesFromError } from "@/session/repair-hint"

function registerContractJsonSchema(): Record<string, any> {
  return z.toJSONSchema(ArchitectContractRefSchema as any) as Record<string, any>
}

const baseContract = {
  id: "contract_x",
  kind: "type",
  name: "X",
  producer_goal_id: "g_impl",
  consumer_goal_ids: ["g_int"],
  summary: "X public interface contract for downstream consumers.",
}

function invalidUnionIssue(input: unknown) {
  const parsed = ArchitectContractRefSchema.safeParse(input)
  expect(parsed.success).toBe(false)
  return parsed.error!.issues.find((i: any) => i.code === "invalid_union") as any
}

describe("discriminatorRepairHint — invalid_union self-correction", () => {
  test("ir.kind illegal → enumerates type|function|enum (was: opaque infinite loop)", () => {
    const input = {
      ...baseContract,
      ir: {
        kind: "interface",
        name: "X",
        fields: [{ name: "a", typeExpr: "string", valueDomain: { kind: "open", reason: "r" } }],
      },
    }
    const union = invalidUnionIssue(input)
    expect(union).toBeDefined()
    const hint = discriminatorRepairHint(registerContractJsonSchema(), union, input)
    expect(hint).toBeDefined()
    expect(hint!.values).toEqual(expect.arrayContaining(["type", "function", "enum"]))
    expect(hint!.supplied).toBe("interface")
    expect(hint!.at).toBe("ir.kind")
  })

  test("valueDomain.kind illegal (deep, behind ir anyOf + array) → enumerates all 5 domains", () => {
    const input = {
      ...baseContract,
      ir: {
        kind: "type",
        name: "X",
        fields: [{ name: "a", typeExpr: "string", valueDomain: { kind: "primitive", reason: "r" } }],
      },
    }
    const union = invalidUnionIssue(input)
    const hint = discriminatorRepairHint(registerContractJsonSchema(), union, input)
    expect(hint).toBeDefined()
    expect(hint!.values).toEqual(expect.arrayContaining(["open", "literal_union", "branded", "numeric_range", "ref"]))
    expect(hint!.supplied).toBe("primitive")
    expect(hint!.at).toBe("ir.fields.0.valueDomain.kind")
  })

  test("non-discriminator rejection produces NO invalid_union → repair stays return-null (no over-reach)", () => {
    const input = { ...baseContract, ir: { kind: "type", name: "X", fields: [] } } // fields min(1) violation
    const parsed = ArchitectContractRefSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    expect(parsed.error!.issues.find((i: any) => i.code === "invalid_union")).toBeUndefined()
  })
})

describe("zodIssuesFromError — cause-chain tolerant (SDK minor-version drift)", () => {
  test("extracts issues through a nested cause chain", () => {
    const zodError = ArchitectContractRefSchema.safeParse({
      ...baseContract,
      ir: { kind: "interface", name: "X", fields: [] },
    }).error
    const outer: any = new Error("InvalidToolInputError")
    outer.cause = new Error("TypeValidationError")
    outer.cause.cause = zodError
    const issues = zodIssuesFromError(outer)
    expect(Array.isArray(issues)).toBe(true)
    expect(issues!.some((i: any) => i.code === "invalid_union")).toBe(true)
  })

  test("returns undefined when no ZodError in chain (plain Zod errors keep SDK behaviour)", () => {
    expect(zodIssuesFromError(new Error("plain"))).toBeUndefined()
    expect(zodIssuesFromError(undefined)).toBeUndefined()
  })
})

describe("schema describe is visible to the model (defense-in-depth, rule 6.1)", () => {
  test("register_contract tool exposes provider-stable JSON fields instead of nested objects", () => {
    const architect = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
    const schema = asSchema(architect.tools.register_contract.inputSchema as never).jsonSchema as Record<string, any>
    expect(schema.properties).toHaveProperty("ir_json")
    expect(schema.properties).toHaveProperty("route_json")
    expect(schema.properties).toHaveProperty("component_json")
    expect(schema.properties.component_json.description).toContain("props?: string")
    expect(schema.properties.component_json.description).toContain("not an array")
    expect(schema.properties).not.toHaveProperty("ir")
    expect(schema.properties).not.toHaveProperty("route")
    expect(schema.properties).not.toHaveProperty("component")
  })

  test("every ContractIR / ValueDomain discriminator branch carries a description in JSON Schema", () => {
    const irJs: any = z.toJSONSchema(ContractIRSchema as any)
    expect(Array.isArray(irJs.anyOf)).toBe(true)
    for (const branch of irJs.anyOf) {
      expect(typeof branch.properties.kind.description).toBe("string")
      expect(branch.properties.kind.description.length).toBeGreaterThan(10)
    }
    const vdJs: any = z.toJSONSchema(ValueDomainSchema as any)
    for (const branch of vdJs.anyOf) {
      expect(typeof branch.properties.kind.description).toBe("string")
      expect(branch.properties.kind.description.length).toBeGreaterThan(10)
    }
  })
})

describe("prompt ↔ schema single-source consistency (locks rule 8 drift)", () => {
  const architectCore = readFileSync(join(import.meta.dir, "../../src/prompt/core/architect-core.txt"), "utf8")
  const kindsOf = (schema: unknown) =>
    ((z.toJSONSchema(schema as any) as any).anyOf as any[]).map((b) => b.properties.kind.const as string)

  test("architect-core.txt documents every ValueDomain kind (add a kind ⇒ update the prompt)", () => {
    for (const kind of kindsOf(ValueDomainSchema)) {
      expect(architectCore).toContain(`"${kind}"`)
    }
  })

  test("architect-core.txt documents every ContractIR kind", () => {
    for (const kind of kindsOf(ContractIRSchema)) {
      expect(architectCore).toContain(`"${kind}"`)
    }
  })
})

describe("createToolCallRepair — wrapper-level single source covers ALL streamText callers", () => {
  // Closes the rule-35 gap codex flagged: walkthrough translation
  // (`acceptance/checks/walkthrough/translate.ts`) calls `@/llm/api` streamText
  // directly and never wired a per-call repair. The repair now lives at the
  // wrapper, so this previously-uncovered discriminated union is covered too.
  const walkthroughToolSchema = z.object({ steps: WalkthroughStepsSchema })

  function makeFailed(toolName: string, input: unknown, schema: z.ZodTypeAny) {
    const zodError = schema.safeParse(input).error
    const error = new InvalidToolInputError({
      toolName,
      toolInput: JSON.stringify(input),
      cause: zodError,
    })
    return {
      toolCall: { type: "tool-call" as const, toolCallId: "call_1", toolName, input: JSON.stringify(input) },
      tools: {} as never,
      inputSchema: async () => asSchema(schema as never).jsonSchema,
      error,
      system: undefined,
      messages: [],
    }
  }

  test("walkthrough illegal action → throws with all 6 legal actions (rule-35 gap closed)", async () => {
    const repair = createToolCallRepair({ submit_walkthrough_steps: {} } as never)
    const failed = makeFailed(
      "submit_walkthrough_steps",
      { steps: [{ action: "navigate", path: "/x" }] },
      walkthroughToolSchema,
    )
    await expect((repair as any)(failed)).rejects.toThrow(/goto.*fill.*click.*assertPath.*assertSelector.*assertText/s)
  })

  test("tool-name case normalization still works (the other legitimate repair)", async () => {
    const repair = createToolCallRepair({ submit_walkthrough_steps: {} } as never)
    const failed = makeFailed("Submit_Walkthrough_Steps", { steps: [] }, walkthroughToolSchema)
    const out = await (repair as any)(failed)
    expect(out).toBeDefined()
    expect(out.toolName).toBe("submit_walkthrough_steps")
  })

  test("non-discriminator rejection (steps min(1)) → returns null, native SDK behaviour preserved", async () => {
    const repair = createToolCallRepair({ submit_walkthrough_steps: {} } as never)
    const failed = makeFailed("submit_walkthrough_steps", { steps: [] }, walkthroughToolSchema)
    expect(await (repair as any)(failed)).toBeNull()
  })
})

describe("streamText wrapper is the structurally enforced single source (rule 8/35/36)", () => {
  const srcDir = join(import.meta.dir, "../../src")

  test("no production module imports streamText directly from 'ai' (must go through @/llm/api)", () => {
    const glob = new Bun.Glob("**/*.ts")
    // `[^}]*` (not `[\s\S]*?`) so the match stays inside ONE import block —
    // a greedy/lazy any-char run spans `import {streamText} from "@/llm/api"`
    // into a following `import {…} from "ai"` and false-flags the wrapper-correct
    // caller (codex r2 grep had the same defect).
    const importFromAi = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']ai["']/g
    const offenders: string[] = []
    for (const rel of glob.scanSync({ cwd: srcDir })) {
      const posix = rel.replaceAll("\\", "/")
      if (posix.endsWith(".test.ts")) continue
      if (posix === "llm/api.ts") continue // the wrapper itself legitimately wraps raw streamText
      const text = readFileSync(join(srcDir, rel), "utf8")
      let m: RegExpExecArray | null
      while ((m = importFromAi.exec(text)) !== null) {
        if (/\bstreamText\b/.test(m[1])) {
          offenders.push(posix)
          break
        }
      }
      importFromAi.lastIndex = 0
    }
    // Scope is `src/` PRODUCTION code only. One-off diagnostic scripts under
    // `script/cache-probe/` (e.g. trace-aisdk-wire.ts) intentionally import
    // the raw SDK to observe UNWRAPPED wire behaviour and are not scanned —
    // wrapping them would defeat the probe (codex review round 3 scope call).
    // A new raw `import { streamText } from "ai"` inside src/ would silently
    // revert that caller to the opaque discriminated-union death loop (codex
    // round 2: provider.ts was exactly such a bypass).
    expect(offenders).toEqual([])
  })

  test("@/llm/api wrapper wires createToolCallRepair into every streamText call", () => {
    const apiSrc = readFileSync(join(srcDir, "llm/api.ts"), "utf8")
    expect(apiSrc).toMatch(/createToolCallRepair\s*\(/)
    expect(apiSrc).toMatch(/experimental_repairToolCall:\s*repairToolCall/)
  })

  test("production helper streamText calls bind provider models and output schemas", () => {
    const glob = new Bun.Glob("**/*.ts")
    const rawLanguageCallers: string[] = []
    const rawOutputSchemas: string[] = []
    for (const rel of glob.scanSync({ cwd: srcDir })) {
      const posix = rel.replaceAll("\\", "/")
      if (posix.endsWith(".test.ts")) continue
      if (posix === "provider/llm.ts") continue
      const text = readFileSync(join(srcDir, rel), "utf8")
      if (
        text.includes("streamText({") &&
        /model:\s*language\b/.test(text) &&
        !text.includes("ProviderLLM.wrapModel")
      ) {
        rawLanguageCallers.push(posix)
      }
      const outputMatches = text.matchAll(/Output\.object\(\{\s*schema:\s*([^}\n]+)/g)
      for (const match of outputMatches) {
        if (!match[1]?.includes("ProviderSchema.output")) rawOutputSchemas.push(`${posix}: ${match[1]?.trim()}`)
      }
    }
    expect(rawLanguageCallers).toEqual([])
    expect(rawOutputSchemas).toEqual([])
  })
})
