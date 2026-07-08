import { resolveAgentModelRef } from "@/agent/model"
import { Bus } from "@/bus"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE, isRightSidebarCodingAssistantSession } from "@/coding-assistant/session"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Message } from "@/session/message"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "mission.caller-receipt" })
const initializedDirectories = new Set<string>()

const TerminalReason = z.enum(["completed", "error", "aborted", "artifact_missing"])

export const MissionCallerMetadata = z.object({
  session_id: Identifier.schema("session"),
  message_id: Identifier.schema("message"),
  surface: z.literal("right-sidebar"),
})
export type MissionCallerMetadata = z.infer<typeof MissionCallerMetadata>

export const MissionReceiptMetadata = z.object({
  message_id: Identifier.schema("message"),
  part_id: Identifier.schema("part"),
  terminal_reason: TerminalReason,
  sent_at: z.number(),
})
export type MissionReceiptMetadata = z.infer<typeof MissionReceiptMetadata>

function missionMetadata(session: Session.Info): Record<string, unknown> | undefined {
  const metadata = session.metadata
  const mission = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).mission : undefined
  return mission && typeof mission === "object" && !Array.isArray(mission)
    ? (mission as Record<string, unknown>)
    : undefined
}

function missionID(session: Session.Info): string {
  const id = missionMetadata(session)?.id
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Mission session ${session.id} is missing metadata.mission.id`)
  }
  return id
}

function missionReceiptMessageID(sessionID: string): string {
  return `msg_mission_receipt_${sessionID}`
}

function missionReceiptPartID(sessionID: string): string {
  return `prt_mission_receipt_${sessionID}`
}

function renderReceipt(input: {
  missionID: string
  missionSessionID: string
  status: Extract<SessionStatus.Info, { type: "terminal" }>
}): string {
  const reasonText =
    input.status.reason === "completed"
      ? "completed"
      : input.status.reason === "error"
        ? "failed"
        : input.status.reason === "aborted"
          ? "aborted"
          : "stopped because a required artifact was missing"
  const lines = [`Mission ${input.missionID} ${reasonText}.`, `Mission session: ${input.missionSessionID}`]
  if (input.status.summary) lines.push(`Summary: ${input.status.summary}`)
  if (input.status.error) lines.push(`Error: ${input.status.error}`)
  return lines.join("\n")
}

export async function attachMissionCaller(input: {
  missionSessionID: string
  callerSession: Session.Info
  callerMessageID: string
}): Promise<Session.Info> {
  if (!isRightSidebarCodingAssistantSession(input.callerSession)) {
    throw new Error(`Mission caller must be a right-sidebar coding assistant session: ${input.callerSession.id}`)
  }
  const missionSession = await Session.get(input.missionSessionID)
  if (missionSession.kind !== "mission") {
    throw new Error(`Mission caller can only be attached to a mission session: ${missionSession.id}`)
  }
  const mission = missionMetadata(missionSession)
  if (!mission) throw new Error(`Mission session ${missionSession.id} is missing metadata.mission`)
  const caller = MissionCallerMetadata.parse({
    session_id: input.callerSession.id,
    message_id: input.callerMessageID,
    surface: "right-sidebar",
  })
  return Session.mergeMetadata({
    sessionID: missionSession.id,
    patch: {
      mission: {
        ...mission,
        caller,
      },
    },
  })
}

export function missionCaller(session: Session.Info): MissionCallerMetadata | undefined {
  const raw = missionMetadata(session)?.caller
  if (raw === undefined) return undefined
  return MissionCallerMetadata.parse(raw)
}

export function missionReceipt(session: Session.Info): MissionReceiptMetadata | undefined {
  const raw = missionMetadata(session)?.receipt
  if (raw === undefined) return undefined
  return MissionReceiptMetadata.parse(raw)
}

export async function recordMissionCallerReceipt(input: {
  sessionID: string
  status: Extract<SessionStatus.Info, { type: "terminal" }>
}): Promise<MissionReceiptMetadata | undefined> {
  const missionSession = await Session.get(input.sessionID)
  if (missionSession.kind !== "mission") return undefined
  const caller = missionCaller(missionSession)
  if (!caller) return undefined
  const existingReceipt = missionReceipt(missionSession)
  if (existingReceipt) return existingReceipt

  const callerSession = await Session.assertLineageInProject({
    sessionID: caller.session_id,
    projectID: missionSession.projectID,
  })
  if (!isRightSidebarCodingAssistantSession(callerSession)) {
    throw new Error(`Mission caller session ${caller.session_id} is not a right-sidebar coding assistant session`)
  }

  const now = Date.now()
  const messageID = missionReceiptMessageID(missionSession.id)
  const partID = missionReceiptPartID(missionSession.id)
  const text = renderReceipt({
    missionID: missionID(missionSession),
    missionSessionID: missionSession.id,
    status: input.status,
  })
  const model = await resolveAgentModelRef("mission", { sessionID: missionSession.id })
  const message: Message.Assistant = {
    id: messageID,
    sessionID: callerSession.id,
    role: "assistant",
    time: {
      created: now,
      completed: now,
    },
    parentID: caller.message_id,
    modelID: model.modelID,
    providerID: model.providerID,
    agent: "mission",
    path: {
      cwd: callerSession.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
  const part: Message.TextPart = {
    id: partID,
    messageID,
    sessionID: callerSession.id,
    type: "text",
    text,
    source: "system",
    time: {
      start: now,
      end: now,
    },
    metadata: {
      source: RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE,
      mission_id: missionID(missionSession),
      mission_session_id: missionSession.id,
      terminal_reason: input.status.reason,
    },
  }
  await Session.persistMessage({
    info: message,
    parts: [part],
    touchSessionID: callerSession.id,
  })

  const latestMissionSession = await Session.get(missionSession.id)
  const latestMission = missionMetadata(latestMissionSession)
  if (!latestMission) throw new Error(`Mission session ${missionSession.id} is missing metadata.mission`)
  const receipt = MissionReceiptMetadata.parse({
    message_id: messageID,
    part_id: partID,
    terminal_reason: input.status.reason,
    sent_at: now,
  })
  await Session.mergeMetadata({
    sessionID: missionSession.id,
    patch: {
      mission: {
        ...latestMission,
        receipt,
      },
    },
  })
  return receipt
}

export function ensureMissionCallerReceiptBridge() {
  const directory = Instance.directory
  if (initializedDirectories.has(directory)) return
  initializedDirectories.add(directory)
  Bus.subscribe(SessionStatus.Event.Status, async (event) => {
    const status = event.properties.status
    if (status.type !== "terminal") return
    await recordMissionCallerReceipt({
      sessionID: event.properties.sessionID,
      status,
    })
  })
  Bus.subscribe(Bus.InstanceDisposed, (event) => {
    initializedDirectories.delete(event.properties.directory)
  })
  log.info("installed mission caller receipt bridge", { directory })
}
