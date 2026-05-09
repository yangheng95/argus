import { apiJson, apiWebSocketUrl } from "./api";

export interface TerminalInfo {
  id: string;
  profileID: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "exited";
  pid: number;
  cursor: number;
}

export type TerminalServerMessage =
  | { type: "ready"; cursor: number; info: TerminalInfo }
  | { type: "output"; cursor: number; data: string }
  | { type: "history_truncated"; requestedCursor: number; oldestCursor: number }
  | { type: "exit"; exitCode: number }
  | { type: "error"; message: string };

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "kill" };

export interface TerminalSocketHandlers {
  onOpen?: () => void;
  onMessage: (message: TerminalServerMessage) => void;
  onError?: (error: Error) => void;
  onClose?: (event: CloseEvent) => void;
}

export interface TerminalSocket {
  send(message: TerminalClientMessage): void;
  close(): void;
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  return await apiJson("pty");
}

export async function createTerminal(input: {
  cwd: string;
  cols: number;
  rows: number;
  title?: string;
  profileID: string;
}): Promise<TerminalInfo> {
  return await apiJson("pty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileID: input.profileID,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      title: input.title,
    }),
  });
}

export async function deleteTerminal(id: string): Promise<void> {
  await apiJson(`pty/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function connectTerminal(
  id: string,
  cursor: number,
  handlers: TerminalSocketHandlers,
): TerminalSocket {
  const ws = new WebSocket(apiWebSocketUrl(`pty/${encodeURIComponent(id)}/connect?cursor=${cursor}`));
  ws.addEventListener("open", () => handlers.onOpen?.());
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      handlers.onError?.(new Error("Terminal server sent a non-text message"));
      return;
    }
    const parsed = parseServerMessage(event.data);
    if (parsed.ok === false) {
      handlers.onError?.(new Error(parsed.error));
      return;
    }
    handlers.onMessage(parsed.value);
  });
  ws.addEventListener("error", () => {
    handlers.onError?.(new Error("Terminal WebSocket error"));
  });
  ws.addEventListener("close", (event) => handlers.onClose?.(event));
  return {
    send(message) {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error("Terminal WebSocket is not open");
      }
      ws.send(JSON.stringify(message));
    },
    close() {
      ws.close();
    },
  };
}

export function parseServerMessage(raw: string):
  | { ok: true; value: TerminalServerMessage }
  | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Terminal server message is not JSON" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, error: "Terminal server message must be an object" };
  }
  const value = json as Record<string, unknown>;
  if (value.type === "ready" && typeof value.cursor === "number" && isTerminalInfo(value.info)) {
    return { ok: true, value: { type: "ready", cursor: value.cursor, info: value.info } };
  }
  if (value.type === "output" && typeof value.cursor === "number" && typeof value.data === "string") {
    return { ok: true, value: { type: "output", cursor: value.cursor, data: value.data } };
  }
  if (
    value.type === "history_truncated" &&
    typeof value.requestedCursor === "number" &&
    typeof value.oldestCursor === "number"
  ) {
    return {
      ok: true,
      value: { type: "history_truncated", requestedCursor: value.requestedCursor, oldestCursor: value.oldestCursor },
    };
  }
  if (value.type === "exit" && typeof value.exitCode === "number") {
    return { ok: true, value: { type: "exit", exitCode: value.exitCode } };
  }
  if (value.type === "error" && typeof value.message === "string") {
    return { ok: true, value: { type: "error", message: value.message } };
  }
  return { ok: false, error: `Unknown terminal server message: ${raw}` };
}

function isTerminalInfo(value: unknown): value is TerminalInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as TerminalInfo;
  return (
    typeof info.id === "string" &&
    typeof info.profileID === "string" &&
    typeof info.title === "string" &&
    typeof info.command === "string" &&
    Array.isArray(info.args) &&
    typeof info.cwd === "string" &&
    (info.status === "running" || info.status === "exited") &&
    typeof info.pid === "number" &&
    typeof info.cursor === "number"
  );
}
