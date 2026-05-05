import { createEffect, mergeProps, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export interface DialogProps {
  /** Controlled open state for the native dialog element. */
  open: boolean;
  /** Dialog title rendered in the header bar. */
  title: JSX.Element;
  /** Optional header action row rendered on the right side. */
  headerActions?: JSX.Element;
  /** Optional footer action row rendered in .dialog-actions. */
  footer?: JSX.Element;
  /** Wider width variant for dense surfaces such as the log viewer. */
  wide?: boolean;
  /** Render title as `h2` by default, override only when semantics require it. */
  titleAs?: "div" | "h1" | "h2" | "span";
  /** Whether clicking the native backdrop closes the dialog. */
  backdropClose?: boolean;
  /** Extra class names applied to the native dialog element. */
  class?: string;
  /** Extra class names applied to .dialog-form. */
  formClass?: string;
  /** Forwarded ref for imperative focus or metrics. */
  ref?: ((el: HTMLDialogElement) => void) | HTMLDialogElement;
  /** Close callback fired after the native dialog closes. */
  onClose?: (dialog: HTMLDialogElement) => void;
  /** Dialog body content. */
  children: JSX.Element;
  /** Optional DOM id for the dialog root. */
  id?: string;
  [key: `data-${string}`]: string | boolean | undefined;
}

export function Dialog(rawProps: DialogProps) {
  const merged = mergeProps({ wide: false, titleAs: "h2" as const, backdropClose: true }, rawProps);
  const [local, rest] = splitProps(merged, [
    "open",
    "title",
    "headerActions",
    "footer",
    "wide",
    "titleAs",
    "backdropClose",
    "class",
    "formClass",
    "ref",
    "onClose",
    "children",
  ]);

  let dialogRef: HTMLDialogElement | undefined;

  createEffect(() => {
    const dialog = dialogRef;
    if (!dialog) return;
    if (local.open) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
  });

  return (
    <dialog
      {...rest}
      class={["dialog", local.wide ? "dialog-wide" : "", local.class].filter(Boolean).join(" ")}
      ref={(el) => {
        dialogRef = el;
        if (typeof local.ref === "function") local.ref(el);
      }}
      onClick={(event) => {
        if (local.backdropClose !== false && event.target === event.currentTarget) {
          dialogRef?.close();
        }
      }}
      onClose={() => {
        if (dialogRef) local.onClose?.(dialogRef);
      }}
    >
      <div class={["dialog-form", local.formClass].filter(Boolean).join(" ")}>
        <div class="dialog-header">
          <Dynamic component={local.titleAs} class="dialog-title">
            {local.title}
          </Dynamic>
          <Show when={local.headerActions}>
            <div class="dialog-header-actions">{local.headerActions}</div>
          </Show>
        </div>
        {local.children}
        <Show when={local.footer}>
          <div class="dialog-actions">{local.footer}</div>
        </Show>
      </div>
    </dialog>
  );
}
