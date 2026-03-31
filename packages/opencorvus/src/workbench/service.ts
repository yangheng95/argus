import { recordNote as _recordNote } from "./note-store"
import { ingestTaskMessage as _ingestTaskMessage } from "./intent"
import { compileBrief as _compileBrief } from "./brief"
import { compileBoard as _compileBoard, boardTag as _boardTag } from "./board"

export namespace WorkbenchService {
  export const recordNote = _recordNote
  export function recordTaskRequest(input: { taskID: string; content: string; source: string; userID?: string }) {
    _recordNote({
      taskID: input.taskID,
      kind: "user_request",
      content: input.content,
      source: input.source,
      userID: input.userID,
    })
  }
  export const ingestTaskMessage = _ingestTaskMessage
  export const compileBrief = _compileBrief
  export const compileBoard = _compileBoard
  export const boardTag = _boardTag
}
