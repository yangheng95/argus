import { Keyboard } from "./keyboard"
import { Mouse } from "./mouse"
import { ClipboardInput } from "./clipboard"

export namespace GUI {
  export async function typeText(text: string): Promise<void> {
    return Keyboard.typeText(text)
  }

  export async function pressKey(key: string): Promise<void> {
    return Keyboard.pressKey(key)
  }

  export async function hotkey(...keys: string[]): Promise<void> {
    return Keyboard.hotkey(...keys)
  }

  export async function click(x: number, y: number): Promise<void> {
    return Mouse.click(x, y)
  }

  export async function doubleClick(x: number, y: number): Promise<void> {
    return Mouse.doubleClick(x, y)
  }

  export async function rightClick(x: number, y: number): Promise<void> {
    return Mouse.rightClick(x, y)
  }

  export async function scroll(direction: "up" | "down", amount: number = 3): Promise<void> {
    return Mouse.scroll(direction, amount)
  }

  export async function paste(text: string): Promise<void> {
    return ClipboardInput.paste(text)
  }

  export async function readClipboard(): Promise<string> {
    return ClipboardInput.read()
  }

  export function asInterface() {
    return {
      typeText,
      pressKey,
      click,
      scroll,
      paste,
    }
  }
}
