import { createStore } from "solid-js/store";
import type { AppDialogOptions } from "../services/app-dialog";

export interface AppDialogState extends AppDialogOptions {
  open: boolean;
  epoch: number;
}

export interface SessionDialogState {
  open: boolean;
  title: string;
  bodyHtml: string;
}

export interface DialogState {
  app: AppDialogState;
  session: SessionDialogState;
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
};

export const [dialogStore, setDialogStore] = createStore<DialogState>(DEFAULT_DIALOG_STATE);
