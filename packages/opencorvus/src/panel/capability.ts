import z from "zod"
import { AcceptanceSpecSchema } from "@/acceptance/types"
import { CheckConfig, StageRouting } from "@/engine"
import { ChannelId, ChannelSurface as SharedChannelSurface } from "@/channel/catalog"
import { isModelReference } from "@/provider/model-ref"

export const RIGHT_SIDEBAR_SURFACE = "right-sidebar"
export const PanelSurface = z.enum([...SharedChannelSurface.options, RIGHT_SIDEBAR_SURFACE])
export const PanelCapabilityKind = z.enum(["query", "mutation"])
export const PanelLocalActionType = z.enum(["set_executor", "select_task", "select_session", "invalidate_session"])

/**
 * Who initiated a panel action — server-derived, NEVER client-supplied.
 *
 *   panel_ui        external UI / mobile gateway client / direct HTTP call
 *   control_agent   the OpenCorvus control LLM agent (`control`)
 *   mission         the OpenCorvus Mission LLM agent (`mission`)
 *   explore        the read-only exploration subagent (`explore`)
 *   right_sidebar_assistant
 *                  the project-bound coding assistant embedded in the right sidebar
 *
 * `actor` is the provenance dimension (who); `surface` is the channel
 * dimension (where). They are independent: a control_agent can run on
 * panel surface, a panel_ui can run on the gateway (remote/mobile) surface,
 * etc. Note `gateway` here is the infrastructure access surface, unrelated
 * to the `mission` actor identity.
 *
 * Replaces the prior free-text `source` field as the authoritative input
 * for authorization decisions and audit trails. `source` is preserved
 * for business-meaningful labels (e.g. "channel:slack:thread-123").
 */
export const PanelActor = z.enum(["panel_ui", "control_agent", "mission", "explore", "right_sidebar_assistant"])
export type PanelActor = z.infer<typeof PanelActor>

/**
 * Map a Tool.Context agent name to the panel actor identity.
 *
 * Only LLM agents that legitimately drive the panel are recognized.
 * Anything else collapses to `panel_ui` — the safest default, treats the
 * caller as if it were an external UI client (no implicit elevation).
 */
export function derivePanelActor(agent: string | undefined): PanelActor {
  if (agent === "control") return "control_agent"
  if (agent === "mission") return "mission"
  if (agent === "explore") return "explore"
  return "panel_ui"
}
export const PanelCapabilityQuery = z.object({
  surface: PanelSurface.default("panel"),
})

const allProjectSurfaces = PanelSurface.options
const sharedSurfaces = SharedChannelSurface.options
const localSurfaces = ["panel", RIGHT_SIDEBAR_SURFACE] as const
const localSurfaceSet: ReadonlySet<Surface> = new Set(localSurfaces)
const nonGatewaySharedSurfaces = SharedChannelSurface.options.filter((surface) => surface !== "gateway")
const CheckSelection = z.record(z.string(), z.boolean())

type Shape = z.ZodRawShape
type Surface = z.infer<typeof PanelSurface>
type Kind = z.infer<typeof PanelCapabilityKind>
type Local = z.infer<typeof PanelLocalActionType>
type Capability<S extends Shape = Shape, A extends string = string> = {
  action: A
  description: string
  kind: Kind
  surfaces: readonly Surface[]
  params: S
  local_action_types?: readonly Local[]
  local_action_surfaces?: readonly Surface[]
  schema: z.ZodObject<{ action: z.ZodLiteral<A> } & S>
}

function item<const A extends string, const S extends Shape>(input: {
  action: A
  description: string
  kind: Kind
  surfaces: readonly Surface[]
  params: S
  local_action_types?: readonly Local[]
  local_action_surfaces?: readonly Surface[]
}) {
  return {
    ...input,
    schema: z.object({
      action: z.literal(input.action),
      ...input.params,
    }),
  } satisfies Capability<S, A>
}

function list<const T extends readonly [Capability, ...Capability[]]>(...items: T) {
  return items
}

function schemas<const T extends readonly Capability[]>(items: T) {
  return items.map((item) => item.schema) as unknown as {
    [K in keyof T]: T[K] extends Capability<infer S, infer A> ? z.ZodObject<{ action: z.ZodLiteral<A> } & S> : never
  }
}

function missionSchemas<const T extends readonly Capability[]>(items: T) {
  return items.map((item) => (item.action === "create_task" ? item.schema.required({ title: true }) : item.schema)) as [
    z.ZodObject<any>,
    z.ZodObject<any>,
    ...z.ZodObject<any>[],
  ]
}

export const PanelCapabilityRegistry = list(
  item({
    action: "view_plan",
    description: "Inspect a task plan and goal list.",
    kind: "query",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().describe("Task ID whose plan should be inspected."),
    },
  }),
  item({
    action: "view_board",
    description: "Inspect a task board or list recent tasks when taskID is omitted.",
    kind: "query",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().optional().describe("Task ID whose board should be inspected; omit to list recent tasks."),
    },
  }),
  item({
    action: "view_tasks",
    description: "List recent tasks in the current project.",
    kind: "query",
    surfaces: allProjectSurfaces,
    params: {},
  }),
  item({
    action: "query_task",
    description:
      "Structured batch task status query for LLM reconciliation. Returns stable JSON for up to 50 taskIDs " +
      "at a time. Distinct from view_board (which produces human-oriented prose, single-task at a time) — " +
      "use this when an agent needs to programmatically inspect outcomes of tasks it has dispatched.",
    kind: "query",
    surfaces: allProjectSurfaces,
    params: {
      taskIDs: z.array(z.string().min(1)).min(1).max(50).describe("Task IDs to query in one request."),
      includeChildren: z.boolean().optional().describe("Include direct child task summaries for each requested task."),
      includeInteractions: z
        .boolean()
        .optional()
        .describe("Include pending interaction counts for each requested task."),
    },
  }),
  item({
    action: "create_task",
    description: "Create a task, optionally binding it to a channel thread.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      title: z.string().trim().min(1).max(80).optional().describe("Short task title shown in the project board."),
      request: z.string().describe("Full user request to execute in the new task."),
      request_id: z.string().optional().describe("External request ID used for idempotent task creation."),
      executor: z
        .enum(["opencorvus", "codex", "claude-code"])
        .optional()
        .describe("Executor backend to use for the new task."),
      model: z
        .string()
        .refine(isModelReference, {
          message: 'Model must be in the format "provider/model".',
        })
        .optional()
        .describe("Model reference in provider/model format for the new task."),
      queue: z.boolean().optional().describe("Whether to queue this task behind other work in the same directory."),
      checks: CheckConfig.optional().describe("Evaluation check configuration for the new task."),
      routing: StageRouting.optional().describe("Stage routing overrides for the new task."),
      channel: z.string().optional().describe("External channel identifier to bind to the new task."),
      thread: z.string().optional().describe("External thread identifier to bind to the new task."),
      platform: ChannelId.optional().describe("Channel platform for an external task binding."),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Structured metadata to attach to the new task."),
      source: z.string().optional().describe("Business source label for the new task."),
      allow_create: z.boolean().optional().describe("Set false to return without creating a task."),
    },
  }),
  item({
    action: "send_task_message",
    description: "Send a follow-up message to an existing task.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().describe("Task ID that should receive the follow-up message."),
      text: z.string().describe("Follow-up message text to append to the task."),
      source: z.string().min(1).describe("Business source label for the follow-up message."),
      user_id: z.string().optional().describe("External user ID associated with the follow-up message."),
    },
  }),
  item({
    action: "reply_interaction",
    description: "Answer a pending task interaction.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      interactionID: z.string().describe("Pending interaction ID to answer."),
      reply: z.enum(["once", "always"]).optional().describe("Preset reply behavior for the interaction."),
      message: z.string().optional().describe("Custom answer text for the pending interaction."),
    },
  }),
  item({
    action: "reject_interaction",
    description: "Reject a pending task interaction.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      interactionID: z.string().describe("Pending interaction ID to reject."),
      message: z.string().optional().describe("Reason shown when rejecting the pending interaction."),
    },
  }),
  item({
    action: "retry_task",
    description: "Queue a retry for a task.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().describe("Task ID to queue for retry."),
    },
  }),
  item({
    action: "replan_task",
    description: "Queue a replan for a task.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().describe("Task ID to queue for replanning."),
    },
  }),
  item({
    action: "cancel_task",
    description: "Cancel a task.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().describe("Task ID to cancel."),
    },
  }),
  item({
    action: "update_checks",
    description: "Update the selected verification checks for a task, or replace the full evaluation config.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      taskID: z.string().describe("Task ID whose verification checks should change."),
      selection: CheckSelection.optional().describe("Named check selection updates to apply."),
      checks: CheckConfig.optional().describe("Complete replacement evaluation check configuration."),
    },
  }),
  item({
    action: "capture_overlay_screenshot",
    description: "Capture the current OpenCorvus GUI window and return it as an image attachment.",
    kind: "query",
    surfaces: nonGatewaySharedSurfaces,
    params: {
      match: z.string().optional().describe("Optional window title or process match hint for the screenshot."),
    },
  }),
  item({
    action: "set_executor",
    description: "Select the default executor for new local project tasks.",
    kind: "mutation",
    surfaces: localSurfaces,
    params: {
      executor: z.enum(["opencorvus", "codex", "claude-code"]).describe("Executor backend to select locally."),
    },
    local_action_types: ["set_executor"],
    local_action_surfaces: localSurfaces,
  }),
  item({
    action: "select_task",
    description: "Focus a task in the local project assistant surface.",
    kind: "mutation",
    surfaces: localSurfaces,
    params: {
      taskID: z.string().describe("Task ID to focus in the local project assistant surface."),
    },
    local_action_types: ["select_task"],
    local_action_surfaces: localSurfaces,
  }),
  item({
    action: "select_session",
    description: "Focus a session in the local project assistant surface.",
    kind: "mutation",
    surfaces: localSurfaces,
    params: {
      sessionID: z.string().describe("Session ID to focus in the local project assistant surface."),
    },
    local_action_types: ["select_session"],
    local_action_surfaces: localSurfaces,
  }),
  item({
    action: "create_session",
    description: "Create a blank session.",
    kind: "mutation",
    surfaces: sharedSurfaces,
    params: {},
    local_action_types: ["select_session"],
    local_action_surfaces: ["panel"],
  }),
  item({
    action: "fork_session",
    description: "Fork an existing session.",
    kind: "mutation",
    surfaces: sharedSurfaces,
    params: {
      sessionID: z.string().describe("Session ID to fork."),
    },
    local_action_types: ["select_session"],
    local_action_surfaces: ["panel"],
  }),
  item({
    action: "delete_session",
    description: "Delete a session and its linked tasks.",
    kind: "mutation",
    surfaces: sharedSurfaces,
    params: {
      sessionID: z.string().describe("Session ID to delete."),
    },
    local_action_types: ["invalidate_session"],
    local_action_surfaces: ["panel"],
  }),
  item({
    action: "update_goal",
    description: "Update a goal description and acceptance specs.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      goalID: z.string().describe("Goal ID to update."),
      description: z.string().describe("Replacement goal description."),
      acceptance_specs: z
        .array(AcceptanceSpecSchema)
        .min(1)
        .describe("Complete replacement acceptance specs for the goal."),
    },
  }),
  item({
    action: "delete_goal",
    description: "Delete a goal.",
    kind: "mutation",
    surfaces: allProjectSurfaces,
    params: {
      goalID: z.string().describe("Goal ID to delete."),
    },
  }),
)

export const PanelActionSchema = z.discriminatedUnion("action", schemas(PanelCapabilityRegistry))
export const MissionPanelActionSchema = z.discriminatedUnion("action", missionSchemas(PanelCapabilityRegistry))

export function panelActionSchemaForAgent(agent: string | undefined): typeof PanelActionSchema {
  return (agent === "mission" ? MissionPanelActionSchema : PanelActionSchema) as typeof PanelActionSchema
}

export const PanelCapability = z.object({
  action: z.string(),
  description: z.string(),
  kind: PanelCapabilityKind,
  surfaces: z.array(PanelSurface),
  local_only: z.boolean(),
  local_action_types: z.array(PanelLocalActionType).optional(),
  local_action_surfaces: z.array(PanelSurface).optional(),
  schema: z.record(z.string(), z.unknown()),
})

export const PanelCapabilityResponse = z.object({
  surface: PanelSurface,
  actions: z.array(PanelCapability),
})

function view(item: Capability) {
  return {
    action: item.action,
    description: item.description,
    kind: item.kind,
    surfaces: [...item.surfaces],
    local_only: item.surfaces.every((surface) => localSurfaceSet.has(surface)),
    ...(item.local_action_types ? { local_action_types: [...item.local_action_types] } : {}),
    ...(item.local_action_surfaces ? { local_action_surfaces: [...item.local_action_surfaces] } : {}),
    schema: z.toJSONSchema(item.schema),
  }
}

export function panelCapabilities(surface: Surface) {
  return PanelCapabilityResponse.parse({
    surface,
    actions: PanelCapabilityRegistry.filter((item) => item.surfaces.includes(surface)).map(view),
  })
}

export function panelCapabilityActionSet(surface: Surface) {
  return new Set(panelCapabilities(surface).actions.map((item) => item.action))
}

export function panelCapabilityPrompt(surface: Surface) {
  return panelCapabilities(surface)
    .actions.map((item) => {
      const local = item.local_only ? " Desktop panel only." : ""
      const action = item.local_action_types?.length
        ? ` Emits local actions: ${item.local_action_types.join(", ")} on ${item.local_action_surfaces?.join(", ")}.`
        : ""
      return `- ${item.action}: ${item.description}${local}${action}`
    })
    .join("\n")
}
