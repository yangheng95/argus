// ── DOM Refs ──
// Type-safe declarations for DOM elements accessed by imperative code
// (section phase highlights, budget bindings, meta rendering, etc.).

// ── Interface ──

export interface DomRefs {
 // Canvas / branding
  techAtlasCanvas: HTMLCanvasElement | null;
  titlebar: HTMLElement | null;
  connBadge: HTMLElement | null;
  brandLogo: HTMLElement | null;
  chatVersion: HTMLElement | null;

 // Titlebar controls
  solidTitlebarMenu: HTMLElement | null;

 // Window controls
  btnMinimize: HTMLButtonElement | null;
  btnMaximize: HTMLButtonElement | null;
  btnClose: HTMLButtonElement | null;

 // Layout panels
  panelBody: HTMLElement | null;
  sidebar: HTMLElement | null;
  leftPaneResizer: HTMLElement | null;
  workspaceMain: HTMLElement | null;
  rightPaneResizer: HTMLElement | null;
  sections: HTMLElement | null;

 // Task / workspace
  taskDir: HTMLElement | null;
  recentDirPanel: HTMLElement | null;
  btnBrowseCwd: HTMLButtonElement | null;
  btnCreateCwd: HTMLButtonElement | null;
  btnOpenCwd: HTMLButtonElement | null;
  btnResetCwd: HTMLButtonElement | null;

 // Engine / model panels
  engineBar: HTMLElement | null;
  codexModelPanel: HTMLElement | null;
  claudeCodeModelPanel: HTMLElement | null;

 // Task meta
  taskStatus: HTMLElement | null;

 // Prompt section
  promptSection: HTMLElement | null;
  promptBody: HTMLElement | null;
  promptBadge: HTMLElement | null;
  taskActionsBar: HTMLElement | null;

 // template sections
  specSection: HTMLElement | null;
  planSection: HTMLElement | null;
  goalsSection: HTMLElement | null;
  executorSection: HTMLElement | null;
  criteriaSection: HTMLElement | null;
  deliverySection: HTMLElement | null;
  deliveryBadge: HTMLElement | null;
  deliveryBody: HTMLElement | null;
  changesSection: HTMLElement | null;

 // Channel section
  channelSection: HTMLElement | null;
  channelConfigBody: HTMLElement | null;
  channelPublicUrl: HTMLInputElement | null;
  btnSaveChannelPublicUrl: HTMLButtonElement | null;
 // Lists
  channelList: HTMLElement | null;

 // Status bar
  statusDot: HTMLElement | null;
  statusLabel: HTMLElement | null;
  taskElapsed: HTMLElement | null;

 // Spec / plan badges and bodies
  specBadge: HTMLElement | null;
  specBody: HTMLElement | null;
  planBadge: HTMLElement | null;
  planBody: HTMLElement | null;

 // Goals
  goalsBadge: HTMLElement | null;
  goalsBody: HTMLElement | null;

 // Criteria / eval
  criteriaBadge: HTMLElement | null;
  criteriaList: HTMLElement | null;
  evalBody: HTMLElement | null;

 // Changes
  changesBadge: HTMLElement | null;
  changesBody: HTMLElement | null;

 // Chat
  chatGoalsStrip: HTMLElement | null;
  chatScroll: HTMLElement | null;
  chatEmpty: HTMLElement | null;

 // Chat form
  chatForm: HTMLFormElement | null;
  chatTextarea: HTMLTextAreaElement | null;
  chatAttachments: HTMLElement | null;
  btnTaskInterrupt: HTMLButtonElement | null;
  chatSend: HTMLButtonElement | null;

 // Task list panel
  taskListPanel: HTMLElement | null;
  btnCreateTask: HTMLButtonElement | null;

 // Knowledge: Memory
  memoryBadge: HTMLElement | null;
  memoryList: HTMLElement | null;
  memorySearch: HTMLInputElement | null;
  btnMemorySearch: HTMLButtonElement | null;
  btnMemoryRefresh: HTMLButtonElement | null;
  memoryDialog: HTMLDialogElement | null;
  memoryDialogTitle: HTMLElement | null;
  memoryDialogMeta: HTMLElement | null;
  memoryDialogContent: HTMLElement | null;
  btnDeleteMemory: HTMLButtonElement | null;
  btnCloseMemory: HTMLButtonElement | null;

 // Log viewer
  logDialog: HTMLDialogElement | null;
  logViewerBody: HTMLElement | null;
  logLevelFilter: HTMLSelectElement | null;
  btnLog: HTMLButtonElement | null;
  btnLogRefresh: HTMLButtonElement | null;
  btnLogCopy: HTMLButtonElement | null;
  btnLogClear: HTMLButtonElement | null;
  btnCloseLog: HTMLButtonElement | null;
  btnLogServerLogs: HTMLButtonElement | null;

}

// ── Factory ──

/**
 * Query the live DOM and return a DomRefs snapshot.
 * `document.querySelector` / `document.querySelectorAll` and may be null
 * when the corresponding element is absent from the current HTML.
 * Call this once after the HTML shell has been rendered, then pass the
 * result to code that still operates on raw DOM elements (
 * workspace helpers, interaction helpers, etc.).
 */
export function getDomRefs(): DomRefs {
  const $ = <T extends Element = Element>(sel: string): T | null =>
    document.querySelector<T>(sel);

  return {
 // Canvas / branding
    techAtlasCanvas: $<HTMLCanvasElement>("#techAtlasCanvas"),
    titlebar: $<HTMLElement>("#titlebar"),
    connBadge: $<HTMLElement>("#connBadge"),
    brandLogo: $<HTMLElement>(".brand-logo"),
    chatVersion: $<HTMLElement>("#chatVersion"),

 // Titlebar controls
    solidTitlebarMenu: $<HTMLElement>("#solidTitlebarMenu"),

 // Window controls
    btnMinimize: $<HTMLButtonElement>("#btnMinimize"),
    btnMaximize: $<HTMLButtonElement>("#btnMaximize"),
    btnClose: $<HTMLButtonElement>("#btnClose"),

 // Layout panels
    panelBody: $<HTMLElement>("#panelBody"),
    sidebar: $<HTMLElement>("#sidebar"),
    leftPaneResizer: $<HTMLElement>("#leftPaneResizer"),
    workspaceMain: $<HTMLElement>("#workspaceMain"),
    rightPaneResizer: $<HTMLElement>("#rightPaneResizer"),
    sections: $<HTMLElement>("#sections"),

 // Task / workspace
    taskDir: $<HTMLElement>("#taskDir"),
    recentDirPanel: $<HTMLElement>("#recentDirPanel"),
    btnBrowseCwd: $<HTMLButtonElement>("#btnBrowseCwd"),
    btnCreateCwd: $<HTMLButtonElement>("#btnCreateCwd"),
    btnOpenCwd: $<HTMLButtonElement>("#btnOpenCwd"),
    btnResetCwd: $<HTMLButtonElement>("#btnResetCwd"),

 // Engine / model panels
    engineBar: $<HTMLElement>("#engineBar"),
    codexModelPanel: $<HTMLElement>("#codexModelPanel"),
    claudeCodeModelPanel: $<HTMLElement>("#claudeCodeModelPanel"),

 // Task meta
    taskStatus: $<HTMLElement>("#taskStatus"),

 // Prompt section
    promptSection: $<HTMLElement>("#promptSection"),
    promptBody: $<HTMLElement>("#promptBody"),
    promptBadge: $<HTMLElement>("#promptBadge"),
    taskActionsBar: $<HTMLElement>("#taskActionsBar"),

 // template sections
    specSection: $<HTMLElement>("#specSection"),
    planSection: $<HTMLElement>("#planSection"),
    goalsSection: $<HTMLElement>("#goalsSection"),
    executorSection: $<HTMLElement>("#executorSection"),
    criteriaSection: $<HTMLElement>("#criteriaSection"),
    deliverySection: $<HTMLElement>("#deliverySection"),
    deliveryBadge: $<HTMLElement>("#deliveryBadge"),
    deliveryBody: $<HTMLElement>("#deliveryBody"),
    changesSection: $<HTMLElement>("#changesSection"),

 // Channel section
    channelSection: $<HTMLElement>("#channelSection"),
    channelConfigBody: $<HTMLElement>("#channelConfigBody"),
    channelPublicUrl: $<HTMLInputElement>("#channelPublicUrl"),
    btnSaveChannelPublicUrl: $<HTMLButtonElement>("#btnSaveChannelPublicUrl"),

 // Lists
    channelList: $<HTMLElement>("#channelList"),

 // Status bar
    statusDot: $<HTMLElement>("#statusIcon"),
    statusLabel: $<HTMLElement>("#statusLabel"),
    taskElapsed: $<HTMLElement>("#taskElapsed"),

 // Spec / plan badges and bodies
    specBadge: $<HTMLElement>("#specBadge"),
    specBody: $<HTMLElement>("#specBody"),
    planBadge: $<HTMLElement>("#planBadge"),
    planBody: $<HTMLElement>("#planBody"),

 // Goals
    goalsBadge: $<HTMLElement>("#goalsBadge"),
    goalsBody: $<HTMLElement>("#goalsBody"),

 // Criteria / eval
    criteriaBadge: $<HTMLElement>("#criteriaBadge"),
    criteriaList: $<HTMLElement>("#criteriaList"),
    evalBody: $<HTMLElement>("#evalBody"),

 // Changes
    changesBadge: $<HTMLElement>("#changesBadge"),
    changesBody: $<HTMLElement>("#changesBody"),

 // Chat
    chatGoalsStrip: $<HTMLElement>("#chatGoalsStrip"),
    chatScroll: $<HTMLElement>("#chatScroll"),
    chatEmpty: $<HTMLElement>("#chatEmpty"),

 // Chat form
    chatForm: $<HTMLFormElement>("#chatForm"),
    chatTextarea: $<HTMLTextAreaElement>("#chatTextarea"),
    chatAttachments: $<HTMLElement>("#chatAttachments"),
    btnTaskInterrupt: $<HTMLButtonElement>("#btnTaskInterrupt"),
    chatSend: $<HTMLButtonElement>("#chatSend"),

 // Task list panel
    taskListPanel: $<HTMLElement>("#taskListPanel"),
    btnCreateTask: $<HTMLButtonElement>("#btnCreateTask"),

 // Knowledge: Memory
    memoryBadge: $<HTMLElement>("#memoryBadge"),
    memoryList: $<HTMLElement>("#memoryList"),
    memorySearch: $<HTMLInputElement>("#memorySearch"),
    btnMemorySearch: $<HTMLButtonElement>("#btnMemorySearch"),
    btnMemoryRefresh: $<HTMLButtonElement>("#btnMemoryRefresh"),
    memoryDialog: $<HTMLDialogElement>("#memoryDialog"),
    memoryDialogTitle: $<HTMLElement>("#memoryDialogTitle"),
    memoryDialogMeta: $<HTMLElement>("#memoryDialogMeta"),
    memoryDialogContent: $<HTMLElement>("#memoryDialogContent"),
    btnDeleteMemory: $<HTMLButtonElement>("#btnDeleteMemory"),
    btnCloseMemory: $<HTMLButtonElement>("#btnCloseMemory"),

 // Log viewer
    logDialog: $<HTMLDialogElement>("#logDialog"),
    logViewerBody: $<HTMLElement>("#logViewerBody"),
    logLevelFilter: $<HTMLSelectElement>("#logLevelFilter"),
    btnLog: $<HTMLButtonElement>("#btnLog"),
    btnLogRefresh: $<HTMLButtonElement>("#btnLogRefresh"),
    btnLogCopy: $<HTMLButtonElement>("#btnLogCopy"),
    btnLogClear: $<HTMLButtonElement>("#btnLogClear"),
    btnCloseLog: $<HTMLButtonElement>("#btnCloseLog"),
    btnLogServerLogs: $<HTMLButtonElement>("#btnLogServerLogs"),

  };
}
