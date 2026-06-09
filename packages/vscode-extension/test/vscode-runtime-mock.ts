import * as path from "node:path"

export interface VscodeRuntimeMockState {
  createdPanel: any
  activeColorThemeKind: number
  colorThemeListeners: Array<(theme: { kind: number }) => void>
  openDialogResult: Array<{ fsPath: string }> | undefined
  fileTypes: Map<string, number>
  openExternal: unknown[]
  showOpenDialog: unknown[]
  executeCommand: unknown[]
  information: string[]
}

export const vscodeMockState: VscodeRuntimeMockState = {
  createdPanel: undefined,
  activeColorThemeKind: 2,
  colorThemeListeners: [],
  openDialogResult: undefined,
  fileTypes: new Map(),
  openExternal: [],
  showOpenDialog: [],
  executeCommand: [],
  information: [],
}

export function resetVsCodeRuntimeMock(): void {
  vscodeMockState.createdPanel = undefined
  vscodeMockState.activeColorThemeKind = 2
  vscodeMockState.colorThemeListeners = []
  vscodeMockState.openDialogResult = undefined
  vscodeMockState.fileTypes.clear()
  vscodeMockState.openExternal.length = 0
  vscodeMockState.showOpenDialog.length = 0
  vscodeMockState.executeCommand.length = 0
  vscodeMockState.information.length = 0
}

export const vscodeRuntimeMock = {
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  FileType: { File: 1, Directory: 2 },
  ViewColumn: { Beside: 2 },
  Uri: {
    parse(value: string) {
      return { value, fsPath: value, toString: () => value }
    },
    file(fsPath: string) {
      return { fsPath, toString: () => `file://${fsPath}` }
    },
    joinPath(base: any, ...parts: string[]) {
      const root = base.fsPath ?? String(base)
      const fsPath = path.join(root, ...parts)
      return { fsPath, toString: () => fsPath }
    },
  },
  env: {
    language: "en-US",
    async openExternal(uri: unknown) {
      vscodeMockState.openExternal.push(uri)
      return true
    },
  },
  window: {
    activeColorTheme: {
      get kind() {
        return vscodeMockState.activeColorThemeKind
      },
    },
    onDidChangeActiveColorTheme(cb: (theme: { kind: number }) => void) {
      vscodeMockState.colorThemeListeners.push(cb)
      return {
        dispose() {
          vscodeMockState.colorThemeListeners = vscodeMockState.colorThemeListeners.filter(
            (listener) => listener !== cb,
          )
        },
      }
    },
    createWebviewPanel(_viewType: string, title: string, viewColumn: number, options: unknown) {
      const disposers: Array<() => void> = []
      let htmlAssignments = 0
      const postedMessages: any[] = []
      const webview = {
        cspSource: "vscode-webview://test-source",
        _html: "",
        get html() {
          return this._html
        },
        set html(value: string) {
          this._html = value
          htmlAssignments += 1
        },
        asWebviewUri(uri: any) {
          return { toString: () => `https://test-cdn/${encodeURIComponent(uri.fsPath)}` }
        },
        onDidReceiveMessage() {
          return { dispose() {} }
        },
        postMessage(m: unknown) {
          postedMessages.push(m)
          return Promise.resolve(true)
        },
      }
      vscodeMockState.createdPanel = {
        title,
        viewColumn,
        options,
        webview,
        get htmlAssignments() {
          return htmlAssignments
        },
        get postedMessages() {
          return postedMessages
        },
        reveal() {},
        dispose() {
          for (const dispose of disposers.splice(0)) dispose()
        },
        onDidDispose(cb: () => void) {
          disposers.push(cb)
          return { dispose() {} }
        },
      }
      return vscodeMockState.createdPanel
    },
    async showOpenDialog(options: unknown) {
      vscodeMockState.showOpenDialog.push(options)
      return vscodeMockState.openDialogResult
    },
    async showInformationMessage(message: string) {
      vscodeMockState.information.push(message)
      return undefined
    },
  },
  workspace: {
    fs: {
      async stat(uri: { fsPath: string }) {
        const type = vscodeMockState.fileTypes.get(uri.fsPath)
        if (!type) throw new Error(`missing ${uri.fsPath}`)
        return { type }
      },
    },
  },
  commands: {
    async executeCommand(command: string, ...args: unknown[]) {
      vscodeMockState.executeCommand.push([command, ...args])
      return undefined
    },
  },
}
