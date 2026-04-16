// ── Interaction reply/reject helper ──
// Shared low-level API wrappers used by the inline conversation cards
// (InteractionPermissionPart, InteractionQuestionPart) and the headless
// PermissionAutoResolver.
//
// `autoReply` is required on every call: `false` for direct user actions
// (permission card buttons, question submissions), `true` for the headless
// auto-approval driver. This flag propagates all the way through to
// PermissionNext.Event.Replied so the transcript can render "[auto-reply]".

import { apiJson } from "./api";

const REPLY_TIMEOUT_MS = 30_000;

export async function replyInteraction(
  id: string,
  action: "once" | "always" | "answer",
  autoReply: boolean,
  input: { answers?: unknown[]; message?: string } = {},
): Promise<void> {
  if (action === "once" || action === "always") {
    await apiJson(`interaction/${id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: action, autoReply }),
      signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
    });
    return;
  }

  const answers = Array.isArray(input.answers) ? input.answers : undefined;
  const message =
    typeof input.message === "string" && input.message.trim()
      ? input.message.trim()
      : undefined;

  await apiJson(`interaction/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      autoReply,
      ...(answers ? { answers } : {}),
      ...(message ? { message } : {}),
    }),
    signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
  });
}

export async function rejectInteraction(id: string, autoReply: boolean): Promise<void> {
  await apiJson(`interaction/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoReply }),
    signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
  });
}
