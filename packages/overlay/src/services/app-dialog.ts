// ── App Dialog Service ──
// Wraps the <dialog id="appDialog"> element as an imperative modal API.
// Call `installAppDialogBridge()` once after the DOM has mounted, then use
// `showAppDialog(options)` / `nativeMessage(message, opts)` from anywhere.

import { t } from "../utils/i18n";
import { openConfigDialog } from "./dialog";

export type AppDialogOptions = {
  title?: string;
  message?: string;
  kind?: string;
  okLabel?: string;
  cancelLabel?: string;
  cancel?: boolean;
  input?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputValue?: string;
  select?: boolean;
  selectLabel?: string;
  selectValue?: string;
  selectOptions?: Array<{ value: string; label?: string }>;
};

export type AppDialogResult = { confirmed: boolean; value: string | null };

let impl: ((options?: AppDialogOptions) => Promise<AppDialogResult>) | null = null;

export function showAppDialog(options: AppDialogOptions = {}): Promise<AppDialogResult> {
  if (!impl) {
    throw new Error("showAppDialog called before installAppDialogBridge()");
  }
  return impl(options);
}

export async function nativeMessage(
  message: string,
  options: { title?: string; kind?: string; okLabel?: string } = {},
): Promise<AppDialogResult> {
  return showAppDialog({
    title: options.title,
    message,
    kind: options.kind,
    okLabel: options.okLabel,
  });
}

export function installAppDialogBridge(): void {
  const dialog = document.getElementById("appDialog") as HTMLDialogElement | null;
  const titleEl = document.getElementById("appDialogTitle");
  const bodyEl = document.getElementById("appDialogBody");
  const inputField = document.getElementById("appDialogInputField");
  const inputLabel = document.getElementById("appDialogInputLabel");
  const inputEl = document.getElementById("appDialogInput") as HTMLInputElement | null;
  const selectField = document.getElementById("appDialogSelectField");
  const selectLabel = document.getElementById("appDialogSelectLabel");
  const selectEl = document.getElementById("appDialogSelect") as HTMLSelectElement | null;
  const okBtn = document.getElementById("btnAppDialogOk") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("btnAppDialogCancel") as HTMLButtonElement | null;
  if (!dialog || !titleEl || !bodyEl || !okBtn || !cancelBtn) return;
  if (dialog.dataset.bridgeBound === "true") return;
  dialog.dataset.bridgeBound = "true";

  let resolver: ((value: AppDialogResult) => void) | null = null;
  let restoreConfigDialog = false;

  const settle = (confirmed: boolean) => {
    const resolve = resolver;
    resolver = null;
    const value = inputField?.classList.contains("hidden")
      ? selectField?.classList.contains("hidden")
        ? null
        : (selectEl?.value ?? null)
      : (inputEl?.value ?? null);
    dialog.close();
    resolve?.({ confirmed, value });
  };

  cancelBtn.addEventListener("click", () => settle(false));
  okBtn.addEventListener("click", () => settle(true));
  dialog.addEventListener("close", () => {
    const shouldRestoreConfigDialog = restoreConfigDialog;
    restoreConfigDialog = false;
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve({ confirmed: false, value: null });
    }
    if (shouldRestoreConfigDialog) {
      queueMicrotask(() => openConfigDialog());
    }
  });

  impl = (options: AppDialogOptions = {}) => {
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve({ confirmed: false, value: null });
    }

    const configDialog = document.getElementById(
      "configDialog",
    ) as HTMLDialogElement | null;
    restoreConfigDialog = configDialog?.open === true;
    if (restoreConfigDialog) {
      configDialog?.close();
    }

    titleEl.textContent = options.title || t("dialog.notice");
    bodyEl.textContent = options.message || "";
    okBtn.textContent = options.okLabel || t("common.ok");
    cancelBtn.textContent = options.cancelLabel || t("common.cancel");
    cancelBtn.hidden = options.cancel !== true;

    if (inputField && inputEl && inputLabel) {
      inputField.classList.toggle("hidden", options.input !== true);
      inputLabel.textContent = options.inputLabel || t("dialog.input");
      inputEl.placeholder = options.inputPlaceholder || "";
      inputEl.value = options.inputValue || "";
    }

    if (selectField && selectEl && selectLabel) {
      selectField.classList.toggle("hidden", options.select !== true);
      selectLabel.textContent = options.selectLabel || t("dialog.input");
      selectEl.innerHTML = "";
      for (const item of options.selectOptions || []) {
        if (!item?.value) continue;
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label || item.value;
        option.selected = item.value === (options.selectValue || "");
        selectEl.appendChild(option);
      }
      if (!selectEl.value && selectEl.options.length > 0) {
        selectEl.value = options.selectValue || selectEl.options[0].value;
      }
    }

    dialog.showModal();
    if (options.input && inputEl) {
      queueMicrotask(() => inputEl.focus());
    } else {
      queueMicrotask(() => okBtn.focus());
    }

    return new Promise<AppDialogResult>((resolve) => {
      resolver = resolve;
    });
  };
}
