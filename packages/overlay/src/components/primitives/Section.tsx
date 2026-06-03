// ── Section ──
// Collapsible right-rail section built on native <details>/<summary>.
// Renders .oc-section with icon + title + optional badge in the header.
//
// Usage:
//   <Section title="Requirements" icon={<Icon name="requirement" />} defaultOpen>
//     {children}
//   </Section>
//
//   Controlled open state — hold a ref and set detailsEl.open imperatively,
//   or pass `id` so DOM accessors (like board's acceptanceSection) resolve:
//   <Section id="acceptanceSection" ref={el => detailsEl = el} ...>
//
// CSS: src/styles/primitives/section.css
// Migration target: Step 9.E — Board / FilesSection / GoalWorkflowGroup sections.

import { type JSX, splitProps, Show } from "solid-js";

export interface SectionProps {
  /** Section title displayed in the header. */
  title: string;
  /** Icon slot rendered left of the title (wrap in <Icon> or a span). */
  icon?: JSX.Element;
  /** Open on first render. Default: false. */
  defaultOpen?: boolean;
  /** Trailing badge content (text or JSX rendered inside .oc-section__badge). */
  badge?: JSX.Element;
  /** data-tone applied to .oc-section__badge (drives tone styling). */
  badgeTone?: string;
  /** id applied to .oc-section__badge (for DOM accessors). */
  badgeId?: string;
  /** data-variant applied to .oc-section__badge ("status" | "metric"). */
  badgeVariant?: string;
  /** id applied to .oc-section__body — used by DOM accessors like syncSectionPhases. */
  bodyId?: string;
  /** id forwarded to the <details> root — used by DOM accessors. */
  id?: string;
  /** Ref forwarded to the <details> element. */
  ref?: ((el: HTMLDetailsElement) => void) | HTMLDetailsElement;
  /** Extra class names on the root. */
  class?: string;
  /** data-* attributes forwarded to root. */
  [key: `data-${string}`]: string | boolean | undefined;
  /** attr:* attributes forwarded to root (e.g. attr:data-phase-state). */
  [key: `attr:${string}`]: string | undefined;
  children: JSX.Element;
}

export function Section(rawProps: SectionProps) {
  const [local, rest] = splitProps(rawProps, [
    "title", "icon", "defaultOpen",
    "badge", "badgeTone", "badgeId", "badgeVariant",
    "bodyId", "id", "ref", "class", "children",
  ]);

  return (
    <details
      id={local.id}
      class={["oc-section", local.class].filter(Boolean).join(" ")}
      open={local.defaultOpen}
      ref={local.ref as any}
      {...rest}
    >
      <summary class="oc-section__head">
        <Show when={local.icon}>
          <span class="oc-section__icon" aria-hidden="true">{local.icon}</span>
        </Show>
        <span class="oc-section__title">{local.title}</span>
        <Show when={local.badge !== undefined && local.badge !== null && local.badge !== ""}>
          <span
            class="oc-section__badge"
            id={local.badgeId}
            data-tone={local.badgeTone}
            data-variant={local.badgeVariant}
          >
            {local.badge}
          </span>
        </Show>
      </summary>
      <div class="oc-section__body" id={local.bodyId}>{local.children}</div>
    </details>
  );
}
