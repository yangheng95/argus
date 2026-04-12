/**
 * WorkflowProgressBar — horizontal step indicator for the active MiniWorkflow.
 *
 * Shows task-scope steps as connected segments. Goal-scope steps are
 * collapsed into a single "Goals" segment. Each step shows its status
 * via color coding.
 */
import { For, Show, createMemo } from "solid-js";
import { t } from "../utils/i18n";

interface WorkflowStep {
  id: string;
  label: string;
  tool: string;
  scope: "task" | "goal";
  skippable: boolean;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
}

interface WorkflowProgressBarProps {
  workflow: {
    id: string;
    name: string;
    steps: WorkflowStep[];
    goalLoopStepIDs: string[];
  } | undefined;
}

function stepStatusClass(status: string): string {
  switch (status) {
    case "completed": return "wf-step--done";
    case "running": return "wf-step--running";
    case "failed": return "wf-step--failed";
    case "skipped": return "wf-step--skipped";
    default: return "wf-step--pending";
  }
}

function stepStatusIcon(status: string): string {
  switch (status) {
    case "completed": return "\u2713"; // checkmark
    case "running": return "\u25CB";   // circle
    case "failed": return "\u2717";    // cross
    case "skipped": return "\u2014";   // dash
    default: return "\u00B7";          // middle dot
  }
}

export function WorkflowProgressBar(props: WorkflowProgressBarProps) {
  const displaySteps = createMemo(() => {
    const wf = props.workflow;
    if (!wf) return [];

    const goalLoopIDs = new Set(wf.goalLoopStepIDs);
    const result: Array<{ id: string; label: string; status: string; isGoalGroup: boolean }> = [];
    let goalGroupAdded = false;

    for (const step of wf.steps) {
      if (goalLoopIDs.has(step.id)) {
        if (!goalGroupAdded) {
          // Aggregate all goal-scope steps into one "Goals" entry
          const goalSteps = wf.steps.filter(s => goalLoopIDs.has(s.id));
          const statuses = goalSteps.map(s => s.status);
          let aggregateStatus: string = "pending";
          if (statuses.some(s => s === "running")) aggregateStatus = "running";
          else if (statuses.every(s => s === "completed" || s === "skipped")) aggregateStatus = "completed";
          else if (statuses.some(s => s === "failed")) aggregateStatus = "failed";
          else if (statuses.some(s => s === "completed")) aggregateStatus = "running";

          result.push({
            id: "goal-loop",
            label: t("workflow.goals_label"),
            status: aggregateStatus,
            isGoalGroup: true,
          });
          goalGroupAdded = true;
        }
      } else {
        result.push({
          id: step.id,
          label: step.label,
          status: step.status,
          isGoalGroup: false,
        });
      }
    }
    return result;
  });

  return (
    <Show when={props.workflow}>
      <div class="wf-progress">
        <div class="wf-progress-label">{props.workflow!.name}</div>
        <div class="wf-progress-steps">
          <For each={displaySteps()}>
            {(step, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="wf-step-connector" />
                </Show>
                <span
                  class={`wf-step ${stepStatusClass(step.status)}`}
                  title={`${step.label}: ${step.status}`}
                >
                  <span class="wf-step-icon">{stepStatusIcon(step.status)}</span>
                  <span class="wf-step-label">{step.label}</span>
                </span>
              </>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
