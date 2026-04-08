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
  brandVersion: HTMLElement | null;
  chatVersion: HTMLElement | null;
  chatAuthor: HTMLElement | null;

 // Titlebar controls
  btnTitlebarMenu: HTMLButtonElement | null;
  titlebarMenu: HTMLElement | null;
  btnLocale: HTMLButtonElement | null;
  btnLocaleLabel: HTMLElement | null;
  btnTheme: HTMLButtonElement | null;
  btnThemeValue: HTMLElement | null;
  btnSettings: HTMLButtonElement | null;
  btnPin: HTMLButtonElement | null;
  btnPinValue: HTMLElement | null;

 // Settings checkboxes / controls
  chkUnattended: HTMLInputElement | null;
  chkAutoPermission: HTMLInputElement | null;
  chkAutoQuestion: HTMLInputElement | null;
  chkShowTranscriptDetails: HTMLInputElement | null;
  opacityRange: HTMLInputElement | null;
  opacityValue: HTMLElement | null;

 // Window controls
  btnMinimize: HTMLButtonElement | null;
  btnMaximize: HTMLButtonElement | null;
  btnClose: HTMLButtonElement | null;

 // Layout panels
  panelBody: HTMLElement | null;
  sidebar: HTMLElement | null;
  btnSidebarToggle: HTMLButtonElement | null;
  leftPaneResizer: HTMLElement | null;
  workspaceMain: HTMLElement | null;
  rightPaneResizer: HTMLElement | null;
  sections: HTMLElement | null;

 // Task / workspace
  taskDir: HTMLElement | null;
  recentDirPanel: HTMLElement | null;
  taskWorkspaceDir: HTMLElement | null;
  taskGit: HTMLElement | null;
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
  extensionsBadge: HTMLElement | null;

 // Config dialog
  btnConfigToggle: HTMLButtonElement | null;
  configToggleMeta: HTMLElement | null;
  configDialog: HTMLDialogElement | null;
  btnCloseConfigDialog: HTMLButtonElement | null;

 // Prompt section
  promptSection: HTMLElement | null;
  promptBody: HTMLElement | null;
  promptBadge: HTMLElement | null;
  taskActionsBar: HTMLElement | null;

 // PRD sections
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
  cfgAvailableProviders: HTMLElement | null;

 // Lists
  channelList: HTMLElement | null;
  skillList: HTMLElement | null;
  btnSkillMarket: HTMLButtonElement | null;
  btnOpenSkillRoot: HTMLButtonElement | null;
  btnReloadSkills: HTMLButtonElement | null;
  btnDeleteAllSkills: HTMLButtonElement | null;
  mcpList: HTMLElement | null;
  btnAddSkill: HTMLButtonElement | null;
  btnAddMcp: HTMLButtonElement | null;
  btnDeleteAllMcp: HTMLButtonElement | null;

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

 // Budget
  budgetConfigBody: HTMLElement | null;
  budgetHint: HTMLElement | null;
  budgetMaxRuns: HTMLInputElement | null;
  budgetMaxReplans: HTMLInputElement | null;
  btnBudgetReset: HTMLButtonElement | null;
  btnBudgetSave: HTMLButtonElement | null;

 // Changes
  changesBadge: HTMLElement | null;
  changesBody: HTMLElement | null;

 // Chat
  chatGoalsStrip: HTMLElement | null;
  chatScroll: HTMLElement | null;
  chatEmpty: HTMLElement | null;
  chatCount: HTMLElement | null;
  btnChatCopyAll: HTMLButtonElement | null;
  chatTabs: HTMLElement | null;
  tabControl: HTMLElement | null;
  tabCoding: HTMLElement | null;
  codingScroll: HTMLElement | null;
  codingEmpty: HTMLElement | null;

 // Chat form
  chatForm: HTMLFormElement | null;
  chatTextarea: HTMLTextAreaElement | null;
  chatAttachments: HTMLElement | null;
  chatFileInput: HTMLInputElement | null;
  btnChatAttach: HTMLButtonElement | null;
  btnTaskInterrupt: HTMLButtonElement | null;
  chatSend: HTMLButtonElement | null;

 // Task list panel
  taskListPanel: HTMLElement | null;
  btnRefreshTasks: HTMLButtonElement | null;
  btnCreateTask: HTMLButtonElement | null;

 // Skill dialog
  skillDialog: HTMLDialogElement | null;
  skillForm: HTMLFormElement | null;
  skillType: HTMLSelectElement | null;
  skillValue: HTMLInputElement | null;
  skillPolicy: HTMLSelectElement | null;
  btnPickSkillPath: HTMLButtonElement | null;
  btnCancelSkill: HTMLButtonElement | null;

 // Skill market dialog
  skillMarketDialog: HTMLDialogElement | null;
  skillMarketList: HTMLElement | null;
  btnCloseSkillMarket: HTMLButtonElement | null;

 // MCP dialog
  mcpDialog: HTMLDialogElement | null;
  mcpForm: HTMLFormElement | null;
  mcpName: HTMLInputElement | null;
  mcpType: HTMLSelectElement | null;
  mcpUrl: HTMLInputElement | null;
  mcpCommand: HTMLInputElement | null;
  mcpArgs: HTMLInputElement | null;
  mcpRemoteField: HTMLElement | null;
  mcpCommandField: HTMLElement | null;
  mcpArgsField: HTMLElement | null;
  btnCancelMcp: HTMLButtonElement | null;

 // Goal dialog
  goalDialog: HTMLDialogElement | null;
  goalForm: HTMLFormElement | null;
  goalDialogTitle: HTMLElement | null;
  goalId: HTMLInputElement | null;
  goalDescription: HTMLTextAreaElement | null;
  goalCriteria: HTMLTextAreaElement | null;
  btnCancelGoal: HTMLButtonElement | null;

 // Diff dialog
  diffDialog: HTMLDialogElement | null;
  diffDialogTitle: HTMLElement | null;
  diffDialogMeta: HTMLElement | null;
  diffDialogBody: HTMLElement | null;
  btnCloseDiff: HTMLButtonElement | null;

 // Generic app dialog
  appDialog: HTMLDialogElement | null;
  appDialogTitle: HTMLElement | null;
  appDialogBody: HTMLElement | null;
  appDialogInputField: HTMLElement | null;
  appDialogInputLabel: HTMLElement | null;
  appDialogInput: HTMLInputElement | null;
  appDialogSelectField: HTMLElement | null;
  appDialogSelectLabel: HTMLElement | null;
  appDialogSelect: HTMLSelectElement | null;
  btnAppDialogCancel: HTMLButtonElement | null;
  btnAppDialogOk: HTMLButtonElement | null;

 // LLM form
  llmForm: HTMLFormElement | null;
  llmSection: HTMLElement | null;
  llmAdvanced: HTMLElement | null;
  llmSummary: HTMLElement | null;
  llmProvider: HTMLSelectElement | null;
  llmModel: HTMLInputElement | null;
  llmApiKey: HTMLInputElement | null;
  llmApiKeySummary: HTMLElement | null;
  btnLlmApiKeyToggle: HTMLButtonElement | null;
  btnLlmApiKeyCopy: HTMLButtonElement | null;
  btnLlmAuthAction: HTMLButtonElement | null;
  llmStatus: HTMLElement | null;
  llmNotice: HTMLElement | null;

 // Channel dialog
  channelDialog: HTMLDialogElement | null;
  channelForm: HTMLFormElement | null;
  channelDialogTitle: HTMLElement | null;
  channelId: HTMLInputElement | null;
  channelFields: HTMLElement | null;
  btnCancelChannel: HTMLButtonElement | null;

 // Settings dialog
  settingsDialog: HTMLDialogElement | null;
  settingsForm: HTMLFormElement | null;
  serverUrl: HTMLInputElement | null;
  serverPassword: HTMLInputElement | null;
  serverUsername: HTMLInputElement | null;
  localeMode: HTMLSelectElement | null;
  themeMode: HTMLSelectElement | null;

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
    brandVersion: $<HTMLElement>("#brandVersion"),
    chatVersion: $<HTMLElement>("#chatVersion"),
    chatAuthor: $<HTMLElement>("#chatAuthor"),

 // Titlebar controls
    btnTitlebarMenu: $<HTMLButtonElement>("#btnTitlebarMenu"),
    titlebarMenu: $<HTMLElement>("#titlebarMenu"),
    btnLocale: $<HTMLButtonElement>("#btnLocale"),
    btnLocaleLabel: $<HTMLElement>("#btnLocaleLabel"),
    btnTheme: $<HTMLButtonElement>("#btnTheme"),
    btnThemeValue: $<HTMLElement>("#btnThemeValue"),
    btnSettings: $<HTMLButtonElement>("#btnSettings"),
    btnPin: $<HTMLButtonElement>("#btnPin"),
    btnPinValue: $<HTMLElement>("#btnPinValue"),

 // Settings checkboxes / controls
    chkUnattended: $<HTMLInputElement>("#chkUnattended"),
    chkAutoPermission: $<HTMLInputElement>("#chkAutoPermission"),
    chkAutoQuestion: $<HTMLInputElement>("#chkAutoQuestion"),
    chkShowTranscriptDetails: $<HTMLInputElement>("#chkShowTranscriptDetails"),
    opacityRange: $<HTMLInputElement>("#opacityRange"),
    opacityValue: $<HTMLElement>("#opacityValue"),

 // Window controls
    btnMinimize: $<HTMLButtonElement>("#btnMinimize"),
    btnMaximize: $<HTMLButtonElement>("#btnMaximize"),
    btnClose: $<HTMLButtonElement>("#btnClose"),

 // Layout panels
    panelBody: $<HTMLElement>("#panelBody"),
    sidebar: $<HTMLElement>("#sidebar"),
    btnSidebarToggle: $<HTMLButtonElement>("#btnSidebarToggle"),
    leftPaneResizer: $<HTMLElement>("#leftPaneResizer"),
    workspaceMain: $<HTMLElement>("#workspaceMain"),
    rightPaneResizer: $<HTMLElement>("#rightPaneResizer"),
    sections: $<HTMLElement>("#sections"),

 // Task / workspace
    taskDir: $<HTMLElement>("#taskDir"),
    recentDirPanel: $<HTMLElement>("#recentDirPanel"),
    taskWorkspaceDir: $<HTMLElement>("#taskWorkspaceDir"),
    taskGit: $<HTMLElement>("#taskGit"),
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
    extensionsBadge: $<HTMLElement>("#extensionsBadge"),

 // Config dialog
    btnConfigToggle: $<HTMLButtonElement>("#btnConfigToggle"),
    configToggleMeta: $<HTMLElement>("#configToggleMeta"),
    configDialog: $<HTMLDialogElement>("#configDialog"),
    btnCloseConfigDialog: $<HTMLButtonElement>("#btnCloseConfigDialog"),

 // Prompt section
    promptSection: $<HTMLElement>("#promptSection"),
    promptBody: $<HTMLElement>("#promptBody"),
    promptBadge: $<HTMLElement>("#promptBadge"),
    taskActionsBar: $<HTMLElement>("#taskActionsBar"),

 // PRD sections
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
    cfgAvailableProviders: $<HTMLElement>("#cfgAvailableProviders"),

 // Lists
    channelList: $<HTMLElement>("#channelList"),
    skillList: $<HTMLElement>("#skillList"),
    btnSkillMarket: $<HTMLButtonElement>("#btnSkillMarket"),
    btnOpenSkillRoot: $<HTMLButtonElement>("#btnOpenSkillRoot"),
    btnReloadSkills: $<HTMLButtonElement>("#btnReloadSkills"),
    btnDeleteAllSkills: $<HTMLButtonElement>("#btnDeleteAllSkills"),
    mcpList: $<HTMLElement>("#mcpList"),
    btnAddSkill: $<HTMLButtonElement>("#btnAddSkill"),
    btnAddMcp: $<HTMLButtonElement>("#btnAddMcp"),
    btnDeleteAllMcp: $<HTMLButtonElement>("#btnDeleteAllMcp"),

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

 // Budget
    budgetConfigBody: $<HTMLElement>("#budgetConfigBody"),
    budgetHint: $<HTMLElement>("#budgetHint"),
    budgetMaxRuns: $<HTMLInputElement>("#budgetMaxRuns"),
    budgetMaxReplans: $<HTMLInputElement>("#budgetMaxReplans"),
    btnBudgetReset: $<HTMLButtonElement>("#btnBudgetReset"),
    btnBudgetSave: $<HTMLButtonElement>("#btnBudgetSave"),

 // Changes
    changesBadge: $<HTMLElement>("#changesBadge"),
    changesBody: $<HTMLElement>("#changesBody"),

 // Chat
    chatGoalsStrip: $<HTMLElement>("#chatGoalsStrip"),
    chatScroll: $<HTMLElement>("#chatScroll"),
    chatEmpty: $<HTMLElement>("#chatEmpty"),
    chatCount: $<HTMLElement>("#chatCount"),
    btnChatCopyAll: $<HTMLButtonElement>("#btnChatCopyAll"),
    chatTabs: $<HTMLElement>("#chatTabs"),
    tabControl: $<HTMLElement>("#tabControl"),
    tabCoding: $<HTMLElement>("#tabCoding"),
    codingScroll: $<HTMLElement>("#codingScroll"),
    codingEmpty: $<HTMLElement>("#codingEmpty"),

 // Chat form
    chatForm: $<HTMLFormElement>("#chatForm"),
    chatTextarea: $<HTMLTextAreaElement>("#chatTextarea"),
    chatAttachments: $<HTMLElement>("#chatAttachments"),
    chatFileInput: $<HTMLInputElement>("#chatFileInput"),
    btnChatAttach: $<HTMLButtonElement>("#btnChatAttach"),
    btnTaskInterrupt: $<HTMLButtonElement>("#btnTaskInterrupt"),
    chatSend: $<HTMLButtonElement>("#chatSend"),

 // Task list panel
    taskListPanel: $<HTMLElement>("#taskListPanel"),
    btnRefreshTasks: $<HTMLButtonElement>("#btnRefreshTasks"),
    btnCreateTask: $<HTMLButtonElement>("#btnCreateTask"),

 // Skill dialog
    skillDialog: $<HTMLDialogElement>("#skillDialog"),
    skillForm: $<HTMLFormElement>("#skillForm"),
    skillType: $<HTMLSelectElement>("#skillType"),
    skillValue: $<HTMLInputElement>("#skillValue"),
    skillPolicy: $<HTMLSelectElement>("#skillPolicy"),
    btnPickSkillPath: $<HTMLButtonElement>("#btnPickSkillPath"),
    btnCancelSkill: $<HTMLButtonElement>("#btnCancelSkill"),

 // Skill market dialog
    skillMarketDialog: $<HTMLDialogElement>("#skillMarketDialog"),
    skillMarketList: $<HTMLElement>("#skillMarketList"),
    btnCloseSkillMarket: $<HTMLButtonElement>("#btnCloseSkillMarket"),

 // MCP dialog
    mcpDialog: $<HTMLDialogElement>("#mcpDialog"),
    mcpForm: $<HTMLFormElement>("#mcpForm"),
    mcpName: $<HTMLInputElement>("#mcpName"),
    mcpType: $<HTMLSelectElement>("#mcpType"),
    mcpUrl: $<HTMLInputElement>("#mcpUrl"),
    mcpCommand: $<HTMLInputElement>("#mcpCommand"),
    mcpArgs: $<HTMLInputElement>("#mcpArgs"),
    mcpRemoteField: $<HTMLElement>("#mcpRemoteField"),
    mcpCommandField: $<HTMLElement>("#mcpCommandField"),
    mcpArgsField: $<HTMLElement>("#mcpArgsField"),
    btnCancelMcp: $<HTMLButtonElement>("#btnCancelMcp"),

 // Goal dialog
    goalDialog: $<HTMLDialogElement>("#goalDialog"),
    goalForm: $<HTMLFormElement>("#goalForm"),
    goalDialogTitle: $<HTMLElement>("#goalDialogTitle"),
    goalId: $<HTMLInputElement>("#goalId"),
    goalDescription: $<HTMLTextAreaElement>("#goalDescription"),
    goalCriteria: $<HTMLTextAreaElement>("#goalCriteria"),
    btnCancelGoal: $<HTMLButtonElement>("#btnCancelGoal"),

 // Diff dialog
    diffDialog: $<HTMLDialogElement>("#diffDialog"),
    diffDialogTitle: $<HTMLElement>("#diffDialogTitle"),
    diffDialogMeta: $<HTMLElement>("#diffDialogMeta"),
    diffDialogBody: $<HTMLElement>("#diffDialogBody"),
    btnCloseDiff: $<HTMLButtonElement>("#btnCloseDiff"),

 // Generic app dialog
    appDialog: $<HTMLDialogElement>("#appDialog"),
    appDialogTitle: $<HTMLElement>("#appDialogTitle"),
    appDialogBody: $<HTMLElement>("#appDialogBody"),
    appDialogInputField: $<HTMLElement>("#appDialogInputField"),
    appDialogInputLabel: $<HTMLElement>("#appDialogInputLabel"),
    appDialogInput: $<HTMLInputElement>("#appDialogInput"),
    appDialogSelectField: $<HTMLElement>("#appDialogSelectField"),
    appDialogSelectLabel: $<HTMLElement>("#appDialogSelectLabel"),
    appDialogSelect: $<HTMLSelectElement>("#appDialogSelect"),
    btnAppDialogCancel: $<HTMLButtonElement>("#btnAppDialogCancel"),
    btnAppDialogOk: $<HTMLButtonElement>("#btnAppDialogOk"),

 // LLM form
    llmForm: $<HTMLFormElement>("#llmForm"),
    llmSection: $<HTMLElement>("#llmSection"),
    llmAdvanced: $<HTMLElement>("#llmAdvanced"),
    llmSummary: $<HTMLElement>("#llmSummary"),
    llmProvider: $<HTMLSelectElement>("#llmProvider"),
    llmModel: $<HTMLInputElement>("#llmModel"),
    llmApiKey: $<HTMLInputElement>("#llmApiKey"),
    llmApiKeySummary: $<HTMLElement>("#llmApiKeySummary"),
    btnLlmApiKeyToggle: $<HTMLButtonElement>("#btnLlmApiKeyToggle"),
    btnLlmApiKeyCopy: $<HTMLButtonElement>("#btnLlmApiKeyCopy"),
    btnLlmAuthAction: $<HTMLButtonElement>("#btnLlmAuthAction"),
    llmStatus: $<HTMLElement>("#llmStatus"),
    llmNotice: $<HTMLElement>("#llmNotice"),

 // Channel dialog
    channelDialog: $<HTMLDialogElement>("#channelDialog"),
    channelForm: $<HTMLFormElement>("#channelForm"),
    channelDialogTitle: $<HTMLElement>("#channelDialogTitle"),
    channelId: $<HTMLInputElement>("#channelId"),
    channelFields: $<HTMLElement>("#channelFields"),
    btnCancelChannel: $<HTMLButtonElement>("#btnCancelChannel"),

 // Settings dialog
    settingsDialog: $<HTMLDialogElement>("#settingsDialog"),
    settingsForm: $<HTMLFormElement>("#settingsForm"),
    serverUrl: $<HTMLInputElement>("#serverUrl"),
    serverPassword: $<HTMLInputElement>("#serverPassword"),
    serverUsername: $<HTMLInputElement>("#serverUsername"),
    localeMode: $<HTMLSelectElement>("#localeMode"),
    themeMode: $<HTMLSelectElement>("#themeMode"),

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
