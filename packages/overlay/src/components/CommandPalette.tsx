// ── CommandPalette ──
//
// Cmd+K / Ctrl+K modal that exposes the operator's most-used actions
// (task switching, settings navigation, theme/locale, logs) in a single
// fuzzy-searchable surface. Mounted once at app boot; visibility driven
// by an internal signal flipped by the global keyboard hotkey.
//
// Command sources:
//   * Active project tasks (boardStore.tasks → selectTask)
//   * Settings tabs (openConfigDialog + switchConfigTab)
//   * Theme switcher (settingsStore.theme + applyTheme)
//   * Locale switcher
//   * New Chat (focus composer)
//
// Filtering: case-insensitive substring on command label + description +
// keywords. Up/Down navigate, Enter runs, Esc closes. The selected
// command is highlighted via aria-selected for screen readers and via
// the .cmdk-item--active class for the eye.

import * as KobalteDialog from "@kobalte/core/dialog"
import { For, Show, createMemo, createSignal, createEffect } from "solid-js"
import { boardStore } from "../store/board"
import { settingsStore, setSettingsStore, saveSettings } from "../store/settings"
import { syncAgentPromptLocale } from "../services/config"
import { applyTheme } from "../services/theme"
import { themeOptionsForCurrentHost } from "../services/theme-registry"
import { selectTask } from "../services/task"
import { openConfigDialog, switchConfigTab } from "../services/dialog"
import { setLocale } from "../utils/i18n"
import { t } from "../utils/i18n"
import { useDisclosure } from "../solid/disclosure"
import { useHotkey } from "../solid/hotkey"

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  keywords?: string
  run: () => void
}

const SETTINGS_TABS: Array<{ tab: string; labelKey: string; group: string }> = [
  { tab: "general", labelKey: "settings.title", group: "settings" },
  { tab: "permissions", labelKey: "permissions.title", group: "settings" },
  { tab: "prompt", labelKey: "prompt.title", group: "settings" },
  { tab: "channel", labelKey: "channel.title", group: "settings" },
  { tab: "memory", labelKey: "memory.title", group: "settings" },
  { tab: "providers", labelKey: "common.cancel", group: "settings" }, // providers has no i18n title; fall back below
  { tab: "agent-models", labelKey: "common.cancel", group: "settings" }, // same
  { tab: "about", labelKey: "about.title", group: "settings" },
]

// `id` is the canonical theme value (matches `data-theme` and
// settings.theme); `slug` is the underscore-safe i18n key suffix so
// `t(\`cmdk.theme.${slug}\`)` resolves at the call site as a template
// literal the static check-panel-i18n scanner can see (the head
// `cmdk.theme.` prefix-covers every descendant key).
const LOCALES: Array<{ id: string; label: string }> = [
  { id: "en-US", label: "English (US)" },
  { id: "zh-CN", label: "中文 (简体)" },
]

export function CommandPalette() {
  const palette = useDisclosure()
  const [query, setQuery] = createSignal("")
  const [activeIndex, setActiveIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined
  // Element that had focus right before the palette opened — restored on
  // close so keyboard users land back where they triggered Cmd+K from
  // (textarea, button, etc.) instead of leaking to <body>.
  let priorFocus: HTMLElement | null = null

  const commands = createMemo<Command[]>(() => {
    const cmds: Command[] = []

    cmds.push({
      id: "task:new",
      label: t("task.new"),
      hint: t("cmdk.group.task"),
      group: t("cmdk.group.task"),
      keywords: "new task create",
      run: () => {
        void selectTask("")
        const textarea = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
        textarea?.focus()
      },
    })

    for (const item of (boardStore.tasks ?? []) as any[]) {
      const id = item?.task?.id
      if (!id) continue
      const title = String(item?.task?.title || item?.overview?.headline || id)
      cmds.push({
        id: `task:${id}`,
        label: title,
        hint: String(item?.task?.status || ""),
        group: t("cmdk.group.task"),
        keywords: `${id} ${item?.task?.directory || ""}`,
        run: () => {
          void selectTask(id)
        },
      })
    }

    for (const tab of SETTINGS_TABS) {
      // Some tabs ship without an i18n title (Providers / Agent Models in
      // index.html). Fall back to a sensible English label so the command
      // is searchable. Localising those titles is a separate concern.
      let label = t(tab.labelKey)
      if (tab.tab === "providers") label = t("cmdk.settings.providers")
      if (tab.tab === "agent-models") label = t("cmdk.settings.agent_models")
      cmds.push({
        id: `settings:${tab.tab}`,
        label: `${t("config.title")}: ${label}`,
        group: t("cmdk.group.settings"),
        keywords: `settings config ${tab.tab}`,
        run: () => {
          openConfigDialog()
          switchConfigTab(tab.tab)
        },
      })
    }

    for (const theme of themeOptionsForCurrentHost()) {
      cmds.push({
        id: `theme:${theme.id}`,
        label: `${t("cmdk.theme_prefix")}: ${t(`cmdk.theme.${theme.i18nSlug}`)}`,
        group: t("cmdk.group.appearance"),
        keywords: `theme ${theme.id}`,
        run: () => {
          setSettingsStore("theme", theme.id)
          applyTheme(theme.id)
          saveSettings()
        },
      })
    }

    for (const loc of LOCALES) {
      cmds.push({
        id: `locale:${loc.id}`,
        label: `${t("cmdk.locale_prefix")}: ${loc.label}`,
        group: t("cmdk.group.appearance"),
        keywords: `locale language ${loc.id}`,
        run: () => {
          setSettingsStore("locale", loc.id)
          void setLocale(loc.id)
          void syncAgentPromptLocale(loc.id)
          saveSettings()
        },
      })
    }

    cmds.push({
      id: "logs:open",
      label: t("cmdk.open_logs"),
      group: t("cmdk.group.tools"),
      keywords: "logs viewer debug",
      run: () => {
        window.dispatchEvent(new CustomEvent("oc:open-logs"))
      },
    })

    return cmds
  })

  const filtered = createMemo<Command[]>(() => {
    const q = query().trim().toLowerCase()
    const list = commands()
    if (!q) return list
    return list.filter((c) => {
      const haystack = `${c.label} ${c.hint || ""} ${c.keywords || ""}`.toLowerCase()
      return haystack.includes(q)
    })
  })

  // Reset selection whenever the visible command set changes — otherwise a
  // stale activeIndex points off the end of the filtered list and Enter
  // does nothing.
  createEffect(() => {
    void filtered().length
    setActiveIndex(0)
  })

  function close() {
    palette.close()
    setQuery("")
    setActiveIndex(0)
    // Return focus to whatever the operator was on before the palette
    // grabbed it. Wrap in try because the prior element may have been
    // removed from the DOM during the palette's lifetime (e.g. the
    // operator ran a command that re-rendered the conversation).
    if (priorFocus && document.contains(priorFocus)) {
      try {
        priorFocus.focus()
      } catch {
        /* ignore — best-effort */
      }
    }
    priorFocus = null
  }

  function runActive() {
    const list = filtered()
    const cmd = list[activeIndex()]
    if (!cmd) return
    close()
    try {
      cmd.run()
    } catch (err) {
      console.error("[cmdk] command failed", cmd.id, err)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filtered().length - 1, i + 1))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      runActive()
      return
    }
    // Tab focus trap: arrow keys are the canonical navigation, but
    // Tab/Shift+Tab from the input would otherwise leave the palette
    // open with focus stranded outside it. Treat them as down/up so
    // keyboard-only operators stay inside the palette until Esc/Enter.
    if (e.key === "Tab") {
      e.preventDefault()
      const len = filtered().length
      if (len === 0) return
      setActiveIndex((i) => {
        const next = e.shiftKey ? i - 1 : i + 1
        return ((next % len) + len) % len
      })
      return
    }
  }

  // Global hotkey: Cmd+K (mac) / Ctrl+K (others). Captured in capture
  // phase so we trump an open <textarea> default behavior. Skip when a
  // shared dialog content node is mounted — those modals own Esc/Enter.
  useHotkey({
    key: "k",
    cmdOrCtrl: true,
    target: "window",
    capture: true,
    when: () => !document.querySelector(".dialog"),
    run: (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (palette.open()) {
        close()
        return
      }
      priorFocus = (document.activeElement as HTMLElement | null) ?? null
      palette.openIt()
    },
  })

  // Keep the active option scrolled into view as the operator arrows
  // through the command list.
  createEffect(() => {
    if (!palette.open() || !listRef) return
    void filtered()
    void activeIndex()
    queueMicrotask(() => {
      const item = listRef?.querySelector<HTMLElement>(".cmdk-item--active")
      item?.scrollIntoView({ block: "nearest" })
    })
  })

  return (
    <KobalteDialog.Root
      open={palette.open()}
      onOpenChange={(open) => {
        if (!open && palette.open()) close()
      }}
      modal
    >
      <Show when={palette.open()}>
        <KobalteDialog.Portal>
          <div class="cmdk-backdrop" role="presentation" onClick={close}>
            <KobalteDialog.Content
              class="cmdk-panel"
              aria-modal="true"
              aria-label={t("command_palette.label")}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                inputRef?.focus()
              }}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                type="search"
                class="cmdk-input"
                placeholder={t("cmdk.placeholder")}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                aria-label={t("cmdk.placeholder")}
              />
              <div class="cmdk-list" ref={listRef} role="listbox">
                <Show when={filtered().length > 0} fallback={<div class="cmdk-empty">{t("cmdk.empty")}</div>}>
                  <For each={filtered()}>
                    {(cmd, i) => (
                      <div
                        class="cmdk-item"
                        classList={{ "cmdk-item--active": i() === activeIndex() }}
                        role="option"
                        aria-selected={i() === activeIndex()}
                        data-group={cmd.group}
                        onMouseEnter={() => setActiveIndex(i())}
                        onClick={() => {
                          setActiveIndex(i())
                          runActive()
                        }}
                      >
                        <span class="cmdk-item-group">{cmd.group}</span>
                        <span class="cmdk-item-label">{cmd.label}</span>
                        <Show when={cmd.hint}>
                          <span class="cmdk-item-hint">{cmd.hint}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
              <div class="cmdk-foot">
                <kbd>↑↓</kbd> {t("cmdk.foot.navigate")} · <kbd>↵</kbd> {t("cmdk.foot.run")} · <kbd>esc</kbd>{" "}
                {t("cmdk.foot.close")}
              </div>
            </KobalteDialog.Content>
          </div>
        </KobalteDialog.Portal>
      </Show>
    </KobalteDialog.Root>
  )
}
