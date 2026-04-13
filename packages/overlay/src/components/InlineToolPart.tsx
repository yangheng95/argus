import { createMemo, Show } from "solid-js";
import { displayToolIcon, displayToolDetail, toolStatusLabel, toolNameKey, stripAnsi } from "../utils/tool";
import { extToLang, renderCodeBlock } from "../utils/markdown";
import { activeDirectory } from "../store/board";

// Same tool-kind sets used to drive code rendering below.
const FILE_WRITE_TOOLS = new Set(["write", "writefile"]);
const FILE_EDIT_TOOLS = new Set(["edit", "editfile", "applypatch"]);
const FILE_READ_TOOLS = new Set(["read", "readfile"]);

function isFileContentTool(key: string): boolean {
  return FILE_WRITE_TOOLS.has(key) || FILE_EDIT_TOOLS.has(key) || FILE_READ_TOOLS.has(key);
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
  const status = () => state().status || "pending";
  const toolName = () => props.part.tool || "unknown";
  const input = () => state().input || {};
  const icon = () => displayToolIcon(toolName());
  const statusLabel = () => toolStatusLabel(status());
  const detail = () => {
    const raw = displayToolDetail(toolName(), input(), state(), activeDirectory());
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

  // Code rendering for completed file-content tools — always full (no
  // truncation) because block mode lives inside its own <Card> body
  // which is only rendered when the user expanded it.
  const codeResult = createMemo(() => {
    if (status() !== "completed") return null;
    const k = key();
    if (!isFileContentTool(k)) return null;
    const content = extractCodeContent(k, input(), output());
    if (!content) return null;
    const lang = extToLang(extractFilePath(input()));
    return renderCodeBlock(content, lang, Infinity);
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
        <Show when={status() === "pending" && raw()}>
          <div class="msg-tool-input">{raw()}</div>
        </Show>
        <Show when={codeResult()}>
          <div class="msg-tool-code md-content" innerHTML={codeResult()!.html} />
        </Show>
        <Show when={status() === "completed" && output() && !codeResult()}>
          <div class="msg-tool-output msg-tool-output--expanded">{output()}</div>
        </Show>
        <Show when={status() === "error" && error()}>
          <div class="msg-tool-error">{error()}</div>
        </Show>
      </Show>
    </>
  );
}
