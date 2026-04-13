/**
 * Read / write the current cwd context for a Gateway session.
 *
 * State lives at `session.metadata.gateway.cwd`. Tool calls that take a `cwd`
 * argument should *prefer the explicit value*, falling back to the session's
 * current cwd only when the user hasn't specified one.
 */

import { Session } from "@/session"

const KEY = "gateway"
type GatewayState = { cwd?: string }

export function readCwd(session: Session.Info): string | undefined {
  const meta = (session.metadata ?? {}) as Record<string, unknown>
  const gw = (meta[KEY] ?? {}) as GatewayState
  return gw.cwd
}

export async function writeCwd(input: { sessionID: string; cwd: string }): Promise<void> {
  await Session.mergeMetadata({
    sessionID: input.sessionID,
    patch: { [KEY]: { cwd: input.cwd } },
  })
}
