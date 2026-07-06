import fs from "node:fs/promises"
import path from "node:path"
import type { ToolSet } from "ai"
import { runAgentSession } from "@/agent/runner"
import { renderAgentContextPacketSection, type AgentContextPacket } from "@/agent/context-packet"
import { Agent } from "@/agent/agent"
import { createAgentCoordinationRuntimeTools } from "@/agent/coordination-runtime-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { createReadonlyRetrievalTools } from "@/agent/retrieval-tools"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Instance } from "@/project/instance"
import { taskPrimaryProjectRoot } from "@/project/task-runtime-root"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import type { LiveWebpageEvidenceProgress } from "@/orchestrator/webpage-evidence"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"
import { createAiSdkToolFromInfo } from "@/tool/ai-sdk-adapter"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "@/tool/skill"
import { clarificationTranscriptSection, operatorNotesSection } from "@/engine/helpers"
import { isHttpWebpageUrl } from "@/util/web-url"
import {
  buildResearchBriefFromDraft,
  createResearchOutputTools,
  researchBundleFromDraft,
  type ResearchCollector,
  type ResearchToolCallReplay,
} from "./output-tools"
import {
  prepareWebpagePrdEvidence,
  readPreparedWebpagePrdEvidence,
  renderWebpagePrdEvidencePromptSection,
  type WebpagePrdEvidence,
} from "./webpage-prd-evidence"
import {
  RESEARCH_VOLATILE_STALE_AFTER_MS,
  researchRequestHash,
  type ResearchBrief,
  type ResearchBundle,
} from "./schema"
import { researchRequestHashInput } from "./staleness"

import DEEP_RESEARCH_CORE from "@/prompt/core/deep-research-core.txt"

const log = Log.create({ service: "deep-research-agent" })
export type ResearchLikeAgentKind = "deep-research" | "frontend-research"

export interface ResearchSessionConfig {
  kind: ResearchLikeAgentKind
  core: string
  sessionTitlePrefix: string
  prepareWebpageEvidence: "none" | "prd-only" | "always-for-source-url" | "read-existing-for-source-url"
  bundlePathKind: "deep-research" | "frontend-research"
  retrievalTools: "readonly" | "none"
  delegation: string
}

export namespace DeepResearchAgent {
  export interface RunInput {
    title: string
    request: string
    targetDeliverable?: "prd" | "spec" | "research_report" | "implementation_input" | "mixed"
    sourceUrls?: string[]
    focus?: string
    reason?: string
    /** Upstream agent handoff packets supplied by the scheduler. */
    contextPackets?: AgentContextPacket[]
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    continuation?: AgentSessionContinuation
    onSessionCreated?: (sessionID: string) => void
  }

  export interface RunResult {
    brief: ResearchBrief
    bundle: ResearchBundle
    factCheckItems: FactCheckItem[]
    sessionID: string
  }

  export async function run(input: RunInput): Promise<RunResult> {
    return runResearchSession(input, {
      kind: "deep-research",
      core: DEEP_RESEARCH_CORE,
      sessionTitlePrefix: "Deep Research",
      prepareWebpageEvidence: "prd-only",
      bundlePathKind: "deep-research",
      retrievalTools: "readonly",
      delegation:
        "Orchestrator is asking deep-research to gather durable multi-source evidence and prepare PRD/SPEC/report input material. " +
        "Return source-backed evidence, problem statements, user needs, constraints, document outline, and open questions only. " +
        "Do not produce final REQ-N, acceptance specs, goal graph, implementation plan, or next-tool routing instructions.",
    })
  }
}

export async function runResearchSession(
  input: DeepResearchAgent.RunInput,
  config: ResearchSessionConfig,
): Promise<DeepResearchAgent.RunResult> {
  const sessionTitle = `${config.sessionTitlePrefix}: ${input.title}`
  const session = input.continuation
    ? await Session.get(input.continuation.sessionID)
    : await Session.createNext({
        kind: config.kind,
        parentID: input.parentSessionID,
        title: sessionTitle,
        directory: Instance.directory,
      })
  if (!input.continuation) input.onSessionCreated?.(session.id)

  let webpagePrdEvidence: WebpagePrdEvidence | undefined
  const reportWebpageEvidenceProgress = async (progress: LiveWebpageEvidenceProgress) => {
    SessionStatus.set(session.id, { type: "streaming" })
    await input.onStatus?.(progress.summary)
  }
  try {
    webpagePrdEvidence = input.continuation
      ? undefined
      : await prepareInputWebpagePrdEvidence(input, config.prepareWebpageEvidence, reportWebpageEvidenceProgress)
  } catch (err) {
    SessionStatus.set(session.id, {
      type: "terminal",
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  const retrievalTools =
    config.retrievalTools === "readonly"
      ? await filterAgentTools(createReadonlyRetrievalTools(), config.kind, {
          taskID: input.taskID,
          sessionID: input.parentSessionID,
        })
      : {}
  const utilityTools = await filterAgentTools(
    await createResearchUtilityTools(config.kind, {
      taskID: input.taskID,
      signal: input.signal,
    }),
    config.kind,
    {
      taskID: input.taskID,
      sessionID: input.parentSessionID,
    },
  )
  const expectedWebpageSourceUrl =
    config.kind === "frontend-research" ? input.sourceUrls?.find(isHttpWebpageUrl) : undefined
  const outputToolKit = createResearchOutputTools({ expectedWebpageSourceUrl })
  if (input.continuation) {
    const replayed = await outputToolKit.replayUpdateToolCalls(await completedResearchOutputToolCalls(session.id))
    log.info(`${config.kind} continuation collector hydrated`, {
      sessionID: session.id,
      replayedToolCalls: replayed,
    })
  }

  log.info(`${config.kind} starting`, {
    title: input.title,
    targetDeliverable: input.targetDeliverable,
    hasFocus: Boolean(input.focus?.trim()),
  })

  const out = await runAgentSession<ResearchCollector>({
    kind: config.kind,
    core: withFactCheckRegistration(config.core),
    sessionTitle,
    existingSessionID: session.id,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    model: input.model,
    signal: input.signal,
    continuation: input.continuation,
    onStatus: input.onStatus,
    toolKit: {
      tools: { ...retrievalTools, ...utilityTools, ...outputToolKit.tools },
      stageOwnedToolIDs: Object.keys(outputToolKit.tools),
      getCollector: outputToolKit.getCollector,
      buildReport: outputToolKit.buildReport,
    },
    buildUserPrompt: () => buildUserPrompt(input, webpagePrdEvidence, config),
    terminalTool: {
      toolName: "submit_research_brief",
      isSatisfied: (collector) => collector.finalized,
      shouldExposeOnlyTerminalTool: () => outputToolKit.isReadyToSubmit(),
    },
  })

  const collector = out.collector
  if (!collector.finalized || !collector.draft) {
    throw new Error(`${config.kind} agent did not call submit_research_brief (session=${out.session.id})`)
  }

  const bundle = researchBundleFromDraft(collector.draft)
  const bundlePaths = await writeResearchBundle({
    taskID: input.taskID,
    sessionID: out.session.id,
    bundle,
    kind: config.bundlePathKind,
  })
  const createdAt = new Date()
  const requestHashInput = researchRequestHashInput({
    request: input.request,
    clarificationTranscript: input.taskID ? clarificationTranscriptSection(input.taskID) : undefined,
    operatorNotes: input.taskID ? operatorNotesSection(input.taskID) : undefined,
  })
  const brief = buildResearchBriefFromDraft({
    draft: collector.draft,
    metadata: {
      research_session_id: out.session.id,
      created_for_message_id: out.finalMessage.info.id,
      request_hash: researchRequestHash(requestHashInput),
      created_at: createdAt.toISOString(),
      stale_after: collector.draft.evidence_index.some((item) => item.volatile)
        ? new Date(createdAt.getTime() + RESEARCH_VOLATILE_STALE_AFTER_MS).toISOString()
        : undefined,
    },
    bundlePaths,
  })
  const factCheckItems = FactCheckItemListSchema.parse(collector.fact_check_items)

  log.info(`${config.kind} finished`, {
    sessionID: out.session.id,
    sources: brief.evidence_index.length,
    facts: brief.facts.length,
    blockingOpenQuestions: brief.open_questions.filter((item) => item.blocking).length,
  })

  return { brief, bundle, factCheckItems, sessionID: out.session.id }
}

async function completedResearchOutputToolCalls(sessionID: string): Promise<ResearchToolCallReplay[]> {
  const messages = await Session.messages({ sessionID })
  const calls: ResearchToolCallReplay[] = []
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      calls.push({ toolName: part.tool, input: part.state.input })
    }
  }
  return calls
}

async function createResearchUtilityTools(
  kind: ResearchLikeAgentKind,
  input: { taskID?: string; signal?: AbortSignal },
): Promise<ToolSet> {
  const coordinationTools = await createAgentCoordinationRuntimeTools({
    agent: kind,
    taskID: input.taskID,
    signal: input.signal,
  })
  if (kind !== "frontend-research") return coordinationTools
  const agent = await Agent.get("frontend-research")
  if (!agent) throw new Error("frontend-research agent definition is missing")
  return {
    ...coordinationTools,
    skill: await createResearchTool(SkillTool, {
      ...input,
      agentName: "frontend-research",
      initCtx: { agent },
    }),
  }
}

async function createResearchTool(
  info: Tool.Info,
  input: {
    agentName: ResearchLikeAgentKind
    taskID?: string
    signal?: AbortSignal
    initCtx?: Tool.InitContext
  },
) {
  return createAiSdkToolFromInfo({
    info,
    agent: input.agentName,
    taskID: input.taskID,
    signal: input.signal,
    initCtx: input.initCtx,
  })
}

async function prepareInputWebpagePrdEvidence(
  input: DeepResearchAgent.RunInput,
  mode: ResearchSessionConfig["prepareWebpageEvidence"],
  onProgress?: (progress: LiveWebpageEvidenceProgress) => void | Promise<void>,
): Promise<WebpagePrdEvidence | undefined> {
  const sourceUrls = input.sourceUrls ?? []
  const hasWebpageSource = sourceUrls.some(isHttpWebpageUrl)
  if (!hasWebpageSource) return undefined
  if (mode === "none") return undefined
  if (mode === "prd-only" && input.targetDeliverable !== "prd") return undefined
  if (!input.taskID) {
    throw new Error("webpage PRD research requires taskID so rendered evidence can be persisted under task runtime")
  }
  const projectDir = researchTaskProjectRoot(input.taskID)
  if (mode === "read-existing-for-source-url") {
    try {
      return await readPreparedWebpagePrdEvidence({
        projectDir,
        taskID: input.taskID,
        url: sourceUrls.find(isHttpWebpageUrl)!,
      })
    } catch (err) {
      log.info("frontend-research prepared webpage evidence not yet available", {
        taskID: input.taskID,
        error: err instanceof Error ? err.message : String(err),
      })
      return undefined
    }
  }
  return prepareWebpagePrdEvidence({
    projectDir,
    worktreeDir: projectDir,
    taskID: input.taskID,
    sourceUrls,
    signal: input.signal,
    onProgress,
  })
}

function buildUserPrompt(
  input: DeepResearchAgent.RunInput,
  webpagePrdEvidence: WebpagePrdEvidence | undefined,
  config: ResearchSessionConfig,
): string {
  const sections: string[] = []
  sections.push(`# Delegation\n\n${config.delegation}`)
  sections.push(
    renderUserRequestSection({
      heading: "# Task",
      title: input.title,
      request: input.request,
      taskID: input.taskID,
    }),
  )
  if (input.reason?.trim()) sections.push(`# Why Research Was Requested\n\n${input.reason.trim()}`)
  if (input.targetDeliverable) sections.push(`# Target Deliverable\n\n${input.targetDeliverable}`)
  if (input.sourceUrls && input.sourceUrls.length > 0) {
    sections.push(`# Source URLs\n\n${input.sourceUrls.map((url) => `- ${url}`).join("\n")}`)
  }
  const webpageEvidenceSection = renderWebpagePrdEvidencePromptSection(webpagePrdEvidence)
  if (webpageEvidenceSection) sections.push(webpageEvidenceSection)
  const contextPackets = renderAgentContextPacketSection(input.contextPackets)
  if (contextPackets) sections.push(contextPackets)
  if (input.focus?.trim()) sections.push(`# Focus\n\n${input.focus.trim()}`)
  sections.push(
    "# Output Boundary\n\n" +
      "Build the research brief through small `update_*` result tools, then call `submit_research_brief({ final: true })` exactly once. If finalization reports missing fragments, call the listed `update_*` tools and submit again; do not retry a giant result payload. The tool result is an evidence artifact, not a process pointer. " +
      "Never write `NEXT: call ...`, never recommend `publish_acceptance`, and never tell the orchestrator which tool must run next.",
  )
  return sections.join("\n\n")
}

async function writeResearchBundle(input: {
  taskID?: string
  sessionID: string
  bundle: ResearchBundle
  kind: ResearchSessionConfig["bundlePathKind"]
}): Promise<ResearchBrief["bundle"]> {
  if (!input.taskID) {
    throw new Error("research bundle persistence requires taskID")
  }
  const projectDir = researchTaskProjectRoot(input.taskID)
  const paths =
    input.kind === "frontend-research"
      ? ProjectRuntimePaths.frontendResearchPaths(projectDir, input.taskID, input.sessionID)
      : ProjectRuntimePaths.deepResearchPaths(projectDir, input.taskID, input.sessionID)
  await fs.mkdir(paths.absoluteDir, { recursive: true })
  await Promise.all([
    fs.writeFile(paths.fullMarkdownAbsolute, input.bundle.full_markdown, "utf8"),
    fs.writeFile(paths.evidenceJsonAbsolute, input.bundle.evidence_json, "utf8"),
    fs.writeFile(paths.citationMapAbsolute, input.bundle.citation_map_json, "utf8"),
  ])
  return {
    full_markdown_path: path.relative(projectDir, paths.fullMarkdownAbsolute).replaceAll("\\", "/"),
    evidence_json_path: path.relative(projectDir, paths.evidenceJsonAbsolute).replaceAll("\\", "/"),
    citation_map_path: path.relative(projectDir, paths.citationMapAbsolute).replaceAll("\\", "/"),
  }
}

function researchTaskProjectRoot(taskID: string): string {
  return taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
}
