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
// i18n convention: labels/descriptions are thunks that call `t()` with a
// string literal, not stored-then-indirect-lookup. This keeps the static
// analyzer in check-panel-i18n.ts able to recognise every referenced key.

interface PermRow {
  key: keyof ToolPermsObj;
  label: () => string;
  desc: () => string;
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
  { key: "websearch",          label: () => t("permissions.websearch"),          desc: () => t("permissions.websearch_desc") },
  { key: "webfetch",           label: () => t("permissions.webfetch"),           desc: () => t("permissions.webfetch_desc") },
  { key: "skill",              label: () => t("permissions.skill"),              desc: () => t("permissions.skill_desc") },
  { key: "external_directory", label: () => t("permissions.external_directory"), desc: () => t("permissions.external_directory_desc") },
  { key: "task",               label: () => t("permissions.task"),               desc: () => t("permissions.task_desc") },
  { key: "schedule",           label: () => t("permissions.schedule"),           desc: () => t("permissions.schedule_desc") },
];

const ACTION_OPTIONS: { value: ToolPermAction; label: () => string }[] = [
  { value: "allow", label: () => t("permissions.action_allow") },
  { value: "ask",   label: () => t("permissions.action_ask") },
  { value: "deny",  label: () => t("permissions.action_deny") },
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
        <span class="perm-row-label">{props.label()}</span>
        <span class="perm-row-desc">{props.desc()}</span>
      </div>
      <div class="perm-row-actions">
        <For each={ACTION_OPTIONS}>
          {(opt) => (
            <button
              class="perm-action-btn"
              data-active={currentAction(props.key) === opt.value ? "true" : undefined}
              data-action={opt.value}
              onClick={() => setPermission(props.key, opt.value)}
              title={opt.label()}
            >
              {opt.label()}
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
