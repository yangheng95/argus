import { Session } from "@/session"

type SessionWithMetadata = Pick<Session.Info, "metadata">

function gatewayMetadata(session: SessionWithMetadata): Record<string, unknown> {
  const value = session.metadata?.gateway
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function readCwd(session: SessionWithMetadata) {
  const cwd = gatewayMetadata(session).cwd
  return typeof cwd === "string" ? cwd : undefined
}

export async function writeCwd(input: { sessionID: string; cwd: string }) {
  const session = await Session.get(input.sessionID)
  const gateway = gatewayMetadata(session)
  return Session.mergeMetadata({
    sessionID: input.sessionID,
    patch: {
      gateway: {
        ...gateway,
        cwd: input.cwd,
      },
    },
  })
}
