import { createMemo, createSignal, For, Show } from "solid-js";
import { Dialog } from "./primitives/Dialog";
import { Button } from "./ui/Button";
import { Icon } from "./Icon";
import { settingsStore } from "../store/settings";
import {
  browseDirectory,
  createDirectory,
  loadRecentDirectories,
  setDirectory,
} from "../services/workspace";
import { t } from "../utils/i18n";

function leafName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value;
}

export function WorkspaceOnboardingDialog() {
  const [busyAction, setBusyAction] = createSignal<string>("");
  const open = createMemo(() => !settingsStore.directory);
  const recentDirectories = createMemo(() => {
    settingsStore.directoryEpoch;
    settingsStore.savedDirectory;
    return loadRecentDirectories();
  });

  async function runAction(key: string, fn: () => Promise<void>) {
    if (busyAction()) return;
    setBusyAction(key);
    try {
      await fn();
    } finally {
      setBusyAction("");
    }
  }

  return (
    <Dialog
      id="workspaceOnboardingDialog"
      open={open()}
      wide
      class="workspace-onboarding-dialog"
      formClass="workspace-onboarding-form"
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
          <article class="workspace-onboarding-action" data-kind="open">
            <div class="workspace-onboarding-action-head">
              <span class="workspace-onboarding-action-icon" aria-hidden="true">
                <Icon name="folder-open" />
              </span>
              <div class="workspace-onboarding-action-copy">
                <h3 class="workspace-onboarding-action-title">{t("workspace_onboarding.open_title")}</h3>
                <p class="workspace-onboarding-action-text">{t("workspace_onboarding.open_body")}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="solid"
              size="md"
              tone="accent"
              data-testid="workspace-onboarding-open-folder"
              disabled={!!busyAction()}
              onClick={() => void runAction("browse", () => browseDirectory())}
            >
              <Icon name="folder-open" />
              <span>{t("workspace_onboarding.open_action")}</span>
            </Button>
          </article>

          <article class="workspace-onboarding-action" data-kind="create">
            <div class="workspace-onboarding-action-head">
              <span class="workspace-onboarding-action-icon" aria-hidden="true">
                <Icon name="plus" />
              </span>
              <div class="workspace-onboarding-action-copy">
                <h3 class="workspace-onboarding-action-title">{t("workspace_onboarding.create_title")}</h3>
                <p class="workspace-onboarding-action-text">{t("workspace_onboarding.create_body")}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="md"
              tone="neutral"
              data-testid="workspace-onboarding-create-project"
              disabled={!!busyAction()}
              onClick={() => void runAction("create", () => createDirectory())}
            >
              <Icon name="plus" />
              <span>{t("workspace_onboarding.create_action")}</span>
            </Button>
          </article>
        </section>

        <Show when={recentDirectories().length > 0}>
          <section class="workspace-onboarding-recent">
            <div class="workspace-onboarding-section-head">
              <h3 class="workspace-onboarding-section-title">{t("workspace_onboarding.recent_title")}</h3>
              <p class="workspace-onboarding-section-text">{t("workspace_onboarding.recent_body")}</p>
            </div>
            <div class="workspace-onboarding-recent-list">
              <For each={recentDirectories().slice(0, 6)}>
                {(dir, index) => (
                  <button
                    type="button"
                    class="workspace-onboarding-recent-item"
                    data-testid={`workspace-onboarding-recent-${index()}`}
                    disabled={!!busyAction()}
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
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <p class="workspace-onboarding-footnote">{t("workspace_onboarding.footnote")}</p>
      </div>
    </Dialog>
  );
}
