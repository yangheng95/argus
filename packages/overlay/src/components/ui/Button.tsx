import { splitProps } from "solid-js";
import type { JSX } from "solid-js";

export type ButtonVariant = "solid" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "icon";
export type ButtonTone = "neutral" | "accent" | "danger";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size: ButtonSize;
  tone: ButtonTone;
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, buttonProps] = splitProps(props, ["class", "variant", "size", "tone"]);
  const className = () => ["oc-button", local.class].filter(Boolean).join(" ");

  return (
    <button
      {...buttonProps}
      class={className()}
      data-variant={local.variant}
      data-size={local.size}
      data-tone={local.tone}
    />
  );
}
