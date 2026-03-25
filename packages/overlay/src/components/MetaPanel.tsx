// ── MetaPanel Component ──
// Solid.js port of renderMeta / gitLabel / gitTitle / pathBreadcrumb / pathItems
// from app.js.
// Displays the current working directory breadcrumb, git status badge, and
// (optionally) a secondary execution-workspace indicator.

import { createMemo, For, Show } from "solid-js";
import { t } from "../utils/i18n";

// ── Path helpers (ports of app.js) ──

function absolutePath(value: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}

function joinPath(base: string, value: string): string {
  if (!base) return value;
  if (absolutePath(value)) return value;
  if (/[\\/]$/.test(base)) return `${base}${value}`;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${value}`;
}

function pathItems(value: string): Array<{ label: string; path: string }> {
  const text = String(value || "").trim();
  if (!text) return [];
  const windows = /^[A-Za-z]:[\\/]/.test(text);
  const unix = text.startsWith("/");
  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return [];
  if (windows) {
    let path = `${parts[0]}\\`;
    const items: Array<{ label: string; path: string }> = [
      { label: parts[0], path },
    ];
    return items.concat(
      parts.slice(1).map((part) => {
        path = joinPath(path, part);
        return { label: part, path };
      }),
    );
  }
  if (unix) {
    let path = "/";
    const items: Array<{ label: string; path: string }> = [
      { label: "/", path },
    ];
    return items.concat(
      parts.map((part) => {
        path = path === "/" ? `/${part}` : `${path}/${part}`;
        return { label: part, path };
      }),
    );
  }
  let path = parts[0];
  const items: Array<{ label: string; path: string }> = [
    { label: parts[0], path },
  ];
  return items.concat(
    parts.slice(1).map((part) => {
      path = joinPath(path, part);
      return { label: part, path };
    }),
  );
}

function relativePathFrom(base: string, target: string): string {
  const baseText =
    typeof base === "string" ? base.replace(/[\\/]+$/, "") : "";
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

function shortPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}

// ── Git helpers (ports of app.js gitLabel / gitTitle) ──

export interface VcsInfo {
  branch?: string;
  clean?: boolean;
  dirty?: boolean;
  staged?: number;
  modified?: number;
  untracked?: number;
  conflicts?: number;
  ahead?: number;
  behind?: number;
}

export function gitLabel(vcs: VcsInfo | null | undefined, dir: string): string {
  if (!dir) return t("git.unavailable");
  if (!vcs?.branch) return t("git.init");
  const parts: string[] = [vcs.branch];
  if (vcs.ahead) parts.push(`+${vcs.ahead}`);
  if (vcs.behind) parts.push(`-${vcs.behind}`);
  if (vcs.conflicts) parts.push(t("git.conflicts", { count: vcs.conflicts }));
  if (vcs.dirty) {
    const changes: string[] = [];
    if (vcs.staged) changes.push(t("git.staged", { count: vcs.staged }));
    if (vcs.modified) changes.push(t("git.modified", { count: vcs.modified }));
    if (vcs.untracked)
      changes.push(t("git.untracked", { count: vcs.untracked }));
    parts.push(changes.join(" "));
  } else {
    parts.push(t("git.clean"));
  }
  return parts.filter(Boolean).join(" · ");
}

export function gitTitle(
  vcs: VcsInfo | null | undefined,
  dir: string,
): string {
  if (!dir) return "";
  if (!vcs?.branch) return t("git.init_title");
  return [
    t("git.branch", { value: vcs.branch }),
    t("git.clean_title", {
      value: vcs.clean ? t("common.yes") : t("common.no"),
    }),
    t("git.staged", { count: vcs.staged ?? 0 }),
    t("git.modified", { count: vcs.modified ?? 0 }),
    t("git.untracked", { count: vcs.untracked ?? 0 }),
    t("git.conflicts", { count: vcs.conflicts ?? 0 }),
    t("git.ahead", { count: vcs.ahead ?? 0 }),
    t("git.behind", { count: vcs.behind ?? 0 }),
  ].join("\n");
}

// ── Path action SVG icons (port of app.js pathIcon) ──

function BrowseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5h4l1.2 1.5h5.8v5.2a1.3 1.3 0 01-1.3 1.3H3.8a1.3 1.3 0 01-1.3-1.3V5.8a1.3 1.3 0 011.3-1.3z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function NewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.2v9.6M3.2 8h9.6"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 4v4l2.5 1.5"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M3.05 8a5 5 0 1 1 .5 2.5"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
      />
      <path
        d="M3 10.5L3.05 8 1 9"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </svg>
  );
}

// ── PathBreadcrumb sub-component ──

interface PathBreadcrumbProps {
  /** The current active directory (may be empty). */
  dir: string;
  /** Whether a directory is set at all (for showing/hiding reset button). */
  hasDirectory: boolean;
  onRecentClick: () => void;
  onBrowseClick: () => void;
  onCreateClick: () => void;
  onResetClick: () => void;
  /** Called when the user clicks a path node to open it. */
  onOpenPath: (path: string) => void;
  /** Called when the user clicks the "/" separator to navigate to a parent level. */
  onSetPath: (path: string) => void;
}

function PathBreadcrumb(props: PathBreadcrumbProps) {
  const items = createMemo(() => pathItems(props.dir));

  return (
    <span class="task-dir-shell" data-empty={!props.dir ? "true" : undefined}>
      <Show
        when={!!props.dir}
        fallback={
          <span class="task-dir-empty">{t("cwd.unavailable")}</span>
        }
      >
        <span class="task-dir-path">
          <For each={items()}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <button
                    type="button"
                    class="task-dir-step"
                    title={`${t("cwd.choose_level")}: ${items()[index() - 1].path}`}
                    aria-label={`${t("cwd.choose_level")}: ${items()[index() - 1].path}`}
                    onClick={() =>
                      props.onSetPath(items()[index() - 1].path)
                    }
                  >
                    /
                  </button>
                </Show>
                <button
                  type="button"
                  class="task-dir-node"
                  data-current={
                    index() === items().length - 1 ? "true" : undefined
                  }
                  title={`${t("cwd.open")}: ${item.path}`}
                  aria-label={`${t("cwd.open")}: ${item.path}`}
                  onClick={() => props.onOpenPath(item.path)}
                >
                  {item.label}
                </button>
              </>
            )}
          </For>
        </span>
      </Show>
      <span class="task-dir-actions">
        <button
          type="button"
          class="task-dir-tool"
          data-path-action="recent"
          title={t("cwd.recent")}
          aria-label={t("cwd.recent")}
          onClick={props.onRecentClick}
        >
          <HistoryIcon />
        </button>
        <button
          type="button"
          class="task-dir-tool"
          data-path-action="browse"
          title={t("cwd.browse")}
          aria-label={t("cwd.browse")}
          onClick={props.onBrowseClick}
        >
          <BrowseIcon />
        </button>
        <button
          type="button"
          class="task-dir-tool"
          data-path-action="create"
          title={t("cwd.new")}
          aria-label={t("cwd.new")}
          onClick={props.onCreateClick}
        >
          <NewIcon />
        </button>
        <Show when={props.hasDirectory}>
          <button
            type="button"
            class="task-dir-tool danger"
            data-path-action="reset"
            title={t("cwd.reset")}
            aria-label={t("cwd.reset")}
            onClick={props.onResetClick}
          >
            <ResetIcon />
          </button>
        </Show>
      </span>
    </span>
  );
}

// ── MetaPanel ──

export interface MetaPanelProps {
  /** Current active directory (may be empty string). */
  dir: string;
  /** Current execution workspace directory (may be empty string). */
  workspaceDir?: string;
  /** VCS / git info (null if not available). */
  vcs: VcsInfo | null | undefined;
  /** Whether the overlay is connected to the server (used for "can init git"). */
  connected: boolean;
  /** Callbacks for directory actions */
  onRecentClick: () => void;
  onBrowseClick: () => void;
  onCreateClick: () => void;
  onResetClick: () => void;
  onOpenPath: (path: string) => void;
  onSetPath: (path: string) => void;
  /** Called when the user clicks the git badge to initialise git. */
  onInitGit: () => void;
}

export function MetaPanel(props: MetaPanelProps) {
  // Whether git init is actionable — mirrors canInitGit() in app.js
  const canInitGit = () =>
    !!props.dir && props.connected && !props.vcs?.branch;

  const gitState = () => {
    if (canInitGit()) return "action";
    if (props.vcs?.dirty) return "dirty";
    if (props.vcs?.clean) return "clean";
    return "idle";
  };

  // Workspace display logic (mirrors app.js renderMeta workspace section)
  const workspaceVisible = createMemo(() => {
    const dirText =
      typeof props.dir === "string"
        ? props.dir.trim().replace(/[\\/]+$/, "")
        : "";
    const wsText =
      typeof props.workspaceDir === "string"
        ? props.workspaceDir.trim().replace(/[\\/]+$/, "")
        : "";
    if (!wsText) return false;
    return (
      !dirText || dirText.toLowerCase() !== wsText.toLowerCase()
    );
  });

  const workspaceLabel = createMemo(() => {
    const dirText =
      typeof props.dir === "string"
        ? props.dir.trim().replace(/[\\/]+$/, "")
        : "";
    const wsText =
      typeof props.workspaceDir === "string"
        ? props.workspaceDir.trim().replace(/[\\/]+$/, "")
        : "";
    return relativePathFrom(dirText, wsText) || shortPath(wsText);
  });

  return (
    <div class="task-meta-panel">
      {/* Working directory breadcrumb */}
      <div
        class="task-dir"
        data-empty={!props.dir ? "true" : "false"}
        title={props.dir || t("cwd.unavailable")}
      >
        <PathBreadcrumb
          dir={props.dir}
          hasDirectory={!!props.dir}
          onRecentClick={props.onRecentClick}
          onBrowseClick={props.onBrowseClick}
          onCreateClick={props.onCreateClick}
          onResetClick={props.onResetClick}
          onOpenPath={props.onOpenPath}
          onSetPath={props.onSetPath}
        />
      </div>

      {/* Execution workspace (shown only when different from dir) */}
      <Show when={workspaceVisible()}>
        <div
          class="task-workspace-dir"
          title={props.workspaceDir ?? ""}
        >
          {t("cwd.execution_workspace", { value: workspaceLabel() })}
        </div>
      </Show>

      {/* Git status badge */}
      <button
        type="button"
        class="task-git"
        data-state={gitState()}
        data-actionable={String(canInitGit())}
        disabled={!canInitGit()}
        title={gitTitle(props.vcs, props.dir)}
        onClick={() => {
          if (canInitGit()) props.onInitGit();
        }}
      >
        {gitLabel(props.vcs, props.dir)}
      </button>
    </div>
  );
}
