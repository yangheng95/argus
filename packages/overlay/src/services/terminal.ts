import { apiJson } from "./api"

export interface TerminalProfile {
  id: string
  label: string
  icon: TerminalProfileIcon
}

export type TerminalProfileIcon = "terminal" | "powershell" | "command-prompt" | "bash"

export interface TerminalProfileList {
  defaultProfileID: string
  profiles: TerminalProfile[]
}

export async function listTerminalProfiles(directory: string): Promise<TerminalProfileList> {
  const dir = directory.trim()
  if (!dir) throw new Error("Workspace directory is required")
  return await apiJson(`terminal/profiles?directory=${encodeURIComponent(dir)}`)
}

export async function openSystemTerminal(input: { cwd: string; profileID?: string }): Promise<void> {
  await apiJson("terminal/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}
