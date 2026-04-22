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

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableClone(item));
  if (!record(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableClone((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

function singleLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
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

function flattenToolArgumentValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return singleLine(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenToolArgumentValue(item))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (!record(value)) return singleLine(value);

  const stable = stableClone(value) as Record<string, unknown>;
  const preferredKeys = [
    "command",
    "cmd",
    "argv",
    "args",
    "query",
    "pattern",
    "prompt",
    "description",
    "text",
    "title",
    "reason",
    "url",
    "filePath",
    "file_path",
    "path",
    "dirPath",
    "directory",
    "value",
  ];
  for (const key of preferredKeys) {
    const next = flattenToolArgumentValue(stable[key]);
    if (next) return next;
  }

  return Object.entries(stable)
    .flatMap(([key, item]) => {
      const next = flattenToolArgumentValue(item);
      return next ? [`${key}=${next}`] : [];
    })
    .join(" ")
    .trim();
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
  if (n === "bash" || n === "shellcommand" || n === "runcommand") return "\uD83D\uDCBB";
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
  if (path) {
    const shortPath = shortRelativePath(path, base);
    // Read calls on the same file can fire multiple times when the file
    // exceeds the per-call byte cap (50KB) — without slice info every
    // entry looks identical and the operator cannot tell which range was
    // fetched. Surface offset/limit when present so the user sees
    // "@1+2000", "@2001+2000" etc on the inline pill.
    if (n === "read" || n === "readfile") {
      const startLine = (safeInput as any).startLine;
      const endLine = (safeInput as any).endLine;
      const hasStartLine = typeof startLine === "number" && Number.isFinite(startLine);
      const hasEndLine = typeof endLine === "number" && Number.isFinite(endLine);
      const offset = (safeInput as any).offset;
      const limit = (safeInput as any).limit;
      const hasOffset = typeof offset === "number" && Number.isFinite(offset);
      const hasLimit = typeof limit === "number" && Number.isFinite(limit);
      const meta = record((safeState as any).metadata) ? (safeState as any).metadata : {};
      const readLines = (meta as any).lines;
      const totalLines = (meta as any).totalLines;
      const hasReadLines = typeof readLines === "number" && Number.isFinite(readLines) && readLines > 0;
      const hasTotal = typeof totalLines === "number" && Number.isFinite(totalLines);
      const linesSuffix = hasReadLines
        ? hasTotal && totalLines !== readLines
          ? ` (${readLines}/${totalLines} lines)`
          : ` (${readLines} lines)`
        : "";
      const start = hasOffset ? offset : 1;
      const spanSize = hasLimit ? limit : hasReadLines ? readLines : undefined;
      const hasSpan = typeof spanSize === "number" && Number.isFinite(spanSize) && spanSize > 0;
      if (hasStartLine && hasEndLine) {
        return `${shortPath}:${startLine}-${endLine}${linesSuffix}`;
      }
      if (hasOffset || hasSpan) {
        const span = hasSpan ? `+${spanSize}` : "";
        return `${shortPath} @${start}${span}${linesSuffix}`;
      }
      return `${shortPath}${linesSuffix}`;
    }
    return shortPath;
  }
  if (n === "bash" || n === "shellcommand" || n === "runcommand")
    return toolInputCommand(safeInput);
  if (n === "grep" || n === "searchcode")
    return (safeInput as any).pattern || (safeInput as any).query || (safeInput as any).q || "";
  if (n === "glob" || n === "findfiles")
    return (safeInput as any).pattern || (safeInput as any).glob || "";
  if (n === "agent" || n === "spawnagent")
    return (safeInput as any).description || (safeInput as any).prompt || "";
  if (typeof (safeInput as any).raw === "string" && (safeInput as any).raw.trim())
    return (safeInput as any).raw.trim();
  if (
    ((safeState as any).status === "completed" || (safeState as any).status === "running") &&
    typeof (safeState as any).title === "string"
  )
    return (safeState as any).title;
  return "";
}

export function displayToolArguments(
  name: string,
  input: unknown,
  state?: unknown,
  base = "",
): string {
  const detail = singleLine(displayToolDetail(name, input, state, base));
  if (detail) return detail;
  return flattenToolArgumentValue(input);
}

// ── Tool status label ──

export function toolStatusLabel(status: string): string {
  if (status === "completed") return t("task.status.completed");
  if (status === "running") return t("common.active");
  if (status === "error") return t("common.error");
  return t("checks.pending");
}
