import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { dialogStore, setDialogStore } from "../store/dialog";
import { dismissAppDialog, settleAppDialog } from "../services/app-dialog";
import { t } from "../utils/i18n";
import { Dialog } from "./primitives/Dialog";
import { Button } from "./ui/Button";

const TASK_DECISION_COUNTDOWN_TICK_MS = 250;

export function AppDialogHost() {
  let okButtonRef: HTMLButtonElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let selectRef: HTMLSelectElement | undefined;
  const [remainingSeconds, setRemainingSeconds] = createSignal(0);

  const isTaskRouteDecision = () => dialogStore.app.kind === "task-route-decision";
  const isTaskQueueDecision = () => dialogStore.app.kind === "task-queue-decision";
  const isTaskCardDecision = () => isTaskRouteDecision() || isTaskQueueDecision();
  const hasTaskDecisionCountdown = () => isTaskCardDecision() && Number(dialogStore.app.countdownSeconds || 0) > 0;
  const decisionEyebrow = () =>
    isTaskQueueDecision() ? t("task.queue_decision.eyebrow") : t("task.route_decision.eyebrow");
  const decisionCountdownText = () =>
    isTaskQueueDecision()
      ? t("task.queue_decision.countdown", { seconds: remainingSeconds() })
      : t("task.route_decision.countdown", { seconds: remainingSeconds() });
  const decisionDescription = (value: string) => {
    if (isTaskQueueDecision()) {
      return value === "start" ? t("task.queue_decision.start_desc") : t("task.queue_decision.queue_desc");
    }
    return value === "workflow" ? t("task.route_decision.agent_team_desc") : t("task.route_decision.direct_build_desc");
  };
  const chooseTaskDecision = (value: string) => {
    settleAppDialog(true, dialogStore.app.epoch, value);
  };

  createEffect(() => {
    if (!dialogStore.app.open || !hasTaskDecisionCountdown()) return;
    const epoch = dialogStore.app.epoch;
    const seconds = Math.max(1, Math.ceil(Number(dialogStore.app.countdownSeconds || 0)));
    setRemainingSeconds(seconds);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(0, seconds - elapsed);
      setRemainingSeconds(next);
      if (next <= 0) {
        window.clearInterval(timer);
        settleAppDialog(true, epoch);
      }
    }, TASK_DECISION_COUNTDOWN_TICK_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (!dialogStore.app.open) return;
    queueMicrotask(() => {
      if (dialogStore.app.input && inputRef) {
        inputRef.focus();
        inputRef.select();
        return;
      }
      if (dialogStore.app.select && !isTaskCardDecision() && selectRef) {
        selectRef.focus();
        return;
      }
      if (isTaskCardDecision()) {
        document.querySelector<HTMLButtonElement>("#appDialogBody .app-dialog-decision__choice")?.focus();
        return;
      }
      okButtonRef?.focus();
    });
  });

  return (
    <Dialog
      id="appDialog"
      open={dialogStore.app.open}
      data-dialog-epoch={String(dialogStore.app.epoch)}
      title={<span id="appDialogTitle">{dialogStore.app.title || t("dialog.notice")}</span>}
      formClass={isTaskCardDecision() ? "app-dialog-form--decision" : undefined}
      onClose={dismissAppDialog}
      footer={
        isTaskCardDecision() ? undefined : (
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
                okButtonRef = el;
              }}
              onClick={() => settleAppDialog(true, dialogStore.app.epoch)}
            >
              {dialogStore.app.okLabel || t("common.ok")}
            </Button>
          </>
        )
      }
    >
      <Show when={!isTaskCardDecision()}>
        <div class="app-dialog-body" id="appDialogBody" data-kind={dialogStore.app.kind || undefined}>
          {dialogStore.app.message || ""}
        </div>
      </Show>
      <Show when={isTaskCardDecision()}>
        <div class="app-dialog-decision" id="appDialogBody" data-kind={dialogStore.app.kind || undefined}>
          <div class="app-dialog-decision__copy">
            <span class="app-dialog-decision__eyebrow">{decisionEyebrow()}</span>
            <p>{dialogStore.app.message || ""}</p>
          </div>
          <div class="app-dialog-decision__choices" role="group" aria-label={dialogStore.app.selectLabel || ""}>
            <For each={dialogStore.app.selectOptions || []}>
              {(option) => {
                const selected = () => dialogStore.app.selectValue === option.value;
                const recommended = () => dialogStore.app.recommendedValue === option.value;
                return (
                  <button
                    type="button"
                    class="app-dialog-decision__choice"
                    data-selected={selected() ? "true" : "false"}
                    data-recommended={recommended() ? "true" : "false"}
                    onClick={() => chooseTaskDecision(option.value)}
                  >
                    <span class="app-dialog-decision__choice-top">
                      <span>{option.label || option.value}</span>
                      <Show when={recommended()}>
                        <span class="app-dialog-decision__badge">{t("task.route_decision.recommended")}</span>
                      </Show>
                    </span>
                    <span class="app-dialog-decision__choice-body">{decisionDescription(option.value)}</span>
                  </button>
                );
              }}
            </For>
          </div>
          <Show when={hasTaskDecisionCountdown()}>
            <div class="app-dialog-decision__timer" aria-live="polite">
              <span>{decisionCountdownText()}</span>
              <span class="app-dialog-decision__timer-track" aria-hidden="true">
                <span
                  class="app-dialog-decision__timer-fill"
                  style={{
                    width: `${Math.max(0, Math.min(100, (remainingSeconds() / Math.max(1, Number(dialogStore.app.countdownSeconds || 1))) * 100))}%`,
                  }}
                />
              </span>
            </div>
          </Show>
        </div>
      </Show>
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
            inputRef = el;
          }}
          onInput={(event) => {
            setDialogStore("app", "inputValue", event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              settleAppDialog(true, dialogStore.app.epoch);
            }
          }}
        />
      </label>
      <label
        classList={{ field: true, hidden: dialogStore.app.select !== true || isTaskCardDecision() }}
        id="appDialogSelectField"
      >
        <span class="field-label" id="appDialogSelectLabel">
          {dialogStore.app.selectLabel || t("dialog.input")}
        </span>
        <select
          class="field-input app-dialog-input custom-select"
          id="appDialogSelect"
          ref={(el) => {
            selectRef = el;
          }}
          value={dialogStore.app.selectValue || ""}
          onChange={(event) => {
            setDialogStore("app", "selectValue", event.currentTarget.value);
          }}
        >
          {(dialogStore.app.selectOptions || []).map((item) => (
            <option value={item.value}>{item.label || item.value}</option>
          ))}
        </select>
      </label>
    </Dialog>
  );
}
