import { tool } from "@opencorvus-ai/plugin"

const workflowPosition = [
  {
    order: 1,
    tool: "analyze_intent",
    input: "user objective, requested quality risk, and known system under test",
    output: "testing intent classification and required evidence surface",
  },
  {
    order: 2,
    tool: "deep_research",
    input: "project files, local commands, documentation, adapters, and external facts when needed",
    output: "source-backed system behavior, runner inventory, and context contract facts",
  },
  {
    order: 3,
    tool: "requirements",
    input: "testing intent plus behavior evidence",
    output: "scenarios, preconditions, expected results, severity, and test points",
  },
  {
    order: 4,
    tool: "architect",
    input: "scenario contract and existing project conventions",
    output: "test artifact plan, command plan, and evidence plan",
  },
  {
    order: 5,
    tool: "workload_analysis",
    input: "test artifact plan and available fixtures or adapters",
    output: "executable goal decomposition and missing-context risks",
  },
  {
    order: 6,
    tool: "build",
    input: "test plan, files, command, context contract, and inventory",
    output: "implemented or repaired tests, run evidence, and failure classification",
  },
  {
    order: 7,
    tool: "visual_qa",
    input: "Graphical User Interface or visual test evidence",
    output: "screenshot, video, browser, console, or interaction review",
  },
  {
    order: 8,
    tool: "integrity",
    input: "requirements, changed artifacts, run evidence, and visual evidence when applicable",
    output: "final evidence review, release impact, and unresolved blocker list",
  },
  {
    order: 9,
    tool: "fact_check",
    input: "version, Application Programming Interface, runtime, or standard claims used as evidence",
    output: "verified fact record or unresolved fact risk",
  },
] as const

export default tool({
  description:
    "Create the context input/output protocol and workflow-position contract for an active software-testing expert squad task.",
  args: {
    system_under_test: tool.schema.string().min(1),
    test_scope: tool.schema.string().min(1),
    surfaces: tool.schema
      .array(
        tool.schema.enum([
          "unit",
          "api",
          "integration",
          "gui",
          "visual",
          "workflow",
          "performance",
          "security",
          "data",
          "mobile",
        ]),
      )
      .min(1),
    context_inputs: tool.schema.array(tool.schema.string().min(1)).min(1),
    acceptance_outputs: tool.schema.array(tool.schema.string().min(1)).min(1),
    execution_command: tool.schema.string().min(1),
    risk_level: tool.schema.enum(["P0", "P1", "P2", "P3"]),
  },
  async execute(args) {
    return JSON.stringify(
      {
        schema_version: 1,
        system_under_test: args.system_under_test,
        test_scope: args.test_scope,
        surfaces: args.surfaces,
        risk_level: args.risk_level,
        context_protocol: {
          inputs: args.context_inputs,
          outputs: args.acceptance_outputs,
          execution_command: args.execution_command,
        },
        workflow_position: workflowPosition,
        tool_availability: {
          built_in_workflow_tools: workflowPosition.map((item) => item.tool),
          package_tools: [
            {
              ref: "software-testing/shared/test-artifact-inventory",
              available_in: ["orchestrator", "build", "integrity"],
            },
            {
              ref: "software-testing/shared/test-protocol-contract",
              available_in: ["orchestrator", "build", "integrity"],
            },
          ],
          active_selection_source: "prompt_profile.active",
          projection_surface: "PromptProfileResolver",
        },
      },
      null,
      2,
    )
  },
})
