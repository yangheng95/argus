import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Config } from "@/config/config"
import { sessionRole, taskIDForSession } from "@/engine/task-session-lineage"
import { ComputerError } from "@/mcp/computer/errors"
import { computerRuntimeScopeIdentity } from "@/mcp/computer/runtime-scope"
import { openComputerViewer } from "@/mcp/computer/viewer"
import { ComputerHostRuntime } from "@/mcp/computer/host-runtime"
import { ConversationCapability } from "@/conversation/capability"
import { badRequestBody, errors } from "../error"

const OpenComputerViewerInput = z
  .object({
    sessionID: z.string().trim().min(1),
    computerID: z.string().trim().min(1),
    displayID: z.string().trim().min(1),
  })
  .strict()

const OpenComputerViewerResponse = z
  .object({
    opened: z.literal(true),
    pid: z.number().int().positive(),
    computerId: z.string(),
    displayId: z.string(),
    runtimeBundleId: z.string(),
  })
  .strict()

const ComputerOwnershipInput = OpenComputerViewerInput

const ComputerOwnershipResponse = z
  .object({
    ownership: z.enum(["human", "agent"]),
    computerId: z.string(),
    displayId: z.string(),
    runtimeBundleId: z.string(),
    guestPreserved: z.literal(true).optional(),
    freshObservationRequired: z.literal(true).optional(),
  })
  .strict()

export function computerRuntimeScopeForSession(sessionID: string): string {
  const taskID = taskIDForSession(sessionID)
  if (!taskID) return computerRuntimeScopeIdentity({ ownerKind: "conversation", sessionID })
  return computerRuntimeScopeIdentity({
    ownerKind: sessionRole(sessionID) === "orchestrator" ? "orchestrator" : "worker",
    taskID,
    sessionID,
  })
}

export function ComputerRoutes() {
  return new Hono()
    .post(
      "/viewer/open",
      describeRoute({
        summary: "Open Computer viewer",
        description:
          "Open the verified native viewer for the exact Session-owned Computer and display. Viewer credentials remain inside the host-owned runtime workspace and are never returned.",
        operationId: "computer.viewer.open",
        responses: {
          200: {
            description: "Native Computer viewer launch result",
            content: { "application/json": { schema: resolver(OpenComputerViewerResponse) } },
          },
          ...errors(400, 500),
        },
      }),
      validator("json", OpenComputerViewerInput),
      async (c) => {
        const input = c.req.valid("json")
        const config = await Config.get()
        try {
          const runtimeScope = computerRuntimeScopeForSession(input.sessionID)
          const identity = ComputerHostRuntime.identity(runtimeScope)
          if (identity.computerId !== input.computerID || identity.displayId !== input.displayID) {
            throw new ComputerError("COMPUTER_SESSION_IDENTITY_MISMATCH", "Computer viewer identity does not match", {
              expected: { computerId: identity.computerId, displayId: identity.displayId },
              actual: { computerId: input.computerID, displayId: input.displayID },
            })
          }
          return c.json(
            await openComputerViewer({
              manifestPath: config.computer?.runtime_bundle_manifest,
              runtimeScope,
              computerId: input.computerID,
              displayId: input.displayID,
            }),
          )
        } catch (error) {
          if (error instanceof ComputerError) return c.json(badRequestBody(error.message), 400)
          throw error
        }
      },
    )
    .post(
      "/status",
      describeRoute({
        summary: "Get Computer guest ownership",
        description: "Read the exact host-owned Computer identity and current input owner.",
        operationId: "computer.status",
        responses: {
          200: {
            description: "Current Computer ownership",
            content: { "application/json": { schema: resolver(ComputerOwnershipResponse) } },
          },
          ...errors(400, 500),
        },
      }),
      validator("json", ComputerOwnershipInput),
      async (c) => {
        const input = c.req.valid("json")
        try {
          return c.json(
            ComputerHostRuntime.status({
              runtimeScope: computerRuntimeScopeForSession(input.sessionID),
              computerId: input.computerID,
              displayId: input.displayID,
            }),
          )
        } catch (error) {
          if (error instanceof ComputerError) return c.json(badRequestBody(error.message), 400)
          throw error
        }
      },
    )
    .post(
      "/takeover",
      describeRoute({
        summary: "Take over Computer guest",
        description:
          "Revoke the exact Agent run and disconnect its adapter while preserving the Session-owned guest for the native viewer.",
        operationId: "computer.takeover",
        responses: {
          200: {
            description: "Human Computer ownership",
            content: { "application/json": { schema: resolver(ComputerOwnershipResponse) } },
          },
          ...errors(400, 500),
        },
      }),
      validator("json", ComputerOwnershipInput),
      async (c) => {
        const input = c.req.valid("json")
        try {
          const runtimeScope = computerRuntimeScopeForSession(input.sessionID)
          const result = ComputerHostRuntime.takeover({
            runtimeScope,
            computerId: input.computerID,
            displayId: input.displayID,
          })
          await ConversationCapability.disconnectRuntimeMcp(input.sessionID)
          return c.json(result)
        } catch (error) {
          if (error instanceof ComputerError) return c.json(badRequestBody(error.message), 400)
          throw error
        }
      },
    )
    .post(
      "/return",
      describeRoute({
        summary: "Return Computer guest to Agent automation",
        description:
          "Issue a new Agent run capability for the preserved guest. The next adapter starts without observation authority.",
        operationId: "computer.return",
        responses: {
          200: {
            description: "New Agent Computer ownership",
            content: { "application/json": { schema: resolver(ComputerOwnershipResponse) } },
          },
          ...errors(400, 500),
        },
      }),
      validator("json", ComputerOwnershipInput),
      async (c) => {
        const input = c.req.valid("json")
        try {
          return c.json(
            ComputerHostRuntime.returnControl({
              runtimeScope: computerRuntimeScopeForSession(input.sessionID),
              computerId: input.computerID,
              displayId: input.displayID,
            }),
          )
        } catch (error) {
          if (error instanceof ComputerError) return c.json(badRequestBody(error.message), 400)
          throw error
        }
      },
    )
}
