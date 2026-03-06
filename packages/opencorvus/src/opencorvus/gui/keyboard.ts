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
  const log = Log.create({ service: "opencorvus-keyboard" })
  const KEYEVENTF_KEYUP = 0x0002
  let user32: ReturnType<(typeof import("bun:ffi"))["dlopen"]> | undefined
  const SUPER_KEYS = new Set([
    "win",
    "Win",
    "windows",
    "Windows",
    "super",
    "Super",
    "Super_L",
    "meta",
    "Meta",
    "cmd",
    "Cmd",
    "command",
    "Command",
    "LeftSuper",
    "LeftWin",
    "LeftMeta",
    "LeftCmd",
    "RightSuper",
    "RightWin",
    "RightMeta",
    "RightCmd",
  ])

  // Complete key mapping: common aliases → nut-js Key enum names.
  // Covers all 137 keys in @nut-tree-fork/shared Key enum.
  // Case-insensitive lookups for LLM-friendly usage.
  const KEY_MAP: Record<string, string> = {
    // ── Standard keys ──────────────────────────────────────────
    Enter: "Return",
    enter: "Return",
    Return: "Return",
    return: "Return",
    Escape: "Escape",
    escape: "Escape",
    esc: "Escape",
    Esc: "Escape",
    Tab: "Tab",
    tab: "Tab",
    Backspace: "Backspace",
    backspace: "Backspace",
    Delete: "Delete",
    delete: "Delete",
    del: "Delete",
    Del: "Delete",
    Insert: "Insert",
    insert: "Insert",
    ins: "Insert",
    Ins: "Insert",
    Space: "Space",
    space: "Space",

    // ── Arrow keys ─────────────────────────────────────────────
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Up: "Up",
    Down: "Down",
    Left: "Left",
    Right: "Right",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",

    // ── Navigation ─────────────────────────────────────────────
    Home: "Home",
    home: "Home",
    End: "End",
    end: "End",
    PageUp: "PageUp",
    pageup: "PageUp",
    pageUp: "PageUp",
    PgUp: "PageUp",
    pgup: "PageUp",
    PageDown: "PageDown",
    pagedown: "PageDown",
    pageDown: "PageDown",
    PgDn: "PageDown",
    pgdn: "PageDown",

    // ── Modifier keys (common aliases → nut-js names) ──────────
    // Control
    ctrl: "LeftControl",
    Ctrl: "LeftControl",
    control: "LeftControl",
    Control: "LeftControl",
    LeftControl: "LeftControl",
    RightControl: "RightControl",
    rctrl: "RightControl",
    RCtrl: "RightControl",
    // Alt
    alt: "LeftAlt",
    Alt: "LeftAlt",
    option: "LeftAlt",
    Option: "LeftAlt",
    LeftAlt: "LeftAlt",
    RightAlt: "RightAlt",
    ralt: "RightAlt",
    RAlt: "RightAlt",
    // Shift
    shift: "LeftShift",
    Shift: "LeftShift",
    LeftShift: "LeftShift",
    RightShift: "RightShift",
    rshift: "RightShift",
    RShift: "RightShift",
    // Windows / Super / Meta / Cmd — resolved at runtime via platformSuperKey()
    win: platformSuperKey(),
    Win: platformSuperKey(),
    windows: platformSuperKey(),
    Windows: platformSuperKey(),
    super: platformSuperKey(),
    Super: platformSuperKey(),
    Super_L: platformSuperKey(),
    meta: platformSuperKey(),
    Meta: platformSuperKey(),
    LeftMeta: "LeftMeta",
    RightMeta: "RightMeta",
    cmd: platformSuperKey(),
    Cmd: platformSuperKey(),
    command: platformSuperKey(),
    Command: platformSuperKey(),
    LeftCmd: "LeftCmd",
    RightCmd: "RightCmd",
    LeftSuper: "LeftSuper",
    RightSuper: "RightSuper",
    LeftWin: "LeftWin",
    RightWin: "RightWin",
    // Fn / Menu
    fn: "Fn",
    Fn: "Fn",
    menu: "Menu",
    Menu: "Menu",
    contextmenu: "Menu",
    ContextMenu: "Menu",

    // ── Lock keys ──────────────────────────────────────────────
    CapsLock: "CapsLock",
    capslock: "CapsLock",
    caps: "CapsLock",
    Caps: "CapsLock",
    NumLock: "NumLock",
    numlock: "NumLock",
    ScrollLock: "ScrollLock",
    scrolllock: "ScrollLock",

    // ── System keys ────────────────────────────────────────────
    Print: "Print",
    print: "Print",
    PrintScreen: "Print",
    printscreen: "Print",
    prtsc: "Print",
    PrtSc: "Print",
    Pause: "Pause",
    pause: "Pause",
    Break: "Pause",
    break: "Pause",
    Clear: "Clear",
    clear: "Clear",

    // ── Function keys (F1–F24) ─────────────────────────────────
    F1: "F1",
    f1: "F1",
    F2: "F2",
    f2: "F2",
    F3: "F3",
    f3: "F3",
    F4: "F4",
    f4: "F4",
    F5: "F5",
    f5: "F5",
    F6: "F6",
    f6: "F6",
    F7: "F7",
    f7: "F7",
    F8: "F8",
    f8: "F8",
    F9: "F9",
    f9: "F9",
    F10: "F10",
    f10: "F10",
    F11: "F11",
    f11: "F11",
    F12: "F12",
    f12: "F12",
    F13: "F13",
    f13: "F13",
    F14: "F14",
    f14: "F14",
    F15: "F15",
    f15: "F15",
    F16: "F16",
    f16: "F16",
    F17: "F17",
    f17: "F17",
    F18: "F18",
    f18: "F18",
    F19: "F19",
    f19: "F19",
    F20: "F20",
    f20: "F20",
    F21: "F21",
    f21: "F21",
    F22: "F22",
    f22: "F22",
    F23: "F23",
    f23: "F23",
    F24: "F24",
    f24: "F24",

    // ── Letter keys (a-z → A-Z) ───────────────────────────────
    a: "A",
    b: "B",
    c: "C",
    d: "D",
    e: "E",
    f: "F",
    g: "G",
    h: "H",
    i: "I",
    j: "J",
    k: "K",
    l: "L",
    m: "M",
    n: "N",
    o: "O",
    p: "P",
    q: "Q",
    r: "R",
    s: "S",
    t: "T",
    u: "U",
    v: "V",
    w: "W",
    x: "X",
    y: "Y",
    z: "Z",

    // ── Number row keys ───────────────────────────────────────
    "0": "Num0",
    "1": "Num1",
    "2": "Num2",
    "3": "Num3",
    "4": "Num4",
    "5": "Num5",
    "6": "Num6",
    "7": "Num7",
    "8": "Num8",
    "9": "Num9",

    // ── Symbol / punctuation keys ─────────────────────────────
    "`": "Grave",
    "~": "Grave",
    grave: "Grave",
    Grave: "Grave",
    tilde: "Grave",
    "-": "Minus",
    minus: "Minus",
    Minus: "Minus",
    "=": "Equal",
    equal: "Equal",
    Equal: "Equal",
    equals: "Equal",
    "[": "LeftBracket",
    leftbracket: "LeftBracket",
    LeftBracket: "LeftBracket",
    "]": "RightBracket",
    rightbracket: "RightBracket",
    RightBracket: "RightBracket",
    "\\": "Backslash",
    backslash: "Backslash",
    Backslash: "Backslash",
    ";": "Semicolon",
    semicolon: "Semicolon",
    Semicolon: "Semicolon",
    "'": "Quote",
    quote: "Quote",
    Quote: "Quote",
    ",": "Comma",
    comma: "Comma",
    Comma: "Comma",
    ".": "Period",
    period: "Period",
    Period: "Period",
    dot: "Period",
    "/": "Slash",
    slash: "Slash",
    Slash: "Slash",

    // ── Numpad keys ───────────────────────────────────────────
    numpad0: "NumPad0",
    NumPad0: "NumPad0",
    num0: "NumPad0",
    numpad1: "NumPad1",
    NumPad1: "NumPad1",
    num1: "NumPad1",
    numpad2: "NumPad2",
    NumPad2: "NumPad2",
    num2: "NumPad2",
    numpad3: "NumPad3",
    NumPad3: "NumPad3",
    num3: "NumPad3",
    numpad4: "NumPad4",
    NumPad4: "NumPad4",
    num4: "NumPad4",
    numpad5: "NumPad5",
    NumPad5: "NumPad5",
    num5: "NumPad5",
    numpad6: "NumPad6",
    NumPad6: "NumPad6",
    num6: "NumPad6",
    numpad7: "NumPad7",
    NumPad7: "NumPad7",
    num7: "NumPad7",
    numpad8: "NumPad8",
    NumPad8: "NumPad8",
    num8: "NumPad8",
    numpad9: "NumPad9",
    NumPad9: "NumPad9",
    num9: "NumPad9",
    decimal: "Decimal",
    Decimal: "Decimal",
    "numpad.": "Decimal",
    add: "Add",
    Add: "Add",
    "numpad+": "Add",
    subtract: "Subtract",
    Subtract: "Subtract",
    "numpad-": "Subtract",
    multiply: "Multiply",
    Multiply: "Multiply",
    "numpad*": "Multiply",
    divide: "Divide",
    Divide: "Divide",
    "numpad/": "Divide",
    NumPadEqual: "NumPadEqual",
    "numpad=": "NumPadEqual",
    numpadenter: "Enter",
    NumPadEnter: "Enter",

    // ── Audio / media keys ────────────────────────────────────
    AudioMute: "AudioMute",
    mute: "AudioMute",
    volumemute: "AudioMute",
    AudioVolDown: "AudioVolDown",
    volumedown: "AudioVolDown",
    AudioVolUp: "AudioVolUp",
    volumeup: "AudioVolUp",
    AudioPlay: "AudioPlay",
    mediaplay: "AudioPlay",
    playpause: "AudioPlay",
    AudioStop: "AudioStop",
    mediastop: "AudioStop",
    AudioPause: "AudioPause",
    mediapause: "AudioPause",
    AudioPrev: "AudioPrev",
    mediaprev: "AudioPrev",
    previoustrack: "AudioPrev",
    AudioNext: "AudioNext",
    medianext: "AudioNext",
    nexttrack: "AudioNext",
    AudioRewind: "AudioRewind",
    mediarewind: "AudioRewind",
    AudioForward: "AudioForward",
    mediaforward: "AudioForward",
    AudioRepeat: "AudioRepeat",
    mediarepeat: "AudioRepeat",
    AudioRandom: "AudioRandom",
    shuffle: "AudioRandom",
  }

  async function win32() {
    if (process.platform !== "win32") return undefined
    if (user32) return user32
    const ffi = await import("bun:ffi")
    user32 = ffi.dlopen("user32.dll", {
      keybd_event: { args: ["u8", "u8", "u32", "u32"], returns: "void" },
    })
    return user32
  }

  function resolveName(name: string) {
    return KEY_MAP[name] ?? name
  }

  function functionNumber(name: string) {
    if (!/^F\d{1,2}$/.test(name)) return
    const value = Number(name.slice(1))
    if (value < 1 || value > 24) return
    return 0x6f + value
  }

  function winVK(name: string): number | undefined {
    const key = resolveName(name)
    const fn = functionNumber(key)
    if (fn !== undefined) return fn
    if (/^[A-Z]$/.test(key)) return key.charCodeAt(0)
    if (/^[a-z]$/.test(key)) return key.toUpperCase().charCodeAt(0)
    switch (key) {
      case "Num0":
        return 0x30
      case "Num1":
        return 0x31
      case "Num2":
        return 0x32
      case "Num3":
        return 0x33
      case "Num4":
        return 0x34
      case "Num5":
        return 0x35
      case "Num6":
        return 0x36
      case "Num7":
        return 0x37
      case "Num8":
        return 0x38
      case "Num9":
        return 0x39
      case "Return":
      case "Enter":
        return 0x0d
      case "Escape":
        return 0x1b
      case "Tab":
        return 0x09
      case "Space":
        return 0x20
      case "Backspace":
        return 0x08
      case "Delete":
        return 0x2e
      case "Insert":
        return 0x2d
      case "Up":
        return 0x26
      case "Down":
        return 0x28
      case "Left":
        return 0x25
      case "Right":
        return 0x27
      case "Home":
        return 0x24
      case "End":
        return 0x23
      case "PageUp":
        return 0x21
      case "PageDown":
        return 0x22
      case "CapsLock":
        return 0x14
      case "ScrollLock":
        return 0x91
      case "NumLock":
        return 0x90
      case "Print":
        return 0x2c
      case "Pause":
        return 0x13
      case "LeftControl":
        return 0xa2
      case "RightControl":
        return 0xa3
      case "LeftShift":
        return 0xa0
      case "RightShift":
        return 0xa1
      case "LeftAlt":
        return 0xa4
      case "RightAlt":
        return 0xa5
      case "LeftWin":
      case "LeftSuper":
      case "LeftMeta":
      case "LeftCmd":
        return 0x5b
      case "RightWin":
      case "RightSuper":
      case "RightMeta":
      case "RightCmd":
        return 0x5c
      case "Menu":
        return 0x5d
      case "Minus":
        return 0xbd
      case "Equal":
        return 0xbb
      case "LeftBracket":
        return 0xdb
      case "RightBracket":
        return 0xdd
      case "Backslash":
        return 0xdc
      case "Semicolon":
        return 0xba
      case "Quote":
        return 0xde
      case "Comma":
        return 0xbc
      case "Period":
        return 0xbe
      case "Slash":
        return 0xbf
      case "Grave":
        return 0xc0
      case "NumPad0":
        return 0x60
      case "NumPad1":
        return 0x61
      case "NumPad2":
        return 0x62
      case "NumPad3":
        return 0x63
      case "NumPad4":
        return 0x64
      case "NumPad5":
        return 0x65
      case "NumPad6":
        return 0x66
      case "NumPad7":
        return 0x67
      case "NumPad8":
        return 0x68
      case "NumPad9":
        return 0x69
      case "Multiply":
        return 0x6a
      case "Add":
        return 0x6b
      case "Subtract":
        return 0x6d
      case "Decimal":
        return 0x6e
      case "Divide":
        return 0x6f
      case "NumPadEqual":
        return 0xbb
      default:
        return undefined
    }
  }

  async function winTap(name: string) {
    const vk = winVK(name)
    if (vk === undefined) return false
    const api = await win32()
    if (!api) return false
    const event = api.symbols.keybd_event as unknown as (vk: number, scan: number, flags: number, extra: number) => void
    event(vk, 0, 0, 0)
    event(vk, 0, KEYEVENTF_KEYUP, 0)
    return true
  }

  async function winChord(names: string[]) {
    const vks = names.map((name) => winVK(name))
    if (vks.some((vk) => vk === undefined)) return false
    const api = await win32()
    if (!api) return false
    const event = api.symbols.keybd_event as unknown as (vk: number, scan: number, flags: number, extra: number) => void
    const list = vks as number[]
    for (const vk of list) {
      event(vk, 0, 0, 0)
    }
    for (const vk of [...list].reverse()) {
      event(vk, 0, KEYEVENTF_KEYUP, 0)
    }
    return true
  }

  function candidates(name: string, keyMap: Record<string, unknown> | undefined) {
    if (!keyMap) return []
    const primary = KEY_MAP[name] ?? name
    const list = [primary]
    if (SUPER_KEYS.has(name) || SUPER_KEYS.has(primary)) {
      list.push("LeftSuper", "LeftWin", "LeftMeta")
    }
    return Array.from(new Set(list))
      .flatMap((key) => {
        const value = keyMap[key]
        return value === undefined ? [] : [value]
      })
  }

  function toError(input: unknown, fallback: string): Error {
    if (input instanceof Error) return input
    return new Error(input === undefined ? fallback : String(input))
  }

  export async function pressKey(keyName: string): Promise<void> {
    try {
      if (process.platform === "win32" && SUPER_KEYS.has(keyName)) {
        const winFallback = await winChord(["ctrl", "esc"])
        if (winFallback) {
          log.info("pressed key", { keyName, resolved: "Ctrl+Esc", backend: "win32" })
          return
        }
      }
      if (process.platform === "win32") {
        const tapped = await winTap(keyName)
        if (tapped) {
          log.info("pressed key", { keyName, resolved: resolveName(keyName), backend: "win32" })
          return
        }
      }
      const mod = await import("@nut-tree-fork/nut-js")
      const keyMap =
        "Key" in mod && mod.Key && typeof mod.Key === "object" ? (mod.Key as Record<string, unknown>) : undefined
      const keys = candidates(keyName, keyMap)
      if (keys.length === 0) {
        log.warn("unknown key, attempting type", { keyName })
        await mod.keyboard.type(keyName)
        return
      }
      let last: unknown
      for (const key of keys) {
        try {
          await mod.keyboard.pressKey(key as never)
          await mod.keyboard.releaseKey(key as never)
          log.info("pressed key", { keyName, resolved: key })
          return
        } catch (e) {
          last = e
        }
      }
      throw toError(last, `Failed to press key: ${keyName}`)
    } catch (e) {
      const error = toError(e, `Failed to press key: ${keyName}`)
      log.error("pressKey failed", {
        keyName,
        errorName: error.name,
        error: error.message,
        stack: error.stack,
        rawType: typeof e,
      })
      throw error
    }
  }

  export async function typeText(text: string): Promise<void> {
    try {
      const { keyboard } = await import("@nut-tree-fork/nut-js")
      await keyboard.type(text)
      log.info("typed text", { length: text.length })
    } catch (e) {
      const error = toError(e, "Failed to type text")
      log.error("typeText failed", {
        errorName: error.name,
        error: error.message,
        stack: error.stack,
        rawType: typeof e,
      })
      throw error
    }
  }

  export async function hotkey(...keys: string[]): Promise<void> {
    try {
      if (process.platform === "win32") {
        const winFallback = await winChord(keys)
        if (winFallback) {
          log.info("hotkey", { keys, resolved: keys.map((key) => resolveName(key)), backend: "win32" })
          return
        }
      }
      const mod = await import("@nut-tree-fork/nut-js")
      const keyMap =
        "Key" in mod && mod.Key && typeof mod.Key === "object" ? (mod.Key as Record<string, unknown>) : undefined
      const resolved = keys.map((key) => candidates(key, keyMap))
      const missing = resolved.findIndex((x) => x.length === 0)
      if (missing >= 0) throw new Error(`Unknown key: ${keys[missing]}`)
      let plans: unknown[][] = [[]]
      for (const list of resolved) {
        const next: unknown[][] = []
        for (const prefix of plans) {
          for (const key of list) {
            next.push([...prefix, key])
          }
        }
        plans = next
      }
      let last: unknown
      for (const plan of plans) {
        try {
          for (const key of plan) {
            await mod.keyboard.pressKey(key as never)
          }
          const reverse = [...plan].reverse()
          try {
            for (const key of reverse) {
              await mod.keyboard.releaseKey(key as never)
            }
          } catch (releaseErr) {
            for (const key of reverse) {
              await mod.keyboard.releaseKey(key as never).catch(() => {})
            }
            throw releaseErr
          }
          log.info("hotkey", { keys, resolved: plan })
          return
        } catch (e) {
          last = e
        }
      }
      throw toError(last, `Failed to press hotkey: ${keys.join("+")}`)
    } catch (e) {
      const error = toError(e, `Failed to press hotkey: ${keys.join("+")}`)
      log.error("hotkey failed", {
        keys,
        errorName: error.name,
        error: error.message,
        stack: error.stack,
        rawType: typeof e,
      })
      throw error
    }
  }
}
