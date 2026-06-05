import type { Accessor, Component } from "solid-js"
import type { SideActivity } from "../components/SideActivityToolbar"

export interface OverlayRightActivityPanelProps {
  active: Accessor<boolean>
  directory: Accessor<string>
}

export interface OverlayRightActivityPlugin<ID extends string = string> {
  id: ID
  activity: SideActivity<ID>
  labelKey: string
  bodyId: string
  mountId: string
  Panel: Component<OverlayRightActivityPanelProps>
}
