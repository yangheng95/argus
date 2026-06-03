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
  | "coding-cli"
  | "coding-claude-code"
  | "coding-codex"
  | "coding-gemini"
  | "coding-copilot"
  | "coding-glm"
  // Chat-bubble avatar glyphs
  | "avatar-user"
  | "avatar-assistant"
  | "avatar-system"
  | "avatar-orchestrator"
  | "avatar-mission"
  | "avatar-intent-analysis"
  | "avatar-spec"
  | "avatar-requirements"
  | "avatar-frontend-design"
  | "avatar-frontend-research"
  | "avatar-architect"
  | "avatar-planner"
  | "avatar-goal"
  | "avatar-executor"
  | "avatar-build"
  | "avatar-explore"
  | "avatar-evaluator"
  | "avatar-integrity"
  | "avatar-fact-check"
  | "avatar-acceptance"
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
  | "acceptance"
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
  | "edit"
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
  | "status-cancelled"
  // Mission entry / control room glyph
  | "mission"
  | "channel-link";

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
  "coding-cli": {
    body: () => (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
        <path d="M5 6.2 7 8 5 9.8" />
        <circle cx="10.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
      </>
    ),
  },
  "coding-claude-code": {
    body: () => (
      <g transform="scale(0.6666667)" stroke="none">
        <path
          fill="#D97757"
          d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        />
      </g>
    ),
  },
  "coding-codex": {
    body: () => (
      <g transform="scale(0.6666667)" stroke="none">
        <path
          fill="currentColor"
          d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        />
      </g>
    ),
  },
  "coding-gemini": {
    body: () => (
      <g transform="scale(0.6666667)" stroke="none">
        <path
          fill="#8E75B2"
          d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
        />
      </g>
    ),
  },
  "coding-copilot": {
    body: () => (
      <g transform="scale(0.6666667)" stroke="none">
        <path
          fill="currentColor"
          d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"
        />
      </g>
    ),
  },
  "coding-glm": {
    body: () => (
      <g transform="scale(0.5333333)" stroke="none">
        <path
          fill="#2D2D2D"
          stroke="#FFFFFF"
          stroke-width="0.6317"
          stroke-miterlimit="10"
          d="M24.51,28.51H5.49c-2.21,0-4-1.79-4-4V5.49c0-2.21,1.79-4,4-4h19.03c2.21,0,4,1.79,4,4v19.03C28.51,26.72,26.72,28.51,24.51,28.51z"
        />
        <path
          fill="#FFFFFF"
          d="M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z"
        />
        <polygon
          fill="#FFFFFF"
          points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1"
        />
        <path
          fill="#FFFFFF"
          d="M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z"
        />
      </g>
    ),
  },
  "avatar-user": {
    body: () => (
      <>
        <circle cx="8" cy="5.25" r="2.1" />
        <path d="M4 12.5c.8-2 2.2-3 4-3s3.2 1 4 3" />
      </>
    ),
  },
  "avatar-assistant": {
    body: () => (
      <>
        <path d="M3.8 5.4h6.2a2.4 2.4 0 0 1 0 4.8H7.9l-2.7 2.1v-2.1H3.8a2.4 2.4 0 0 1 0-4.8Z" />
        <path d="M11.8 2.9v1.8M10.9 3.8h1.8M10.9 6.1h1.8M11.8 5.2V7" />
      </>
    ),
  },
  "avatar-system": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="2.1" />
        <path d="M8 2.6v1.4M8 12v1.4M13.4 8H12M4 8H2.6M11.8 4.2l-1 1M5.2 10.8l-1 1M11.8 11.8l-1-1M5.2 5.2l-1-1" />
      </>
    ),
    strokeWidth: 1.3,
  },
  "avatar-orchestrator": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="8" cy="3.4" r="1.1" />
        <circle cx="12.2" cy="10.5" r="1.1" />
        <circle cx="3.8" cy="10.5" r="1.1" />
        <path d="M8 6.6V4.5M9.1 8.7l2 1M6.9 8.7l-2 1" />
      </>
    ),
  },
  "avatar-mission": {
    body: () => (
      <>
        <path d="M3.2 5.2h9.6v5.9H3.2Z" />
        <path d="M5.4 7.2h.1M7.4 7.2h.1M9.4 7.2h.1" />
        <path d="M6.2 12.6h3.6M8 11.1v1.5" />
      </>
    ),
  },
  "avatar-intent-analysis": {
    body: () => (
      <>
        <circle cx="6.7" cy="6.7" r="3.1" />
        <path d="M9.1 9.1 12.4 12.4" />
        <path d="M5.6 6.7h2.2M6.7 5.6v2.2" />
      </>
    ),
  },
  "avatar-spec": {
    body: () => (
      <>
        <path d="M5.5 4.1h5.1a1.5 1.5 0 0 1 1.5 1.5v4.7a1.7 1.7 0 0 1-1.7 1.7H6.4a1.6 1.6 0 1 1 0-3.2H10" />
        <path d="M6.2 6.3H10M6.2 8.3H9.8M6.2 10.2H8.6" />
      </>
    ),
  },
  "avatar-requirements": {
    body: () => (
      <>
        <rect x="4.2" y="3.4" width="7.6" height="9.2" rx="1.2" />
        <path d="M6.1 6h3.8M6.1 8.2h2.6M6.2 10.3l1.1 1.1 2-2.1" />
      </>
    ),
  },
  "avatar-frontend-design": {
    body: () => (
      <>
        <circle cx="6.7" cy="6.7" r="2.5" />
        <path d="M6.7 3.3v1.1M6.7 9v1.1M3.3 6.7h1.1M9 6.7h1.1M8.6 8.6l2.2 2.2" />
      </>
    ),
  },
  "avatar-frontend-research": {
    body: () => (
      <>
        <circle cx="6.5" cy="6.5" r="2.4" />
        <path d="M8.3 8.3 11.4 11.4" />
        <path d="M4.5 11.2h5.8M4.9 4.4h3.2M4.9 6.4h2.5" />
      </>
    ),
  },
  "avatar-architect": {
    body: () => (
      <>
        <path d="M7.3 4.1 5.3 11.6" />
        <path d="M8.7 4.1 10.7 11.6" />
        <path d="M6.2 9.2h3.6" />
        <path d="M10.7 5 13 11.6H8.9" />
      </>
    ),
  },
  "avatar-planner": {
    body: () => (
      <>
        <circle cx="4.3" cy="4.3" r="1.1" />
        <circle cx="11.7" cy="4.3" r="1.1" />
        <circle cx="8" cy="11.7" r="1.1" />
        <path d="M5.2 4.9 7.1 10.9M10.8 4.9 8.9 10.9M5.4 4.3h5.2" />
      </>
    ),
  },
  "avatar-goal": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.4" />
        <circle cx="8" cy="8" r="2.4" />
        <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      </>
    ),
  },
  "avatar-executor": {
    body: () => <path d="M5 4.2 11.4 8 5 11.8Z" fill="currentColor" stroke="none" />,
  },
  "avatar-build": {
    body: () => (
      <>
        <path d="M9.4 4.1 11.9 6.6l-1.2 1.2-2.5-2.5Z" />
        <path d="M7.8 5.7 10.3 8.2" />
        <path d="M4.2 8.1 7.9 11.8" />
        <path d="M5.1 6.9 3.5 8.5l1.3 1.3 1.6-1.6" />
      </>
    ),
  },
  "avatar-explore": {
    body: () => (
      <>
        <circle cx="7" cy="7" r="3.2" />
        <path d="M9.4 9.4 12.6 12.6" />
      </>
    ),
  },
  "avatar-evaluator": {
    body: () => (
      <>
        <path d="M8 3.2v2.1M5.1 5.4h5.8" />
        <path d="M6 5.4 4.4 8.8h3.2Z" />
        <path d="M10 5.4 8.4 8.8h3.2Z" />
        <path d="M4.4 10.8h7.2" />
      </>
    ),
  },
  "avatar-integrity": {
    body: () => (
      <>
        <path d="M8 3.1 11.5 4.4v2.8c0 2.3-1.5 4.3-3.5 5.4-2-1.1-3.5-3.1-3.5-5.4V4.4Z" />
        <path d="M6.4 7.6 7.6 8.8l2.1-2.3" />
      </>
    ),
  },
  "avatar-fact-check": {
    body: () => (
      <>
        <rect x="3.8" y="3.5" width="8.4" height="9" rx="1.4" />
        <path d="M5.8 6h3.9M5.8 8h2.4M5.9 10l1.1 1.1 2.2-2.3" />
      </>
    ),
  },
  "avatar-acceptance": {
    body: () => (
      <>
        <path d="M3.2 8.4 6.3 11.5 12.8 4.9" />
        <path d="M3.4 4.3h4.2M3.4 6.3h2.8" />
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
  acceptance: {
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
  edit: {
    // Pencil glyph: angled body with a tip at the bottom-left and a
    // small eraser cap at the top-right. Strokes only, so it tracks
    // currentColor like the other action chrome.
    // Sized to occupy ~7.5/16 of the viewBox so it reads at the same
    // visual weight as `stop`/`close` when shown in the task row's
    // action cluster — otherwise the larger pencil dominates its
    // smaller-glyph neighbours at the same icon size.
    body: () => (
      <>
        <path d="M9.4 4.2 11.8 6.6 6.7 11.7H4.3V9.3Z" />
        <path d="M8.6 5 11 7.4" />
      </>
    ),
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
  // TitlebarMenubar / Card.
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
  // Mission: a hub-and-spokes glyph — a central node with three radials
  // suggesting "control room that fans out to many runners / channels".
  mission: {
    body: () => (
      <>
        <circle cx="8" cy="8" r="2.4" />
        <line x1="8" y1="2.5" x2="8" y2="5" />
        <line x1="8" y1="11" x2="8" y2="13.5" />
        <line x1="2.5" y1="8" x2="5" y2="8" />
        <line x1="11" y1="8" x2="13.5" y2="8" />
      </>
    ),
  },
  // Channel link: two link rings, used for channel binding badges.
  "channel-link": {
    body: () => (
      <>
        <path d="M6 9.5L4.5 11a2 2 0 0 1-2.8-2.8L3 7" />
        <path d="M10 6.5L11.5 5a2 2 0 0 1 2.8 2.8L13 9" />
        <line x1="6" y1="10" x2="10" y2="6" />
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
