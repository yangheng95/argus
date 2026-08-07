import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { Global } from "@/global"

const processAuthority = randomBytes(32)

export function computerRuntimeScopeIdentity(input: {
  ownerKind: "conversation" | "orchestrator" | "worker"
  sessionID: string
  taskID?: string
}): string {
  const sessionID = input.sessionID.trim()
  if (!sessionID) throw new Error("Computer runtime scope requires a non-empty Session identity")
  if (input.ownerKind === "conversation") return `conversation:${sessionID}:computer`
  const taskID = input.taskID?.trim()
  if (!taskID) throw new Error(`Computer runtime ${input.ownerKind} scope requires a non-empty Task identity`)
  return `${input.ownerKind}:${taskID}:${sessionID}`
}

export function computerRuntimeWorkspace(runtimeScope: string): string {
  const scope = runtimeScope.trim()
  if (!scope) throw new Error("Computer runtime scope requires a non-empty host owner identity")
  const identity = createHash("sha256").update(processAuthority).update("\0").update(scope).digest("hex")
  return path.join(Global.Path.temporary, "computer-runtime", identity)
}
