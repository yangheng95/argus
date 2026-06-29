// ── CommandPalette ──
//
// Cmd+K / Ctrl+K modal that exposes the operator's most-used actions
// (task switching, settings navigation, theme/locale, logs) in a single
// fuzzy-searchable surface. Mounted once at app boot; visibility driven
// by an internal signal flipped by the global keyboard hotkey.
//
// Command sources:
//   * Active project tasks (boardStore.tasks → selectTask)
//   * Settings sections (CONFIG_SECTIONS -> openConfigDialog)
//   * Theme switcher (settingsStore.theme + applyTheme)
//   * Locale switcher
//   * New Task (focus composer)
//
// Filtering: case-insensitive substring on command label + description +
// keywords. The shared Combobox primitive owns active descendant,
// listbox option semantics, and keyboard navigation.

import { createMemo } from "solid-js"
import { boardStore } from "../store/board"
import { settingsStore, setSettingsStore, saveSettings } from "../store/settings"
import { currentProjectConfigRequestOptions, syncAgentPromptLocale } from "../services/config"
import { applyTheme } from "../services/theme"
import { themeOptionsForCurrentHost } from "../services/theme-registry"
import { selectTask } from "../services/task"
import { openConfigDialog } from "../services/dialog"
import { CONFIG_SECTIONS } from "../store/dialog"
import { setLocale } from "../utils/i18n"
import { t } from "../utils/i18n"
import { formatErrorDetails, notifyError } from "../services/notify"
import { useDisclosure } from "../solid/disclosure"
import { useHotkey } from "../solid/hotkey"
import { Dialog } from "./primitives/Dialog"
import { ComboboxControl } from "./ui/ComboboxControl"

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  keywords?: string
  run: () => void | Promise<void>
}

const COMMAND_PALETTE_INPUT_ID = "commandPaletteInput"
const COMMAND_PALETTE_LISTBOX_ID = "commandPaletteListbox"

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
  let inputRef: HTMLInputElement | undefined
  // Element that had focus right before the palette opened — restored on
  // close so keyboard users land back where they triggered Cmd+K from
  // (textarea, button, etc.) instead of leaking to <body>.
  let priorFocus: HTMLElement | null = null

  const commands = createMemo<Command[]>(() => {
    const cmds: Command[] = []

    cmds.push({
      id: "task:new",
      label: t("task.ledger.new"),
      hint: t("cmdk.group.task"),
      group: t("cmdk.group.task"),
      keywords: "new task create",
      run: async () => {
        await selectTask("")
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
        run: async () => {
          await selectTask(id)
        },
      })
    }

    for (const section of CONFIG_SECTIONS) {
      cmds.push({
        id: `settings:${section.id}`,
        label: `${t("config.title")}: ${t(section.labelKey)}`,
        group: t("cmdk.group.settings"),
        keywords: `settings config ${section.id} ${section.id.replace(/-/g, " ")}`,
        run: () => {
          openConfigDialog(section.id)
        },
      })
    }

    for (const theme of themeOptionsForCurrentHost()) {
      cmds.push({
        id: `theme:${theme.id}`,
        label: `${t("cmdk.theme_prefix")}: ${t(`cmdk.theme.${theme.i18nSlug}`)}`,
        group: t("cmdk.group.appearance"),
        keywords: `theme ${theme.id}`,
        run: async () => {
          setSettingsStore("theme", theme.id)
          applyTheme(theme.id)
          await saveSettings()
        },
      })
    }

    for (const loc of LOCALES) {
      cmds.push({
        id: `locale:${loc.id}`,
        label: `${t("cmdk.locale_prefix")}: ${loc.label}`,
        group: t("cmdk.group.appearance"),
        keywords: `locale language ${loc.id}`,
        run: async () => {
          setSettingsStore("locale", loc.id)
          await setLocale(loc.id)
          await syncAgentPromptLocale(loc.id, currentProjectConfigRequestOptions())
          await saveSettings()
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

  function commandMatches(command: Command, inputValue: string): boolean {
    const q = inputValue.trim().toLowerCase()
    if (!q) return true
    const haystack = `${command.label} ${command.hint || ""} ${command.keywords || ""}`.toLowerCase()
    return haystack.includes(q)
  }

  function close() {
    palette.close()
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

  function runCommand(cmd: Command | null) {
    if (!cmd) return
    close()
    try {
      void Promise.resolve(cmd.run()).catch((err) => {
        notifyError({
          title: t("common.error"),
          message: `${t("command_palette.label")}: ${cmd.label}`,
          details: formatErrorDetails(err),
        })
      })
    } catch (err) {
      notifyError({
        title: t("common.error"),
        message: `${t("command_palette.label")}: ${cmd.label}`,
        details: formatErrorDetails(err),
      })
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
    when: () => palette.open() || !document.querySelector(".dialog"),
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

  return (
    <Dialog
      id="commandPaletteDialog"
      open={palette.open()}
      title={t("command_palette.label")}
      titleAs="h2"
      class="cmdk-dialog"
      overlayClass="cmdk-backdrop"
      formClass="cmdk-panel"
      headerClass="cmdk-header"
      onClose={() => {
        if (palette.open()) close()
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        inputRef?.focus()
      }}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <ComboboxControl<Command>
        class="cmdk-combobox"
        controlClass="cmdk-control"
        inputClass="cmdk-input"
        listboxClass="cmdk-list"
        optionClass="cmdk-item"
        optionPrefixClass="cmdk-item-group"
        optionLabelClass="cmdk-item-label"
        optionDescriptionClass="cmdk-item-hint"
        inputID={COMMAND_PALETTE_INPUT_ID}
        listboxID={COMMAND_PALETTE_LISTBOX_ID}
        inputRef={(el) => {
          inputRef = el
        }}
        ariaLabel={t("cmdk.placeholder")}
        placeholder={t("cmdk.placeholder")}
        options={commands()}
        optionValue="id"
        optionTextValue={(command) => `${command.label} ${command.hint || ""} ${command.keywords || ""}`}
        optionLabel="label"
        value={null}
        open={palette.open()}
        onOpenChange={(open) => {
          if (!open && palette.open()) close()
        }}
        defaultFilter={commandMatches}
        allowsEmptyCollection
        closeOnSelection
        onChange={runCommand}
        renderOptionPrefix={(command) => command.group}
        renderOptionLabel={(command) => command.label}
        renderOptionDescription={(command) => command.hint}
        optionData={(command) => ({
          "data-command-id": command.id,
          "data-group": command.group,
        })}
        emptyContent={<div class="cmdk-empty">{t("cmdk.empty")}</div>}
      />
      <div class="cmdk-foot">
        <kbd>↑↓</kbd> {t("cmdk.foot.navigate")} · <kbd>↵</kbd> {t("cmdk.foot.run")} · <kbd>esc</kbd>{" "}
        {t("cmdk.foot.close")}
      </div>
    </Dialog>
  )
}
