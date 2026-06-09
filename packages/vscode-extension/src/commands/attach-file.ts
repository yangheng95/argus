import * as path from "node:path"
import * as vscode from "vscode"
import type { ComposerAttachPayload } from "@opencorvus-ai/transport-protocol"
import { OpencorvusPanel } from "../webview/panel"
import { MAX_ATTACH_BYTES, guessMime } from "./attach-file-helpers"

/**
 * `opencorvus.attachFile` command (plan §19.2.6).
 *
 * Reads the file the user is currently editing, pushes it onto the
 * webview composer's pending-attachment list via a `composer.attach`
 * ui-command, and reveals the panel. The user must still hit "send"
 * for the attachment to leave the client — this command never
 * fabricates a user message (CLAUDE.md §一-15).
 *
 * The full file content is sent (not a slice). Selection metadata is
 * attached for traceability so the message stream can show "user
 * attached foo.ts L10–L20" once the message is submitted, but the
 * server still receives the whole file. Slicing is a server-side
 * decision; the client doesn't pre-empt it.
 */

type ResolveSidecar = () => Promise<unknown>

export interface AttachFileDeps {
  /** Lazy: ensures the sidecar is up so the panel exists. */
  ensureSidecar: ResolveSidecar
}

export async function runAttachFileCommand(deps: AttachFileDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    void vscode.window.showInformationMessage(
      'OpenCorvus: open a file in the editor first, then run "OpenCorvus: Attach Current File".',
    )
    return
  }
  const uri = editor.document.uri
  if (uri.scheme !== "file") {
    void vscode.window.showWarningMessage(
      `OpenCorvus: attaching "${uri.scheme}:" documents is not supported (only on-disk files).`,
    )
    return
  }
  // Ensure sidecar + panel are live; the panel is required to receive
  // the ui-command. ensureSidecar is provided by extension.ts and
  // resolves to the sidecar handle, but we do not need it here.
  await deps.ensureSidecar()
  const panel = OpencorvusPanel.current
  if (!panel) {
    void vscode.window.showErrorMessage('OpenCorvus: panel is not open — run "OpenCorvus: Open Panel" first.')
    return
  }

  let bytes: Uint8Array
  try {
    bytes = await vscode.workspace.fs.readFile(uri)
  } catch (err) {
    void vscode.window.showErrorMessage(
      `OpenCorvus: cannot read ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  if (bytes.byteLength > MAX_ATTACH_BYTES) {
    void vscode.window.showWarningMessage(
      `OpenCorvus: ${path.basename(uri.fsPath)} exceeds the ${MAX_ATTACH_BYTES} byte attachment limit.`,
    )
    return
  }

  const filename = path.basename(uri.fsPath)
  const mime = guessMime(filename, editor.document.languageId)
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
  const sel = editor.selection
  const selection = sel.isEmpty
    ? undefined
    : {
        startLine: sel.start.line,
        startColumn: sel.start.character,
        endLine: sel.end.line,
        endColumn: sel.end.character,
      }
  const payload: ComposerAttachPayload = {
    filename,
    mime,
    dataUrl,
    sourcePath: uri.fsPath,
    selection,
  }
  panel.sendUiCommand("composer.attach", payload)
  panel.reveal()
}
