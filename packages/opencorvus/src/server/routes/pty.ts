// Copied from OpenCode `packages/opencode/src/server/routes/pty.ts` and adapted to OpenCorvus errors.
import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Pty } from "@/pty"
import { Instance } from "@/project/instance"
import { NotFoundError } from "../../storage/db"
import { selectProjectDirectory } from "../directory"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const PtyRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List PTY sessions",
        description: "Get active Pseudo Terminal (PTY) sessions managed by OpenCorvus.",
        operationId: "pty.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Pty.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => c.json(Pty.list()),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create PTY session",
        description: "Create a project-bound Pseudo Terminal (PTY) session for an explicit command.",
        operationId: "pty.create",
        responses: {
          200: {
            description: "Created session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Pty.CreateInput),
      async (c) => {
        try {
          return c.json(await Pty.create(c.req.valid("json")))
        } catch (error) {
          if (error instanceof Error && error.message === "PTY cwd must match current project directory") {
            throw new HTTPException(400, { message: error.message })
          }
          throw error
        }
      },
    )
    .get(
      "/:ptyID",
      describeRoute({
        summary: "Get PTY session",
        description: "Retrieve a specific Pseudo Terminal (PTY) session.",
        operationId: "pty.get",
        responses: {
          200: {
            description: "Session info",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      async (c) => {
        const info = Pty.get(c.req.valid("param").ptyID)
        if (!info) throw new NotFoundError({ message: "PTY session not found" })
        return c.json(info)
      },
    )
    .put(
      "/:ptyID",
      describeRoute({
        summary: "Update PTY session",
        description: "Update title or size for a Pseudo Terminal (PTY) session.",
        operationId: "pty.update",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      validator("json", Pty.UpdateInput),
      async (c) => {
        const info = await Pty.update(c.req.valid("param").ptyID, c.req.valid("json"))
        if (!info) throw new NotFoundError({ message: "PTY session not found" })
        return c.json(info)
      },
    )
    .delete(
      "/:ptyID",
      describeRoute({
        summary: "Remove PTY session",
        description: "Remove and terminate a Pseudo Terminal (PTY) session.",
        operationId: "pty.remove",
        responses: {
          200: {
            description: "Session removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      async (c) => {
        const id = c.req.valid("param").ptyID
        if (!Pty.get(id)) throw new NotFoundError({ message: "PTY session not found" })
        await Pty.remove(id)
        return c.json(true)
      },
    )
    .get(
      "/:ptyID/connect",
      describeRoute({
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection to a Pseudo Terminal (PTY) session.",
        operationId: "pty.connect",
        responses: {
          200: {
            description: "Connected session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      async (c, next) => {
        const id = c.req.valid("param").ptyID
        if (!Pty.get(id)) throw new NotFoundError({ message: "PTY session not found" })
        await next()
      },
      upgradeWebSocket((c) => {
        const id = c.req.param("ptyID")
        const directory = selectProjectDirectory({
          queryDirectory: c.req.query("directory"),
          headerDirectory: c.req.header("x-opencorvus-directory"),
        })
        const cursor = (() => {
          const value = c.req.query("cursor")
          if (!value) return
          const parsed = Number(value)
          if (!Number.isSafeInteger(parsed) || parsed < -1) return
          return parsed
        })()
        let handler: ReturnType<typeof Pty.connect> | undefined
        const withProject = async (fn: () => void) => {
          if (!directory) throw new Error("PTY websocket connect requires project directory")
          await Instance.provide({ directory, fn })
        }

        return {
          onOpen(_event, ws) {
            void withProject(() => {
              handler = Pty.connect(
                id,
                {
                  send: (data) => ws.send(data),
                  close: (code, reason) => ws.close(code, reason),
                },
                cursor,
              )
            }).catch((error) => {
              ws.close(4404, error instanceof Error ? error.message : "PTY session not found")
            })
          },
          onMessage(event) {
            void withProject(() => {
              if (typeof event.data === "string") handler?.onMessage(event.data)
              else if (event.data instanceof ArrayBuffer) handler?.onMessage(new TextDecoder().decode(event.data))
            }).catch(() => {})
          },
          onClose() {
            void withProject(() => {
              handler?.onClose()
            }).catch(() => {})
          },
          onError() {
            void withProject(() => {
              handler?.onClose()
            }).catch(() => {})
          },
        }
      }),
    ),
)
