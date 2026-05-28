import { createStore } from "solid-js/store";
import type { AppDialogOptions } from "../services/app-dialog";

export type ConfigDialogTab =
  | "general"
  | "permissions"
  | "prompt"
  | "channel"
  | "skill"
  | "skill-market"
  | "mcp"
  | "memory"
  | "providers"
  | "agent-models"
  | "about";

export interface ConfigSection {
  id: ConfigDialogTab;
  labelKey: string;
}

// Single source for the config sections, their i18n label keys, and their
// order. Consumed by:
//   • ConfigDialogHost — renders the sidebar nav (adds per-section icons),
//   • services/dialog.ts — the valid-tab guard set,
//   • TitlebarMenubar — the top-level Settings menu.
// Add a section here once and it surfaces in all three (rule 8 — single source).
export const CONFIG_SECTIONS: readonly ConfigSection[] = [
  { id: "general", labelKey: "settings.title" },
  { id: "permissions", labelKey: "permissions.title" },
  { id: "prompt", labelKey: "prompt.title" },
  { id: "channel", labelKey: "channel.title" },
  { id: "skill", labelKey: "skill.title" },
  { id: "skill-market", labelKey: "skill.market.title" },
  { id: "mcp", labelKey: "mcp.title" },
  { id: "memory", labelKey: "memory.title" },
  { id: "providers", labelKey: "cmdk.settings.providers" },
  { id: "agent-models", labelKey: "cmdk.settings.agent_models" },
  { id: "about", labelKey: "about.title" },
];

export interface AppDialogState extends AppDialogOptions {
  open: boolean;
  epoch: number;
  countdownDeadlineMs: number;
}

export interface SessionDialogState {
  open: boolean;
  title: string;
  bodyHtml: string;
}

export interface GoalDialogState {
  open: boolean;
  goalID: string;
  title: string;
  acceptance: string;
  saving: boolean;
}

export interface ConfigDialogState {
  open: boolean;
  activeTab: ConfigDialogTab;
  sidebarWidth: number | null;
  agentModelsScope: "project" | "session";
  agentModelsSessionID: string | null;
}

export interface DialogState {
  app: AppDialogState;
  session: SessionDialogState;
  goal: GoalDialogState;
  config: ConfigDialogState;
}

const DEFAULT_DIALOG_STATE: DialogState = {
  app: {
    open: false,
    epoch: 0,
    title: "",
    message: "",
    kind: "",
    okLabel: "",
    cancelLabel: "",
    cancel: false,
    input: false,
    inputLabel: "",
    inputPlaceholder: "",
    inputValue: "",
    select: false,
    selectLabel: "",
    selectValue: "",
    selectOptions: [],
    recommendedValue: "",
    countdownSeconds: 0,
    countdownDeadlineMs: 0,
  },
  session: {
    open: false,
    title: "",
    bodyHtml: "",
  },
  goal: {
    open: false,
    goalID: "",
    title: "",
    acceptance: "",
    saving: false,
  },
  config: {
    open: false,
    activeTab: "general",
    sidebarWidth: null,
    agentModelsScope: "project",
    agentModelsSessionID: null,
  },
};

export const [dialogStore, setDialogStore] = createStore<DialogState>(DEFAULT_DIALOG_STATE);
