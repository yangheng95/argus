import { apiJson } from "./api";

export type CodingCliIcon = "claude-code" | "codex" | "gemini" | "copilot" | "glm";

export interface CodingCliProfile {
  id: string;
  label: string;
  icon: CodingCliIcon;
}

export interface CodingCliProfileList {
  profiles: CodingCliProfile[];
}

export async function listCodingCliProfiles(directory: string): Promise<CodingCliProfileList> {
  const dir = directory.trim();
  if (!dir) throw new Error("Workspace directory is required");
  return await apiJson(`coding/cli/profiles?directory=${encodeURIComponent(dir)}`);
}

export async function openCodingCli(input: {
  cliID: string;
  terminalProfileID: string;
  cwd: string;
}): Promise<void> {
  await apiJson("coding/cli/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
