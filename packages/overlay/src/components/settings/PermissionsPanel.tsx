/**
 * PermissionsPanel — Default tool permission actions for new tasks.
 *
 * Each tool permission can be: allow | ask | deny
 * Changes are saved immediately via PATCH /config (tool_permissions).
 * The settingsStore is updated via init.ts on next config load.
 */
import { For } from "solid-js";
import { appStore } from "../../store/app";
import { t } from "../../utils/i18n";
import type { ToolPermAction } from "../../store/settings";

// ── Config PATCH helper ──

async function patchConfig(patch: Record<string, unknown>): Promise<void> {
  const { patchConfig: doPatch } = await import("../../services/config");
  await doPatch(patch);
}

// ── Permission key metadata ──

interface PermRow {
  key: keyof ToolPermsObj;
  labelKey: string;
  descKey: string;
}

type ToolPermsObj = {
  websearch:          ToolPermAction;
  webfetch:           ToolPermAction;
  skill:              ToolPermAction;
  external_directory: ToolPermAction;
  task:               ToolPermAction;
  schedule:           ToolPermAction;
};

const PERM_ROWS: PermRow[] = [
  { key: "websearch",          labelKey: "permissions.websearch",          descKey: "permissions.websearch_desc" },
  { key: "webfetch",           labelKey: "permissions.webfetch",           descKey: "permissions.webfetch_desc" },
  { key: "skill",              labelKey: "permissions.skill",              descKey: "permissions.skill_desc" },
  { key: "external_directory", labelKey: "permissions.external_directory", descKey: "permissions.external_directory_desc" },
  { key: "task",               labelKey: "permissions.task",               descKey: "permissions.task_desc" },
  { key: "schedule",           labelKey: "permissions.schedule",           descKey: "permissions.schedule_desc" },
];

const ACTION_OPTIONS: { value: ToolPermAction; labelKey: string }[] = [
  { value: "allow", labelKey: "permissions.action_allow" },
  { value: "ask",   labelKey: "permissions.action_ask" },
  { value: "deny",  labelKey: "permissions.action_deny" },
];

// ── Helpers ──

function toolPerms(): Partial<ToolPermsObj> {
  return (appStore.config as any)?.tool_permissions ?? {};
}

function currentAction(key: keyof ToolPermsObj): ToolPermAction {
  return toolPerms()[key] ?? "allow";
}

function setPermission(key: keyof ToolPermsObj, action: ToolPermAction): void {
  void patchConfig({ tool_permissions: { [key]: action } });
}

// ── Permission Row ──

function PermRow(props: PermRow) {
  return (
    <div class="perm-row">
      <div class="perm-row-info">
        <span class="perm-row-label">{t(props.labelKey) || props.key}</span>
        <span class="perm-row-desc">{t(props.descKey)}</span>
      </div>
      <div class="perm-row-actions">
        <For each={ACTION_OPTIONS}>
          {(opt) => (
            <button
              class="perm-action-btn"
              data-active={currentAction(props.key) === opt.value ? "true" : undefined}
              data-action={opt.value}
              onClick={() => setPermission(props.key, opt.value)}
              title={t(opt.labelKey) || opt.value}
            >
              {t(opt.labelKey) || opt.value}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

// ── Main Panel ──

export function PermissionsPanel() {
  return (
    <div class="perm-panel">
      <p class="perm-panel-intro">{t("permissions.intro")}</p>
      <div class="perm-list">
        <For each={PERM_ROWS}>
          {(row) => <PermRow {...row} />}
        </For>
      </div>
    </div>
  );
}
