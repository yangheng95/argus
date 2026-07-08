// ── Icon ──
//
// Single-source icon primitive for the overlay. Commodity glyphs render
// through lucide-solid; custom SVG remains only for product-specific
// brand, agent, workflow, and mission glyphs. Callers always use this
// component instead of importing icon packages or writing inline SVG.

import { createUniqueId, Show, type JSX } from "solid-js"
import type { LucideIcon } from "lucide-solid"
import {
  Ban,
  Bell,
  Bot,
  BrainCircuit,
  Cable,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitCompareArrows,
  Globe,
  GripVertical,
  Images,
  Info,
  Layers,
  ListTodo,
  Logs,
  MessageSquare,
  Minus,
  Package,
  PanelLeft,
  PanelRight,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rss,
  Search,
  ScanSearch,
  Send,
  Settings,
  Shell,
  Shield,
  ShoppingBag,
  Square,
  SquareTerminal,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  Wrench,
  Workflow,
  X,
} from "lucide-solid"

export type IconName =
  // Window / dismiss / control
  | "close"
  | "chevron"
  | "chevron-up"
  | "chevron-down"
  | "caret-down"
  | "nav-back"
  | "nav-forward"
  | "plus"
  | "minimize"
  | "maximize"
  | "restore"
  | "panel-left"
  | "panel-right"
  | "terminal"
  | "tasks"
  | "message"
  | "message-add"
  | "workflow"
  | "notifications"
  | "screenshots"
  | "terminal-powershell"
  | "terminal-command-prompt"
  | "terminal-bash"
  | "editor-vscode"
  | "editor-pycharm"
  | "editor-webstorm"
  | "editor-intellij"
  | "editor-cursor"
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
  | "avatar-visual-qa"
  | "avatar-architect"
  | "avatar-goal-workload-analyst"
  | "avatar-planner"
  | "avatar-goal"
  | "avatar-executor"
  | "avatar-build"
  | "avatar-explore"
  | "avatar-deep-research"
  | "avatar-evaluator"
  | "avatar-integrity"
  | "avatar-fact-check"
  | "avatar-acceptance"
  // Empty-state / cwd
  | "folder"
  | "folder-open"
  | "project-add"
  | "git-worktree"
  | "git-branch"
  | "git-branch-plus"
  | "git-commit"
  | "git-compare"
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
  | "expert-squad"
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
  | "delete"
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
  | "channel-link"
  // Config dialog navigation
  | "config-general"
  | "config-permissions"
  | "config-channel"
  | "config-tool"
  | "config-skill"
  | "config-skill-market"
  | "config-mcp"
  | "config-memory"
  | "config-network"
  | "config-providers"
  | "config-agent-models"
  | "config-about"

interface IconRecord {
  /** Inner SVG markup. Must be self-contained (no external defs). */
  body: (idPrefix: string) => JSX.Element
  /** Override stroke-width if the path is dense; defaults to 1.4. */
  strokeWidth?: number
}

interface LucideIconRecord {
  component: LucideIcon
  strokeWidth?: number
}

const LUCIDE_ICON_MAP: Partial<Record<IconName, LucideIconRecord>> = {
  close: { component: X },
  chevron: { component: ChevronRight },
  "chevron-up": { component: ChevronUp },
  "chevron-down": { component: ChevronDown },
  "caret-down": { component: ChevronDown },
  "caret-up": { component: ChevronUp },
  "nav-back": { component: ChevronLeft },
  "nav-forward": { component: ChevronRight },
  plus: { component: Plus },
  minimize: { component: Minus, strokeWidth: 2.1 },
  maximize: { component: Square, strokeWidth: 1.8 },
  restore: { component: Copy, strokeWidth: 1.7 },
  "panel-left": { component: PanelLeft },
  "panel-right": { component: PanelRight },
  terminal: { component: Terminal },
  tasks: { component: ListTodo },
  message: { component: MessageSquare },
  workflow: { component: Workflow },
  notifications: { component: Bell },
  screenshots: { component: Images },
  "terminal-powershell": { component: SquareTerminal },
  "terminal-command-prompt": { component: Terminal },
  "terminal-bash": { component: Shell },
  folder: { component: Folder },
  "folder-open": { component: FolderOpen },
  "git-worktree": { component: FolderGit2 },
  "git-branch": { component: GitBranch },
  "git-branch-plus": { component: GitBranchPlus },
  "git-commit": { component: GitCommitHorizontal },
  "git-compare": { component: GitCompareArrows },
  attach: { component: Paperclip },
  "web-search": { component: Globe },
  "expert-squad": { component: BrainCircuit },
  send: { component: Send },
  stop: { component: Square },
  copy: { component: Copy },
  check: { component: Check },
  inspect: { component: ScanSearch },
  cancel: { component: X },
  edit: { component: Pencil },
  rewind: { component: Undo2 },
  search: { component: Search },
  refresh: { component: RefreshCw },
  "external-link": { component: ExternalLink },
  "file-document": { component: FileText },
  "info-circle": { component: Info },
  "log-lines": { component: Logs },
  "drag-handle": { component: GripVertical },
  download: { component: Download },
  upload: { component: Upload },
  delete: { component: Trash2 },
  "status-idle": { component: Circle },
  "status-queued": { component: Clock },
  "status-active": { component: Play },
  "status-completed": { component: CircleCheck },
  "status-failed": { component: CircleX },
  "status-cancelled": { component: Ban },
  "config-general": { component: Settings },
  "config-permissions": { component: Shield },
  "config-channel": { component: Rss },
  "config-tool": { component: Wrench },
  "config-skill": { component: Package },
  "config-skill-market": { component: ShoppingBag },
  "config-mcp": { component: Cable },
  "config-memory": { component: BrainCircuit },
  "config-network": { component: Globe },
  "config-providers": { component: Layers },
  "config-agent-models": { component: Bot },
  "config-about": { component: Info },
}

const CUSTOM_ICON_PATHS: Partial<Record<IconName, IconRecord>> = {
  "project-add": {
    body: () => (
      <>
        <path d="M2.6 6V4.9c0-.9.7-1.5 1.5-1.5h2.1c.4 0 .8.2 1.1.5l.8.9h3.8c.8 0 1.5.7 1.5 1.5V6" />
        <path d="M2.6 6.4h10.8v5.1c0 .8-.7 1.5-1.5 1.5H4.1c-.8 0-1.5-.7-1.5-1.5V6.4Z" />
        <path d="M8 8.2v3.2M6.4 9.8h3.2" />
      </>
    ),
    strokeWidth: 1.45,
  },
  "message-add": {
    body: () => (
      <>
        <path d="M3.4 4.4h7.2c1.2 0 2.1.9 2.1 2.1v2.2c0 1.2-.9 2.1-2.1 2.1H7.4l-2.8 2v-2H3.4c-1.2 0-2.1-.9-2.1-2.1V6.5c0-1.2.9-2.1 2.1-2.1Z" />
        <path d="M8.8 6.5v2.8M7.4 7.9h2.8" />
      </>
    ),
    strokeWidth: 1.45,
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
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
            <feOffset />
            <feGaussianBlur stdDeviation="4.16667" />
            <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
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
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
            <feOffset />
            <feGaussianBlur stdDeviation="4.16667" />
            <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
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
        <path d="M3.1 4 8.2 2.4 13 4.4l-.8 8.1-5.7 1.1L3 10.9Z" fill="currentColor" stroke="none" />
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
  "avatar-visual-qa": {
    body: () => (
      <>
        <rect x="3.3" y="4" width="9.4" height="6.7" rx="1.1" />
        <path d="M6.2 12.2h3.6M8 10.7v1.5M5.5 7.3l1.4 1.4 3-3.1" />
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
  "avatar-goal-workload-analyst": {
    body: () => (
      <>
        <circle cx="8" cy="8" r="4.4" />
        <path d="M5.7 8h4.6M8 5.7v4.6" />
        <path d="M5.2 11.6h5.6" />
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
  "avatar-deep-research": {
    body: () => (
      <>
        <circle cx="6.4" cy="6.4" r="2.8" />
        <path d="M8.5 8.5 12.3 12.3" />
        <path d="M5.2 5.5h2.4M5.2 7.2h1.6" />
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
  github: {
    body: () => (
      <path
        d="M8 1C4.1 1 1 4.1 1 8c0 3.1 2 5.7 4.8 6.6.4.1.5-.2.5-.4v-1.3C4.2 13.3 3.7 12 3.7 12c-.3-.8-.8-1-.8-1-.6-.4.1-.4.1-.4.7.1 1.1.7 1.1.7.6 1.1 1.7.8 2.1.6.1-.4.3-.8.4-.9-1.7-.2-3.5-.9-3.5-3.8 0-.8.3-1.5.7-2-.1-.2-.3-1 .1-2 0 0 .6-.2 2 .8.6-.2 1.2-.3 1.8-.3s1.2.1 1.8.3c1.4-1 2-.8 2-.8.4 1 .2 1.8.1 2 .5.5.7 1.2.7 2 0 2.9-1.8 3.6-3.5 3.8.3.2.5.7.5 1.4v2.1c0 .2.1.5.5.4C13 13.7 15 11.1 15 8c0-3.9-3.1-7-7-7z"
        fill="currentColor"
        stroke="none"
      />
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
}

export interface IconProps {
  name: IconName
  /** Pixel size; defaults to 16. CSS still drives final size via
   * `font-size` / `width` on the parent — this is the SVG attribute
   * for accessibility tools that need a numeric default. */
  size?: number
  class?: string
  /** Override the default 1.4 stroke-width if the consumer needs a
   * specific weight (e.g. a dense overview icon may bump to 1.6). */
  strokeWidth?: number
  /** Hide from screen readers — most icons are decorative. */
  decorative?: boolean
  /** Title for tooltip + aria-label fallback. */
  title?: string
}

export function Icon(props: IconProps): JSX.Element {
  const iconIDPrefix = createUniqueId()
  const size = () => props.size ?? 16
  const decorative = () => props.decorative !== false
  const lucideRecord = () => LUCIDE_ICON_MAP[props.name]
  const customRecord = () => CUSTOM_ICON_PATHS[props.name]
  const customStrokeWidth = () => props.strokeWidth ?? customRecord()?.strokeWidth ?? 1.4
  const lucideStrokeWidth = () => props.strokeWidth ?? lucideRecord()?.strokeWidth ?? 2

  return (
    <Show
      when={lucideRecord()}
      keyed
      fallback={
        <svg
          class={props.class}
          width={size()}
          height={size()}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width={customStrokeWidth()}
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden={decorative() ? "true" : undefined}
          role={decorative() ? undefined : "img"}
        >
          <Show when={props.title}>
            <title>{props.title}</title>
          </Show>
          {customRecord()?.body(iconIDPrefix)}
        </svg>
      }
    >
      {(record) => {
        const Lucide = record.component
        return (
          <Lucide
            class={props.class}
            size={size()}
            color="currentColor"
            strokeWidth={lucideStrokeWidth()}
            aria-hidden={decorative() ? "true" : undefined}
            role={decorative() ? undefined : "img"}
          >
            <Show when={props.title}>
              <title>{props.title}</title>
            </Show>
          </Lucide>
        )
      }}
    </Show>
  )
}

export const LUCIDE_ICON_NAMES = Object.keys(LUCIDE_ICON_MAP) as IconName[]
export const CUSTOM_ICON_NAMES = Object.keys(CUSTOM_ICON_PATHS) as IconName[]
export const REGISTERED_ICONS: readonly IconName[] = [...LUCIDE_ICON_NAMES, ...CUSTOM_ICON_NAMES]
