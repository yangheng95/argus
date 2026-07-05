import { createEffect, Show } from "solid-js"
import { dialogStore, setDialogStore } from "../store/dialog"
import { dismissAppDialog, settleAppDialog } from "../services/app-dialog"
import { t } from "../utils/i18n"
import { Dialog } from "./primitives/Dialog"
import { Button } from "./ui/Button"
import { SelectControl } from "./ui/SelectControl"

type AppDialogSelectOption = { value: string; label?: string }

export function AppDialogHost() {
  let okButtonRef: HTMLButtonElement | undefined
  let inputRef: HTMLInputElement | undefined
  let selectRef: HTMLButtonElement | undefined

  const selectOptions = () => (dialogStore.app.selectOptions || []) as AppDialogSelectOption[]
  const selectedOption = () => selectOptions().find((item) => item.value === dialogStore.app.selectValue) ?? null
  const setSelectOption = (option: AppDialogSelectOption | null) => {
    if (!option) return
    setDialogStore("app", "selectValue", option.value)
  }

  createEffect(() => {
    if (!dialogStore.app.open) return
    queueMicrotask(() => {
      if (dialogStore.app.input && inputRef) {
        inputRef.focus()
        inputRef.select()
        return
      }
      if (dialogStore.app.select && selectRef) {
        selectRef.focus()
        return
      }
      okButtonRef?.focus()
    })
  })

  return (
    <Dialog
      id="appDialog"
      open={dialogStore.app.open}
      data-dialog-epoch={String(dialogStore.app.epoch)}
      title={<span id="appDialogTitle">{dialogStore.app.title || t("dialog.notice")}</span>}
      formClass="app-dialog-form"
      onClose={dismissAppDialog}
      footer={
        <>
          <Show when={dialogStore.app.cancel === true}>
            <Button
              type="button"
              id="btnAppDialogCancel"
              variant="ghost"
              size="md"
              tone="neutral"
              onClick={() => settleAppDialog(false, dialogStore.app.epoch)}
            >
              {dialogStore.app.cancelLabel || t("common.cancel")}
            </Button>
          </Show>
          <Button
            type="button"
            id="btnAppDialogOk"
            variant="solid"
            size="md"
            tone="accent"
            ref={(el) => {
              okButtonRef = el
            }}
            onClick={() => settleAppDialog(true, dialogStore.app.epoch)}
          >
            {dialogStore.app.okLabel || t("common.ok")}
          </Button>
        </>
      }
    >
      <div class="app-dialog-body" id="appDialogBody" data-kind={dialogStore.app.kind || undefined}>
        {dialogStore.app.message || ""}
      </div>
      <label classList={{ field: true, hidden: dialogStore.app.input !== true }} id="appDialogInputField">
        <span class="field-label" id="appDialogInputLabel">
          {dialogStore.app.inputLabel || t("dialog.input")}
        </span>
        <input
          class="field-input app-dialog-input"
          id="appDialogInput"
          type="text"
          placeholder={dialogStore.app.inputPlaceholder || ""}
          value={dialogStore.app.inputValue || ""}
          ref={(el) => {
            inputRef = el
          }}
          onInput={(event) => {
            setDialogStore("app", "inputValue", event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              settleAppDialog(true, dialogStore.app.epoch)
            }
          }}
        />
      </label>
      <label classList={{ field: true, hidden: dialogStore.app.select !== true }} id="appDialogSelectField">
        <span class="field-label" id="appDialogSelectLabel">
          {dialogStore.app.selectLabel || t("dialog.input")}
        </span>
        <SelectControl<AppDialogSelectOption>
          class="app-dialog-select"
          options={selectOptions()}
          value={selectedOption()}
          onChange={setSelectOption}
          optionValue="value"
          optionTextValue="label"
          disallowEmptySelection
          gutter={4}
          sameWidth
          triggerID="appDialogSelect"
          triggerClass="field-input app-dialog-input app-dialog-select-trigger"
          ariaLabelledBy="appDialogSelectLabel"
          triggerRef={(el) => {
            selectRef = el
          }}
          contentClass="app-dialog-select-content"
          listboxClass="app-dialog-select-listbox"
          optionClass="app-dialog-select-option"
          optionData={(option) => ({ "data-value": option.value })}
          renderValue={(option) => <span>{option?.label || option?.value || ""}</span>}
          renderOptionLabel={(option) => option.label || option.value}
        />
      </label>
    </Dialog>
  )
}
