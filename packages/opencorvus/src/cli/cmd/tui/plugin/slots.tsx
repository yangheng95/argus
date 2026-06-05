// Copied from OpenCode's TUI slot host and adapted to OpenCorvus package names.
import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@opencorvus-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { createRoot, createSignal } from "solid-js"

type RuntimeSlotMap = TuiSlotMap<Record<string, object>>

type Slot = <Name extends string>(props: TuiSlotProps<Name>) => JSX.Element | null
export type HostSlotPlugin<Slots extends Record<string, object> = {}> = SolidPlugin<TuiSlotMap<Slots>, TuiSlotContext>

export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: {
    (plugin: HostSlotPlugin): () => void
    <Slots extends Record<string, object>>(plugin: HostSlotPlugin<Slots>): () => void
  }
}

function fallback<Name extends string>(props: TuiSlotProps<Name>) {
  return props.children ?? null
}

const [slotRevision, notifySlotRevision] = createRoot(() => {
  const [revision, setRevision] = createSignal(0)
  return [revision, () => setRevision((value) => value + 1)] as const
})

let view: Slot = fallback

export const Slot: Slot = (props) => {
  slotRevision()
  return view(props)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin<Record<string, object>> {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (!isRecord(value.slots)) return false
  return true
}

export function setupSlots(api: HostPluginApi): HostSlots {
  const reg = createSolidSlotRegistry<RuntimeSlotMap, TuiSlotContext>(
    api.renderer,
    {
      theme: api.theme,
    },
    {
      onPluginError(event) {
        console.error("[tui.slot] plugin error", {
          plugin: event.pluginId,
          slot: event.slot,
          phase: event.phase,
          source: event.source,
          message: event.error.message,
        })
      },
    },
  )

  const slot = createSlot<RuntimeSlotMap, TuiSlotContext>(reg)
  view = (props) => slot(props)
  notifySlotRevision()
  return {
    register(plugin: HostSlotPlugin) {
      if (!isHostSlotPlugin(plugin)) return () => {}
      const unregister = reg.register(plugin)
      notifySlotRevision()
      return () => {
        unregister()
        notifySlotRevision()
      }
    },
  }
}
