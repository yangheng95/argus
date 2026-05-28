import { createEffect } from "solid-js";
import { dialogStore, setDialogStore } from "../store/dialog";
import { closeGoalDialog, saveGoalDialog } from "../services/dialog";
import { t } from "../utils/i18n";
import { Dialog } from "./primitives/Dialog";
import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea";
import { Button } from "./ui/Button";

export function GoalDialogHost() {
  let titleRef: HTMLTextAreaElement | undefined;

  createEffect(() => {
    if (!dialogStore.goal.open) return;
    queueMicrotask(() => {
      titleRef?.focus();
      titleRef?.select();
    });
  });

  return (
    <Dialog
      id="goalDialog"
      open={dialogStore.goal.open}
      title={<span id="goalDialogTitle">{t("goal.title")}</span>}
      onClose={closeGoalDialog}
      footer={
        <>
          <Button
            type="button"
            id="btnCancelGoal"
            variant="ghost"
            size="md"
            tone="neutral"
            disabled={dialogStore.goal.saving}
            onClick={closeGoalDialog}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="goalForm"
            id="btnSaveGoal"
            variant="solid"
            size="md"
            tone="accent"
            disabled={dialogStore.goal.saving || !dialogStore.goal.title.trim()}
          >
            {dialogStore.goal.saving ? t("common.saving") : t("goal.save")}
          </Button>
        </>
      }
    >
      <form
        class="goal-dialog-form"
        id="goalForm"
        onSubmit={(event) => {
          event.preventDefault();
          void saveGoalDialog();
        }}
      >
        <input type="hidden" name="goalId" id="goalId" value={dialogStore.goal.goalID} />
        <label class="field">
          <span class="field-label" innerHTML={t("goal.field.title") + " <em>*</em>"} />
          <AutoGrowTextarea
            class="composer-textarea"
            id="goalDescription"
            name="title"
            required={true}
            rows={3}
            maxLines={4}
            placeholder={t("goal.field.title_placeholder")}
            value={dialogStore.goal.title}
            ref={(el) => {
              titleRef = el;
            }}
            onInput={(event) => {
              setDialogStore("goal", "title", event.currentTarget.value);
            }}
          />
        </label>
        <label class="field">
          <span class="field-label">{t("goal.field.acceptance")}</span>
          <AutoGrowTextarea
            class="composer-textarea"
            id="goalCriteria"
            name="acceptance"
            rows={3}
            maxLines={10}
            placeholder={t("goal.field.acceptance_placeholder")}
            value={dialogStore.goal.acceptance}
            onInput={(event) => {
              setDialogStore("goal", "acceptance", event.currentTarget.value);
            }}
          />
        </label>
      </form>
    </Dialog>
  );
}
