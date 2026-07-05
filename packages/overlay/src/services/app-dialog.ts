// ── App Dialog Service ──
// Store-backed imperative API for the shared app dialog host.
// Call `showAppDialog(options)` / `nativeMessage(message, opts)` from anywhere.

import { t } from "../utils/i18n"
import { closeConfigDialog, openConfigDialog } from "./dialog"
import { dialogStore, setDialogStore } from "../store/dialog"

export type AppDialogOptions = {
  title?: string
  message?: string
  kind?: string
  okLabel?: string
  cancelLabel?: string
  cancel?: boolean
  input?: boolean
  inputLabel?: string
  inputPlaceholder?: string
  inputValue?: string
  select?: boolean
  selectLabel?: string
  selectValue?: string
  selectOptions?: Array<{ value: string; label?: string }>
}

export type AppDialogResult = { confirmed: boolean; value: string | null }

let resolver: ((value: AppDialogResult) => void) | null = null
let restoreConfigSection = ""
let appDialogSeq = 0
let ignoreNextDismiss = false

function dialogUsesChoiceValue(options: AppDialogOptions): boolean {
  return options.select === true
}

function validatedChoiceValue(options: AppDialogOptions): string {
  if (!dialogUsesChoiceValue(options)) return typeof options.selectValue === "string" ? options.selectValue : ""
  const selectOptions = Array.isArray(options.selectOptions) ? options.selectOptions : []
  if (selectOptions.length === 0) {
    throw new Error(`showAppDialog ${options.kind || "select"} requires non-empty selectOptions`)
  }
  for (const option of selectOptions) {
    if (typeof option?.value !== "string" || option.value.length === 0) {
      throw new Error(`showAppDialog ${options.kind || "select"} received an option without a value`)
    }
  }
  const selectValue = typeof options.selectValue === "string" ? options.selectValue : ""
  if (!selectValue) {
    throw new Error(`showAppDialog ${options.kind || "select"} requires selectValue`)
  }
  if (!selectOptions.some((option) => option.value === selectValue)) {
    throw new Error(
      `showAppDialog ${options.kind || "select"} selectValue ${JSON.stringify(selectValue)} is not in selectOptions`,
    )
  }
  return selectValue
}

export function showAppDialog(options: AppDialogOptions = {}): Promise<AppDialogResult> {
  const selectValue = validatedChoiceValue(options)

  if (resolver) {
    const resolve = resolver
    resolver = null
    resolve({ confirmed: false, value: null })
  }

  restoreConfigSection = dialogStore.config.open === true ? dialogStore.config.activeTab || "general" : ""
  if (restoreConfigSection) {
    closeConfigDialog()
  }

  const epoch = ++appDialogSeq

  setDialogStore("app", {
    open: true,
    epoch,
    title: options.title || t("dialog.notice"),
    message: options.message || "",
    kind: options.kind || "",
    okLabel: options.okLabel || t("common.ok"),
    cancelLabel: options.cancelLabel || t("common.cancel"),
    cancel: options.cancel === true,
    input: options.input === true,
    inputLabel: options.inputLabel || t("dialog.input"),
    inputPlaceholder: options.inputPlaceholder || "",
    inputValue: options.inputValue || "",
    select: options.select === true,
    selectLabel: options.selectLabel || t("dialog.input"),
    selectValue,
    selectOptions: options.selectOptions || [],
  })

  return new Promise<AppDialogResult>((resolve) => {
    resolver = resolve
  })
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
  })
}

export function settleAppDialog(confirmed: boolean, epoch?: number): void {
  if (typeof epoch === "number" && epoch !== dialogStore.app.epoch) return
  const inputValue =
    typeof document !== "undefined"
      ? (document.getElementById("appDialogInput") as HTMLInputElement | null)?.value
      : undefined
  const value =
    dialogStore.app.input
      ? (inputValue ?? dialogStore.app.inputValue ?? "")
      : dialogStore.app.select
        ? dialogStore.app.selectValue
        : null
  const resolve = resolver
  resolver = null
  ignoreNextDismiss = true
  setDialogStore("app", "open", false)
  resolve?.({ confirmed, value })
  if (restoreConfigSection) {
    const section = restoreConfigSection
    restoreConfigSection = ""
    queueMicrotask(() => openConfigDialog(section))
  }
}

export function dismissAppDialog(dialog?: HTMLElement): void {
  if (ignoreNextDismiss) {
    ignoreNextDismiss = false
    return
  }
  const epoch = Number(dialog?.dataset.dialogEpoch || dialogStore.app.epoch)
  if (epoch !== dialogStore.app.epoch) return
  const resolve = resolver
  resolver = null
  setDialogStore("app", "open", false)
  resolve?.({ confirmed: false, value: null })
  if (restoreConfigSection) {
    const section = restoreConfigSection
    restoreConfigSection = ""
    queueMicrotask(() => openConfigDialog(section))
  }
}
