import { ProtocolStore } from "./store"
import type { ProtocolStreamKind } from "./schema"

export namespace StreamHub {
  export function id(input: {
    taskID?: string
    runID?: string
    goalRunID?: string
    sessionID?: string
    executorSessionID?: string
    sourceID?: string
  }) {
    return [
      input.taskID ?? "",
      input.runID ?? "",
      input.goalRunID ?? "",
      input.sessionID ?? "",
      input.executorSessionID ?? "",
      input.sourceID ?? "",
    ].join(":")
  }

  export function append(input: {
    streamID: string
    kind: ProtocolStreamKind
    text: string
    taskID?: string
    runID?: string
    goalRunID?: string
    sessionID?: string
    payload?: Record<string, unknown>
    emittedAt?: number
  }) {
    return ProtocolStore.appendChunk({
      stream_id: input.streamID,
      task_id: input.taskID,
      run_id: input.runID,
      goal_run_id: input.goalRunID,
      session_id: input.sessionID,
      kind: input.kind,
      text: input.text,
      payload: input.payload,
      emitted_at: input.emittedAt,
    })
  }

  export function replay(streamID: string, chunkSequence: number) {
    return ProtocolStore.listChunksAfter(streamID, chunkSequence)
  }
}
