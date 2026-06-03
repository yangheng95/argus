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
  frontendResearch: boolean;
  requirements: boolean;
  architect: boolean;
};

const STEP_SECTION_BY_ID: Record<string, string> = {
  frontend_design: "frontendResearch",
  frontend_research: "frontendResearch",
  requirements: "requirements",
  architect: "architect",
  build: "goalWorkflows",
  deliver: "acceptance",
  refine: "acceptance",
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
  const frontendResearchStatus = stepStatus(input.workflow, "frontend_research");
  const requirementsStatus = stepStatus(input.workflow, "requirements");
  const architectStatus = stepStatus(input.workflow, "architect");
  return {
    frontendResearch: hasConcreteStepState(frontendResearchStatus),
    requirements:
      hasConcreteStepState(requirementsStatus)
      || (Array.isArray(input.requirements) && input.requirements.length > 0),
    architect:
      hasConcreteStepState(architectStatus)
      || input.architect != null,
  };
}

export function taskScopeWorkflowSectionID(stepID: string | undefined | null): string {
  const id = String(stepID || "");
  return STEP_SECTION_BY_ID[id] ?? "";
}
