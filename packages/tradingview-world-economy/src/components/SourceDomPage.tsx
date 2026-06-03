// @ts-nocheck
import { AssetPath } from "./AssetPath"
import { EconomyRegion } from "./source-dom/EconomyRegion"
import { FooterNavigation } from "./semantic/FooterNavigation"
import { HeaderNavigation } from "./semantic/HeaderNavigation"

export interface SourceDomPageProps {
  sourceComponentNames: string
  tableCount: number
}

export function SourceDomPage({ sourceComponentNames, tableCount }: SourceDomPageProps) {
  return (
    <div className="source-dom-page theme-light feature-no-touch" data-theme="light" data-source-component-names={sourceComponentNames} data-source-table-count={tableCount}>
      <div>
        <div className={"skipNavigationItemWrapper-wCFzoXZN"} data-name={"skip-navigation"} style={{ "top": "120px", "left": "24px" }}>
          <div className={"background-OxBZfgw8 large-OxBZfgw8 neutral-OxBZfgw8"}>
            <div role={"button"} className={"button-fOp9u5tE"} data-is-popover-item-button={"true"}>
              <div className={"buttonContent-gIRstbSk"}>
                <div className={"middle-fY6nuScj hasTitle-fY6nuScj hasNoEndSlot-fY6nuScj"}>
                  <div className={"title-fY6nuScj ellipsis-dfs4USWQ apply-overflow-tooltip"}>
                    {" Skip to main content "}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={"layout__area--analysis"} style={{ "position": "fixed", "transform": "translateZ(0px)", "top": "0px", "height": "100%", "zIndex": "102", "width": "1407px", "left": "0px", "display": "none" }} />
      <div className={"tv-main"} data-sf-nesting-track-id={"1.6"}>
        <div className={"js-container-android-notification"} />
        <div className={"js-container-ios-notification"} />
        <HeaderNavigation />
        <main data-source-role={"main"} className={"tv-content"} id={"tv-content"} aria-label={"Main content"} data-sf-nesting-track-id={"1.6.6"}>
          <EconomyRegion />
        </main>
        <FooterNavigation />
      </div>
      <div id={"aria-live-regions-wrapper"} className={"aria-live-regions-wrapper"}>
        <div aria-live={"polite"} aria-relevant={"additions"} />
        <div aria-live={"polite"} aria-relevant={"additions"} />
        <div aria-live={"assertive"} aria-relevant={"additions"} />
        <div aria-live={"assertive"} aria-relevant={"additions"} />
      </div>
      <div id={"tooltip-root-element"} />
      <div id={"g_id_onload"} data-client_id={"236720109952-v7ud8uaov0nb49fk5qm03as8o7dmsb30.apps.googleusercontent.com"} data-callback={"handleGoogleCredentialResponse"} data-use_fedcm_for_prompt={"true"} data-moment_callback={"logMomentNotification"} data-cancel_on_tap_outside={"false"} />
      <div aria-live={"polite"} id={"snackbar-container"} />
    </div>
  )
}
