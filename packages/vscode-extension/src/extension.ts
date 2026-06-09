import * as vscode from "vscode"
import { resolveBundledBinary } from "./sidecar/binary-resolver"
import { startSidecar, type SidecarHandle } from "./sidecar/manager"
import { SidecarStartupError, SidecarExistingInstanceError, UnsupportedPlatformError } from "./sidecar/errors"
import { OpencorvusPanel } from "./webview/panel"
import { runAttachFileCommand } from "./commands/attach-file"

let outputChannel: vscode.OutputChannel | undefined
let activeSidecar: SidecarHandle | undefined
/** Track an in-flight start so two near-simultaneous opens share one sidecar. */
let pendingStart: Promise<SidecarHandle> | undefined

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("OpenCorvus")
  context.subscriptions.push(outputChannel)

  context.subscriptions.push(
    vscode.commands.registerCommand("opencorvus.open", () => withErrorReporting(() => openCommand(context))),
    vscode.commands.registerCommand("opencorvus.attachFile", () =>
      withErrorReporting(() =>
        runAttachFileCommand({
          ensureSidecar: async () => {
            const sidecar = await ensureSidecar(context)
            OpencorvusPanel.show(context, sidecar)
          },
        }),
      ),
    ),
  )

  context.subscriptions.push({ dispose: () => disposeActiveSidecar() })
}

export function deactivate(): Thenable<void> | void {
  return disposeActiveSidecar()
}

async function openCommand(context: vscode.ExtensionContext): Promise<void> {
  const sidecar = await ensureSidecar(context)
  OpencorvusPanel.show(context, sidecar)
}

async function ensureSidecar(context: vscode.ExtensionContext): Promise<SidecarHandle> {
  if (activeSidecar) return activeSidecar
  if (pendingStart) return pendingStart

  const workspace = pickWorkspaceFolder()
  if (!workspace) {
    throw new SidecarStartupError(
      "OpenCorvus needs an open workspace folder. Open a folder first, then run OpenCorvus: Open Panel.",
    )
  }

  pendingStart = (async () => {
    const binary = resolveBundledBinary({ extensionRoot: context.extensionPath })
    log(`resolved binary target=${binary.target}`)
    const sidecar = await startSidecar({
      binary,
      workspace,
      log: (line) => log(line),
    })
    sidecar.onExit((code, signal) => {
      log(`sidecar exited code=${code ?? "null"} signal=${signal ?? "null"}`)
      if (activeSidecar === sidecar) activeSidecar = undefined
      vscode.window.showWarningMessage(
        `OpenCorvus sidecar exited (code=${code ?? "?"}). Run "OpenCorvus: Open Panel" to restart.`,
      )
    })
    activeSidecar = sidecar
    return sidecar
  })().finally(() => {
    pendingStart = undefined
  })

  return pendingStart
}

function pickWorkspaceFolder(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return undefined
  // Multi-root not in scope for M1/M2: take the first folder. Plan
  // §19.1.1 single-owner sidecar policy is workspace-scoped, so a
  // multi-root workspace currently maps to one sidecar at the first
  // folder. Revisit once §18.7 spike落决策.
  return folders[0]!.uri.fsPath
}

async function disposeActiveSidecar(): Promise<void> {
  const sidecar = activeSidecar
  activeSidecar = undefined
  pendingStart = undefined
  if (sidecar) {
    try {
      await sidecar.stop()
    } catch (e) {
      log(`sidecar.stop threw: ${String(e)}`)
    }
  }
}

async function withErrorReporting<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    reportError(err)
    return undefined
  }
}

function reportError(err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err))
  log(`error: ${e.name}: ${e.message}`)
  if (e instanceof SidecarExistingInstanceError) {
    vscode.window.showErrorMessage(`OpenCorvus: ${e.message}. Stop the other instance, then try again.`)
    return
  }
  if (e instanceof UnsupportedPlatformError) {
    vscode.window.showErrorMessage(
      `OpenCorvus: ${e.message} — install the matching platform-specific VSIX in this extension host.`,
    )
    return
  }
  vscode.window.showErrorMessage(`OpenCorvus failed to start sidecar: ${e.message}`)
}

function log(line: string): void {
  if (!outputChannel) return
  const ts = new Date().toISOString()
  outputChannel.appendLine(`[${ts}] ${line}`)
}
