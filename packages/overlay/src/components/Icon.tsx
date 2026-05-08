// ── Icon ──
//
// Single-source icon primitive for the overlay. All icons use:
//   - viewBox 16 16
//   - stroke="currentColor" so the icon inherits the parent's color
//   - stroke-width 1.4 (visual midpoint between status-icon's 1.6 and
//     the older section-icon stroke-width 1.3 — the two pre-existing
//     icon sets are unified here)
//   - stroke-linecap/linejoin "round"
//   - fill="none" by default (filled paths opt in via fill prop on
//     the inner element using `fill="currentColor"` selectors)
//
// Adding a new icon: append to the ICON_PATHS map. Don't drop
// inline SVG anywhere else in the codebase — `flat-redesign-icon-
// coverage.test.ts` rejects that drift.

import { Show, type JSX } from "solid-js";

export type IconName =
  // Window / dismiss / control
  | "close"
  | "chevron"
  | "chevron-up"
  | "chevron-down"
  | "caret-down"
  | "plus"
  | "minimize"
  | "maximize"
  | "restore"
  | "panel-left"
  | "panel-right"
  | "terminal"
  // Empty-state / cwd
  | "folder"
  | "folder-open"
  // Section header set (right-rail, was Board.SECTION_ICONS)
  | "overview"
  | "spec"
  | "plan"
  | "goals"
  | "executor"
  | "criteria"
  | "delivery"
  | "files"
  // Composer toolbar (was ChatComposer inline svg)
  | "attach"
  | "web-search"
  | "send"
  | "stop"
  // Card header actions (was CardHeader inline svg)
  | "copy"
  | "check"
  | "inspect"
  | "cancel"
  | "rewind"
  // Misc UI (was scattered inline svg)
  | "caret-up"
  | "search"
  | "refresh"
  | "external-link"
  | "file-document"
  | "github"
  | "info-circle"
  | "log-lines"
  | "drag-handle"
  | "download"
  | "upload"
  // Status family (was Board.statusIcon innerHTML strings + status-icon
  // CSS data-stroke/data-fill switch). The status-icon CSS rules
  // (.status-icon[data-status="..."]) drive `color`, which currentColor
  // picks up; per-path `fill="currentColor"` opts a path into the
  // filled-glyph variant.
  | "status-idle"
  | "status-queued"
  | "status-active"
  | "status-completed"
  | "status-failed"
  | "status-cancelled";

interface IconRecord {
  /** Inner SVG markup. Must be self-contained (no external defs). */
  body: () => JSX.Element;
  /** Override stroke-width if the path is dense; defaults to 1.4. */
  strokeWidth?: number;
}

const ICON_PATHS: Record<IconName, IconRecord> = {
  close: {
    body: () => (
      <>
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </>
    ),
  },
  chevron: {
    body: () => <polyline points="6,4 10,8 6,12" />,
  },
  "caret-down": {
    body: () => <polyline points="4,6 8,10 12,6" />,
  },
  plus: {
    body: () => (
      <>
        <line x1="8" y1="3" x2="8" y2="13" />
        <line x1="3" y1="8" x2="13" y2="8" />
      </>
    ),
  },
  // Window controls — single horizontal/box stroke; same viewBox 16
  // as the rest so the three金刚 line up against the close button.
  minimize: {
    body: () => <line x1="3" y1="8" x2="13" y2="8" />,
  },
  maximize: {
    body: () => <rect x="3" y="3" width="10" height="10" rx="0.5" />,
  },
  restore: {
    body: () => (
      <>
        <rect x="5" y="2.5" width="8.5" height="8.5" rx="0.5" />
        <path d="M2.5 5V13.5h8.5" />
      </>
    ),
  },
  "panel-left": {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <line x1="6" y1="3" x2="6" y2="13" />
      </>
    ),
  },
  "panel-right": {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <line x1="10" y1="3" x2="10" y2="13" />
      </>
    ),
  },
  terminal: {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <path d="M5 6.2 7 8 5 9.8" />
        <line x1="8.2" y1="10" x2="11" y2="10" />
      </>
    ),
  },
  folder: {
    body: () => (
      <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V4.5Z" />
    ),
  },
  "folder-open": {
    body: () => (
      <>
        <path d="M2.5 4.5h4l1.5 1.5h5.5v1.5H2.5V4.5Z" />
        <path d="M2.5 7.5h11l-1 5.5a1 1 0 0 1-1 .5H4a1 1 0 0 1-1-.5l-.5-5.5Z" />
      </>
    ),
  },
  // Section header icons — migrated from Board.tsx SECTION_ICONS map
  // 2026-05-04 (flat-redesign Step 3). Stroke-width was 1.3 there;
  // unified to the Icon primitive's 1.4 default.
  overview: {
    body: () => (
      <>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
      </>
    ),
  },
  spec: {
    body: () => (
      <>
        <path d="M9.5 2H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5L9.5 2Z" />
        <polyline points="9.5,2 9.5,4.5 12,4.5" />
        <line x1="6" y1="7" x2="10" y2="7" />
        <line x1="6" y1="9.5" x2="10" y2="9.5" />
      </>
    ),
  },
  plan: {
    body: () => (
      <>
        <line x1="6" y1="4" x2="13" y2="4" />
        <line x1="6" y1="8" x2="13" y2="8" />
        <line x1="6" y1="12" x2="13" y2="12" />
        <circle cx="3.5" cy="4" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="12" r="0.8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  goals: {
    body: () => (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="8" cy="8" r="3" />
        <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  executor: {
    body: () => <path d="M6 4.6L11.3 8 6 11.4Z" fill="currentColor" stroke="none" />,
  },
  criteria: {
    body: () => (
      <>
        <rect x="3" y="2" width="10" height="12" rx="1.2" />
        <path d="M6 6l1.2 1.2L9.5 5" />
        <line x1="6" y1="9.5" x2="10" y2="9.5" />
        <line x1="6" y1="11.5" x2="9" y2="11.5" />
      </>
    ),
  },
  delivery: {
    body: () => (
      <>
        <path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3Z" />
        <polyline points="2.5,5.5 8,8.5 13.5,5.5" />
        <line x1="8" y1="8.5" x2="8" y2="13.5" />
      </>
    ),
  },
  files: {
    body: () => (
      <>
        <path d="M9 2H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V5L9 2Z" />
        <polyline points="9,2 9,5 12,5" />
      </>
    ),
  },
  // Composer toolbar — migrated 2026-05-04 (Step 8b) from ChatComposer
  // inline svg. Stroke-width was 1.2 there; unified to primitive 1.4.
  "chevron-up": {
    body: () => <path d="M4 10l4-4 4 4" />,
  },
  "chevron-down": {
    body: () => <path d="M4 6l4 4 4-4" />,
  },
  attach: {
    body: () => (
      <path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5L9 3a2 2 0 012.8 2.8L6 11.6a.8.8 0 01-1.1-1.1L10.5 5" />
    ),
  },
  "web-search": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 1.5C8 1.5 5.5 4.5 5.5 8S8 14.5 8 14.5M8 1.5C8 1.5 10.5 4.5 10.5 8S8 14.5 8 14.5" />
        <path d="M1.5 8h13" />
      </>
    ),
  },
  send: {
    body: () => <path d="M2 8l10-5-3 5 3 5z" fill="currentColor" stroke="none" />,
  },
  stop: {
    body: () => (
      <rect
        x="4.25"
        y="4.25"
        width="7.5"
        height="7.5"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
    ),
  },
  // Card header actions — migrated 2026-05-04 (Step 8b) from CardHeader
  // inline svg.
  copy: {
    body: () => (
      <>
        <rect x="5" y="3" width="8" height="10" rx="1.3" />
        <path d="M3.5 5.5V12a1.5 1.5 0 0 0 1.5 1.5h5.5" />
      </>
    ),
  },
  check: {
    body: () => <path d="M3.5 8.5l3 3 6-6.5" />,
    strokeWidth: 1.6,
  },
  inspect: {
    body: () => (
      <>
        <circle cx="7" cy="7" r="4" />
        <path d="M10 10l3 3" />
      </>
    ),
  },
  cancel: {
    body: () => <path d="M5 5l6 6M11 5l-6 6" />,
    strokeWidth: 1.7,
  },
  rewind: {
    body: () => (
      <>
        <path d="M6.5 3.5L3 7l3.5 3.5" />
        <path d="M13 12.5c0-2.7-2.1-4.9-4.8-4.9H3.4" />
      </>
    ),
    strokeWidth: 1.6,
  },
  // Misc UI — migrated 2026-05-04 (Step 8b) from scattered inline svg
  // across TaskList / ChangesPanel / ExecutorSelector / FilesSection /
  // FrontendPreviewPanel / TitlebarMenubar / Card.
  "caret-up": {
    body: () => <polyline points="4,10 8,6 12,10" />,
  },
  search: {
    body: () => (
      <>
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L13 13" />
      </>
    ),
  },
  refresh: {
    body: () => (
      <>
        <path d="M13 4.5V8h-3.5" />
        <path d="M12.6 8A5 5 0 103.8 10.5" />
      </>
    ),
  },
  "external-link": {
    body: () => (
      <>
        <path d="M6 4h6v6" />
        <path d="M12 4L5 11" />
        <path d="M4 6v6h6" />
      </>
    ),
  },
  "file-document": {
    body: () => (
      <>
        <path d="M4 2.5h5l3 3V13.5H4z" />
        <path d="M9 2.5v3h3" />
        <path d="M6 8h4M6 10.5h4" />
      </>
    ),
  },
  github: {
    body: () => (
      <path
        d="M8 1C4.1 1 1 4.1 1 8c0 3.1 2 5.7 4.8 6.6.4.1.5-.2.5-.4v-1.3C4.2 13.3 3.7 12 3.7 12c-.3-.8-.8-1-.8-1-.6-.4.1-.4.1-.4.7.1 1.1.7 1.1.7.6 1.1 1.7.8 2.1.6.1-.4.3-.8.4-.9-1.7-.2-3.5-.9-3.5-3.8 0-.8.3-1.5.7-2-.1-.2-.3-1 .1-2 0 0 .6-.2 2 .8.6-.2 1.2-.3 1.8-.3s1.2.1 1.8.3c1.4-1 2-.8 2-.8.4 1 .2 1.8.1 2 .5.5.7 1.2.7 2 0 2.9-1.8 3.6-3.5 3.8.3.2.5.7.5 1.4v2.1c0 .2.1.5.5.4C13 13.7 15 11.1 15 8c0-3.9-3.1-7-7-7z"
        fill="currentColor"
        stroke="none"
      />
    ),
  },
  "info-circle": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3M8 10h.01" />
      </>
    ),
    strokeWidth: 1.3,
  },
  "log-lines": {
    body: () => <path d="M3 3h10M3 6.5h8M3 10h6M3 13.5h9" />,
  },
  "drag-handle": {
    // Six dots in two columns. The path uses moveto + dot at each
    // location (a tiny `h.01` segment renders as a stroke-width dot
    // with stroke-linecap="round").
    body: () => (
      <path d="M6 3h.01M10 3h.01M6 8h.01M10 8h.01M6 13h.01M10 13h.01" />
    ),
    strokeWidth: 2.2,
  },
  download: {
    body: () => (
      <>
        <line x1="8" y1="2.5" x2="8" y2="10" />
        <polyline points="5,7 8,10 11,7" />
        <line x1="3" y1="13" x2="13" y2="13" />
      </>
    ),
  },
  upload: {
    body: () => (
      <>
        <line x1="8" y1="10" x2="8" y2="2.5" />
        <polyline points="5,5.5 8,2.5 11,5.5" />
        <line x1="3" y1="13" x2="13" y2="13" />
      </>
    ),
  },
  // Status family — migrated 2026-05-04 (Step 8b) from Board.statusIcon
  // innerHTML strings. Per-path `fill="currentColor"` opts into the
  // filled-glyph variant (replaces the legacy `data-fill="true"`
  // attribute the .status-icon CSS used to switch on).
  "status-idle": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
      </>
    ),
  },
  "status-queued": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <path d="M8 5.4v2.8l2.1 1.3" />
      </>
    ),
  },
  "status-active": {
    body: () => <path d="M6 4.6L11.3 8 6 11.4Z" fill="currentColor" stroke="none" />,
  },
  "status-completed": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <path d="M5.1 8.2l2 2 3.8-3.8" />
      </>
    ),
  },
  "status-failed": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <path d="M5.4 5.4l5.2 5.2" />
        <path d="M10.6 5.4l-5.2 5.2" />
      </>
    ),
  },
  "status-cancelled": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <path d="M5.2 10.8l5.6-5.6" />
      </>
    ),
  },
};

export interface IconProps {
  name: IconName;
  /** Pixel size; defaults to 16. CSS still drives final size via
   * `font-size` / `width` on the parent — this is the SVG attribute
   * for accessibility tools that need a numeric default. */
  size?: number;
  class?: string;
  /** Override the default 1.4 stroke-width if the consumer needs a
   * specific weight (e.g. a dense overview icon may bump to 1.6). */
  strokeWidth?: number;
  /** Hide from screen readers — most icons are decorative. */
  decorative?: boolean;
  /** Title for tooltip + aria-label fallback. */
  title?: string;
}

export function Icon(props: IconProps): JSX.Element {
  const size = () => props.size ?? 16;
  const decorative = () => props.decorative !== false;
  const record = () => ICON_PATHS[props.name];
  const strokeWidth = () =>
    props.strokeWidth ?? record().strokeWidth ?? 1.4;
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth()}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={decorative() ? "true" : undefined}
      role={decorative() ? undefined : "img"}
    >
      <Show when={props.title}>
        <title>{props.title}</title>
      </Show>
      {record().body()}
    </svg>
  );
}

/** List of registered icon names. Exposed for the icon-coverage
 * test so it can assert the registry covers every callsite. */
export const REGISTERED_ICONS: readonly IconName[] = Object.keys(
  ICON_PATHS,
) as IconName[];
