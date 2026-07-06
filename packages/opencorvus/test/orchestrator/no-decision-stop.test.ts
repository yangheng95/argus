import { describe, expect, test } from "bun:test"
import { classifyOrchestratorDecisionStop } from "../../src/orchestrator/agent"

describe("orchestrator no-decision stop classifier", () => {
  test("rejects provider tool-call protocol residue emitted as text", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: 'oesmodify_goal:60<|tool_call_argument_begin|>{"goalID":"gol_1"}<|tool_calls_section_end|>',
      providerVisiblePartCount: 1,
      wakeTools: [
        { name: "add_goal", decisionEffect: "decision" },
        { name: "modify_goal", decisionEffect: "decision" },
      ],
    })

    expect(reason).toContain("provider tool-call protocol text")
  })

  test("rejects an empty assistant shell with no finish or parts", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: undefined,
      finalText: "",
      providerVisiblePartCount: 0,
      wakeTools: [],
    })

    expect(reason).toContain("empty assistant turn")
  })

  test("rejects prose stop after only observation tools", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "The next dispatchable goals are G12 and G13.",
      providerVisiblePartCount: 1,
      wakeTools: [{ name: "read_context", decisionEffect: "observation" }],
    })

    expect(reason).toContain("only observation or pause tools")
  })

  test("rejects wait-only stop when wait produced no task decision effect", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "I tried to wait for the external event.",
      providerVisiblePartCount: 1,
      wakeTools: [{ name: "wait", decisionEffect: "none" }],
    })

    expect(reason).toContain("produced no task decision effect")
  })

  test("rejects stop when a same-wake decision is followed by state observation", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "G1 is complete. The next executable goal is G2.",
      providerVisiblePartCount: 1,
      wakeTools: [
        { name: "build", decisionEffect: "decision" },
        { name: "read_context", decisionEffect: "observation" },
      ],
    })

    expect(reason).toContain("following the latest task decision")
  })

  test("rejects stop when a same-wake build decision is followed by an unscheduled wait", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "Build is running, so I waited for it.",
      providerVisiblePartCount: 1,
      wakeTools: [
        { name: "build", decisionEffect: "decision" },
        { name: "wait", decisionEffect: "none" },
      ],
    })

    expect(reason).toContain("following the latest task decision")
  })

  test("rejects prose stop with no tool calls on an active task", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "I will continue the task.",
      providerVisiblePartCount: 1,
      wakeTools: [],
    })

    expect(reason).toContain("without calling any tool")
  })

  test("allows visible no-tool park when the rendered scheduler snapshot has only live worker work", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      schedulerParkAllowed: true,
      finish: "stop",
      finalText:
        "No dispatchable or failed goals remain; live build workers are still running, so I am parking this wake.",
      providerVisiblePartCount: 1,
      wakeTools: [],
    })

    expect(reason).toBeUndefined()
  })

  test("rejects invisible no-tool park even when live worker facts are present", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      schedulerParkAllowed: true,
      finish: "stop",
      finalText: "",
      providerVisiblePartCount: 0,
      wakeTools: [],
    })

    expect(reason).toContain("without calling any tool")
  })

  test("rejects non-stop finishes that would enter standby on an active task", () => {
    const noToolReason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "length",
      finalText: "I will keep going",
      providerVisiblePartCount: 1,
      wakeTools: [],
    })
    expect(noToolReason).toContain("finish=length")

    const afterToolReason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "content-filter",
      finalText: "Build dispatched but final text was filtered.",
      providerVisiblePartCount: 1,
      wakeTools: [{ name: "build", decisionEffect: "decision" }],
    })
    expect(afterToolReason).toContain("finish=content-filter")
  })

  test("rejects non-provider-visible empty assistant shells", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: undefined,
      finalText: "",
      providerVisiblePartCount: 0,
      wakeTools: [],
    })

    expect(reason).toContain("empty assistant turn")
  })

  test("rejects decision-capable tools that produced no decision effect", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "Build was called, but it only returned a precondition message.",
      providerVisiblePartCount: 1,
      wakeTools: [{ name: "build", decisionEffect: "none" }],
    })

    expect(reason).toContain("produced no task decision effect")
  })

  test("rejects same-profile expert-squad reselection that produced no decision effect", () => {
    const reason = classifyOrchestratorDecisionStop({
      taskTerminal: false,
      finish: "stop",
      finalText: "The requested expert squad was already active.",
      providerVisiblePartCount: 1,
      wakeTools: [
        { name: "skill" },
        { name: "select_expert_squad", decisionEffect: "none" },
      ],
    })

    expect(reason).toContain("produced no task decision effect")
  })

  test("allows stops after real decision tools", () => {
    expect(
      classifyOrchestratorDecisionStop({
        taskTerminal: false,
        finish: "stop",
        finalText: "Build dispatched.",
        providerVisiblePartCount: 1,
        wakeTools: [{ name: "build", decisionEffect: "decision" }],
      }),
    ).toBeUndefined()
    expect(
      classifyOrchestratorDecisionStop({
        taskTerminal: false,
        finish: "stop",
        finalText: "Scheduled a wait for the external event.",
        providerVisiblePartCount: 1,
        wakeTools: [{ name: "wait", decisionEffect: "decision" }],
      }),
    ).toBeUndefined()
    expect(
      classifyOrchestratorDecisionStop({
        taskTerminal: false,
        finish: "stop",
        finalText: "Frontend replica expert squad selected; continuation wake scheduled.",
        providerVisiblePartCount: 1,
        wakeTools: [
          { name: "skill" },
          { name: "select_expert_squad", decisionEffect: "decision" },
        ],
      }),
    ).toBeUndefined()
  })

  test("allows terminal tasks and unfinished tool-call turns", () => {
    expect(
      classifyOrchestratorDecisionStop({
        taskTerminal: true,
        finish: "stop",
        finalText: "Task completed.",
        providerVisiblePartCount: 1,
        wakeTools: [],
      }),
    ).toBeUndefined()
    expect(
      classifyOrchestratorDecisionStop({
        taskTerminal: false,
        finish: "tool-calls",
        finalText: "",
        providerVisiblePartCount: 1,
        wakeTools: [{ name: "read_context", decisionEffect: "observation" }],
      }),
    ).toBeUndefined()
  })
})
