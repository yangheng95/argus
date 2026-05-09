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

import { createUniqueId, Show, type JSX } from "solid-js";

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
  | "terminal-powershell"
  | "terminal-command-prompt"
  | "terminal-bash"
  | "editor-vscode"
  | "editor-pycharm"
  | "editor-webstorm"
  | "editor-intellij"
  | "editor-cursor"
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
  body: (idPrefix: string) => JSX.Element;
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
  "terminal-powershell": {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <path d="M5 6.1 7.2 8 5 9.9" />
        <line x1="8.4" y1="10.2" x2="11.2" y2="10.2" />
      </>
    ),
  },
  "terminal-command-prompt": {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <path d="M5 6.2 7 8 5 9.8" />
        <line x1="8.2" y1="10" x2="11" y2="10" />
      </>
    ),
  },
  "terminal-bash": {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <path d="M5 6.3 6.8 8 5 9.7" />
        <path d="M8.1 6.3h2.7M8.1 8h2.2M8.1 9.7h2.7" />
      </>
    ),
  },
  "editor-vscode": {
    body: (idPrefix) => (
      <>
        <defs>
          <mask
            id={`${idPrefix}-editor-vscode-mask`}
            mask-type="alpha"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="100"
            height="100"
          >
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M70.9119 99.3171C72.4869 99.9307 74.2828 99.8914 75.8725 99.1264L96.4608 89.2197C98.6242 88.1787 100 85.9892 100 83.5872V16.4133C100 14.0113 98.6243 11.8218 96.4609 10.7808L75.8725 0.873756C73.7862 -0.130129 71.3446 0.11576 69.5135 1.44695C69.252 1.63711 69.0028 1.84943 68.769 2.08341L29.3551 38.0415L12.1872 25.0096C10.589 23.7965 8.35363 23.8959 6.86933 25.2461L1.36303 30.2549C-0.452552 31.9064 -0.454633 34.7627 1.35853 36.417L16.2471 50.0001L1.35853 63.5832C-0.454633 65.2374 -0.452552 68.0938 1.36303 69.7453L6.86933 74.7541C8.35363 76.1043 10.589 76.2037 12.1872 74.9905L29.3551 61.9587L68.769 97.9167C69.3925 98.5406 70.1246 99.0104 70.9119 99.3171ZM75.0152 27.2989L45.1091 50.0001L75.0152 72.7012V27.2989Z"
              fill="white"
              stroke="none"
            />
          </mask>
          <filter
            id={`${idPrefix}-editor-vscode-filter-0`}
            x="-8.39411"
            y="15.8291"
            width="116.727"
            height="92.2456"
            filterUnits="userSpaceOnUse"
            color-interpolation-filters="sRGB"
          >
            <feFlood flood-opacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            />
            <feOffset />
            <feGaussianBlur stdDeviation="4.16667" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"
            />
            <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
          </filter>
          <filter
            id={`${idPrefix}-editor-vscode-filter-1`}
            x="60.4167"
            y="-8.07558"
            width="47.9167"
            height="116.151"
            filterUnits="userSpaceOnUse"
            color-interpolation-filters="sRGB"
          >
            <feFlood flood-opacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            />
            <feOffset />
            <feGaussianBlur stdDeviation="4.16667" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"
            />
            <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
          </filter>
          <linearGradient
            id={`${idPrefix}-editor-vscode-paint-0`}
            x1="49.9392"
            y1="0.257812"
            x2="49.9392"
            y2="99.7423"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="white" />
            <stop offset="1" stop-color="white" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g transform="scale(0.16)" stroke="none">
          <g mask={`url(#${idPrefix}-editor-vscode-mask)`}>
            <path
              d="M96.4614 10.7962L75.8569 0.875542C73.4719 -0.272773 70.6217 0.211611 68.75 2.08333L1.29858 63.5832C-0.515693 65.2373 -0.513607 68.0937 1.30308 69.7452L6.81272 74.754C8.29793 76.1042 10.5347 76.2036 12.1338 74.9905L93.3609 13.3699C96.086 11.3026 100 13.2462 100 16.6667V16.4275C100 14.0265 98.6246 11.8378 96.4614 10.7962Z"
              fill="#0065A9"
            />
            <g filter={`url(#${idPrefix}-editor-vscode-filter-0)`}>
              <path
                d="M96.4614 89.2038L75.8569 99.1245C73.4719 100.273 70.6217 99.7884 68.75 97.9167L1.29858 36.4169C-0.515693 34.7627 -0.513607 31.9063 1.30308 30.2548L6.81272 25.246C8.29793 23.8958 10.5347 23.7964 12.1338 25.0095L93.3609 86.6301C96.086 88.6974 100 86.7538 100 83.3334V83.5726C100 85.9735 98.6246 88.1622 96.4614 89.2038Z"
                fill="#007ACC"
              />
            </g>
            <g filter={`url(#${idPrefix}-editor-vscode-filter-1)`}>
              <path
                d="M75.8578 99.1263C73.4721 100.274 70.6219 99.7885 68.75 97.9166C71.0564 100.223 75 98.5895 75 95.3278V4.67213C75 1.41039 71.0564 -0.223106 68.75 2.08329C70.6219 0.211402 73.4721 -0.273666 75.8578 0.873633L96.4587 10.7807C98.6234 11.8217 100 14.0112 100 16.4132V83.5871C100 85.9891 98.6234 88.1786 96.4586 89.2196L75.8578 99.1263Z"
                fill="#1F9CF0"
              />
            </g>
            <g style="mix-blend-mode:overlay" opacity="0.25">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M70.8511 99.3171C72.4261 99.9306 74.2221 99.8913 75.8117 99.1264L96.4 89.2197C98.5634 88.1787 99.9392 85.9892 99.9392 83.5871V16.4133C99.9392 14.0112 98.5635 11.8217 96.4001 10.7807L75.8117 0.873695C73.7255 -0.13019 71.2838 0.115699 69.4527 1.44688C69.1912 1.63705 68.942 1.84937 68.7082 2.08335L29.2943 38.0414L12.1264 25.0096C10.5283 23.7964 8.29285 23.8959 6.80855 25.246L1.30225 30.2548C-0.513334 31.9064 -0.515415 34.7627 1.29775 36.4169L16.1863 50L1.29775 63.5832C-0.515415 65.2374 -0.513334 68.0937 1.30225 69.7452L6.80855 74.754C8.29285 76.1042 10.5283 76.2036 12.1264 74.9905L29.2943 61.9586L68.7082 97.9167C69.3317 98.5405 70.0638 99.0104 70.8511 99.3171ZM74.9544 27.2989L45.0483 50L74.9544 72.7012V27.2989Z"
                fill={`url(#${idPrefix}-editor-vscode-paint-0)`}
              />
            </g>
          </g>
        </g>
      </>
    ),
  },
  "editor-pycharm": {
    body: (idPrefix) => (
      <>
        <defs>
          <linearGradient
            id={`${idPrefix}-editor-pycharm-gradient-a`}
            x1="7.62141"
            x2="61.2476"
            y1="64.7192"
            y2="39.8558"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset=".1" stop-color="#00D886" />
            <stop offset=".59" stop-color="#F0EB18" />
          </linearGradient>
          <linearGradient
            id={`${idPrefix}-editor-pycharm-gradient-b`}
            x1="60.0186"
            x2="1.31317"
            y1="59.7778"
            y2="1.07229"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset=".3" stop-color="#F0EB18" />
            <stop offset=".7" stop-color="#00C4F4" />
          </linearGradient>
        </defs>
        <g transform="scale(0.25)" stroke="none">
          <path
            fill="#00D886"
            d="m5.81934 48.0512.00174 11.8755c0 2.2493 1.82342 4.0721 4.07273 4.0721H21.4004c1.1887 0 2.3186-.5196 3.0924-1.422L57.202 24.4154c.6325-.7383.9804-1.6786.9804-2.6508V9.88913c0-2.24931-1.8234-4.07272-4.0727-4.07272H42.6013c-1.1887 0-2.3185.51956-3.0924 1.42196L6.7997 45.3998c-.63302.7384-.98036 1.6786-.98036 2.6514Z"
          />
          <path
            fill={`url(#${idPrefix}-editor-pycharm-gradient-a)`}
            d="M5.81836 49.4825v10.4466c0 2.2493 1.82342 4.0727 4.07273 4.0727H22.9837c.1926 0 .3852-.0139.576-.0407l36.9438-5.2771c2.0066-.2868 3.4967-2.0049 3.4967-4.032V38.979c0-2.2499-1.824-4.0733-4.0739-4.0727l-18.5385.0046c-.4375 0-.8721.0704-1.287.2089L8.60294 45.6193c-1.66284.5544-2.78458 2.1108-2.78458 3.8638v-.0006Z"
          />
          <path
            fill={`url(#${idPrefix}-editor-pycharm-gradient-b)`}
            d="M0 4.07273V38.041c0 1.6291.971054 3.1017 2.46807 3.7434L39.9587 57.8525c.5068.217 1.0531.3293 1.6046.3293h18.364c2.2493 0 4.0727-1.8234 4.0727-4.0727v-17.966c0-.8046-.2385-1.5912-.6854-2.2609L41.9119 1.81353C41.1561.681309 39.8854.001745 38.5245.001745L4.07273 0C1.82342 0 0 1.82342 0 4.07273Z"
          />
          <path fill="#000" d="M52 12H12v40h40V12Z" />
          <path
            fill="#fff"
            fill-rule="evenodd"
            d="M23.5363 16.9676h-6.4407v15.0055h2.9261v-5.6702h3.4296c1.0715 0 2.0115-.1929 2.8188-.5788.8148-.3927 1.4401-.9434 1.8759-1.6508.4427-.7074.6643-1.5434.6643-2.465 0-.9216-.2182-1.7324-.654-2.4329-.4289-.7005-1.0433-1.2431-1.8437-1.629-.8005-.3859-1.7261-.5788-2.7763-.5788Zm1.0927 6.6349c-.3646.1785-.7929.2681-1.2862.2681h-3.3229v-4.4695h3.3229c.4933 0 .9216.0924 1.2862.2784.3715.178.6569.4353.8573.7718.2004.3278.3003.7286.3003 1.1788 0 .4502-.1005.8469-.3003 1.1897-.1998.3365-.4858.5966-.8573.7827Z"
            clip-rule="evenodd"
          />
          <path
            fill="#fff"
            d="M33.3821 31.2232c1.1651.6713 2.4656 1.0077 3.9017 1.0077v-.0011c1.2144 0 2.3295-.2251 3.3441-.6753 1.0146-.4501 1.8575-1.0783 2.5294-1.8862.6787-.8148 1.1328-1.7473 1.3614-2.7975H41.453c-.2004.5426-.5001 1.0221-.9003 1.4361-.3933.4076-.8688.7223-1.4257.9434-.557.221-1.1645.3324-1.822.3324-.886 0-1.6864-.221-2.4007-.6643-.7149-.4433-1.2759-1.0502-1.683-1.8219-.4002-.7781-.6-1.6543-.6-2.6259 0-.9715.1998-1.8437.6-2.6154.4077-.7786.9681-1.3896 1.683-1.8329.7143-.4432 1.5147-.6643 2.4007-.6643.6569 0 1.2644.1114 1.822.3325.5575.221 1.0324.5397 1.4257.9537.4002.4077.6999.8831.9003 1.4257h3.0657c-.2291-1.0502-.6827-1.9787-1.3614-2.7866-.6719-.8147-1.5148-1.4469-2.5294-1.8971-1.0146-.4502-2.1297-.6753-3.3441-.6753-1.4367 0-2.7372.3388-3.9017 1.0181-1.165.6712-2.0797 1.6009-2.7441 2.7866-.6643 1.1788-.9968 2.4972-.9968 3.955 0 1.4579.3325 2.7803.9968 3.966.6649 1.1789 1.5791 2.1073 2.7441 2.7866Z"
          />
          <path fill="#fff" d="M16.9941 44.001h16v3h-16v-3Z" />
        </g>
      </>
    ),
  },
  "editor-webstorm": {
    body: () => (
      <>
        <path
          d="M3.1 4 8.2 2.4 13 4.4l-.8 8.1-5.7 1.1L3 10.9Z"
          fill="currentColor"
          stroke="none"
        />
        <rect x="5" y="5" width="6" height="6" rx="0.6" fill="var(--task-bar-bg)" stroke="none" />
        <path d="M6.3 8.4 7 6.7l1 1.7 1-1.7.8 1.7" />
      </>
    ),
  },
  "editor-intellij": {
    body: () => (
      <>
        <path d="M2.8 3.8 7.6 2.3l5.6 2.2v7.7l-5.6 1.5-4.8-2.2Z" fill="currentColor" stroke="none" />
        <rect x="5" y="5.1" width="6" height="5.8" rx="0.6" fill="var(--task-bar-bg)" stroke="none" />
        <path d="M6.5 9.5h3" />
      </>
    ),
  },
  "editor-cursor": {
    body: () => (
      <>
        <path d="M3 2.6 13 8 8.2 9.1 6.6 13.4Z" fill="currentColor" stroke="none" />
        <path d="M6.4 5.7 9.7 7.6 7.8 8 7 10.1Z" fill="var(--task-bar-bg)" stroke="none" />
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
  const iconIDPrefix = createUniqueId();
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
      {record().body(iconIDPrefix)}
    </svg>
  );
}

/** List of registered icon names. Exposed for the icon-coverage
 * test so it can assert the registry covers every callsite. */
export const REGISTERED_ICONS: readonly IconName[] = Object.keys(
  ICON_PATHS,
) as IconName[];
