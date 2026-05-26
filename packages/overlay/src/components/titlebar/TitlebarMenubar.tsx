import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { appStore } from "../../store/app";
import { boardStore } from "../../store/board";
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings";
import { patchConfig, reloadProjectScope, syncAgentPromptLocale } from "../../services/config";
import { openConfigDialog } from "../../services/dialog";
import { applyOpacity, applyTheme, applyZoom, sanitizeOpacity, sanitizeZoom, toggleDevtools } from "../../services/theme";
import { themeOptionsForCurrentHost } from "../../services/theme-registry";
import {
  browseDirectory,
  closeProject,
  createDirectory,
  loadRecentDirectories,
  openDirectory,
  setDirectory,
} from "../../services/workspace";
import { t } from "../../utils/i18n";
import { Button } from "../ui/Button";

type MenuID = "workspace" | "agent" | "run" | "tools" | "skill" | "mcp" | "memory" | "view" | "help";

type MenuDef = {
  id: MenuID;
  label: string;
  compact: string;
  accessKey: string;
};

type TitlebarMenubarProps = {
  onOpenLog: () => void;
};

const MENU_IDS: MenuID[] = ["workspace", "agent", "run", "tools", "skill", "mcp", "memory", "view", "help"];
const MENU_ACCESS_KEYS: Record<MenuID, string> = {
  workspace: "p",
  agent: "a",
  run: "r",
  tools: "t",
  skill: "s",
  mcp: "c",
  memory: "y",
  view: "v",
  help: "h",
};

function menuIDForAccessKey(key: string): MenuID | null {
  const normalized = key.toLowerCase();
  return MENU_IDS.find((id) => MENU_ACCESS_KEYS[id] === normalized) ?? null;
}

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function configNumber(path: "max_executor_groups"): number | null {
  const raw = (appStore.config as any)?.assistant?.max_executor_groups;
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

function directoryLeaf(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).at(-1) || dir;
}

function RecentDirectoryMenuItem(props: {
  dir: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      class="titlebar-menubar-item titlebar-menubar-recent-item"
      title={props.dir}
      onClick={() => void props.onClick()}
    >
      <span class="titlebar-menubar-recent-name">{directoryLeaf(props.dir)}</span>
      <span class="titlebar-menubar-recent-path">{props.dir}</span>
    </button>
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

export function TitlebarMenubar(props: TitlebarMenubarProps) {
  const [openMenu, setOpenMenu] = createSignal<MenuID | null>(null);
  const [recentDirs, setRecentDirs] = createSignal<string[]>([]);
  let rootRef: HTMLDivElement | undefined;
  let altPressedOnly = false;

  const menus = createMemo<MenuDef[]>(() => [
    { id: "workspace", label: t("titlebar.menu.workspace"), compact: "P", accessKey: MENU_ACCESS_KEYS.workspace },
    { id: "agent", label: t("titlebar.menu.agent"), compact: "A", accessKey: MENU_ACCESS_KEYS.agent },
    { id: "run", label: t("titlebar.menu.run"), compact: "R", accessKey: MENU_ACCESS_KEYS.run },
    { id: "tools", label: t("titlebar.menu.tools"), compact: "T", accessKey: MENU_ACCESS_KEYS.tools },
    { id: "skill", label: t("titlebar.menu.skill"), compact: "S", accessKey: MENU_ACCESS_KEYS.skill },
    { id: "mcp", label: t("titlebar.menu.mcp"), compact: "C", accessKey: MENU_ACCESS_KEYS.mcp },
    { id: "memory", label: t("titlebar.menu.memory"), compact: "Y", accessKey: MENU_ACCESS_KEYS.memory },
    { id: "view", label: t("titlebar.menu.view"), compact: "V", accessKey: MENU_ACCESS_KEYS.view },
    { id: "help", label: t("titlebar.menu.help"), compact: "?", accessKey: MENU_ACCESS_KEYS.help },
  ]);

  function closeMenu() {
    setOpenMenu(null);
  }

  function open(id: MenuID) {
    setRecentDirs(loadRecentDirectories());
    setOpenMenu((current) => current === id ? null : id);
  }

  function focusTrigger(id: MenuID) {
    document.querySelector<HTMLButtonElement>(`[data-menu-trigger="${id}"]`)?.focus();
  }

  function focusFirstMenuItem(id: MenuID) {
    queueMicrotask(() => {
      document.querySelector<HTMLElement>(`#titlebar-menu-${id} [role="menuitem"]:not([disabled])`)?.focus();
    });
  }

  function openFromKeyboard(id: MenuID) {
    setRecentDirs(loadRecentDirectories());
    setOpenMenu(id);
    focusFirstMenuItem(id);
  }

  function openConfig(section: string) {
    openConfigDialog(section);
    closeMenu();
  }

  async function handlePatchGoalParallelism(value: number) {
    await patchConfig({ assistant: { max_executor_groups: value } });
  }

  async function handlePatchCompactionThreshold(percent: number) {
    const clamped = Math.min(100, Math.max(10, Math.round(percent)));
    const ratio = Math.round(clamped) / 100;
    await patchConfig({ compaction: { threshold: ratio } });
  }

  async function handlePatchProposedTaskConfirmation(enabled: boolean) {
    await patchConfig({ experimental: { confirm_proposed_tasks: enabled } });
  }

  function setTheme(value: string) {
    setSettingsStore("theme", value);
    applyTheme(value);
    saveSettings();
  }

  function setLocale(value: string) {
    setSettingsStore("locale", value);
    void syncAgentPromptLocale(value);
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
      rightPanelCollapsed: false,
    });
    saveSettings();
    closeMenu();
  }

  function focusExecutorSelector() {
    closeMenu();
    const button = document.querySelector<HTMLButtonElement>('[data-ui="executor-chip"]');
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
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        altPressedOnly = true;
        event.preventDefault();
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const id = menuIDForAccessKey(event.key);
        altPressedOnly = false;
        if (id) {
          event.preventDefault();
          openFromKeyboard(id);
          return;
        }
      } else if (event.key !== "Alt") {
        altPressedOnly = false;
      }
      if (!openMenu()) return;
      if (event.key === "Escape" || event.key === "Tab") {
        closeMenu();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || !altPressedOnly) return;
      altPressedOnly = false;
      event.preventDefault();
      const current = openMenu();
      if (current) {
        closeMenu();
        focusTrigger(current);
      } else {
        focusTrigger("workspace");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    });
  });

  function triggerKey(event: KeyboardEvent, id: MenuID) {
    const index = MENU_IDS.indexOf(id);
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpenMenu(id);
      focusFirstMenuItem(id);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = MENU_IDS[(index + delta + MENU_IDS.length) % MENU_IDS.length];
    document.querySelector<HTMLButtonElement>(`[data-menu-trigger="${next}"]`)?.focus();
    if (openMenu()) setOpenMenu(next);
  }

  const maxGroups = createMemo(() => clampInt(configNumber("max_executor_groups"), 1, 10));
  const compactionThresholdPercent = createMemo(() => {
    const raw = Number((appStore.config as any)?.compaction?.threshold);
    const ratio = Number.isFinite(raw) && raw > 0 ? raw : 0.8;
    return Math.round(ratio * 100);
  });
  const opacityPercent = createMemo(() => Math.round(settingsStore.opacity * 100));
  const zoomPercent = createMemo(() => Math.round(settingsStore.zoom * 100));
  const themeOptions = themeOptionsForCurrentHost();

  return (
    /* OpenCorvus is the product brand name, so this menubar landmark keeps the literal brand label. */
    <div class="titlebar-menubar" role="menubar" aria-label="OpenCorvus" data-no-drag="true" ref={(el) => (rootRef = el)}>
      <For each={menus()}>
        {(menu) => (
          <div class="titlebar-menubar-slot">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="neutral"
              role="menuitem"
              data-ui="titlebar-menubar-trigger"
              data-menu-trigger={menu.id}
              data-compact={menu.compact}
              data-access-key={menu.accessKey}
              data-active={openMenu() === menu.id ? "true" : "false"}
              title={menu.label}
              aria-label={menu.label}
              aria-keyshortcuts={`Alt+${menu.accessKey.toUpperCase()}`}
              aria-haspopup="menu"
              aria-expanded={openMenu() === menu.id ? "true" : "false"}
              aria-controls={`titlebar-menu-${menu.id}`}
              onClick={() => open(menu.id)}
              onKeyDown={(event) => triggerKey(event, menu.id)}
            >
              <span class="titlebar-menu-trigger-label">{menu.label}</span>
              <span class="titlebar-menu-trigger-compact" aria-hidden="true">{menu.compact}</span>
            </Button>
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
                      {settingsStore.directory || t("workspace.no_directory")}
                    </div>
                    <MenuItem onClick={() => void browseDirectory().finally(closeMenu)}>{t("cwd.browse")}</MenuItem>
                    <MenuItem onClick={() => void createDirectory().finally(closeMenu)}>{t("cwd.create")}</MenuItem>
                    <MenuItem onClick={() => void openDirectory().finally(closeMenu)} disabled={!settingsStore.directory}>{t("cwd.open")}</MenuItem>
                    <MenuItem onClick={() => { closeProject(); closeMenu(); }} disabled={!settingsStore.directory} testid="titlebar-close-project">
                      {t("project.close")}
                    </MenuItem>
                    <MenuItem onClick={() => openConfig("general")}>{t("config.title")}</MenuItem>
                  </MenuGroup>
                  <Show when={recentDirs().length > 0}>
                    <MenuGroup title={t("cwd.recent")}>
                      <For each={recentDirs().slice(0, 6)}>
                        {(dir) => (
                          <RecentDirectoryMenuItem
                            dir={dir}
                            onClick={() => void setDirectory(dir).finally(closeMenu)}
                          />
                        )}
                      </For>
                    </MenuGroup>
                  </Show>
                </Show>

                <Show when={menu.id === "agent"}>
                  <MenuGroup title={t("titlebar.menu.agent")}>
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
                    <label class="titlebar-menubar-toggle">
                      <span>
                        <span class="titlebar-menubar-item-title">{t("titlebar.confirm_proposed_tasks")}</span>
                        <span class="titlebar-menubar-item-meta">{t("titlebar.confirm_proposed_tasks_hint")}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={(appStore.config as any)?.experimental?.confirm_proposed_tasks === true}
                        aria-label={t("titlebar.confirm_proposed_tasks")}
                        data-testid="titlebar-confirm-proposed-tasks"
                        onChange={(event) => void handlePatchProposedTaskConfirmation((event.currentTarget as HTMLInputElement).checked)}
                      />
                    </label>
                    <MenuRange
                      label={t("titlebar.budget_max_executor_groups")}
                      value={maxGroups() ?? 1}
                      min={1}
                      max={10}
                      step={1}
                      disabled={maxGroups() === null}
                      onChange={(value) => handlePatchGoalParallelism(value)}
                    />
                    <MenuRange
                      label={t("titlebar.compaction_threshold")}
                      value={compactionThresholdPercent()}
                      min={10}
                      max={100}
                      step={5}
                      unit="%"
                      testid="titlebar-compaction-threshold-range"
                      onChange={(value) => handlePatchCompactionThreshold(value)}
                    />
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "tools"}>
                  <MenuGroup title={t("titlebar.menu.tools")}>
                    <MenuItem onClick={() => openConfig("channel")}>{t("channel.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("permissions")}>{t("permissions.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("prompt")}>{t("prompt.title")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "skill"}>
                  <MenuGroup title={t("titlebar.menu.skill")}>
                    <MenuItem onClick={() => openConfig("skill")} testid="titlebar-open-skills">{t("skill.title")}</MenuItem>
                    <MenuItem onClick={() => openConfig("skill-market")} testid="titlebar-open-skill-market">{t("skill.market.title")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "mcp"}>
                  <MenuGroup title={t("titlebar.menu.mcp")}>
                    <MenuItem onClick={() => openConfig("mcp")} testid="titlebar-open-mcp">{t("mcp.title")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "memory"}>
                  <MenuGroup title={t("titlebar.menu.memory")}>
                    <MenuItem onClick={() => openConfig("memory")} testid="titlebar-open-memory">{t("memory.title")}</MenuItem>
                  </MenuGroup>
                </Show>

                <Show when={menu.id === "view"}>
                  <MenuGroup title={t("titlebar.menu.view")}>
                    <div class="titlebar-theme-options titlebar-theme-options-menubar" role="radiogroup" aria-label={t("settings.theme.label")}>
                      <For each={themeOptions}>
                        {(item) => (
                          <button
                            type="button"
                            class="titlebar-theme-option"
                            role="radio"
                            aria-checked={settingsStore.theme === item.id}
                            data-active={settingsStore.theme === item.id ? "true" : "false"}
                            data-testid={`titlebar-theme-${item.id}`}
                            onClick={() => setTheme(item.id)}
                          >
                            <span class="titlebar-theme-option-swatch" data-theme={item.id} aria-hidden="true" />
                            <span class="titlebar-theme-option-label">{t(`settings.theme.${item.i18nSlug}`)}</span>
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
