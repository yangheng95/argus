import { splitProps } from "solid-js"
import type { JSX } from "solid-js"

export const BUTTON_VARIANTS = ["solid", "outline", "ghost"] as const
export const BUTTON_SIZES = ["mini", "sm", "md", "icon"] as const
export const BUTTON_TONES = ["neutral", "accent", "danger"] as const

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]
export type ButtonSize = (typeof BUTTON_SIZES)[number]
export type ButtonTone = (typeof BUTTON_TONES)[number]

export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList"> {
  variant: ButtonVariant
  size: ButtonSize
  tone: ButtonTone
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, buttonProps] = splitProps(props, ["variant", "size", "tone"])

  return (
    <button
      {...buttonProps}
      class="oc-button"
      data-variant={local.variant}
      data-size={local.size}
      data-tone={local.tone}
    />
  )
}
