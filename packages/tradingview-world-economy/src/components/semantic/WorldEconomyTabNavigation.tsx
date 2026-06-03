import type { CSSProperties } from "react"
import { worldEconomyTabs } from "../../data/extractedNavigation"

export function WorldEconomyTabNavigation() {
  return (
    <div style={{ "--cms-sticky-navigation-top": "891px" } as CSSProperties}>
      <div className="container-eaDI_i8s">
        <div className="container-sticky-eaDI_i8s" data-header-status="hidden">
          <div className="container-KzjYSOih navigation-eaDI_i8s">
            <div className="wrap-KzjYSOih">
              <div className="intersectionZone-PvrjeIzs">
                <span className="intersectionDetector-PvrjeIzs left-PvrjeIzs" style={{ width: "1px" }} />
              </div>
              <div className="block-KzjYSOih">
                <div className="tabs-eaDI_i8s">
                  <div className="scrollWrap-cDg9MxE_" data-name="round-tabs-anchors" style={{ "--ui-lib-roundTabs-gap": "4px" } as CSSProperties}>
                    <div id="sticky-navigation-tabs" role="tablist" aria-orientation="horizontal" className="roundTabs-cDg9MxE_ start-cDg9MxE_">
                      {worldEconomyTabs.map((tab) => (
                        <a
                          id={`header-${tab.id}`}
                          role="tab"
                          aria-selected={tab.selected}
                          aria-disabled="false"
                          aria-label=""
                          data-id={tab.id}
                          data-overflow-tooltip-text={tab.label}
                          className={[
                            "roundTabButton-FF3hu1GK xsmall-FF3hu1GK ghost-FF3hu1GK enableCursorPointer-FF3hu1GK apply-overflow-tooltip apply-overflow-tooltip--check-children-recursively apply-overflow-tooltip--allow-text",
                            tab.selected ? "selected-FF3hu1GK" : "",
                          ].join(" ")}
                          key={tab.id}
                        >
                          <span className="content-FF3hu1GK">
                            {tab.label}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="intersectionZone-PvrjeIzs">
                <span className="intersectionDetector-PvrjeIzs right-PvrjeIzs" style={{ width: "1px" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
