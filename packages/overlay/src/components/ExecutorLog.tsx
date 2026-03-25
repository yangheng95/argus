// ── ExecutorLog Component ──
// Solid.js component that renders the live executor event stream.
// Mirrors the executor event rendering from app.js (executorMessage,
// executorTargetText, visibleExecutorEvent, executorProcessTitle, etc.).
//
// Reads from executorStore (store/executor.ts).

import { createMemo, For, Show } from "solid-js";
import { executorStore, type ExecutorEvent } from "../store/executor";
import { t } from "../utils/i18n";
import { stamp } from "../utils/time";

// ── Visible event kinds ──
// Only these event kinds are shown to the user; the rest is protocol noise.

const VISIBLE_EXECUTOR_KINDS = new Set([
  "message_delta",
  "reasoning_delta",
  "tool_call",
  "tool_result",
  "command",
  "approval_request",
  "input_request",
  "error",
  "mcp",
]);

// ── Helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function displayString(value: any): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

function executorCommand(event: ExecutorEvent): string {
  if (!record(event?.payload)) return "";
  const p = event.payload as any;
  const input = record(p.input) ? p.input : {};
  const value =
    p.command ?? p.argv ?? p.cmd ??
    input.command ?? input.argv ?? input.cmd ?? "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .flatMap((item: any) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      )
      .join(" ")
      .trim();
  }
  return "";
}

function executorOutput(event: ExecutorEvent): string {
  if (!record(event?.payload)) return "";
  const p = event.payload as any;
  const output = p.output;
  if (typeof output === "string") return output.slice(0, 2000);
  if (record(output)) {
    const text = [
      output.output,
      output.stdout,
      output.stderr,
      output.result,
      output.message,
      output.content,
    ]
      .filter((item: any) => typeof item === "string" && item.trim())
      .join("\n");
    return text ? text.slice(0, 2000) : "";
  }
  if (typeof p.text === "string") return p.text.slice(0, 2000);
  return "";
}

function genericExecutorSummary(event: ExecutorEvent): boolean {
  const summary = displayString(event?.summary).trim().toLowerCase();
  if (!summary) return true;
  if (event.kind === "tool_call")
    return /^(tool call|shell command):\s*\S+$/.test(summary);
  if (event.kind === "tool_result") {
    return (
      summary.startsWith("tool result:") ||
      [
        "shell command completed",
        "structured output returned",
        "approval resolved",
        "user input received",
      ].includes(summary)
    );
  }
  if (event.kind === "command") {
    return [
      "command",
      "running command",
      "command started",
      "command completed",
    ].includes(summary);
  }
  return false;
}

function executorEventText(event: ExecutorEvent): string {
  if (typeof event._liveText === "string") return event._liveText;
  if (typeof event._targetText === "string") return event._targetText;

  const summary = displayString(event?.summary).trim();
  const command = executorCommand(event);
  const output = executorOutput(event);
  const p = event.payload as any;

  if (event.kind === "message_delta" || event.kind === "reasoning_delta") {
    const text = displayString(p?.text);
    return text.trim() || summary;
  }

  if (event.kind === "tool_call") {
    if (!command) return summary;
    if (genericExecutorSummary(event)) return command;
    if (summary.includes(command)) return summary;
    return [summary, command].filter(Boolean).join("\n");
  }

  if (event.kind === "command") {
    const lines: string[] = [];
    if (summary && (!genericExecutorSummary(event) || !command)) lines.push(summary);
    if (command && !lines.some((item) => item.includes(command))) lines.push(command);
    if (output) lines.push(output);
    return lines.length > 0 ? lines.join("\n") : summary;
  }

  if (event.kind === "tool_result") {
    const lines: string[] = [];
    if (summary && (!genericExecutorSummary(event) || (!command && !output))) lines.push(summary);
    if (command && !lines.some((item) => item.includes(command))) lines.push(command);
    if (output) lines.push(output);
    return lines.length > 0 ? lines.join("\n") : summary;
  }

  return summary;
}

function isVisibleEvent(event: ExecutorEvent): boolean {
  if (!event) return false;
  if (!VISIBLE_EXECUTOR_KINDS.has(event.kind)) return false;
  return !!executorEventText(event).trim();
}

function eventKindLabel(kind: string): string {
  switch (kind) {
    case "message_delta": return t("executor.kind.message");
    case "reasoning_delta": return t("executor.kind.reasoning");
    case "tool_call": return t("executor.kind.tool_call");
    case "tool_result": return t("executor.kind.tool_result");
    case "command": return t("executor.kind.command");
    case "approval_request": return t("executor.kind.approval");
    case "input_request": return t("executor.kind.input");
    case "error": return t("executor.kind.error");
    case "mcp": return t("executor.kind.mcp");
    default: return kind;
  }
}

function eventKindTone(kind: string): string {
  if (kind === "error") return "bad";
  if (kind === "approval_request" || kind === "input_request") return "warn";
  if (kind === "tool_result" || kind === "command") return "accent";
  return "";
}

// ── ExecutorEventRow ──
// Single event row in the executor log.

interface ExecutorEventRowProps {
  event: ExecutorEvent;
}

function ExecutorEventRow(props: ExecutorEventRowProps) {
  const text = () => executorEventText(props.event).trim();
  const kindLabel = () => eventKindLabel(props.event.kind);
  const tone = () => eventKindTone(props.event.kind);
  const isReasoning = () => props.event.kind === "reasoning_delta";
  const isError = () => props.event.kind === "error";
  const isTool = () =>
    props.event.kind === "tool_call" || props.event.kind === "tool_result";

  return (
    <div
      class="executor-event"
      classList={{
        "executor-event--reasoning": isReasoning(),
        "executor-event--error": isError(),
        "executor-event--tool": isTool(),
      }}
      data-kind={props.event.kind}
    >
      <div class="executor-event-header">
        <span class="executor-event-kind" data-tone={tone()}>
          {kindLabel()}
        </span>
        <Show when={props.event.sourceLabel}>
          <span class="executor-event-source">{props.event.sourceLabel}</span>
        </Show>
        <Show when={props.event.time?.created}>
          <span class="executor-event-time">
            {stamp(props.event.time.created)}
          </span>
        </Show>
        <Show when={props.event.runID}>
          <span class="executor-event-run" title={props.event.runID}>
            {props.event.runID.slice(0, 8)}
          </span>
        </Show>
      </div>
      <Show when={text()}>
        <div
          class="executor-event-text"
          classList={{ "executor-event-text--code": isTool() }}
        >
          {text()}
        </div>
      </Show>
      <Show when={props.event.goalRunID}>
        <div class="executor-event-scope">
          {t("executor.scope.goal")}: {props.event.goalRunID.slice(0, 8)}
        </div>
      </Show>
    </div>
  );
}

// ── ExecutorLog ──
// Main executor log component.

export function ExecutorLog() {
  const events = () => executorStore.events;
  const runID = () => executorStore.runID;

  const visibleEvents = createMemo(() =>
    events().filter((e) => isVisibleEvent(e)),
  );

  return (
    <div class="executor-log">
      <Show when={runID()}>
        <div class="executor-log-run-id">
          {t("executor.run_id")}: <code>{runID()}</code>
        </div>
      </Show>
      <Show
        when={visibleEvents().length > 0}
        fallback={
          <div class="empty-hint">{t("executor.empty")}</div>
        }
      >
        <div class="executor-log-events">
          <For each={visibleEvents()}>
            {(event) => <ExecutorEventRow event={event} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
