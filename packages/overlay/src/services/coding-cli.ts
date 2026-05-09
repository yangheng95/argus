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

export async function listCodingCliProfiles(): Promise<CodingCliProfileList> {
  return await apiJson("coding/cli/profiles");
}

export async function openCodingCli(input: {
  cliID: string;
  cwd: string;
}): Promise<void> {
  await apiJson("coding/cli/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
