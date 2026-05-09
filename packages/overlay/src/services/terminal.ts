import { apiJson } from "./api";

export interface TerminalProfile {
  id: string;
  label: string;
  icon: TerminalProfileIcon;
}

export type TerminalProfileIcon = "terminal" | "powershell" | "command-prompt" | "bash";

export interface TerminalProfileList {
  defaultProfileID: string;
  profiles: TerminalProfile[];
}

export async function listTerminalProfiles(): Promise<TerminalProfileList> {
  return await apiJson("terminal/profiles");
}

export async function openSystemTerminal(input: {
  cwd: string;
  profileID?: string;
}): Promise<void> {
  await apiJson("terminal/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
