import { basicSetup, EditorView } from "codemirror"
import { createEffect, onCleanup, onMount, splitProps, type JSX } from "solid-js"

export interface CodeEditorProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList" | "onChange"> {
  value: string
  ariaLabel: string
  onValueChange: (value: string) => void
}

export function CodeEditor(props: CodeEditorProps): JSX.Element {
  const [local, rest] = splitProps(props, ["value", "ariaLabel", "onValueChange"])
  let host: HTMLDivElement | undefined
  let view: EditorView | undefined
  let applyingExternalValue = false

  onMount(() => {
    if (!host) return
    view = new EditorView({
      doc: local.value,
      parent: host,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": local.ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingExternalValue) return
          local.onValueChange(update.state.doc.toString())
        }),
      ],
    })
  })

  createEffect(() => {
    const next = local.value
    const editor = view
    if (!editor) return
    const current = editor.state.doc.toString()
    if (next === current) return
    applyingExternalValue = true
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: next,
      },
    })
    applyingExternalValue = false
  })

  onCleanup(() => {
    view?.destroy()
    view = undefined
  })

  return (
    <div
      {...rest}
      class="file-editor-code"
      ref={(node) => {
        host = node
      }}
    />
  )
}
