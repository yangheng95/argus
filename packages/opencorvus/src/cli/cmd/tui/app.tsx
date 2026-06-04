import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Clipboard } from "@tui/util/clipboard"
import { Selection } from "@tui/util/selection"
import { MouseButton, TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  untrack,
  ErrorBoundary,
  createSignal,
  onMount,
  batch,
  on,
  onCleanup,
  type JSX,
} from "solid-js"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "./win32"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel, useConnected } from "@tui/component/dialog-model"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { CommandPaletteDialog } from "@tui/component/command-palette"
import { DialogAgent } from "@tui/component/dialog-agent"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { writeHeapSnapshot } from "v8"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider, useTuiConfig } from "./context/tui-config"
import { TuiConfig } from "@/config/tui"
import {
  COMMAND_PALETTE_COMMAND,
  OPENCORVUS_BASE_MODE,
  OpencorvusKeymapProvider,
  registerOpencorvusKeymap,
  useBindings,
  useOpencorvusKeymap,
} from "./keymap"
import { createTuiApi, type RouteMap } from "./plugin/api"
import { TuiPluginRuntime } from "./plugin/runtime"
import type { TuiAttention } from "@opencorvus-ai/plugin/tui"

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  // can't set raw mode if not a TTY
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        // Parse RGB values from color string
        // Formats: rgb:RR/GG/BB or #RRGGBB or rgb(R,G,B)
        let r = 0,
          g = 0,
          b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8 // Convert 16-bit to 8-bit
          g = parseInt(parts[1], 16) >> 8 // Convert 16-bit to 8-bit
          b = parseInt(parts[2], 16) >> 8 // Convert 16-bit to 8-bit
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        } else if (color.startsWith("rgb(")) {
          const parts = color.substring(4, color.length - 1).split(",")
          r = parseInt(parts[0])
          g = parseInt(parts[1])
          b = parseInt(parts[2])
        }

        // Calculate luminance using relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        // Determine if dark or light based on luminance threshold
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
}

import type { EventSource } from "./context/sdk"

const appGlobalBindingCommands = [
  "session.list",
  "session.new",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "provider.connect",
  "opencorvus.status",
  "theme.switch",
  "theme.switch_mode",
  "help.show",
  "docs.open",
  "app.debug",
  "app.console",
  "app.heap_snapshot",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.diffwrap",
] as const

function TuiKeymapRoot(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const config = useTuiConfig()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const unregister = registerOpencorvusKeymap(keymap, renderer, config)
  onCleanup(unregister)

  return <OpencorvusKeymapProvider keymap={keymap}>{props.children}</OpencorvusKeymapProvider>
}

export function tui(input: {
  url: string
  args: Args
  config: TuiConfig.Resolved
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
  onExit?: () => Promise<void>
}) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const unguard = win32InstallCtrlCGuard()
    win32DisableProcessedInput()

    const mode = await getTerminalBackgroundColor()

    // Re-clear after getTerminalBackgroundColor() — setRawMode(false) restores
    // the original console mode which re-enables ENABLE_PROCESSED_INPUT.
    win32DisableProcessedInput()

    const onExit = async () => {
      unguard?.()
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary
            fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} mode={mode} />}
          >
            <ArgsProvider {...input.args}>
              <ExitProvider onExit={onExit}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <TuiConfigProvider config={input.config}>
                        <TuiKeymapRoot>
                          <SDKProvider
                            url={input.url}
                            directory={input.directory}
                            fetch={input.fetch}
                            headers={input.headers}
                            events={input.events}
                          >
                            <SyncProvider>
                              <ThemeProvider mode={mode}>
                                <LocalProvider>
                                  <PromptStashProvider>
                                    <DialogProvider>
                                      <FrecencyProvider>
                                        <PromptHistoryProvider>
                                          <PromptRefProvider>
                                            <App />
                                          </PromptRefProvider>
                                        </PromptHistoryProvider>
                                      </FrecencyProvider>
                                    </DialogProvider>
                                  </PromptStashProvider>
                                </LocalProvider>
                              </ThemeProvider>
                            </SyncProvider>
                          </SDKProvider>
                        </TuiKeymapRoot>
                      </TuiConfigProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        autoFocus: false,
        openConsoleOnError: false,
        consoleOptions: {
          keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
          onCopySelection: (text) => {
            Clipboard.copy(text).catch((error) => {
              console.error(`Failed to copy console selection to clipboard: ${error}`)
            })
          },
        },
      },
    )
  })
}

function App() {
  const tuiConfig = useTuiConfig()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const keymap = useOpencorvusKeymap()
  const sdk = useSDK()
  const toast = useToast()
  const { theme, mode, setMode } = useTheme()
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()
  const pluginRoutes: RouteMap = new Map()
  const [pluginRouteVersion, setPluginRouteVersion] = createSignal(0)
  const [pluginsReady, setPluginsReady] = createSignal(false)

  const attention: TuiAttention = {
    async notify(input) {
      if (!input.message.trim()) {
        return { ok: false, notification: false, sound: false, skipped: "empty_message" }
      }
      toast.show({
        title: input.title,
        message: input.message,
        variant: "info",
      })
      return { ok: true, notification: false, sound: false }
    },
    soundboard: {
      registerPack() {
        return () => {}
      },
      activate() {
        return false
      },
      current() {
        return "default"
      },
      list() {
        return []
      },
    },
  }

  const pluginApi = createTuiApi({
    tuiConfig,
    dialog,
    keymap,
    kv,
    route,
    routes: pluginRoutes,
    bump: () => setPluginRouteVersion((version) => version + 1),
    event: sdk.event,
    sdk,
    sync,
    theme: useTheme(),
    toast,
    renderer,
    attention,
  })

  onMount(() => {
    TuiPluginRuntime.init({
      api: pluginApi,
      config: tuiConfig,
    })
      .catch((error) => {
        console.error("Failed to load TUI plugins", error)
      })
      .finally(() => {
        setPluginsReady(true)
      })
  })

  onCleanup(() => {
    TuiPluginRuntime.dispose().catch((error) => {
      console.error("Failed to dispose TUI plugins", error)
    })
  })

  const pluginRoute = createMemo(() => {
    pluginRouteVersion()
    if (!pluginsReady()) return
    if (route.data.type !== "plugin") return
    return pluginRoutes.get(route.data.id)?.at(-1)?.render
  })

  useKeyboard((evt) => {
    if (!Flag.OPENCORVUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
    if (!renderer.getSelection()) return

    // Windows Terminal-like behavior:
    // - Ctrl+C copies and dismisses selection
    // - Esc dismisses selection
    // - Most other key input dismisses selection and is passed through
    if (evt.ctrl && evt.name === "c") {
      if (!Selection.copy(renderer, toast)) {
        renderer.clearSelection()
        return
      }

      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    if (evt.name === "escape") {
      renderer.clearSelection()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    renderer.clearSelection()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.OPENCORVUS_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("OpenCorvus")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("OpenCorvus")
        return
      }

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`OC | ${title}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      // Handle --session without --fork immediately (fork is handled in createEffect below)
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    // When using -c, session list is loaded in blocking phase, so we can navigate at "partial"
    if (continued || sync.status === "loading" || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID === undefined)?.id
    if (match) {
      continued = true
      if (args.fork) {
        sdk.client.session.fork({ sessionID: match }).then((result) => {
          if (result.data?.id) {
            route.navigate({ type: "session", sessionID: result.data.id })
          } else {
            toast.show({ message: "Failed to fork session", variant: "error" })
          }
        })
      } else {
        route.navigate({ type: "session", sessionID: match })
      }
    }
  })

  // Handle --session with --fork: wait for sync to be fully complete before forking
  // (session list loads in non-blocking phase for --session, so we must wait for "complete"
  // to avoid a race where reconcile overwrites the newly forked session)
  let forked = false
  createEffect(() => {
    if (forked || sync.status !== "complete" || !args.sessionID || !args.fork) return
    forked = true
    sdk.client.session.fork({ sessionID: args.sessionID }).then((result) => {
      if (result.data?.id) {
        route.navigate({ type: "session", sessionID: result.data.id })
      } else {
        toast.show({ message: "Failed to fork session", variant: "error" })
      }
    })
  })

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  const connected = useConnected()
  const appCommands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: "Show command palette",
        category: "System",
        hidden: true,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
    {
      title: "New session",
      suggested: route.data.type === "session",
      name: "session.new",
      category: "Session",
      slashName: "new",
      slashAliases: ["clear"],
      run: () => {
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
        })
        dialog.clear()
      },
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      name: `session.quick_switch.${i + 1}`,
      title: `Switch to session in quick slot ${i + 1}`,
      category: "Session",
      hidden: true,
      run: () => {
        local.session.quickSwitch(i + 1)
      },
    })),
    {
      title: "Switch model",
      name: "model.list",
      suggested: true,
      category: "Agent",
      slashName: "models",
      run: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    {
      title: "Model cycle",
      name: "model.cycle_recent",
      category: "Agent",
      hidden: true,
      run: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      name: "model.cycle_recent_reverse",
      category: "Agent",
      hidden: true,
      run: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Favorite cycle",
      name: "model.cycle_favorite",
      category: "Agent",
      hidden: true,
      run: () => {
        local.model.cycleFavorite(1)
      },
    },
    {
      title: "Favorite cycle reverse",
      name: "model.cycle_favorite_reverse",
      category: "Agent",
      hidden: true,
      run: () => {
        local.model.cycleFavorite(-1)
      },
    },
    {
      title: "Switch agent",
      name: "agent.list",
      category: "Agent",
      slashName: "agents",
      run: () => {
        dialog.replace(() => <DialogAgent />)
      },
    },
    {
      title: "Toggle MCPs",
      name: "mcp.list",
      category: "Agent",
      slashName: "mcps",
      run: () => {
        dialog.replace(() => <DialogMcp />)
      },
    },
    {
      title: "Agent cycle",
      name: "agent.cycle",
      category: "Agent",
      hidden: true,
      run: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Variant cycle",
      name: "variant.cycle",
      category: "Agent",
      hidden: true,
      run: () => {
        local.model.variant.cycle()
      },
    },
    {
      title: "Agent cycle reverse",
      name: "agent.cycle.reverse",
      category: "Agent",
      hidden: true,
      run: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Connect provider",
      name: "provider.connect",
      suggested: !connected(),
      slashName: "connect",
      run: () => {
        dialog.replace(() => <DialogProviderList />)
      },
      category: "Provider",
    },
    {
      title: "View status",
      name: "opencorvus.status",
      slashName: "status",
      run: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
    {
      title: "Switch theme",
      name: "theme.switch",
      slashName: "themes",
      run: () => {
        dialog.replace(() => <DialogThemeList />)
      },
      category: "System",
    },
    {
      title: "Toggle appearance",
      name: "theme.switch_mode",
      run: () => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      name: "help.show",
      slashName: "help",
      run: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Open docs",
      name: "docs.open",
      run: () => {
        open("https://opencorvus.ai/docs").catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Exit the app",
      name: "app.exit",
      slashName: "exit",
      slashAliases: ["quit", "q"],
      run: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      name: "app.debug",
      run: () => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      name: "app.console",
      run: () => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: "Write heap snapshot",
      category: "System",
      name: "app.heap_snapshot",
      run: () => {
        const path = writeHeapSnapshot()
        toast.show({
          variant: "info",
          message: `Heap snapshot written to ${path}`,
          duration: 5000,
        })
        dialog.clear()
      },
    },
    {
      title: "Suspend terminal",
      name: "terminal.suspend",
      category: "System",
      hidden: true,
      run: () => {
        process.once("SIGCONT", () => {
          renderer.resume()
        })

        renderer.suspend()
        // pid=0 means send the signal to all processes in the process group
        process.kill(0, "SIGTSTP")
      },
    },
    {
      title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
      name: "terminal.title.toggle",
      category: "System",
      run: () => {
        setTerminalTitleEnabled((prev) => {
          const next = !prev
          kv.set("terminal_title_enabled", next)
          if (!next) renderer.setTerminalTitle("")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: kv.get("animations_enabled", true) ? "Disable animations" : "Enable animations",
      name: "app.toggle.animations",
      category: "System",
      run: () => {
        kv.set("animations_enabled", !kv.get("animations_enabled", true))
        dialog.clear()
      },
    },
    {
      title: kv.get("diff_wrap_mode", "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
      name: "app.toggle.diffwrap",
      category: "System",
      run: () => {
        const current = kv.get("diff_wrap_mode", "word")
        kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
        dialog.clear()
      },
    },
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  )

  useBindings(() => ({
    commands: appCommands(),
  }))

  useBindings(() => ({
    mode: OPENCORVUS_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("app", appBindingCommands),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("app.global", appGlobalBindingCommands),
  }))

  useBindings(() => ({
    mode: OPENCORVUS_BASE_MODE,
    enabled: () => {
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.input === ""
    },
    bindings: tuiConfig.keybinds.gather("app_exit", ["app.exit"]),
  }))

  createEffect(() => {
    const currentModel = local.model.current()
    if (!currentModel) return
    if (currentModel.providerID === "openrouter" && !kv.get("openrouter_warning", false)) {
      untrack(() => {
        DialogAlert.show(
          dialog,
          "Warning",
          "While openrouter is a convenient way to access LLMs your request will often be routed to subpar providers that do not work well in our testing.\n\nFor reliable access to models check out OpenCorvus Zen\nhttps://opencorvus.ai/zen",
        ).then(() => kv.set("openrouter_warning", true))
      })
    }
  })

  sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
    keymap.dispatchCommand(evt.properties.command)
  })

  sdk.event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
    route.navigate({
      type: "session",
      sessionID: evt.properties.sessionID,
    })
  })

  sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  sdk.event.on(SessionApi.Event.Error.type, (evt) => {
    const error = evt.properties.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = (() => {
      if (!error) return "An error occurred"

      if (typeof error === "object") {
        const data = error.data
        if ("message" in data && typeof data.message === "string") {
          return data.message
        }
      }
      return String(error)
    })()

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  sdk.event.on(Installation.Event.UpdateAvailable.type, (evt) => {
    toast.show({
      variant: "info",
      title: "Update Available",
      message: `OpenCorvus ${evt.properties.version} is available. Run 'opencorvus upgrade' to update manually.`,
      duration: 10000,
    })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        if (!Flag.OPENCORVUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        Flag.OPENCORVUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? undefined : () => Selection.copy(renderer, toast)
      }
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
        <Match when={route.data.type === "plugin"}>
          {pluginRoute()?.({ params: route.data.type === "plugin" ? route.data.data : undefined }) ?? (
            <box padding={1}>
              <text fg={theme.textMuted}>TUI plugin route is not available.</text>
            </box>
          )}
        </Match>
      </Switch>
      <box flexShrink={0}>
        <TuiPluginRuntime.Slot name="app_bottom" />
      </box>
      <TuiPluginRuntime.Slot name="app" />
    </box>
  )
}

function ErrorComponent(props: {
  error: Error
  reset: () => void
  onExit: () => Promise<void>
  mode?: "dark" | "light"
}) {
  const term = useTerminalDimensions()
  const renderer = useRenderer()

  const handleExit = async () => {
    renderer.setTerminalTitle("")
    renderer.destroy()
    win32FlushInputBuffer()
    await props.onExit()
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      handleExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/yangheng95/opencorvus/issues/new?template=bug-report.yml")

  // Choose safe fallback colors per mode since theme context may not be available
  const isLight = props.mode === "light"
  const colors = {
    bg: isLight ? "#ffffff" : "#0a0a0a",
    text: isLight ? "#1a1a1a" : "#eeeeee",
    muted: isLight ? "#8a8a8a" : "#808080",
    primary: isLight ? "#3b7dd8" : "#fab283",
  }

  if (props.error.message) {
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  issueURL.searchParams.set("opencorvus-version", Installation.VERSION)

  const copyIssueURL = () => {
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box flexDirection="column" gap={1} backgroundColor={colors.bg}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD} fg={colors.text}>
          Please report an issue.
        </text>
        <box onMouseUp={copyIssueURL} backgroundColor={colors.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.bg}>
            Copy issue URL (exception info pre-filled)
          </text>
        </box>
        {copied() && <text fg={colors.muted}>Successfully copied</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={colors.text}>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Reset TUI</text>
        </box>
        <box onMouseUp={handleExit} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text fg={colors.muted}>{props.error.stack}</text>
      </scrollbox>
      <text fg={colors.text}>{props.error.message}</text>
    </box>
  )
}
