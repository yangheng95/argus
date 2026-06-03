import { createSignal } from "solid-js";
import { listTerminalProfiles, type TerminalProfile } from "./terminal";

const [terminalProfiles, setTerminalProfiles] = createSignal<TerminalProfile[]>([]);
const [defaultTerminalProfileID, setDefaultTerminalProfileID] = createSignal("");
const [selectedTerminalProfileID, setSelectedTerminalProfileID] = createSignal("");

export { terminalProfiles, defaultTerminalProfileID, selectedTerminalProfileID };

export function currentTerminalProfileID(): string {
  return selectedTerminalProfileID() || defaultTerminalProfileID();
}

export function clearTerminalProfileSelection(): void {
  setTerminalProfiles([]);
  setDefaultTerminalProfileID("");
  setSelectedTerminalProfileID("");
}

export function selectTerminalProfileID(profileID: string): void {
  if (!terminalProfiles().some((profile) => profile.id === profileID)) {
    throw new Error(`Unknown terminal profile selected: ${profileID}`);
  }
  setSelectedTerminalProfileID(profileID);
}

export async function reloadTerminalProfileSelection(input: {
  directory: string;
  defaultProfileMissingMessage: string;
}): Promise<void> {
  const response = await listTerminalProfiles(input.directory);
  if (!response.profiles.some((profile) => profile.id === response.defaultProfileID)) {
    throw new Error(input.defaultProfileMissingMessage);
  }
  const current = selectedTerminalProfileID();
  const selected = response.profiles.some((profile) => profile.id === current)
    ? current
    : response.defaultProfileID;
  setTerminalProfiles(response.profiles);
  setDefaultTerminalProfileID(response.defaultProfileID);
  setSelectedTerminalProfileID(selected);
}
