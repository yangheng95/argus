import { afterEach, describe, expect, test } from "bun:test";
import { dialogStore } from "../src/store/dialog";
import { dismissAppDialog, settleAppDialog, showAppDialog } from "../src/services/app-dialog";

afterEach(() => {
  dismissAppDialog();
});

describe("app dialog countdown authority", () => {
  test("countdown dialogs auto-settle without relying on the dialog component", async () => {
    const result = await showAppDialog({
      kind: "task-route-decision",
      title: "Route",
      message: "Choose",
      recommendedValue: "workflow",
      selectValue: "workflow",
      countdownSeconds: 0.01,
      selectOptions: [
        { value: "workflow", label: "Agent Team" },
        { value: "build", label: "Direct Build" },
      ],
    });

    expect(result).toEqual({ confirmed: true, value: "workflow" });
    expect(dialogStore.app.open).toBe(false);
  });

  test("opening a new dialog resolves the previous countdown dialog as cancelled", async () => {
    const first = showAppDialog({
      kind: "task-queue-decision",
      title: "Queue",
      message: "Queue?",
      recommendedValue: "start",
      selectValue: "start",
      countdownSeconds: 30,
      selectOptions: [
        { value: "start", label: "Start" },
        { value: "queue", label: "Queue" },
      ],
    });

    const second = showAppDialog({ title: "Next", message: "Next" });

    await expect(first).resolves.toEqual({ confirmed: false, value: null });
    settleAppDialog(true, dialogStore.app.epoch);
    await expect(second).resolves.toEqual({ confirmed: true, value: null });
  });
});
