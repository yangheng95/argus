import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { boardStore } from "../store/board";
import { appStore } from "../store/app";
import { settingsStore } from "../store/settings";
import {
  browseDirectory,
  loadRecentDirectories,
  setDirectory,
} from "../services/workspace";
import { t } from "../utils/i18n";
import { shortPath } from "../utils/tool";

function projectName(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

export function StartupWorkspaceDialog() {
  const [open, setOpen] = createSignal(true);
  const [recentDirs, setRecentDirs] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);

  onMount(() => setRecentDirs(loadRecentDirectories()));

  const currentDirectory = createMemo(() => settingsStore.directory.trim());
  const requiresDirectory = createMemo(() => !currentDirectory());
  const visible = createMemo(() =>
    appStore.i18nReady &&
    open() &&
    !boardStore.selectedTaskID &&
    requiresDirectory(),
  );
  const choices = createMemo(() => {
    const current = currentDirectory();
    const values = [
      ...(current ? [current] : []),
      ...recentDirs(),
    ];
    return values.filter((value, index) =>
      value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index,
    ).slice(0, 5);
  });

  async function choose(path: string) {
    setBusy(true);
    try {
      await setDirectory(path);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function browse() {
    setBusy(true);
    try {
      await browseDirectory();
      if (settingsStore.directory) setOpen(false);
    } finally {
      setBusy(false);
      setRecentDirs(loadRecentDirectories());
    }
  }

  return (
    <Show when={visible()}>
      <div class="startup-workspace" role="presentation" data-testid="startup-workspace-dialog">
        <section
          class="startup-workspace-dialog"
          role="dialog"
          aria-modal={requiresDirectory() ? "true" : "false"}
          aria-labelledby="startup-workspace-title"
        >
          <div class="startup-workspace-mark" aria-hidden="true">
            <img src="opencorvus-logo-dark.svg" alt="" />
          </div>
          <div class="startup-workspace-copy">
            <div class="startup-workspace-kicker">{t("startup.project_kicker")}</div>
            <h1 id="startup-workspace-title">{t("startup.project_title")}</h1>
            <p>{t("startup.project_body")}</p>
          </div>

          <div class="startup-workspace-actions">
            <button
              type="button"
              class="startup-workspace-primary"
              disabled={busy()}
              onClick={() => void browse()}
              data-testid="startup-open-folder"
            >
              {t("startup.open_folder")}
            </button>
          </div>

          <section class="startup-workspace-recent" aria-label={t("startup.recent_projects")}>
            <div class="startup-workspace-recent-title">{t("startup.recent_projects")}</div>
            <Show
              when={choices().length > 0}
              fallback={<div class="startup-workspace-empty">{t("cwd.recent_empty")}</div>}
            >
              <div class="startup-workspace-list">
                <For each={choices()}>
                  {(dir) => (
                    <button
                      type="button"
                      class="startup-workspace-project"
                      title={dir}
                      disabled={busy()}
                      onClick={() => void choose(dir)}
                      data-testid="startup-recent-project"
                    >
                      <span class="startup-workspace-project-name">{projectName(dir)}</span>
                      <span class="startup-workspace-project-path">{shortPath(dir)}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>

          <Show when={!requiresDirectory()}>
            <button
              type="button"
              class="startup-workspace-continue"
              disabled={busy()}
              onClick={() => setOpen(false)}
              data-testid="startup-continue-current"
            >
              {t("startup.continue_current")}
            </button>
          </Show>
        </section>
      </div>
    </Show>
  );
}
