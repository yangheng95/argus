import type { OverlayRightActivityPlugin } from "../right-activity"
import { CodingAgentTuiPanel } from "./CodingAgentTuiPanel"

export const CODING_AGENT_TUI_ACTIVITY_ID = "tui" as const

export const codingAgentTuiPlugin = {
  id: CODING_AGENT_TUI_ACTIVITY_ID,
  activity: { id: CODING_AGENT_TUI_ACTIVITY_ID, icon: "terminal", labelKey: "tui.title" },
  labelKey: "tui.title",
  bodyId: "chatTuiPane",
  mountId: "solidTuiHostMount",
  Panel: CodingAgentTuiPanel,
} satisfies OverlayRightActivityPlugin<typeof CODING_AGENT_TUI_ACTIVITY_ID>
