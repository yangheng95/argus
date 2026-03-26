// ── Budget DOM bindings ──
// Imperative DOM manipulation for the budget configuration form.
// Reads/writes budget inputs, manages save/reset button state.

import { boardStore, loadBoard } from "../store/board";
import { appStore, setAppStore } from "../store/app";
import { sameBudget, draftBudget, budgetMinutes, type Budget } from "../utils/budget";
import { apiJson } from "./api";
import { t } from "../utils/i18n";

function taskBudget(task: any = boardStore.board?.task): Budget | undefined {
  const budget = task?.budget;
  if (!budget || typeof budget !== "object") return undefined;
  return {
    maxRuns: Number.isFinite(budget.maxRuns) ? budget.maxRuns : undefined,
    maxReplans: Number.isFinite(budget.maxReplans) ? budget.maxReplans : undefined,
    maxEvaluations: Number.isFinite(budget.maxEvaluations) ? budget.maxEvaluations : undefined,
    maxWallTimeMs: Number.isFinite(budget.maxWallTimeMs) ? budget.maxWallTimeMs : undefined,
  };
}

function setBudgetInputs(budget?: Budget): void {
  const setValue = (id: string, value: string): void => {
    const node = document.getElementById(id) as HTMLInputElement | null;
    if (node) node.value = value;
  };
  setValue("budgetMaxRuns", budget?.maxRuns === undefined ? "" : String(budget.maxRuns));
  setValue("budgetMaxReplans", budget?.maxReplans === undefined ? "" : String(budget.maxReplans));
  setValue(
    "budgetMaxEvaluations",
    budget?.maxEvaluations === undefined ? "" : String(budget.maxEvaluations),
  );
  setValue(
    "budgetMaxWallTime",
    budget?.maxWallTimeMs === undefined ? "" : budgetMinutes(budget.maxWallTimeMs),
  );
}

function orchestratorDefaults(): { maxRuns?: number; maxReplans?: number; maxEvaluations?: number; maxWallTimeMs?: number } {
  const orch = (appStore.config as any)?.orchestrator;
  if (!orch || typeof orch !== "object") return {};
  return {
    maxRuns: Number.isFinite(orch.max_runs) ? orch.max_runs : undefined,
    maxReplans: Number.isFinite(orch.max_replans) ? orch.max_replans : undefined,
    maxEvaluations: Number.isFinite(orch.max_evaluations) ? orch.max_evaluations : undefined,
    maxWallTimeMs: Number.isFinite(orch.max_wall_time_ms) ? orch.max_wall_time_ms : undefined,
  };
}

function setPlaceholders(): void {
  const defaults = orchestratorDefaults();
  const setPlaceholder = (id: string, value: string): void => {
    const node = document.getElementById(id) as HTMLInputElement | null;
    if (node) node.placeholder = value || t("budget.placeholder");
  };
  setPlaceholder("budgetMaxRuns", defaults.maxRuns != null ? String(defaults.maxRuns) : "");
  setPlaceholder("budgetMaxReplans", defaults.maxReplans != null ? String(defaults.maxReplans) : "");
  setPlaceholder("budgetMaxEvaluations", defaults.maxEvaluations != null ? String(defaults.maxEvaluations) : "");
  setPlaceholder("budgetMaxWallTime", defaults.maxWallTimeMs != null ? budgetMinutes(defaults.maxWallTimeMs) : "");
}

function renderBudgetState(task: any = boardStore.board?.task): void {
  const budget = taskBudget(task);
  const changed = !sameBudget(draftBudget(), budget);
  const taskID = task?.id || boardStore.selectedTaskID;
  const enabled = !!taskID && !appStore.budgetSaving;
  const saveButton = document.getElementById("btnBudgetSave") as HTMLButtonElement | null;
  const resetButton = document.getElementById("btnBudgetReset") as HTMLButtonElement | null;
  const reloadButton = document.getElementById("btnBudgetReload") as HTMLButtonElement | null;
  const hint = document.getElementById("budgetHint");
  if (saveButton) saveButton.disabled = !enabled || !changed;
  if (resetButton) resetButton.disabled = !enabled || (!changed && !appStore.budgetDirty);
  if (reloadButton) reloadButton.disabled = !enabled || appStore.budgetSaving;
  if (hint) {
    hint.textContent = taskID ? t("budget.hint") : t("budget.empty");
  }
  setPlaceholders();
  for (const input of [
    document.getElementById("budgetMaxRuns"),
    document.getElementById("budgetMaxReplans"),
    document.getElementById("budgetMaxEvaluations"),
    document.getElementById("budgetMaxWallTime"),
  ]) {
    if (input instanceof HTMLInputElement) input.disabled = !enabled;
  }
}

export function renderBudget(task?: any): void {
  const budget = taskBudget(task);
  if (!appStore.budgetDirty) setBudgetInputs(budget);
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
    setBudgetInputs(taskBudget());
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
    if (!boardStore.selectedTaskID || appStore.budgetSaving) return;
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      await apiJson(`task/${encodeURIComponent(boardStore.selectedTaskID)}/budget`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget: draftBudget() || null }),
      });
      setAppStore("budgetDirty", false);
      await loadBoard({ sync: true });
    } catch (error) {
      console.error("Failed to update task budget", error);
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
