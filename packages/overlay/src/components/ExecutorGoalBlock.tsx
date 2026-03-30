import { Index, Show, createMemo, createSignal } from "solid-js";
import { displayToolIcon } from "../utils/tool";
import { t } from "../utils/i18n";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
} from "../store/conversation-ui";

/** Tail the last N lines of a text block. */
function tailLines(text: string, maxLines = 6): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join("\n");
}

/** Check if a tool is an edit/write tool whose input contains code. */
function hasCodeInput(proc: any): boolean {
  if (!proc?.input || typeof proc.input !== "object") return false;
  const name = (proc.toolName || "").toLowerCase();
  return (name === "edit" || name === "write" || name === "patch") &&
    !!(proc.input.new_string || proc.input.old_string || proc.input.content);
}

/** Format the code change for an edit tool. */
function editSummary(input: any): string {
  if (!input) return "";
  const parts: string[] = [];
  if (input.file_path) parts.push(input.file_path);
  if (input.old_string && input.new_string) {
    parts.push(`- ${String(input.old_string).split("\n").length} lines`);
    parts.push(`+ ${String(input.new_string).split("\n").length} lines`);
  }
  return parts.join("  ");
}

export function ExecutorGoalBlock(props: {
  processes: any[];
  goalRunID?: string;
  goalTitle?: string;
}) {
  const blockID = () => `executor:${props.goalRunID || "default"}`;

  const overallStatus = createMemo(() => {
    const procs = props.processes;
    if (procs.some((p: any) => p.status === "running")) return "running";
    if (procs.some((p: any) => p.status === "failed")) return "failed";
    if (procs.some((p: any) => p.status === "blocked")) return "blocked";
    if (procs.every((p: any) => p.status === "completed")) return "completed";
    return "running";
  });

  const isRunning = () => overallStatus() === "running";
  const expanded = () => agentCardExpanded(blockID(), isRunning());
  const toggle = () => toggleAgentCardExpanded(blockID(), isRunning());

  const completedCount = createMemo(() =>
    props.processes.filter((p: any) => p.status === "completed").length,
  );

  const headerLabel = () =>
    props.goalTitle ||
    (props.goalRunID
      ? `Goal ${props.goalRunID.slice(-8)}`
      : t("chat.role.executor"));

  return (
    <div
      class="executor-goal-block"
      classList={{ "executor-goal-block--expanded": expanded() }}
      data-status={overallStatus()}
    >
      <div class="executor-goal-header" role="button" tabindex="0" onClick={toggle}>
        <Show
          when={!isRunning()}
          fallback={
            <span class="executor-goal-badge executor-goal-badge--running">
              <span class="agent-card-spinner" />
            </span>
          }
        >
          <span
            class="executor-goal-badge"
            classList={{
              "executor-goal-badge--done": overallStatus() === "completed",
              "executor-goal-badge--error":
                overallStatus() === "failed" || overallStatus() === "blocked",
            }}
          >
            {overallStatus() === "completed" ? "\u2713" : "\u2717"}
          </span>
        </Show>

        <span class="executor-goal-label">{headerLabel()}</span>
        <span class="executor-goal-count">
          {completedCount()}/{props.processes.length}
        </span>
        <span class="executor-goal-chevron" aria-hidden="true">
          {"\u25BC"}
        </span>
      </div>

      <Show when={expanded()}>
        <div class="executor-goal-body">
          <Index each={props.processes}>
            {(proc) => {
              const [entryExpanded, setEntryExpanded] = createSignal(false);
              const output = () => {
                const text = (proc().output || "").trim();
                if (!text) return "";
                // When individually expanded, show full output
                if (entryExpanded()) return text;
                // Collapsed: running shows last 6 lines, completed shows last 3
                return proc().status === "running" ? tailLines(text, 6) : tailLines(text, 3);
              };
              const isOutputTruncated = () => {
                const text = (proc().output || "").trim();
                if (!text) return false;
                return output() !== text;
              };
              const progress = () => {
                const text = (proc().progress || "").trim();
                if (!text || text === t("task.status.running") || text === t("task.status.completed")) return "";
                return text;
              };
              const codeInput = () => hasCodeInput(proc()) ? proc().input : null;
              const commandInput = () => {
                const name = (proc().toolName || "").toLowerCase();
                if (name !== "bash") return "";
                return proc().input?.command || proc().detail || "";
              };
              return (
                <div
                  class="executor-tool-entry"
                  data-status={proc().status || "running"}
                  data-live={proc().status === "running" ? "true" : "false"}
                >
                  <div class="executor-tool-item" role="button" tabindex="0"
                       onClick={() => setEntryExpanded(!entryExpanded())}>
                    <span class="executor-tool-icon">
                      {displayToolIcon(proc().toolName || proc().title || "")}
                    </span>
                    <span class="executor-tool-name">
                      {proc().toolName || proc().title || "task"}
                    </span>
                    <Show when={proc().toolDetail}>
                      <span class="executor-tool-detail">{proc().toolDetail}</span>
                    </Show>
                    <Show when={progress()}>
                      <span class="executor-tool-progress">{progress()}</span>
                    </Show>
                    <span
                      class="executor-tool-status"
                      data-status={proc().status || "running"}
                    >
                      {proc().status === "completed"
                        ? "\u2713"
                        : proc().status === "failed"
                          ? "\u2717"
                          : proc().status === "running"
                            ? "\u2022"
                            : "\u2013"}
                    </span>
                  </div>
                  <Show when={commandInput()}>
                    <pre class="executor-tool-command">{commandInput()}</pre>
                  </Show>
                  <Show when={entryExpanded() && codeInput()}>
                    <div class="executor-tool-diff">
                      <div class="executor-tool-diff-header">{editSummary(codeInput())}</div>
                      <Show when={codeInput()!.old_string}>
                        <pre class="executor-tool-diff-remove">{codeInput()!.old_string}</pre>
                      </Show>
                      <Show when={codeInput()!.new_string}>
                        <pre class="executor-tool-diff-add">{codeInput()!.new_string}</pre>
                      </Show>
                    </div>
                  </Show>
                  <Show when={output()}>
                    <pre class="executor-tool-output">{output()}</pre>
                  </Show>
                  <Show when={isOutputTruncated()}>
                    <button class="executor-tool-expand" onClick={() => setEntryExpanded(true)}>
                      {"\u2026"}
                    </button>
                  </Show>
                </div>
              );
            }}
          </Index>
        </div>
      </Show>
    </div>
  );
}
