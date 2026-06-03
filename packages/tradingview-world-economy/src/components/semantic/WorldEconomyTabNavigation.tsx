import type { CSSProperties } from "react"
import { worldEconomyTabs } from "../../data/extractedNavigation"

export function WorldEconomyTabNavigation() {
  return (
    <div data-source-node-id="node_000915" style={{ "--cms-sticky-navigation-top": "891px" } as CSSProperties}>
      <div data-source-node-id="node_000916" className="container-eaDI_i8s">
        <div data-source-node-id="node_000917" className="container-sticky-eaDI_i8s" data-header-status="hidden">
          <div data-source-node-id="node_000918" className="container-KzjYSOih navigation-eaDI_i8s">
            <div data-source-node-id="node_000919" className="wrap-KzjYSOih">
              <div data-source-node-id="node_000920" className="intersectionZone-PvrjeIzs">
                <span data-source-node-id="node_000921" className="intersectionDetector-PvrjeIzs left-PvrjeIzs" style={{ width: "1px" }} />
              </div>
              <div data-source-node-id="node_000922" className="block-KzjYSOih">
                <div data-source-node-id="node_000923" className="tabs-eaDI_i8s">
                  <div data-source-node-id="node_000924" className="scrollWrap-cDg9MxE_" data-name="round-tabs-anchors" style={{ "--ui-lib-roundTabs-gap": "4px" } as CSSProperties}>
                    <div data-source-node-id="node_000925" id="sticky-navigation-tabs" role="tablist" aria-orientation="horizontal" className="roundTabs-cDg9MxE_ start-cDg9MxE_">
                      {worldEconomyTabs.map((tab) => (
                        <a
                          data-source-node-id={`extracted-tab-${tab.id}`}
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
                          <span data-source-node-id={`extracted-tab-label-${tab.id}`} className="content-FF3hu1GK">
                            {tab.label}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div data-source-node-id="node_000950" className="intersectionZone-PvrjeIzs">
                <span data-source-node-id="node_000951" className="intersectionDetector-PvrjeIzs right-PvrjeIzs" style={{ width: "1px" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
