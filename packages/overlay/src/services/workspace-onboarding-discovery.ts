import { t } from "../utils/i18n"
import { loadDiscoveredProjects, type DiscoveredProject, type ProjectDiscovery } from "./workspace"

export type WorkspaceOnboardingDiscoveryState =
  | { status: "ready"; root: string; projects: DiscoveredProject[] }
  | { status: "failed"; message: string }

function discoveryErrorMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error ?? "")
  return t("workspace_onboarding.discovery_failed", { reason })
}

export async function loadWorkspaceOnboardingDiscovery(
  loader: () => Promise<ProjectDiscovery> = loadDiscoveredProjects,
): Promise<WorkspaceOnboardingDiscoveryState> {
  try {
    const discovery = await loader()
    return {
      status: "ready",
      root: discovery.root,
      projects: discovery.projects,
    }
  } catch (error) {
    return {
      status: "failed",
      message: discoveryErrorMessage(error),
    }
  }
}
