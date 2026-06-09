/**
 * PermissionsPanel — Default tool permission actions for new tasks.
 *
 * Each tool permission can be: allow | ask | deny
 * Changes are saved immediately via PATCH /config (tool_permissions).
 * The settingsStore is updated via init.ts on next config load.
 *
 * Rebuilt on 2026-05-26 onto the `.s-*` settings primitives — see
 * specs/overlay-settings-primitives-2026-05-26.md.
 */
import { For } from "solid-js"
import { appStore } from "../../store/app"
import { t } from "../../utils/i18n"
import type { ToolPermAction } from "../../store/settings"
import { patchConfig } from "../../services/config"
import {
  SettingsGroup,
  SettingsPanel,
  SettingsRow,
  SettingsSegmented,
  type SettingsSegmentedOption,
} from "./primitives"

// ── Permission key metadata ──
// i18n convention: labels/descriptions are thunks that call `t()` with a
// string literal, not stored-then-indirect-lookup. This keeps the static
// analyzer in check-panel-i18n.ts able to recognise every referenced key.

interface PermDef {
  key: keyof ToolPermsObj
  label: () => string
  desc: () => string
}

type ToolPermsObj = {
  websearch: ToolPermAction
  webfetch: ToolPermAction
  skill: ToolPermAction
  external_directory: ToolPermAction
  task: ToolPermAction
  schedule: ToolPermAction
}

const PERM_ROWS: PermDef[] = [
  { key: "websearch", label: () => t("permissions.websearch"), desc: () => t("permissions.websearch_desc") },
  { key: "webfetch", label: () => t("permissions.webfetch"), desc: () => t("permissions.webfetch_desc") },
  { key: "skill", label: () => t("permissions.skill"), desc: () => t("permissions.skill_desc") },
  {
    key: "external_directory",
    label: () => t("permissions.external_directory"),
    desc: () => t("permissions.external_directory_desc"),
  },
  { key: "task", label: () => t("permissions.task"), desc: () => t("permissions.task_desc") },
  { key: "schedule", label: () => t("permissions.schedule"), desc: () => t("permissions.schedule_desc") },
]

function actionOptions(): SettingsSegmentedOption<ToolPermAction>[] {
  return [
    { value: "allow", label: t("permissions.action_allow"), tone: "ok" },
    { value: "ask", label: t("permissions.action_ask"), tone: "warn" },
    { value: "deny", label: t("permissions.action_deny"), tone: "bad" },
  ]
}

// ── Helpers ──

function toolPerms(): Partial<ToolPermsObj> {
  return (appStore.config as any)?.tool_permissions ?? {}
}

function currentAction(key: keyof ToolPermsObj): ToolPermAction {
  return toolPerms()[key] ?? "allow"
}

function setPermission(key: keyof ToolPermsObj, action: ToolPermAction): void {
  void patchConfig({ tool_permissions: { [key]: action } })
}

// ── Main Panel ──

export function PermissionsPanel() {
  return (
    <SettingsPanel>
      <SettingsGroup title={t("permissions.title")}>
        <SettingsRow desc={t("permissions.intro")} />
        <For each={PERM_ROWS}>
          {(row) => (
            <SettingsRow
              align="center"
              interactive
              title={row.label()}
              desc={row.desc()}
              actions={
                <SettingsSegmented
                  ariaLabel={row.label()}
                  options={actionOptions()}
                  value={currentAction(row.key)}
                  onChange={(next) => setPermission(row.key, next)}
                />
              }
            />
          )}
        </For>
      </SettingsGroup>
    </SettingsPanel>
  )
}
