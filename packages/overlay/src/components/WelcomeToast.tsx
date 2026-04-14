import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../utils/i18n";

const VISIBLE_MS = 10000;
const EXIT_MS = 320;

type ToastState = "entering" | "visible" | "leaving" | "hidden";

export function WelcomeToast() {
  const [state, setState] = createSignal<ToastState>("entering");
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let enterFrame: number | undefined;

  function dismiss() {
    const s = state();
    if (s === "leaving" || s === "hidden") return;
    setState("leaving");
    if (hideTimer) clearTimeout(hideTimer);
    exitTimer = setTimeout(() => setState("hidden"), EXIT_MS);
  }

  onMount(() => {
    enterFrame = requestAnimationFrame(() => setState("visible"));
    hideTimer = setTimeout(dismiss, VISIBLE_MS);
  });

  onCleanup(() => {
    if (enterFrame) cancelAnimationFrame(enterFrame);
    if (hideTimer) clearTimeout(hideTimer);
    if (exitTimer) clearTimeout(exitTimer);
  });

  return (
    <Show when={state() !== "hidden"}>
      <div
        class="welcome-toast"
        data-state={state()}
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          class="welcome-toast-close"
          aria-label={t("welcome.close")}
          onClick={dismiss}
        >
          ×
        </button>
        <div class="welcome-toast-headline">{t("welcome.headline")}</div>
        <div class="welcome-toast-line">{t("welcome.line1")}</div>
        <div class="welcome-toast-line welcome-toast-line--muted">
          {t("welcome.line2")}
        </div>
      </div>
    </Show>
  );
}
