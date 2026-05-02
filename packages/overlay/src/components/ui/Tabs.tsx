import { splitProps } from "solid-js";
import type { JSX } from "solid-js";

export const TABS_SIZES = ["sm", "md"] as const;
export const TABS_TONES = ["neutral"] as const;

export type TabsSize = (typeof TABS_SIZES)[number];
export type TabsTone = (typeof TABS_TONES)[number];

export interface TabsProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList" | "role"> {
  size: TabsSize;
  tone: TabsTone;
}

export interface TabProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList" | "role"> {
  active: boolean;
  size: TabsSize;
  tone: TabsTone;
}

export function Tabs(props: TabsProps): JSX.Element {
  const [local, tabsProps] = splitProps(props, ["size", "tone"]);

  return (
    <div
      {...tabsProps}
      class="oc-tabs"
      role="tablist"
      data-size={local.size}
      data-tone={local.tone}
    />
  );
}

export function Tab(props: TabProps): JSX.Element {
  const [local, tabProps] = splitProps(props, ["active", "size", "tone"]);

  return (
    <button
      {...tabProps}
      type={tabProps.type ?? "button"}
      class="oc-tab"
      role="tab"
      aria-selected={local.active}
      data-active={local.active ? "true" : "false"}
      data-size={local.size}
      data-tone={local.tone}
    />
  );
}
