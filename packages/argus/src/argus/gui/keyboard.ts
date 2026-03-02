import { Log } from "../../util/log"

/** Return the primary modifier key name for the current OS */
export function platformModifier(): string {
  return process.platform === "darwin" ? "cmd" : "ctrl"
}

/**
 * Platform-correct nut-js key name for the OS "Super/Win/Cmd" key.
 * - win32: LeftWin (VK_LWIN = 0x5B) — libnut-win32 uses this for the Windows key
 * - darwin: LeftCmd — macOS Command key
 * - linux: LeftSuper — X11 Super key
 */
function platformSuperKey(): string {
  if (process.platform === "win32") return "LeftWin"
  if (process.platform === "darwin") return "LeftCmd"
  return "LeftSuper"
}

export namespace Keyboard {
  const log = Log.create({ service: "argus-keyboard" })
  const SUPER_KEYS = new Set([
    "win", "Win", "windows", "Windows", "super", "Super", "Super_L",
    "meta", "Meta", "cmd", "Cmd", "command", "Command",
    "LeftSuper", "LeftWin", "LeftMeta", "LeftCmd",
    "RightSuper", "RightWin", "RightMeta", "RightCmd",
  ])

  // Complete key mapping: common aliases → nut-js Key enum names.
  // Covers all 137 keys in @nut-tree-fork/shared Key enum.
  // Case-insensitive lookups for LLM-friendly usage.
  const KEY_MAP: Record<string, string> = {
    // ── Standard keys ──────────────────────────────────────────
    Enter: "Return", enter: "Return", Return: "Return", return: "Return",
    Escape: "Escape", escape: "Escape", esc: "Escape", Esc: "Escape",
    Tab: "Tab", tab: "Tab",
    Backspace: "Backspace", backspace: "Backspace",
    Delete: "Delete", delete: "Delete", del: "Delete", Del: "Delete",
    Insert: "Insert", insert: "Insert", ins: "Insert", Ins: "Insert",
    Space: "Space", space: "Space",

    // ── Arrow keys ─────────────────────────────────────────────
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Up: "Up", Down: "Down", Left: "Left", Right: "Right",
    up: "Up", down: "Down", left: "Left", right: "Right",

    // ── Navigation ─────────────────────────────────────────────
    Home: "Home", home: "Home",
    End: "End", end: "End",
    PageUp: "PageUp", pageup: "PageUp", pageUp: "PageUp", PgUp: "PageUp", pgup: "PageUp",
    PageDown: "PageDown", pagedown: "PageDown", pageDown: "PageDown", PgDn: "PageDown", pgdn: "PageDown",

    // ── Modifier keys (common aliases → nut-js names) ──────────
    // Control
    ctrl: "LeftControl", Ctrl: "LeftControl",
    control: "LeftControl", Control: "LeftControl",
    LeftControl: "LeftControl", RightControl: "RightControl",
    rctrl: "RightControl", RCtrl: "RightControl",
    // Alt
    alt: "LeftAlt", Alt: "LeftAlt",
    option: "LeftAlt", Option: "LeftAlt",
    LeftAlt: "LeftAlt", RightAlt: "RightAlt",
    ralt: "RightAlt", RAlt: "RightAlt",
    // Shift
    shift: "LeftShift", Shift: "LeftShift",
    LeftShift: "LeftShift", RightShift: "RightShift",
    rshift: "RightShift", RShift: "RightShift",
    // Windows / Super / Meta / Cmd — resolved at runtime via platformSuperKey()
    win: platformSuperKey(), Win: platformSuperKey(),
    windows: platformSuperKey(), Windows: platformSuperKey(),
    super: platformSuperKey(), Super: platformSuperKey(), Super_L: platformSuperKey(),
    meta: platformSuperKey(), Meta: platformSuperKey(),
    LeftMeta: "LeftMeta", RightMeta: "RightMeta",
    cmd: platformSuperKey(), Cmd: platformSuperKey(),
    command: platformSuperKey(), Command: platformSuperKey(),
    LeftCmd: "LeftCmd", RightCmd: "RightCmd",
    LeftSuper: "LeftSuper", RightSuper: "RightSuper",
    LeftWin: "LeftWin", RightWin: "RightWin",
    // Fn / Menu
    fn: "Fn", Fn: "Fn",
    menu: "Menu", Menu: "Menu",
    contextmenu: "Menu", ContextMenu: "Menu",

    // ── Lock keys ──────────────────────────────────────────────
    CapsLock: "CapsLock", capslock: "CapsLock", caps: "CapsLock", Caps: "CapsLock",
    NumLock: "NumLock", numlock: "NumLock",
    ScrollLock: "ScrollLock", scrolllock: "ScrollLock",

    // ── System keys ────────────────────────────────────────────
    Print: "Print", print: "Print",
    PrintScreen: "Print", printscreen: "Print", prtsc: "Print", PrtSc: "Print",
    Pause: "Pause", pause: "Pause",
    Break: "Pause", break: "Pause",
    Clear: "Clear", clear: "Clear",

    // ── Function keys (F1–F24) ─────────────────────────────────
    F1: "F1", f1: "F1", F2: "F2", f2: "F2",
    F3: "F3", f3: "F3", F4: "F4", f4: "F4",
    F5: "F5", f5: "F5", F6: "F6", f6: "F6",
    F7: "F7", f7: "F7", F8: "F8", f8: "F8",
    F9: "F9", f9: "F9", F10: "F10", f10: "F10",
    F11: "F11", f11: "F11", F12: "F12", f12: "F12",
    F13: "F13", f13: "F13", F14: "F14", f14: "F14",
    F15: "F15", f15: "F15", F16: "F16", f16: "F16",
    F17: "F17", f17: "F17", F18: "F18", f18: "F18",
    F19: "F19", f19: "F19", F20: "F20", f20: "F20",
    F21: "F21", f21: "F21", F22: "F22", f22: "F22",
    F23: "F23", f23: "F23", F24: "F24", f24: "F24",

    // ── Letter keys (a-z → A-Z) ───────────────────────────────
    a: "A", b: "B", c: "C", d: "D", e: "E", f: "F", g: "G", h: "H",
    i: "I", j: "J", k: "K", l: "L", m: "M", n: "N", o: "O", p: "P",
    q: "Q", r: "R", s: "S", t: "T", u: "U", v: "V", w: "W", x: "X",
    y: "Y", z: "Z",

    // ── Number row keys ───────────────────────────────────────
    "0": "Num0", "1": "Num1", "2": "Num2", "3": "Num3", "4": "Num4",
    "5": "Num5", "6": "Num6", "7": "Num7", "8": "Num8", "9": "Num9",

    // ── Symbol / punctuation keys ─────────────────────────────
    "`": "Grave", "~": "Grave", grave: "Grave", Grave: "Grave", tilde: "Grave",
    "-": "Minus", minus: "Minus", Minus: "Minus",
    "=": "Equal", equal: "Equal", Equal: "Equal", equals: "Equal",
    "[": "LeftBracket", leftbracket: "LeftBracket", LeftBracket: "LeftBracket",
    "]": "RightBracket", rightbracket: "RightBracket", RightBracket: "RightBracket",
    "\\": "Backslash", backslash: "Backslash", Backslash: "Backslash",
    ";": "Semicolon", semicolon: "Semicolon", Semicolon: "Semicolon",
    "'": "Quote", quote: "Quote", Quote: "Quote",
    ",": "Comma", comma: "Comma", Comma: "Comma",
    ".": "Period", period: "Period", Period: "Period", dot: "Period",
    "/": "Slash", slash: "Slash", Slash: "Slash",

    // ── Numpad keys ───────────────────────────────────────────
    numpad0: "NumPad0", NumPad0: "NumPad0", num0: "NumPad0",
    numpad1: "NumPad1", NumPad1: "NumPad1", num1: "NumPad1",
    numpad2: "NumPad2", NumPad2: "NumPad2", num2: "NumPad2",
    numpad3: "NumPad3", NumPad3: "NumPad3", num3: "NumPad3",
    numpad4: "NumPad4", NumPad4: "NumPad4", num4: "NumPad4",
    numpad5: "NumPad5", NumPad5: "NumPad5", num5: "NumPad5",
    numpad6: "NumPad6", NumPad6: "NumPad6", num6: "NumPad6",
    numpad7: "NumPad7", NumPad7: "NumPad7", num7: "NumPad7",
    numpad8: "NumPad8", NumPad8: "NumPad8", num8: "NumPad8",
    numpad9: "NumPad9", NumPad9: "NumPad9", num9: "NumPad9",
    decimal: "Decimal", Decimal: "Decimal", "numpad.": "Decimal",
    add: "Add", Add: "Add", "numpad+": "Add",
    subtract: "Subtract", Subtract: "Subtract", "numpad-": "Subtract",
    multiply: "Multiply", Multiply: "Multiply", "numpad*": "Multiply",
    divide: "Divide", Divide: "Divide", "numpad/": "Divide",
    NumPadEqual: "NumPadEqual", "numpad=": "NumPadEqual",
    numpadenter: "Enter", NumPadEnter: "Enter",

    // ── Audio / media keys ────────────────────────────────────
    AudioMute: "AudioMute", mute: "AudioMute", volumemute: "AudioMute",
    AudioVolDown: "AudioVolDown", volumedown: "AudioVolDown",
    AudioVolUp: "AudioVolUp", volumeup: "AudioVolUp",
    AudioPlay: "AudioPlay", mediaplay: "AudioPlay", playpause: "AudioPlay",
    AudioStop: "AudioStop", mediastop: "AudioStop",
    AudioPause: "AudioPause", mediapause: "AudioPause",
    AudioPrev: "AudioPrev", mediaprev: "AudioPrev", previoustrack: "AudioPrev",
    AudioNext: "AudioNext", medianext: "AudioNext", nexttrack: "AudioNext",
    AudioRewind: "AudioRewind", mediarewind: "AudioRewind",
    AudioForward: "AudioForward", mediaforward: "AudioForward",
    AudioRepeat: "AudioRepeat", mediarepeat: "AudioRepeat",
    AudioRandom: "AudioRandom", shuffle: "AudioRandom",
  }

  const SUPER_KEYS = new Set([
    "win", "Win", "windows", "Windows",
    "super", "Super", "Super_L",
    "meta", "Meta",
    "cmd", "Cmd", "command", "Command",
    "LeftWin", "RightWin",
    "LeftSuper", "RightSuper",
    "LeftMeta", "RightMeta",
    "LeftCmd", "RightCmd",
  ])

  function candidates(name: string, Key: Record<string, any>) {
    const primary = KEY_MAP[name] ?? name
    const list = [primary]
    if (SUPER_KEYS.has(name) || SUPER_KEYS.has(primary)) {
      list.push("LeftSuper", "LeftWin", "LeftMeta")
    }
    return Array.from(new Set(list))
      .map((k) => Key[k])
      .filter((k) => k !== undefined)
  }

  export async function pressKey(keyName: string): Promise<void> {
    try {
      const { keyboard, Key } = await import("@nut-tree-fork/nut-js")
      const keys = candidates(keyName, Key as any)
      if (keys.length === 0) {
        log.warn("unknown key, attempting type", { keyName })
        await keyboard.type(keyName)
        return
      }
      let err: unknown
      for (const key of keys) {
        try {
          await keyboard.pressKey(key)
          await keyboard.releaseKey(key)
          log.info("pressed key", { keyName, resolved: key })
          return
        } catch (e) {
          err = e
        }
      }
      throw err
    } catch (e) {
      log.error("pressKey failed", {
        keyName,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function typeText(text: string): Promise<void> {
    try {
      const { keyboard } = await import("@nut-tree-fork/nut-js")
      await keyboard.type(text)
      log.info("typed text", { length: text.length })
    } catch (e) {
      log.error("typeText failed", {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function hotkey(...keys: string[]): Promise<void> {
    try {
      const { keyboard, Key } = await import("@nut-tree-fork/nut-js")
      const resolved = keys.map((k) => candidates(k, Key as any))
      const missing = resolved.findIndex((x) => x.length === 0)
      if (missing >= 0) throw new Error(`Unknown key: ${keys[missing]}`)
      const plans = resolved.reduce(
        (acc, cur) => acc.flatMap((prefix) => cur.map((key) => [...prefix, key])),
        [[] as any[]],
      )
      let err: unknown
      for (const plan of plans) {
        try {
          for (const key of plan) {
            await keyboard.pressKey(key)
          }
          const reverse = [...plan].reverse()
          try {
            for (const key of reverse) {
              await keyboard.releaseKey(key)
            }
          } catch (releaseErr) {
            for (const key of reverse) {
              await keyboard.releaseKey(key).catch(() => {})
            }
            throw releaseErr
          }
          log.info("hotkey", { keys, resolved: plan })
          return
        } catch (e) {
          err = e
        }
      }
      throw err
    } catch (e) {
      log.error("hotkey failed", {
        keys,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }
}
