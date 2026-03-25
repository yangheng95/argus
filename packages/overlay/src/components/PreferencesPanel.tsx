// ── PreferencesPanel Component ──
// Knowledge/preferences panel that lists key-value preference entries, supports
// add/edit via a dialog, and allows deletion. Ports renderPreferences
// (app.js 10638–10666), preferenceScopeLabel (10668–10673), openPrefEdit
// (10675–10691), savePrefEdit (10693–10709), deletePreference (10711–10719),
// and loadPreferences (10623–10636).

import {
  createSignal,
  createMemo,
  For,
  Show,
} from "solid-js";
import { t } from "../utils/i18n";
import { apiJson } from "../services/api";

// ── Types ──

export interface Preference {
  id: string;
  key: string;
  value: string;
  scope: string;
  source: string;
}

// ── Helpers ──

function preferenceScopeLabel(pref: Pick<Preference, "scope" | "source">): string {
  if (pref?.scope === "cwd") return t("preference.scope.cwd");
  if (pref?.scope === "session") return t("preference.scope.session");
  if (pref?.scope === "global") return t("preference.scope.global");
  return pref?.scope || "";
}

// ── PrefEditDialog ──

interface PrefEditDialogProps {
  /** Pass an existing Preference to edit; pass null to add a new one. */
  pref: Preference | null;
  onClose: () => void;
  onSaved: () => void;
}

function PrefEditDialog(props: PrefEditDialogProps) {
  let dialogRef: HTMLDialogElement | undefined;

  const [key, setKey] = createSignal(props.pref?.key ?? "");
  const [value, setValue] = createSignal(props.pref?.value ?? "");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  const isEdit = () => !!props.pref;
  const title = () => (isEdit() ? t("preference.edit") : t("preference.add"));

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const k = key().trim();
    const v = value().trim();
    if (!k || !v) return;
    setSaving(true);
    setError("");
    try {
      const prefId = props.pref?.id ?? "";
      await apiJson(
        prefId
          ? `panel/knowledge/preference/${encodeURIComponent(prefId)}`
          : "panel/knowledge/preference",
        {
          method: prefId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, value: v }),
        },
      );
      dialogRef?.close();
      props.onSaved();
    } catch (e: any) {
      setError(e?.message || t("preference.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      class="dialog pref-edit-dialog"
      id="prefEditDialog"
      ref={(el) => {
        dialogRef = el;
        el?.showModal();
      }}
      onClose={props.onClose}
    >
      <div class="dialog-header">
        <span class="dialog-title" id="prefEditTitle">
          {title()}
        </span>
      </div>

      <form id="prefEditForm" onSubmit={(e) => void handleSubmit(e)}>
        {/* Hidden pref ID */}
        <input type="hidden" id="prefEditId" value={props.pref?.id ?? ""} />

        <div class="form-row">
          <label for="prefEditKey" class="form-label">
            {t("preference.key")}
          </label>
          <input
            id="prefEditKey"
            type="text"
            class="input"
            required
            value={key()}
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="form-row">
          <label for="prefEditValue" class="form-label">
            {t("preference.value")}
          </label>
          <textarea
            id="prefEditValue"
            class="input textarea"
            required
            rows={4}
            value={value()}
            onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        <Show when={!!error()}>
          <p class="form-error">{error()}</p>
        </Show>

        <div class="dialog-footer">
          <button
            type="button"
            id="btnCancelPrefEdit"
            class="btn btn-ghost"
            onClick={() => {
              dialogRef?.close();
              props.onClose();
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            disabled={saving()}
          >
            {saving() ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ── PreferencesPanel ──

export interface PreferencesPanelProps {
  /** Pass through to influence which preferences are shown, if applicable. */
  taskID?: string;
}

export function PreferencesPanel(_props: PreferencesPanelProps) {
  const [prefs, setPrefs] = createSignal<Preference[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editPref, setEditPref] = createSignal<Preference | null | "new">(
    undefined as any,
  );
  const [dialogOpen, setDialogOpen] = createSignal(false);

  // ── Data loading ──

  const loadPreferences = async () => {
    setLoading(true);
    try {
      const data = await apiJson("panel/knowledge/preference");
      setPrefs(Array.isArray(data) ? data : []);
    } catch {
      setPrefs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (prefId: string) => {
    if (!prefId) return;
    try {
      await apiJson(
        `panel/knowledge/preference/${encodeURIComponent(prefId)}`,
        { method: "DELETE" },
      );
      await loadPreferences();
    } catch {
      // Silently ignore; the list is the source of truth
    }
  };

  const openAdd = () => {
    setEditPref(null);
    setDialogOpen(true);
  };

  const openEdit = (pref: Preference) => {
    setEditPref(pref);
    setDialogOpen(true);
  };

  const handleSaved = () => {
    setDialogOpen(false);
    void loadPreferences();
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
  };

  // Load on mount
  loadPreferences();

  const badge = createMemo(() => {
    const n = prefs().length;
    return n > 0 ? String(n) : "";
  });

  return (
    <div class="preferences-panel">
      {/* Header */}
      <div class="panel-header">
        <span class="panel-title">
          {t("preference.title")}
          <Show when={badge()}>
            <span id="preferenceBadge" class="panel-badge">
              {badge()}
            </span>
          </Show>
        </span>
        <div class="panel-header-actions">
          <button
            type="button"
            id="btnPreferenceRefresh"
            class="btn btn-ghost mini"
            onClick={() => void loadPreferences()}
            disabled={loading()}
          >
            {t("common.refresh")}
          </button>
          <button
            type="button"
            id="btnPreferenceAdd"
            class="btn btn-ghost mini"
            onClick={openAdd}
          >
            {t("preference.add")}
          </button>
        </div>
      </div>

      {/* List */}
      <div id="preferenceList" class="pref-list">
        <Show
          when={prefs().length > 0}
          fallback={<div class="empty-hint">{t("preference.none")}</div>}
        >
          <For each={prefs()}>
            {(p) => (
              <div
                class="pref-item"
                data-pref-id={p.id}
                onClick={() => openEdit(p)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openEdit(p);
                }}
              >
                <div class="pref-item-head">
                  <span class="pref-item-key">{p.key}</span>
                  <span
                    class="knowledge-scope"
                    data-scope={p.scope}
                    data-source={p.source}
                  >
                    {preferenceScopeLabel(p)}
                  </span>
                  <div class="pref-item-actions">
                    <button
                      type="button"
                      class="btn btn-ghost mini danger"
                      data-pref-action="delete"
                      data-pref-id={p.id}
                      title={t("preference.delete_button_title")}
                      aria-label={t("preference.delete_button_title")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(p.id);
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
                <div class="pref-item-value">{p.value}</div>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Edit / Add dialog */}
      <Show when={dialogOpen()}>
        <PrefEditDialog
          pref={editPref() === null ? null : (editPref() as Preference | null)}
          onClose={handleDialogClose}
          onSaved={handleSaved}
        />
      </Show>
    </div>
  );
}
