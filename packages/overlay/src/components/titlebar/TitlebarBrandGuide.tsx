import * as Popover from "@kobalte/core/popover"
import { createSignal, For } from "solid-js"
import { t } from "../../utils/i18n"

export function TitlebarBrandGuide() {
  const [anchorRef, setAnchorRef] = createSignal<HTMLElement>()
  const guideSteps = () => [
    t("brand.guide_usage_1"),
    t("brand.guide_usage_2"),
    t("brand.guide_usage_3"),
    t("brand.guide_usage_4"),
  ]

  return (
    <Popover.Root anchorRef={anchorRef} placement="bottom-start" gutter={8} slide={false}>
      <div ref={setAnchorRef} class="brand-guide-anchor" data-no-drag="true">
        <Popover.Trigger class="brand-guide" type="button" aria-label={t("brand.guide_trigger")} data-no-drag="true">
          <img class="brand-logo" src="opencorvus-logo-dark.svg" alt={t("brand.logo_alt")} />
          <span class="brand-guide-copyblock" aria-hidden="true">
            <span class="brand-guide-wordmark">OpenCorvus</span>
            <span class="brand-guide-label">{t("brand.workspace_label")}</span>
          </span>
        </Popover.Trigger>
        <Popover.Content class="brand-guide-card" data-no-drag="true">
          <div class="brand-guide-kicker">{t("brand.guide_kicker")}</div>
          <div class="brand-guide-section">
            <div class="brand-guide-title">{t("brand.guide_positioning_title")}</div>
            <p class="brand-guide-copy">{t("brand.guide_positioning_body")}</p>
          </div>
          <div class="brand-guide-section">
            <div class="brand-guide-title">{t("brand.guide_usage_title")}</div>
            <div class="brand-guide-steps">
              <For each={guideSteps()}>
                {(copy, index) => (
                  <div class="brand-guide-step">
                    <span class="brand-guide-step-index" aria-hidden="true">
                      {index() + 1}
                    </span>
                    <span class="brand-guide-step-copy">{copy}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Popover.Content>
      </div>
    </Popover.Root>
  )
}
