import { createMemo, For, Show } from "solid-js";
import { DiffView, changeStatusLabel, type FileChange } from "./DiffView";
import {
  describeToolCall,
  displayToolIcon,
  displayToolDetail,
  toolStatusLabel,
  toolNameKey,
  stripAnsi,
  shortRelativePath,
} from "../utils/tool";
import { extToLang, renderCodeBlock } from "../utils/markdown";
import { selectedTaskDirectory } from "../store/board";
import { TodoListPart, extractTodos } from "./TodoListPart";
import { StaticTextPart } from "./TextPart";

// Same tool-kind sets used to drive code rendering below.
const FILE_WRITE_TOOLS = new Set(["write", "writefile"]);
const FILE_EDIT_TOOLS = new Set(["edit", "editfile", "applypatch"]);
const FILE_READ_TOOLS = new Set(["read", "readfile"]);
// todowrite/todoread/todoupdate render as a structured checklist instead of
// raw JSON — the output is JSON.stringify of the todos array, which is
// unreadable and floods the card body. updateplan uses the same shape.
const TODO_TOOLS = new Set(["todowrite", "todoread", "todoupdate", "updateplan"]);
const READ_NOTE_RE = /^\((?:Showing|End of file|Output capped at)/;

interface ParsedReadOutput {
  kind: "file" | "directory";
  body: string;
  note?: string;
  reminder?: string;
}

interface ToolDiffItem extends FileChange {
  openPath: string;
  displayPath: string;
}

function isFileContentTool(key: string): boolean {
  return FILE_WRITE_TOOLS.has(key) || FILE_EDIT_TOOLS.has(key) || FILE_READ_TOOLS.has(key);
}

function diffStatus(raw: unknown, before?: string, after?: string): FileChange["status"] {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "add" || value === "added") return "added";
  if (value === "delete" || value === "deleted" || value === "remove" || value === "removed") {
    return "deleted";
  }
  if (before === "" && typeof after === "string" && after.length > 0) return "added";
  if (after === "" && typeof before === "string" && before.length > 0) return "deleted";
  return "modified";
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeToolDiff(raw: any, base: string): ToolDiffItem | null {
  if (!raw || typeof raw !== "object") return null;
  const before = asText(raw.before) ?? asText(raw.oldContent);
  const after = asText(raw.after) ?? asText(raw.newContent);
  const sourcePath = asText(raw.file) ?? asText(raw.filePath) ?? asText(raw.path);
  const targetPath = asText(raw.movePath) ?? sourcePath;
  if (!targetPath) return null;

  const sourceDisplay = sourcePath ? shortRelativePath(sourcePath, base) : "";
  const targetDisplay = asText(raw.relativePath) || shortRelativePath(targetPath, base) || targetPath;
  const displayPath =
    sourcePath && targetPath !== sourcePath
      ? `${sourceDisplay || sourcePath} -> ${targetDisplay}`
      : targetDisplay;

  return {
    file: displayPath,
    status: diffStatus(raw.type, before, after),
    additions: asCount(raw.additions),
    deletions: asCount(raw.deletions),
    before,
    after,
    openPath: targetPath,
    displayPath,
  };
}

function extractToolDiffs(state: any, base: string): ToolDiffItem[] | null {
  const meta = state?.metadata;
  const files = Array.isArray(meta?.files)
    ? meta.files
        .map((item: any) => normalizeToolDiff(item, base))
        .filter((item: ToolDiffItem | null): item is ToolDiffItem => !!item)
    : [];
  if (files.length > 0) return files;

  const single = normalizeToolDiff(meta?.filediff, base);
  return single ? [single] : null;
}

function extractFilePath(inp: any): string {
  return inp?.file_path ?? inp?.filePath ?? inp?.path ?? inp?.filename ?? "";
}

function extractCodeContent(key: string, inp: any, out: string): string {
  if (FILE_WRITE_TOOLS.has(key)) return inp?.content ?? inp?.text ?? "";
  if (FILE_EDIT_TOOLS.has(key)) {
    const oldStr = inp?.old_string ?? "";
    const newStr = inp?.new_string ?? "";
    if (oldStr && newStr) return `--- old\n${oldStr}\n--- new\n${newStr}`;
    return newStr || (inp?.content ?? "");
  }
  if (FILE_READ_TOOLS.has(key)) return out;
  return "";
}

function extractTaggedBlock(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start + open.length);
  if (end < 0) return null;
  let inner = text.slice(start + open.length, end);
  if (inner.startsWith("\n")) inner = inner.slice(1);
  if (inner.endsWith("\n")) inner = inner.slice(0, -1);
  return inner;
}

function splitReadBody(block: string): { body: string; note?: string } {
  const lines = block.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (!READ_NOTE_RE.test(last)) {
    return { body: lines.join("\n") };
  }
  lines.pop();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return { body: lines.join("\n"), note: last };
}

function parseReadOutput(output: string): ParsedReadOutput | null {
  const type = extractTaggedBlock(output, "type");
  if (type !== "file" && type !== "directory") return null;
  const block = extractTaggedBlock(output, type === "file" ? "content" : "entries");
  if (block === null) return null;
  const { body, note } = splitReadBody(block);
  const reminder = extractTaggedBlock(output, "system-reminder")?.trim() || undefined;
  return {
    kind: type,
    body,
    note,
    reminder,
  };
}

function ToolDiffList(props: { items: ToolDiffItem[] }) {
  const totals = () => ({
    additions: props.items.reduce((sum, item) => sum + (item.additions ?? 0), 0),
    deletions: props.items.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
  });

  return (
    <section class="msg-tool-diffs">
      <div class="msg-tool-diffs__summary">
        <span class="msg-tool-diffs__count">
          {props.items.length} {props.items.length === 1 ? "file" : "files"}
        </span>
        <span class="msg-tool-diffs__meta">
          <span class="diff-dialog-stat" data-tone="add">
            +{totals().additions}
          </span>
          <span class="diff-dialog-stat" data-tone="del">
            -{totals().deletions}
          </span>
        </span>
      </div>
      <For each={props.items}>
        {(item) => (
          <section class="msg-tool-diff-card">
            <header class="msg-tool-diff-card__head">
              <div class="msg-tool-diff-card__copy">
                <a
                  class="msg-tool-diff-link"
                  href="#"
                  data-file-path={item.openPath}
                  title={item.openPath}
                >
                  {item.displayPath}
                </a>
                <span class="change-status" data-status={item.status}>
                  {changeStatusLabel(item.status)}
                </span>
              </div>
              <div class="msg-tool-diff-card__meta">
                <span class="diff-dialog-stat" data-tone="add">
                  +{item.additions}
                </span>
                <span class="diff-dialog-stat" data-tone="del">
                  -{item.deletions}
                </span>
              </div>
            </header>
            <div class="msg-tool-diff-card__body">
              <DiffView item={item} />
            </div>
          </section>
        )}
      </For>
    </section>
  );
}

/**
 * Render a tool invocation. Three visual modes:
 *  - mode="inline" (default): single-line chip only.
 *  - mode="block":            chip + full output body.
 *  - mode="body":             output body only (used when the caller already
 *                             rendered its own header, e.g. inside a tool Card).
 */
export function InlineToolPart(props: { part: any; mode?: "inline" | "block" | "body" }) {
  const mode = () => props.mode ?? "inline";
  const state = () => props.part.state || {};
  const toolName = () => props.part.tool || "unknown";
  const input = () => state().input || {};
  const display = createMemo(() =>
    describeToolCall(toolName(), input(), state(), selectedTaskDirectory()),
  );
  const status = () => display().status || "pending";
  const icon = () => display().icon;
  const statusLabel = () => display().statusLabel || toolStatusLabel(status());
  const detail = () => {
    const raw = display().detail;
    return raw && raw.toLowerCase() !== toolName().toLowerCase() ? raw : "";
  };
  const raw = () => {
    const st = state();
    const r =
      typeof st.raw === "string"
        ? typeof props.part._targetRaw === "string"
          ? props.part._targetRaw
          : st.raw
        : "";
    return r;
  };
  const output = () => stripAnsi(state().output || "");
  const error = () => stripAnsi(state().error || "") || output();
  const key = () => toolNameKey(toolName());
  const readView = createMemo(() => {
    if (status() !== "completed") return null;
    if (!FILE_READ_TOOLS.has(key())) return null;
    return parseReadOutput(output());
  });

  // Code rendering for completed file-content tools — always full (no
  // truncation) because block mode lives inside its own <Card> body
  // which is only rendered when the user expanded it.
  const codeResult = createMemo(() => {
    if (status() !== "completed") return null;
    const k = key();
    if (!isFileContentTool(k)) return null;
    const parsedRead = readView();
    const content = FILE_READ_TOOLS.has(k)
      ? parsedRead?.body ?? extractCodeContent(k, input(), output())
      : extractCodeContent(k, input(), output());
    if (!content) return null;
    const lang = parsedRead?.kind === "directory" ? "plaintext" : extToLang(extractFilePath(input()));
    return renderCodeBlock(content, lang, Infinity);
  });

  // Structured todo list — populated during streaming from state.input.todos,
  // once committed from state.metadata.todos. Both shapes are handled by
  // extractTodos so a streaming or completed todowrite renders identically.
  const todoItems = createMemo(() => {
    if (!TODO_TOOLS.has(key())) return null;
    return extractTodos(state());
  });
  const toolDiffs = createMemo(() => {
    if (status() !== "completed") return null;
    return extractToolDiffs(state(), selectedTaskDirectory());
  });
  const showStructuredOutput = createMemo(() => (toolDiffs()?.length ?? 0) > 0);
  const showPlainOutput = createMemo(() => {
    if (status() !== "completed" || !output() || readView()) return false;
    if (showStructuredOutput()) return /<diagnostics\b/i.test(output());
    return !codeResult();
  });

  const showChip = () => mode() !== "body";
  const showBody = () => mode() === "block" || mode() === "body";

  return (
    <>
      <Show when={showChip()}>
        <div class="msg-tool" data-status={status()}>
          <span class="tool-icon">{icon()}</span>
          <span class="tool-name">{toolName()}</span>
          <Show when={detail()}>
            <span class="tool-detail">{detail()}</span>
          </Show>
          <span class="tool-status" data-status={status()} title={statusLabel()}>
            {statusLabel()}
          </span>
        </div>
      </Show>
      <Show when={showBody()}>
        <Show when={todoItems() && todoItems()!.length > 0} fallback={
          <>
            <Show when={status() === "pending" && raw() && !todoItems()}>
              <div class="msg-tool-input">{raw()}</div>
            </Show>
            <Show when={showStructuredOutput()}>
              <ToolDiffList items={toolDiffs()!} />
            </Show>
            <Show when={codeResult() && !showStructuredOutput()}>
              <div class="msg-tool-code md-content" innerHTML={codeResult()!.html} />
            </Show>
            <Show when={readView()?.note}>
              <div class="msg-read-meta">{readView()!.note}</div>
            </Show>
            <Show when={readView()?.reminder}>
              <section class="msg-read-reminder">
                <div class="msg-read-reminder__label">Loaded instructions</div>
                <div class="msg-read-reminder__body">
                  <StaticTextPart text={readView()!.reminder!} />
                </div>
              </section>
            </Show>
            <Show when={showPlainOutput()}>
              <div class="msg-tool-output msg-tool-output--expanded">{output()}</div>
            </Show>
          </>
        }>
          <TodoListPart todos={todoItems()!} variant={mode() === "body" ? "card" : "inline"} />
        </Show>
        <Show when={status() === "error" && error()}>
          <div class="msg-tool-error">{error()}</div>
        </Show>
      </Show>
    </>
  );
}
