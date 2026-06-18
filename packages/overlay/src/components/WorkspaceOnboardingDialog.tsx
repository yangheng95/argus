import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Dialog } from "./primitives/Dialog"
import { Button } from "./ui/Button"
import { Icon } from "./Icon"
import { settingsStore } from "../store/settings"
import { useAsyncAction } from "../solid/async-action"
import {
  browseDirectory,
  loadRecentDirectories,
  setDirectory,
  type DiscoveredProject,
} from "../services/workspace"
import { getHostTransport } from "../services/host-transport"
import { loadWorkspaceOnboardingDiscovery } from "../services/workspace-onboarding-discovery"
import { t } from "../utils/i18n"

function leafName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) || value
}

export function WorkspaceOnboardingDialog() {
  const [activeAction, setActiveAction] = createSignal<string>("")
  const [browserPathDraft, setBrowserPathDraft] = createSignal("")
  const [discoveredRoot, setDiscoveredRoot] = createSignal("")
  const [discoveredProjects, setDiscoveredProjects] = createSignal<DiscoveredProject[]>([])
  const [discoveryError, setDiscoveryError] = createSignal("")
  const open = createMemo(() => !settingsStore.directory)
  const manualWorkspacePathEntry = createMemo(() => getHostTransport().capabilities.ui.manualWorkspacePathEntry)
  const recentDirectories = createMemo(() => {
    settingsStore.directoryEpoch
    settingsStore.savedDirectory
    return loadRecentDirectories()
  })
  const actionRunner = useAsyncAction(async (key: string, fn: () => Promise<void>) => {
    setActiveAction(key)
    try {
      await fn()
    } finally {
      setActiveAction("")
    }
  })

  async function runAction(key: string, fn: () => Promise<void>) {
    if (actionRunner.pending()) return
    await actionRunner.run(key, fn)
  }

  async function submitBrowserPath(event: Event) {
    event.preventDefault()
    const next = browserPathDraft().trim()
    if (!next) return
    await runAction("browser-path", () => setDirectory(next))
  }

  onMount(() => {
    void loadWorkspaceOnboardingDiscovery().then((discovery) => {
      if (discovery.status === "ready") {
        setDiscoveryError("")
        setDiscoveredRoot(discovery.root)
        setDiscoveredProjects(discovery.projects)
        return
      }
      setDiscoveryError(discovery.message)
    })
  })

  return (
    <Dialog
      id="workspaceOnboardingDialog"
      open={open()}
      wide
      class="workspace-onboarding-dialog"
      formClass="workspace-onboarding-form"
      headerClass="workspace-onboarding-header"
      title={
        <div class="workspace-onboarding-titleblock">
          <span class="workspace-onboarding-kicker">{t("workspace_onboarding.kicker")}</span>
          <span>{t("workspace_onboarding.title")}</span>
        </div>
      }
      data-testid="workspace-onboarding-dialog"
    >
      <div class="workspace-onboarding">
        <section class="workspace-onboarding-hero">
          <div class="workspace-onboarding-status">
            <span class="workspace-onboarding-status-icon" aria-hidden="true">
              <Icon name="folder-open" />
            </span>
            <span>{t("workspace_onboarding.status")}</span>
          </div>
          <p class="workspace-onboarding-lead">{t("workspace_onboarding.subtitle")}</p>
        </section>

        <section class="workspace-onboarding-actions" aria-label={t("workspace_onboarding.actions_label")}>
          <article
            class="workspace-onboarding-action"
            data-kind="open"
            data-busy={activeAction() === "browse" ? "true" : "false"}
          >
            <div class="workspace-onboarding-action-head">
              <span class="workspace-onboarding-action-icon" aria-hidden="true">
                <Icon name="folder-open" />
              </span>
              <div class="workspace-onboarding-action-copy">
                <h3 class="workspace-onboarding-action-title">{t("workspace_onboarding.open_title")}</h3>
                <p class="workspace-onboarding-action-text">{t("workspace_onboarding.open_body")}</p>
              </div>
            </div>
            <Show
              when={manualWorkspacePathEntry()}
              fallback={
                <Button
                  type="button"
                  variant="solid"
                  size="md"
                  tone="accent"
                  data-testid="workspace-onboarding-open-folder"
                  disabled={actionRunner.pending()}
                  aria-busy={activeAction() === "browse" ? "true" : "false"}
                  onClick={() => void runAction("browse", () => browseDirectory())}
                >
                  <Icon name="folder-open" />
                  <span>{t("workspace_onboarding.open_action")}</span>
                </Button>
              }
            >
              <form
                class="workspace-onboarding-browser-path-form"
                data-testid="workspace-onboarding-browser-path-form"
                onSubmit={submitBrowserPath}
              >
                <label class="workspace-onboarding-browser-path-label">
                  <span>{t("workspace_onboarding.browser_path_label")}</span>
                  <input
                    value={browserPathDraft()}
                    onInput={(event) => setBrowserPathDraft(event.currentTarget.value)}
                    placeholder={t("workspace_onboarding.browser_path_placeholder")}
                    data-testid="workspace-onboarding-browser-path-input"
                    disabled={actionRunner.pending()}
                    autocomplete="off"
                    spellcheck={false}
                  />
                </label>
                <Button
                  type="submit"
                  variant="solid"
                  size="md"
                  tone="accent"
                  data-testid="workspace-onboarding-browser-path-submit"
                  disabled={actionRunner.pending() || !browserPathDraft().trim()}
                  aria-busy={activeAction() === "browser-path" ? "true" : "false"}
                >
                  <Icon name="folder-open" />
                  <span>{t("workspace_onboarding.browser_path_submit")}</span>
                </Button>
                <p class="workspace-onboarding-browser-path-hint">{t("workspace_onboarding.browser_path_hint")}</p>
              </form>
            </Show>
          </article>
        </section>

        <Show when={discoveryError()}>
          <section class="workspace-onboarding-discovery-error" data-testid="workspace-onboarding-discovery-error">
            <span class="workspace-onboarding-discovery-error-icon" aria-hidden="true">
              <Icon name="info-circle" />
            </span>
            <p>{discoveryError()}</p>
          </section>
        </Show>

        <Show when={discoveredProjects().length > 0}>
          <section class="workspace-onboarding-recent" data-kind="discovered">
            <div class="workspace-onboarding-section-head">
              <h3 class="workspace-onboarding-section-title">{t("cwd.detected_projects")}</h3>
              <p class="workspace-onboarding-section-text" title={discoveredRoot()}>
                {t("cwd.detected_projects_hint", { root: discoveredRoot() })}
              </p>
            </div>
            <div class="workspace-onboarding-recent-list">
              <For each={discoveredProjects().slice(0, 6)}>
                {(project, index) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    tone="neutral"
                    data-ui="workspace-onboarding-directory-row"
                    data-testid={`workspace-onboarding-detected-${index()}`}
                    data-busy={activeAction() === `detected:${project.directory}` ? "true" : "false"}
                    disabled={actionRunner.pending()}
                    aria-busy={activeAction() === `detected:${project.directory}` ? "true" : "false"}
                    onClick={() =>
                      void runAction(`detected:${project.directory}`, () => setDirectory(project.directory))
                    }
                  >
                    <span class="workspace-onboarding-recent-icon" aria-hidden="true">
                      <Icon name="folder" />
                    </span>
                    <span class="workspace-onboarding-recent-copy">
                      <span class="workspace-onboarding-recent-name">{project.name}</span>
                      <span class="workspace-onboarding-recent-path">{project.directory}</span>
                    </span>
                    <span class="workspace-onboarding-recent-open">
                      <Icon name="chevron" />
                    </span>
                  </Button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={recentDirectories().length > 0}>
          <section class="workspace-onboarding-recent">
            <div class="workspace-onboarding-section-head">
              <h3 class="workspace-onboarding-section-title">{t("workspace_onboarding.recent_title")}</h3>
              <p class="workspace-onboarding-section-text">{t("workspace_onboarding.recent_body")}</p>
            </div>
            <div class="workspace-onboarding-recent-list">
              <For each={recentDirectories().slice(0, 6)}>
                {(dir, index) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    tone="neutral"
                    data-ui="workspace-onboarding-directory-row"
                    data-testid={`workspace-onboarding-recent-${index()}`}
                    data-busy={activeAction() === `recent:${dir}` ? "true" : "false"}
                    disabled={actionRunner.pending()}
                    aria-busy={activeAction() === `recent:${dir}` ? "true" : "false"}
                    onClick={() => void runAction(`recent:${dir}`, () => setDirectory(dir))}
                  >
                    <span class="workspace-onboarding-recent-icon" aria-hidden="true">
                      <Icon name="folder" />
                    </span>
                    <span class="workspace-onboarding-recent-copy">
                      <span class="workspace-onboarding-recent-name">{leafName(dir)}</span>
                      <span class="workspace-onboarding-recent-path">{dir}</span>
                    </span>
                    <span class="workspace-onboarding-recent-open">
                      <Icon name="chevron" />
                    </span>
                  </Button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <p class="workspace-onboarding-footnote">{t("workspace_onboarding.footnote")}</p>
      </div>
    </Dialog>
  )
}
