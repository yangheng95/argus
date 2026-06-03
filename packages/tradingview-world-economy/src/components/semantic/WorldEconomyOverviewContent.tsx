import { EconomicTrendsRegion5 } from "../source-dom/EconomicTrendsRegion5"
import { EconomyPageHeader } from "./EconomyPageHeader"
import { WorldEconomyTabNavigation } from "./WorldEconomyTabNavigation"

export function WorldEconomyOverviewContent() {
  return (
    <div data-source-node-id="node_000868" id="js-category-content" className="tv-category-content " data-sf-nesting-track-id="1.6.6.9">
      <EconomyPageHeader />
      <div data-source-node-id="node_000913" className="js-markets-world-economy-page-tab-overview-root" data-props-id="UE9jWZ" data-render-mode="legacy" data-sf-nesting-track-id="1.6.6.9.8">
        <div data-source-node-id="node_000914" className="container-hlm3yPqK pageWithOneSection-hlm3yPqK" data-sf-nesting-track-id="1.6.6.9.8.1">
          <WorldEconomyTabNavigation />
          <div data-source-node-id="node_000952" data-query-type="media" className="container-ZazqFM2n" data-sf-nesting-track-id="1.6.6.9.8.1.2">
            <section data-source-node-id="node_000953" data-source-role="section" className="section-jIcZQl74" data-an-section-id="world-economy-page-section" data-sf-nesting-track-id="1.6.6.9.8.1.2.1">
              <EconomicTrendsRegion5 />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
