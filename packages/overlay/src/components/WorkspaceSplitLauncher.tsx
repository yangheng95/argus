import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

interface WorkspaceSplitLauncherProps {
  rootClass: string;
  rootRole?: JSX.IntrinsicElements["div"]["role"];
  rootAriaLabel?: string;
  primaryClass: string;
  menuButtonClass: string;
  menuClass: string;
  disabled: boolean;
  open: boolean;
  title: string;
  primaryAriaLabel: string;
  menuAriaLabel: string;
  primaryDataUI?: string;
  menuDataUI?: string;
  pressed?: boolean;
  primaryChildren: JSX.Element;
  menuButtonChildren: JSX.Element;
  onPrimaryClick: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}

export function WorkspaceSplitLauncher(props: WorkspaceSplitLauncherProps): JSX.Element {
  let rootRef: HTMLDivElement | undefined;
  let menuButtonRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  const [menuPosition, setMenuPosition] = createSignal({ top: 0, right: 0 });

  function close(): void {
    props.onOpenChange(false);
  }

  function positionMenu(): void {
    if (!menuButtonRef) {
      throw new Error("workspace split launcher menu button is not mounted");
    }
    const rect = menuButtonRef.getBoundingClientRect();
    setMenuPosition({
      top: Math.round(rect.bottom + 6),
      right: Math.round(window.innerWidth - rect.right),
    });
  }

  function toggleMenu(): void {
    if (props.disabled) return;
    if (props.open) {
      close();
      return;
    }
    positionMenu();
    props.onOpenChange(true);
  }

  function primaryClick(): void {
    if (props.disabled) return;
    close();
    void props.onPrimaryClick();
  }

  function onPrimaryKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    primaryClick();
  }

  function onMenuKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMenu();
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!props.open) return;
    const target = event.target as Node | null;
    if (rootRef && target && rootRef.contains(target)) return;
    if (menuRef && target && menuRef.contains(target)) return;
    close();
  };

  const onViewportChange = (): void => {
    if (!props.open) return;
    positionMenu();
  };

  onMount(() => {
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  });

  return (
    <div
      class={props.rootClass}
      data-no-drag="true"
      role={props.rootRole}
      aria-label={props.rootAriaLabel}
      ref={(el) => (rootRef = el)}
    >
      <button
        type="button"
        class={`${props.primaryClass} workspace-split-launcher-primary`}
        data-ui={props.primaryDataUI}
        aria-pressed={props.pressed}
        title={props.title}
        aria-label={props.primaryAriaLabel}
        disabled={props.disabled}
        onClick={primaryClick}
        onKeyDown={onPrimaryKeyDown}
      >
        {props.primaryChildren}
      </button>
      <button
        type="button"
        class={`${props.menuButtonClass} workspace-split-launcher-menu-button`}
        data-ui={props.menuDataUI}
        data-open={props.open ? "true" : "false"}
        disabled={props.disabled}
        title={props.title}
        aria-label={props.menuAriaLabel}
        aria-haspopup="menu"
        aria-expanded={props.open ? "true" : "false"}
        ref={(el) => (menuButtonRef = el)}
        onClick={toggleMenu}
        onKeyDown={onMenuKeyDown}
      >
        {props.menuButtonChildren}
      </button>
      <Portal>
        <div
          class={props.menuClass}
          role="menu"
          hidden={!props.open}
          ref={(el) => (menuRef = el)}
          style={{
            // Runtime-computed portal coordinates routed through CSS
            // variables so the inline style only references vars (the
            // flat-redesign inline-style discipline forbids raw px
            // literals in style={{}}). The matching CSS reads
            // top/right from `--menu-top` / `--menu-right`.
            "--menu-top": `${menuPosition().top}px`,
            "--menu-right": `${menuPosition().right}px`,
            top: "var(--menu-top)",
            right: "var(--menu-right)",
          }}
        >
          {props.children}
        </div>
      </Portal>
    </div>
  );
}
