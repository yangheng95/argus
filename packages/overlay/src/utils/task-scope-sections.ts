type WorkflowStep = {
  id?: string;
  status?: string;
};

type WorkflowLike = {
  steps?: WorkflowStep[];
};

export type TaskScopeSectionVisibilityInput = {
  workflow?: WorkflowLike | null;
  requirements?: unknown[] | null;
  architect?: unknown | null;
};

export type TaskScopeSectionVisibility = {
  requirements: boolean;
  architect: boolean;
};

function stepStatus(workflow: WorkflowLike | null | undefined, stepID: string): string {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  return String(steps.find((step) => step?.id === stepID)?.status || "");
}

function hasConcreteStepState(status: string): boolean {
  return status === "running" || status === "completed" || status === "failed";
}

export function taskScopeSectionVisibility(
  input: TaskScopeSectionVisibilityInput,
): TaskScopeSectionVisibility {
  const requirementsStatus = stepStatus(input.workflow, "requirements");
  const architectStatus = stepStatus(input.workflow, "architect");
  return {
    requirements:
      hasConcreteStepState(requirementsStatus)
      || (Array.isArray(input.requirements) && input.requirements.length > 0),
    architect:
      hasConcreteStepState(architectStatus)
      || input.architect != null,
  };
}
