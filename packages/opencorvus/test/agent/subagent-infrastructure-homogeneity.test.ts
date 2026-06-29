import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { AgentRoleContract, type AgentRoleID } from "../../src/agent/role-contract"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { isStageContinuationStage } from "../../src/engine/stage-continuation"
import {
  canReceiveDirectAgentReply,
  canReceiveDirectAgentSessionControl,
} from "../../src/orchestrator/direct-reply"
import { SESSION_KINDS } from "../../src/session/session.sql"

const requiredTaskWorkers = [
  "build",
  "explore",
  "frontend-research",
  "visual-qa",
  "fact-check",
  "deep-research",
  "goal-workload-analyst",
  "requirements",
  "frontend-design",
  "architect",
  "integrity",
  "intent-analysis",
] as const satisfies readonly AgentRoleID[]

describe("sub-agent infrastructure homogeneity manifest", () => {
  test("all required task sub-agents are declared by the role manifest", () => {
    const taskWorkers = new Set(AgentRoleContract.taskWorkerIDs())

    for (const role of requiredTaskWorkers) {
      expect(taskWorkers.has(role), `${role} must be a task-worker control surface`).toBe(true)
    }
  })

  test("task-worker roles have one canonical tool-pool assignment", () => {
    for (const role of AgentRoleContract.taskWorkerIDs()) {
      expect(AgentToolPool.roleAssignments[role], `${role} must have one AgentToolPool assignment`).toBeDefined()
    }
  })

  test("agent-owned task workers map to persisted session kinds", () => {
    const sessionKinds = new Set<string>(SESSION_KINDS)

    for (const role of AgentRoleContract.taskWorkerIDs()) {
      const contract = AgentRoleContract.get(role)
      if (!contract.agentOwnedSessionKind) continue
      expect(sessionKinds.has(role), `${role} owns sessions but is not a SessionKind`).toBe(true)
    }
  })

  test("agent-owned task workers have one derived manifest helper", () => {
    const derived = AgentRoleContract.taskWorkerIDs().filter((role) => AgentRoleContract.get(role).agentOwnedSessionKind)

    expect(AgentRoleContract.agentOwnedTaskWorkerIDs()).toEqual(derived)
    for (const role of derived) {
      expect(AgentRoleContract.isAgentOwnedTaskWorkerID(role)).toBe(true)
    }
    expect(AgentRoleContract.isAgentOwnedTaskWorkerID("mission")).toBe(false)
    expect(AgentRoleContract.isAgentOwnedTaskWorkerID("assistant")).toBe(false)
  })

  test("primary and host surfaces are not task workers", () => {
    for (const role of ["coding", "coding-assistant", "control", "mission", "orchestrator"] as const) {
      expect(AgentRoleContract.controlSurface(role)).not.toBe("task-worker")
    }
  })

  test("agent-owned task workers share the same session control surface", () => {
    for (const role of AgentRoleContract.taskWorkerIDs()) {
      const contract = AgentRoleContract.get(role)
      if (!contract.agentOwnedSessionKind) continue
      expect(canReceiveDirectAgentSessionControl(role), `${role} must be cancellable through one control surface`).toBe(
        true,
      )
    }
  })

  test("build is controllable without reopening direct reply", () => {
    expect(canReceiveDirectAgentSessionControl("build")).toBe(true)
    expect(canReceiveDirectAgentReply("build")).toBe(false)
  })

  test("task-worker direct reply eligibility is owned by the role manifest", () => {
    expect(AgentRoleContract.directSessionReplyIDs()).toEqual([
      "requirements",
      "architect",
      "frontend-design",
      "intent-analysis",
      "integrity",
    ])

    for (const role of AgentRoleContract.directSessionReplyIDs()) {
      expect(canReceiveDirectAgentReply(role), `${role} must receive direct reply through manifest policy`).toBe(true)
    }
    for (const role of AgentRoleContract.agentOwnedTaskWorkerIDs()) {
      if (AgentRoleContract.get(role).directSessionReply) continue
      expect(canReceiveDirectAgentReply(role), `${role} must not receive generic direct reply`).toBe(false)
    }
  })

  test("protocol finalizer continuation stages are derived from the role manifest", () => {
    const derived = AgentRoleContract.taskWorkerIDs().filter(
      (role) => AgentRoleContract.get(role).protocolStageContinuation,
    )

    expect(AgentRoleContract.protocolStageContinuationIDs()).toEqual(derived)
    expect(AgentRoleContract.protocolStageContinuationIDs()).not.toContain("explore")
    expect(isStageContinuationStage("explore")).toBe(false)
    for (const role of derived) {
      const contract = AgentRoleContract.get(role)
      expect(contract.agentOwnedSessionKind, `${role} continuation must target an agent-owned session`).toBe(true)
      expect(contract.runtimeContractRequired, `${role} continuation must use the runtime contract`).toBe(true)
      expect(contract.liveRuntimeContinuation, `${role} continuation must support live runtime continuation`).toBe(true)
      expect(
        AgentRoleContract.orchestratorWorkflowToolName(role),
        `${role} continuation must declare the orchestrator workflow tool name`,
      ).toBeDefined()
      expect(isStageContinuationStage(role), `${role} must validate through the shared stage guard`).toBe(true)
    }
  })

  test("orchestrator workflow tool names are owned by the role manifest", () => {
    expect(AgentRoleContract.orchestratorWorkflowToolName("frontend-design")).toBe("frontend_design")
    expect(AgentRoleContract.orchestratorWorkflowToolName("frontend-research")).toBe("frontend_research")
    expect(AgentRoleContract.orchestratorWorkflowToolName("deep-research")).toBe("deep_research")
    expect(AgentRoleContract.orchestratorWorkflowToolName("visual-qa")).toBe("visual_qa")
    expect(AgentRoleContract.orchestratorWorkflowToolName("intent-analysis")).toBe("analyze_intent")
    expect(AgentRoleContract.orchestratorWorkflowToolName("fact-check")).toBe("fact_check")
    expect(AgentRoleContract.orchestratorWorkflowToolName("goal-workload-analyst")).toBe("workload_analysis")
    expect(AgentRoleContract.orchestratorWorkflowToolName("general")).toBeUndefined()
    expect(AgentRoleContract.orchestratorWorkflowToolName("mission")).toBeUndefined()
  })

  test("stage continuation runtime validation does not carry a hand-written worker list", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/engine/stage-continuation.ts"), "utf8")

    expect(source).toContain("AgentRoleContract.isProtocolStageContinuationID")
    expect(source).not.toContain('value === "build"')
    expect(source).not.toContain('value === "requirements"')
    expect(source).not.toContain('value === "integrity"')
  })

  test("stage continuation tool pointers read the workflow tool name from the role manifest", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("AgentRoleContract.orchestratorWorkflowToolName")
    expect(source).not.toContain("stage.replaceAll")
    expect(source).not.toContain("Partial<Record<StageContinuationStage")
  })

  test("agent coordination redispatch bindings are owned by the role manifest", () => {
    expect(AgentRoleContract.agentCoordinationRedispatchIDs()).toEqual(
      AgentRoleContract.agentOwnedTaskWorkerIDs(),
    )

    for (const role of AgentRoleContract.agentOwnedTaskWorkerIDs()) {
      const binding = AgentRoleContract.agentCoordinationRedispatchBinding(role)
      expect(binding, `${role} must declare one redispatch binding`).toBeDefined()
      expect(binding).toMatchObject({ stage: role, target_kind: role })
      expect(binding!.dispatcher.endsWith("_stage"), `${role} dispatcher must name a stage adapter`).toBe(true)
    }

    expect(AgentRoleContract.agentCoordinationRedispatchBinding("mission")).toBeUndefined()
    expect(AgentRoleContract.agentCoordinationRedispatchBinding("general")).toBeUndefined()
  })

  test("orchestrator redispatch response code reads bindings from the role manifest", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("AgentRoleContract.agentCoordinationRedispatchBinding")
    expect(source).not.toContain("AGENT_COORDINATION_REDISPATCH_REPLAY_BINDINGS")
    expect(source).not.toContain("redispatchBinding: {")
  })

  test("direct-reply task-worker policy reads from the role manifest", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/direct-reply.ts"), "utf8")

    expect(source).toContain("AgentRoleContract.directSessionReplyIDs()")
    expect(source).not.toContain('"requirements",')
    expect(source).not.toContain('"architect",')
    expect(source).not.toContain('"frontend-design",')
    expect(source).not.toContain('"intent-analysis",')
    expect(source).not.toContain('"integrity",')
  })

  test("direct reply resume eligibility is not build-specific", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/task-api/index.ts"), "utf8")
    const taxonomy = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/direct-reply.ts"), "utf8")

    expect(source).toContain("canReceiveDirectAgentReply(target.prompt.agent)")
    expect(source).not.toContain('target.prompt.agent === "build"')
    expect(source).not.toContain('target.session.kind === "build"')
    expect(source).not.toContain("BuildSessionDirectReplyError")
    expect(taxonomy).not.toContain("BuildSessionDirectReplyError")
  })

  test("operator steer coverage derives target workers from the role manifest", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(
      path.join(root, "packages/opencorvus/test/server/task-session-operator-steer.test.ts"),
      "utf8",
    )

    expect(source).toContain("AgentRoleContract.agentOwnedTaskWorkerIDs()")
    expect(source).not.toContain('const OPERATOR_STEER_TARGET_KINDS = [')
  })

  test("non-disable-configurable evidence agents are declared by the role manifest", () => {
    expect(AgentRoleContract.nonDisableConfigurableIDs()).toEqual([
      "fact-check",
      "deep-research",
      "frontend-research",
    ])

    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/agent/agent.ts"), "utf8")
    expect(source).not.toContain("fixed" + "ReadonlyAgents")
    expect(source).toContain("role.disableConfigurable")
  })

  test("non-executor source-boundary exemptions are declared by the role manifest", () => {
    expect(
      AgentRoleContract.ids.filter((role) => AgentRoleContract.get(role).nonExecutorSourceBoundaryExempt),
    ).toEqual(["build", "visual-qa", "integrity"])

    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/prompt/non-executor-source-boundary.ts"), "utf8")
    expect(source).toContain("AgentRoleContract.isNonExecutorSourceBoundaryExempt")
    expect(source).not.toContain("SOURCE_BOUNDARY" + "_EXEMPT_AGENT_IDS")
    expect(source).not.toContain("integrity-team")
    expect(source).not.toContain("visual_qa")
  })

  test("live tool ownership cancellation policy is declared by the role manifest", () => {
    expect(AgentRoleContract.liveOrchestratorToolOwnershipControlIDs()).toEqual(["build"])
    expect(AgentRoleContract.usesLiveOrchestratorToolOwnershipControl("build")).toBe(true)
    expect(AgentRoleContract.usesLiveOrchestratorToolOwnershipControl("architect")).toBe(false)

    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")
    expect(source).toContain("AgentRoleContract.usesLiveOrchestratorToolOwnershipControl")
    expect(source).not.toContain('staleRecovery && kind !== "build"')
    expect(source).not.toContain('staleRecovery && kind === "build"')
    expect(source).not.toContain('kind === "build" && liveOwner')
  })
})
