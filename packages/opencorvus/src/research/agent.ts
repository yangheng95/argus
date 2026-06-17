import fs from "node:fs/promises"
import path from "node:path"
import type { ToolSet } from "ai"
import { runAgentSession } from "@/agent/runner"
import { Agent } from "@/agent/agent"
import { filterAgentTools } from "@/agent/filter-tools"
import { createReadonlyRetrievalTools } from "@/agent/retrieval-tools"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"
import { createAiSdkToolFromInfo } from "@/tool/ai-sdk-adapter"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "@/tool/skill"
import { clarificationTranscriptSection, operatorNotesSection } from "@/engine/helpers"
import {
  buildResearchBriefFromDraft,
  createResearchOutputTools,
  researchBundleFromDraft,
  type ResearchCollector,
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
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
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
  const session = await Session.createNext({
    kind: config.kind,
    parentID: input.parentSessionID,
    title: sessionTitle,
    directory: Instance.directory,
  })
  input.onSessionCreated?.(session.id)

  let webpagePrdEvidence: WebpagePrdEvidence | undefined
  try {
    webpagePrdEvidence = await prepareInputWebpagePrdEvidence(input, config.prepareWebpageEvidence)
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
  const utilityTools = await createResearchUtilityTools(config.kind, {
    taskID: input.taskID,
    signal: input.signal,
  })
  const outputToolKit = createResearchOutputTools()

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
    onStatus: input.onStatus,
    toolKit: {
      tools: { ...retrievalTools, ...utilityTools, ...outputToolKit.tools },
      getCollector: outputToolKit.getCollector,
      buildReport: outputToolKit.buildReport,
    },
    buildUserPrompt: () => buildUserPrompt(input, webpagePrdEvidence, config),
    terminalTool: {
      toolName: "submit_research_brief",
      isSatisfied: (collector) => collector.finalized,
      shouldExposeOnlyTerminalTool: () => false,
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

async function createResearchUtilityTools(
  kind: ResearchLikeAgentKind,
  input: { taskID?: string; signal?: AbortSignal },
): Promise<ToolSet> {
  if (kind !== "frontend-research") return {}
  const agent = await Agent.get("frontend-research")
  if (!agent) throw new Error("frontend-research agent definition is missing")
  return {
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
): Promise<WebpagePrdEvidence | undefined> {
  const sourceUrls = input.sourceUrls ?? []
  const hasWebpageSource = sourceUrls.some((url) => /^https?:\/\//i.test(url))
  if (!hasWebpageSource) return undefined
  if (mode === "none") return undefined
  if (mode === "prd-only" && input.targetDeliverable !== "prd") return undefined
  if (!input.taskID) {
    throw new Error("webpage PRD research requires taskID so rendered evidence can be persisted under task runtime")
  }
  if (mode === "read-existing-for-source-url") {
    try {
      return await readPreparedWebpagePrdEvidence({
        projectDir: Instance.directory,
        taskID: input.taskID,
        url: sourceUrls.find((url) => /^https?:\/\//i.test(url))!,
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
    projectDir: Instance.directory,
    worktreeDir: Instance.directory,
    taskID: input.taskID,
    sourceUrls,
    signal: input.signal,
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
  if (input.focus?.trim()) sections.push(`# Focus\n\n${input.focus.trim()}`)
  sections.push(
    "# Output Boundary\n\n" +
      "Build the research brief through small registration tools, then call `submit_research_brief({ final: true })` exactly once. The tool result is an evidence artifact, not a process pointer. " +
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
  const paths =
    input.kind === "frontend-research"
      ? ProjectRuntimePaths.frontendResearchPaths(Instance.directory, input.taskID, input.sessionID)
      : ProjectRuntimePaths.deepResearchPaths(Instance.directory, input.taskID, input.sessionID)
  await fs.mkdir(paths.absoluteDir, { recursive: true })
  await Promise.all([
    fs.writeFile(paths.fullMarkdownAbsolute, input.bundle.full_markdown, "utf8"),
    fs.writeFile(paths.evidenceJsonAbsolute, input.bundle.evidence_json, "utf8"),
    fs.writeFile(paths.citationMapAbsolute, input.bundle.citation_map_json, "utf8"),
  ])
  return {
    full_markdown_path: path.relative(Instance.directory, paths.fullMarkdownAbsolute).replaceAll("\\", "/"),
    evidence_json_path: path.relative(Instance.directory, paths.evidenceJsonAbsolute).replaceAll("\\", "/"),
    citation_map_path: path.relative(Instance.directory, paths.citationMapAbsolute).replaceAll("\\", "/"),
  }
}
