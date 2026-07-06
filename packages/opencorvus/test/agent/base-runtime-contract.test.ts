import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AgentBaseRuntimeContract } from "../../src/agent/base-runtime-contract"
import { AgentRoleContract, type AgentRoleID } from "../../src/agent/role-contract"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { WorkflowRegistry } from "../../src/engine/workflow"

describe("agent base runtime contract projection", () => {
  test("build projection derives session, workflow, host tools, and package runtime capability", () => {
    const projection = AgentBaseRuntimeContract.project("build")

    expect(projection.role).toBe("build")
    expect(projection.session.kind).toBe("build")
    expect(projection.session.runtimeContractRequired).toBe(true)
    expect(projection.session.exactRuntimeContract).toBe(false)
    expect(projection.workflow.schedulerWorkflowTools).toEqual(["build"])
    expect(projection.hostTools).toEqual(AgentToolPool.assignment("build"))
    expect(projection.hostTools.defaultRuntimeToolSwitches).toMatchObject({
      task: false,
      skill: true,
      webfetch: false,
      websearch: false,
    })
    expect(projection.packageProjection).toEqual({
      promptOverlay: true,
      skills: true,
      packageTools: true,
      packageMcp: true,
      virtualAgent: true,
    })
  })

  test("frontend research and design remain base runtime roles", () => {
    const expectations = [
      ["frontend-design", "frontend_design"],
      ["frontend-research", "frontend_research"],
    ] as const

    for (const [role, tool] of expectations) {
      const projection = AgentBaseRuntimeContract.project(role)
      expect(projection.session.kind, role).toBe(role)
      expect(projection.session.runtimeContractRequired, role).toBe(true)
      expect(projection.workflow.schedulerWorkflowTools, role).toEqual([tool])
      expect(projection.hostTools, role).toEqual(AgentToolPool.assignment(role))
      expect(projection.packageProjection.virtualAgent, role).toBe(true)
      expect(projection.packageProjection.packageTools, role).toBe(true)
      expect(projection.packageProjection.packageMcp, role).toBe(true)
    }
  })

  test("general keeps prompt overlays but no workflow or package runtime providers", () => {
    const projection = AgentBaseRuntimeContract.project("general")

    expect(projection.workflow.schedulerWorkflowTools).toEqual([])
    expect(projection.session.runtimeContractRequired).toBe(false)
    expect(projection.packageProjection.promptOverlay).toBe(true)
    expect(projection.packageProjection.skills).toBe(false)
    expect(projection.packageProjection.packageTools).toBe(false)
    expect(projection.packageProjection.packageMcp).toBe(false)
    expect(projection.packageProjection.virtualAgent).toBe(false)
  })

  test("orchestrator remains host-owned and not package virtual-agent mountable", () => {
    const projection = AgentBaseRuntimeContract.project("orchestrator")

    expect(projection.archetype).toBe("host")
    expect(projection.controlSurface).toBe("host")
    expect(projection.session.kind).toBe("orchestrator")
    expect(projection.workflow.schedulerWorkflowTools).toEqual([])
    expect(projection.packageProjection.promptOverlay).toBe(true)
    expect(projection.packageProjection.skills).toBe(false)
    expect(projection.packageProjection.packageTools).toBe(false)
    expect(projection.packageProjection.packageMcp).toBe(false)
    expect(projection.packageProjection.virtualAgent).toBe(false)
  })

  test("projection remains a derived view over existing contract sources", () => {
    const workflowToolsByRole = new Map<AgentRoleID, string[]>()
    for (const binding of WorkflowRegistry.schedulerAgentWorkflowBindingsSync()) {
      const values = workflowToolsByRole.get(binding.stage) ?? []
      values.push(binding.workflow_tool_name)
      workflowToolsByRole.set(binding.stage, values)
    }

    for (const role of AgentRoleContract.ids) {
      const contract = AgentRoleContract.get(role)
      const projection = AgentBaseRuntimeContract.project(role)

      expect(projection.archetype, role).toBe(contract.archetype)
      expect(projection.controlSurface, role).toBe(contract.controlSurface)
      expect(projection.session.agentOwned, role).toBe(contract.agentOwnedSessionKind)
      expect(projection.session.runtimeContractRequired, role).toBe(contract.runtimeContractRequired)
      expect(projection.session.exactRuntimeContract, role).toBe(contract.exactRuntimeContract)
      expect(projection.session.liveRuntimeContinuation, role).toBe(contract.liveRuntimeContinuation)
      expect(projection.session.protocolStageContinuation, role).toBe(contract.protocolStageContinuation)
      expect(projection.session.directSessionReply, role).toBe(contract.directSessionReply)
      expect(projection.session.liveOrchestratorToolOwnershipControl, role).toBe(
        contract.liveOrchestratorToolOwnershipControl,
      )
      expect(projection.hostTools, role).toEqual(AgentToolPool.assignment(role))
      expect(projection.workflow.schedulerWorkflowTools, role).toEqual(workflowToolsByRole.get(role) ?? [])
    }
  })

  test("projection module does not duplicate terminal submit contracts", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/agent/base-runtime-contract.ts", import.meta.url)),
      "utf8",
    )

    expect(source).toContain("AgentRoleContract")
    expect(source).toContain("AgentToolPool")
    expect(source).toContain("WorkflowRegistry")
    expect(source).not.toContain("report_build_result")
    expect(source).not.toContain("submit_frontend_template")
    expect(source).not.toContain("submit_visual_qa_report")
    expect(source).not.toContain("submit_integrity_consensus")
  })
})
