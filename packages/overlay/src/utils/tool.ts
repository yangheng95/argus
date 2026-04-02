// ── Tool utilities ──
// toolNameKey, toolInputCommand, shortRelativePath, relativePathFrom, shortPath

import { t } from "./i18n";

// ── ANSI stripping ──

/** Strip ANSI escape sequences (colors, cursor, etc.) from terminal output. */
export function stripAnsi(str: string): string {
  if (!str) return "";
 // Based on the strip-ansi npm package regex — covers CSI, OSC, and other escape sequences
 // eslint-disable-next-line no-control-regex
  return str.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

// ── Helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function toolNameKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function toolInputCommand(input: any): string {
  if (!record(input)) return "";
  const value = (input as any).command ?? (input as any).argv ?? (input as any).cmd;
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return (value as any[])
    .flatMap((item: any) =>
      typeof item === "string" && item.trim() ? [item.trim()] : [],
    )
    .join(" ")
    .trim();
}

function clipText(value: any, limit = 80): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

// ── Path helpers ──
// activeDirectory is provided externally (from board store) to avoid
// coupling this pure utility to the reactive store.

export function relativePathFrom(base: string, target: string): string {
  const baseText = typeof base === "string" ? base.replace(/[\\/]+$/, "") : "";
  const targetText =
    typeof target === "string" ? target.replace(/[\\/]+$/, "") : "";
  if (!baseText || !targetText) return "";
  const lBase = baseText.toLowerCase();
  const lTarget = targetText.toLowerCase();
  if (
    lTarget.startsWith(lBase + "/") ||
    lTarget.startsWith(lBase + "\\")
  ) {
    return targetText.slice(baseText.length + 1);
  }
  return "";
}

export function shortPath(p: string): string {
 // Show only last 2-3 path segments for readability
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}

/** Shorten a path relative to a base directory.
 * Pass activeDirectory (e.g. boardStore.board?.task?.directory) as `base`. */
export function shortRelativePath(p: string, base = ""): string {
  if (!p) return "";
  const rel = relativePathFrom(base, p);
  return rel || shortPath(p);
}

// ── Tool icon ──

export function displayToolIcon(name: string): string {
  const n = toolNameKey(name);
  if (n === "read" || n === "readfile") return "\uD83D\uDCC4";
  if (n === "edit" || n === "editfile" || n === "applypatch") return "\u270F\uFE0F";
  if (n === "write" || n === "writefile") return "\uD83D\uDCDD";
  if (n === "bash" || n === "shellcommand") return "\uD83D\uDCBB";
  if (n === "grep" || n === "searchcode") return "\uD83D\uDD0D";
  if (n === "glob" || n === "findfiles") return "\uD83D\uDCC2";
  if (n === "agent" || n === "spawnagent") return "\uD83E\uDD16";
  if (n === "todowrite" || n === "todoupdate" || n === "updateplan") return "\u2611\uFE0F";
  return "\u26A1";
}

// ── Tool detail ──

/** Returns a human-readable detail string for a tool invocation.
 * @param name Tool name
 * @param input Tool input object (from part.state.input)
 * @param state Tool state object (from part.state)
 * @param base Active working directory (for path shortening)
 */
export function displayToolDetail(
  name: string,
  input: any,
  state: any,
  base = "",
): string {
  const safeInput = record(input) ? input : {};
  const safeState = record(state) ? state : {};
  const n = toolNameKey(name);
  const path =
    (safeInput as any).file_path ||
    (safeInput as any).filePath ||
    (safeInput as any).path ||
    (safeInput as any).filename ||
    "";
  if (path) return shortRelativePath(path, base);
  if (n === "bash" || n === "shellcommand")
    return clipText(toolInputCommand(safeInput), 80);
  if (n === "grep" || n === "searchcode")
    return (safeInput as any).pattern || (safeInput as any).query || (safeInput as any).q || "";
  if (n === "glob" || n === "findfiles")
    return (safeInput as any).pattern || (safeInput as any).glob || "";
  if (n === "agent" || n === "spawnagent")
    return clipText((safeInput as any).description || (safeInput as any).prompt || "", 80);
  if (typeof (safeInput as any).raw === "string" && (safeInput as any).raw.trim())
    return clipText((safeInput as any).raw, 80);
  if (
    ((safeState as any).status === "completed" || (safeState as any).status === "running") &&
    typeof (safeState as any).title === "string"
  )
    return (safeState as any).title;
  return "";
}

// ── Tool status label ──

export function toolStatusLabel(status: string): string {
  if (status === "completed") return t("task.status.completed");
  if (status === "running") return t("common.active");
  if (status === "error") return t("common.error");
  return t("checks.pending");
}
