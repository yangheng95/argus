import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { appStore } from "../../store/app";
import { boardStore } from "../../store/board";
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings";
import { patchConfig, reloadProjectScope } from "../../services/config";
import { openConfigDialog } from "../../services/dialog";
import { applyOpacity, applyTheme, applyZoom, sanitizeOpacity, sanitizeZoom, toggleDevtools } from "../../services/theme";
import {
  PROJECT_EDITORS,
  browseDirectory,
  createDirectory,
  loadRecentDirectories,
  openDirectory,
  openDirectoryInEditor,
  setDirectory,
} from "../../services/workspace";
import { t } from "../../utils/i18n";

type MenuID = "workspace" | "model" | "run" | "tools" | "view" | "help";

type MenuDef = {
  id: MenuID;
  label: string;
  compact: string;
};

type TitlebarMenubarProps = {
  onOpenLog: () => void;
};

const MENU_IDS: MenuID[] = ["workspace", "model", "run", "tools", "view", "help"];

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function configNumber(path: "max_runs" | "max_executor_groups"): number | null {
  const raw = path === "max_runs"
    ? (appStore.config as any)?.assistant?.max_runs
    : (appStore.config as any)?.assistant?.max_executor_groups;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function projectModel(): string {
  const model = (appStore.config as any)?.model;
  return typeof model === "string" ? model : "";
}

function providerLabel(): string {
  const model = projectModel();
  if (!model.includes("/")) return t("agent_models.option_not_set");
  return model;
}

/* iter42 dropped `configuredChannelCount()` and
   `hasProviderAuthSetup()` — both were only consumed by the
   removed Channels status chip + the Setup CTA in
   TitlebarStatusCluster. After the chips are gone (per user
   feedback), the helpers have no remaining consumers. Both
   states are still surfaced inside the settings dialog
   (Channels panel + Providers panel) where they belong. */

function activeTaskLabel(): string {
  const task = (boardStore.board as any)?.task;
  const status = String(task?.status || "").trim();
  return status || t("task.status.idle");
}

function MenuItem(props: {
  children: any;
  onClick: () => void | Promise<void>;
  meta?: string;
  disabled?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      class="titlebar-menubar-item"
      disabled={props.disabled}
      data-testid={props.testid}
      onClick={() => void props.onClick()}
    >
      <span class="titlebar-menubar-item-title">{props.children}</span>
      <Show when={props.meta}>
        <span class="titlebar-menubar-item-meta">{props.meta}</span>
      </Show>
    </button>
  );
}

function MenuGroup(props: { title: string; children: any }) {
  return (
    <div class="titlebar-menubar-group" role="group" aria-label={props.title}>
      <div class="titlebar-menubar-group-title">{props.title}</div>
      {props.children}
    </div>
  );
}

function MenuRange(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  testid?: string;
  onChange: (value: number) => void | Promise<void>;
}) {
  function commit(event: Event) {
    void props.onChange(Number((event.target as HTMLInputElement).value));
  }

  return (
    <label class="titlebar-menubar-range">
      <span class="titlebar-menubar-range-copy">
        <span class="titlebar-menubar-item-title">{props.label}</span>
        <span class="titlebar-menubar-item-meta">
          {props.value}{props.unit || ""}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        data-testid={props.testid}
        onInput={commit}
        onChange={commit}
      />
    </label>
  );
}

export function TitlebarStatusCluster(props: { onOpenLog: () => void }) {
  // iter42: user feedback (2026-05-03) "标题栏的 model 和 channel
  // 不要再显示了". The Model + Channels chips and the conditional
  // Setup CTA they fed are removed. Model status now lives ONLY in
  // the composer chip (iter35/iter41) where it's contextual to the
  // outgoing message. Channel status lives ONLY inside the Tools /
  // Channels menu and the settings dialog. The cluster keeps the
  // Logs icon button — that's a peripheral utility, not a status
  // indicator, and it has no other entry point on the titlebar.
  return (
    <div class="titlebar-status-cluster" data-no-drag="true">
      <button
        type="button"
        class="titlebar-status-icon"
        aria-label={t("titlebar.logs")}
        title={t("titlebar.logs")}
        onClick={props.onOpenLog}
        data-testid="titlebar-open-logs"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3h10M3 6.5h8M3 10h6M3 13.5h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function TitlebarMenubar(props: TitlebarMenubarProps) {
  const [openMenu, setOpenMenu] = createSignal<MenuID | null>(null);
  const [recentDirs, setRecentDirs] = createSignal<string[]>([]);
  let rootRef: HTMLDivElement | undefined;

  const menus = createMemo<MenuDef[]>(() => [
    { id: "workspace", label: t("titlebar.menu.workspace"), compact: "W" },
    { id: "model", label: t("titlebar.menu.model"), compact: "M" },
    { id: "run", label: t("titlebar.menu.run"), compact: "R" },
    { id: "tools", label: t("titlebar.menu.tools"), compact: "T" },
    { id: "view", label: t("titlebar.menu.view"), compact: "V" },
    { id: "help", label: t("titlebar.menu.help"), compact: "?" },
  ]);

  function closeMenu() {
    setOpenMenu(null);
  }

  function open(id: MenuID) {
    setRecentDirs(loadRecentDirectories());
    setOpenMenu((current) => current === id ? null : id);
  }

  function openConfig(section: string) {
    openConfigDialog(section);
    closeMenu();
  }

  async function handlePatchBudget(key: "max_runs" | "max_executor_groups", value: number) {
    await patchConfig({ assistant: { [key]: value } });
  }

  function setTheme(value: string) {
    setSettingsStore("theme", value);
    applyTheme(value);
    saveSettings();
  }

  function setLocale(value: string) {
    setSettingsStore("locale", value);
    saveSettings();
  }

  function setOpacityPercent(value: number) {
    const next = sanitizeOpacity(value / 100);
    setSettingsStore("opacity", next);
    applyOpacity(next);
    saveSettings();
  }

  function setZoomPercent(value: number) {
    const next = sanitizeZoom(value / 100);
    setSettingsStore("zoom", next);
    applyZoom(next);
    saveSettings();
  }

  function resetLayout() {
    setSettingsStore({
      sidebarWidth: null,
      sectionsWidth: null,
      workspacePanelHeight: null,
      sidebarCollapsed: false,
    });
    saveSettings();
    closeMenu();
  }

  function focusExecutorSelector() {
    closeMenu();
    const button = document.querySelector<HTMLButtonElement>(".executor-chip");
    button?.focus();
  }

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!openMenu()) return;
      const target = event.target as Node | null;
      if (rootRef && target && rootRef.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!openMenu()) return;
      if (event.key === "Escape" || event.key === "Tab") {
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  function triggerKey(event: KeyboardEvent, id: MenuID) {
    const index = MENU_IDS.indexOf(id);
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpenMenu(id);
      queueMicrotask(() => {
        document.querySelector<HTMLElement>(`#titlebar-menu-${id} [role="menuitem"]:not([disabled])`)?.focus();
      });
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = MENU_IDS[(index + delta + MENU_IDS.length) % MENU_IDS.length];
    document.querySelector<HTMLButtonElement>(`[data-menu-trigger="${next}"]`)?.focus();
    if (openMenu()) setOpenMenu(next);
  }

  const maxRuns = createMemo(() => clampInt(configNumber("max_runs"), 1, 30));
  const maxGroups = createMemo(() => clampInt(configNumber("max_executor_groups"), 1, 10));
  const opacityPercent = createMemo(() => Math.round(settingsStore.opacity * 100));
  const zoomPercent = createMemo(() => Math.round(settingsStore.zoom * 100));

  return (
    <div class="titlebar-menubar" role="menubar" aria-label="OpenCorvus" data-no-drag="true" ref={(el) => (rootRef = el)}>
      <For each={menus()}>
        {(menu) => (
          <div class="titlebar-menubar-slot">
            <button
              type="button"
              class="titlebar-menubar-trigger"
              role="menuitem"
              data-menu-trigger={menu.id}
              data-compact={menu.compact}
              data-active={openMenu() === menu.id ? "true" : "false"}
              title={menu.label}
              aria-label={menu.label}
              aria-haspopup="menu"
              aria-expanded={openMenu() === menu.id ? "true" : "false"}
              aria-controls={`titlebar-menu-${menu.id}`}
              onClick={() => open(menu.id)}
              onKeyDown={(event) => triggerKey(event, menu.id)}
            >
              {menu.label}
            </button>
            <Show when={openMenu() === menu.id}>
              <div
                id={`titlebar-menu-${menu.id}`}
                class="titlebar-menubar-panel"
                role="menu"
                data-menu={menu.id}
                data-testid={`titlebar-menu-${menu.id}`}
              >
                <Show when={menu.id === "workspace"}>
                  <MenuGroup title={t("titlebar.menu.workspace")}>
                    <div class="titlebar-menubar-note" title={settingsStore.directory}>
                      {settingsStore.directory || t("intro.directory_required_title")}
                    </div>
                    <MenuItem onClick={() => void browseDirectory().finally(closeMenu)}>{t("cwd.browse")}</MenuItem>
                    <MenuItem onClick={() => void createDirectory().finally(closeMenu)}>{t("cwd.create")}</MenuItem>
                    <MenuItem onClick={() => void openDirectory().finally(closeMenu)} disabled={!settingsStore.directory}>{t("cwd.open")}</MenuItem>
                  </MenuGroup>
                  <MenuGroup title={t("cwd.open_with")}>
                    <For each={PROJECT_EDITORS}>
                      {(editor) => (
                        <MenuItem
                          onClick={() => void openDirectoryInEditor(editor.id).finally(closeMenu)}
                          disabled={!settingsStore.directory}
                        >
                          {editor.label}
                        </MenuItem>
                      )}
                    </For>
                  </MenuGroup>
                  <Show when={recentDirs().length > 0}>
                    <MenuGroup title={t("cwd.recent")}>
                      <For each={recentDirs().slice(0, 6)}>
                        {(dir) => (
                          <MenuItem onClick={() => void setDirectory(dir).finally(closeMenu)} meta={dir}>
                            {dir.split(/[\\/]/).filter(Boolean).at(-1) || dir}
                          </MenuItem>
                        )}
                      </For>
                    </MenuGroup>
                  </Show>
                </Show>

                <Show when={menu.id === "model"}>
                  <MenuGroup title={t("titlebar.menu.model")}>
                    <div class="titlebar-menubar-note">{providerLabel()}</div>
                    <MenuItem onClick={() => openConfig("providers")} testid="titlebar-open-providers">{t("cmdk.settings.providers")}</MenuItem>
                    <MenuItem onClick={() => openConfig("agent-models")} testid="titlebar-open-agent-models">{t("cmdk.settings.agent_models")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "run"}>
                  <MenuGroup title={t("titlebar.menu.run")}>
                    <MenuItem onClick={focusExecutorSelector} meta={settingsStore.executor}>{t("executor.group")}</MenuItem>
                    <MenuItem onClick={() => undefined} meta={activeTaskLabel()} disabled>{t("task.status.running")}</MenuItem>
                    <label class="titlebar-menubar-toggle">
                      <span>
                        <span class="titlebar-menubar-item-title">{t("titlebar.auto_question")}</span>
                        <span class="titlebar-menubar-item-meta">{t("titlebar.auto_question_hint")}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={(appStore.config as any)?.experimental?.auto_question === true}
                        aria-label={t("titlebar.auto_question")}
                        onChange={(event) => void patchConfig({ experimental: { auto_question: (event.currentTarget as HTMLInputElement).checked } })}
                      />
                    </label>
                    <MenuRange
                      label={t("titlebar.budget_max_runs")}
                      value={maxRuns() ?? 1}
                      min={1}
                      max={30}
                      step={1}
                      disabled={maxRuns() === null}
                      onChange={(value) => handlePatchBudget("max_runs", value)}
                    />
                    <MenuRange
                      label={t("titlebar.budget_max_executor_groups")}
                      value={maxGroups() ?? 1}
                      min={1}
                      max={10}
                      step={1}
                      disabled={maxGroups() === null}
                      onChange={(value) => handlePatchBudget("max_executor_groups", value)}
                    />
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "tools"}>
                  <MenuGroup title={t("titlebar.menu.tools")}>
                    <MenuItem onClick={() => openConfig("channel")}>{t("channel.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("tools")} testid="titlebar-open-tools">{t("extensions.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("permissions")}>{t("permissions.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("prompt")}>{t("prompt.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("memory")}>{t("memory.title")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "view"}>
                  <MenuGroup title={t("titlebar.menu.view")}>
                    <div class="titlebar-theme-options titlebar-theme-options-menubar" role="radiogroup" aria-label={t("settings.theme.label")}>
                      <For each={[
                        ["vscode-dark", t("settings.theme.vscode_dark")],
                        ["dark", t("settings.theme.dark")],
                        ["light", t("settings.theme.light")],
                        ["system", t("settings.theme.system")],
                      ]}>
                        {(item) => (
                          <button
                            type="button"
                            class="titlebar-theme-option"
                            role="radio"
                            aria-checked={settingsStore.theme === item[0]}
                            data-active={settingsStore.theme === item[0] ? "true" : "false"}
                            data-testid={`titlebar-theme-${item[0]}`}
                            onClick={() => setTheme(item[0])}
                          >
                            <span class="titlebar-theme-option-swatch" data-theme={item[0]} aria-hidden="true" />
                            <span class="titlebar-theme-option-label">{item[1]}</span>
                          </button>
                        )}
                      </For>
                    </div>
                    <MenuItem onClick={() => setLocale(settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN")} meta={settingsStore.locale} testid="titlebar-toggle-locale">
                      {t("settings.language")}
                    </MenuItem>
                    <MenuRange
                      label={t("settings.opacity.label")}
                      value={opacityPercent()}
                      min={50}
                      max={100}
                      step={1}
                      unit="%"
                      testid="titlebar-opacity-range"
                      onChange={setOpacityPercent}
                    />
                    <MenuRange
                      label={t("titlebar.zoom")}
                      value={zoomPercent()}
                      min={80}
                      max={160}
                      step={5}
                      unit="%"
                      testid="titlebar-zoom-range"
                      onChange={setZoomPercent}
                    />
                    <MenuItem onClick={resetLayout}>{t("titlebar.reset_layout")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "help"}>
                  <MenuGroup title={t("titlebar.menu.help")}>
                    <MenuItem onClick={() => openConfig("general")}>{t("config.title")}</MenuItem>
                    <MenuItem onClick={() => void reloadProjectScope().finally(closeMenu)}>{t("common.refresh")}</MenuItem>
                    <MenuItem onClick={() => { toggleDevtools(); closeMenu(); }}>{t("titlebar.devtools")}</MenuItem>
                    <MenuItem onClick={() => { props.onOpenLog(); closeMenu(); }} testid="titlebar-help-logs">{t("titlebar.logs")}</MenuItem>
                    <MenuItem onClick={() => openConfig("about")}>{t("about.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("about")} testid="titlebar-connection-diagnostics">
                      {t("titlebar.connection_diagnostics")}
                    </MenuItem>
                  </MenuGroup>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
