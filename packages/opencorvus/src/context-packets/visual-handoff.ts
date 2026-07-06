import {
  agentContextStructuredPartsBySchema,
  type AgentContextPacket,
  type AgentContextStructuredPart,
} from "@/agent/context-packet"
import {
  VisualRegionBindingManifestSchema,
  type VisualRegionBindingManifest,
} from "@/frontend-design/visual-region-binding-schema"
import { z } from "zod"

export const VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA = "opencorvus.context.visual_handoff.v1"

export type VisualHandoffProjectMode = "implementation_target" | "visual_baseline" | "source_baseline" | "blocked"

export interface VisualHandoffContextData {
  visualReference?: boolean
  webCloneSource?: boolean
  projectMode?: VisualHandoffProjectMode
  visualRegionBindings?: VisualRegionBindingManifest[]
}

export function visualHandoffStructuredPart(data: VisualHandoffContextData): AgentContextStructuredPart | undefined {
  if (!data.visualReference && !data.webCloneSource && !data.projectMode && !data.visualRegionBindings?.length)
    return undefined
  return {
    type: "structured",
    schema: VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA,
    label: "visual_handoff",
    summary: [
      data.visualReference ? "visual_reference=true" : "",
      data.webCloneSource ? "web_clone_source=true" : "",
      data.projectMode ? `project_mode=${data.projectMode}` : "",
      data.visualRegionBindings?.length ? `visual_region_bindings=${data.visualRegionBindings.length}` : "",
    ]
      .filter(Boolean)
      .join("; "),
    data,
  }
}

export function visualHandoffContextsFromPackets(
  packets: readonly AgentContextPacket[] | undefined,
): VisualHandoffContextData[] {
  return agentContextStructuredPartsBySchema<VisualHandoffContextData>(
    packets,
    VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA,
  ).map(parseVisualHandoffContextData)
}

function parseVisualHandoffContextData(data: unknown): VisualHandoffContextData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA} requires an object payload`)
  }
  const record = data as Record<string, unknown>
  const unsupported = Object.keys(record).filter(
    (key) =>
      key !== "visualReference" &&
      key !== "webCloneSource" &&
      key !== "projectMode" &&
      key !== "visualRegionBindings",
  )
  if (unsupported.length > 0) {
    throw new Error(`${VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA} contains unsupported field ${unsupported[0]}`)
  }
  const visualReference = optionalVisualHandoffBoolean(record.visualReference, "visualReference")
  const webCloneSource = optionalVisualHandoffBoolean(record.webCloneSource, "webCloneSource")
  const projectMode = optionalVisualHandoffProjectMode(record.projectMode)
  const visualRegionBindings = optionalVisualRegionBindings(record.visualRegionBindings)
  if (!visualReference && !webCloneSource && !projectMode && !visualRegionBindings?.length) {
    throw new Error(
      `${VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA} requires visualReference, webCloneSource, projectMode, or visualRegionBindings`,
    )
  }
  return {
    ...(visualReference ? { visualReference } : {}),
    ...(webCloneSource ? { webCloneSource } : {}),
    ...(projectMode ? { projectMode } : {}),
    ...(visualRegionBindings?.length ? { visualRegionBindings } : {}),
  }
}

function optionalVisualHandoffBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") {
    throw new Error(`${VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA}.${field} must be boolean when present`)
  }
  return value
}

function optionalVisualHandoffProjectMode(value: unknown): VisualHandoffProjectMode | undefined {
  if (value === undefined) return undefined
  if (
    value !== "implementation_target" &&
    value !== "visual_baseline" &&
    value !== "source_baseline" &&
    value !== "blocked"
  ) {
    throw new Error(
      `${VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA}.projectMode must be implementation_target, visual_baseline, source_baseline, or blocked when present`,
    )
  }
  return value
}

function optionalVisualRegionBindings(value: unknown): VisualRegionBindingManifest[] | undefined {
  if (value === undefined) return undefined
  return z.array(VisualRegionBindingManifestSchema).parse(value)
}
