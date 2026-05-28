import path from "path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { Filesystem } from "../util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export async function assertBuildWriteDirectory(ctx: Tool.Context, target?: string) {
  if (!target) return
  let session: Awaited<ReturnType<typeof Session.get>> | undefined
  try {
    session = await Session.get(ctx.sessionID)
  } catch {
    session = undefined
  }
  if (!session || session.kind !== "build" || !session.goalID) return
  if (Filesystem.contains(session.directory, target)) return
  throw new Error(
    `build session ${ctx.sessionID} cannot write outside its assigned directory ${session.directory}: ${target}`,
  )
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  if (Instance.containsPath(target)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? target : path.dirname(target)
  const glob = path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
