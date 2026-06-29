import { afterEach, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  toolErrorPartsFromFinalMessage: () => [],
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by ArchitectAgent")
  },
}))

afterEach(async () => {
  runnerImpl = undefined
  mock.restore()
  await Instance.disposeAll()
})

test("ArchitectAgent registers submit_architect as the terminal collector contract", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const continuation = {
        sessionID: "ses_architect_existing",
        artifactID: "artifact_architect_continuation",
        reason: "continue architect finalizer miss",
        kind: "protocol-finalizer-miss" as const,
        finalizerName: "submit_architect",
      }
      runnerImpl = async (input: any) => {
        expect(input.continuation).toEqual(continuation)
        expect(input.format).toBeUndefined()
        expect(input.terminalTool?.toolName).toBe("submit_architect")
        expect(input.terminalTool?.isSatisfied(input.toolKit.getCollector())).toBe(false)
        expect(input.terminalTool?.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)

        const collector = input.toolKit.getCollector()
        collector.summary = "Two goal decomposition"
        collector.decomposition_analysis =
          "The main implementation goal owns product code, while the integration test goal owns verification and consumes the implementation contract. This keeps each goal modest and makes the dependency explicit."
        collector.goals.push({
          id: "goal_main",
          title: "Main implementation",
          objective: "Implement the requested change with focused verification.",
          acceptance_specs: [
            {
              id: "acc-main",
              source_requirement_id: "REQ-1",
              goal_id: "goal_main",
              title: "Main implementation tests pass",
              severity: "essential",
              scorers: [
                {
                  type: "heuristic",
                  name: "main-tests",
                  spec: { kind: "shell", cmd: "bun test src/" },
                },
              ],
            },
          ],
          owned_paths: ["src/index.ts"],
          depends_on: [],
          priority: "blocking",
          kind: "feature",
          requirement_ids: ["REQ-1"],
        })
        collector.goals.push({
          id: "goal_tests",
          title: "Integration tests",
          objective: "Write integration tests that exercise the main implementation contract.",
          acceptance_specs: [
            {
              id: "acc-tests",
              source_requirement_id: "REQ-1",
              goal_id: "goal_tests",
              title: "Integration test suite passes",
              severity: "essential",
              scorers: [
                {
                  type: "heuristic",
                  name: "integration",
                  spec: { kind: "shell", cmd: "bun test tests/integration/" },
                },
              ],
            },
          ],
          owned_paths: ["tests/integration/main.test.ts"],
          depends_on: ["goal_main"],
          priority: "blocking",
          kind: "verification",
          requirement_ids: ["REQ-1"],
        })
        expect(input.toolKit.tools.request_orchestrator_decision).toBeDefined()
        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)
        collector.traceability.push({
          requirementID: "REQ-1",
          goalIDs: ["goal_main", "goal_tests"],
        })
        collector.contract_graph.contracts.push({
          id: "contract_main_entry",
          kind: "component",
          name: "runMain integration surface",
          producer_goal_id: "goal_main",
          consumer_goal_ids: ["goal_tests"],
          summary: "Main implementation surface consumed by the integration tests.",
          artifact_paths: ["src/index.ts"],
          evidence_refs: [],
        })
        collector.contract_graph.dependency_contracts.push({
          from_goal_id: "goal_main",
          to_goal_id: "goal_tests",
          reason: "contract",
          contract_ids: ["contract_main_entry"],
        })
        collector.assembly_owners.push({
          surface: "final-deliverable",
          goal_id: "goal_main",
          rationale: "One goal must own final stitching for the shared deliverable.",
        })
        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(true)
        collector.finalized = true
        expect(input.terminalTool.isSatisfied(input.toolKit.getCollector())).toBe(true)
        return {
          session: { id: "ses_architect" },
          finalMessage: { info: {} },
          collector,
          structured: undefined,
          streamErrors: [],
          model: { providerID: "test", modelID: "mock", id: "test/mock" },
        }
      }

      const { ArchitectAgent } = await import("../../src/architect/agent")
      const result = await ArchitectAgent.coordinate({
        goals: [],
        taskRequest: "Change the app",
        taskTitle: "Change app",
        requirements: [
          {
            id: "REQ-1",
            type: "explicit",
            description: "Change the app",
            acceptance: "The changed app behavior is visible in the running UI.",
            non_goals: "This requirement does not cover unrelated app rewrites.",
          },
        ],
        requirementDecisions: [],
        continuation,
        decisionLog: {
          append() {},
          toPromptSection() {
            return ""
          },
        } as any,
      })

      expect(result.sessionID).toBe("ses_architect")
      expect(result.goals.map((goal) => goal.id)).toEqual(["goal_main", "goal_tests"])
    },
  })
}, 30_000)

test("ArchitectAgent keeps register tools available until explicit goal-count contract is satisfied", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        const prompt = input.buildUserPrompt()
        expect(prompt).toContain("# Architect Execution Contract")
        expect(prompt).toContain("Minimum goals: 15")
        expect(prompt).toContain("Source: requirements_decision")
        expect(prompt).toContain("architect_goal_min_count=15; 用户要求不少于 15 个可验收 goals")
        expect(input.toolKit.tools.request_orchestrator_decision).toBeDefined()

        const collector = input.toolKit.getCollector()
        for (let index = 1; index <= 2; index++) {
          collector.goals.push({
            id: `goal_${index}`,
            title: `Goal ${index}`,
            objective: `Deliver independently verifiable slice ${index}.`,
            acceptance_specs: [
              {
                id: `acc-${index}`,
                source_requirement_id: "REQ-1",
                goal_id: `goal_${index}`,
                title: `Goal ${index} acceptance`,
                severity: "essential",
                scorers: [
                  {
                    type: "heuristic",
                    name: "tests",
                    spec: { kind: "shell", cmd: "bun test" },
                    expect: { exit_code: 0 },
                  },
                ],
              },
            ],
            owned_paths: [`src/slice-${index}.ts`],
            depends_on: [],
            priority: "blocking",
            kind: "feature",
            requirement_ids: ["REQ-1"],
          })
        }
        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)

        for (let index = 3; index <= 15; index++) {
          collector.goals.push({
            id: `goal_${index}`,
            title: `Goal ${index}`,
            objective: `Deliver independently verifiable slice ${index}.`,
            acceptance_specs: [
              {
                id: `acc-${index}`,
                source_requirement_id: "REQ-1",
                goal_id: `goal_${index}`,
                title: `Goal ${index} acceptance`,
                severity: "essential",
                scorers: [
                  {
                    type: "heuristic",
                    name: "tests",
                    spec: { kind: "shell", cmd: "bun test" },
                    expect: { exit_code: 0 },
                  },
                ],
              },
            ],
            owned_paths: [`src/slice-${index}.ts`],
            depends_on: [],
            priority: "blocking",
            kind: "feature",
            requirement_ids: ["REQ-1"],
          })
        }
        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)
        collector.traceability.push({
          requirementID: "REQ-1",
          goalIDs: Array.from({ length: 15 }, (_, index) => `goal_${index + 1}`),
        })
        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(true)
        collector.finalized = true

        return {
          session: { id: "ses_architect_goal_count" },
          finalMessage: { info: {} },
          collector,
          structured: undefined,
          streamErrors: [],
          model: { providerID: "test", modelID: "mock", id: "test/mock" },
        }
      }

      const { ArchitectAgent } = await import("../../src/architect/agent")
      const result = await ArchitectAgent.coordinate({
        goals: [],
        taskRequest: "实现前必须输出模块级设计方案。",
        taskTitle: "TradingView replica",
        requirements: [
          {
            id: "REQ-1",
            type: "explicit",
            description: "Implement the replica.",
            acceptance: "The replica is split into independently verifiable work.",
            non_goals: "This requirement does not cover unrelated pages.",
            evidence_refs: [],
          },
        ],
        requirementDecisions: [
          {
            key: "architect_goal_min_count",
            value: "15",
            reason: "用户要求不少于 15 个可验收 goals",
          },
        ],
        decisionLog: {
          append() {},
          toPromptSection() {
            return ""
          },
        } as any,
      })

      expect(result.sessionID).toBe("ses_architect_goal_count")
      expect(result.goals).toHaveLength(15)
    },
  })
}, 30_000)

test("ArchitectAgent does not infer goal-count contracts from raw task text", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        const prompt = input.buildUserPrompt()
        expect(prompt).not.toContain("# Architect Execution Contract")
        expect(input.toolKit.tools.request_orchestrator_decision).toBeDefined()

        const collector = input.toolKit.getCollector()
        collector.summary = "Two goal decomposition"
        collector.decomposition_analysis =
          "The implementation goal owns product code, while the verification goal owns the durable test surface and consumes the implementation contract."

        for (const [id, title, ownedPath, kind] of [
          ["goal_main", "Main implementation", "src/main.ts", "feature"],
          ["goal_tests", "Verification", "test/main.test.ts", "verification"],
        ] as const) {
          collector.goals.push({
            id,
            title,
            objective: `${title} is independently verifiable.`,
            acceptance_specs: [
              {
                id: `acc-${id}`,
                source_requirement_id: "REQ-1",
                goal_id: id,
                title: `${title} acceptance`,
                severity: "essential",
                scorers: [
                  {
                    type: "heuristic",
                    name: "tests",
                    spec: { kind: "shell", cmd: "bun test" },
                    expect: { exit_code: 0 },
                  },
                ],
              },
            ],
            owned_paths: [ownedPath],
            depends_on: id === "goal_tests" ? ["goal_main"] : [],
            priority: "blocking",
            kind,
            requirement_ids: ["REQ-1"],
          })
        }
        collector.traceability.push({
          requirementID: "REQ-1",
          goalIDs: ["goal_main", "goal_tests"],
        })
        collector.contract_graph.contracts.push({
          id: "contract_main_entry",
          kind: "component",
          name: "Main implementation surface",
          producer_goal_id: "goal_main",
          consumer_goal_ids: ["goal_tests"],
          summary: "Implementation output consumed by verification.",
          artifact_paths: ["src/main.ts"],
          evidence_refs: [],
        })
        collector.contract_graph.dependency_contracts.push({
          from_goal_id: "goal_main",
          to_goal_id: "goal_tests",
          reason: "contract",
          contract_ids: ["contract_main_entry"],
        })
        collector.assembly_owners.push({
          surface: "final-deliverable",
          goal_id: "goal_main",
          rationale: "The implementation goal owns final stitching.",
        })

        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(true)
        collector.finalized = true

        return {
          session: { id: "ses_architect_raw_text" },
          finalMessage: { info: {} },
          collector,
          structured: undefined,
          streamErrors: [],
          model: { providerID: "test", modelID: "mock", id: "test/mock" },
        }
      }

      const { ArchitectAgent } = await import("../../src/architect/agent")
      const result = await ArchitectAgent.coordinate({
        goals: [],
        taskRequest: "实现前必须输出模块级设计方案，并由 architect 分解出不少于 15 个可验收 goals。",
        taskTitle: "TradingView replica",
        requirements: [
          {
            id: "REQ-1",
            type: "explicit",
            description: "Implement the replica.",
            acceptance: "The replica is split into independently verifiable work.",
            non_goals: "This requirement does not cover unrelated pages.",
            evidence_refs: [],
          },
        ],
        requirementDecisions: [],
        decisionLog: {
          append() {},
          toPromptSection() {
            return ""
          },
        } as any,
      })

      expect(result.sessionID).toBe("ses_architect_raw_text")
      expect(result.goals).toHaveLength(2)
    },
  })
}, 30_000)
