import { Icon, type IconName } from "./Icon"
import { normalizeAgentRole, type AgentRole } from "../utils/message"
import { stageAccent } from "../utils/card-color"

export const AVATAR_ICON_BY_ROLE: Record<AgentRole, IconName> = {
  user: "avatar-user",
  assistant: "avatar-assistant",
  system: "avatar-system",
  orchestrator: "avatar-orchestrator",
  mission: "avatar-mission",
  "intent-analysis": "avatar-intent-analysis",
  spec: "avatar-spec",
  requirements: "avatar-requirements",
  "design-analyst": "avatar-design-analyst",
  architect: "avatar-architect",
  planner: "avatar-planner",
  goal: "avatar-goal",
  executor: "avatar-executor",
  build: "avatar-build",
  explore: "avatar-explore",
  evaluator: "avatar-evaluator",
  integrity: "avatar-integrity",
  "fact-check": "avatar-integrity",
  delivery: "avatar-delivery",
}

export function avatarRole(role: string): AgentRole {
  return normalizeAgentRole(role)
}

export function avatarIconName(role: string): IconName {
  return AVATAR_ICON_BY_ROLE[avatarRole(role)]
}

function avatarAccent(role: string): string {
  const accent = stageAccent(avatarRole(role))
  if (!accent) {
    throw new Error(`Avatar: missing stage accent for role "${role}"`)
  }
  return accent
}

export function Avatar(props: { role: string; status?: string; class?: string }) {
  const normalizedRole = () => avatarRole(props.role)
  const classes = () => ["chat-avatar", props.class].filter(Boolean).join(" ")

  return (
    <span
      class={classes()}
      data-role={normalizedRole()}
      data-status={props.status || undefined}
      style={{ "--card-stage": avatarAccent(props.role) }}
      aria-hidden="true"
    >
      <Icon class="chat-avatar__icon" name={avatarIconName(props.role)} size={20} />
    </span>
  )
}
