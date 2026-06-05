// Copied from OpenCode `packages/opencode/src/pty/index.ts` API shape and adapted to the project-bound TUI host.
import z from "zod"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Tui } from "@/tui"
import { TuiHost } from "@/tui/host"
import { Filesystem } from "@/util/filesystem"

export namespace Pty {
  export const Info = z
    .object({
      id: Identifier.schema("pty"),
      title: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
      pid: z.number(),
    })
    .meta({ ref: "Pty" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    title: z.string().optional(),
    size: z
      .object({
        rows: z.number().int().min(1).max(200),
        cols: z.number().int().min(1).max(500),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  function fromHost(info: TuiHost.Info): Info | undefined {
    if (!info.id) return
    return {
      id: info.id,
      title: info.title ?? "OpenCorvus TUI",
      command: info.command ?? "",
      args: info.args ?? [],
      cwd: info.directory ?? Instance.directory,
      status: info.status === "running" ? "running" : "exited",
      pid: info.pid ?? 0,
    }
  }

  export function projectCwd(input?: string) {
    if (!input) return Instance.directory
    const cwd = Filesystem.resolve(input)
    if (cwd !== Instance.directory) throw new Error("PTY cwd must match current project directory")
    return cwd
  }

  export function list() {
    const info = fromHost(TuiHost.status())
    return info ? [info] : []
  }

  export function get(id: string) {
    const info = fromHost(TuiHost.status())
    if (!info || info.id !== id) return
    return info
  }

  export async function create(input: CreateInput) {
    const cwd = projectCwd(input.cwd)
    const command = input.command
      ? {
          command: input.command,
          args: input.args ?? [],
          cwd,
          env: input.env,
          url: "",
          port: 0,
          hostname: "",
        }
      : await Tui.resolveEmbeddedCommand({ directory: cwd })
    const info = await TuiHost.startPrepared({
      command,
      title: input.title ?? "OpenCorvus TUI",
    })
    const mapped = fromHost(info)
    if (!mapped) throw new Error("PTY session was not created")
    return mapped
  }

  export async function update(id: string, input: UpdateInput) {
    if (!get(id)) return
    let info: TuiHost.Info | undefined
    if (input.title) info = TuiHost.rename({ id, title: input.title })
    if (input.size) info = TuiHost.resize(input.size)
    return fromHost(info ?? TuiHost.status())
  }

  export async function remove(id: string) {
    if (!get(id)) return
    await TuiHost.stop()
  }

  export function connect(
    id: string,
    ws: {
      send(data: string | Uint8Array<ArrayBuffer> | ArrayBuffer): void
      close(code?: number, reason?: string): void
    },
    cursor?: number,
  ) {
    const prepared = TuiHost.preparePtyConnect({ id, cursor })
    return prepared.attach({
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    })
  }
}
