// Copied from OpenCode's home route shell and adapted to OpenCorvus prompt/route state.
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { CompactLogo, Logo } from "../component/logo"
import { BgPulse } from "../component/bg-pulse"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiConfig } from "../context/tui-config"

let once = false
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const compactDensity = createMemo(() => dimensions().height < 34 || dimensions().width < 112)
  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    if (configured === "auto") return Math.max(75, Math.floor(dimensions().width * (compactDensity() ? 0.88 : 0.7)))
    if (configured) return configured
    if (compactDensity()) return Math.max(75, Math.min(96, dimensions().width - 8))
    return 75
  })
  let sent = false

  const bind = (prompt: PromptRef | undefined) => {
    setRef(prompt)
    promptRef.set(prompt)
    if (once || !prompt) return
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
      <box width="100%" flexGrow={1} flexDirection="column" alignItems="center" paddingLeft={2} paddingRight={2}>
        <box height={compactDensity() ? 1 : 2} minHeight={0} flexShrink={0} />
        <Show
          when={compactDensity()}
          fallback={
            <box flexShrink={0} position="relative" width="100%" height={9} alignItems="center" justifyContent="center">
              <TuiPluginRuntime.Slot name="home_logo" mode="replace">
                <box position="absolute" top={0} left={0} right={0} bottom={0} zIndex={0}>
                  <BgPulse />
                </box>
                <box zIndex={1}>
                  <Logo />
                </box>
              </TuiPluginRuntime.Slot>
            </box>
          }
        >
          <box width="100%" maxWidth={promptMaxWidth()} flexShrink={0} flexDirection="row">
            <TuiPluginRuntime.Slot name="home_logo" mode="replace">
              <CompactLogo />
            </TuiPluginRuntime.Slot>
          </box>
        </Show>
        <box flexGrow={compactDensity() ? 1 : 0} height={compactDensity() ? 0 : 1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={promptMaxWidth()} zIndex={1000} paddingTop={1} flexShrink={0}>
          <TuiPluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
            <Prompt
              ref={bind}
              right={<TuiPluginRuntime.Slot name="home_prompt_right" />}
              placeholders={placeholder}
              density={compactDensity() ? "compact" : "default"}
            />
          </TuiPluginRuntime.Slot>
        </box>
        <TuiPluginRuntime.Slot name="home_bottom" />
        <box height={1} minHeight={0} flexShrink={0} />
        <Toast />
      </box>
      <box width="100%" flexShrink={0}>
        <TuiPluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </>
  )
}
