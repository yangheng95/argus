import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"

type ListedSession = {
  id: string
  directory: string
  title: string
  time: {
    created: number
    updated: number
  }
}

async function* waitForAbort(signal?: AbortSignal) {
  if (signal?.aborted) return
  await new Promise<void>((resolve) => {
    signal?.addEventListener("abort", () => resolve(), { once: true })
  })
}

function createListSessionsAgent(sessions: ListedSession[]) {
  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
  } as unknown as AgentSideConnection

  const sdk = {
    global: {
      event: async (options?: { signal?: AbortSignal }) => {
        return { stream: waitForAbort(options?.signal) }
      },
    },
    session: {
      list: async (params: unknown) => {
        return {
          data: sessions,
          params,
        }
      },
    },
  }

  const agent = new ACP.Agent(connection, { sdk } as any)
  const stop = () => {
    ;(agent as any).eventAbort.abort()
  }

  return { agent, stop }
}

describe("ACP unstable_listSessions", () => {
  test("uses a compound opaque cursor for same-updated sessions", async () => {
    const updated = Date.now() + 30_000
    const sessions = Array.from({ length: 101 }, (_, index) => {
      const id = `ses_${String(index).padStart(3, "0")}`
      return {
        id,
        directory: "C:\\workspace\\acp",
        title: id,
        time: {
          created: updated,
          updated,
        },
      }
    })
    const expected = sessions.map((session) => session.id).sort((left, right) => right.localeCompare(left))

    const { agent, stop } = createListSessionsAgent(sessions)
    try {
      const first = await agent.unstable_listSessions({ cwd: "C:\\workspace\\acp" })
      expect(first.sessions.map((session) => session.sessionId)).toEqual(expected.slice(0, 100))
      expect(first.nextCursor).toBe(JSON.stringify({ updated, sessionID: expected[99] }))

      const second = await agent.unstable_listSessions({ cwd: "C:\\workspace\\acp", cursor: first.nextCursor })
      expect(second.sessions.map((session) => session.sessionId)).toEqual(expected.slice(100))
      expect(second.nextCursor).toBeUndefined()
    } finally {
      stop()
    }
  })

  test("rejects timestamp-only cursors instead of silently skipping same-boundary sessions", async () => {
    const updated = Date.now() + 30_000
    const { agent, stop } = createListSessionsAgent([
      {
        id: "ses_only",
        directory: "C:\\workspace\\acp",
        title: "single",
        time: {
          created: updated,
          updated,
        },
      },
    ])

    try {
      await expect(agent.unstable_listSessions({ cursor: String(updated) })).rejects.toMatchObject({
        code: -32602,
      })
    } finally {
      stop()
    }
  })
})
