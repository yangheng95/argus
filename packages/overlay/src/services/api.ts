// ── API Client ──
// Extracted from legacy app.js — provides server URL detection, auth headers,
// and typed fetch helpers for the OpenCorvus overlay.

export const DEFAULT_SERVER = (() => {
  if (
    typeof window !== "undefined" &&
    window.location.protocol.startsWith("http") &&
    window.location.pathname.startsWith("/ui")
  ) {
    return window.location.origin;
  }
  return "http://127.0.0.1:7878";
})();

let serverUrl = DEFAULT_SERVER;
let authCredentials = { username: "opencorvus", password: "" };

export function configure(opts: {
  serverUrl?: string;
  username?: string;
  password?: string;
}) {
  if (opts.serverUrl) serverUrl = opts.serverUrl;
  if (opts.username) authCredentials.username = opts.username;
  if (opts.password !== undefined) authCredentials.password = opts.password;
}

export function getServerUrl(): string {
  return serverUrl;
}

export function apiUrl(path: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  const next = path.replace(/^\/+/, "");
  return `${base}/${next}`;
}

export function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (authCredentials.password) {
    h.Authorization = `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`;
  }
  return h;
}

export async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...apiHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}
