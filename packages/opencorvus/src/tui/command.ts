const COMMAND = {
  session_new: "session.new",
  session_share: "session.share",
  session_interrupt: "session.interrupt",
  session_compact: "session.compact",
  messages_page_up: "session.page.up",
  messages_page_down: "session.page.down",
  messages_line_up: "session.line.up",
  messages_line_down: "session.line.down",
  messages_half_page_up: "session.half.page.up",
  messages_half_page_down: "session.half.page.down",
  messages_first: "session.first",
  messages_last: "session.last",
  agent_cycle: "agent.cycle",
} as const

const ACTION = {
  help: "help.show",
  sessions: "session.list",
  themes: "theme.switch",
  models: "model.list",
  submit: "prompt.submit",
  clear: "prompt.clear",
} as const

export const TuiCommand = {
  map: COMMAND,
  action: ACTION,
  aliases: Object.keys(COMMAND),
  normalize(command: string) {
    return COMMAND[command as keyof typeof COMMAND] ?? command
  },
}
