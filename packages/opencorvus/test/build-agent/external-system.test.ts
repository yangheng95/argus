import { describe, expect, test } from "bun:test"
import { BuildAgent, externalEventPartText, externalToolProtocolErrorMessage } from "../../src/build/agent"
import { Config } from "../../src/config/config"
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  writeProjectExpertSquadPackage,
} from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

describe("BuildAgent external coding system prompt", () => {
  test("injects OpenCorvus MCP executor aliases without reopening webpage evidence tools", async () => {
    await using tmp = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(tmp.path, "frontend-replica")
    const composed = await BuildAgent.composeExternalCodingSystem({
      executor: "codex",
      config: Config.Info.parse({ prompt_profile: { active: "frontend-replica" } }),
      projectDirectory: tmp.path,
      baseSystem: "base system",
      userAppend: "operator build append",
    })

    expect(composed.mcpPromptInjected).toBe(true)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("You are the OpenCorvus external build executor running through codex.")
    expect(composed.system).toContain("Treat the user prompt as a build contract, not as a chat request.")
    expect(composed.system).toContain("complete source/target investigation is implementation work")
    expect(composed.system).toContain("context-menu/right-click behavior")
    expect(composed.system).toContain("restate the detailed req/goal contract")
    expect(composed.system).toContain("warn subsequent agents where to dig deeper for workload")
    expect(composed.system).toContain("Do not perform unrelated broad inventories")
    expect(composed.system).toContain("If required source evidence is absent or incomplete")
    expect(composed.system).toContain("Do not call OpenCorvus-only tools such as report_build_result or merge_back")
    expect(composed.system).toContain("Follow task-specific overlays in the user prompt")
    expect(composed.system).toContain("memory => mcp__opencorvus__memory")
    expect(composed.system).toContain("skill => mcp__opencorvus__skill")
    expect(composed.system).toContain("task_report => mcp__opencorvus__task_report")
    expect(composed.system).not.toContain("webpage_extract => mcp__opencorvus__webpage_extract")
    expect(composed.system).not.toContain("figma_extract => mcp__opencorvus__figma_extract")
    expect(composed.system).toContain("Webpage evidence artifacts are produced by the upstream frontend_design stage")
    expect(composed.system).not.toContain("`web-clone-source/` package remains the compact evidence entrypoint")
    expect(composed.system).not.toContain(
      "Do not generate another separate source project for webpage clone acceptance",
    )
    expect(composed.system).toContain("Write shell commands for the actual platform and shell")
    expect(composed.system).toContain("PowerShell-native commands")
    expect(composed.system).toContain("On Windows, start Playwright only through Node Package Manager (`npm`)")
    expect(composed.system).toContain("never through `bun`")
    expect(composed.system).toContain("severe connection-timeout bug on Windows")
    expect(composed.system).toContain("Build one scoped component or region goal at a time.")
    expect(composed.system).toContain("browser_preview_reference_regions")
    expect(composed.system).not.toContain("browser_preview_compare_scroll_slices")
    expect(composed.system).toContain("leave screen-by-screen scroll-slice visual_diff to Visual QA")
    expect(composed.system).toContain("For any frontend project")
    expect(composed.system).toContain("each file-changing pass must open the task preview")
    expect(composed.system).toContain("task-scoped browser evidence route")
    expect(composed.system).toContain("changed region plus surrounding layout context")
    expect(composed.system).toContain("parent container, adjacent components, spacing, typography, color")
    expect(composed.system).toContain("responsive framing, and local visual style")
    expect(composed.system).toContain("operator build append")
    expect(composed.system!.indexOf("Build one scoped component or region goal at a time.")).toBeLessThan(
      composed.system!.indexOf("operator build append"),
    )
    expect(composed.system).not.toContain("skill prompt")
  })

  test("leaves Claude Code MCP alias injection to the Claude provider", async () => {
    await using tmp = await tmpdir({ git: true })
    const composed = await BuildAgent.composeExternalCodingSystem({
      executor: "claude-code",
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
      projectDirectory: tmp.path,
      baseSystem: "base system",
    })

    expect(composed.mcpPromptInjected).toBe(false)
    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("You are the OpenCorvus external build executor running through claude-code.")
    expect(composed.system).toContain(
      "Keep reasoning, plans, prompt/rule details, and progress narration out of assistant text.",
    )
    expect(composed.system).not.toContain("skill prompt")
  })

  test("composes project package build prompt overlays for external executors", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(tmp.path)
    const composed = await BuildAgent.composeExternalCodingSystem({
      executor: "codex",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
      projectDirectory: tmp.path,
      baseSystem: "base system",
      userAppend: "operator build append",
    })

    expect(composed.system).toContain("base system")
    expect(composed.system).toContain("project build overlay")
    expect(composed.system).toContain("operator build append")
    expect(composed.system.indexOf("base system")).toBeLessThan(composed.system.indexOf("project build overlay"))
    expect(composed.system.indexOf("project build overlay")).toBeLessThan(
      composed.system.indexOf("operator build append"),
    )
  })

  test("does not materialize external assistant narration as card text", () => {
    expect(
      externalEventPartText({ type: "text_delta", text: "Let me inspect the repo." }, "claude-code"),
    ).toBeUndefined()
    expect(externalEventPartText({ type: "reasoning_delta", text: "thinking aloud" }, "claude-code")).toBeUndefined()
    expect(
      externalEventPartText({ type: "plan_delta", summary: "1. inspect files\n2. write code" }, "codex"),
    ).toBeUndefined()
    expect(externalEventPartText({ type: "diff_delta", summary: "updated src/app.ts" }, "codex")).toBeUndefined()
    expect(
      externalEventPartText({ type: "error", message: "Claude Code process aborted by user" }, "claude-code"),
    ).toContain("Claude Code process aborted by user")
  })

  test("classifies external tool event misalignment before host merge_back", () => {
    expect(
      externalToolProtocolErrorMessage({
        executor: "codex",
        kind: "unmatched_result",
        callID: "call_123",
        toolName: "bash",
      }),
    ).toBe(
      'External executor protocol error (codex): tool_result id="call_123" for bash ' +
        "arrived without a prior tool_call; refusing to run host merge_back because tool telemetry is misaligned.",
    )

    expect(
      externalToolProtocolErrorMessage({
        executor: "claude-code",
        kind: "unclosed_call",
        callID: "toolu_1",
        toolName: "Read",
      }),
    ).toBe(
      'External executor protocol error (claude-code): tool_call id="toolu_1" for Read ' +
        "ended without a matching tool_result; refusing to run host merge_back because tool telemetry is incomplete.",
    )
  })
})
