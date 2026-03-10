import {
  taskNotes as _taskNotes,
  preferences as _preferences,
  updatePreference as _updatePreference,
  deletePreference as _deletePreference,
  recordTaskRequest as _recordTaskRequest,
} from "./preference"
import { ingestTaskMessage as _ingestTaskMessage } from "./intent"
import { compileBrief as _compileBrief } from "./brief"
import { compileBoard as _compileBoard, boardTag as _boardTag } from "./board"

export namespace WorkbenchService {
  export const taskNotes = _taskNotes
  export const preferences = _preferences
  export const updatePreference = _updatePreference
  export const deletePreference = _deletePreference
  export const recordTaskRequest = _recordTaskRequest
  export const ingestTaskMessage = _ingestTaskMessage
  export const compileBrief = _compileBrief
  export const compileBoard = _compileBoard
  export const boardTag = _boardTag
}
