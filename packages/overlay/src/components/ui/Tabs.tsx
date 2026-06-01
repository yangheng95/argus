import { Tabs as KobalteTabs } from "@kobalte/core/tabs";
import { splitProps } from "solid-js";
import type { JSX } from "solid-js";

export const TABS_SIZES = ["sm", "md"] as const;
export const TABS_TONES = ["neutral"] as const;

export type TabsSize = (typeof TABS_SIZES)[number];
export type TabsTone = (typeof TABS_TONES)[number];

export interface TabsProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList" | "role" | "onChange"> {
  size: TabsSize;
  tone: TabsTone;
  value: string;
  onValueChange?: (value: string) => void;
}

export interface TabProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList" | "role" | "type"> {
  value: string;
  active: boolean;
  size: TabsSize;
  tone: TabsTone;
}

export function Tabs(props: TabsProps): JSX.Element {
  const [local, tabsProps] = splitProps(props, ["size", "tone", "value", "onValueChange", "children"]);

  return (
    <KobalteTabs value={local.value} onChange={local.onValueChange} activationMode="manual">
      <KobalteTabs.List
        {...tabsProps}
        class="oc-tabs"
        data-size={local.size}
        data-tone={local.tone}
      >
        {local.children}
      </KobalteTabs.List>
    </KobalteTabs>
  );
}

export function Tab(props: TabProps): JSX.Element {
  const [local, tabProps] = splitProps(props, ["value", "active", "size", "tone"]);

  return (
    <KobalteTabs.Trigger
      {...tabProps}
      value={local.value}
      class="oc-tab"
      data-active={local.active ? "true" : "false"}
      data-size={local.size}
      data-tone={local.tone}
    />
  );
}
