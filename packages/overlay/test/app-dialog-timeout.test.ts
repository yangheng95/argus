import { afterEach, describe, expect, mock, test } from "bun:test"
import { dialogStore } from "../src/store/dialog"

mock.module("../src/services/dialog", () => ({
  closeConfigDialog() {},
  openConfigDialog() {},
}))

const { dismissAppDialog, settleAppDialog, showAppDialog } = await import("../src/services/app-dialog")
const { nativeSelect } = await import("../src/utils/native")

afterEach(() => {
  dismissAppDialog()
})

describe("app dialog countdown authority", () => {
  test("select dialogs reject missing selectValue before opening", () => {
    expect(() =>
      showAppDialog({
        title: "Pick",
        message: "Pick one",
        select: true,
        selectOptions: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ).toThrow("requires selectValue")
    expect(dialogStore.app.open).toBe(false)
  })

  test("select dialogs reject values outside selectOptions before opening", () => {
    expect(() =>
      showAppDialog({
        title: "Pick",
        message: "Pick one",
        select: true,
        selectValue: "c",
        selectOptions: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ).toThrow("is not in selectOptions")
    expect(dialogStore.app.open).toBe(false)
  })

  test("select dialogs settle the same value shown by the store", async () => {
    const result = showAppDialog({
      title: "Pick",
      message: "Pick one",
      select: true,
      inputLabel: "Input",
      selectLabel: "Choice",
      selectValue: "b",
      okLabel: "OK",
      cancelLabel: "Cancel",
      selectOptions: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    })
    expect(dialogStore.app.selectValue).toBe("b")
    settleAppDialog(true, dialogStore.app.epoch)
    await expect(result).resolves.toEqual({ confirmed: true, value: "b" })
  })

  test("task decision dialogs reject invalid stored choice values", () => {
    expect(() =>
      showAppDialog({
        kind: "task-queue-decision",
        title: "Queue",
        message: "Choose",
        selectValue: "later",
        countdownSeconds: 30,
        selectOptions: [
          { value: "start", label: "Start" },
          { value: "queue", label: "Queue" },
        ],
      }),
    ).toThrow("is not in selectOptions")
    expect(dialogStore.app.open).toBe(false)
  })

  test("nativeSelect requires its caller to provide an explicit valid value", async () => {
    await expect(
      nativeSelect("Pick one", {
        title: "Pick",
        selectLabel: "Choice",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      } as any),
    ).rejects.toThrow("requires selectValue")
    await expect(
      nativeSelect("Pick one", {
        title: "Pick",
        selectLabel: "Choice",
        selectValue: "c",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ).rejects.toThrow("is not in options")
    expect(dialogStore.app.open).toBe(false)
  })

  test("countdown dialogs auto-settle without relying on the dialog component", async () => {
    const result = await showAppDialog({
      kind: "task-queue-decision",
      title: "Queue",
      message: "Choose",
      inputLabel: "Input",
      selectLabel: "Choice",
      okLabel: "OK",
      cancelLabel: "Cancel",
      recommendedValue: "start",
      selectValue: "start",
      countdownSeconds: 0.01,
      selectOptions: [
        { value: "start", label: "Start" },
        { value: "queue", label: "Queue" },
      ],
    })

    expect(result).toEqual({ confirmed: true, value: "start" })
    expect(dialogStore.app.open).toBe(false)
  })

  test("opening a new dialog resolves the previous countdown dialog as cancelled", async () => {
    const first = showAppDialog({
      kind: "task-queue-decision",
      title: "Queue",
      message: "Queue?",
      inputLabel: "Input",
      selectLabel: "Choice",
      okLabel: "OK",
      cancelLabel: "Cancel",
      recommendedValue: "start",
      selectValue: "start",
      countdownSeconds: 30,
      selectOptions: [
        { value: "start", label: "Start" },
        { value: "queue", label: "Queue" },
      ],
    })

    const second = showAppDialog({
      title: "Next",
      message: "Next",
      inputLabel: "Input",
      selectLabel: "Choice",
      okLabel: "OK",
      cancelLabel: "Cancel",
    })

    await expect(first).resolves.toEqual({ confirmed: false, value: null })
    settleAppDialog(true, dialogStore.app.epoch)
    await expect(second).resolves.toEqual({ confirmed: true, value: null })
  })
})
