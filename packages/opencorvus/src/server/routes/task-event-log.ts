/**
 * In-memory per-task event log for SSE replay on reconnect.
 *
 * Each SSE connection writes events here with their sequence number.
 * On reconnect with ?after=N, events with sequence > N are replayed.
 *
 * Ring buffer keeps the last MAX_EVENTS per task to bound memory.
 * Old events beyond the buffer are gone — the client falls back to
 * a full transcript reload when the requested sequence is too old.
 */

const MAX_EVENTS = 2000
const TRIM_TO = 1500

type LogEntry = { sequence: number; data: string }

type TaskLog = {
  entries: LogEntry[]
  minSequence: number
}

const logs = new Map<string, TaskLog>()

export function appendTaskEvent(taskID: string, sequence: number, data: string) {
  let log = logs.get(taskID)
  if (!log) {
    log = { entries: [], minSequence: sequence }
    logs.set(taskID, log)
  }
  log.entries.push({ sequence, data })
  if (log.entries.length > MAX_EVENTS) {
    log.entries = log.entries.slice(-TRIM_TO)
    log.minSequence = log.entries[0]?.sequence ?? sequence
  }
}

/**
 * Return events with sequence > after.
 * Returns null if `after` is older than the buffer — caller should
 * signal a full reload instead of partial replay.
 */
export function replayTaskEvents(taskID: string, after: number): string[] | null {
  const log = logs.get(taskID)
  if (!log || log.entries.length === 0) return []
  // If the requested sequence is older than our buffer, we can't replay
  if (after > 0 && after < log.minSequence) return null
  return log.entries
    .filter((e) => e.sequence > after)
    .map((e) => e.data)
}

export function clearTaskEventLog(taskID: string) {
  logs.delete(taskID)
}
