// Copied from OpenCode's home route shell and adapted to OpenCorvus prompt/route state.
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createSignal, onMount } from "solid-js"
import { Logo } from "../component/logo"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"

let once = false

export function Home() {
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  let sent = false

  const bind = (prompt: PromptRef) => {
    setRef(prompt)
    promptRef.set(prompt)
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
      return
    }
    if (!args.prompt) return
    prompt.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store readiness before auto-submitting --prompt.
  createEffect(() => {
    const prompt = ref()
    if (sent) return
    if (!prompt) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (prompt.current.input !== args.prompt) return
    sent = true
    prompt.submit()
  })

  onMount(() => {
    const prompt = ref()
    if (!prompt) return
    if (!args.prompt) return
    if (sent) return
    if (!sync.ready || !local.model.ready) return
    sent = true
    prompt.submit()
  })

  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={4} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>
          <TuiPluginRuntime.Slot name="home_logo" mode="replace">
            <Logo />
          </TuiPluginRuntime.Slot>
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
          <TuiPluginRuntime.Slot name="home_prompt" mode="replace" ref={bind as never}>
            <Prompt ref={bind} />
          </TuiPluginRuntime.Slot>
        </box>
        <TuiPluginRuntime.Slot name="home_bottom" />
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box width="100%" flexShrink={0}>
        <TuiPluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </>
  )
}
