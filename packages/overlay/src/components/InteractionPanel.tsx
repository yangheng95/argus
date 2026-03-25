// ── InteractionPanel ──
// Renders the list of pending interactions (permission requests and questions)
// from board.interactions, and exposes resolve/reject callbacks.
//
// Ported from interactions.js (renderInteractions, interactionAlertHtml,
// interactionActions, interactionIcon, resolveInteraction, rejectInteraction)
// and app.js (interactionAnswerLines, interactionRequestText, etc.).

import {
  createSignal,
  createMemo,
  For,
  Show,
} from "solid-js";
import { boardStore } from "../store/board";
import { settingsStore } from "../store/settings";
import { apiJson } from "../services/api";
import { t } from "../utils/i18n";

// ── Types ──

export interface InteractionQuestion {
  header?: string;
  question?: string;
  options?: Array<{ label: string; [key: string]: any }>;
}

export interface InteractionPayload {
  questions?: InteractionQuestion[];
  [key: string]: any;
}

export interface InteractionResponse {
  reply?: string;
  answers?: any[] | Record<string, any>;
  message?: string;
  [key: string]: any;
}

export interface Interaction {
  id: string;
  type: "permission" | "question";
  title: string;
  body: string;
  status: "pending" | "answered" | "rejected";
  time?: { created?: number; updated?: number; resolved?: number };
  payload?: InteractionPayload;
  response?: InteractionResponse;
}

// ── Helpers ──

function isRecord(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function interactionIcon(interaction: Interaction): string {
  return interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753";
}

function interactionAnswerLines(interaction: Interaction): string[] {
  const response = isRecord(interaction?.response) ? interaction.response! : null;
  const payload = isRecord(interaction?.payload) ? interaction.payload! : null;
  const questions = Array.isArray(payload?.questions) ? payload!.questions! : [];

  if (Array.isArray(response?.answers)) {
    return (response!.answers as any[]).flatMap(
      (answer: any, index: number) => {
        const value = Array.isArray(answer)
          ? answer
            .filter(
              (item: any) => typeof item === "string" && item.trim(),
            )
            .join(", ")
          : "";
        if (!value) return [];
        const question = isRecord(questions[index]) ? questions[index] : null;
        const label =
          typeof question?.header === "string" && question.header.trim()
            ? question.header.trim()
            : typeof question?.question === "string" &&
                question.question.trim()
              ? question.question.trim()
              : "";
        return [label ? `- **${label}**: ${value}` : `- ${value}`];
      },
    );
  }

  if (isRecord(response?.answers)) {
    return Object.entries(
      response!.answers as Record<string, any>,
    ).flatMap(([key, item], index) => {
      const answer = isRecord(item) ? item : null;
      const value = Array.isArray(answer?.answers)
        ? answer.answers
          .filter((entry: any) => typeof entry === "string" && entry.trim())
          .join(", ")
        : "";
      if (!value) return [];
      const question = isRecord(questions[index]) ? questions[index] : null;
      const label =
        typeof question?.header === "string" && question.header.trim()
          ? question.header.trim()
          : typeof question?.question === "string" &&
              question.question.trim()
            ? question.question.trim()
            : key;
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }

  const message =
    typeof response?.message === "string" ? response.message.trim() : "";
  return message ? [message] : [];
}

function interactionReplyLabel(reply: string): string {
  if (reply === "always") return t("interaction.always_allow");
  if (reply === "reject") return t("interaction.reject");
  return t("interaction.allow_once");
}

function autoInteractionAnswers(
  interaction: Interaction,
): (string[] | null)[] | null {
  const payload = isRecord(interaction?.payload) ? interaction.payload! : null;
  const questions = Array.isArray(payload?.questions) ? payload!.questions! : [];
  if (questions.length === 0) return null;
  return questions.map((item) => {
    const question = isRecord(item) ? item : null;
    const options = Array.isArray(question?.options) ? question!.options! : [];
    const selected = options.find(
      (option) =>
        isRecord(option) &&
        typeof option.label === "string" &&
        option.label.trim(),
    );
    if (selected && typeof selected.label === "string")
      return [selected.label.trim()];
    return null;
  });
}

function shouldAutoResolve(interaction: Interaction): boolean {
  if (!interaction || interaction.status !== "pending") return false;
  if (interaction.type === "permission") return settingsStore.autoPermission;
  if (interaction.type === "question")
    return settingsStore.autoQuestion || settingsStore.unattended;
  return false;
}

// ── Component ──

interface InteractionPanelProps {
  /** Called after a successful resolve/reject to trigger board reload. */
  onRespond?: (interactionID: string, response: any) => void;
}

export function InteractionPanel(props: InteractionPanelProps) {
  const [busy, setBusy] = createSignal(false);
  const [errorMap, setErrorMap] = createSignal<Record<string, string>>({});
  // Track auto-resolve failures per interaction ID → timestamp
  const autoResolveFailed = new Map<string, number>();
  const COOLDOWN_MS = 10_000;

  const pendingInteractions = createMemo<Interaction[]>(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item: any) => item?.status === "pending");
  });

  function setError(id: string, msg: string) {
    setErrorMap((prev) => ({ ...prev, [id]: msg }));
  }

  function clearError(id: string) {
    setErrorMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function resolveInteraction(
    id: string,
    action: string,
    input: { answers?: any[]; message?: string } = {},
  ) {
    if (busy()) return;
    setBusy(true);
    clearError(id);
    autoResolveFailed.delete(id);
    try {
      if (action === "once" || action === "always") {
        await apiJson(`interaction/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: action }),
          signal: AbortSignal.timeout(30_000),
        });
        props.onRespond?.(id, { reply: action });
        return;
      }

      const answers = Array.isArray(input.answers) ? input.answers : null;
      const message =
        typeof input.message === "string" && input.message.trim()
          ? input.message.trim()
          : "";

      await apiJson(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(answers ? { answers } : {}),
          ...(message ? { message } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      props.onRespond?.(id, { answers, message });
    } catch (error: any) {
      console.error("[InteractionPanel] resolveInteraction failed", error);
      const msg = error?.message || String(error);
      setError(id, msg);
      autoResolveFailed.set(id, Date.now());
    } finally {
      setBusy(false);
    }
  }

  async function rejectInteraction(id: string) {
    if (busy()) return;
    setBusy(true);
    clearError(id);
    try {
      await apiJson(`interaction/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30_000),
      });
      props.onRespond?.(id, { rejected: true });
    } catch (error: any) {
      console.error("[InteractionPanel] rejectInteraction failed", error);
      setError(id, error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  // Auto-resolve the first pending interaction when conditions are met.
  // Mirrors the auto-resolve logic in interactions.js renderInteractions.
  function tryAutoResolve(interaction: Interaction) {
    if (busy()) return;
    if (!shouldAutoResolve(interaction)) return;
    const lastFail = autoResolveFailed.get(interaction.id);
    if (lastFail && Date.now() - lastFail < COOLDOWN_MS) return;

    if (interaction.type === "permission") {
      const reply = settingsStore.autoPermission ? "always" : "once";
      void resolveInteraction(interaction.id, reply);
      return;
    }

    // question auto-resolve: requires structured options
    const answers = autoInteractionAnswers(interaction);
    if (
      !answers ||
      answers.some((item) => !Array.isArray(item) || item.length === 0)
    ) {
      console.warn(
        "[InteractionPanel] Skipping auto question reply — missing structured options",
        { interactionID: interaction.id },
      );
      return;
    }
    void resolveInteraction(interaction.id, "answer", { answers: answers as string[][] });
  }

  // Attempt auto-resolve whenever the pending list changes
  const firstPending = createMemo(() => pendingInteractions()[0] ?? null);

  // Use a reactive effect via createMemo side-effect — call tryAutoResolve
  // imperatively when firstPending changes (after render).
  let lastAutoId = "";
  createMemo(() => {
    const interaction = firstPending();
    if (!interaction) { lastAutoId = ""; return; }
    if (interaction.id === lastAutoId) return;
    lastAutoId = interaction.id;
    // Defer to next microtask so the DOM is settled
    queueMicrotask(() => tryAutoResolve(interaction));
  });

  return (
    <div class="interaction-panel">
      <For each={pendingInteractions()}>
        {(interaction) => (
          <div class="interaction-alert" data-id={interaction.id}>
            <div class="interaction-title">
              {interactionIcon(interaction)} {interaction.title}
            </div>
            <Show when={interaction.body}>
              <div class="interaction-body md-content">{interaction.body}</div>
            </Show>
            <Show when={errorMap()[interaction.id]}>
              <div class="interaction-error">
                {t("interaction.error", {
                  message: errorMap()[interaction.id],
                })}
              </div>
            </Show>
            <div class="interaction-actions">
              <Show
                when={interaction.type === "permission"}
                fallback={
                  <>
                    <button
                      class="btn btn-primary"
                      disabled={busy()}
                      title={t("interaction.answer_title")}
                      aria-label={t("interaction.answer_title")}
                      onClick={() =>
                        resolveInteraction(interaction.id, "answer")
                      }
                    >
                      {t("interaction.answer")}
                    </button>
                    <button
                      class="btn btn-ghost"
                      disabled={busy()}
                      title={t("interaction.skip_title")}
                      aria-label={t("interaction.skip_title")}
                      onClick={() => rejectInteraction(interaction.id)}
                    >
                      {t("interaction.skip")}
                    </button>
                  </>
                }
              >
                <button
                  class="btn btn-primary"
                  disabled={busy()}
                  title={t("interaction.always_allow_title")}
                  aria-label={t("interaction.always_allow_title")}
                  onClick={() =>
                    resolveInteraction(interaction.id, "always")
                  }
                >
                  {t("interaction.always_allow")}
                </button>
                <button
                  class="btn btn-ghost"
                  disabled={busy()}
                  title={t("interaction.allow_once_title")}
                  aria-label={t("interaction.allow_once_title")}
                  onClick={() =>
                    resolveInteraction(interaction.id, "once")
                  }
                >
                  {t("interaction.allow_once")}
                </button>
                <button
                  class="btn btn-ghost"
                  disabled={busy()}
                  title={t("interaction.reject_title")}
                  aria-label={t("interaction.reject_title")}
                  onClick={() => rejectInteraction(interaction.id)}
                >
                  {t("interaction.reject")}
                </button>
              </Show>
            </div>
          </div>
        )}
      </For>
      <Show when={pendingInteractions().length === 0}>
        <div class="interaction-panel-empty" />
      </Show>
    </div>
  );
}
