import { createMemo, Show } from "solid-js";
import { displayToolIcon, displayToolDetail, toolStatusLabel, toolNameKey, stripAnsi } from "../utils/tool";
import { extToLang, renderCodeBlock } from "../utils/markdown";
import { activeDirectory } from "../store/board";
import { toggleToolOutputExpanded, toolOutputExpanded } from "../store/conversation-ui";

// File-content tools: completed state shows syntax-highlighted code
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

export function ToolPart(props: { part: any }) {
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
  const expanded = () => toolOutputExpanded(props.part?.id || "");
  const key = () => toolNameKey(toolName());

  // Code rendering for completed file-content tools
  const codeResult = createMemo(() => {
    if (status() !== "completed") return null;
    const k = key();
    if (!isFileContentTool(k)) return null;
    const content = extractCodeContent(k, input(), output());
    if (!content) return null;
    const lang = extToLang(extractFilePath(input()));
    return renderCodeBlock(content, lang, expanded() ? Infinity : 100);
  });

  return (
    <>
      <div class="msg-tool">
        <span class="tool-icon">{icon()}</span>
        <span class="tool-name">{toolName()}</span>
        <Show when={detail()}>
          <span class="tool-detail">{detail()}</span>
        </Show>
        <span class="tool-status" data-status={status()} title={statusLabel()}>
          {statusLabel()}
        </span>
      </div>
      <Show when={status() === "pending" && raw()}>
        <div class="msg-tool-input">{raw()}</div>
      </Show>
      <Show when={codeResult()}>
        <div class="msg-tool-code md-content" innerHTML={codeResult()!.html} />
        <Show when={codeResult()!.truncated}>
          <button
            class="msg-tool-expand"
            onClick={() => toggleToolOutputExpanded(props.part?.id || "")}
          >
            +{codeResult()!.totalLines - 100} 行 · 展开全部
          </button>
        </Show>
      </Show>
      <Show when={status() === "completed" && output() && !codeResult()}>
        <div
          class="msg-tool-output"
          classList={{ "msg-tool-output--expanded": expanded() }}
          onClick={() => toggleToolOutputExpanded(props.part?.id || "")}
        >
          {output()}
        </div>
      </Show>
      <Show when={status() === "error" && error()}>
        <div class="msg-tool-error">{error()}</div>
      </Show>
    </>
  );
}
