import { expect, test } from "bun:test"
import { createArchitectOutputTools, architectValidationFindings, type RegisteredGoal } from "@/architect/output-tools"

function acceptance(goalID: string) {
  return {
    id: `acc-${goalID}`,
    source_requirement_id: "REQ-1",
    goal_id: goalID,
    title: `${goalID} acceptance`,
    severity: "essential" as const,
    scorers: [
      {
        type: "heuristic" as const,
        name: "tests",
        spec: { kind: "shell" as const, cmd: "bun test" },
        expect: { exit_code: 0 },
      },
    ],
  }
}

function goal(input: {
  id: string
  owned_paths: string[]
  depends_on?: string[]
  kind?: RegisteredGoal["kind"]
}): RegisteredGoal {
  return {
    id: input.id,
    title: input.id,
    objective: `Deliver the implementation surface owned by ${input.id} while preserving its goal-local acceptance contract.`,
    acceptance_specs: [acceptance(input.id)],
    owned_paths: input.owned_paths,
    depends_on: input.depends_on ?? [],
    priority: "blocking",
    kind: input.kind ?? "feature",
    requirement_ids: ["REQ-1"],
  }
}

type ArchitectTools = ReturnType<typeof createArchitectOutputTools>["tools"]

async function registerGoal(tools: ArchitectTools, input: Record<string, unknown>) {
  return await tools.manage_goal.execute!({ action: "register_goal", ...input } as any, {} as any)
}

async function findingsFor(goals: RegisteredGoal[]) {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  for (const registeredGoal of goals) {
    await registerGoal(kit.tools, registeredGoal as any)
  }
  return architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
}

function overlapBlockers(findings: ReturnType<typeof architectValidationFindings>) {
  return findings.filter((finding) => finding.code === "owned_paths_overlap_without_dependency")
}

test("blocks overlapping feature goal owned_paths without depends_on", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_a", owned_paths: ["src/foo.ts"] }),
    goal({ id: "goal_b", owned_paths: ["src/foo.ts"] }),
  ])

  expect(overlapBlockers(findings)).toEqual([
    expect.objectContaining({
      severity: "blocker",
      scope: { goal_ids: ["goal_a", "goal_b"] },
      repair_tools: ["manage_goal action=modify_goal", "manage_goal action=remove_goal"],
    }),
  ])
})

test("allows overlapping feature goal owned_paths when depends_on connects them", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_a", owned_paths: ["src/foo.ts"] }),
    goal({ id: "goal_b", owned_paths: ["src/foo.ts"], depends_on: ["goal_a"] }),
  ])

  expect(overlapBlockers(findings)).toHaveLength(0)
})

test("allows transitive depends_on reachability for owned_paths overlap", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_a", owned_paths: ["src/foo.ts"] }),
    goal({ id: "goal_b", owned_paths: ["src/bar.ts"], depends_on: ["goal_a"] }),
    goal({ id: "goal_c", owned_paths: ["src/foo.ts"], depends_on: ["goal_b"] }),
  ])

  expect(overlapBlockers(findings)).toHaveLength(0)
})

test("ignores verification goals when checking owned_paths overlap", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_feature", owned_paths: ["src/foo.ts"] }),
    goal({ id: "goal_verify", owned_paths: ["src/foo.ts"], kind: "verification" }),
  ])

  expect(overlapBlockers(findings)).toHaveLength(0)
})

test("allows overlapping verification goals", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_verify_a", owned_paths: ["test/foo.test.ts"], kind: "verification" }),
    goal({ id: "goal_verify_b", owned_paths: ["test/foo.test.ts"], kind: "verification" }),
  ])

  expect(overlapBlockers(findings)).toHaveLength(0)
})

test("normalizes owned_paths case before checking overlap", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_a", owned_paths: ["src/foo.ts"] }),
    goal({ id: "goal_b", owned_paths: ["SRC/foo.ts"] }),
  ])

  expect(overlapBlockers(findings)).toHaveLength(1)
})

test("blocks directory owned_paths overlapping child files", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_a", owned_paths: ["a/b/"] }),
    goal({ id: "goal_b", owned_paths: ["a/b/c.ts"] }),
  ])

  expect(overlapBlockers(findings)).toHaveLength(1)
})

test("emits one blocker per unordered overlapping goal pair", async () => {
  const findings = await findingsFor([
    goal({ id: "goal_a", owned_paths: ["src/foo.ts", "src/bar.ts"] }),
    goal({ id: "goal_b", owned_paths: ["src/foo.ts", "src/bar.ts"] }),
  ])

  const blockers = overlapBlockers(findings)
  expect(blockers).toHaveLength(1)
  expect(blockers[0].message).toContain("goal_a:src/foo.ts")
  expect(blockers[0].message).toContain("goal_b:src/foo.ts")
})
