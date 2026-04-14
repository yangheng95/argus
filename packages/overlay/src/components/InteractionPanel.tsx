// ── InteractionPanel ──
// Renders pending permission requests from board.interactions in the
// right-side inspector, with optional auto-resolve based on
// appStore.config.experimental.auto_permission. Question-type interactions
// are rendered inline in the conversation timeline (see
// InteractionQuestionPart); this panel does not handle them.

import {
  createSignal,
  createMemo,
  For,
  Show,
} from "solid-js";
import { boardStore } from "../store/board";
import { appStore } from "../store/app";
import {
  replyInteraction,
  rejectInteraction as rejectInteractionApi,
} from "../services/interaction-reply";
import { t } from "../utils/i18n";

// ── Types ──

export interface InteractionResponse {
  reply?: string;
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
  response?: InteractionResponse;
}

// ── Helpers ──

function interactionReplyLabel(reply: string): string {
  if (reply === "always") return t("interaction.always_allow");
  if (reply === "reject") return t("interaction.reject");
  return t("interaction.allow_once");
}

function interactionResponseSummary(interaction: Interaction): string {
  const reply = interaction.response?.reply;
  return typeof reply === "string"
    ? interactionReplyLabel(reply)
    : t("interaction.allow_once");
}

// ── Component ──

interface InteractionPanelProps {
  /** Called after a successful resolve/reject to trigger board reload. */
  onRespond?: (interactionID: string, response: any) => void;
}

export function InteractionPanel(props: InteractionPanelProps) {
  const [busy, setBusy] = createSignal(false);
  const [errorMap, setErrorMap] = createSignal<Record<string, string>>({});
  const autoResolveFailed = new Map<string, number>();
  const COOLDOWN_MS = 10_000;

  // Pending questions are rendered inline in the conversation timeline via
  // InteractionQuestionPart; this panel handles permission requests only.
  const pendingInteractions = createMemo<Interaction[]>(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item: any) => item?.status === "pending" && item?.type === "permission",
    );
  });

  /** Recently auto-replied permissions (last 60s, most recent first). */
  const recentAutoReplies = createMemo<Interaction[]>(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const WINDOW_MS = 60_000;
    return raw
      .filter(
        (item: any) =>
          item?.type === "permission" &&
          item?.status === "answered" &&
          item?.response?.auto_reply === true &&
          item?.time?.resolved &&
          now - item.time.resolved < WINDOW_MS,
      )
      .sort((a: any, b: any) => (b.time?.resolved ?? 0) - (a.time?.resolved ?? 0))
      .slice(0, 5);
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

  async function resolveInteraction(id: string, action: "once" | "always") {
    if (busy()) return;
    setBusy(true);
    clearError(id);
    autoResolveFailed.delete(id);
    try {
      await replyInteraction(id, action);
      props.onRespond?.(id, { reply: action });
    } catch (error: any) {
      console.error("[InteractionPanel] resolveInteraction failed", error);
      setError(id, error?.message || String(error));
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
      await rejectInteractionApi(id);
      props.onRespond?.(id, { rejected: true });
    } catch (error: any) {
      console.error("[InteractionPanel] rejectInteraction failed", error);
      setError(id, error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  function tryAutoResolve(interaction: Interaction) {
    if (busy()) return;
    if (!appStore.config?.experimental?.auto_permission) return;
    const lastFail = autoResolveFailed.get(interaction.id);
    if (lastFail && Date.now() - lastFail < COOLDOWN_MS) return;
    void resolveInteraction(interaction.id, "always");
  }

  const firstPending = createMemo(() => pendingInteractions()[0] ?? null);

  let lastAutoId = "";
  createMemo(() => {
    const interaction = firstPending();
    if (!interaction) {
      lastAutoId = "";
      return;
    }
    if (interaction.id === lastAutoId) return;
    lastAutoId = interaction.id;
    queueMicrotask(() => tryAutoResolve(interaction));
  });

  return (
    <div class="interaction-panel">
      <For each={pendingInteractions()}>
        {(interaction) => (
          <div class="interaction-alert" data-id={interaction.id}>
            <div class="interaction-title">
              {"\uD83D\uDD12"} {interaction.title}
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
              <button
                class="btn btn-primary"
                disabled={busy()}
                title={t("interaction.always_allow_title")}
                aria-label={t("interaction.always_allow_title")}
                onClick={() => resolveInteraction(interaction.id, "always")}
              >
                {t("interaction.always_allow")}
              </button>
              <button
                class="btn btn-ghost"
                disabled={busy()}
                title={t("interaction.allow_once_title")}
                aria-label={t("interaction.allow_once_title")}
                onClick={() => resolveInteraction(interaction.id, "once")}
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
            </div>
          </div>
        )}
      </For>
      <Show when={recentAutoReplies().length > 0}>
        <For each={recentAutoReplies()}>
          {(interaction) => (
            <div
              class="interaction-alert interaction-auto-replied"
              data-id={interaction.id}
            >
              <div class="interaction-title">
                <span class="interaction-auto-badge">
                  {t("interaction.auto_reply")}
                </span>{" "}
                {interaction.title}
              </div>
              <Show when={interaction.body}>
                <div class="interaction-body md-content">{interaction.body}</div>
              </Show>
              <Show when={interaction.response}>
                <div class="interaction-auto-answer">
                  {interactionResponseSummary(interaction)}
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show
        when={
          pendingInteractions().length === 0 && recentAutoReplies().length === 0
        }
      >
        <div class="interaction-panel-empty" />
      </Show>
    </div>
  );
}
