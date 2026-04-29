// ── DiffView ──
// Shared side-by-side diff renderer (LCS + collapsed context). Extracted from
// ChangesPanel so both the inline file list and the workspace diff preview
// render the same visuals from a single source.

import { createMemo, For, Show } from "solid-js";
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

// ── Diff helpers ──

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

export function changeStatusLabel(
  status: "added" | "deleted" | "modified" | string,
): string {
  if (status === "added") return t("files.status.added");
  if (status === "deleted") return t("files.status.deleted");
  return t("files.status.modified");
}

// ── DiffView component ──

interface DiffViewProps {
  item: FileChange;
}

export function DiffView(props: DiffViewProps) {
  const ops = createMemo(() =>
    collapseDiffOps(buildDiffOps(props.item.before, props.item.after)),
  );

  const hasChanges = createMemo(() => {
    if (props.item.before == null && props.item.after == null) return false;
    if (!props.item.before && !props.item.after) return false;
    return ops().some((op) => op.kind === "add" || op.kind === "del");
  });

  // Differentiate the "no preview" cause so the operator knows whether
  // the file was deleted, intentionally empty, or just missing a server
  // payload. Previously every empty case showed the same opaque
  // "diff.no_preview" string.
  const emptyReasonKey = createMemo(() => {
    const it = props.item;
    if (it.status === "deleted" && !it.after) return "diff.empty_deleted";
    if (it.status === "added" && !it.before && !it.after) return "diff.empty_added";
    if (it.before === it.after) return "diff.empty_unchanged";
    return "diff.no_preview";
  });

  return (
    <Show
      when={hasChanges()}
      fallback={
        <div class="diff-empty">
          <p class="empty-hint">{t(emptyReasonKey())}</p>
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
