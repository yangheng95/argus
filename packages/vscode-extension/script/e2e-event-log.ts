import * as fs from "node:fs"

export function readEvents(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) throw new Error(`sidecar events file was not created: ${file}`)
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export async function waitForEvent(file: string, type: string, idleMs: number): Promise<void> {
  let lastActivityAt = Date.now()
  let lastSignature = ""
  while (Date.now() - lastActivityAt < idleMs) {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file)
      const events = readEvents(file)
      const signature = `${stats.size}:${stats.mtimeMs}:${events.length}`
      if (signature !== lastSignature) {
        lastSignature = signature
        lastActivityAt = Date.now()
      }
      if (events.some((event) => event.type === type)) return
    }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${type} in ${file} after ${idleMs}ms without event-log activity`)
}

export function watchEventLogActivity(file: string, onActivity: () => void, pollMs = 100): () => void {
  let stopped = false
  let lastSignature = ""
  let timer: NodeJS.Timeout | undefined
  const poll = () => {
    if (stopped) return
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file)
      const signature = `${stats.size}:${stats.mtimeMs}`
      if (signature !== lastSignature) {
        lastSignature = signature
        onActivity()
      }
    }
    timer = setTimeout(poll, pollMs)
    if (typeof timer.unref === "function") timer.unref()
  }
  poll()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
