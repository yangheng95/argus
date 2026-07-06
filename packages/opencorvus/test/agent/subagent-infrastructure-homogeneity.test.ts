import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { AgentRoleContract, type AgentRoleID } from "../../src/agent/role-contract"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { isStageContinuationStage } from "../../src/engine/stage-continuation"
import { WorkflowRegistry, type OrchestratorWorkflowToolName } from "../../src/engine/workflow"
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

const workflowToolNames = [
  "requirements",
  "architect",
  "frontend_design",
  "frontend_research",
  "deep_research",
  "visual_qa",
  "workload_analysis",
  "analyze_intent",
  "fact_check",
  "build",
  "explore",
  "integrity",
] as const satisfies readonly OrchestratorWorkflowToolName[]

const taskWorkerContextProtocolFiles = {
  architect: "packages/opencorvus/src/architect/agent.ts",
  build: "packages/opencorvus/src/build/agent.ts",
  "deep-research": "packages/opencorvus/src/research/agent.ts",
  explore: "packages/opencorvus/src/explore/agent.ts",
  "fact-check": "packages/opencorvus/src/fact-check/index.ts",
  "frontend-design": "packages/opencorvus/src/frontend-design/agent.ts",
  "frontend-research": "packages/opencorvus/src/frontend-research/agent.ts",
  "goal-workload-analyst": "packages/opencorvus/src/goal-workload-analyst/prompt.ts",
  "intent-analysis": "packages/opencorvus/src/intent-analysis/agent.ts",
  integrity: "packages/opencorvus/src/integrity/team-agent.ts",
  requirements: "packages/opencorvus/src/requirements/agent.ts",
  "visual-qa": "packages/opencorvus/src/visual-qa/agent.ts",
} as const satisfies Partial<Record<AgentRoleID, string>>

function builtInSchedulerBindings() {
  return WorkflowRegistry.schedulerAgentWorkflowBindingsSync()
}

function builtInSchedulerRoles(): AgentRoleID[] {
  return builtInSchedulerBindings()
    .map((binding) => binding.stage)
    .sort()
}

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
        WorkflowRegistry.schedulerWorkflowToolForRoleSync(role),
        `${role} continuation must have a scheduler-declared workflow tool`,
      ).toBeDefined()
      expect(isStageContinuationStage(role), `${role} must validate through the shared stage guard`).toBe(true)
    }
  })

  test("orchestrator workflow tool names are owned by the scheduler workflow registry", () => {
    expect(
      Object.fromEntries(builtInSchedulerBindings().map((binding) => [binding.stage, binding.workflow_tool_name])),
    ).toEqual({
      architect: "architect",
      build: "build",
      "deep-research": "deep_research",
      "fact-check": "fact_check",
      "frontend-design": "frontend_design",
      "frontend-research": "frontend_research",
      "goal-workload-analyst": "workload_analysis",
      integrity: "integrity",
      "intent-analysis": "analyze_intent",
      requirements: "requirements",
      "visual-qa": "visual_qa",
    })
    expect(WorkflowRegistry.schedulerWorkflowToolForRoleSync("explore")).toBeUndefined()
    expect(WorkflowRegistry.schedulerWorkflowToolForRoleSync("general")).toBeUndefined()
    expect(WorkflowRegistry.schedulerWorkflowToolForRoleSync("mission")).toBeUndefined()
  })

  test("workflow tool name validation covers the complete orchestrator workflow tool union", () => {
    for (const tool of workflowToolNames) {
      expect(WorkflowRegistry.isWorkflowToolName(tool), `${tool} must be accepted as a workflow tool name`).toBe(true)
    }

    expect(WorkflowRegistry.isWorkflowToolName("frontend-design")).toBe(false)
    expect(WorkflowRegistry.isWorkflowToolName("unknown_workflow_tool")).toBe(false)
  })

  test("stage continuation runtime validation does not carry a hand-written worker list", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/engine/stage-continuation.ts"), "utf8")

    expect(source).toContain("AgentRoleContract.isProtocolStageContinuationID")
    expect(source).not.toContain('value === "build"')
    expect(source).not.toContain('value === "requirements"')
    expect(source).not.toContain('value === "integrity"')
  })

  test("stage continuation tool pointers use the active workflow binding", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("toolName: OrchestratorWorkflowToolName")
    expect(source).toContain('toolName: schedulerWorkflowToolName("integrity")')
    expect(source).toContain('toolName: schedulerWorkflowToolName("fact-check")')
    expect(source).not.toContain("WorkflowRegistry.schedulerWorkflowToolForRoleSync")
    expect(source).not.toContain("WorkflowRegistry.schedulerAgentWorkflowBindingForRoleSync")
    expect(source).not.toContain("AgentRoleContract.orchestratorWorkflowToolName")
    expect(source).not.toContain("stage.replaceAll")
    expect(source).not.toContain("Partial<Record<StageContinuationStage")
  })

  test("orchestrator workflow selection does not fall back to the pipeline workflow", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/agent.ts"), "utf8")

    expect(source).toContain('throw new Error(`Orchestrator workflow "${workflowID}" is not registered`)')
    expect(source).not.toContain('?? WorkflowRegistry.resolveSync("pipeline")')
    expect(source).not.toContain("WorkflowRegistry.resolveSync(\"pipeline\")")
  })

  test("current architecture docs keep workflow names out of agent-role contracts", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const docs = [
      "specs/current/architecture/01-agents.md",
      "specs/current/architecture/04-extensions.md",
      "specs/current/architecture/13-agent-communication-matrix.md",
    ]

    for (const file of docs) {
      const source = readFileSync(path.join(root, file), "utf8")
      expect(source, file).not.toContain("direct workflow 选择")
      expect(source, file).not.toContain("pipeline workflow 或 Orchestrator")
      expect(source, file).not.toContain("task-level direct 默认")
      expect(source, file).not.toContain("pipeline 流程里")
      expect(source, file).not.toContain("pipeline build 路径里")
    }
  })

  test("current architecture pins expert-squad authority to repository packages", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const extensions = readFileSync(path.join(root, "specs/current/architecture/04-extensions.md"), "utf8")
    const julyIndex = readFileSync(path.join(root, "specs/records/2026-07/README.md"), "utf8")

    expect(extensions).toContain("## Expert Squad Package")
    expect(extensions).toContain("Expert squad 是 OpenCorvus 内部的 scenario / agent capability package")
    expect(extensions).toContain("Personal Codex skills, local checklists, or historical task records")
    expect(extensions).toContain("are not runtime authority")
    expect(extensions).toContain("current repository sources win")
    expect(extensions).toContain("workflow 仍由 scheduler scope 的 `WorkflowRegistry` 声明")
    expect(extensions).toContain("不能创建第二套 workflow、dispatch、context packet")
    expect(julyIndex).toContain("historical personal Codex skill experiment")
    expect(julyIndex).toContain("not that personal skill")
    expect(julyIndex).not.toContain("personal Codex skill for adding future OpenCorvus expert squads")
  })

  test("agent coordination redispatch bindings derive from scheduler workflow declarations", () => {
    const bindings = builtInSchedulerBindings()
    expect(bindings.map((binding) => binding.stage).sort()).toEqual(builtInSchedulerRoles())
    expect(builtInSchedulerRoles()).toEqual(
      [
        ...new Set(
          Object.values(WorkflowRegistry.builtIn).flatMap((workflow) =>
            workflow.steps.map((step) => step.agentRole).filter((role): role is AgentRoleID => Boolean(role)),
          ),
        ),
      ].sort(),
    )

    for (const role of builtInSchedulerRoles()) {
      const binding = WorkflowRegistry.schedulerAgentWorkflowBindingForRoleSync(role)
      expect(binding, `${role} must declare one redispatch binding`).toBeDefined()
      expect(binding).toMatchObject({ stage: role, target_kind: role })
      expect(binding!.workflow_tool_name).toBe(WorkflowRegistry.schedulerWorkflowToolForRoleSync(role))
    }

    const pipeline = WorkflowRegistry.resolveSync("pipeline")
    expect(WorkflowRegistry.schedulerAgentWorkflowBindingForRoleInWorkflow(pipeline, "explore")).toBeUndefined()
    const direct = WorkflowRegistry.resolveSync("direct")
    expect(WorkflowRegistry.schedulerAgentWorkflowBindingForRoleInWorkflow(direct, "deep-research")).toBeUndefined()
    expect(WorkflowRegistry.schedulerAgentWorkflowBindingForRoleInWorkflow(direct, "explore")).toBeUndefined()
    expect(WorkflowRegistry.schedulerAgentWorkflowBindingForRoleInWorkflow(direct, "fact-check")).toBeUndefined()
    expect(WorkflowRegistry.schedulerAgentWorkflowBindingForRoleSync("mission")).toBeUndefined()
    expect(WorkflowRegistry.schedulerAgentWorkflowBindingForRoleSync("general")).toBeUndefined()
  })

  test("orchestrator redispatch response code reads bindings from the scheduler registry", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("WorkflowRegistry.schedulerAgentWorkflowBindingForRoleInWorkflow")
    expect(source).toContain("const schedulerRedispatchStrategies = {")
    expect(source).toContain("schedulerRedispatchStrategies[binding.workflow_tool_name]")
    expect(source).not.toContain("const redispatchHandlers = {")
    expect(source).not.toContain("request.payload.agent ===")
    expect(source).not.toContain("AgentRoleContract.agentCoordinationRedispatchBinding")
    expect(source).not.toContain("AGENT_COORDINATION_REDISPATCH_REPLAY_BINDINGS")
    expect(source).not.toContain("redispatchBinding: {")
    expect(source).not.toContain("priorResult.workflow_tool_name")
    expect(source).not.toContain("binding?.workflow_tool_name")
  })

  test("worker coordination requests describe scheduling questions rather than redispatch actions", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/tool/request-orchestrator-decision.ts"), "utf8")
    const coordination = readFileSync(path.join(root, "packages/opencorvus/src/engine/agent-coordination.ts"), "utf8")

    expect(source).toContain("Do not use response action literals such as redispatch or redispatch_worker")
    expect(source).not.toContain("or redispatch policy")
    expect(coordination).toContain("assertRequestedDecisionIsNotRedispatchActionLiteral")
    expect(coordination).toContain("not the redispatch response action literal")
  })

  test("task-worker agent prompt builders use attachment refs instead of hidden file parts", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const files = [
      "packages/opencorvus/src/architect/agent.ts",
      "packages/opencorvus/src/intent-analysis/agent.ts",
      "packages/opencorvus/src/requirements/agent.ts",
      "packages/opencorvus/src/frontend-design/agent.ts",
      "packages/opencorvus/src/integrity/team-agent.ts",
      "packages/opencorvus/src/orchestrator/agent.ts",
    ]

    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8")
      expect(source, file).not.toContain("AttachmentStore.inlineFileParts")
      expect(source, file).not.toContain("AttachmentStore.renderAttachmentInventory")
      expect(source, file).not.toContain("inlined as file part")
      expect(source, file).not.toContain("inlined above as multimodal parts")
    }
  })

  test("build consumes upstream agent context through shared context packets", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const buildSource = readFileSync(path.join(root, "packages/opencorvus/src/build/agent.ts"), "utf8")
    const orchestratorSource = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")

    expect(buildSource).toContain("contextPackets?: AgentContextPacket[]")
    for (const field of [
      "frontendResearch?: string",
      "frontendDesign?: string",
      "integrityFeedback?: string",
      "visualQaFeedback?: string",
      "acceptanceFeedback?: string",
    ]) {
      expect(buildSource, field).not.toContain(field)
    }
    expect(orchestratorSource).toContain("buildAgentContextPackets")
    expect(orchestratorSource).not.toContain("visualQaFeedback: visualQaFeedback")
    expect(orchestratorSource).not.toContain("integrityFeedback: integrityFeedback")
    expect(orchestratorSource).not.toContain("acceptanceFeedback: acceptanceFeedback")
  })

  test("build visual handoff derives from frontend-design decision entries instead of rendered prose", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("function frontendDesignBuildVisualHandoff(entries: readonly DecisionEntry[])")
    expect(source).toContain('latest.get("frontend_project")')
    expect(source).toContain("parseFrontendProjectDecisionEntry")
    expect(source).not.toContain("function frontendDesignBuildVisualHandoff(body")
    expect(source).not.toContain('body.includes("web-clone-source/")')
    expect(source).not.toContain('body.includes("source_baseline_input")')
    expect(source).not.toContain("function frontendDesignProjectRole")
    expect(source).not.toContain("exec(value)")
  })

  test("integrity prompt builders derive replay context from shared packets", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/integrity/team-agent.ts"), "utf8")

    expect(source).toContain("function replayContextForPrompt(input: ReviewPromptInput)")
    expect(source).toContain("integrityReplayContextFromContextPackets(input.contextPackets)")
    expect(source).not.toContain("replayContext: IntegrityReplayContext")
    expect(source).not.toContain("input.replayContext")
  })

  test("general expert-squad selectors load package selector instructions", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const source = readFileSync(path.join(root, "packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts"), "utf8")
    const selectorStart = source.indexOf("async function selectorCatalog")
    const selectorEnd = source.indexOf("export async function resolveSkillProjection", selectorStart)

    expect(selectorStart).toBeGreaterThanOrEqual(0)
    expect(selectorEnd).toBeGreaterThan(selectorStart)
    const selectorCatalogSource = source.slice(selectorStart, selectorEnd)

    expect(selectorCatalogSource).toContain("Promise<ProjectSelectorPackage[]>")
    expect(selectorCatalogSource).toContain("discoverProjectPackages(projectDirectory)")
    expect(selectorCatalogSource).toContain("assertNoBuiltInCollision(entry.id)")
    expect(selectorCatalogSource).toContain("if (!entry.selector) continue")
    expect(selectorCatalogSource).toContain('path.join(packageRoot, "selector.md")')
    expect(selectorCatalogSource).not.toContain("ExpertSquadRegistry.MANIFEST")
    expect(selectorCatalogSource).not.toContain("ExpertSquadRegistry.loadPackage")
    expect(selectorCatalogSource).not.toContain("ExpertSquadRegistry.loadCatalogPackage")

    const discoverStart = source.indexOf("async function discoverProjectPackages")
    const discoverEnd = source.indexOf("async function projectCatalogPackages", discoverStart)
    expect(discoverStart).toBeGreaterThanOrEqual(0)
    expect(discoverEnd).toBeGreaterThan(discoverStart)
    const discoverSource = source.slice(discoverStart, discoverEnd)
    expect(discoverSource).toContain("ExpertSquadRegistry.discover(projectDirectory)")
    expect(discoverSource).toContain("assertNoBuiltInCollision(entry.id)")
    expect(discoverSource).not.toContain("ExpertSquadRegistry.loadPackage")

    const loadProjectStart = source.indexOf("async function loadProjectPackageByID")
    const loadProjectEnd = source.indexOf("async function projectPromptProfiles", loadProjectStart)
    expect(loadProjectStart).toBeGreaterThanOrEqual(0)
    expect(loadProjectEnd).toBeGreaterThan(loadProjectStart)
    const loadProjectSource = source.slice(loadProjectStart, loadProjectEnd)
    expect(loadProjectSource).toContain("ExpertSquadRegistry.parseID(profileID)")
    expect(loadProjectSource).toContain("const packageRoot = path.join(canonicalBase(projectDirectory), profileID)")
    expect(loadProjectSource).toContain("lstat(packageRoot)")
    expect(loadProjectSource).toContain("ExpertSquadRegistry.loadPackage(packageRoot, options)")
    expect(loadProjectSource).not.toContain("discoverProjectPackages")
    expect(loadProjectSource).not.toContain("ExpertSquadRegistry.discover")
  })

  test("task-worker agents expose the shared context packet protocol", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const coveredRoles = Object.keys(taskWorkerContextProtocolFiles).sort()
    const expectedRoles = AgentRoleContract.agentOwnedTaskWorkerIDs().sort()
    expect(coveredRoles).toEqual(expectedRoles)

    for (const role of AgentRoleContract.agentOwnedTaskWorkerIDs()) {
      const file = taskWorkerContextProtocolFiles[role]
      if (!file) throw new Error(`${role} is missing from taskWorkerContextProtocolFiles`)
      const source = readFileSync(path.join(root, file), "utf8")
      if (role === "frontend-research") {
        expect(source, `${file} must inherit the deep-research context packet contract`).toContain(
          "DeepResearchAgent.RunInput",
        )
      } else {
        expect(source.includes("AgentContextPacket"), `${file} must accept or render AgentContextPacket`).toBe(true)
      }
      expect(source, `${file} must not define a private Visual QA context packet alias`).not.toContain(
        "VisualQaContextPacket",
      )
      expect(source, `${file} must not define a private evidencePack context input`).not.toContain(
        "evidencePack?: BuildEvidencePack",
      )
      expect(source, `${file} must not define a private inputEvidenceManifest context input`).not.toContain(
        "inputEvidenceManifest?:",
      )
    }
  })

  test("current architecture documents the shared context packet protocol", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")
    const architectureIndex = read("specs/current/architecture/README.md")
    const agentContract = read("specs/current/architecture/11-agent-oop-protocol.md")
    const contextProtocol = read("specs/current/architecture/15-agent-context-packet.md")
    const contextPacketCore = read("packages/opencorvus/src/agent/context-packet.ts")

    expect(architectureIndex).toContain("[15-agent-context-packet.md](15-agent-context-packet.md)")
    expect(agentContract).toContain("[`15-agent-context-packet.md`](15-agent-context-packet.md)")
    expect(contextProtocol).toContain("`AgentContextPacket` is the shared context protocol")
    expect(contextProtocol).toContain("Machine-readable handoff intent lives in `structured.schema`")
    expect(contextProtocol).toContain("Multimodal evidence is reference-based")
    expect(contextProtocol).toContain("Consumers must select packet data with the shared schema helpers")
    expect(contextProtocol).toContain("Consumers must not route by it")
    expect(contextProtocol).toContain("Inline `data:` URLs and likely base64 blobs are forbidden")
    expect(contextProtocol).toContain("## Formal Report Evidence Refs")
    expect(contextProtocol).toContain("`packages/opencorvus/src/evidence/ref.ts`")
    expect(contextProtocol).toContain("must not use bare filesystem paths")
    expect(contextProtocol).toContain("Do not introduce a broad catch-all task manipulation tool")
    expect(contextPacketCore).not.toContain("VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA")
    expect(contextPacketCore).not.toContain("VisualHandoffContextData")
    expect(contextPacketCore).not.toContain("visualHandoffStructuredPart")
    expect(contextPacketCore).not.toContain("intent?: string")
    expect(contextPacketCore).not.toContain("source: part.source")
    expect(contextPacketCore).not.toContain("intent: part.intent")
  })

  test("visual QA report refs use the durable evidence ref protocol", () => {
    const root = path.resolve(import.meta.dirname, "../../../..")
    const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")
    const schema = read("packages/opencorvus/src/visual-qa/schema.ts")
    const annotatedScreenshot = read("packages/opencorvus/src/visual-qa/annotated-screenshot.ts")
    const evidenceRef = read("packages/opencorvus/src/evidence/ref.ts")

    expect(schema).toContain("DurableEvidenceRefSchema")
    expect(schema).toContain("VisualQaReportEvidenceRefSchema")
    expect(schema).not.toContain('describe("Path, URL, command id, or artifact ref.")')
    expect(annotatedScreenshot).not.toContain("fileURLToPath")
    expect(annotatedScreenshot).not.toContain("resolveDirectPath")
    expect(annotatedScreenshot).not.toContain("path.isAbsolute")
    expect(evidenceRef).toContain("browser_preview_evidence")
    expect(evidenceRef).toContain("AttachmentStore URL")
    expect(evidenceRef).toContain("screenshot:// local labels")
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
