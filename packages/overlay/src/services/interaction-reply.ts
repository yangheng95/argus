// ── Interaction reply/reject helper ──
// Shared low-level API wrappers used by the inline conversation cards
// (InteractionPermissionPart, InteractionQuestionPart) and the headless
// PermissionAutoResolver.

import { apiJson } from "./api";

const REPLY_TIMEOUT_MS = 30_000;

export async function replyInteraction(
  id: string,
  action: "once" | "always" | "answer",
  input: { answers?: unknown[]; message?: string } = {},
): Promise<void> {
  if (action === "once" || action === "always") {
    await apiJson(`interaction/${id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: action }),
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
      ...(answers ? { answers } : {}),
      ...(message ? { message } : {}),
    }),
    signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
  });
}

export async function rejectInteraction(id: string): Promise<void> {
  await apiJson(`interaction/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
  });
}
