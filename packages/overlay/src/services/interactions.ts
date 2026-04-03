// ── Interactions Service ──
// Responsibilities:
// - Render interaction alert HTML (permission / question cards)
// - Auto-resolve interactions based on settings (autoPermission, autoQuestion,
// unattended mode)
// - Manage a modal overlay for the frontmost pending interaction
// - Resolve or reject interactions via the API
// - Manage tray-attention signalling when a modal is visible but unfocused
// This module is intentionally DOM-oriented (it manipulates document nodes
// directly) so that it can serve as a
// window-scoped IIFE while the Solid migration proceeds. The newer
// InteractionPanel component (src/components/InteractionPanel.tsx) is the
// preferred way to render interactions within the Solid tree; this module is
// provided for completeness and for parts of the app that are not yet inside
// the Solid component tree.
// Integration:
// - Reads settingsStore for autoPermission / autoQuestion / unattended /
// autoPermissionReply flags.
// - Calls apiJson() for interaction reply / reject requests.
// - Calls loadBoard() after every resolve / reject to refresh state.

import { settingsStore } from "../store/settings";
import { appStore } from "../store/app";
import { apiJson } from "./api";
import { AppLog } from "../utils/log";

// ── Types ──

export interface InteractionQuestion {
  header?: string;
  question?: string;
  options?: Array<{ label: string; [key: string]: any }>;
  [key: string]: any;
}

export interface InteractionPayload {
  questions?: InteractionQuestion[];
  [key: string]: any;
}

export interface Interaction {
  id: string;
  type: "permission" | "question";
  title: string;
  body: string;
  status: "pending" | "answered" | "rejected";
  payload?: InteractionPayload;
  [key: string]: any;
}

export interface ResolveInput {
  answers?: any[];
  message?: string;
}

export interface InteractionsDeps {
  /** Optional state snapshot used by tests / legacy callers. */
  state?: Record<string, unknown>;
  /** Escape HTML for safe insertion. */
  escapeHtml: (s: string) => string;
  /** Translation function. */
  t: (key: string, vars?: Record<string, any>) => string;
  /** Render markdown to HTML string. */
  renderMarkdown: (text: string) => string;
  /**
 * Guard for plain-object values.
 * Returns true when value is a non-null, non-array object.
 */
  record: (value: any) => boolean;
  /** DOM document reference (may be undefined in SSR / tests). */
  document?: Document;
  /** DOM element references for inserting interaction alerts. */
  dom?: {
    goalsBody?: Element | null;
  };
  /** Set tray attention (e.g. icon badge) on / off. */
  setTrayAttention?: (active: boolean) => Promise<void>;
  /** Trigger a board reload after a resolve / reject. */
  loadBoard: () => Promise<void>;
  /** Optional API override used by tests / legacy callers. */
  apiJson?: typeof apiJson;
  /** Show a native prompt dialog and return the user's input or null. */
  nativePrompt: (
    message: string,
    opts?: {
      title?: string;
      okLabel?: string;
      cancelLabel?: string;
      inputLabel?: string;
    },
  ) => Promise<string | null>;
  /** Optional logger override used by tests / legacy callers. */
  AppLog?: typeof AppLog;
}

// ── Factory ──

/**
 * Create an interactions controller.
 * Mirrors interactions.js createOverlayInteractions(deps).
 * @param deps External dependencies injected by the caller.
 * Most callers will pass the live document and the app's DOM
 * element references.
 */
export function createOverlayInteractions(deps: InteractionsDeps) {
 // ── Module-level state ──

  let busy = false;
  let pendingInteraction: Interaction | null = null;
  /** interactionID → timestamp of last auto-resolve failure */
  const autoResolveFailed = new Map<string, number>();
  const api = deps.apiJson ?? apiJson;
  const logger = deps.AppLog ?? AppLog;

  function stateFlag(name: string, fallback: boolean): boolean {
    const value = deps.state?.[name];
    return typeof value === "boolean" ? value : fallback;
  }

  function autoPermissionReplyAction(): "always" | "once" {
    const value = deps.state?.autoPermissionReply;
    if (value === "always") return "always";
    return "once";
  }

 // ── HTML builders ──

  function interactionActions(interaction: Interaction): string {
    if (interaction.type === "permission") {
      return `<button class="btn btn-primary" data-action="always" title="${deps.escapeHtml(deps.t("interaction.always_allow_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.always_allow_title"))}">${deps.escapeHtml(deps.t("interaction.always_allow"))}</button>
         <button class="btn btn-ghost" data-action="once" title="${deps.escapeHtml(deps.t("interaction.allow_once_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.allow_once_title"))}">${deps.escapeHtml(deps.t("interaction.allow_once"))}</button>
         <button class="btn btn-ghost" data-action="reject" title="${deps.escapeHtml(deps.t("interaction.reject_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.reject_title"))}">${deps.escapeHtml(deps.t("interaction.reject"))}</button>`;
    }
    return `<button class="btn btn-primary" data-action="answer" title="${deps.escapeHtml(deps.t("interaction.answer_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.answer_title"))}">${deps.escapeHtml(deps.t("interaction.answer"))}</button>
         <button class="btn btn-ghost" data-action="reject" title="${deps.escapeHtml(deps.t("interaction.skip_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.skip_title"))}">${deps.escapeHtml(deps.t("interaction.skip"))}</button>`;
  }

  function interactionIcon(interaction: Interaction): string {
    return interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753";
  }

  function interactionAlertHtml(interaction: Interaction): string {
    return `<div class="interaction-alert" data-id="${deps.escapeHtml(interaction.id)}">
    <div class="interaction-title">${interactionIcon(interaction)} ${deps.escapeHtml(interaction.title)}</div>
    <div class="interaction-body md-content">${deps.renderMarkdown(interaction.body)}</div>
    <div class="interaction-actions">${interactionActions(interaction)}</div>
  </div>`;
  }

 // ── Auto-resolve helpers ──

  function autoInteractionAnswers(
    interaction: Interaction,
  ): (string[] | null)[] | null {
    const payload = deps.record(interaction?.payload) ? interaction.payload! : null;
    const questions = Array.isArray(payload?.questions) ? payload!.questions! : [];
    if (questions.length === 0) return null;
    return questions.map((item) => {
      const question = deps.record(item) ? item : null;
      const options = Array.isArray(question?.options) ? question!.options! : [];
      const selected = options.find(
        (option) =>
          deps.record(option) &&
          typeof option.label === "string" &&
          option.label.trim(),
      );
      if (selected && typeof selected.label === "string")
        return [selected.label.trim()];
      return null;
    });
  }

  function shouldAutoResolveInteraction(interaction: Interaction): boolean {
    if (!interaction || interaction.status !== "pending") return false;
    const exp = appStore.config?.experimental;
    if (interaction.type === "permission") {
      return stateFlag("autoPermission", exp?.auto_permission === true);
    }
    if (interaction.type === "question")
      return (
        stateFlag("autoQuestion", exp?.auto_question === true) ||
        stateFlag("unattended", exp?.unattended !== false)
      );
    return false;
  }

 // ── DOM binding ──

  function bindInteractionActions(root: Element | null | undefined): void {
    root
      ?.querySelectorAll?.(".interaction-alert [data-action]")
      ?.forEach((btn) => {
        const el = btn as HTMLButtonElement;
        if (el.dataset.bound === "true") return;
        el.dataset.bound = "true";
        el.addEventListener("click", () => {
          const alert = el.closest(".interaction-alert") as HTMLElement | null;
          const id = alert?.dataset.id;
          if (!id) return;
          const action = el.dataset.action;
          if (action === "reject") void rejectInteraction(id);
          else void resolveInteraction(id, action ?? "");
        });
      });
  }

 // ── Modal management ──

  function dismissInteractionModal(): void {
    const modal = deps.document?.getElementById("interaction-modal");
    if (modal) modal.remove();
    pendingInteraction = null;
    void refreshInteractionAttention();
  }

  function showInteractionModal(interaction: Interaction): void {
    let modal = deps.document?.getElementById("interaction-modal") as HTMLElement | null;
    if (modal && (modal as HTMLElement).dataset.interactionId === interaction.id) return;
    dismissInteractionModal();
    pendingInteraction = interaction;
    const html = `<div id="interaction-modal" class="interaction-modal-overlay" data-interaction-id="${deps.escapeHtml(interaction.id)}">
    <div class="interaction-modal">
      <div class="interaction-modal-title">${interactionIcon(interaction)} ${deps.escapeHtml(interaction.title)}</div>
      <div class="interaction-modal-body md-content">${deps.renderMarkdown(interaction.body)}</div>
      <div class="interaction-modal-actions">${interactionActions(interaction)}</div>
    </div>
  </div>`;
    deps.document?.body?.insertAdjacentHTML("beforeend", html);
    modal = deps.document?.getElementById("interaction-modal") as HTMLElement | null;
    modal?.querySelectorAll("[data-action]")?.forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.addEventListener("click", () => {
        const action = el.dataset.action;
        if (action === "reject") void rejectInteraction(interaction.id);
        else void resolveInteraction(interaction.id, action ?? "");
      });
    });
    void refreshInteractionAttention();
  }

 // ── Tray attention ──

  function attentionActive(): boolean {
    if (!pendingInteraction) return false;
    if (!deps.document) return true;
    return (
      deps.document.visibilityState === "hidden" ||
      !deps.document.hasFocus()
    );
  }

  async function refreshInteractionAttention(): Promise<void> {
    await deps.setTrayAttention?.(attentionActive());
  }

 // ── Button state helpers ──

  function disableInteractionButtons(id: string): void {
    const alert = deps.document?.querySelector(
      `.interaction-alert[data-id="${id}"]`,
    ) as HTMLElement | null;
    alert?.querySelectorAll("button")?.forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.disabled = true;
      el.style.opacity = "0.5";
    });
    const modal = deps.document?.querySelector(
      `#interaction-modal[data-interaction-id="${id}"]`,
    ) as HTMLElement | null;
    modal?.querySelectorAll("[data-action]")?.forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.disabled = true;
      el.style.opacity = "0.5";
    });
    const title = alert?.querySelector(".interaction-title");
    if (title) title.textContent += deps.t("interaction.processing_suffix");
  }

  function showInteractionError(id: string, msg: string): void {
    const alert = deps.document?.querySelector(
      `.interaction-alert[data-id="${id}"]`,
    ) as HTMLElement | null;
    const title = alert?.querySelector(".interaction-title");
    if (title) title.textContent = deps.t("interaction.error", { message: msg });
    alert?.querySelectorAll("button")?.forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.disabled = false;
      el.style.opacity = "";
    });
  }

 // ── Core actions ──

  async function resolveInteraction(
    id: string,
    action: string,
    input: ResolveInput = {},
  ): Promise<void> {
    if (busy) return;
    busy = true;
    autoResolveFailed.delete(id);
    disableInteractionButtons(id);
    try {
      if (action === "once" || action === "always") {
        await api(`interaction/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: action }),
          signal: AbortSignal.timeout(30000),
        });
        return;
      }

      const answers = Array.isArray(input.answers) ? input.answers : null;
      const message =
        typeof input.message === "string" && input.message.trim()
          ? input.message.trim()
          : "";

      if (!answers && !message) {
        const answer = await deps.nativePrompt(
          deps.t("interaction.reply_prompt"),
          {
            title: deps.t("interaction.reply_title"),
            okLabel: deps.t("common.submit"),
            cancelLabel: deps.t("common.cancel"),
            inputLabel: deps.t("interaction.answer_label"),
          },
        );
        if (answer == null) return;
        await api(`interaction/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: answer }),
          signal: AbortSignal.timeout(30000),
        });
        return;
      }

      await api(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answers || undefined,
          message: message || undefined,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error: any) {
      logger.error("ui", "Failed to resolve interaction", {
        error: String(error),
      });
      showInteractionError(id, error?.message || String(error));
      autoResolveFailed.set(id, Date.now());
    } finally {
      dismissInteractionModal();
      busy = false;
      await deps.loadBoard();
    }
  }

  async function rejectInteraction(id: string): Promise<void> {
    if (busy) return;
    busy = true;
    disableInteractionButtons(id);
    try {
      await api(`interaction/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error: any) {
      logger.error("ui", "Failed to reject interaction", {
        error: String(error),
      });
      showInteractionError(id, error?.message || String(error));
    } finally {
      dismissInteractionModal();
      busy = false;
      await deps.loadBoard();
    }
  }

  function isInteractionBusy(): boolean {
    return busy;
  }

 // ── renderInteractions ──

  /**
 * Render or update the interaction alert list in the DOM.
 * Called whenever the board is refreshed. Handles:
 * - Removing stale alert elements.
 * - Inserting fresh alert elements for all pending interactions.
 * - Auto-resolving the first pending interaction when configured.
 * - Showing the modal for the first interaction when not auto-resolving.
 * Mirrors interactions.js renderInteractions.
 */
  function renderInteractions(interactions: Interaction[]): void {
    const pending = Array.isArray(interactions)
      ? interactions.filter((item) => item.status === "pending")
      : [];

    const body = deps.dom?.goalsBody;

    body?.querySelectorAll(".interaction-alert")?.forEach((item) => item.remove());

    if (pending.length === 0) {
      dismissInteractionModal();
      return;
    }

    if (body) {
      body.insertAdjacentHTML(
        "beforeend",
        pending.map(interactionAlertHtml).join(""),
      );
      bindInteractionActions(body);
    }

    if (!busy && shouldAutoResolveInteraction(pending[0])) {
      const cooldownMs = 10000;
      const lastFail = autoResolveFailed.get(pending[0].id);
      if (lastFail && Date.now() - lastFail < cooldownMs) {
        pendingInteraction = pending[0];
        showInteractionModal(pending[0]);
        return;
      }
      dismissInteractionModal();
      if (pending[0].type === "permission") {
        void resolveInteraction(
          pending[0].id,
          autoPermissionReplyAction(),
        );
        return;
      }
      const answers = autoInteractionAnswers(pending[0]);
      if (
        !answers ||
        answers.some((item) => !Array.isArray(item) || item.length === 0)
      ) {
        logger.warn(
          "ui",
          "Skipping automatic question reply due to missing structured options",
          { interactionID: pending[0].id },
        );
        pendingInteraction = pending[0];
        showInteractionModal(pending[0]);
        return;
      }
      void resolveInteraction(pending[0].id, "answer", {
        answers: answers as string[][],
      });
      return;
    }

    if (!busy) {
      pendingInteraction = pending[0];
      showInteractionModal(pending[0]);
      return;
    }

    pendingInteraction = null;
    void refreshInteractionAttention();
  }

 // ── Public API (mirrors interactions.js return value) ──

  return {
    interactionAlertHtml,
    renderInteractions,
    showInteractionModal,
    dismissInteractionModal,
    resolveInteraction,
    rejectInteraction,
    isInteractionBusy,
    refreshInteractionAttention,
  };
}

// ── Convenience: standalone autoPermissionReply helper ──

/**
 * Returns the reply action to use when auto-resolving a permission
 * interaction. Reads settingsStore.autoPermission.
 * Defaults to "once" unless an explicit "always" preference is set
 * by the caller.
 */
export function autoPermissionReply(): "always" | "once" {
  return "once";
}
