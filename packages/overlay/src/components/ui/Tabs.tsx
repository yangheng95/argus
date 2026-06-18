import { Tabs as KobalteTabs } from "@kobalte/core/tabs"
import { splitProps } from "solid-js"
import type { JSX } from "solid-js"

export const TABS_SIZES = ["sm", "md"] as const
export const TABS_TONES = ["neutral"] as const

export type TabsSize = (typeof TABS_SIZES)[number]
export type TabsTone = (typeof TABS_TONES)[number]

export interface TabsProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "classList" | "role" | "onChange"> {
  value: string
  onValueChange?: (value: string) => void
}

export interface TabListProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList" | "role" | "onChange"> {
  size: TabsSize
  tone: TabsTone
}

export interface TabProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList" | "role" | "type" | "onClick"> {
  value: string
  active: boolean
  size: TabsSize
  tone: TabsTone
}

export interface TabPanelProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "role"> {
  value: string
}

export function Tabs(props: TabsProps): JSX.Element {
  const [local, tabsProps] = splitProps(props, ["value", "onValueChange", "children"])

  return (
    <KobalteTabs {...tabsProps} value={local.value} onChange={local.onValueChange} activationMode="manual">
      {local.children}
    </KobalteTabs>
  )
}

export function TabList(props: TabListProps): JSX.Element {
  const [local, listProps] = splitProps(props, ["size", "tone", "children"])

  return (
    <KobalteTabs.List {...listProps} class="oc-tabs" data-size={local.size} data-tone={local.tone}>
      {local.children}
    </KobalteTabs.List>
  )
}

export function Tab(props: TabProps): JSX.Element {
  const [local, tabProps] = splitProps(props, ["value", "active", "size", "tone"])

  return (
    <KobalteTabs.Trigger
      {...tabProps}
      value={local.value}
      class="oc-tab"
      data-active={local.active ? "true" : "false"}
      data-size={local.size}
      data-tone={local.tone}
    />
  )
}

export function TabPanel(props: TabPanelProps): JSX.Element {
  const [local, panelProps] = splitProps(props, ["value", "children"])

  return (
    <KobalteTabs.Content {...panelProps} value={local.value}>
      {local.children}
    </KobalteTabs.Content>
  )
}
