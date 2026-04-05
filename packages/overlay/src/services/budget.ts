// ── Budget DOM bindings ──
// Imperative DOM manipulation for the budget configuration form.
// Reads/writes budget inputs, manages save/reset button state.

import { boardStore, loadBoard } from "../store/board";
import { appStore, setAppStore } from "../store/app";
import { sameBudget, draftBudget, budgetMinutes, type Budget } from "../utils/budget";
import { apiJson } from "./api";
import { patchConfig } from "./config";
import { t } from "../utils/i18n";

function taskBudget(task: any = boardStore.board?.task): Budget | undefined {
  const budget = task?.budget;
  if (!budget || typeof budget !== "object") return undefined;
  return {
    maxRuns: Number.isFinite(budget.maxRuns) ? budget.maxRuns : undefined,
    maxEvaluations: Number.isFinite(budget.maxEvaluations) ? budget.maxEvaluations : undefined,
    maxWallTimeMs: Number.isFinite(budget.maxWallTimeMs) ? budget.maxWallTimeMs : undefined,
    maxExecutorGroups: Number.isFinite(budget.maxExecutorGroups) ? budget.maxExecutorGroups : undefined,
  };
}

function setBudgetInputs(budget?: Budget): void {
  const setValue = (id: string, value: string): void => {
    const node = document.getElementById(id) as HTMLInputElement | null;
    if (node) node.value = value;
  };
  setValue("budgetMaxRuns", budget?.maxRuns === undefined ? "" : String(budget.maxRuns));
  setValue(
    "budgetMaxEvaluations",
    budget?.maxEvaluations === undefined ? "" : String(budget.maxEvaluations),
  );
  setValue(
    "budgetMaxWallTime",
    budget?.maxWallTimeMs === undefined ? "" : budgetMinutes(budget.maxWallTimeMs),
  );
  setValue(
    "budgetMaxExecutorGroups",
    budget?.maxExecutorGroups === undefined ? "" : String(budget.maxExecutorGroups),
  );
}

function configDefaults(): { maxRuns?: number; maxEvaluations?: number; maxWallTimeMs?: number; maxExecutorGroups?: number } {
  const orch = (appStore.config as any)?.assistant;
  if (!orch || typeof orch !== "object") return {};
  return {
    maxRuns: Number.isFinite(orch.max_runs) ? orch.max_runs : undefined,
    maxEvaluations: Number.isFinite(orch.max_evaluations) ? orch.max_evaluations : undefined,
    maxWallTimeMs: Number.isFinite(orch.max_wall_time_ms) ? orch.max_wall_time_ms : undefined,
    maxExecutorGroups: Number.isFinite(orch.max_executor_groups) ? orch.max_executor_groups : undefined,
  };
}

function setPlaceholders(): void {
  const defaults = configDefaults();
  const setPlaceholder = (id: string, value: string): void => {
    const node = document.getElementById(id) as HTMLInputElement | null;
    if (node) node.placeholder = value || t("budget.placeholder");
  };
  setPlaceholder("budgetMaxRuns", defaults.maxRuns != null ? String(defaults.maxRuns) : "");
  setPlaceholder("budgetMaxEvaluations", defaults.maxEvaluations != null ? String(defaults.maxEvaluations) : "");
  setPlaceholder("budgetMaxWallTime", defaults.maxWallTimeMs != null ? budgetMinutes(defaults.maxWallTimeMs) : "");
  setPlaceholder("budgetMaxExecutorGroups", defaults.maxExecutorGroups != null ? String(defaults.maxExecutorGroups) : "");
}

function renderBudgetState(task: any = boardStore.board?.task): void {
  const budget = taskBudget(task);
  const taskID = task?.id || boardStore.selectedTaskID;
  // Editable only when no task is selected — budget is pre-task configuration.
  // After a task starts the values are locked in; editing makes no sense.
  const inputsEnabled = !taskID && !appStore.budgetSaving;
  const changed = taskID
    ? !sameBudget(draftBudget(), budget)
    : appStore.budgetDirty;
  const enabled = !appStore.budgetSaving;
  const saveButton = document.getElementById("btnBudgetSave") as HTMLButtonElement | null;
  const resetButton = document.getElementById("btnBudgetReset") as HTMLButtonElement | null;
  const reloadButton = document.getElementById("btnBudgetReload") as HTMLButtonElement | null;
  const hint = document.getElementById("budgetHint");
  if (saveButton) saveButton.disabled = !inputsEnabled || !changed;
  if (resetButton) resetButton.disabled = !inputsEnabled || (!changed && !appStore.budgetDirty);
  if (reloadButton) reloadButton.disabled = !enabled || appStore.budgetSaving;
  if (hint) {
    hint.textContent = taskID ? t("budget.hint_readonly") : t("budget.hint");
  }
  setPlaceholders();
  for (const input of [
    document.getElementById("budgetMaxRuns"),
    document.getElementById("budgetMaxEvaluations"),
    document.getElementById("budgetMaxWallTime"),
    document.getElementById("budgetMaxExecutorGroups"),
  ]) {
    if (input instanceof HTMLInputElement) input.disabled = !inputsEnabled;
  }
}

export function renderBudget(task?: any): void {
  const taskID = task?.id || boardStore.selectedTaskID;
  if (!appStore.budgetDirty) {
    // When no task is selected, populate from global config defaults.
    // When a task is selected, show that task's actual budget.
    setBudgetInputs(taskID ? taskBudget(task) : (configDefaults() as Budget));
  }
  renderBudgetState(task);
}

function budgetSaveError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || "").trim();
  return detail ? `${t("budget.save_failed")}: ${detail}` : t("budget.save_failed");
}

export function installBudgetBindings(): void {
  const body = document.getElementById("budgetConfigBody");
  if (!(body instanceof HTMLElement) || body.dataset.boundBudget === "true") return;
  body.dataset.boundBudget = "true";

  body.addEventListener("input", () => {
    setAppStore("budgetDirty", true);
    renderBudgetState(boardStore.board?.task);
  });

  document.getElementById("btnBudgetReset")?.addEventListener("click", () => {
    setAppStore("budgetDirty", false);
    const taskID = boardStore.selectedTaskID;
    setBudgetInputs(taskID ? taskBudget() : (configDefaults() as Budget));
    renderBudgetState(boardStore.board?.task);
  });

  document.getElementById("btnBudgetReload")?.addEventListener("click", async () => {
    if (!boardStore.selectedTaskID || appStore.budgetSaving) return;
    setAppStore("budgetDirty", false);
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      await loadBoard({ sync: true });
    } finally {
      setAppStore("budgetSaving", false);
      renderBudget(boardStore.board?.task);
    }
  });

  document.getElementById("btnBudgetSave")?.addEventListener("click", async () => {
    if (appStore.budgetSaving) return;
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      const budget = draftBudget();
      if (boardStore.selectedTaskID) {
        // Task already running — patch the task budget.
        await apiJson(`task/${encodeURIComponent(boardStore.selectedTaskID)}/budget`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ budget: budget || null }),
        });
        await loadBoard({ sync: true });
      } else {
        // No task yet — persist as global default config for future tasks.
        await patchConfig({
          assistant: {
            max_runs: budget?.maxRuns ?? null,
            max_evaluations: budget?.maxEvaluations ?? null,
            max_wall_time_ms: budget?.maxWallTimeMs ?? null,
            max_executor_groups: budget?.maxExecutorGroups ?? null,
          },
        });
      }
      setAppStore("budgetDirty", false);
    } catch (error) {
      console.error("Failed to update budget", error);
      const nativeMessage = (window as any).nativeMessage;
      if (typeof nativeMessage === "function") {
        await nativeMessage(budgetSaveError(error), {
          title: t("section.budget"),
          kind: "error",
        });
      }
    } finally {
      setAppStore("budgetSaving", false);
      renderBudgetState(boardStore.board?.task);
    }
  });
}
