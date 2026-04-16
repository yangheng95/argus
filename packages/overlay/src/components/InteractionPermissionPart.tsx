// ── InteractionPermissionPart ──
// Renders a pending `type: "permission"` interaction inline inside the
// conversation timeline as a system-role message. Actions: allow once,
// always allow, reject. Auto-approval (experimental.auto_permission) is
// driven separately by PermissionAutoResolver so that concurrent inline
// cards don't race each other on the reply endpoint.

import { createSignal, Show } from "solid-js";
import { t } from "../utils/i18n";
import { loadBoard } from "../store/board";
import {
  replyInteraction,
  rejectInteraction,
} from "../services/interaction-reply";

interface Interaction {
  id: string;
  type: string;
  title?: string;
  body?: string;
  status: string;
}

interface InteractionPermissionPartProps {
  interaction: Interaction;
}

export function InteractionPermissionPart(
  props: InteractionPermissionPartProps,
) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  async function resolve(action: "once" | "always") {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await replyInteraction(props.interaction.id, action, false);
      await loadBoard();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await rejectInteraction(props.interaction.id, false);
      await loadBoard();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="interaction-alert interaction-alert-inline interaction-alert-permission"
      data-id={props.interaction.id}
    >
      <Show when={props.interaction.title}>
        <div class="interaction-title">
          {"\uD83D\uDD12"} {props.interaction.title}
        </div>
      </Show>
      <Show when={props.interaction.body}>
        <div class="interaction-body md-content">{props.interaction.body}</div>
      </Show>
      <Show when={error()}>
        <div class="interaction-error">
          {t("interaction.error", { message: error() })}
        </div>
      </Show>
      <div class="interaction-actions">
        <button
          class="btn btn-primary"
          disabled={busy()}
          title={t("interaction.always_allow_title")}
          aria-label={t("interaction.always_allow_title")}
          onClick={() => resolve("always")}
        >
          {t("interaction.always_allow")}
        </button>
        <button
          class="btn btn-ghost"
          disabled={busy()}
          title={t("interaction.allow_once_title")}
          aria-label={t("interaction.allow_once_title")}
          onClick={() => resolve("once")}
        >
          {t("interaction.allow_once")}
        </button>
        <button
          class="btn btn-ghost"
          disabled={busy()}
          title={t("interaction.reject_title")}
          aria-label={t("interaction.reject_title")}
          onClick={reject}
        >
          {t("interaction.reject")}
        </button>
      </div>
    </div>
  );
}
