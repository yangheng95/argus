import { WorkflowRegistry, type OrchestratorWorkflowToolName } from "@/engine/workflow"
import { AgentRoleContract, type AgentRoleID } from "./role-contract"
import { AgentToolPool, type ToolPoolAssignment } from "./tool-pool-contract"

// Derived diagnostics projection only. Runtime facts are authored by
// AgentRoleContract, AgentToolPool, and WorkflowRegistry.
export interface AgentBaseRuntimeProjection {
  role: AgentRoleID
  archetype: ReturnType<typeof AgentRoleContract.archetype>
  controlSurface: ReturnType<typeof AgentRoleContract.controlSurface>
  session: {
    kind: AgentRoleID | undefined
    agentOwned: boolean
    runtimeContractRequired: boolean
    exactRuntimeContract: boolean
    liveRuntimeContinuation: boolean
    protocolStageContinuation: boolean
    directSessionReply: boolean
    liveOrchestratorToolOwnershipControl: boolean
  }
  workflow: {
    schedulerWorkflowTools: OrchestratorWorkflowToolName[]
  }
  hostTools: ToolPoolAssignment
  packageProjection: {
    promptOverlay: boolean
    skills: boolean
    packageTools: boolean
    packageMcp: boolean
    /** Package-local display/prompt identity metadata, not workflow or host-tool ownership. */
    virtualAgent: boolean
  }
}

export namespace AgentBaseRuntimeContract {
  function workerRuntimeProjectionEnabled(contract: AgentRoleContract): boolean {
    return (
      contract.controlSurface === "task-worker" &&
      contract.agentOwnedSessionKind &&
      contract.runtimeContractRequired
    )
  }

  export function project(role: AgentRoleID): AgentBaseRuntimeProjection {
    const contract = AgentRoleContract.get(role)
    const workerProjectionEnabled = workerRuntimeProjectionEnabled(contract)
    return {
      role,
      archetype: contract.archetype,
      controlSurface: contract.controlSurface,
      session: {
        kind: contract.agentOwnedSessionKind ? role : undefined,
        agentOwned: contract.agentOwnedSessionKind,
        runtimeContractRequired: contract.runtimeContractRequired,
        exactRuntimeContract: contract.exactRuntimeContract,
        liveRuntimeContinuation: contract.liveRuntimeContinuation,
        protocolStageContinuation: contract.protocolStageContinuation,
        directSessionReply: contract.directSessionReply,
        liveOrchestratorToolOwnershipControl: contract.liveOrchestratorToolOwnershipControl,
      },
      workflow: {
        schedulerWorkflowTools: WorkflowRegistry.schedulerAgentWorkflowBindingsSync()
          .filter((binding) => binding.stage === role)
          .map((binding) => binding.workflow_tool_name),
      },
      hostTools: AgentToolPool.assignment(role),
      packageProjection: {
        promptOverlay: contract.promptProfileTarget !== "none",
        skills: workerProjectionEnabled && contract.skillMountable,
        packageTools: workerProjectionEnabled,
        packageMcp: workerProjectionEnabled,
        virtualAgent: workerProjectionEnabled,
      },
    }
  }

  export function all(): AgentBaseRuntimeProjection[] {
    return AgentRoleContract.ids.map((role) => project(role))
  }
}
