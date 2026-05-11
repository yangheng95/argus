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

export interface AppDialogState extends AppDialogOptions {
  open: boolean;
  epoch: number;
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
  },
};

export const [dialogStore, setDialogStore] = createStore<DialogState>(DEFAULT_DIALOG_STATE);
