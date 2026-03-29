// ── ChangesPanel Component ──
// Solid.js port of renderChanges / renderDiffPreview / changeRowsHtml /
// changeStatusLabel / buildDiffOps / collapseDiffOps / splitDiffLines /
// diffMiddle
// Shows the list of file changes for the selected task and supports opening
// an inline diff preview dialog.

import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { boardStore } from "../store/board";
import { deriveChanges } from "../services/meta";
import { apiJson } from "../services/api";
import { t, tc } from "../utils/i18n";

// ── Types ──

export interface FileChange {
  file: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  before?: string;
  after?: string;
}

interface DiffOp {
  kind: "context" | "add" | "del" | "skip";
  left?: number | "";
  right?: number | "";
  text?: string;
  count?: number;
}

// ── Diff helpers (ports of ) ──

function splitDiffLines(text: string | undefined): string[] {
  const value = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!value) return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffMiddle(
  left: string[],
  right: string[],
  leftStart: number,
  rightStart: number,
): DiffOp[] {
  if (!left.length && !right.length) return [];
  if (!left.length) {
    return right.map((text, index) => ({
      kind: "add" as const,
      left: "" as const,
      right: rightStart + index,
      text,
    }));
  }
  if (!right.length) {
    return left.map((text, index) => ({
      kind: "del" as const,
      left: leftStart + index,
      right: "" as const,
      text,
    }));
  }
 // Guard against huge diffs — fall back to bulk del/add
  if (left.length * right.length > 120000) {
    return [
      ...left.map((text, index) => ({
        kind: "del" as const,
        left: leftStart + index,
        right: "" as const,
        text,
      })),
      ...right.map((text, index) => ({
        kind: "add" as const,
        left: "" as const,
        right: rightStart + index,
        text,
      })),
    ];
  }

 // LCS via dynamic programming
  const grid: Uint32Array[] = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      grid[i][j] =
        left[i] === right[j]
          ? grid[i + 1][j + 1] + 1
          : Math.max(grid[i + 1][j], grid[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({
        kind: "context",
        left: leftStart + i,
        right: rightStart + j,
        text: left[i],
      });
      i += 1;
      j += 1;
      continue;
    }
    if (grid[i + 1][j] >= grid[i][j + 1]) {
      ops.push({ kind: "del", left: leftStart + i, right: "", text: left[i] });
      i += 1;
      continue;
    }
    ops.push({ kind: "add", left: "", right: rightStart + j, text: right[j] });
    j += 1;
  }
  while (i < left.length) {
    ops.push({ kind: "del", left: leftStart + i, right: "", text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    ops.push({ kind: "add", left: "", right: rightStart + j, text: right[j] });
    j += 1;
  }
  return ops;
}

function buildDiffOps(
  before: string | undefined,
  after: string | undefined,
): DiffOp[] {
  const left = splitDiffLines(before);
  const right = splitDiffLines(after);
  const ops: DiffOp[] = [];
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  ) {
    ops.push({
      kind: "context",
      left: start + 1,
      right: start + 1,
      text: left[start],
    });
    start += 1;
  }

  let leftEnd = left.length - 1;
  let rightEnd = right.length - 1;
  const suffix: DiffOp[] = [];
  while (
    leftEnd >= start &&
    rightEnd >= start &&
    left[leftEnd] === right[rightEnd]
  ) {
    suffix.push({
      kind: "context",
      left: leftEnd + 1,
      right: rightEnd + 1,
      text: left[leftEnd],
    });
    leftEnd -= 1;
    rightEnd -= 1;
  }

  ops.push(
    ...diffMiddle(
      left.slice(start, leftEnd + 1),
      right.slice(start, rightEnd + 1),
      start + 1,
      start + 1,
    ),
  );
  ops.push(...suffix.reverse());
  return ops;
}

function collapseDiffOps(ops: DiffOp[]): DiffOp[] {
  const next: DiffOp[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind !== "context") {
      next.push(ops[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].kind === "context") {
      end += 1;
    }
    const chunk = ops.slice(index, end);
    if (chunk.length <= 8) {
      next.push(...chunk);
    } else {
      next.push(...chunk.slice(0, 3));
      next.push({ kind: "skip", count: chunk.length - 6 });
      next.push(...chunk.slice(-3));
    }
    index = end;
  }
  return next;
}

// ── Status label helper ──

function changeStatusLabel(
  status: "added" | "deleted" | "modified" | string,
): string {
  if (status === "added") return t("files.status.added");
  if (status === "deleted") return t("files.status.deleted");
  return t("files.status.modified");
}

// ── DiffPreview sub-component (port of renderDiffPreview) ──

interface DiffPreviewProps {
  item: FileChange;
}

function DiffPreview(props: DiffPreviewProps) {
  const ops = createMemo(() =>
    collapseDiffOps(buildDiffOps(props.item.before, props.item.after)),
  );

  const hasChanges = createMemo(() => {
    if (!props.item.before && !props.item.after) return false;
    return ops().some((op) => op.kind === "add" || op.kind === "del");
  });

  return (
    <Show
      when={hasChanges()}
      fallback={
        <div class="diff-empty">
          <p class="empty-hint">{t("diff.no_preview")}</p>
        </div>
      }
    >
      <div class="diff-lines">
        <For each={ops()}>
          {(line) => (
            <Show
              when={line.kind !== "skip"}
              fallback={
                <div class="diff-row" data-kind="skip">
                  <div class="diff-gutter">...</div>
                  <div class="diff-num" />
                  <div class="diff-num" />
                  <div class="diff-code">
                    {tc("diff.unchanged_hidden", line.count ?? 0)}
                  </div>
                </div>
              }
            >
              <div class="diff-row" data-kind={line.kind}>
                <div class="diff-gutter">
                  {line.kind === "add"
                    ? "+"
                    : line.kind === "del"
                      ? "-"
                      : " "}
                </div>
                <div class="diff-num">{line.left ?? ""}</div>
                <div class="diff-num">{line.right ?? ""}</div>
                <div class="diff-code">{line.text ?? " "}</div>
              </div>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

// ── DiffDialog sub-component ──

interface DiffDialogProps {
  item: FileChange | null;
  onClose: () => void;
}

function DiffDialog(props: DiffDialogProps) {
  let dialogRef: HTMLDialogElement | undefined;

  const item = () => props.item;

  // Open/close the native <dialog> imperatively when item changes
  createEffect(() => {
    if (item() && dialogRef && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!item() && dialogRef?.open) {
      dialogRef.close();
    }
  });

  function close() {
    dialogRef?.close();
    props.onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      class="diff-dialog"
      onClose={props.onClose}
      onClick={(e) => {
 // Close on backdrop click
        if (e.target === dialogRef) close();
      }}
    >
      <Show when={!!item()}>
        <div class="diff-dialog-header">
          <span class="diff-dialog-title">{item()!.file}</span>
          <span class="diff-dialog-meta">
            <span
              class="change-status"
              data-status={item()!.status}
            >
              {changeStatusLabel(item()!.status)}
            </span>
            <span class="diff-dialog-stat" data-tone="add">
              +{item()!.additions}
            </span>
            <span class="diff-dialog-stat" data-tone="del">
              -{item()!.deletions}
            </span>
          </span>
          <button
            type="button"
            class="diff-dialog-close"
            aria-label={t("common.close")}
            onClick={close}
          >
            ×
          </button>
        </div>
        <div class="diff-dialog-body">
          <DiffPreview item={item()!} />
        </div>
      </Show>
    </dialog>
  );
}

// ── ChangesPanel ──

export interface ChangesPanelProps {
  /**
 * File changes to display. If not provided, falls back to reading
 * boardStore.board?.changes (the sets this field).
 */
  changes?: FileChange[];
  /** Whether a task is currently selected (affects empty-state messaging). */
  hasSelectedTask?: boolean;
}

export function ChangesPanel(props: ChangesPanelProps) {
  const [selectedItem, setSelectedItem] = createSignal<FileChange | null>(null);
  // Cache full diffs once fetched per delivery
  let fullDiffCache: { runID: string; diffs: FileChange[] } | null = null;

 // Use provided changes or fall back to boardStore
  const files = createMemo<FileChange[]>(() => {
    if (props.changes !== undefined) return props.changes;
    const derived = deriveChanges();
    if (derived.length > 0) return derived;
    if (Array.isArray(boardStore.changes) && boardStore.changes.length > 0) {
      return boardStore.changes as FileChange[];
    }
    const raw = (boardStore.board as any)?.changes;
    return Array.isArray(raw) ? raw : [];
  });

  const totalAdditions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.additions ?? 0), 0),
  );
  const totalDeletions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.deletions ?? 0), 0),
  );

  /** Find the delivery runID from the board store. */
  function deliveryRunID(): string {
    const board = boardStore.board as any;
    const delivery = board?.acceptedDelivery || board?.delivery || board?.candidateDelivery;
    return typeof delivery?.runID === "string" ? delivery.runID : "";
  }

  /** Fetch full diff content from the delivery API. */
  async function fetchFullDiffs(runID: string): Promise<FileChange[]> {
    if (fullDiffCache && fullDiffCache.runID === runID) return fullDiffCache.diffs;
    const data = await apiJson(`run/${encodeURIComponent(runID)}/delivery`);
    const rawDiffs = (data as any)?.result?.diffs;
    const diffs: FileChange[] = (Array.isArray(rawDiffs) ? rawDiffs : [])
      .filter((d: any) => d && typeof d.file === "string")
      .map((d: any) => ({
        file: String(d.file || "").replace(/^[ab]\//, ""),
        status: d.status || (!d.before && d.after ? "added" : d.before && !d.after ? "deleted" : "modified"),
        additions: typeof d.additions === "number" ? d.additions : 0,
        deletions: typeof d.deletions === "number" ? d.deletions : 0,
        before: typeof d.before === "string" ? d.before : undefined,
        after: typeof d.after === "string" ? d.after : undefined,
      }));
    fullDiffCache = { runID, diffs };
    return diffs;
  }

  async function openDiff(index: number) {
    const item = files()[index];
    if (!item) return;
    // If file already has content, show immediately
    if (item.before !== undefined || item.after !== undefined) {
      setSelectedItem(item);
      return;
    }
    // Lazy-load full diff from delivery API
    const runID = deliveryRunID();
    if (!runID) {
      setSelectedItem(item);
      return;
    }
    const fullDiffs = await fetchFullDiffs(runID);
    const full = fullDiffs.find((d) => d.file === item.file);
    setSelectedItem(full || item);
  }

  function closeDiff() {
    setSelectedItem(null);
  }

  return (
    <div class="changes-panel">
      <Show
        when={files().length > 0}
        fallback={
          <p class="empty-hint">
            {props.hasSelectedTask
              ? t("files.unavailable")
              : t("files.select_target")}
          </p>
        }
      >
        {/* Summary row */}
        <div class="changes-summary">
          <span>{tc("files.changed", files().length)}</span>
          <span class="changes-total">
            <span data-tone="add">+{totalAdditions()}</span>
            <span data-tone="del">-{totalDeletions()}</span>
          </span>
        </div>

        {/* File list */}
        <div class="changes-list">
          <For each={files()}>
            {(item, index) => (
              <button
                type="button"
                class="change-row"
                data-change-index={index()}
                title={item.file}
                onClick={() => openDiff(index())}
              >
                <span class="change-main">
                  <span class="change-path">{item.file}</span>
                  <span class="change-subline">
                    {changeStatusLabel(item.status)}
                  </span>
                </span>
                <span class="change-meta">
                  <span
                    class="change-status"
                    data-status={item.status}
                  >
                    {changeStatusLabel(item.status)}
                  </span>
                  <span class="diff-dialog-stat" data-tone="add">
                    +{item.additions}
                  </span>
                  <span class="diff-dialog-stat" data-tone="del">
                    -{item.deletions}
                  </span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Diff preview dialog */}
      <DiffDialog item={selectedItem()} onClose={closeDiff} />
    </div>
  );
}
