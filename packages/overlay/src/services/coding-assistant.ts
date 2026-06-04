import { apiJson } from "./api"

export interface CodingAssistantSession {
  id: string
  title: string
  directory: string
  kind: "assistant"
  metadata?: Record<string, unknown>
}

export interface CodingAssistantSessionsResponse {
  sessions: CodingAssistantSession[]
}

export interface CodingAssistantSessionResponse {
  session: CodingAssistantSession
}

export async function listCodingAssistantSessions(limit = 1): Promise<CodingAssistantSession[]> {
  const body = await apiJson(`coding/sessions?limit=${encodeURIComponent(String(limit))}`) as CodingAssistantSessionsResponse
  return Array.isArray(body.sessions) ? body.sessions : []
}

export async function createCodingAssistantSession(): Promise<CodingAssistantSession> {
  const body = await apiJson("coding/session", { method: "POST" }) as CodingAssistantSessionResponse
  return body.session
}

export async function sendCodingAssistantPrompt(sessionID: string, text: string): Promise<{ taskID: string }> {
  return await apiJson(`session/${encodeURIComponent(sessionID)}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text }],
    }),
  }) as { taskID: string }
}

export async function hydrateCodingAssistantTranscript(sessionID: string): Promise<any[]> {
  const body = await apiJson(`session/${encodeURIComponent(sessionID)}/conversation?tail_limit=80`)
  return Array.isArray(body?.transcript) ? body.transcript : []
}
